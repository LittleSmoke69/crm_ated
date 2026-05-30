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

export type ConsultantAllLeadIdsResult = {
  allIds: Set<string>;
  counts: { no: number; yes: number; total: number };
  partial: boolean;
};

async function paginateIndicatedIdsByFilter(
  client: ReturnType<typeof createCrmRedistributionClient>,
  consultantEmail: string,
  transferredFilter: 'yes' | 'no'
): Promise<{ ids: Set<string>; partial: boolean }> {
  const ids = new Set<string>();
  const perPage = 2000;
  const maxPages = 100;
  let partial = false;
  for (let page = 1; page <= maxPages; page += 1) {
    const res = await client.getIndicatedsByConsultant(consultantEmail, perPage, page, {
      transferredFilter,
      sort: 'created_at',
      direction: 'desc',
    });
    if (!res.success || !Array.isArray(res.data)) {
      partial = true;
      break;
    }
    for (const lead of res.data) {
      if (lead?.id != null) ids.add(leadIdMatchKey(lead.id));
    }
    const lastPage = res.pagination?.last_page;
    const current = res.pagination?.current_page ?? page;
    if (typeof lastPage === 'number' && current >= lastPage) break;
    if (res.data.length < perPage) break;
    if (page === maxPages) partial = true;
  }
  return { ids, partial };
}

/** Carteira completa no CRM: union de transferred_filter=no e yes (padrão «Todos os leads» para rastreamento). */
export async function buildConsultantAllLeadIds(
  client: ReturnType<typeof createCrmRedistributionClient>,
  consultantEmail: string
): Promise<ConsultantAllLeadIdsResult> {
  const [noRes, yesRes] = await Promise.all([
    paginateIndicatedIdsByFilter(client, consultantEmail, 'no'),
    paginateIndicatedIdsByFilter(client, consultantEmail, 'yes'),
  ]);
  const allIds = new Set<string>([...noRes.ids, ...yesRes.ids]);
  return {
    allIds,
    counts: { no: noRes.ids.size, yes: yesRes.ids.size, total: allIds.size },
    partial: noRes.partial || yesRes.partial,
  };
}

export async function buildLeadIdSetUnderConsultant(
  client: ReturnType<typeof createCrmRedistributionClient>,
  consultantEmail: string
): Promise<Set<string>> {
  const { allIds } = await buildConsultantAllLeadIds(client, consultantEmail);
  return allIds;
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
