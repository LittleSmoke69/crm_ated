/**
 * GET /api/chat/channels
 * Lista canais disponíveis para o chat: instâncias Evolution + configs WhatsApp Oficial.
 * Usado pelo Chat Interno para o seletor de canal.
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export type ChannelEvolution = {
  type: 'evolution';
  id: string;
  instance_name: string;
  status: string;
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

    const { data: profile } = await supabaseServiceRole
      .from('profiles')
      .select('status, zaploto_id')
      .eq('id', userId)
      .single();

    const isAdminOrSuporte =
      profile?.status === 'admin' ||
      profile?.status === 'super_admin' ||
      profile?.status === 'suporte';

    let evolutionQuery = supabaseServiceRole
      .from('evolution_instances')
      .select('id, instance_name, status')
      .eq('is_chat_instance', true)
      .order('created_at', { ascending: false });

    if (!isAdminOrSuporte) {
      evolutionQuery = evolutionQuery.eq('user_id', userId);
    }

    const { data: evolutionInstances } = await evolutionQuery;

    let whatsappOfficialQuery = supabaseServiceRole
      .from('whatsapp_official_configs')
      .select('id, name, phone_number_id')
      .eq('is_active', true);

    if (!isAdminOrSuporte && profile?.zaploto_id) {
      whatsappOfficialQuery = whatsappOfficialQuery.eq('zaploto_id', profile.zaploto_id);
    }

    const { data: whatsappConfigs } = await whatsappOfficialQuery;

    const evolution: ChannelEvolution[] = (evolutionInstances || []).map((row: { id: string; instance_name: string; status: string }) => ({
      type: 'evolution',
      id: row.id,
      instance_name: row.instance_name,
      status: row.status || 'unknown',
    }));

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
