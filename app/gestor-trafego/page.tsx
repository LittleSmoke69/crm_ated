import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import GestorTrafegoClient from './GestorTrafegoClient';
import { getEffectiveDonoIdForGestorTrafegoViewer } from '@/lib/middleware/gestor-owner';
import { getUserProfile, hasSidebarPermission } from '@/lib/middleware/permissions';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export default async function GestorTrafegoPage() {
  const cookieStore = await cookies();
  const userId = cookieStore.get('user_id')?.value;

  if (!userId) {
    redirect('/login');
  }

  const profile = await getUserProfile(userId);
  const allowedStatuses: string[] = ['gestor', 'gerente', 'admin', 'super_admin'];
  const normalizedStatus = profile?.status?.trim().toLowerCase();
  const hasStatusAccess = profile && normalizedStatus != null && allowedStatuses.includes(normalizedStatus);
  const hasSidebarAccess = profile ? await hasSidebarPermission(profile, 'gestao_trafego') : false;
  if (!profile || (!hasStatusAccess && !hasSidebarAccess)) {
    return (
      <GestorTrafegoClient
        initialData={null}
        userId={userId}
        userStatus={null}
        authError="Acesso negado. Você não tem permissão para acessar o módulo Gestão de Tráfego."
      />
    );
  }

  const userStatusForClient = (normalizedStatus === 'gestor' || normalizedStatus === 'gerente' || normalizedStatus === 'admin' || normalizedStatus === 'super_admin')
    ? (normalizedStatus as 'gestor' | 'gerente' | 'admin' | 'super_admin')
    : null;

  const profileIdUb = profile.id;
  let { data: ubRowGlobal } = await supabaseServiceRole.from('user_bancas').select('banca_ids').eq('user_id', profileIdUb).maybeSingle();
  if (!ubRowGlobal?.banca_ids?.length && userId !== profileIdUb) {
    const { data: ubFallback } = await supabaseServiceRole.from('user_bancas').select('banca_ids').eq('user_id', userId).maybeSingle();
    ubRowGlobal = ubFallback ?? ubRowGlobal;
  }
  const assignedBancaIds = Array.isArray(ubRowGlobal?.banca_ids) ? (ubRowGlobal.banca_ids as string[]) : [];

  // Admin/Super Admin: seletor de qualquer dono. Cargo personalizado com gestao_trafego: seletor só dos donos/bancas permitidos (API /donos filtra).
  const customGestaoTrafegoOnly =
    hasSidebarAccess &&
    normalizedStatus !== 'gestor' &&
    normalizedStatus !== 'gerente' &&
    normalizedStatus !== 'admin' &&
    normalizedStatus !== 'super_admin';
  if (normalizedStatus === 'admin' || normalizedStatus === 'super_admin' || hasSidebarAccess) {
    return (
      <GestorTrafegoClient
        initialData={null}
        userId={userId}
        userStatus={userStatusForClient}
        canSelectDono={customGestaoTrafegoOnly || normalizedStatus === 'gerente'}
      />
    );
  }

  // Gestor / Gerente: dono efetivo (enroller dono) ou seletor se tiver bancas em user_bancas / enroller admin
  const donoId =
    normalizedStatus === 'gestor' || normalizedStatus === 'gerente'
      ? await getEffectiveDonoIdForGestorTrafegoViewer(userId)
      : null;
  if (!donoId) {
    let canSelectDono = false;
    let userBancas: { banca_id: string }[] = [];
    if (profile.enroller) {
      const enrollerProfile = await getUserProfile(profile.enroller);
      const enrollerStatus = enrollerProfile?.status?.trim().toLowerCase();
      canSelectDono = enrollerStatus === 'admin' || enrollerStatus === 'super_admin';
    }
    if (!canSelectDono) {
      const ids = assignedBancaIds;
      userBancas = ids.map((banca_id: string) => ({ banca_id }));
      canSelectDono = userBancas.length > 0;
    }
    if (canSelectDono) {
      // Não pré-carrega no servidor — client busca em duas chamadas paralelas (Meta rápida + banca lenta)
      return (
        <GestorTrafegoClient
          initialData={null}
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

  // Não pré-carrega no servidor — evita timeout no Netlify. Client busca em duas chamadas paralelas.
  // Gerente: sempre exibe filtro de banca ao lado do período (/bancas inclui user_bancas ou fallback hierárquico).
  return (
    <GestorTrafegoClient
      initialData={null}
      userId={userId}
      userStatus={userStatusForClient}
      canSelectDono={normalizedStatus === 'gerente'}
    />
  );
}
