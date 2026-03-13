/**
 * Netlify Scheduled Function: transfer-resolve-expired
 *
 * Formação automática: a cada 1 hora chama a API do app em pacotes para resolver
 * transferências expiradas. Cada requisição processa até max_logs (1) para evitar 504;
 * se houver remaining_logs, faz nova requisição até acabar ou atingir o limite de pacotes.
 *
 * Configuração:
 * - TRANSFER_RESOLVE_CRON_SECRET: mesmo valor definido no app (Next.js)
 * - URL do site: Netlify injeta process.env.URL
 *
 * Em netlify.toml: schedule = "0 * * * *" (a cada hora, no minuto 0).
 */

const CRON_SECRET = process.env.TRANSFER_RESOLVE_CRON_SECRET?.trim();
const SITE_URL = process.env.URL || process.env.DEPLOY_PRIME_URL || '';

/** Entries (leads) processadas por requisição. 2–3 = poucas chamadas ao CRM por request, resposta em segundos. */
const MAX_ENTRIES_PER_PACOTE = 2;
/** Limite de pacotes por execução do cron (evita loop infinito). */
const MAX_PACOTES = 100;

type PacoteData = {
  results?: unknown[];
  total_resolved?: number;
  total_vinculado?: number;
  total_disponivel?: number;
  remaining_logs?: number;
  message?: string;
};

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
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'x-cron-secret': CRON_SECRET,
  };

  let pacoteIndex = 0;
  let totalResolved = 0;
  let totalVinculado = 0;
  let totalDisponivel = 0;
  const allResults: unknown[] = [];
  let lastMessage = '';

  try {
    while (pacoteIndex < MAX_PACOTES) {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ max_entries: MAX_ENTRIES_PER_PACOTE }),
      });
      const text = await res.text();
      let json: { success?: boolean; data?: PacoteData; error?: string } = {};
      try {
        json = JSON.parse(text) as typeof json;
      } catch {
        console.error('[transfer-resolve-expired] Pacote', pacoteIndex + 1, 'resposta inválida:', text.slice(0, 200));
        return {
          statusCode: res.ok ? 200 : res.status,
          body: JSON.stringify({
            error: 'Resposta inválida da API',
            pacotes_ok: pacoteIndex,
            total_resolved: totalResolved,
            total_vinculado: totalVinculado,
            total_disponivel: totalDisponivel,
          }),
        };
      }

      if (!res.ok) {
        console.error('[transfer-resolve-expired] Pacote', pacoteIndex + 1, 'API retornou', res.status, json);
        return {
          statusCode: res.status,
          body: JSON.stringify({
            error: json?.error ?? 'API error',
            pacotes_ok: pacoteIndex,
            total_resolved: totalResolved,
            total_vinculado: totalVinculado,
            total_disponivel: totalDisponivel,
          }),
        };
      }

      const data = json.data ?? {};
      totalResolved += Number(data.total_resolved) || 0;
      totalVinculado += Number(data.total_vinculado) || 0;
      totalDisponivel += Number(data.total_disponivel) || 0;
      if (Array.isArray(data.results)) allResults.push(...data.results);
      if (data.message) lastMessage = data.message;

      pacoteIndex++;
      const remaining = Number(data.remaining_logs) || 0;
      console.log('[transfer-resolve-expired] Pacote', pacoteIndex, 'ok. remaining_logs=', remaining);

      if (remaining <= 0) break;
    }

    const body = {
      success: true,
      pacotes: pacoteIndex,
      total_resolved: totalResolved,
      total_vinculado: totalVinculado,
      total_disponivel: totalDisponivel,
      results: allResults,
      message: lastMessage || `Processados ${pacoteIndex} pacote(s). ${totalVinculado} vinculado(s), ${totalDisponivel} disponível(is) para repasse.`,
    };
    console.log('[transfer-resolve-expired] Concluído:', body.message);
    return { statusCode: 200, body: JSON.stringify(body) };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[transfer-resolve-expired] Erro ao chamar API:', msg);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: msg,
        pacotes_ok: pacoteIndex,
        total_resolved: totalResolved,
        total_vinculado: totalVinculado,
        total_disponivel: totalDisponivel,
      }),
    };
  }
};
