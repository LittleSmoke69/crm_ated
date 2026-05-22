import type { NextRequest } from 'next/server';

type Bucket = { count: number; resetAt: number };

const store = new Map<string, Bucket>();

function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (forwarded) return forwarded;
  return req.headers.get('x-real-ip')?.trim() || 'unknown';
}

/**
 * Rate limit simples em memória por IP + chave de rota.
 * @returns null se permitido; mensagem de erro se bloqueado
 */
export function checkIpRateLimit(
  req: NextRequest,
  routeKey: string,
  maxRequests: number,
  windowMs: number
): string | null {
  const key = `${routeKey}:${clientIp(req)}`;
  const now = Date.now();
  const hit = store.get(key);
  if (!hit || hit.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return null;
  }
  hit.count += 1;
  if (hit.count > maxRequests) {
    return 'Muitas tentativas. Aguarde alguns minutos e tente novamente.';
  }
  return null;
}
