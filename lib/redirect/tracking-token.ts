const TRACKING_TTL_SEC = 60 * 30; // 30 min

function getTrackingSecret(): string {
  const secret =
    process.env.SESSION_SECRET?.trim() ||
    process.env.CRON_SECRET?.trim() ||
    process.env.INTERNAL_CRON_SECRET?.trim();
  if (!secret) {
    throw new Error('SESSION_SECRET (ou CRON_SECRET) não configurado no servidor.');
  }
  return secret;
}

function getTrackingSecretOrNull(): string | null {
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

type TrackingKind = 'click' | 'visit';

async function createToken(kind: TrackingKind, id: string): Promise<string> {
  const secret = getTrackingSecret();
  const exp = Math.floor(Date.now() / 1000) + TRACKING_TTL_SEC;
  const payload = `${kind}:${id}.${exp}`;
  const sig = await signPayload(payload, secret);
  return `${payload}.${sig}`;
}

async function verifyToken(
  kind: TrackingKind,
  token: string | null | undefined,
  expectedId: string
): Promise<boolean> {
  if (!token?.trim() || !expectedId) return false;
  const secret = getTrackingSecretOrNull();
  if (!secret) return false;

  const parts = token.trim().split('.');
  if (parts.length !== 3) return false;
  const [prefix, expStr, sig] = parts;
  const expectedPrefix = `${kind}:${expectedId}`;
  if (prefix !== expectedPrefix) return false;

  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;

  const payload = `${prefix}.${expStr}`;
  const expectedSig = await signPayload(payload, secret);
  return safeEqual(sig, expectedSig);
}

export function createRedirectClickToken(clickId: string): Promise<string> {
  return createToken('click', clickId);
}

export function createRedirectVisitToken(visitId: string): Promise<string> {
  return createToken('visit', visitId);
}

export function verifyRedirectClickToken(
  clickId: string,
  token: string | null | undefined
): Promise<boolean> {
  return verifyToken('click', token, clickId);
}

export function verifyRedirectVisitToken(
  visitId: string,
  token: string | null | undefined
): Promise<boolean> {
  return verifyToken('visit', token, visitId);
}
