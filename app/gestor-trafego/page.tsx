import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import GestorTrafegoClient from './GestorTrafegoClient';
import { getDonoBancaDashboardData } from '@/lib/services/dashboard/dono-banca';
import { getEffectiveDonoIdForGestor } from '@/lib/middleware/gestor-owner';
import { getUserProfile, hasSidebarPermission } from '@/lib/middleware/permissions';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export default async function GestorTrafegoPage() {
  const cookieStore = await cookies();
  const userId = cookieStore.get('user_id')?.value;

  if (!userId) {
    redirect('/login');
  }

  const profile = await getUserProfile(userId);
  const allowedStatuses: string[] = ['gestor', 'admin', 'super_admin'];
  const hasStatusAccess = profile && profile.status != null && allowedStatuses.includes(profile.status);
  const hasSidebarAccess = profile ? await hasSidebarPermission(profile, 'gestao_trafego') : false;
  if (!profile || (!hasStatusAccess && !hasSidebarAccess)) {
    return (
      <GestorTrafegoClient
        initialData={null}
        userId={userId}
        userStatus={null}
        authError="Esta página é exclusiva para Gestores de Tráfego, Admin ou Super Admin."
      />
    );
  }

  const userStatusForClient = (profile.status === 'gestor' || profile.status === 'admin' || profile.status === 'super_admin')
    ? profile.status
    : null;

  // Admin, Super Admin ou cargo personalizado com gestao_trafego: carregam dados via seletor no client
  if (profile.status === 'admin' || profile.status === 'super_admin' || hasSidebarAccess) {
    return (
      <GestorTrafegoClient
        initialData={null}
        userId={userId}
        userStatus={userStatusForClient}
      />
    );
  }

  // Gestor: dono efetivo é o enroller (dono da banca) ou pode usar seletor (vinculado a Admin ou atribuído a bancas)
  const donoId = await getEffectiveDonoIdForGestor(userId);
  if (!donoId) {
    let canSelectDono = false;
    let userBancas: { banca_id: string }[] = [];
    if (profile.enroller) {
      const enrollerProfile = await getUserProfile(profile.enroller);
      canSelectDono = enrollerProfile?.status === 'admin' || enrollerProfile?.status === 'super_admin';
    }
    if (!canSelectDono) {
      const profileIdToUse = profile.id;
      let { data: ubRow } = await supabaseServiceRole.from('user_bancas').select('banca_ids').eq('user_id', profileIdToUse).maybeSingle();
      if (!ubRow?.banca_ids?.length && userId !== profileIdToUse) {
        const { data: fallback } = await supabaseServiceRole.from('user_bancas').select('banca_ids').eq('user_id', userId).maybeSingle();
        ubRow = fallback ?? ubRow;
      }
      const ids = Array.isArray(ubRow?.banca_ids) ? (ubRow.banca_ids as string[]) : [];
      userBancas = ids.map((banca_id: string) => ({ banca_id }));
      canSelectDono = userBancas.length > 0;
    }
    if (canSelectDono) {
      // Pré-carrega dados da primeira banca atribuída (gerentes/consultores) sem precisar do dono
      let initialData = null;
      const firstBancaId = userBancas[0]?.banca_id;
      if (firstBancaId) {
        try {
          const { getDashboardDataByBancaId } = await import('@/lib/services/dashboard/dono-banca');
          const now = new Date();
          const today = now.toISOString().split('T')[0];
          const sevenDaysAgo = new Date(now);
          sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
          const dateFrom = sevenDaysAgo.toISOString().split('T')[0];
          initialData = await getDashboardDataByBancaId({
            bancaId: firstBancaId,
            dateFrom,
            dateTo: today,
          });
        } catch (_) {
          // Ignora erro; client carregará ao selecionar
        }
      }
      return (
        <GestorTrafegoClient
          initialData={initialData}
          userId={userId}
          userStatus={userStatusForClient}
          canSelectDono={true}
        />
      );
    }
    return (
      <GestorTrafegoClient
        initialData={null}
        userId={userId}
        userStatus={userStatusForClient}
        authError="Você precisa estar vinculado a um Dono de Banca para acessar os dados."
      />
    );
  }

  try {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    const dateFrom = sevenDaysAgo.toISOString().split('T')[0];
    const initialData = await getDonoBancaDashboardData({
      userId: donoId,
      dateFrom,
      dateTo: today,
    });

    return <GestorTrafegoClient initialData={initialData} userId={userId} userStatus={userStatusForClient} />;
  } catch (error: any) {
    console.error('[Gestor Trafego Server] Erro ao carregar dados:', error.message);
    if (error.message?.includes('Acesso negado')) {
      return (
        <GestorTrafegoClient initialData={null} userId={userId} userStatus={userStatusForClient} authError={error.message} />
      );
    }
    return (
      <GestorTrafegoClient initialData={null} userId={userId} userStatus={userStatusForClient} serverError={error.message} />
    );
  }
}
