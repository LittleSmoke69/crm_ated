/**
 * GET /api/chat/channels
 * Lista canais de chat disponíveis para o usuário:
 * - Evolution: instâncias ativas (admin vê todas do tenant; gerente/captador conforme vínculo)
 * - WhatsApp Oficial: configs ativas vinculadas ao zaploto_id do tenant do usuário
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { isEvolutionStackEnabled } from '@/lib/app-scope';

type EvolutionChannelRow = {
  id: string;
  instance_name: string;
  status: string;
  created_at?: string;
  is_master?: boolean;
  is_chat_instance?: boolean;
  phone_number?: string | null;
  user_id?: string | null;
  zaploto_id?: string | null;
};

type WhatsAppOfficialConfigRow = {
  id: string;
  name: string;
  phone_number_id: string;
  is_active: boolean;
  created_at?: string;
};

export type ChannelEvolution = {
  type: 'evolution';
  id: string;
  instance_name: string;
  status: string;
  is_master?: boolean;
  is_chat_instance?: boolean;
  phone_number?: string | null;
};

export type ChannelWhatsAppOfficial = {
  type: 'whatsapp_official';
  id: string;
  name: string;
  phone_number_id: string;
};

function mapEvolutionRows(rows: EvolutionChannelRow[] | null | undefined): EvolutionChannelRow[] {
  return ((rows || []) as EvolutionChannelRow[]).map((r) => ({
    ...r,
    is_master: !!r.is_master,
    is_chat_instance: !!r.is_chat_instance,
  }));
}

/**
 * Admin/super_admin/suporte: todas as instâncias ativas do tenant
 * (qualquer admin que criar aparece para os demais admins do mesmo zaploto).
 */
async function buildAdminEvolutionChannels(
  userId: string,
  userStatus: string
): Promise<EvolutionChannelRow[]> {
  const { data: profile } = await supabaseServiceRole
    .from('profiles')
    .select('zaploto_id')
    .eq('id', userId)
    .maybeSingle();

  const zaplotoId = (profile as { zaploto_id?: string | null } | null)?.zaploto_id ?? null;

  let query = supabaseServiceRole
    .from('evolution_instances')
    .select('id, instance_name, status, created_at, is_master, is_chat_instance, phone_number, user_id, zaploto_id')
    .eq('is_active', true)
    .order('created_at', { ascending: false });

  // Super admin / suporte: visão global.
  // Admin de tenant: só o próprio tenant (+ órfãs sem zaploto_id).
  if (userStatus === 'admin') {
    query = zaplotoId
      ? query.or(`zaploto_id.eq.${zaplotoId},zaploto_id.is.null`)
      : query.is('zaploto_id', null);
  }

  const { data: rows, error } = await query;
  if (error) {
    console.error('[chat/channels] evolution admin:', error.message);
    return [];
  }
  return mapEvolutionRows(rows as EvolutionChannelRow[]);
}

async function buildEvolutionChannels(
  userId: string,
  userStatus: string
): Promise<EvolutionChannelRow[]> {
  const normalizedStatus = (userStatus || '').trim().toLowerCase();

  if (
    normalizedStatus === 'super_admin' ||
    normalizedStatus === 'admin' ||
    normalizedStatus === 'suporte'
  ) {
    return buildAdminEvolutionChannels(userId, normalizedStatus);
  }

  // Gerente: instâncias da própria conta + qualquer instância já vinculada a ele em atendimento_chat_assignments
  if (normalizedStatus === 'gerente') {
    const { data: ownedRows } = await supabaseServiceRole
      .from('evolution_instances')
      .select('id, instance_name, status, created_at, is_master, is_chat_instance, phone_number')
      .eq('user_id', userId)
      .eq('is_active', true);

    const { data: assignRows } = await supabaseServiceRole
      .from('atendimento_chat_assignments')
      .select('evolution_instance_id')
      .eq('gerente_user_id', userId);

    const assignIds = Array.from(
      new Set(
        (assignRows || [])
          .map((a) => a.evolution_instance_id)
          .filter((id): id is string => typeof id === 'string' && id.length > 0)
      )
    );

    const ownedIds = new Set((ownedRows || []).map((r) => r.id));
    const extraIds = assignIds.filter((id) => !ownedIds.has(id));

    let extraRows: EvolutionChannelRow[] = [];
    if (extraIds.length > 0) {
      const { data: fetched } = await supabaseServiceRole
        .from('evolution_instances')
        .select('id, instance_name, status, created_at, is_master, is_chat_instance, phone_number')
        .in('id', extraIds)
        .eq('is_active', true);
      extraRows = (fetched || []) as EvolutionChannelRow[];
    }

    const byId = new Map<string, EvolutionChannelRow>();
    for (const r of mapEvolutionRows([...(ownedRows || []), ...extraRows] as EvolutionChannelRow[])) {
      byId.set(r.id, r);
    }

    return [...byId.values()].sort(
      (a, b) =>
        new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
    );
  }

  // Consultor pode acessar instâncias que estão vinculadas a ele para atendimento.
  if (normalizedStatus === 'captador') {
    const { data: assignments } = await supabaseServiceRole
      .from('atendimento_chat_assignments')
      .select('evolution_instance_id')
      .contains('consultor_user_ids', [userId]);

    const assignedInstanceIds = Array.from(
      new Set(
        (assignments || [])
          .map((assignment) => assignment.evolution_instance_id)
          .filter((instanceId): instanceId is string => typeof instanceId === 'string' && instanceId.length > 0)
      )
    );

    if (assignedInstanceIds.length === 0) return [];

    const { data: rows } = await supabaseServiceRole
      .from('evolution_instances')
      .select('id, instance_name, status, created_at, is_master, is_chat_instance, phone_number')
      .in('id', assignedInstanceIds)
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    return mapEvolutionRows(rows as EvolutionChannelRow[]);
  }

  const { data: rows } = await supabaseServiceRole
    .from('evolution_instances')
    .select('id, instance_name, status, created_at, is_master, is_chat_instance, phone_number')
    .eq('user_id', userId)
    .eq('is_active', true)
    .order('created_at', { ascending: false });

  return mapEvolutionRows(rows as EvolutionChannelRow[]);
}

async function buildWhatsAppOfficialChannels(
  userId: string,
  userStatus: string,
): Promise<WhatsAppOfficialConfigRow[]> {
  // Super admins e suporte veem todas as configs ativas
  const isGlobalAdmin = userStatus === 'super_admin' || userStatus === 'suporte';

  if (isGlobalAdmin) {
    const { data: rows } = await supabaseServiceRole
      .from('whatsapp_official_configs')
      .select('id, name, phone_number_id, is_active, created_at')
      .eq('is_active', true)
      .order('created_at', { ascending: false });
    return (rows || []) as WhatsAppOfficialConfigRow[];
  }

  const { data: profile } = await supabaseServiceRole
    .from('profiles')
    .select('zaploto_id')
    .eq('id', userId)
    .single();

  const zaplotoId = (profile as { zaploto_id?: string | null } | null)?.zaploto_id;

  // Admin do tenant também vê configs órfãs (cadastro sem zaploto_id).
  if (userStatus === 'admin') {
    let query = supabaseServiceRole
      .from('whatsapp_official_configs')
      .select('id, name, phone_number_id, is_active, created_at')
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    query = zaplotoId
      ? query.or(`zaploto_id.eq.${zaplotoId},zaploto_id.is.null`)
      : query.is('zaploto_id', null);

    const { data: rows } = await query;
    return (rows || []) as WhatsAppOfficialConfigRow[];
  }

  if (!zaplotoId) return [];

  const { data: rows } = await supabaseServiceRole
    .from('whatsapp_official_configs')
    .select('id, name, phone_number_id, is_active, created_at')
    .eq('zaploto_id', zaplotoId)
    .eq('is_active', true)
    .order('created_at', { ascending: false });

  return (rows || []) as WhatsAppOfficialConfigRow[];
}

export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);

    const { data: profile } = await supabaseServiceRole
      .from('profiles')
      .select('status')
      .eq('id', userId)
      .single();

    const userStatus = ((profile as { status?: string } | null)?.status || 'user').trim().toLowerCase();
    const isAdminLike =
      userStatus === 'super_admin' || userStatus === 'admin' || userStatus === 'suporte';

    // Lista Evolution para admin mesmo se o flag de stack estiver off no .env
    // (instâncias já criadas por outro admin do tenant precisam aparecer).
    const evolutionEnabled = isEvolutionStackEnabled() || isAdminLike;

    const [evolutionInstances, waOfficialConfigs] = await Promise.all([
      evolutionEnabled ? buildEvolutionChannels(userId, userStatus) : Promise.resolve([] as EvolutionChannelRow[]),
      buildWhatsAppOfficialChannels(userId, userStatus),
    ]);

    const evolution: ChannelEvolution[] = evolutionInstances.map((row) => ({
      type: 'evolution' as const,
      id: row.id,
      instance_name: row.instance_name,
      status: row.status || 'unknown',
      ...(row.is_master ? { is_master: true } : {}),
      ...(row.is_chat_instance ? { is_chat_instance: true } : {}),
      ...(row.phone_number ? { phone_number: row.phone_number } : {}),
    }));

    const whatsapp_official: ChannelWhatsAppOfficial[] = waOfficialConfigs.map((row) => ({
      type: 'whatsapp_official' as const,
      id: row.id,
      name: row.name,
      phone_number_id: row.phone_number_id,
    }));

    return successResponse({ evolution, whatsapp_official });
  } catch (err: unknown) {
    return serverErrorResponse(err as Error);
  }
}
