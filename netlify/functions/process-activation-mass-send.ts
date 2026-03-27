/**
 * Netlify Scheduled Function: process-activation-mass-send
 *
 * O agendamento Netlify é no mínimo 1/min. A frequência em segundos vem do polling aqui:
 * entre chamadas a /api/crm/activations/mass-send/process enquanto houver fila (env MASS_SEND_CRON_POLL_INTERVAL_MS).
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

function resolvePollIntervalMs(): number {
  const raw = process.env.MASS_SEND_CRON_POLL_INTERVAL_MS;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 2000;
  return Math.min(30_000, Math.max(500, Math.floor(n)));
}

/** Orçamento total em ms (timeout da função é 120s; usamos 110s como teto seguro). */
const MAX_LOOP_MS = 110_000;

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
  const pollMs = resolvePollIntervalMs();

  if (!siteUrl || !cronSecret) {
    console.warn('[process-activation-mass-send] URL ou CRON_SECRET não configurados');
    return {
      statusCode: 200,
      body: JSON.stringify({ ok: false, message: 'Configuração ausente' }),
      headers: { 'Content-Type': 'application/json' },
    };
  }

  const processUrl = `${siteUrl.replace(/\/$/, '')}/api/crm/activations/mass-send/process`;
  const startTime = Date.now();
  const results: unknown[] = [];
  let iteration = 0;

  while (Date.now() - startTime < MAX_LOOP_MS) {
    iteration++;
    let body: unknown;
    try {
      const res = await fetch(processUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-cron-secret': cronSecret,
        },
      });

      const text = await res.text();
      body = parseProcessBody(text);

      if (!res.ok) {
        console.error(`[process-activation-mass-send] Iteração ${iteration}: API retornou ${res.status}`, text);
        results.push({ iteration, ok: false, status: res.status, body });
        break;
      }

      results.push({ iteration, ok: true, body });

      const bodyObj = body as Record<string, unknown>;
      const data = bodyObj?.data as Record<string, unknown> | undefined;
      const msg = String(data?.message ?? '').toLowerCase();

      if (data?.processed === false) {
        if (msg.includes('nenhum job pendente') || msg.includes('nenhum job')) {
          console.log(`[process-activation-mass-send] Fila vazia na iteração ${iteration}. Encerrando.`);
          break;
        }
        if (msg.includes('já em processamento') || msg.includes('em processamento')) {
          console.log(`[process-activation-mass-send] Lock ocupado na iteração ${iteration}, aguardando 1,5s…`);
          await new Promise((r) => setTimeout(r, 1500));
          continue;
        }
        console.log(`[process-activation-mass-send] processed=false (${data?.message ?? ''}), aguardando ${pollMs}ms`);
        await new Promise((r) => setTimeout(r, pollMs));
        continue;
      }

      if (data?.processed === true) {
        const status = data.status;
        const deferred = data.follow_up_deferred === true;
        if (status === 'processing' || deferred) {
          console.log(
            `[process-activation-mass-send] Fila com trabalho restante (status=${String(status)} deferred=${deferred}), próximo poll em ${pollMs}ms`
          );
          await new Promise((r) => setTimeout(r, pollMs));
          continue;
        }
        if (status === 'completed') {
          console.log(`[process-activation-mass-send] Lote concluído na iteração ${iteration}, verificando se há outro job em ${pollMs}ms`);
          await new Promise((r) => setTimeout(r, pollMs));
          continue;
        }
        await new Promise((r) => setTimeout(r, pollMs));
        continue;
      }

      await new Promise((r) => setTimeout(r, pollMs));
    } catch (err: unknown) {
      console.error(`[process-activation-mass-send] Iteração ${iteration}: erro ao chamar API:`, err);
      results.push({ iteration, ok: false, error: String(err) });
      break;
    }
  }

  const totalMs = Date.now() - startTime;
  console.log(
    `[process-activation-mass-send] Concluído: ${results.length} iterações em ${totalMs}ms (poll=${pollMs}ms)`
  );

  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true, iterations: results.length, elapsed_ms: totalMs, poll_ms: pollMs, results }),
    headers: { 'Content-Type': 'application/json' },
  };
};
