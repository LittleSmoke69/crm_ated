import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { requireAdminLeadTransferContext } from '@/lib/server/crm/adminLeadTransferContext';
import { createCrmRedistributionClient } from '@/lib/server/crm/crmRedistributionClient';

const LEAD_TYPES = ['registered', 'with_balance', 'has_won', 'has_withdrawn'] as const;
const LOG_PREFIX = '[admin/crm/lead-requests]';

/**
 * PATCH /api/admin/crm/lead-requests/[id]
 * Aprova, rejeita ou reabre uma solicitação de leads.
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
      leads_transferred_count: leadsTransferredCount,
      transfer_filters_snapshot: transferFiltersSnapshot,
      deadline_days: deadlineDays,
      transfer_log_id: transferLogId,
      rejection_observation: rejectionObservation,
    } = body;

    const { data: existing, error: fetchError } = await supabaseServiceRole
      .from('gerente_lead_requests')
      .select('id, status, consultores, approval_snapshot, banca_id, source_consultant_email, approved_at')
      .eq('id', id)
      .single();

    if (fetchError || !existing) {
      return errorResponse('Solicitação não encontrada.', 404);
    }

    // ── REOPEN ──────────────────────────────────────────────────────────
    if (status === 'reopen') {
      if (existing.status !== 'approved' && existing.status !== 'partial') {
        return errorResponse('Só é possível reabrir solicitações aprovadas ou parciais.', 400);
      }

      const requestBancaId = (existing.banca_id ?? '').toString().trim();
      const snapshot = existing.approval_snapshot as Record<string, unknown> | null;
      const sourceEmail = (
        existing.source_consultant_email
        ?? snapshot?.source_consultant_email
        ?? ''
      ).toString().trim();

      const existingConsultores = (existing.consultores ?? []) as { consultor_id: string; quantity: number }[];
      const consultorIds = existingConsultores.map((c) => c.consultor_id).filter(Boolean);
      let targetEmails: string[] = [];
      if (consultorIds.length > 0) {
        const { data: profiles } = await supabaseServiceRole
          .from('profiles')
          .select('id, email')
          .in('id', consultorIds);
        targetEmails = (profiles ?? [])
          .map((p: { id: string; email: string | null }) => p.email?.trim())
          .filter(Boolean) as string[];
      }

      // Encontrar transfer logs associados à solicitação
      const storedLogIds = Array.isArray(snapshot?.transfer_log_ids)
        ? (snapshot.transfer_log_ids as string[])
        : [];

      let transferLogIds = [...storedLogIds];

      if (transferLogIds.length === 0 && requestBancaId && sourceEmail && targetEmails.length > 0) {
        const { data: matchingLogs } = await supabaseServiceRole
          .from('admin_lead_transfer_logs')
          .select('id')
          .eq('banca_id', requestBancaId)
          .eq('source_consultant_email', sourceEmail)
          .in('target_consultant_email', targetEmails)
          .order('created_at', { ascending: false });
        transferLogIds = (matchingLogs ?? []).map((l: { id: string }) => l.id);
      }

      console.log(`${LOG_PREFIX} REOPEN request=${id}, transferLogIds=${JSON.stringify(transferLogIds)}, sourceEmail=${sourceEmail}, targetEmails=${JSON.stringify(targetEmails)}`);

      let totalReversed = 0;
      const allReversedLeadIds: string[] = [];

      if (transferLogIds.length > 0 && requestBancaId) {
        let crmClient: ReturnType<typeof createCrmRedistributionClient> | null = null;
        try {
          const ctx = await requireAdminLeadTransferContext(req, requestBancaId);
          crmClient = createCrmRedistributionClient(ctx.crmBaseUrl);
        } catch (err) {
          console.warn(`${LOG_PREFIX} REOPEN CRM context failed (reversal skipped):`, err instanceof Error ? err.message : err);
        }

        for (const logId of transferLogIds) {
          const { data: log } = await supabaseServiceRole
            .from('admin_lead_transfer_logs')
            .select('source_consultant_email, target_consultant_email, leads_ids')
            .eq('id', logId)
            .single();

          if (!log?.source_consultant_email || !log?.target_consultant_email) continue;

          const { data: entries } = await supabaseServiceRole
            .from('admin_lead_transfer_entries')
            .select('lead_id')
            .eq('transfer_log_id', logId)
            .eq('banca_id', requestBancaId)
            .is('resolution_status', null);

          let leadIds = (entries ?? []).map((e: { lead_id: string }) => String(e.lead_id)).filter(Boolean);

          if (leadIds.length === 0) {
            const { data: pendingEntries } = await supabaseServiceRole
              .from('admin_lead_transfer_entries')
              .select('lead_id, resolution_status')
              .eq('transfer_log_id', logId)
              .eq('banca_id', requestBancaId)
              .not('resolution_status', 'in', '("devolvido","reversed")');
            leadIds = (pendingEntries ?? []).map((e: { lead_id: string }) => String(e.lead_id)).filter(Boolean);
          }

          if (leadIds.length === 0) {
            const rawIds = Array.isArray(log.leads_ids) ? log.leads_ids : [];
            leadIds = rawIds.map((lid: unknown) => String(lid).trim()).filter(Boolean);
          }

          if (leadIds.length === 0) continue;

          // Reverter no CRM: mover leads de volta (target → source)
          if (crmClient) {
            try {
              const normalizedIds = leadIds.map((lid) => {
                const n = Number(lid);
                return Number.isFinite(n) ? n : lid;
              });
              const result = await crmClient.redistributeLeads({
                source_consultant_email: log.target_consultant_email,
                target_consultant_email: log.source_consultant_email,
                leads_ids: normalizedIds,
              });
              if (result.success) {
                totalReversed += leadIds.length;
                console.log(`${LOG_PREFIX} REOPEN CRM reverse OK: log=${logId}, leads=${leadIds.length}`);
              } else {
                console.warn(`${LOG_PREFIX} REOPEN CRM reverse failed: log=${logId}, error=${result.error ?? result.message}`);
              }
            } catch (crmErr) {
              console.warn(`${LOG_PREFIX} REOPEN CRM reverse exception: log=${logId}`, crmErr instanceof Error ? crmErr.message : crmErr);
            }
          }

          // Marcar entries da transferência como devolvido
          const now = new Date().toISOString();
          await supabaseServiceRole
            .from('admin_lead_transfer_entries')
            .update({ resolution_status: 'devolvido', resolved_at: now })
            .eq('transfer_log_id', logId)
            .eq('banca_id', requestBancaId)
            .in('lead_id', leadIds);

          allReversedLeadIds.push(...leadIds);

          console.log(`${LOG_PREFIX} REOPEN entries marked devolvido: log=${logId}, count=${leadIds.length}`);
        }

        // Restaurar entries originais que foram marcadas como 'repassado'
        if (allReversedLeadIds.length > 0) {
          const uniqueLeadIds = [...new Set(allReversedLeadIds)];
          const { error: restoreError, count: restoredCount } = await supabaseServiceRole
            .from('admin_lead_transfer_entries')
            .update({ resolution_status: 'disponivel_retransferencia', resolved_at: null })
            .eq('banca_id', requestBancaId)
            .in('lead_id', uniqueLeadIds)
            .eq('resolution_status', 'repassado');

          if (restoreError) {
            console.warn(`${LOG_PREFIX} REOPEN restore source entries error:`, restoreError);
          } else {
            console.log(`${LOG_PREFIX} REOPEN source entries restored to disponivel_retransferencia: ${restoredCount ?? 0}`);
          }
        }
      }

      // Reset da solicitação
      const { error: updateError } = await supabaseServiceRole
        .from('gerente_lead_requests')
        .update({
          status: 'pending',
          approved_by_user_id: null,
          approved_at: null,
          source_consultant_id: null,
          source_consultant_email: null,
          approval_snapshot: null,
        })
        .eq('id', id);

      if (updateError) {
        console.error(`${LOG_PREFIX} PATCH reopen error:`, updateError);
        return errorResponse('Erro ao reabrir solicitação.', 500);
      }

      const msg = totalReversed > 0
        ? `Solicitação reaberta. ${totalReversed} lead(s) devolvido(s) ao consultor de origem.`
        : 'Solicitação reaberta com sucesso.';
      return successResponse({ id, status: 'pending', leads_reversed: totalReversed }, msg);
    }

    // ── REJECT / APPROVE ────────────────────────────────────────────────
    const canUpdate = existing.status === 'pending' || existing.status === 'partial';
    if (!canUpdate) {
      return errorResponse('Esta solicitação já foi finalizada (aprovada ou rejeitada).', 400);
    }

    if (status === 'rejected') {
      if (existing.status !== 'pending') {
        return errorResponse('Só é possível rejeitar solicitações pendentes.', 400);
      }
      const rejectionObsTrimmed = typeof rejectionObservation === 'string' ? rejectionObservation.trim() : '';
      const { error: updateError } = await supabaseServiceRole
        .from('gerente_lead_requests')
        .update({
          status: 'rejected',
          approved_by_user_id: userId,
          approved_at: new Date().toISOString(),
          ...(rejectionObsTrimmed ? { rejection_observation: rejectionObsTrimmed } : {}),
        })
        .eq('id', id);
      if (updateError) {
        console.error(`${LOG_PREFIX} PATCH reject error:`, updateError);
        return errorResponse('Erro ao rejeitar solicitação.', 500);
      }
      return successResponse({ id, status: 'rejected' }, 'Solicitação rejeitada.');
    }

    if (status === 'approved') {
      const idFromBody =
        typeof sourceConsultantId === 'string' && sourceConsultantId.trim() ? sourceConsultantId.trim() : '';
      const emailFromBody =
        sourceConsultantEmail != null && String(sourceConsultantEmail).trim()
          ? String(sourceConsultantEmail).trim()
          : '';
      const emailFromExisting = (existing.source_consultant_email ?? '').toString().trim();
      const candidateEmail = emailFromBody || emailFromExisting;

      let resolvedSourceId = idFromBody;
      if (!resolvedSourceId && candidateEmail) {
        const { data: profByEmail } = await supabaseServiceRole
          .from('profiles')
          .select('id')
          .ilike('email', candidateEmail)
          .maybeSingle();
        if (profByEmail?.id) {
          resolvedSourceId = String(profByEmail.id);
        }
      }

      if (!resolvedSourceId) {
        return errorResponse(
          'Ao aprovar, informe o consultor doador (source_consultant_id) ou um e-mail válido (source_consultant_email) para localizar o perfil.',
          400,
        );
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
        source_consultant_id: resolvedSourceId,
      };
      updatePayload.source_consultant_email = candidateEmail || null;
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
      const totalRequested = Array.isArray(consultores)
        ? consultores.reduce((s: number, c: { quantity?: number }) => s + ((c as { quantity: number }).quantity ?? 0), 0)
        : (existing.consultores ?? []).reduce((s: number, c: { quantity?: number }) => s + ((c as { quantity: number }).quantity ?? 0), 0);
      const prevSnap = (existing.approval_snapshot ?? {}) as { total_leads_transferred?: number; leads_transferred_count?: number; transfer_log_ids?: string[] };
      const existingTransferred = prevSnap.total_leads_transferred ?? prevSnap.leads_transferred_count ?? 0;
      const existingLogIds = Array.isArray(prevSnap.transfer_log_ids) ? prevSnap.transfer_log_ids : [];
      const newLogId = typeof transferLogId === 'string' && transferLogId.trim() ? transferLogId.trim() : null;
      let computedTransferredFromLog: number | null = null;
      if (newLogId) {
        const { data: transferLogRow } = await supabaseServiceRole
          .from('admin_lead_transfer_logs')
          .select('count')
          .eq('id', newLogId)
          .maybeSingle();
        const logCount = Number((transferLogRow as { count?: unknown } | null)?.count);
        if (Number.isFinite(logCount) && logCount >= 0) {
          computedTransferredFromLog = logCount;
        } else {
          const { count: entryCount } = await supabaseServiceRole
            .from('admin_lead_transfer_entries')
            .select('id', { count: 'exact', head: true })
            .eq('transfer_log_id', newLogId);
          if (typeof entryCount === 'number' && Number.isFinite(entryCount) && entryCount >= 0) {
            computedTransferredFromLog = entryCount;
          }
        }
      }

      const payloadTransferredCount =
        typeof leadsTransferredCount === 'number' && Number.isInteger(leadsTransferredCount) && leadsTransferredCount >= 0
          ? leadsTransferredCount
          : 0;
      const alreadyCountedThisLog = newLogId ? existingLogIds.includes(newLogId) : false;
      const newBatch = alreadyCountedThisLog ? 0 : (computedTransferredFromLog ?? payloadTransferredCount);
      const cumulativeTransferred = existingTransferred + newBatch;
      const isComplete = cumulativeTransferred >= totalRequested;
      updatePayload.status = isComplete ? 'approved' : 'partial';
      const allLogIds = newLogId ? [...new Set([...existingLogIds, newLogId])] : existingLogIds;

      if (hasTransferMetadata) {
        updatePayload.approval_snapshot = {
          approved_at_iso: approvedAtIso,
          approved_by_user_id: userId,
          source_consultant_id: resolvedSourceId,
          source_consultant_email: candidateEmail || null,
          banca_id: bancaId != null ? (bancaId === '' ? null : bancaId) : null,
          leads_transferred_count: cumulativeTransferred,
          total_leads_transferred: cumulativeTransferred,
          transfer_filters_snapshot: transferFiltersSnapshot != null && typeof transferFiltersSnapshot === 'object' ? transferFiltersSnapshot : null,
          transfer_log_ids: allLogIds.length > 0 ? allLogIds : undefined,
        };
      }

      const { error: updateError } = await supabaseServiceRole
        .from('gerente_lead_requests')
        .update(updatePayload)
        .eq('id', id);
      if (updateError) {
        console.error(`${LOG_PREFIX} PATCH approve error:`, updateError);
        return errorResponse('Erro ao aprovar solicitação.', 500);
      }
      return successResponse({ id, status: updatePayload.status }, 'Solicitação aprovada.');
    }

    return errorResponse('Informe status: approved, rejected ou reopen.', 400);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Acesso negado') || msg.includes('não tem permissão')) {
      return errorResponse(msg, 403);
    }
    return serverErrorResponse(err);
  }
}
