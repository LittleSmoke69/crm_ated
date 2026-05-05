import type { Lead } from '@/components/CRM/types';

/**
 * Monta o texto "Colunas CRM" por lead a partir dos buckets do quadro (mesma lógica das colunas na tela).
 */
export function buildCrmColumnLabelsMap(
  colLeads: Record<string, Lead[]>,
  columnTitleById: Record<string, string>
): Map<string, string> {
  const map = new Map<string, string>();
  for (const [colId, leads] of Object.entries(colLeads)) {
    const label = columnTitleById[colId] ?? colId;
    for (const l of leads) {
      const id = String(l.id);
      const prev = map.get(id);
      map.set(id, prev ? `${prev} | ${label}` : label);
    }
  }
  return map;
}

/** Mantém só leads que aparecem em pelo menos uma coluna do CRM após filtros (alinha CSV ao quadro). */
export function filterLeadsAssignedToCrmColumns(
  formattedLeads: Lead[],
  columnLabels: Map<string, string>
): Lead[] {
  return formattedLeads.filter((l) => columnLabels.has(String(l.id)));
}
