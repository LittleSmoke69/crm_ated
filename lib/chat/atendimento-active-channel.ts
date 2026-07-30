/**
 * Helpers compartilhados do Chat de Atendimento (seleção de canal ativo).
 */

export function isEvolutionChannelConnected(status: string | null | undefined): boolean {
  const s = String(status || '').toLowerCase();
  return s === 'open' || s === 'connected' || s === 'ok';
}

type EvolutionLike = {
  type: 'evolution';
  id: string;
  status?: string;
  is_chat_instance?: boolean;
};

type OfficialLike = {
  type: 'whatsapp_official';
  id: string;
};

/**
 * Canal que gerente/captador devem abrir automaticamente:
 * prioriza instância Evolution marcada para chat (is_chat_instance) e conectada,
 * depois qualquer Evolution de chat, depois Oficial, depois qualquer Evolution disponível.
 */
export function resolveActiveAtendimentoChannel<
  E extends EvolutionLike,
  O extends OfficialLike,
>(evolution: E[], official: O[]): E | O | null {
  const evo = Array.isArray(evolution) ? evolution : [];
  const wa = Array.isArray(official) ? official : [];

  const chatConnected = evo.find((c) => c.is_chat_instance && isEvolutionChannelConnected(c.status));
  if (chatConnected) return chatConnected;

  const chatAny = evo.find((c) => c.is_chat_instance);
  if (chatAny) return chatAny;

  const evoConnected = evo.find((c) => isEvolutionChannelConnected(c.status));
  if (evoConnected) return evoConnected;

  if (wa[0]) return wa[0];
  return evo[0] ?? null;
}

export function countConnectedEvolutionInstances(
  evolution: Array<{ status?: string }> | null | undefined
): number {
  return (evolution || []).filter((c) => isEvolutionChannelConnected(c.status)).length;
}
