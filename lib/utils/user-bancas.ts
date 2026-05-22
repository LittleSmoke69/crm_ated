import { getUserProfile } from '@/lib/middleware/permissions';
import { getHierarchyPath } from './hierarchy';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { metaVerboseInfo } from '@/lib/utils/meta-debug-log';

export type BancaInfo = { id?: string; name: string; url: string | null };

/** Normaliza `user_bancas.banca_ids` (JSONB array, ou string JSON legada). */
export function parseCrmBancaIdsFromUserBancasJson(raw: unknown): string[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    return raw.map((x) => String(x ?? '').trim()).filter(Boolean);
  }
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s) return [];
    try {
      const p = JSON.parse(s) as unknown;
      if (Array.isArray(p)) return p.map((x) => String(x ?? '').trim()).filter(Boolean);
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * `profiles.id` com `crm_bancas.id` em `user_bancas.banca_ids`.
 * Mesma regra que GET /api/admin/crm/bancas?with_users=1 (match em memória; UUID case-insensitive).
 * Evita `.filter('banca_ids', 'cs', …)` em JSONB, que costuma falhar no PostgREST.
 */
export async function getUserIdsLinkedToCrmBancaViaUserBancas(bancaId: string): Promise<string[]> {
  const target = String(bancaId ?? '').trim().toLowerCase();
  if (!target) return [];

  const { data: userBancasRows, error } = await supabaseServiceRole
    .from('user_bancas')
    .select('user_id, banca_ids');
  if (error) throw new Error(error.message);

  const rows = userBancasRows ?? [];
  let rowsWithNonArrayBancaIds = 0;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const uid = String((row as { user_id?: string | null }).user_id ?? '').trim();
    if (!uid || seen.has(uid)) continue;
    const rawBancaIds = (row as { banca_ids?: unknown }).banca_ids;
    if (rawBancaIds != null && !Array.isArray(rawBancaIds) && typeof rawBancaIds !== 'string') {
      rowsWithNonArrayBancaIds += 1;
    }
    const ids = parseCrmBancaIdsFromUserBancasJson(rawBancaIds).map((x) => x.toLowerCase());
    if (!ids.includes(target)) continue;
    seen.add(uid);
    out.push(uid);
  }

  metaVerboseInfo('[user_bancas][crm_banca_link]', {
    banca_id: target,
    user_bancas_rows_scanned: rows.length,
    matched_profile_ids: out.length,
    rows_with_unexpected_banca_ids_shape: rowsWithNonArrayBancaIds,
  });

  return out;
}

/**
 * Retorna todas as bancas que o usuário faz parte.
 * - Consultor/Gerente: se tiver escolha em user_bancas, retorna essas (com id); senão retorna da hierarquia.
 * - Dono de banca: retorna sua própria banca (banca_name e banca_url).
 */
export async function getUserBancas(userId: string): Promise<BancaInfo[]> {
  const profile = await getUserProfile(userId);
  if (!profile) return [];

  // Consultor, Gerente, Gestor e Super Admin podem ter bancas escolhidas em user_bancas (banca_ids JSONB)
  if (['consultor', 'gerente', 'gestor', 'super_admin', 'admin'].includes(profile.status || '')) {
    const { data: row, error } = await supabaseServiceRole
      .from('user_bancas')
      .select('banca_ids')
      .eq('user_id', userId)
      .maybeSingle();

    if (!error && row?.banca_ids && Array.isArray(row.banca_ids) && row.banca_ids.length > 0) {
      const ids = row.banca_ids as string[];
      const { data: bancas, error: bancasError } = await supabaseServiceRole
        .from('crm_bancas')
        .select('id, name, url')
        .in('id', ids);
      if (!bancasError && bancas?.length) {
        const byId = new Map(bancas.map((b: { id: string; name: string; url: string }) => [b.id, { id: b.id, name: b.name, url: b.url }]));
        return ids.map((id) => byId.get(id)).filter(Boolean) as BancaInfo[];
      }
    }
  }

  // Fallback: hierarquia (dono_banca ou consultor/gerente sem escolha em user_bancas)
  const path = await getHierarchyPath(userId);
  const bancas: BancaInfo[] = [];
  const seenUrls = new Set<string | null>();

  for (const p of path) {
    if (p.banca_name) {
      const url = p.banca_url || null;
      const key = url || p.banca_name;
      if (!seenUrls.has(key)) {
        bancas.push({ name: p.banca_name, url });
        seenUrls.add(key);
      }
    }
  }

  return bancas;
}

/** True se `crmBancaId` (crm_bancas.id) está entre as bancas retornadas por getUserBancas (inclui user_bancas com id). */
export async function userHasCrmBanca(userId: string, crmBancaId: string): Promise<boolean> {
  if (!crmBancaId) return false;
  const bancas = await getUserBancas(userId);
  return bancas.some((b) => b.id === crmBancaId);
}

/** True se o consultor tem `crmBancaId` em user_bancas.banca_ids. */
export async function consultorHasCrmBanca(consultorId: string, crmBancaId: string): Promise<boolean> {
  if (!consultorId || !crmBancaId) return false;
  const { data: row } = await supabaseServiceRole
    .from('user_bancas')
    .select('banca_ids')
    .eq('user_id', consultorId)
    .maybeSingle();
  const ids = parseCrmBancaIdsFromUserBancasJson(row?.banca_ids).map((x) => x.toLowerCase());
  return ids.includes(String(crmBancaId).trim().toLowerCase());
}

/**
 * Salva as bancas escolhidas pelo usuário na tabela user_bancas.
 */
export async function saveUserBancas(userId: string, bancaIds: string[]) {
  const { error } = await supabaseServiceRole
    .from('user_bancas')
    .upsert({
      user_id: userId,
      banca_ids: bancaIds
    }, {
      onConflict: 'user_id'
    });

  if (error) {
    console.error('[saveUserBancas] Erro raw do Supabase:', error);
    throw error;
  }

  return { success: true };
}
