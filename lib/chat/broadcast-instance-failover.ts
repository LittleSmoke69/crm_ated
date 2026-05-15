import { messageIndicatesEvolutionSessionDropped } from '@/lib/evolution/mark-instance-disconnected';

/** Erros em que faz sentido tentar outra instância Evolution na rotação do disparo. */
export function broadcastSendErrorIsInstanceUnreachable(message: string): boolean {
  const msg = String(message || '');
  return (
    messageIndicatesEvolutionSessionDropped(msg) ||
    /timeout|ECONNREFUSED|ENOTFOUND|network|socket|offline|disconnected/i.test(msg)
  );
}

/**
 * Ordem de tentativa para o contato `contactIndex`:
 * Com rotationSize=1 (padrão), troca de instância a cada contato (round-robin).
 * Com rotationSize=N, cada instância envia para N contatos antes de alternar.
 */
export function orderedBroadcastInstanceIds(
  rotation: { id: string; name?: string }[],
  contactIndex: number,
  rotationSize = 1
): string[] {
  if (!Array.isArray(rotation) || rotation.length === 0) return [];
  const n = rotation.length;
  const size = Math.max(1, Math.floor(rotationSize));
  const start = Math.floor(Math.max(0, contactIndex) / size) % n;
  const seen = new Set<string>();
  const out: string[] = [];
  for (let k = 0; k < n; k++) {
    const id = rotation[(start + k) % n]?.id;
    if (typeof id === 'string' && id.length > 0 && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}
