/**
 * Netlify Scheduled Function: process-activation-mass-send
 *
 * Roda a cada 1 minuto (configurado no netlify.toml).
 * Chama a API do Next.js para processar um lote de uma campanha de disparo em massa,
 * evitando timeout no disparo manual com muitos grupos.
 */

interface HandlerEvent {
  httpMethod?: string;
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
  const cronSecret = process.env.CRON_SECRET;

  if (!siteUrl || !cronSecret) {
    console.warn('[process-activation-mass-send] URL ou CRON_SECRET não configurados');
    return {
      statusCode: 200,
      body: JSON.stringify({ ok: false, message: 'Configuração ausente' }),
      headers: { 'Content-Type': 'application/json' },
    };
  }

  const processUrl = `${siteUrl.replace(/\/$/, '')}/api/crm/activations/mass-send/process`;

  try {
    const res = await fetch(processUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-cron-secret': cronSecret,
      },
    });

    const text = await res.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // mantém texto
    }

    if (!res.ok) {
      console.error('[process-activation-mass-send] API retornou', res.status, text);
      return {
        statusCode: 200,
        body: JSON.stringify({ ok: false, status: res.status, body }),
        headers: { 'Content-Type': 'application/json' },
      };
    }

    return {
      statusCode: 200,
      body: typeof body === 'string' ? body : JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    };
  } catch (err: unknown) {
    console.error('[process-activation-mass-send] Erro ao chamar API:', err);
    return {
      statusCode: 200,
      body: JSON.stringify({ ok: false, error: String(err) }),
      headers: { 'Content-Type': 'application/json' },
    };
  }
};
