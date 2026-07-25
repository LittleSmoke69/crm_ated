/**
 * GET /api/chat/whatsapp-official/templates?config_id=...
 * Lista os templates cadastrados na conta WABA (Meta) para o seletor de disparo no chat.
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { listApprovedTemplates } from '@/lib/services/whatsapp-official-service';

export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const configId = req.nextUrl.searchParams.get('config_id');
    if (!configId) return errorResponse('config_id é obrigatório', 400);

    const { data: config, error: configError } = await supabaseServiceRole
      .from('whatsapp_official_configs')
      .select('id, phone_number_id, waba_id, graph_version, access_token, zaploto_id')
      .eq('id', configId)
      .eq('is_active', true)
      .single();
    if (configError || !config) {
      return errorResponse('Configuração não encontrada ou inativa', 404);
    }

    const { data: profile } = await supabaseServiceRole
      .from('profiles')
      .select('status, zaploto_id')
      .eq('id', userId)
      .single();

    const status = String(profile?.status || '').toLowerCase();
    const isAdminOrSuporte = status === 'super_admin' || status === 'admin' || status === 'suporte';
    if (!isAdminOrSuporte && profile?.zaploto_id !== config.zaploto_id) {
      return errorResponse('Acesso negado a esta configuração', 403);
    }

    const templates = await listApprovedTemplates({
      id: config.id,
      phone_number_id: config.phone_number_id,
      waba_id: config.waba_id,
      graph_version: config.graph_version,
      access_token: config.access_token,
    });

    return successResponse(templates);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Falha ao listar templates';
    return errorResponse(message, 502);
  }
}
