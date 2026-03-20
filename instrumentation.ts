/**
 * Opcional: chama o endpoint de timeouts do nó "Pergunta" em intervalo fixo (ex.: a cada 1 segundo).
 * Ative apenas em ambiente com **um único processo Node** long-lived (Docker/PM2/VPS).
 * Em serverless (Netlify/Vercel) podem existir várias instâncias — prefira cron externo a cada 1s.
 *
 * Variáveis:
 * - FLOW_QUESTION_POLL_ENABLED=true
 * - FLOW_QUESTION_POLL_INTERVAL_MS=1000  (padrão 1000 = 1 segundo)
 * - URL ou SITE_URL ou NEXT_PUBLIC_SITE_URL (base do site)
 * - CRON_SECRET ou INTERNAL_CRON_SECRET
 */

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const enabled = process.env.FLOW_QUESTION_POLL_ENABLED === 'true';
  if (!enabled) return;

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
    return;
  }

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
