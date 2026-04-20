import { canAccessUser, getSubordinates, getUserProfile } from '@/lib/middleware/permissions';

export type GerentePerformanceProfile = {
  id: string;
  email: string;
  full_name: string | null;
  status?: string | null;
};

/**
 * Perfis elegíveis em "Meu Desempenho" para gerente: o próprio + consultores na sua hierarquia (recursivo).
 */
export async function buildGerentePerformanceScope(gerenteId: string): Promise<GerentePerformanceProfile[]> {
  const self = await getUserProfile(gerenteId);
  if (!self?.email) return [];

  const subs = await getSubordinates(gerenteId);
  const consultores = subs.filter((s) => s.status === 'consultor');

  const rows: GerentePerformanceProfile[] = [
    {
      id: self.id,
      email: self.email,
      full_name: self.full_name ?? null,
      status: self.status ?? null,
    },
    ...consultores.map((c) => ({
      id: c.id,
      email: c.email,
      full_name: c.full_name ?? null,
      status: c.status ?? null,
    })),
  ];

  const seen = new Set<string>();
  return rows.filter((r) => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });
}

/** Gerente pode ver desempenho do target: ele mesmo ou um consultor subordinado. */
export async function gerenteCanViewConsultorPerformance(gerenteId: string, targetId: string): Promise<boolean> {
  if (gerenteId === targetId) return true;
  const tp = await getUserProfile(targetId);
  if (!tp || tp.status !== 'consultor') return false;
  return canAccessUser(gerenteId, targetId);
}
