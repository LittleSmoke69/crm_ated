import type { NextRequest } from 'next/server';


/**
 * URL pública única do webhook Evolution em produção (independente do ambiente do app / NEXT_PUBLIC_*).
 * @see https://zaploto.com/api/webhooks/evolution/prod
 */
export const ZAPLOTO_EVOLUTION_PROD_WEBHOOK_URL =
  'https://zaploto.com/api/webhooks/evolution/prod' as const;

/**
 * URL pública do webhook prod (Evolution), com prefixo de slug em white label.
 * Central: `{base}/api/webhooks/evolution/prod` — WL: `{base}/{slug}/api/webhooks/evolution/prod`
 */
export function buildEvolutionProdWebhookUrlFromBase(
  publicBaseUrl: string,
  tenantSlug: string | null | undefined
): string {
  const base = publicBaseUrl
    .trim()
    .replace(/\/+$/, '')
    .replace(/([^:]\/)\/+/g, '$1');
  const slug = tenantSlug?.trim().toLowerCase();
  if (slug) {
    return `${base}/${slug}/api/webhooks/evolution/prod`;
  }
  return `${base}/api/webhooks/evolution/prod`;
}

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

/**
 * Nome da instância Evolution no payload (string na raiz, objeto `instance` ou em `data`).
 * Alinhado a `extractMetadata` em `app/api/webhooks/evolution/prod/route.ts`.
 */
export function extractEvolutionWebhookInstanceName(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;

  const inst = p.instance;
  if (typeof inst === 'string' && inst.trim()) return inst.trim();
  if (inst && typeof inst === 'object' && !Array.isArray(inst)) {
    const o = inst as Record<string, unknown>;
    for (const k of ['instanceName', 'name'] as const) {
      const v = o[k];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
  }

  const data = p.data as Record<string, unknown> | undefined;
  for (const v of [p.instanceName, data?.instance, data?.instanceName]) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }

  const dataInst = data?.instance;
  if (dataInst && typeof dataInst === 'object' && !Array.isArray(dataInst)) {
    const o = dataInst as Record<string, unknown>;
    for (const k of ['instanceName', 'name'] as const) {
      const v = o[k];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
  }

  return null;
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
 * Instância mestre registra o webhook de chat na criação por padrão (POST /api/instances).
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

