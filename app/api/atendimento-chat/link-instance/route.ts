/**
 * POST /api/atendimento-chat/link-instance
 * Cria ou atualiza vínculo em atendimento_chat_assignments para liberar a instância no chat-atendimento
 * (gerente/dono na linha gerente_user_id; consultor opcional na prática aqui é obrigatório no body).
 */

import { NextRequest } from 'next/server';
import { requireStatus, canAccessUser, getUserProfile } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export async function POST(req: NextRequest) {
  try {
    const { userId, profile } = await requireStatus(req, [
      'gerente',
      'dono_banca',
      'super_admin',
      'admin',
    ]);

    const body = (await req.json().catch(() => ({}))) as {
      evolution_instance_id?: string;
      consultor_user_id?: string;
      gerente_user_id?: string | null;
    };

    const instanceId = body.evolution_instance_id?.trim();
    const consultorId = body.consultor_user_id?.trim();

    if (!instanceId) {
      return errorResponse('evolution_instance_id é obrigatório', 400);
    }
    if (!consultorId) {
      return errorResponse('consultor_user_id é obrigatório', 400);
    }

    const st = (profile.status || '').toLowerCase();

    const { data: instance, error: instErr } = await supabaseServiceRole
      .from('evolution_instances')
      .select('id, user_id, is_active')
      .eq('id', instanceId)
      .maybeSingle();

    if (instErr || !instance) {
      return errorResponse('Instância não encontrada', 404);
    }
    if (instance.is_active !== true) {
      return errorResponse('Instância inativa não pode ser vinculada', 400);
    }

    let assignmentGerenteId = userId;

    if (st === 'super_admin' || st === 'admin') {
      const gid = body.gerente_user_id?.trim();
      if (!gid) {
        return errorResponse('gerente_user_id é obrigatório quando o solicitante é admin', 400);
      }
      assignmentGerenteId = gid;
    } else {
      const ownerId = instance.user_id as string;
      const isOwner = ownerId === userId;
      const inHierarchy = await canAccessUser(userId, ownerId);
      if (!isOwner && !inHierarchy) {
        return errorResponse('Você não pode vincular esta instância', 403);
      }
    }

    const canPickConsultor =
      st === 'super_admin' || st === 'admin'
        ? true
        : await canAccessUser(userId, consultorId);

    if (!canPickConsultor) {
      return errorResponse('Consultor fora da sua hierarquia', 403);
    }

    const { data: consultorProfile, error: cpErr } = await supabaseServiceRole
      .from('profiles')
      .select('id, status')
      .eq('id', consultorId)
      .maybeSingle();

    if (cpErr || !consultorProfile) {
      return errorResponse('Consultor não encontrado', 404);
    }
    if ((consultorProfile.status || '').toLowerCase() !== 'consultor') {
      return errorResponse('O usuário informado não é um consultor', 400);
    }

    if (st === 'super_admin' || st === 'admin') {
      const gProf = await getUserProfile(assignmentGerenteId);
      if (!gProf) {
        return errorResponse('gerente_user_id inválido', 400);
      }
    }

    const { data: existingAssignment, error: existingErr } = await supabaseServiceRole
      .from('atendimento_chat_assignments')
      .select('id, consultor_user_id')
      .eq('evolution_instance_id', instanceId)
      .maybeSingle();

    if (existingErr) {
      return errorResponse(`Falha ao validar vínculo atual: ${existingErr.message}`, 500);
    }

    if (
      existingAssignment?.consultor_user_id &&
      existingAssignment.consultor_user_id !== consultorId
    ) {
      return errorResponse(
        'Esta instância já está vinculada a outro consultor. Remova o vínculo atual antes de trocar.',
        409
      );
    }

    const { error: upsertErr } = await supabaseServiceRole.from('atendimento_chat_assignments').upsert(
      {
        evolution_instance_id: instanceId,
        gerente_user_id: assignmentGerenteId,
        consultor_user_id: consultorId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'evolution_instance_id' }
    );

    if (upsertErr) {
      return errorResponse(`Falha ao salvar vínculo: ${upsertErr.message}`, 500);
    }

    return successResponse({ evolution_instance_id: instanceId, consultor_user_id: consultorId }, 'Instância vinculada ao consultor');
  } catch (err: unknown) {
    const msg = (err as Error)?.message || '';
    if (msg.includes('Acesso negado')) {
      return errorResponse(msg, 403);
    }
    return serverErrorResponse(err as Error);
  }
}
