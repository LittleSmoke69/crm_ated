import { sha256 } from '@/lib/vsl/hash';

/** Extrai IP do cliente a partir de headers (SSR, API routes, middleware). */
export function getClientIpFromHeaders(headerStore: Headers): string {
  const forwarded = headerStore.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (forwarded) return forwarded;
  const realIp = headerStore.get('x-real-ip')?.trim();
  if (realIp) return realIp;
  const cfIp = headerStore.get('cf-connecting-ip')?.trim();
  if (cfIp) return cfIp;
  return '';
}

/** Hash SHA-256 do IP (LGPD-friendly; não persiste IP em claro). */
export function getClientIpHashFromHeaders(headerStore: Headers): string | null {
  const ip = getClientIpFromHeaders(headerStore);
  return ip ? sha256(ip) : null;
}

export function isMissingIpHashColumnError(err: { code?: string; message?: string } | null): boolean {
  const msg = (err?.message ?? '').toLowerCase();
  return err?.code === '42703' || msg.includes('ip_hash');
}
