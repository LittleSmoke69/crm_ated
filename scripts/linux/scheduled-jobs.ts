export type ScheduledJob = {
  /** Nome do handler em netlify/functions/<name>.ts */
  name: string;
  /** Expressão cron (5 campos, fuso UTC). */
  cron: string;
  /**
   * Timeout duro em segundos. Quando ausente, o wrapper infere a partir do
   * schedule (~ N*60 - 10s para "*​/N * * * *"). Defina explicitamente para
   * jobs cujo tempo realista divirja do default.
   */
  timeout_s?: number;
};

/**
 * Fonte única dos agendamentos em produção na VPS (crontab via install-linux-cron).
 * CRON_TZ=UTC no Linux preserva a semântica de horários em qualquer fuso da VPS.
 *
 * Cada job é executado por scripts/linux/cron-wrapper.sh, que garante:
 *   - lock exclusivo (jobs lentos não disparam em paralelo)
 *   - timeout duro (job nunca segura o lock indefinidamente)
 *   - log estruturado [START]/[END]/[SKIP]/[TIMEOUT] no /var/log/zaploto-cron.log
 */
export const SCHEDULED_JOBS: ScheduledJob[] = [
  // ── Pipelines de envio em massa (acessam Supabase direto) ──────────────────
  // Cada um processa um lote por minuto. Locks via scheduled_at + locked_by no banco.
  { name: 'process-campaign-queue',     cron: '*/1 * * * *' },
  { name: 'process-message-queue',      cron: '*/1 * * * *' },
  { name: 'process-broadcast-queue',    cron: '*/1 * * * *' },
  { name: 'process-activation-mass-send', cron: '*/1 * * * *' },

  // ── Manutenção de instâncias Evolution ─────────────────────────────────────
  { name: 'check-instances-status',     cron: '*/5 * * * *' },

  // ── Grupos: fetch e auditoria ──────────────────────────────────────────────
  { name: 'process-group-fetch-jobs',   cron: '*/1 * * * *' },
  { name: 'audit-group-names-sync',     cron: '*/1 * * * *' },

  // ── Maturação ──────────────────────────────────────────────────────────────
  // Backup HTTP do ticker in-process (instrumentation.ts no app1).
  // Em caso de app1 down, o cron mantém maturação rodando via API.
  { name: 'maturation-tick',            cron: '*/1 * * * *' },

  // ── Flows ─────────────────────────────────────────────────────────────────
  { name: 'flow-question-timeouts',     cron: '*/1 * * * *' },

  // ── Anti-spam (scanner de grupos; worker em tempo real roda em container próprio) ──
  { name: 'anti-spam-group-scanner',    cron: '*/1 * * * *' },

  // ── Transferências de leads ────────────────────────────────────────────────
  { name: 'transfer-resolve-expired',   cron: '*/10 * * * *' },
  // Notificação diária — 8h UTC = 5h BRT.
  { name: 'transfer-expired-notify',    cron: '0 8 * * *' },

  // ── Snapshots VTurb (academy) — diário 2h UTC ──────────────────────────────
  // Timeout maior: snapshot completo pode ler muitos vídeos.
  { name: 'academy-vturb-snapshots',    cron: '0 2 * * *', timeout_s: 900 },
];

export const SCHEDULED_JOB_NAMES = new Set(SCHEDULED_JOBS.map((job) => job.name));
