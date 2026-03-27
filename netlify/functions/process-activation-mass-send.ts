/**
 * Netlify Scheduled Function: process-activation-mass-send
 *
 * Roda a cada 1 minuto (configurado no netlify.toml).
 * Executa múltiplos lotes por invocação (loop interno) para drenar a fila mais rápido,
 * simulando frequência sub-minuto já que o Netlify não suporta crons abaixo de 1 minuto.
 *
 * Lógica:
 * - Chama /api/crm/activations/mass-send/process repetidamente até o orçamento de tempo esgotar
 *   ou até não haver mais jobs pendentes.
 * - Orçamento: MAX_LOOP_MS (deixa buffer de segurança antes do timeout da função).
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

/** Número máximo de iterações por invocação. */
const MAX_ITERATIONS = 5;
/** Orçamento total em ms (timeout da função é 120s; usamos 110s como teto seguro). */
const MAX_LOOP_MS = 110_000;

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
  const startTime = Date.now();
  const results: unknown[] = [];

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const elapsed = Date.now() - startTime;
    if (elapsed >= MAX_LOOP_MS) {
      console.log(`[process-activation-mass-send] Orçamento de tempo esgotado após ${i} iterações (${elapsed}ms)`);
      break;
    }

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
      /** Resposta pode vir com espaços de heartbeat antes do JSON (evita Inactivity Timeout em proxies). */
      const trimmed = text.trimStart();
      const jsonStart = trimmed.indexOf('{');
      body = text;
      if (jsonStart >= 0) {
        try {
          body = JSON.parse(trimmed.slice(jsonStart));
        } catch {
          // mantém texto bruto
        }
      }

      if (!res.ok) {
        console.error(`[process-activation-mass-send] Iteração ${i + 1}: API retornou ${res.status}`, text);
        results.push({ iteration: i + 1, ok: false, status: res.status, body });
        break; // erro de infra — para o loop
      }

      results.push({ iteration: i + 1, ok: true, body });

      // Se não havia job pendente, não há razão para continuar iterando
      const bodyObj = body as Record<string, unknown>;
      const data = bodyObj?.data as Record<string, unknown> | undefined;
      if (data?.processed === false) {
        console.log(`[process-activation-mass-send] Nenhum job pendente na iteração ${i + 1}. Encerrando loop.`);
        break;
      }
    } catch (err: unknown) {
      console.error(`[process-activation-mass-send] Iteração ${i + 1}: erro ao chamar API:`, err);
      results.push({ iteration: i + 1, ok: false, error: String(err) });
      break; // erro de rede — para o loop
    }
  }

  const totalMs = Date.now() - startTime;
  console.log(`[process-activation-mass-send] Concluído: ${results.length} iterações em ${totalMs}ms`);

  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true, iterations: results.length, elapsed_ms: totalMs, results }),
    headers: { 'Content-Type': 'application/json' },
  };
};
