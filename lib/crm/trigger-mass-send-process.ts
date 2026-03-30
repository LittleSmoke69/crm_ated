/**
 * Dispara o worker de mass-send em background (mesma origem + CRON_SECRET).
 * Não importa `next/server` aqui — use triggerMassSendProcessChained nas routes quando precisar de after().
 */

export function triggerMassSendProcessFromOrigin(origin: string): void {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.warn('[MASS-SEND] CRON_SECRET ausente — worker de disparo em massa não será acionado.');
    return;
  }
  const base = origin.replace(/\/$/, '');
  const processUrl = `${base}/api/crm/activations/mass-send/process`;
  void fetch(processUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-cron-secret': cronSecret,
    },
  })
    .then(async (res) => {
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        console.warn(
          `[MASS-SEND] Trigger respondeu ${res.status} ${res.statusText} | URL=${processUrl} | corpo=${text.slice(0, 400)}`
        );
      }
    })
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[MASS-SEND] Trigger fetch falhou | URL=${processUrl} | ${msg}`);
    });
}
