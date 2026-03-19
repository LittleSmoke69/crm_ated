/**
 * GET /api/chat/channels
 * Lista canais disponíveis para o chat: instâncias Evolution + configs WhatsApp Oficial.
 * Usado pelo Chat Interno para o seletor de canal.
 *
 * Query opcional: require_webhook=1 — só inclui instâncias Evolution com webhook_configured=true
 * (ex.: Chat Atendimento, para não oferecer instância sem recebimento de mensagens no Zaploto).
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

type EvolutionChannelRow = {
  id: string;
  instance_name: string;
  status: string;
  created_at?: string;
  is_master?: boolean;
};

export type ChannelEvolution = {
  type: 'evolution';
  id: string;
  instance_name: string;
  status: string;
  /** Instância mestre vinculada à conta (Evolution) — disponível como canal de chat */
  is_master?: boolean;
};

export type ChannelWhatsAppOfficial = {
  type: 'whatsapp_official';
  id: string;
  name: string;
  phone_number_id: string;
};

export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const requireWebhook =
      new URL(req.url).searchParams.get('require_webhook') === '1' ||
      new URL(req.url).searchParams.get('require_webhook') === 'true';

    const { data: profile } = await supabaseServiceRole
      .from('profiles')
      .select('status, zaploto_id')
      .eq('id', userId)
      .single();

    const isAdminOrSuporte =
      profile?.status === 'admin' ||
      profile?.status === 'super_admin' ||
      profile?.status === 'suporte';

    const mergeEvolutionChannelMaps = (
      base: EvolutionChannelRow[],
      extra: EvolutionChannelRow[]
    ): EvolutionChannelRow[] => {
      const map = new Map<string, EvolutionChannelRow>();
      for (const r of base) map.set(r.id, { ...r });
      for (const r of extra) {
        const prev = map.get(r.id);
        map.set(r.id, {
          ...prev,
          ...r,
          is_master: !!(prev?.is_master || r.is_master),
        });
      }
      return Array.from(map.values()).sort(
        (a, b) =>
          new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
      );
    };

    let evolutionInstances: EvolutionChannelRow[] | null = null;

    if (isAdminOrSuporte) {
      let chatQuery = supabaseServiceRole
        .from('evolution_instances')
        .select('id, instance_name, status, created_at, is_master')
        .eq('is_chat_instance', true);
      if (requireWebhook) chatQuery = chatQuery.eq('webhook_configured', true);
      const { data: chatRows } = await chatQuery.order('created_at', { ascending: false });

      let masterQuery = supabaseServiceRole
        .from('evolution_instances')
        .select('id, instance_name, status, created_at, is_master')
        .eq('user_id', userId)
        .eq('is_master', true)
        .eq('is_active', true);
      if (requireWebhook) masterQuery = masterQuery.eq('webhook_configured', true);
      const { data: masterOwnRows } = await masterQuery.order('created_at', { ascending: false });

      const chatList = ((chatRows || []) as EvolutionChannelRow[]).map((r) => ({
        ...r,
        is_master: !!r.is_master,
      }));
      const masterList = ((masterOwnRows || []) as EvolutionChannelRow[]).map((r) => ({
        ...r,
        is_master: true,
      }));
      evolutionInstances = mergeEvolutionChannelMaps(chatList, masterList);
    } else {
      const statusNorm = (profile?.status || '').toLowerCase();

      let ownQuery = supabaseServiceRole
        .from('evolution_instances')
        .select('id, instance_name, status, created_at, is_master')
        .eq('is_chat_instance', true)
        .eq('user_id', userId);
      if (requireWebhook) ownQuery = ownQuery.eq('webhook_configured', true);
      const { data: ownRows } = await ownQuery.order('created_at', { ascending: false });

      let masterOwnQuery = supabaseServiceRole
        .from('evolution_instances')
        .select('id, instance_name, status, created_at, is_master')
        .eq('user_id', userId)
        .eq('is_master', true)
        .eq('is_active', true);
      if (requireWebhook) masterOwnQuery = masterOwnQuery.eq('webhook_configured', true);
      const { data: masterOwnRows } = await masterOwnQuery.order('created_at', { ascending: false });

      let assignedIds: string[] = [];
      if (statusNorm === 'consultor') {
        const { data: assignRows } = await supabaseServiceRole
          .from('atendimento_chat_assignments')
          .select('evolution_instance_id')
          .eq('consultor_user_id', userId);
        assignedIds = (assignRows || [])
          .map((r: { evolution_instance_id: string }) => r.evolution_instance_id)
          .filter(Boolean);
      } else if (statusNorm === 'gerente') {
        const { data: assignRows } = await supabaseServiceRole
          .from('atendimento_chat_assignments')
          .select('evolution_instance_id')
          .eq('gerente_user_id', userId);
        assignedIds = (assignRows || [])
          .map((r: { evolution_instance_id: string }) => r.evolution_instance_id)
          .filter(Boolean);
      }

      let assignedRows: EvolutionChannelRow[] = [];
      if (assignedIds.length > 0) {
        let arQuery = supabaseServiceRole
          .from('evolution_instances')
          .select('id, instance_name, status, created_at, is_master')
          .eq('is_chat_instance', true)
          .in('id', assignedIds);
        if (requireWebhook) arQuery = arQuery.eq('webhook_configured', true);
        const { data: ar } = await arQuery;
        assignedRows = (ar || []) as EvolutionChannelRow[];
      }

      const merged = new Map<string, EvolutionChannelRow>();
      for (const r of (ownRows || []) as EvolutionChannelRow[]) {
        merged.set(r.id, { ...r, is_master: !!r.is_master });
      }
      for (const r of assignedRows) {
        const prev = merged.get(r.id);
        merged.set(r.id, {
          ...prev,
          ...r,
          is_master: !!(prev?.is_master || r.is_master),
        });
      }

      const baseList = Array.from(merged.values());
      const masterList = ((masterOwnRows || []) as EvolutionChannelRow[]).map((r) => ({
        ...r,
        is_master: true,
      }));
      evolutionInstances = mergeEvolutionChannelMaps(baseList, masterList);
    }

    let whatsappOfficialQuery = supabaseServiceRole
      .from('whatsapp_official_configs')
      .select('id, name, phone_number_id')
      .eq('is_active', true);

    if (!isAdminOrSuporte && profile?.zaploto_id) {
      whatsappOfficialQuery = whatsappOfficialQuery.eq('zaploto_id', profile.zaploto_id);
    }

    const { data: whatsappConfigs } = await whatsappOfficialQuery;

    const evolution: ChannelEvolution[] = (evolutionInstances || []).map(
      (row: EvolutionChannelRow) => ({
        type: 'evolution' as const,
        id: row.id,
        instance_name: row.instance_name,
        status: row.status || 'unknown',
        ...(row.is_master ? { is_master: true } : {}),
      })
    );

    const whatsapp_official: ChannelWhatsAppOfficial[] = (whatsappConfigs || []).map((row: { id: string; name: string; phone_number_id: string }) => ({
      type: 'whatsapp_official',
      id: row.id,
      name: row.name,
      phone_number_id: row.phone_number_id,
    }));

    return successResponse({ evolution, whatsapp_official });
  } catch (err: unknown) {
    return serverErrorResponse(err as Error);
  }
}
