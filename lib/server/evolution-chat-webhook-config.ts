import type { NextRequest } from 'next/server';

/**
 * Eventos enviados para o webhook interno que persiste mensagens no chat (Supabase).
 * Alinhado a `app/api/webhooks/evolution/route.ts`.
 */
export const EVOLUTION_CHAT_WEBHOOK_MESSAGE_EVENTS = [
  'MESSAGES_UPSERT',
  'MESSAGES_UPDATE',
  'MESSAGES_DELETE',
  'SEND_MESSAGE',
] as const;

/**
 * Resolve URL pública do app para a Evolution API alcançar o webhook (não pode ser só "localhost" em produção).
 */
export function resolvePublicBaseUrlForWebhooks(req: NextRequest): string | null {
  const fromEnv =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_WEBHOOK_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_URL?.trim() ||
    process.env.SITE_URL?.trim();
  if (fromEnv) {
    return fromEnv.replace(/\/+$/, '').replace(/([^:]\/)\/+/g, '$1');
  }
  const origin = req.headers.get('origin') || req.headers.get('host') || req.headers.get('x-forwarded-host');
  if (!origin) return null;
  if (origin.startsWith('http')) {
    return origin.replace(/\/+$/, '').replace(/([^:]\/)\/+/g, '$1');
  }
  const protocol = req.headers.get('x-forwarded-proto') || req.headers.get('x-forwarded-scheme') || 'https';
  return `${protocol}://${origin}`.replace(/\/+$/, '').replace(/([^:]\/)\/+/g, '$1');
}

export function isLikelyLocalhostWebhookBase(baseUrl: string): boolean {
  return /^(https?:\/\/)(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(baseUrl.trim());
}

/**
 * Evolution na nuvem não acessa localhost sem túnel — mesmo critério de `evolution-chat-instance-create.ts`.
 */
export function assertEvolutionCanReachWebhookBase(baseUrl: string): string | null {
  const allowLocalhost = process.env.EVOLUTION_WEBHOOK_ALLOW_LOCALHOST === 'true';
  if (isLikelyLocalhostWebhookBase(baseUrl) && !allowLocalhost) {
    return (
      'A URL do webhook aponta para localhost, inacessível pela Evolution API. ' +
      'Use NEXT_PUBLIC_APP_URL com domínio público (ou túnel ngrok/cloudflared), ' +
      'ou defina EVOLUTION_WEBHOOK_ALLOW_LOCALHOST=true apenas em desenvolvimento.'
    );
  }
  return null;
}

/**
 * URL do webhook que grava mensagens no banco (`/api/webhooks/evolution` + token).
 */
export function buildInternalChatWebhookUrl(publicBaseUrl: string): { ok: true; url: string } | { ok: false; error: string } {
  const token = process.env.EVOLUTION_WEBHOOK_TOKEN?.trim();
  if (!token) {
    return { ok: false, error: 'EVOLUTION_WEBHOOK_TOKEN não configurado no ambiente do servidor' };
  }
  const base = publicBaseUrl.replace(/\/+$/, '');
  const url = `${base}/api/webhooks/evolution?token=${encodeURIComponent(token)}`;
  return { ok: true, url };
}
