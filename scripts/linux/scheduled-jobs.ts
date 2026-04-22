export type ScheduledJob = {
  name: string;
  cron: string;
};

/**
 * Fonte única dos agendamentos em produção na VPS (crontab via install-linux-cron).
 * Espelha ainda o netlify.toml legado; CRON_TZ=UTC no Linux preserva a mesma semântica de horários.
 */
export const SCHEDULED_JOBS: ScheduledJob[] = [
  { name: 'process-campaign-queue', cron: '*/1 * * * *' },
  { name: 'process-message-queue', cron: '*/1 * * * *' },
  { name: 'process-activation-mass-send', cron: '*/1 * * * *' },
  { name: 'process-broadcast-queue', cron: '*/1 * * * *' },
  { name: 'check-instances-status', cron: '*/5 * * * *' },
  { name: 'process-group-fetch-jobs', cron: '*/1 * * * *' },
  { name: 'audit-group-names-sync', cron: '*/1 * * * *' },
  { name: 'academy-vturb-snapshots', cron: '0 2 * * *' },
  { name: 'transfer-expired-notify', cron: '0 8 * * *' },
  { name: 'transfer-resolve-expired', cron: '*/10 * * * *' },
  { name: 'maturation-tick', cron: '*/1 * * * *' },
  { name: 'flow-question-timeouts', cron: '*/1 * * * *' },
  { name: 'anti-spam-group-scanner', cron: '*/1 * * * *' },
];

export const SCHEDULED_JOB_NAMES = new Set(SCHEDULED_JOBS.map((job) => job.name));
