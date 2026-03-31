/**
 * Variantes de event_type que a Evolution (e proxies) podem gravar em evolution_webhook_events
 * para mudança de participantes em grupo (add/remove/promote/demote).
 * Manter em um único lugar: listagens e dedup devem considerar o mesmo conjunto.
 */
export const EVOLUTION_GROUP_PARTICIPANT_EVENT_TYPES: string[] = [
  'GROUP_PARTICIPANTS_UPDATE',
  'group-participants.update',
  'group-participants-update',
];

/** Normaliza para comparação: group.participants.update */
export function normalizeEvolutionGroupParticipantEventType(eventType: string): string {
  return String(eventType || '')
    .toLowerCase()
    .replace(/_/g, '.')
    .replace(/-/g, '.');
}

export function isEvolutionGroupParticipantEventType(eventType: string): boolean {
  return normalizeEvolutionGroupParticipantEventType(eventType) === 'group.participants.update';
}
