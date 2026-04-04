import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { getUserProfile, hasSidebarPermission, UserProfile } from '@/lib/middleware/permissions';

const GESTOR_TRAFEGO_STATUSES = ['gestor', 'gerente', 'admin', 'super_admin'] as const;

/**
 * Verifica se o perfil pode acessar o módulo Gestão de Tráfego:
 * - status gestor, gerente (dados limitados às bancas vinculadas), admin ou super_admin; ou
 * - cargo com permissão de sidebar gestao_trafego.
 */
export async function canAccessGestorTrafego(profile: UserProfile | null): Promise<boolean> {
  if (!profile?.status) return false;
  const normalizedStatus = String(profile.status).trim().toLowerCase();
  if (GESTOR_TRAFEGO_STATUSES.includes(normalizedStatus as (typeof GESTOR_TRAFEGO_STATUSES)[number])) {
    return true;
  }
  return hasSidebarPermission(profile, 'gestao_trafego');
}

/**
 * Requer usuário autenticado com acesso ao módulo Gestão de Tráfego (por status ou permissão de cargo).
 * Retorna { userId, profile }.
 */
export async function requireGestorTrafego(req: NextRequest): Promise<{ userId: string; profile: UserProfile }> {
  const { userId } = await requireAuth(req);
  const profile = await getUserProfile(userId);
  if (!profile) {
    throw new Error('Perfil não encontrado');
  }
  if (!(await canAccessGestorTrafego(profile))) {
    throw new Error('Acesso negado. Você não tem permissão para acessar o módulo Gestão de Tráfego.');
  }
  return { userId, profile };
}
