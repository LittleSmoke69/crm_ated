/**
 * Netlify Scheduled Function: maturation-tick
 *
 * Roda a cada 1 minuto (configurado no netlify.toml).
 * Chama a API do Next.js para processar um lote de steps de maturação,
 * evitando timeout de conexão longa no processamento inline.
 *
 * Em desenvolvimento, pode ser chamado via HTTP diretamente.
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
  const cronSecret = process.env.CRON_SECRET;

  if (!siteUrl || !cronSecret) {
    console.warn('[maturation-tick] URL ou CRON_SECRET não configurados');
    return {
      statusCode: 200,
      body: JSON.stringify({ ok: false, message: 'Configuração ausente' }),
      headers: { 'Content-Type': 'application/json' },
    };
  }

  const tickUrl = `${siteUrl.replace(/\/$/, '')}/api/maturation/cron-tick`;
  console.log('[maturation-tick] Chamando:', tickUrl);

  try {
    const res = await fetch(tickUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-cron-secret': cronSecret,
      },
    });

    const text = await res.text();
    let body: unknown = text;
    try { body = JSON.parse(text); } catch { /* mantém texto */ }

    if (!res.ok) {
      console.error('[maturation-tick] API retornou', res.status, text);
      return {
        statusCode: 200,
        body: JSON.stringify({ ok: false, status: res.status, body }),
        headers: { 'Content-Type': 'application/json' },
      };
    }

    console.log('[maturation-tick] Tick concluído:', JSON.stringify(body).substring(0, 200));
    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, body }),
      headers: { 'Content-Type': 'application/json' },
    };
  } catch (err: any) {
    console.error('[maturation-tick] Erro ao chamar API:', err.message);
    return {
      statusCode: 200,
      body: JSON.stringify({ ok: false, error: err.message }),
      headers: { 'Content-Type': 'application/json' },
    };
  }
};
