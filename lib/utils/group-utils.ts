/**
 * Normaliza o group_id do WhatsApp para formato consistente.
 * Evita duplicatas causadas por variações (ex: com/sem @g.us, espaços, etc.)
 * Regra: mesma instância + mesmo grupo = um único registro no banco.
 */
export function normalizeGroupId(groupId: string | null | undefined): string {
  if (!groupId || typeof groupId !== 'string') return '';
  let id = groupId.trim();
  if (!id) return '';
  // WhatsApp group JIDs sempre terminam em @g.us
  if (!id.endsWith('@g.us')) {
    // Se for numérico ou formato 123456789-1234567890, adiciona sufixo
    if (/^[\d\-]+$/.test(id) || /^[\d\-]+@?$/.test(id)) {
      id = id.replace(/@$/, '') + '@g.us';
    }
  }
  return id;
}

/**
 * Deduplica grupos por (instance_name, group_id).
 * Mantém apenas o primeiro de cada par (instance, group) para evitar bugs visuais.
 */
export function deduplicateGroupsByInstance<T extends { instance_name?: string; group_id: string }>(
  groups: T[]
): T[] {
  const seen = new Map<string, T>();
  for (const g of groups) {
    const instanceName = g.instance_name ?? '';
    const key = `${instanceName}::${g.group_id}`;
    if (!seen.has(key)) {
      seen.set(key, g);
    }
  }
  return Array.from(seen.values());
}

/**
 * Deduplica grupos que não têm instance_name (ex: resultado de select simples)
 * usando apenas group_id.
 */
export function deduplicateGroupsById<T extends { group_id: string }>(groups: T[]): T[] {
  const seen = new Map<string, T>();
  for (const g of groups) {
    const key = normalizeGroupId(g.group_id);
    if (key && !seen.has(key)) {
      seen.set(key, g);
    }
  }
  return Array.from(seen.values());
}
