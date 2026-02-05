import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { UserProfile, getSubordinates, getUserProfile } from '@/lib/middleware/permissions';

/**
 * Retorna a árvore hierárquica completa de um usuário
 */
export async function getHierarchyTree(userId: string): Promise<HierarchyNode | null> {
  const profile = await getUserProfile(userId);
  if (!profile) {
    return null;
  }

  const subordinates = await getSubordinates(userId);

  return {
    user: profile,
    subordinates: await Promise.all(
      subordinates.map(async (sub) => {
        const subTree = await getHierarchyTree(sub.id);
        return subTree || { user: sub, subordinates: [] };
      })
    ),
  };
}

export interface HierarchyNode {
  user: UserProfile;
  subordinates: HierarchyNode[];
}

/**
 * Retorna o caminho hierárquico de um usuário até a raiz
 */
export async function getHierarchyPath(userId: string): Promise<UserProfile[]> {
  const path: UserProfile[] = [];
  let current: string | null = userId;

  while (current) {
    const profile = await getUserProfile(current);
    if (!profile) {
      break;
    }

    path.push(profile);

    // Se for admin, para aqui
    if (profile.status === 'admin') {
      break;
    }

    current = profile.enroller;
  }

  return path;
}

/**
 * Retorna todos os IDs de usuários que estão acima na hierarquia (ancestrais)
 */
export async function getAncestorIds(userId: string): Promise<string[]> {
  const path = await getHierarchyPath(userId);
  // Remove o próprio usuário e retorna apenas os ancestrais
  return path.slice(1).map(p => p.id);
}

/**
 * Busca a banca_url na hierarquia, começando pelo próprio usuário e subindo
 */
export async function getBancaUrl(userId: string): Promise<string | null> {
  const path = await getHierarchyPath(userId);
  
  for (const profile of path) {
    if (profile.banca_url) {
      return profile.banca_url;
    }
  }

  return null;
}

/**
 * Verifica se um usuário está na hierarquia de outro
 */
export async function isInHierarchy(ancestorId: string, descendantId: string): Promise<boolean> {
  if (ancestorId === descendantId) {
    return true;
  }

  const subordinates = await getSubordinates(ancestorId);
  return subordinates.some(sub => sub.id === descendantId);
}

/**
 * Retorna estatísticas da hierarquia de um usuário
 */
export async function getHierarchyStats(userId: string): Promise<{
  totalSubordinates: number;
  gerentes: number;
  consultores: number;
  donosBanca: number;
}> {
  const subordinates = await getSubordinates(userId);

  return {
    totalSubordinates: subordinates.length,
    gerentes: subordinates.filter(s => s.status === 'gerente').length,
    consultores: subordinates.filter(s => s.status === 'consultor').length,
    donosBanca: subordinates.filter(s => s.status === 'dono_banca').length,
  };
}

/**
 * Retorna apenas subordinados diretos (não recursivo)
 */
export async function getDirectSubordinates(userId: string): Promise<UserProfile[]> {
  const { data } = await supabaseServiceRole
    .from('profiles')
    .select('id, email, full_name, status, enroller, created_at')
    .eq('enroller', userId);

  return (data as UserProfile[]) || [];
}

/**
 * Retorna apenas consultores diretos de um gerente
 */
export async function getConsultorsByManager(gerenteId: string): Promise<UserProfile[]> {
  const { data } = await supabaseServiceRole
    .from('profiles')
    .select('*')
    .eq('enroller', gerenteId)
    .eq('status', 'consultor');

  return (data as UserProfile[]) || [];
}

/**
 * Retorna apenas gerentes diretos de um dono de banca
 */
export async function getManagersByOwner(donoBancaId: string): Promise<UserProfile[]> {
  const { data } = await supabaseServiceRole
    .from('profiles')
    .select('*')
    .eq('enroller', donoBancaId)
    .eq('status', 'gerente');

  return (data as UserProfile[]) || [];
}

