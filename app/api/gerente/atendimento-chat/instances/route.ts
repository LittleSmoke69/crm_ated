/**
 * GET /api/gerente/atendimento-chat/instances — lista vínculos do gerente
 * POST /api/gerente/atendimento-chat/instances — cria instância Evolution + vínculo
 */

import { NextRequest } from 'next/server';
import { requireStatus, canAccessUser } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { createEvolutionChatInstance } from '@/lib/server/evolution-chat-instance-create';

export async function GET(req: NextRequest) {
  try {
    const { userId, profile } = await requireStatus(req, ['gerente', 'super_admin', 'admin']);

    let listQuery = supabaseServiceRole
      .from('atendimento_chat_assignments')
      .select(
        `
        id,
        evolution_instance_id,
        gerente_user_id,
        consultor_user_id,
        created_at,
        updated_at,
        evolution_instances (
          id,
          instance_name,
          status,
          is_active,
          is_chat_instance
        )
      `
      )
      .order('created_at', { ascending: false });

    const st = (profile.status || '').toLowerCase();
    if (st === 'gerente') {
      listQuery = listQuery.eq('gerente_user_id', userId);
    } else {
      const filterGerente = req.nextUrl.searchParams.get('gerente_id')?.trim();
      if (filterGerente) {
        listQuery = listQuery.eq('gerente_user_id', filterGerente);
      }
    }

    const { data: rows, error } = await listQuery;

    if (error) {
      return errorResponse(`Erro ao listar: ${error.message}`, 500);
    }

    return successResponse(rows || []);
  } catch (err: unknown) {
    const msg = (err as Error)?.message || '';
    if (msg.includes('Acesso negado')) {
      return errorResponse(msg, 403);
    }
    return serverErrorResponse(err as Error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { userId, profile } = await requireStatus(req, ['gerente', 'super_admin', 'admin']);

    const body = await req.json().catch(() => ({})) as {
      evolution_api_id?: string;
      instance_name?: string;
      maturation_type?: string;
      workspace_id?: string | null;
      consultor_user_id?: string | null;
      gerente_user_id?: string | null;
    };

    const { evolution_api_id, instance_name, maturation_type, workspace_id, consultor_user_id } = body;

    if (!evolution_api_id || !instance_name?.trim()) {
      return errorResponse('evolution_api_id e instance_name são obrigatórios', 400);
    }

    const st = (profile.status || '').toLowerCase();
    let gerenteOwnerId = userId;
    if (st === 'super_admin' || st === 'admin') {
      const gid = body.gerente_user_id?.trim();
      if (!gid) {
        return errorResponse('gerente_user_id é obrigatório quando o criador é admin/super_admin', 400);
      }
      gerenteOwnerId = gid;
    }

    if (consultor_user_id) {
      const allowed = await canAccessUser(gerenteOwnerId, consultor_user_id);
      if (!allowed) {
        return errorResponse('Consultor não pertence à hierarquia do gerente responsável.', 403);
      }
      const { data: consultorProfile } = await supabaseServiceRole
        .from('profiles')
        .select('status')
        .eq('id', consultor_user_id)
        .single();
      if ((consultorProfile?.status || '').toLowerCase() !== 'consultor') {
        return errorResponse('O usuário informado não é um consultor.', 400);
      }
    }

    const maturationTypeValue = maturation_type === 'virgem' ? 'virgem' : 'maturado';
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin;

    const { data: gerenteProfile } = await supabaseServiceRole
      .from('profiles')
      .select('zaploto_id')
      .eq('id', gerenteOwnerId)
      .single();

    const result = await createEvolutionChatInstance({
      evolutionApiId: evolution_api_id,
      instanceName: instance_name.trim(),
      ownerUserId: gerenteOwnerId,
      workspaceId: workspace_id ?? null,
      maturationType: maturationTypeValue,
      zaplotoId: gerenteProfile?.zaploto_id ?? null,
      appUrl,
    });

    if (!result.ok) {
      return errorResponse(result.error, result.status);
    }

    const instanceId = String(result.instance.id);

    const { error: assignError } = await supabaseServiceRole.from('atendimento_chat_assignments').insert({
      evolution_instance_id: instanceId,
      gerente_user_id: gerenteOwnerId,
      consultor_user_id: consultor_user_id || null,
    });

    if (assignError) {
      return errorResponse(`Instância criada, mas falha ao registrar vínculo: ${assignError.message}`, 500);
    }

    return successResponse(
      {
        instance: result.instance,
        qr_code: result.qr_code,
        evolution_data: result.evolution_data,
        warning: result.warning,
      },
      result.warning ? 'Instância criada com aviso' : 'Instância de atendimento criada com sucesso'
    );
  } catch (err: unknown) {
    const msg = (err as Error)?.message || '';
    if (msg.includes('Acesso negado')) {
      return errorResponse(msg, 403);
    }
    return serverErrorResponse(err as Error);
  }
}
