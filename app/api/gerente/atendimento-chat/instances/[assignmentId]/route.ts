/**
 * PATCH /api/gerente/atendimento-chat/instances/[assignmentId]
 * Body: { consultor_user_ids?: string[] | null; consultor_user_id?: string | null; crm_banca_id?: string | null }
 * Pelo menos um dos campos deve ser enviado.
 */

import { NextRequest } from 'next/server';
import { requireStatus } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { userHasCrmBanca } from '@/lib/utils/user-bancas';
import {
  normalizeConsultorUserIdsColumn,
  parseConsultorUserIdsPatch,
} from '@/lib/utils/atendimento-consultores';
import { validateConsultorIdsForAtendimentoAssignment } from '@/lib/server/atendimento-assignment-consultores';

function normalizeCrmBancaId(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === '') return null;
  return String(raw).trim() || null;
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ assignmentId: string }> }
) {
  try {
    const { userId } = await requireStatus(req, ['gerente', 'super_admin', 'admin']);
    const { assignmentId } = await context.params;

    if (!assignmentId) {
      return errorResponse('assignmentId é obrigatório', 400);
    }

    const body = await req.json().catch(() => ({})) as {
      consultor_user_ids?: string[] | null;
      consultor_user_id?: string | null;
      crm_banca_id?: string | null;
    };
    const patchConsultor =
      'consultor_user_ids' in body || 'consultor_user_id' in body;
    const patchBanca = 'crm_banca_id' in body;
    if (!patchConsultor && !patchBanca) {
      return errorResponse('Envie consultor_user_ids e/ou crm_banca_id.', 400);
    }

    const crmBancaPatch = patchBanca ? normalizeCrmBancaId(body.crm_banca_id) : undefined;

    const { data: row, error: fetchErr } = await supabaseServiceRole
      .from('atendimento_chat_assignments')
      .select('id, gerente_user_id, consultor_user_ids, crm_banca_id')
      .eq('id', assignmentId)
      .single();

    if (fetchErr || !row) {
      return errorResponse('Vínculo não encontrado', 404);
    }

    if (row.gerente_user_id !== userId) {
      const { data: prof } = await supabaseServiceRole
        .from('profiles')
        .select('status')
        .eq('id', userId)
        .single();
      const st = (prof?.status || '').toLowerCase();
      if (st !== 'super_admin' && st !== 'admin') {
        return errorResponse('Acesso negado.', 403);
      }
    }

    let nextIds = normalizeConsultorUserIdsColumn(row.consultor_user_ids);
    let nextBanca: string | null = row.crm_banca_id ?? null;

    if (patchBanca) {
      nextBanca = crmBancaPatch ?? null;
    }
    if (patchConsultor) {
      nextIds = parseConsultorUserIdsPatch(body);
    } else if (patchBanca) {
      nextIds = [];
    }

    if (nextBanca) {
      const owns = await userHasCrmBanca(row.gerente_user_id, nextBanca);
      if (!owns) {
        return errorResponse('Banca não disponível para este gerente.', 403);
      }
    }

    if (nextIds.length > 0) {
      const val = await validateConsultorIdsForAtendimentoAssignment(
        row.gerente_user_id,
        nextIds,
        nextBanca
      );
      if (!val.ok) return errorResponse(val.message, val.status);
    }

    const updatePayload: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (patchBanca) {
      updatePayload.crm_banca_id = nextBanca;
    }
    if (patchConsultor || patchBanca) {
      updatePayload.consultor_user_ids = nextIds;
    }

    const { data: updated, error: upErr } = await supabaseServiceRole
      .from('atendimento_chat_assignments')
      .update(updatePayload)
      .eq('id', assignmentId)
      .select()
      .single();

    if (upErr) {
      return errorResponse(`Erro ao atualizar: ${upErr.message}`, 500);
    }

    return successResponse(updated);
  } catch (err: unknown) {
    const msg = (err as Error)?.message || '';
    if (msg.includes('Acesso negado')) {
      return errorResponse(msg, 403);
    }
    return serverErrorResponse(err as Error);
  }
}
