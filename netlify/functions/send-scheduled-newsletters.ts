/**
 * Netlify Scheduled Function — melhor esforço: roda no mínimo ~1 minuto (limite do Netlify).
 * Dispara /api/internal/cron/send-scheduled-newsletters, que processa as
 * newsletters agendadas (status='scheduled', scheduled_at <= agora), incluindo
 * as pausadas por limite diário de SMTP que retomam no dia seguinte.
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
    console.warn('[send-scheduled-newsletters] URL ou CRON_SECRET não configurados');
    return {
      statusCode: 200,
      body: JSON.stringify({ ok: false, message: 'Configuração ausente' }),
      headers: { 'Content-Type': 'application/json' },
    };
  }

  const url = `${siteUrl.replace(/\/$/, '')}/api/internal/cron/send-scheduled-newsletters?token=${encodeURIComponent(cronSecret)}`;

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
    console.error('[send-scheduled-newsletters]', msg);
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: msg }),
      headers: { 'Content-Type': 'application/json' },
    };
  }
};
