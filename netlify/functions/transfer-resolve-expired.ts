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
const MAX_ENTRIES_PER_PACOTE = 200;
/** Limite de pacotes por execução do cron (evita loop infinito). */
const MAX_PACOTES = 100;

/** Lead vinculado: qual lead foi vinculado a qual consultor e em qual banca (nome para relatório) */
type VinculadoItem = {
  lead_id: string;
  consultant_email: string;
  banca_id: string;
  banca_name: string;
};

/** Um log resolvido na API: contém os vinculados deste log (com nome da banca) */
type ResultItem = {
  log_id: string;
  banca_id: string;
  banca_name: string;
  resolved: number;
  vinculado: number;
  disponivel_retransferencia: number;
  message: string;
  vinculados?: VinculadoItem[];
};

type PacoteData = {
  results?: ResultItem[];
  total_resolved?: number;
  total_vinculado?: number;
  total_disponivel?: number;
  remaining_logs?: number;
  message?: string;
};

/** Resumo de um pacote executado: o que foi resolvido e quem foi vinculado a quem em qual banca */
type ResumoPacote = {
  numero: number;
  total_resolved: number;
  total_vinculado: number;
  total_disponivel: number;
  results: ResultItem[];
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
  const allResults: ResultItem[] = [];
  const resumoPacotes: ResumoPacote[] = [];
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
      const pacoteResolved = Number(data.total_resolved) || 0;
      const pacoteVinculado = Number(data.total_vinculado) || 0;
      const pacoteDisponivel = Number(data.total_disponivel) || 0;
      totalResolved += pacoteResolved;
      totalVinculado += pacoteVinculado;
      totalDisponivel += pacoteDisponivel;

      const resultsPacote = Array.isArray(data.results) ? (data.results as ResultItem[]) : [];
      if (resultsPacote.length) allResults.push(...resultsPacote);

      resumoPacotes.push({
        numero: pacoteIndex + 1,
        total_resolved: pacoteResolved,
        total_vinculado: pacoteVinculado,
        total_disponivel: pacoteDisponivel,
        results: resultsPacote,
        message: data.message,
      });
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
      /** Lista plana de todos os logs resolvidos (cada um com vinculados: lead → consultor, banca) */
      results: allResults,
      /** Por pacote: o que foi resolvido em cada chamada à API — quem foi vinculado a qual consultor e em qual banca */
      resumo_por_pacote: resumoPacotes,
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
