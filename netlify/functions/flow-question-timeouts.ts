/**
 * Netlify Scheduled Function — melhor esforço: roda no mínimo ~1 minuto (limite do Netlify).
 * Para **verificação a cada 1 segundo**, use:
 * - FLOW_QUESTION_POLL_ENABLED=true no servidor de processo único, ou
 * - cron externo (curl GET) a cada 1s com ?token=CRON_SECRET
 */

interface HandlerEvent {
  httpMethod?: string;
  headers?: Record<string, string>;
}

interface HandlerContext {
  functionName?: string;
}

interface HandlerResponse {
  statusCode: number;
  body: string;
  headers?: Record<string, string>;
}

export const handler = async (_event: HandlerEvent, _context: HandlerContext): Promise<HandlerResponse> => {
  const siteUrl = process.env.URL || process.env.SITE_URL;
  const cronSecret = process.env.CRON_SECRET || process.env.INTERNAL_CRON_SECRET;

  if (!siteUrl || !cronSecret) {
    console.warn('[flow-question-timeouts] URL ou CRON_SECRET não configurados');
    return {
      statusCode: 200,
      body: JSON.stringify({ ok: false, message: 'Configuração ausente' }),
      headers: { 'Content-Type': 'application/json' },
    };
  }

  const url = `${siteUrl.replace(/\/$/, '')}/api/internal/cron/flow-question-timeouts?token=${encodeURIComponent(cronSecret)}`;

  try {
    const res = await fetch(url, { method: 'GET', cache: 'no-store' });
    const text = await res.text();
    return {
      statusCode: res.status,
      body: text,
      headers: { 'Content-Type': 'application/json' },
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[flow-question-timeouts]', msg);
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: msg }),
      headers: { 'Content-Type': 'application/json' },
    };
  }
};
