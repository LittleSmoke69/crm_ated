/**
 * Disparo imediato + segundo POST após delay (backup). Usa `after()` do Next em contexto de Route Handler.
 * Não chamar de dentro de ReadableStream — use o padrão com chainState na route de process.
 */
import { after } from 'next/server';
import { triggerMassSendProcessFromOrigin } from '@/lib/crm/trigger-mass-send-process';

const DEFAULT_CHAIN_FOLLOWUP_MS = 4_500;

export function triggerMassSendProcessChained(
  origin: string,
  followUpMs = DEFAULT_CHAIN_FOLLOWUP_MS
): void {
  triggerMassSendProcessFromOrigin(origin);
  try {
    after(() => {
      setTimeout(() => triggerMassSendProcessFromOrigin(origin), followUpMs);
    });
  } catch {
    setTimeout(() => triggerMassSendProcessFromOrigin(origin), followUpMs);
  }
}
