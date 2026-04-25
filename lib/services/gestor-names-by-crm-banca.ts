/**
 * Nomes de gestores de tráfego por `crm_bancas.id`.
 *
 * No Zaploto real, muitos gestores têm `enroller` nulo e aparecem **apenas** em `user_bancas.banca_ids`.
 * Quando existe dono da banca com URL/nome alinhado ao CRM, também incluímos gestores na subárvore do dono.
 *
 * @see components/Admin/HierarchySection.tsx — normalizeBancaUrl
 */

import { supabaseServiceRole } from '@/lib/services/supabase-service';

export type CrmBancaLite = { id: string; name: string | null; url: string | null };

/** Mesma regra da UI de hierarquia para comparar URLs de banca. */
export function normalizeBancaUrlForCrmMatch(url?: string | null): string {
  if (!url) return '';
  let normalized = String(url).trim();
  normalized = normalized.replace(/^https?:\/\//i, '');
  normalized = normalized.replace(/\/api\/crm\/?/i, '');
  normalized = normalized.replace(/\/+$/, '');
  return normalized.trim().toLowerCase();
}

function normalizeBancaNameForMatch(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

async function listGestorNamesInOwnerSubtree(ownerId: string): Promise<string[]> {
  const names: string[] = [];
  const seen = new Set<string>();
  let frontier = [String(ownerId).trim()].filter(Boolean);
  const CHUNK = 80;

  async function fetchChildrenByEnrollers(enrollerIds: string[]) {
    const out: Array<{
      id: string;
      full_name?: string | null;
      email?: string | null;
      status?: string | null;
    }> = [];
    for (let i = 0; i < enrollerIds.length; i += CHUNK) {
      const slice = enrollerIds.slice(i, i + CHUNK);
      if (slice.length === 0) continue;
      const { data, error } = await supabaseServiceRole
        .from('profiles')
        .select('id, full_name, email, status, enroller')
        .in('enroller', slice);
      if (error) throw new Error(error.message);
      out.push(...((data ?? []) as typeof out));
    }
    return out;
  }

  for (let depth = 0; depth < 28 && frontier.length > 0; depth += 1) {
    const rows = await fetchChildrenByEnrollers(frontier);
    if (rows.length === 0) break;
    const next: string[] = [];
    for (const p of rows) {
      const id = String(p.id ?? '').trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      if (String(p.status ?? '') === 'gestor') {
        const label = String(p.full_name || p.email || '').trim();
        if (label && !names.includes(label)) names.push(label);
      }
      next.push(id);
    }
    frontier = next;
  }
  return names;
}

function mergeUniqueNames(...groups: string[][]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const g of groups) {
    for (const raw of g) {
      const n = String(raw ?? '').trim();
      if (!n || seen.has(n)) continue;
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

/**
 * Para cada `crm_bancas.id` em `bancaIds`, retorna lista de nomes (full_name ou email) dos gestores.
 * `bancaById` deve conter id → { name, url } (já carregado do CRM).
 */
export async function buildGestorNamesByCrmBancaIdMap(
  bancaIds: string[],
  bancaById: Map<string, CrmBancaLite>
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const ids = Array.from(new Set(bancaIds.map((s) => String(s ?? '').trim()).filter(Boolean)));
  if (ids.length === 0) return out;

  const idSet = new Set(ids);

  /** Todos os gestores (poucos registros) — evita `.in('id', …)` gigante a partir de user_bancas. */
  const { data: allGestores, error: gestErr } = await supabaseServiceRole
    .from('profiles')
    .select('id, full_name, email, status')
    .eq('status', 'gestor');
  if (gestErr) throw new Error(gestErr.message);

  const gestorLabelById = new Map<string, string>();
  const gestorIdSet = new Set<string>();
  for (const p of allGestores ?? []) {
    const id = String((p as { id: string }).id ?? '').trim();
    if (!id) continue;
    gestorIdSet.add(id);
    const label = String((p as { full_name?: string | null }).full_name || (p as { email?: string | null }).email || '').trim();
    if (label) gestorLabelById.set(id, label);
  }

  const namesFromUserBancasByBanca = new Map<string, string[]>();
  const { data: userBancasRows, error: userBancasErr } = await supabaseServiceRole
    .from('user_bancas')
    .select('user_id, banca_ids');
  if (userBancasErr) throw new Error(userBancasErr.message);

  for (const row of userBancasRows ?? []) {
    const userId = String((row as { user_id?: string | null }).user_id ?? '').trim();
    if (!userId || !gestorIdSet.has(userId)) continue;
    const label = gestorLabelById.get(userId);
    if (!label) continue;
    const bancaIdsRow = Array.isArray((row as { banca_ids?: unknown }).banca_ids)
      ? ((row as { banca_ids: unknown[] }).banca_ids ?? []).map((x) => String(x ?? '').trim()).filter(Boolean)
      : [];
    for (const bid of bancaIdsRow) {
      if (!idSet.has(bid)) continue;
      const cur = namesFromUserBancasByBanca.get(bid) ?? [];
      if (!cur.includes(label)) cur.push(label);
      namesFromUserBancasByBanca.set(bid, cur);
    }
  }

  const { data: ownersRows, error: ownersErr } = await supabaseServiceRole
    .from('profiles')
    .select('id, banca_name, banca_url, status')
    .eq('status', 'dono_banca');
  if (ownersErr) throw new Error(ownersErr.message);

  const ownerByBancaId = new Map<string, string>();
  for (const bid of ids) {
    const banca = bancaById.get(bid);
    const bancaNameNorm = normalizeBancaNameForMatch(banca?.name ?? '');
    const bancaUrlNorm = normalizeBancaUrlForCrmMatch(banca?.url ?? '');
    const owner = (ownersRows ?? []).find((o: { banca_name?: string | null; banca_url?: string | null; id?: string }) => {
      const ownerNameNorm = normalizeBancaNameForMatch(o?.banca_name);
      const ownerUrlNorm = normalizeBancaUrlForCrmMatch(o?.banca_url);
      return (
        (bancaUrlNorm.length > 0 && ownerUrlNorm.length > 0 && ownerUrlNorm === bancaUrlNorm) ||
        (bancaNameNorm.length > 0 && ownerNameNorm.length > 0 && ownerNameNorm === bancaNameNorm)
      );
    });
    if (owner?.id) ownerByBancaId.set(bid, String(owner.id));
  }

  const subtreeGestorNamesByOwner = new Map<string, string[]>();
  const uniqueOwnerIds = Array.from(new Set(Array.from(ownerByBancaId.values())));
  for (const oid of uniqueOwnerIds) {
    subtreeGestorNamesByOwner.set(oid, await listGestorNamesInOwnerSubtree(oid));
  }

  for (const bid of ids) {
    const ownerId = ownerByBancaId.get(bid);
    const hierarchyNames = ownerId ? (subtreeGestorNamesByOwner.get(ownerId) ?? []) : [];
    const ubNames = namesFromUserBancasByBanca.get(bid) ?? [];
    const merged = mergeUniqueNames(hierarchyNames, ubNames);
    if (merged.length > 0) out.set(bid, merged);
  }

  return out;
}
