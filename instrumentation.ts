/**
 * Instrumentação do servidor Next.js — roda UMA VEZ ao iniciar o processo Node.
 * Adequado para VPS/PM2/Docker onde há um único processo long-lived.
 * NÃO use em serverless (Netlify/Vercel) — cada invocação cria novo processo.
 *
 * Variáveis (flow-question):
 * - FLOW_QUESTION_POLL_ENABLED=true
 * - FLOW_QUESTION_POLL_INTERVAL_MS=1000  (padrão 1000ms)
 * - URL | SITE_URL | NEXT_PUBLIC_SITE_URL
 * - CRON_SECRET | INTERNAL_CRON_SECRET
 *
 * Variáveis (maturation ticker):
 * - MATURATION_TICK_ENABLED=true         ← ativa o loop do maturador mesh
 * - MATURATION_TICK_INTERVAL_MS=30000    ← intervalo entre ticks (padrão 30s)
 */

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  // ── Flow-question timeout poller ────────────────────────────────────────────
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

  // ── Maturation mesh ticker ──────────────────────────────────────────────────
  // Roda runMaturationTick diretamente no processo Node — sem HTTP, sem cron externo.
  // Ative com MATURATION_TICK_ENABLED=true no .env do VPS.
  if (process.env.MATURATION_TICK_ENABLED === 'true') {
    const tickIntervalMs = Math.max(
      15_000,
      parseInt(process.env.MATURATION_TICK_INTERVAL_MS || '30000', 10) || 30_000
    );

    const { runMaturationTick } = await import('./lib/services/maturation/processor');
    const { supabaseServiceRole } = await import('./lib/services/supabase-service');

    // Loop da maturação mútua (mesh)
    let tickRunning = false;
    const runTick = async () => {
      if (tickRunning) return;
      tickRunning = true;
      try {
        await runMaturationTick(supabaseServiceRole);
      } catch (e) {
        console.error('[instrumentation] maturation-tick erro:', e instanceof Error ? e.message : e);
      } finally {
        tickRunning = false;
      }
    };

    // Aguarda 5s para o app terminar de inicializar
    setTimeout(runTick, 5_000);
    setInterval(runTick, tickIntervalMs);

    console.log(`[instrumentation] Maturation ticker ativo: intervalo ${tickIntervalMs}ms`);
  }

  // ── Group messaging ticker ──────────────────────────────────────────────────
  // Sempre roda no processo Node (independente de MATURATION_TICK_ENABLED).
  // Envia estrofes de João de Santo Cristo ao grupo de maturação a cada 30s.
  {
    const { runGroupMessaging } = await import('./lib/services/maturation/processor');
    const { supabaseServiceRole } = await import('./lib/services/supabase-service');

    let groupRunning = false;
    const runGroup = async () => {
      if (groupRunning) return;
      groupRunning = true;
      try {
        await runGroupMessaging(supabaseServiceRole);
      } catch (e) {
        console.error('[instrumentation] group-messaging erro:', e instanceof Error ? e.message : e);
      } finally {
        groupRunning = false;
      }
    };

    // Aguarda 15s para o app terminar de inicializar antes do primeiro disparo
    setTimeout(runGroup, 15_000);
    setInterval(runGroup, 30_000);

    console.log('[instrumentation] Group messaging ativo: intervalo 30s');
  }
}
