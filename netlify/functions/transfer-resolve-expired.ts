/**
 * Netlify Scheduled Function: transfer-resolve-expired
 *
 * Formação automática: a cada 1 hora chama a API do app para resolver
 * transferências expiradas (vincular ou marcar como disponível para repasse).
 *
 * Configuração:
 * - TRANSFER_RESOLVE_CRON_SECRET: mesmo valor definido no app (Next.js) para autorizar a rota /api/cron/resolve-expired-transfers
 * - URL do site: Netlify injeta process.env.URL (ex.: https://seu-app.netlify.app)
 *
 * Em netlify.toml: schedule = "0 * * * *" (a cada hora, no minuto 0).
 */

const CRON_SECRET = process.env.TRANSFER_RESOLVE_CRON_SECRET?.trim();
const SITE_URL = process.env.URL || process.env.DEPLOY_PRIME_URL || '';

export const handler = async () => {
  if (!CRON_SECRET) {
    console.warn('[transfer-resolve-expired] TRANSFER_RESOLVE_CRON_SECRET não configurado. Ignorando.');
    return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: 'secret_not_configured' }) };
  }

  if (!SITE_URL) {
    console.error('[transfer-resolve-expired] URL do site não disponível (URL ou DEPLOY_PRIME_URL).');
    return { statusCode: 500, body: JSON.stringify({ error: 'URL do site não configurada' }) };
  }

  const endpoint = `${SITE_URL.replace(/\/+$/, '')}/api/cron/resolve-expired-transfers`;
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'x-cron-secret': CRON_SECRET,
      },
      body: JSON.stringify({}),
    });
    const text = await res.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
    if (!res.ok) {
      console.error('[transfer-resolve-expired] API retornou', res.status, data);
      return { statusCode: res.status, body: JSON.stringify({ error: 'API error', status: res.status, data }) };
    }
    console.log('[transfer-resolve-expired] Sucesso:', data);
    return { statusCode: 200, body: JSON.stringify(data) };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[transfer-resolve-expired] Erro ao chamar API:', msg);
    return { statusCode: 500, body: JSON.stringify({ error: msg }) };
  }
};
