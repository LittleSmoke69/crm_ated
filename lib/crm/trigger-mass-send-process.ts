/**
 * Dispara o worker de mass-send em background (mesma origem + CRON_SECRET).
 */
export function triggerMassSendProcessFromOrigin(origin: string): void {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.warn('[MASS-SEND] CRON_SECRET ausente — worker de disparo em massa não será acionado.');
    return;
  }
  const base = origin.replace(/\/$/, '');
  const processUrl = `${base}/api/crm/activations/mass-send/process`;
  fetch(processUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-cron-secret': cronSecret,
    },
  }).catch((err) => {
    console.warn('[MASS-SEND] Trigger do process falhou:', err?.message);
  });
}
