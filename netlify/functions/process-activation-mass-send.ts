/**
 * Netlify Scheduled Function: process-activation-mass-send
 *
 * Roda a cada 1 min (mín. Netlify). Timeout: 120s.
 * Cada iteração chama a API route que processa EXATAMENTE 1 grupo.
 * O delay de 1s entre grupos é aplicado aqui entre as chamadas.
 * NUNCA faz break em erro — sempre tenta de novo até a fila esvaziar ou o budget acabar.
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

/** Delay entre grupos (1s). */
const INTER_GROUP_DELAY_MS = 1_000;

/** Orçamento total da função (timeout é 120s, usamos 115s como teto). */
const MAX_LOOP_MS = 115_000;

/** Máximo de erros CONSECUTIVOS antes de desistir. */
const MAX_CONSECUTIVE_ERRORS = 5;

function parseProcessBody(text: string): unknown {
  const trimmed = text.trimStart();
  const jsonStart = trimmed.indexOf('{');
  if (jsonStart < 0) return null;
  try {
    return JSON.parse(trimmed.slice(jsonStart));
  } catch {
    return null;
  }
}

export const handler = async (_event: HandlerEvent, _context: HandlerContext): Promise<HandlerResponse> => {
  const siteUrl = process.env.URL || process.env.SITE_URL;
  const cronSecret = process.env.CRON_SECRET;

  if (!siteUrl || !cronSecret) {
    console.warn('[mass-send-cron] URL ou CRON_SECRET não configurados');
    return {
      statusCode: 200,
      body: JSON.stringify({ ok: false, message: 'Configuração ausente' }),
      headers: { 'Content-Type': 'application/json' },
    };
  }

  const processUrl = `${siteUrl.replace(/\/$/, '')}/api/crm/activations/mass-send/process`;
  const startTime = Date.now();
  let iteration = 0;
  let totalSent = 0;
  let totalFailed = 0;
  let consecutiveErrors = 0;

  while (Date.now() - startTime < MAX_LOOP_MS) {
    iteration++;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 55_000);

      const res = await fetch(processUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-cron-secret': cronSecret,
        },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const text = await res.text();
      const body = parseProcessBody(text) as Record<string, unknown> | null;
      const data = (body?.data ?? body) as Record<string, unknown> | undefined;

      // API retornou erro HTTP — loga e CONTINUA (não break)
      if (!res.ok) {
        consecutiveErrors++;
        console.error(`[mass-send-cron] #${iteration} API ${res.status} (err ${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}):`, text.slice(0, 200));
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          console.error(`[mass-send-cron] ${MAX_CONSECUTIVE_ERRORS} erros consecutivos, encerrando.`);
          break;
        }
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }

      // Reset contador de erros consecutivos
      consecutiveErrors = 0;

      const msg = String(data?.message ?? '').toLowerCase();
      const processed = data?.processed;
      const status = data?.status;

      // Nenhum job na fila → encerra
      if (processed === false && msg.includes('nenhum job')) {
        console.log(`[mass-send-cron] Fila vazia. ${iteration} iter, ${totalSent} OK, ${totalFailed} falha.`);
        break;
      }

      // Lock ocupado → aguarda e tenta de novo
      if (processed === false && msg.includes('lock')) {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }

      // processed=false por outro motivo → aguarda
      if (processed === false) {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }

      // Campanha pausada → encerra (esperando o user dar play)
      if (status === 'paused') {
        console.log(`[mass-send-cron] Job pausado. ${iteration} iter, ${totalSent} OK, ${totalFailed} falha.`);
        break;
      }

      // Processou 1 grupo
      if (processed === true) {
        totalSent += Number(data?.sent ?? 0);
        totalFailed += Number(data?.failed ?? 0);

        // Campanha concluída → verifica se há outro job
        if (status === 'completed') {
          console.log(`[mass-send-cron] Job concluído [${data?.current_index}/${data?.total}]. Verificando próximo…`);
          await new Promise((r) => setTimeout(r, INTER_GROUP_DELAY_MS));
          continue;
        }

        // Ainda tem mais grupos → delay e próximo
        if (data?.more_pending) {
          await new Promise((r) => setTimeout(r, INTER_GROUP_DELAY_MS));
          continue;
        }
      }

      // Fallback
      await new Promise((r) => setTimeout(r, INTER_GROUP_DELAY_MS));
    } catch (err: unknown) {
      consecutiveErrors++;
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[mass-send-cron] #${iteration} erro (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}): ${errMsg}`);
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        console.error(`[mass-send-cron] ${MAX_CONSECUTIVE_ERRORS} erros consecutivos, encerrando.`);
        break;
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  const totalMs = Date.now() - startTime;
  console.log(`[mass-send-cron] Concluído: ${iteration} iter em ${Math.round(totalMs / 1000)}s | ${totalSent} OK, ${totalFailed} falha`);

  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true, iterations: iteration, elapsed_ms: totalMs, sent: totalSent, failed: totalFailed }),
    headers: { 'Content-Type': 'application/json' },
  };
};
