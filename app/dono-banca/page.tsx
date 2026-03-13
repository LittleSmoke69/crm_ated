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
  const isAdminOrSuperAdmin = userStatus === 'super_admin' || userStatus === 'admin';
  const isDonoBanca = userStatus === 'dono_banca';
  const hasSidebarAccess = await hasSidebarPermission(profile ?? null, 'gestao_banca');
  const canAccessDonoBanca = isAdminOrSuperAdmin || isDonoBanca || hasSidebarAccess;
  const canSelectBanca = isAdminOrSuperAdmin || (hasSidebarAccess && !isDonoBanca);

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


