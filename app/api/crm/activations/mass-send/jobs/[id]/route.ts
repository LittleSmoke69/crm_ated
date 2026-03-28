/**
 * GET /api/crm/activations/mass-send/jobs/[id]
 * Detalhe da campanha (inclui resultados por grupo para sucesso/falha).
 *
 * PATCH /api/crm/activations/mass-send/jobs/[id]
 * body: { action: 'pause' | 'resume' }
 *
 * DELETE /api/crm/activations/mass-send/jobs/[id]
 * Exclui uma campanha de disparo em massa (apenas se pertencer ao usuário).
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { triggerMassSendProcessFromOrigin } from '@/lib/crm/trigger-mass-send-process';

export const dynamic = 'force-dynamic';

function isNoRowsError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === 'PGRST116') return true;
  const msg = String(error.message || '').toLowerCase();
  return msg.includes('0 rows') || msg.includes('multiple (or no) rows');
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await requireAuth(req);
    const { id: rawId } = await params;
    const jobId = typeof rawId === 'string' ? rawId.trim() : '';

    if (!jobId) {
      return errorResponse('ID da campanha é obrigatório', 400);
    }

    // select('*') evita 404 falso quando migrations opcionais (group_results, inter_group_delay_ms) ainda não rodaram.
    const { data: job, error: fetchError } = await supabaseServiceRole
      .from('activation_mass_send_jobs')
      .select('*')
      .eq('id', jobId)
      .maybeSingle();

    if (fetchError && !isNoRowsError(fetchError)) {
      console.error('[MASS-SEND] GET job: erro Supabase (não é “sem linhas”):', fetchError.code, fetchError.message);
      return errorResponse('Erro ao carregar campanha. Verifique o banco ou tente novamente.', 500);
    }

    if (!job) {
      return errorResponse('Campanha não encontrada', 404);
    }

    if (job.user_id !== userId) {
      return errorResponse('Sem permissão para ver esta campanha', 403);
    }

    const { data: groupRows, error: groupsErr } = await supabaseServiceRole
      .from('activation_mass_send_job_groups')
      .select('group_id, success, error_message, created_at')
      .eq('job_id', jobId)
      .order('created_at', { ascending: true });

    if (groupsErr) {
      console.warn('[MASS-SEND] GET job: activation_mass_send_job_groups indisponível (rode a migration?):', groupsErr.message);
    }

    // Busca nomes dos grupos na tabela whatsapp_groups para exibir no modal.
    const allGroupIds = Array.isArray(job.group_ids) ? (job.group_ids as string[]) : [];
    let groupNameMap: Record<string, string> = {};
    if (allGroupIds.length > 0) {
      const { data: groupNames } = await supabaseServiceRole
        .from('whatsapp_groups')
        .select('group_id, group_subject')
        .eq('instance_name', job.instance_name)
        .eq('user_id', userId)
        .in('group_id', allGroupIds);
      if (Array.isArray(groupNames)) {
        for (const g of groupNames) {
          if (g.group_id && g.group_subject) {
            groupNameMap[g.group_id] = g.group_subject;
          }
        }
      }
    }

    const group_outcomes =
      !groupsErr && Array.isArray(groupRows) && groupRows.length > 0
        ? groupRows.map((r: { group_id: string; success: boolean; error_message: string | null }) => ({
            groupId: r.group_id,
            groupName: groupNameMap[r.group_id] || null,
            success: r.success === true,
            ...(r.error_message ? { error: r.error_message } : {}),
          }))
        : undefined;

    // Se não há group_outcomes (tabela indisponível), monta a partir de group_ids + group_results legado.
    const payload =
      group_outcomes !== undefined ? { ...job, group_outcomes, groupNameMap } : { ...job, groupNameMap };

    return successResponse(payload);
  } catch (e) {
    return serverErrorResponse(e);
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await requireAuth(req);
    const { id: rawId } = await params;
    const jobId = typeof rawId === 'string' ? rawId.trim() : '';

    if (!jobId) {
      return errorResponse('ID da campanha é obrigatório', 400);
    }

    let body: { action?: string };
    try {
      body = await req.json();
    } catch {
      return errorResponse('JSON inválido', 400);
    }

    const action = body?.action;
    if (action !== 'pause' && action !== 'resume') {
      return errorResponse('action deve ser "pause" ou "resume"', 400);
    }

    const { data: job, error: fetchError } = await supabaseServiceRole
      .from('activation_mass_send_jobs')
      .select('id, user_id, status')
      .eq('id', jobId)
      .maybeSingle();

    if (fetchError || !job) {
      return errorResponse('Campanha não encontrada', 404);
    }

    if (job.user_id !== userId) {
      return errorResponse('Sem permissão', 403);
    }

    const now = new Date().toISOString();

    if (action === 'pause') {
      if (job.status !== 'pending' && job.status !== 'processing') {
        return errorResponse('Só é possível pausar campanhas pendentes ou em andamento.', 400);
      }
      const { error: upErr } = await supabaseServiceRole
        .from('activation_mass_send_jobs')
        .update({
          status: 'paused',
          locked_at: null,
          locked_by: null,
          updated_at: now,
        })
        .eq('id', jobId);

      if (upErr) {
        console.error('[MASS-SEND] pause:', upErr);
        return errorResponse('Erro ao pausar. Rode a migration com status "paused" ou tente novamente.', 500);
      }
      return successResponse({ status: 'paused' }, 'Campanha pausada.');
    }

    if (job.status !== 'paused') {
      return errorResponse('Só é possível retomar campanhas pausadas.', 400);
    }

    const { error: upErr } = await supabaseServiceRole
      .from('activation_mass_send_jobs')
      .update({ status: 'pending', updated_at: now })
      .eq('id', jobId);

    if (upErr) {
      console.error('[MASS-SEND] resume:', upErr);
      return errorResponse('Erro ao retomar campanha.', 500);
    }

    const origin = req.nextUrl?.origin || new URL(req.url).origin;
    triggerMassSendProcessFromOrigin(origin);

    return successResponse({ status: 'pending' }, 'Campanha retomada. O envio continuará em breve.');
  } catch (e) {
    return serverErrorResponse(e);
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await requireAuth(_req);
    const { id: jobId } = await params;

    if (!jobId) {
      return errorResponse('ID da campanha é obrigatório', 400);
    }

    const { data: job, error: fetchError } = await supabaseServiceRole
      .from('activation_mass_send_jobs')
      .select('id, user_id')
      .eq('id', jobId)
      .single();

    if (fetchError || !job) {
      return errorResponse('Campanha não encontrada', 404);
    }

    if (job.user_id !== userId) {
      return errorResponse('Sem permissão para excluir esta campanha', 403);
    }

    const { error: deleteError } = await supabaseServiceRole
      .from('activation_mass_send_jobs')
      .delete()
      .eq('id', jobId);

    if (deleteError) {
      console.error('[MASS-SEND] Erro ao excluir job:', deleteError);
      return errorResponse('Erro ao excluir campanha. Tente novamente.', 500);
    }

    return successResponse({ deleted: true }, 'Campanha excluída com sucesso');
  } catch (e) {
    return serverErrorResponse(e);
  }
}
