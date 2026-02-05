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

  // Consultor, Gerente e Super Admin podem ter bancas escolhidas em user_bancas
  if (profile.status === 'consultor' || profile.status === 'gerente' || profile.status === 'super_admin') {
    const { data: userBancas, error } = await supabaseServiceRole
      .from('user_bancas')
      .select('banca_id, crm_bancas(id, name, url)')
      .eq('user_id', userId);

    if (!error && userBancas && userBancas.length > 0) {
      return userBancas
        .map((ub: { banca_id: string; crm_bancas: { id: string; name: string; url: string } | { id: string; name: string; url: string }[] | null }) => {
          const raw = ub.crm_bancas;
          const b = Array.isArray(raw) ? raw[0] : raw;
          if (!b) return null;
          return { id: b.id, name: b.name, url: b.url };
        })
        .filter(Boolean) as BancaInfo[];
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
