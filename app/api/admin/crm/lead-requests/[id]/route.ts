import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

const LEAD_TYPES = ['registered', 'with_balance', 'has_won', 'has_withdrawn'] as const;

/**
 * PATCH /api/admin/crm/lead-requests/[id]
 * Aprova (ou rejeita) uma solicitação. No approve: pode alterar lead_type, consultores e deve informar source_consultant_id (consultor doador) e opcionalmente banca_id.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId } = await requireAdmin(req);
    const { id } = await params;
    if (!id) return errorResponse('ID da solicitação é obrigatório.', 400);

    const body = await req.json();
    const {
      status,
      lead_type: leadType,
      consultores,
      source_consultant_id: sourceConsultantId,
      source_consultant_email: sourceConsultantEmail,
      banca_id: bancaId,
      /** Quantidade de leads efetivamente transferidos (ao confirmar transferência na aba Transferir). */
      leads_transferred_count: leadsTransferredCount,
      /** Filtros usados na busca (step 3: inatividade; step 4: demais filtros). */
      transfer_filters_snapshot: transferFiltersSnapshot,
      /** Prazo em dias para conversão (escolhido no passo Destino ao confirmar transferência). */
      deadline_days: deadlineDays,
    } = body;

    const { data: existing, error: fetchError } = await supabaseServiceRole
      .from('gerente_lead_requests')
      .select('id, status')
      .eq('id', id)
      .single();

    if (fetchError || !existing) {
      return errorResponse('Solicitação não encontrada.', 404);
    }
    if (existing.status !== 'pending') {
      return errorResponse('Esta solicitação já foi processada.', 400);
    }

    if (status === 'rejected') {
      const { error: updateError } = await supabaseServiceRole
        .from('gerente_lead_requests')
        .update({
          status: 'rejected',
          approved_by_user_id: userId,
          approved_at: new Date().toISOString(),
        })
        .eq('id', id);
      if (updateError) {
        console.error('[admin/crm/lead-requests] PATCH reject error:', updateError);
        return errorResponse('Erro ao rejeitar solicitação.', 500);
      }
      return successResponse({ id, status: 'rejected' }, 'Solicitação rejeitada.');
    }

    if (status === 'approved') {
      if (!sourceConsultantId || typeof sourceConsultantId !== 'string' || !sourceConsultantId.trim()) {
        return errorResponse('Ao aprovar, informe o consultor doador (source_consultant_id).', 400);
      }

      const approvedAtIso = new Date().toISOString();
      const updatePayload: {
        status: string;
        approved_by_user_id: string;
        approved_at: string;
        source_consultant_id: string;
        source_consultant_email?: string | null;
        banca_id?: string | null;
        lead_type?: string;
        consultores?: unknown;
        deadline_days?: number | null;
        approval_snapshot?: Record<string, unknown>;
      } = {
        status: 'approved',
        approved_by_user_id: userId,
        approved_at: approvedAtIso,
        source_consultant_id: sourceConsultantId.trim(),
      };
      if (sourceConsultantEmail != null) updatePayload.source_consultant_email = String(sourceConsultantEmail).trim() || null;
      if (bancaId != null) updatePayload.banca_id = bancaId === '' ? null : bancaId;

      if (leadType != null) {
        const types = Array.isArray(leadType)
          ? leadType.filter((t: unknown) => typeof t === 'string' && LEAD_TYPES.includes(t as typeof LEAD_TYPES[number]))
          : typeof leadType === 'string' && LEAD_TYPES.includes(leadType as typeof LEAD_TYPES[number])
            ? [leadType]
            : [];
        if (types.length > 0) {
          updatePayload.lead_type = [...new Set(types)].join(',');
        }
      }
      if (Array.isArray(consultores) && consultores.length > 0) {
        const valid = consultores.every((c: unknown) => typeof c === 'object' && c !== null && 'consultor_id' in c && 'quantity' in c);
        if (valid) {
          updatePayload.consultores = consultores;
        }
      }
      if (deadlineDays != null && typeof deadlineDays === 'number' && Number.isInteger(deadlineDays) && deadlineDays >= 1 && deadlineDays <= 365) {
        updatePayload.deadline_days = deadlineDays;
      } else if (deadlineDays === null || deadlineDays === '') {
        updatePayload.deadline_days = null;
      }

      const hasTransferMetadata =
        (typeof leadsTransferredCount === 'number' && Number.isInteger(leadsTransferredCount) && leadsTransferredCount >= 0) ||
        (transferFiltersSnapshot != null && typeof transferFiltersSnapshot === 'object');
      if (hasTransferMetadata) {
        updatePayload.approval_snapshot = {
          approved_at_iso: approvedAtIso,
          approved_by_user_id: userId,
          source_consultant_id: sourceConsultantId.trim(),
          source_consultant_email: sourceConsultantEmail != null ? String(sourceConsultantEmail).trim() || null : null,
          banca_id: bancaId != null ? (bancaId === '' ? null : bancaId) : null,
          leads_transferred_count: typeof leadsTransferredCount === 'number' && Number.isInteger(leadsTransferredCount) && leadsTransferredCount >= 0 ? leadsTransferredCount : null,
          transfer_filters_snapshot: transferFiltersSnapshot != null && typeof transferFiltersSnapshot === 'object' ? transferFiltersSnapshot : null,
        };
      }

      const { error: updateError } = await supabaseServiceRole
        .from('gerente_lead_requests')
        .update(updatePayload)
        .eq('id', id);
      if (updateError) {
        console.error('[admin/crm/lead-requests] PATCH approve error:', updateError);
        return errorResponse('Erro ao aprovar solicitação.', 500);
      }
      return successResponse({ id, status: 'approved' }, 'Solicitação aprovada.');
    }

    return errorResponse('Informe status: approved ou rejected.', 400);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Acesso negado') || msg.includes('não tem permissão')) {
      return errorResponse(msg, 403);
    }
    return serverErrorResponse(err);
  }
}
