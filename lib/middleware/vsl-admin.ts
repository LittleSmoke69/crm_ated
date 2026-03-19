import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { getUserProfile, hasSidebarPermission, UserProfile } from '@/lib/middleware/permissions';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

const VSL_ADMIN_STATUSES = ['gestor', 'admin', 'super_admin'] as const;

/**
 * Verifica se o perfil pode acessar o painel/admin VSL:
 * - status gestor, admin ou super_admin; ou
 * - cargo com permissão de sidebar vsl_redirect (VSL & Redirect).
 */
export async function canAccessVslAdmin(profile: UserProfile | null): Promise<boolean> {
  if (!profile?.status) return false;
  if (VSL_ADMIN_STATUSES.includes(profile.status as (typeof VSL_ADMIN_STATUSES)[number])) {
    return true;
  }
  return hasSidebarPermission(profile, 'vsl_redirect');
}

/**
 * Requer usuário autenticado com acesso ao módulo VSL (por status ou permissão de cargo).
 * Retorna { userId, profile }.
 */
export async function requireVslAdmin(req: NextRequest): Promise<{ userId: string; profile: UserProfile }> {
  const { userId } = await requireAuth(req);
  const profile = await getUserProfile(userId);
  if (!profile) {
    throw new Error('Perfil não encontrado');
  }
  if (!(await canAccessVslAdmin(profile))) {
    throw new Error('Acesso negado. Você não tem permissão para acessar o módulo VSL & Redirect.');
  }
  return { userId, profile };
}

/**
 * Verifica se o usuário pode acessar um vsl_project específico.
 * - super_admin e admin: acesso a todos.
 * - Demais (ex.: gestor): apenas projetos que ele criou (owner_user_id = userId).
 */
export async function canAccessVslProject(userId: string, projectId: string): Promise<boolean> {
  const profile = await getUserProfile(userId);
  if (!profile) return false;
  if (profile.status === 'super_admin' || profile.status === 'admin') return true;

  const { data: project } = await supabaseServiceRole
    .from('vsl_projects')
    .select('owner_user_id')
    .eq('id', projectId)
    .single();

  if (!project) return false;
  return project.owner_user_id === userId;
}

/**
 * Requer que o usuário tenha acesso ao projeto VSL. Lança se não tiver.
 */
export async function requireVslProjectAccess(
  req: NextRequest,
  projectId: string
): Promise<{ userId: string; profile: UserProfile }> {
  const { userId, profile } = await requireVslAdmin(req);
  const allowed = await canAccessVslProject(userId, projectId);
  if (!allowed) {
    throw new Error('Acesso negado a este projeto VSL.');
  }
  return { userId, profile };
}

/**
 * Filtro para listar projetos: usuário vê apenas os que criou; super_admin e admin vêem todos.
 * - all: true = sem filtro (admin/super_admin)
 * - ownerUserId: filtrar por owner_user_id (quem criou)
 */
export async function vslProjectsFilterForUser(userId: string): Promise<{ all: boolean; ownerUserId: string | null }> {
  const profile = await getUserProfile(userId);
  if (!profile) return { all: false, ownerUserId: userId };

  if (profile.status === 'super_admin' || profile.status === 'admin') {
    return { all: true, ownerUserId: null };
  }

  return { all: false, ownerUserId: userId };
}
