/**
 * /api/chat/flow-config
 *
 * Gerencia a associação de um Flow (automação) a uma instância Evolution no chat.
 * GET  ?instance_id=...  → retorna o flow configurado para a instância
 * PUT  {instance_id, flow_id, is_active} → cria/atualiza associação
 * DELETE ?instance_id=... → remove associação
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const { searchParams } = new URL(req.url);
    const instance_id = searchParams.get('instance_id');

    if (!instance_id) return errorResponse('instance_id é obrigatório', 400);

    const { data, error } = await supabaseServiceRole
      .from('chat_instance_flows')
      .select(`
        id, instance_id, is_active, created_at, updated_at,
        flows:flow_id (id, name, description, status)
      `)
      .eq('instance_id', instance_id)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) return errorResponse(error.message, 500);
    return successResponse(data);
  } catch (err) {
    return serverErrorResponse(err as Error);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const body = await req.json() as {
      instance_id: string;
      flow_id: string | null;
      is_active?: boolean;
    };

    const { instance_id, flow_id, is_active = true } = body;
    if (!instance_id) return errorResponse('instance_id é obrigatório', 400);

    // Validar que o usuário tem acesso à instância
    const { data: instance } = await supabaseServiceRole
      .from('evolution_instances')
      .select('id, user_id')
      .eq('id', instance_id)
      .maybeSingle();

    if (!instance) return errorResponse('Instância não encontrada', 404);

    // Verificar perfil para acesso multi-tenant
    const { data: profile } = await supabaseServiceRole
      .from('profiles')
      .select('status')
      .eq('id', userId)
      .single();

    const isAdmin = profile?.status === 'super_admin' || profile?.status === 'admin';
    if (!isAdmin && instance.user_id !== userId) {
      return errorResponse('Acesso negado', 403);
    }

    // Se flow_id === null, remove a associação
    if (flow_id === null) {
      await supabaseServiceRole
        .from('chat_instance_flows')
        .delete()
        .eq('instance_id', instance_id)
        .eq('user_id', userId);
      return successResponse(null, 'Flow removido da instância');
    }

    // Valida que o flow existe e está ativo
    const { data: flow } = await supabaseServiceRole
      .from('flows')
      .select('id, name, status')
      .eq('id', flow_id)
      .maybeSingle();

    if (!flow) return errorResponse('Flow não encontrado', 404);

    const upsertData = {
      instance_id,
      flow_id,
      user_id: userId,
      is_active,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabaseServiceRole
      .from('chat_instance_flows')
      .upsert(upsertData, { onConflict: 'instance_id' })
      .select(`
        id, instance_id, is_active,
        flows:flow_id (id, name, description, status)
      `)
      .single();

    if (error) return errorResponse(error.message, 500);
    return successResponse(data, 'Flow configurado com sucesso');
  } catch (err) {
    return serverErrorResponse(err as Error);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const { searchParams } = new URL(req.url);
    const instance_id = searchParams.get('instance_id');

    if (!instance_id) return errorResponse('instance_id é obrigatório', 400);

    await supabaseServiceRole
      .from('chat_instance_flows')
      .delete()
      .eq('instance_id', instance_id)
      .eq('user_id', userId);

    return successResponse(null, 'Flow desvinculado');
  } catch (err) {
    return serverErrorResponse(err as Error);
  }
}
