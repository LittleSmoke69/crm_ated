import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import DonoBancaClient from './DonoBancaClient';

export default async function DonoBancaPage() {
  const cookieStore = await cookies();
  const userId = cookieStore.get('user_id')?.value;

  if (!userId) {
    redirect('/login');
  }

  // Dados carregados em segundo plano no client: dashboard aparece logo e a lista de gerentes/consultores carrega depois
  return <DonoBancaClient initialData={null} userId={userId} />;
}


