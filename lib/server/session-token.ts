import type { NextRequest, NextResponse } from 'next/server';

export const ZAPLOTO_SESSION_COOKIE = 'zaploto_session';

const SESSION_TTL_SEC = 60 * 60 * 24 * 7; // 7 dias

function getSessionSecret(): string {
  const secret =
    process.env.SESSION_SECRET?.trim() ||
    process.env.CRON_SECRET?.trim() ||
    process.env.INTERNAL_CRON_SECRET?.trim();
  if (!secret) {
    throw new Error('SESSION_SECRET (ou CRON_SECRET) não configurado no servidor.');
  }
  return secret;
}

function getSessionSecretOrNull(): string | null {
  return (
    process.env.SESSION_SECRET?.trim() ||
    process.env.CRON_SECRET?.trim() ||
    process.env.INTERNAL_CRON_SECRET?.trim() ||
    null
  );
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** HMAC-SHA256 compatível com Edge Runtime (Web Crypto). */
async function signPayload(payload: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return base64UrlEncode(new Uint8Array(sig));
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** Gera valor do cookie de sessão: userId.exp.sig */
export async function createSessionToken(userId: string): Promise<string> {
  const secret = getSessionSecret();
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SEC;
  const payload = `${userId}.${exp}`;
  const sig = await signPayload(payload, secret);
  return `${payload}.${sig}`;
}

export async function verifySessionToken(
  token: string | null | undefined
): Promise<string | null> {
  if (!token?.trim()) return null;
  const secret = getSessionSecretOrNull();
  if (!secret) return null;

  const parts = token.trim().split('.');
  if (parts.length !== 3) return null;
  const [userId, expStr, sig] = parts;
  if (!userId || !expStr || !sig) return null;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return null;
  const payload = `${userId}.${expStr}`;
  const expected = await signPayload(payload, secret);
  if (!safeEqual(sig, expected)) return null;
  return userId;
}

export async function readSessionUserIdFromRequest(req: NextRequest): Promise<string | null> {
  const cookie = req.cookies.get(ZAPLOTO_SESSION_COOKIE)?.value;
  return verifySessionToken(cookie);
}

export async function appendSessionCookie(res: NextResponse, userId: string): Promise<void> {
  const token = await createSessionToken(userId);
  const secure = process.env.NODE_ENV === 'production';
  res.cookies.set(ZAPLOTO_SESSION_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SEC,
  });
  res.cookies.set('user_id', userId, {
    httpOnly: false,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SEC,
  });
}

export function clearSessionCookies(res: NextResponse): void {
  const opts = { path: '/', maxAge: 0 };
  res.cookies.set(ZAPLOTO_SESSION_COOKIE, '', { ...opts, httpOnly: true });
  res.cookies.set('user_id', '', { ...opts, httpOnly: false });
}

/** Em produção exige sessão assinada; em dev permite legacy se ALLOW_LEGACY_USER_ID_AUTH=true */
export function isLegacyUserIdAuthAllowed(): boolean {
  if (process.env.ALLOW_LEGACY_USER_ID_AUTH === 'true') return true;
  return process.env.NODE_ENV !== 'production';
}
