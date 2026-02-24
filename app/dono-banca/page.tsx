import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import DonoBancaClient from './DonoBancaClient';
import { getUserProfile } from '@/lib/middleware/permissions';

export default async function DonoBancaPage() {
  const cookieStore = await cookies();
  const userId = cookieStore.get('user_id')?.value;

  if (!userId) {
    redirect('/login');
  }

  const profile = await getUserProfile(userId);
  const userStatus = profile?.status ?? null;
  const isAdminOrSuperAdmin = userStatus === 'super_admin' || userStatus === 'admin';

  return (
    <DonoBancaClient
      initialData={null}
      userId={userId}
      userStatus={userStatus}
      isAdminOrSuperAdmin={isAdminOrSuperAdmin}
    />
  );
}


