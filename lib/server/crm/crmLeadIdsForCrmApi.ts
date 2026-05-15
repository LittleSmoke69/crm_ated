/**
 * Normalização de IDs de lead para chamadas ao CRM (redistribute / get-indicateds).
 */

import { createCrmRedistributionClient } from '@/lib/server/crm/crmRedistributionClient';

/** Chave estável para comparar id de lead entre CRM redistribute e get-indicateds (inclui sufixo após `-`). */
export function leadIdMatchKey(id: number | string): string {
  if (typeof id === 'number' && Number.isFinite(id)) return String(Math.trunc(id));
  const s = String(id).trim();
  const asNum = Number(s);
  if (s !== '' && Number.isFinite(asNum) && String(asNum) === s) return String(Math.trunc(asNum));
  if (s.includes('-')) {
    const last = s.split('-').pop() ?? '';
    const n = Number(last);
    if (Number.isFinite(n) && n > 0) return String(Math.trunc(n));
  }
  return s;
}

export async function buildLeadIdSetUnderConsultant(
  client: ReturnType<typeof createCrmRedistributionClient>,
  consultantEmail: string
): Promise<Set<string>> {
  const set = new Set<string>();
  const perPage = 2000;
  const maxPages = 100;
  for (let page = 1; page <= maxPages; page += 1) {
    const res = await client.getIndicatedsByConsultant(consultantEmail, perPage, page);
    if (!res.success || !Array.isArray(res.data)) break;
    for (const lead of res.data) {
      if (lead?.id != null) set.add(leadIdMatchKey(lead.id));
    }
    const lastPage = res.pagination?.last_page;
    const current = res.pagination?.current_page ?? page;
    if (typeof lastPage === 'number' && current >= lastPage) break;
    if (res.data.length < perPage) break;
  }
  return set;
}

/** Formato esperado pelo POST redistribute-leads (número quando possível). */
export function normalizeCrmLeadIdForRedistribute(id: number | string): number | string {
  if (typeof id === 'number' && Number.isFinite(id)) return id;
  const s = String(id).trim();
  if (!s.includes('-')) {
    const n = Number(s);
    return s !== '' && Number.isFinite(n) ? n : s;
  }
  const last = s.split('-').pop() ?? '';
  const n = Number(last);
  return Number.isFinite(n) && n > 0 ? n : s;
}
