/**
 * Unifica conversas Evolution do mesmo contato (várias instâncias) para o Chat Atendimento.
 * Prioriza a linha da instância selecionada (canal ativo) para alinhar histórico ao número que envia.
 */

export type MergeableEvolutionConversation = {
  id: string;
  remote_jid: string;
  is_group: boolean;
  last_message_at: string;
  instance_id?: string | null;
};

function privateChatDigitsKey(remoteJid: string, isGroup: boolean): string | null {
  if (isGroup) return null;
  const d = String(remoteJid || '')
    .replace(/@s\.whatsapp\.net$/i, '')
    .replace(/\D/g, '');
  return d.length >= 8 ? d : null;
}

function lastMessageTs(c: MergeableEvolutionConversation): number {
  return new Date(c.last_message_at || 0).getTime();
}

export function mergeEvolutionConversationsForAtendimento<T extends MergeableEvolutionConversation>(
  listsByInstance: Map<string, T[]>,
  preferredInstanceId: string
): T[] {
  const standalone: T[] = [];
  const byPhone = new Map<string, T[]>();

  for (const [, list] of listsByInstance) {
    for (const c of list) {
      if (c.is_group) {
        standalone.push(c);
        continue;
      }
      const k = privateChatDigitsKey(c.remote_jid, false);
      if (!k) {
        standalone.push(c);
        continue;
      }
      const arr = byPhone.get(k) ?? [];
      arr.push(c);
      byPhone.set(k, arr);
    }
  }

  const pickPrivate = (arr: T[]): T => {
    if (arr.length === 1) return arr[0];
    const onPreferred = arr.filter((c) => c.instance_id === preferredInstanceId);
    const pool = onPreferred.length > 0 ? onPreferred : arr;
    return [...pool].sort((a, b) => lastMessageTs(b) - lastMessageTs(a))[0];
  };

  const mergedPrivates = [...byPhone.values()].map(pickPrivate);
  const all = [...mergedPrivates, ...standalone];
  return all.sort((a, b) => lastMessageTs(b) - lastMessageTs(a));
}
