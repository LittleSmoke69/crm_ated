import { getUserProfile } from '@/lib/middleware/permissions';
import { getHierarchyPath } from './hierarchy';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export type BancaInfo = { id?: string; name: string; url: string | null };

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
  const { data } = await supabaseServiceRole
    .from('user_bancas')
    .select('user_id')
    .eq('user_id', consultorId)
    .filter('banca_ids', 'cs', JSON.stringify([crmBancaId]))
    .maybeSingle();
  return !!data;
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
