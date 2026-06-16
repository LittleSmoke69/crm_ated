import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import GestorTrafegoClient from './GestorTrafegoClient';
import { getEffectiveDonoIdForGestorTrafegoViewer } from '@/lib/middleware/gestor-owner';
import { getUserProfile, hasSidebarPermission } from '@/lib/middleware/permissions';
import { resolveGestorTrafegoBancaIds } from '@/lib/services/gestor-trafego-bancas';
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

  const userStatusForClient =
    normalizedStatus === 'gestor' ||
    normalizedStatus === 'gerente' ||
    normalizedStatus === 'admin' ||
    normalizedStatus === 'super_admin'
      ? (normalizedStatus as 'gestor' | 'gerente' | 'admin' | 'super_admin')
      : null;

  const profileIdUb = profile.id;
  let { data: ubRowGlobal } = await supabaseServiceRole
    .from('user_bancas')
    .select('banca_ids')
    .eq('user_id', profileIdUb)
    .maybeSingle();
  if (!ubRowGlobal?.banca_ids?.length && userId !== profileIdUb) {
    const { data: ubFallback } = await supabaseServiceRole
      .from('user_bancas')
      .select('banca_ids')
      .eq('user_id', userId)
      .maybeSingle();
    ubRowGlobal = ubFallback ?? ubRowGlobal;
  }
  const assignedBancaIds = Array.isArray(ubRowGlobal?.banca_ids) ? (ubRowGlobal.banca_ids as string[]) : [];

  /**
   * Gestor / Gerente primeiro — evita cair no branch admin/sidebar com canSelectDono=false.
   * Dropdown de bancas: /api/gestor-trafego/bancas (user_bancas + donos na hierarquia).
   */
  if (normalizedStatus === 'gestor' || normalizedStatus === 'gerente') {
    const bancaIdsFromHierarchy = await resolveGestorTrafegoBancaIds(profile.id, userId);
    const donoId = await getEffectiveDonoIdForGestorTrafegoViewer(userId);
    const hasBancaAccess = bancaIdsFromHierarchy.length > 0 || assignedBancaIds.length > 0;

    if (!donoId && !hasBancaAccess) {
      let canSelectViaEnroller = false;
      if (profile.enroller) {
        const enrollerProfile = await getUserProfile(profile.enroller);
        const enrollerStatus = enrollerProfile?.status?.trim().toLowerCase();
        canSelectViaEnroller = enrollerStatus === 'admin' || enrollerStatus === 'super_admin';
      }
      if (!canSelectViaEnroller) {
        return (
          <GestorTrafegoClient
            initialData={null}
            userId={userId}
            userStatus={userStatusForClient}
            authError="Você precisa estar vinculado a um Dono de Banca ou ter bancas atribuídas na hierarquia para acessar os dados."
          />
        );
      }
    }

    return (
      <GestorTrafegoClient
        initialData={null}
        userId={userId}
        userStatus={userStatusForClient}
        canSelectDono
      />
    );
  }

  // Admin/Super Admin ou cargo com sidebar gestao_trafego (não gestor/gerente).
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
        canSelectDono={customGestaoTrafegoOnly}
      />
    );
  }

  return (
    <GestorTrafegoClient
      initialData={null}
      userId={userId}
      userStatus={null}
      authError="Acesso negado. Você não tem permissão para acessar o módulo Gestão de Tráfego."
    />
  );
}
