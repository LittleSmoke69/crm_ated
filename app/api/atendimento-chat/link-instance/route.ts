/**
 * POST /api/atendimento-chat/link-instance
 * Cria ou atualiza vínculo em atendimento_chat_assignments (acrescenta consultor(es) à lista).
 */

import { NextRequest } from 'next/server';
import { requireStatus, canAccessUser, getUserProfile } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { normalizeConsultorUserIdsColumn, parseConsultorUserIdsPatch } from '@/lib/utils/atendimento-consultores';
import { validateConsultorIdsForAtendimentoAssignment } from '@/lib/server/atendimento-assignment-consultores';

export async function POST(req: NextRequest) {
  try {
    const { userId, profile } = await requireStatus(req, ['gerente', 'super_admin', 'admin']);

    const body = (await req.json().catch(() => ({}))) as {
      evolution_instance_id?: string;
      consultor_user_id?: string;
      consultor_user_ids?: string[];
      gerente_user_id?: string | null;
    };

    const instanceId = body.evolution_instance_id?.trim();
    const toAdd = parseConsultorUserIdsPatch(body);

    if (!instanceId) {
      return errorResponse('evolution_instance_id é obrigatório', 400);
    }
    if (toAdd.length === 0) {
      return errorResponse('Informe consultor_user_id ou consultor_user_ids.', 400);
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

    for (const consultorId of toAdd) {
      const canPickConsultor =
        st === 'super_admin' || st === 'admin'
          ? true
          : await canAccessUser(userId, consultorId);

      if (!canPickConsultor) {
        return errorResponse('Consultor fora da sua hierarquia', 403);
      }
    }

    const val = await validateConsultorIdsForAtendimentoAssignment(assignmentGerenteId, toAdd, null);
    if (!val.ok) return errorResponse(val.message, val.status);

    if (st === 'super_admin' || st === 'admin') {
      const gProf = await getUserProfile(assignmentGerenteId);
      if (!gProf) {
        return errorResponse('gerente_user_id inválido', 400);
      }
    }

    const { data: existingAssignment, error: existingErr } = await supabaseServiceRole
      .from('atendimento_chat_assignments')
      .select('id, gerente_user_id, consultor_user_ids')
      .eq('evolution_instance_id', instanceId)
      .maybeSingle();

    if (existingErr) {
      return errorResponse(`Falha ao validar vínculo atual: ${existingErr.message}`, 500);
    }

    if (existingAssignment && existingAssignment.gerente_user_id !== assignmentGerenteId) {
      return errorResponse(
        'Esta instância já possui vínculo de atendimento com outro gerente.',
        409
      );
    }

    const prev = normalizeConsultorUserIdsColumn(
      (existingAssignment as { consultor_user_ids?: unknown } | null)?.consultor_user_ids
    );
    const next = [...new Set([...prev, ...toAdd])];

    const { error: upsertErr } = await supabaseServiceRole.from('atendimento_chat_assignments').upsert(
      {
        evolution_instance_id: instanceId,
        gerente_user_id: assignmentGerenteId,
        consultor_user_ids: next,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'evolution_instance_id' }
    );

    if (upsertErr) {
      return errorResponse(`Falha ao salvar vínculo: ${upsertErr.message}`, 500);
    }

    return successResponse(
      { evolution_instance_id: instanceId, consultor_user_ids: next },
      'Instância vinculada ao(s) consultor(es)'
    );
  } catch (err: unknown) {
    const msg = (err as Error)?.message || '';
    if (msg.includes('Acesso negado')) {
      return errorResponse(msg, 403);
    }
    return serverErrorResponse(err as Error);
  }
}
