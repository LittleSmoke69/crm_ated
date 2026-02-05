import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import DonoBancaClient from './DonoBancaClient';
import { getDonoBancaDashboardData } from '@/lib/services/dashboard/dono-banca';

export default async function DonoBancaPage() {
  const cookieStore = await cookies();
  const userId = cookieStore.get('user_id')?.value;

  if (!userId) {
    redirect('/login');
  }

  try {
    // Busca dados iniciais no servidor (para o filtro "daily" padrão)
    const initialData = await getDonoBancaDashboardData({
      userId,
      dateFrom: new Date().toISOString().split('T')[0],
      dateTo: new Date().toISOString().split('T')[0]
    });

    return <DonoBancaClient initialData={initialData} userId={userId} />;
  } catch (error: any) {
    console.error('[DonoBanca Server] Erro ao carregar dados:', error.message);
    
    // Se for erro de permissão, redireciona ou mostra erro
    if (error.message.includes('Acesso negado')) {
      return <DonoBancaClient initialData={null} userId={userId} authError={error.message} />;
    }

    return <DonoBancaClient initialData={null} userId={userId} serverError={error.message} />;
  }
}


