import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import DonoBancaClient from './DonoBancaClient';
import { getUserProfile, hasSidebarPermission } from '@/lib/middleware/permissions';

export default async function DonoBancaPage() {
  const cookieStore = await cookies();
  const userId = cookieStore.get('user_id')?.value;

  if (!userId) {
    redirect('/login');
  }

  const profile = await getUserProfile(userId);
  const userStatus = profile?.status ?? null;
  const normalizedStatus = String(userStatus ?? '').trim().toLowerCase();
  const isAdminOrSuperAdmin = normalizedStatus === 'super_admin' || normalizedStatus === 'admin';
  const isDonoBanca = userStatus === 'dono_banca';
  // Gestor de tráfego pode acessar a Gestão de Banca (escopo: bancas atribuídas em user_bancas).
  const isGestor = normalizedStatus === 'gestor';
  const hasSidebarAccess = await hasSidebarPermission(profile ?? null, 'gestao_banca');
  const canAccessDonoBanca = isAdminOrSuperAdmin || isDonoBanca || isGestor || hasSidebarAccess;
  const canSelectBanca = isAdminOrSuperAdmin || isGestor || (hasSidebarAccess && !isDonoBanca);

  return (
    <DonoBancaClient
      initialData={null}
      userId={userId}
      userStatus={userStatus}
      isAdminOrSuperAdmin={isAdminOrSuperAdmin}
      canAccessDonoBanca={canAccessDonoBanca}
      canSelectBanca={canSelectBanca}
    />
  );
}


