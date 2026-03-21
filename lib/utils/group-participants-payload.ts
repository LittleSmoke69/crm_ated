/**
 * Extrai action (add | remove | promote | demote, etc.) do payload Evolution
 * para eventos group-participants / GROUP_PARTICIPANTS_UPDATE.
 * Nunca assume 'add' por padrão — ausência retorna null.
 */
export function extractGroupParticipantAction(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  const data = (p.data as Record<string, unknown>) ?? p;
  const update = data.update as Record<string, unknown> | undefined;

  const candidates: unknown[] = [
    data.action,
    p.action,
    update?.action,
    (data as { participant?: { action?: unknown } }).participant?.action,
  ];

  for (const c of candidates) {
    if (c != null && String(c).trim() !== '') {
      return String(c).trim().toLowerCase();
    }
  }
  return null;
}
