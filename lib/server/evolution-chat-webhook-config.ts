import type { NextRequest } from 'next/server';

/**
 * Eventos enviados para o webhook interno que persiste mensagens no chat (Supabase).
 * Alinhado a `app/api/webhooks/evolution/route.ts` e `evolution-chat-webhook-handler.ts`.
 *
 * A Evolution pode enviar em maiúsculas (MESSAGES_UPSERT) ou com ponto (messages.upsert).
 */
export const EVOLUTION_CHAT_WEBHOOK_MESSAGE_EVENTS = [
  'MESSAGES_UPSERT',
  'MESSAGES_UPDATE',
  'MESSAGES_DELETE',
  'SEND_MESSAGE',
] as const;

/**
 * URL pública única do webhook Evolution em produção (independente do ambiente do app / NEXT_PUBLIC_*).
 * @see https://zaploto.com/api/webhooks/evolution/prod
 */
export const ZAPLOTO_EVOLUTION_PROD_WEBHOOK_URL =
  'https://zaploto.com/api/webhooks/evolution/prod' as const;

/**
 * Eventos registrados na Evolution em `/instance/create` (webhook).
 * Apenas mensagens recebidas (upsert) e confirmação de envio — alinhado ao painel Evolution (MESSAGES_UPSERT / SEND_MESSAGE).
 */
export const EVOLUTION_INSTANCE_WEBHOOK_EVENTS = ['MESSAGES_UPSERT', 'SEND_MESSAGE'] as const;

/**
 * Converte nomes de evento da Evolution (ex.: messages.upsert, MESSAGES_UPSERT) para o
 * formato canônico usado no switch do handler (MESSAGES_UPSERT).
 */
export function normalizeEvolutionChatWebhookEvent(raw: string): string {
  if (!raw || typeof raw !== 'string') return '';
  const key = raw.trim().toLowerCase().replace(/_/g, '.');
  const map: Record<string, string> = {
    'messages.upsert': 'MESSAGES_UPSERT',
    'messages.update': 'MESSAGES_UPDATE',
    'messages.delete': 'MESSAGES_DELETE',
    'send.message': 'SEND_MESSAGE',
  };
  return map[key] ?? raw;
}

/** Indica se o evento normalizado deve persistir em `chat_conversations` / `chat_messages`. */
export function isEvolutionChatPersistenceEvent(normalized: string): boolean {
  return (EVOLUTION_CHAT_WEBHOOK_MESSAGE_EVENTS as readonly string[]).includes(normalized);
}

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
 * Instância mestre pode registrar o webhook de chat na criação.
 * Defina EVOLUTION_WEBHOOK_SKIP_MASTER=true para criar só no banco (sem webhook na Evolution).
 */
export function shouldConfigureMasterChatWebhook(): boolean {
  return process.env.EVOLUTION_WEBHOOK_SKIP_MASTER !== 'true';
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
