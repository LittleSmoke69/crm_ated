/**
 * GET /api/chat/channels
 * Lista canais de chat disponíveis para o usuário:
 * - Evolution: instâncias ativas vinculadas ao user_id
 * - WhatsApp Oficial: configs ativas vinculadas ao zaploto_id do tenant do usuário
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

type EvolutionChannelRow = {
  id: string;
  instance_name: string;
  status: string;
  created_at?: string;
  is_master?: boolean;
  is_chat_instance?: boolean;
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
};

export type ChannelWhatsAppOfficial = {
  type: 'whatsapp_official';
  id: string;
  name: string;
  phone_number_id: string;
};

async function buildEvolutionChannels(userId: string): Promise<EvolutionChannelRow[]> {
  const { data: rows } = await supabaseServiceRole
    .from('evolution_instances')
    .select('id, instance_name, status, created_at, is_master, is_chat_instance')
    .eq('user_id', userId)
    .eq('is_active', true)
    .order('created_at', { ascending: false });

  return ((rows || []) as EvolutionChannelRow[]).map((r) => ({
    ...r,
    is_master: !!r.is_master,
    is_chat_instance: !!r.is_chat_instance,
  }));
}

async function buildWhatsAppOfficialChannels(
  userId: string,
  userStatus: string,
): Promise<WhatsAppOfficialConfigRow[]> {
  // Super admins e suporte sem tenant veem todas as configs ativas
  const isGlobalAdmin = userStatus === 'super_admin' || (userStatus === 'suporte');

  if (isGlobalAdmin) {
    const { data: rows } = await supabaseServiceRole
      .from('whatsapp_official_configs')
      .select('id, name, phone_number_id, is_active, created_at')
      .eq('is_active', true)
      .order('created_at', { ascending: false });
    return (rows || []) as WhatsAppOfficialConfigRow[];
  }

  // Busca o zaploto_id do perfil do usuário
  const { data: profile } = await supabaseServiceRole
    .from('profiles')
    .select('zaploto_id')
    .eq('id', userId)
    .single();

  const zaplotoId = (profile as { zaploto_id?: string | null } | null)?.zaploto_id;
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

    const userStatus = (profile as { status?: string } | null)?.status || 'user';

    const [evolutionInstances, waOfficialConfigs] = await Promise.all([
      buildEvolutionChannels(userId),
      buildWhatsAppOfficialChannels(userId, userStatus),
    ]);

    const evolution: ChannelEvolution[] = evolutionInstances.map((row) => ({
      type: 'evolution' as const,
      id: row.id,
      instance_name: row.instance_name,
      status: row.status || 'unknown',
      ...(row.is_master ? { is_master: true } : {}),
      ...(row.is_chat_instance ? { is_chat_instance: true } : {}),
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
