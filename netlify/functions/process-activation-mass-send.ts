/**
 * Netlify Scheduled Function: process-activation-mass-send
 *
 * Roda a cada 1 min (mín. Netlify). Timeout: 120s.
 * Cada iteração chama a API route que processa EXATAMENTE 1 grupo.
 * O delay de 1s entre grupos é aplicado aqui entre as chamadas.
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

function parseProcessBody(text: string): unknown {
  const trimmed = text.trimStart();
  const jsonStart = trimmed.indexOf('{');
  if (jsonStart < 0) return text;
  try {
    return JSON.parse(trimmed.slice(jsonStart));
  } catch {
    return text;
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

  while (Date.now() - startTime < MAX_LOOP_MS) {
    iteration++;

    try {
      const res = await fetch(processUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-cron-secret': cronSecret,
        },
      });

      const text = await res.text();
      const body = parseProcessBody(text) as Record<string, unknown>;
      const data = body?.data as Record<string, unknown> | undefined;

      if (!res.ok) {
        console.error(`[mass-send-cron] #${iteration} API ${res.status}:`, text.slice(0, 200));
        break;
      }

      // Nenhum job na fila → encerra
      if (data?.processed === false) {
        const msg = String(data?.message ?? '').toLowerCase();
        if (msg.includes('nenhum job')) {
          console.log(`[mass-send-cron] Fila vazia. ${iteration} iterações, ${totalSent} OK, ${totalFailed} falha.`);
          break;
        }
        // Lock ocupado por outro worker → aguarda e tenta de novo
        if (msg.includes('lock')) {
          console.log(`[mass-send-cron] #${iteration} lock ocupado, aguardando 2s…`);
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }
        // Outro caso de processed=false
        console.log(`[mass-send-cron] #${iteration} processed=false: ${data?.message}`);
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }

      // Processou 1 grupo
      if (data?.processed === true) {
        totalSent += Number(data.sent ?? 0);
        totalFailed += Number(data.failed ?? 0);

        const status = data.status;
        const idx = data.current_index;
        const total = data.total;

        // Campanha pausada → para
        if (status === 'paused') {
          console.log(`[mass-send-cron] Job pausado. ${iteration} iterações, ${totalSent} OK, ${totalFailed} falha.`);
          break;
        }

        // Campanha concluída → verifica se há outro job
        if (status === 'completed') {
          console.log(`[mass-send-cron] Job concluído [${idx}/${total}]. Verificando próximo job…`);
          await new Promise((r) => setTimeout(r, INTER_GROUP_DELAY_MS));
          continue;
        }

        // Ainda tem mais grupos → delay de 1s e próximo
        if (data.more_pending) {
          console.log(`[mass-send-cron] #${iteration} [${idx}/${total}] OK. Próximo em ${INTER_GROUP_DELAY_MS}ms…`);
          await new Promise((r) => setTimeout(r, INTER_GROUP_DELAY_MS));
          continue;
        }
      }

      // Fallback: aguarda e tenta
      await new Promise((r) => setTimeout(r, INTER_GROUP_DELAY_MS));
    } catch (err: unknown) {
      console.error(`[mass-send-cron] #${iteration} erro:`, err);
      // Erro de rede → tenta de novo após 3s
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  const totalMs = Date.now() - startTime;
  console.log(`[mass-send-cron] Concluído: ${iteration} iterações em ${Math.round(totalMs / 1000)}s | ${totalSent} OK, ${totalFailed} falha`);

  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true, iterations: iteration, elapsed_ms: totalMs, sent: totalSent, failed: totalFailed }),
    headers: { 'Content-Type': 'application/json' },
  };
};
