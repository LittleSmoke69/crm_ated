/**
 * Instrumentação do servidor Next.js — roda UMA VEZ ao iniciar o processo Node.
 * Adequado para VPS/PM2/Docker onde há um único processo long-lived.
 * NÃO use em serverless (Netlify/Vercel) — cada invocação cria novo processo.
 *
 * Leader election: rotinas in-process só rodam em UMA réplica (IS_TICKER_LEADER=true).
 * Hoje a única rotina ativa é o poller opcional de flow-question. O ticker do
 * maturador foi removido daqui — agora roda exclusivamente pelo cron container
 * (scripts/linux/scheduled-jobs.ts → /api/maturation/cron-tick), evitando:
 *   - sobreposição entre ticker (30s) e cron (60s) competindo por claim_maturation_steps
 *   - race condition em runGroupMessaging (sem lock cross-process)
 *   - carga extra de CPU disputada com o servidor HTTP do Next
 *
 * Variáveis (flow-question):
 * - FLOW_QUESTION_POLL_ENABLED=true
 * - FLOW_QUESTION_POLL_INTERVAL_MS=1000  (padrão 1000ms)
 * - URL | SITE_URL | NEXT_PUBLIC_SITE_URL
 * - CRON_SECRET | INTERNAL_CRON_SECRET
 *
 * Variáveis (leader election):
 * - IS_TICKER_LEADER=true                ← se ausente, rotinas in-process não iniciam
 */

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const isTickerLeader = process.env.IS_TICKER_LEADER === 'true';
  if (!isTickerLeader) {
    console.log('[instrumentation] IS_TICKER_LEADER!=true — rotinas in-process desabilitadas nesta réplica');
    return;
  }

  console.log('[instrumentation] IS_TICKER_LEADER=true — iniciando rotinas in-process');

  // ── Flow-question timeout poller (opcional) ────────────────────────────────
  // Útil quando se quer reagir a timeouts em < 1min. O cron equivalente
  // (flow-question-timeouts a cada 1min) cobre o caso geral.
  if (process.env.FLOW_QUESTION_POLL_ENABLED === 'true') {
    const intervalMs = Math.max(
      1000,
      parseInt(process.env.FLOW_QUESTION_POLL_INTERVAL_MS || '1000', 10) || 1000
    );
    const baseUrl =
      process.env.URL ||
      process.env.SITE_URL ||
      process.env.NEXT_PUBLIC_SITE_URL ||
      '';
    const secret = process.env.CRON_SECRET || process.env.INTERNAL_CRON_SECRET;

    if (!baseUrl.trim() || !secret) {
      console.warn(
        '[instrumentation] FLOW_QUESTION_POLL_ENABLED: defina URL/SITE_URL/NEXT_PUBLIC_SITE_URL e CRON_SECRET'
      );
    } else {
      const url = `${baseUrl.replace(/\/$/, '')}/api/internal/cron/flow-question-timeouts?token=${encodeURIComponent(secret)}`;
      const tick = () => {
        fetch(url, { method: 'GET', cache: 'no-store' }).catch((err) =>
          console.error('[instrumentation] flow-question-timeouts poll:', err)
        );
      };
      tick();
      setInterval(tick, intervalMs);
      console.log(
        `[instrumentation] Polling flow-question-timeouts a cada ${intervalMs}ms → ${url.split('?')[0]}`
      );
    }
  }
}
