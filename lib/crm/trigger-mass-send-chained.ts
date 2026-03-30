/**
 * Um único POST ao worker — evita rajadas concorrentes (antes: imediato + after + delay).
 * Não chamar de dentro de ReadableStream — use o padrão com chainState na route de process.
 */
import { triggerMassSendProcessFromOrigin } from '@/lib/crm/trigger-mass-send-process';

export function triggerMassSendProcessChained(origin: string): void {
  triggerMassSendProcessFromOrigin(origin);
}
