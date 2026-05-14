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
 * Ordem de tentativa para o contato `contactIndex`: começa em `contactIndex % n`
 * e percorre o restante da rotação (sem repetir o mesmo `id`).
 */
export function orderedBroadcastInstanceIds(
  rotation: { id: string; name?: string }[],
  contactIndex: number
): string[] {
  if (!Array.isArray(rotation) || rotation.length === 0) return [];
  const n = rotation.length;
  const start = Math.max(0, Math.floor(contactIndex)) % n;
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
