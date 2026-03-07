import { NextRequest } from 'next/server';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { requireAdminLeadTransferContext, isConsultantInBanca } from '@/lib/server/crm/adminLeadTransferContext';
import { createCrmRedistributionClient } from '@/lib/server/crm/crmRedistributionClient';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { z } from 'zod';

const transferTypeEnum = z.enum(['TF', 'TF1', 'TF2', 'TF3']);

const leadSnapshotSchema = z.object({
  lead_id: z.union([z.number(), z.string()]),
  balance: z.union([z.number(), z.null()]).optional(),
  last_interaction: z.union([z.string(), z.null()]).optional(),
  total_depositado: z.union([z.number(), z.null()]).optional(),
  total_apostado: z.union([z.number(), z.null()]).optional(),
  total_ganho: z.union([z.number(), z.null()]).optional(),
  available_withdraw: z.union([z.number(), z.null()]).optional(),
  total_saque: z.union([z.number(), z.null()]).optional(),
});
const bodySchema = z.object({
  banca_id: z.string().uuid(),
  source_consultant_email: z.string().email(),
  target_consultant_email: z.string().email(),
  leads_ids: z.array(z.union([z.number(), z.string()])).min(1),
  transfer_type: transferTypeEnum.optional().default('TF'),
  /** Prazo em dias para conversão (definido pelo usuário no passo Destino). */
  transfer_deadline_days: z.number().int().min(1).max(365).optional().default(10),
  filters_snapshot: z.record(z.string(), z.unknown()).optional(),
  lead_snapshots: z.array(leadSnapshotSchema).optional(),
  /** ID do log de origem (ao mover do modal Mover leads). Marca entries como repassado para removê-las da lista. */
  source_transfer_log_id: z.string().uuid().optional(),
}).refine(
  (data) => data.source_consultant_email.toLowerCase() !== data.target_consultant_email.toLowerCase(),
  { message: 'Consultor origem e destino devem ser diferentes.', path: ['target_consultant_email'] }
);

const LOG_PREFIX = '[lead-transfer][redistribute-leads]';

/**
 * POST /api/admin/crm/redistribute-leads
 * Proxy para CRM: redistribuir leads de um consultor para outro.
 * Body: banca_id, source_consultant_email, target_consultant_email, leads_ids
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    console.log(`${LOG_PREFIX} POST request body:`, {
      banca_id: body?.banca_id,
      source_consultant_email: body?.source_consultant_email,
      target_consultant_email: body?.target_consultant_email,
      leads_ids_count: Array.isArray(body?.leads_ids) ? body.leads_ids.length : 0,
      leads_ids: Array.isArray(body?.leads_ids) ? body.leads_ids : body?.leads_ids,
    });

    const parsed = bodySchema.safeParse(body);

    if (!parsed.success) {
      const issues = parsed.error?.issues ?? [];
      const firstError = issues[0];
      const msg = firstError?.message ?? 'Dados inválidos. Verifique banca_id, emails e leads_ids.';
      console.log(`${LOG_PREFIX} POST validation failed (400):`, JSON.stringify(issues, null, 2));
      return errorResponse(msg, 400);
    }

    const { banca_id, source_consultant_email, target_consultant_email, leads_ids, transfer_type, transfer_deadline_days, filters_snapshot, lead_snapshots, source_transfer_log_id } = parsed.data;
    const ctx = await requireAdminLeadTransferContext(req, banca_id);
    console.log(`${LOG_PREFIX} POST context: userId=${ctx.userId}, bancaId=${ctx.bancaId}, crmBaseUrl=${ctx.crmBaseUrl}, bancaName=${ctx.bancaName ?? 'n/a'}`);

    const [sourceInBanca, targetInBanca] = await Promise.all([
      isConsultantInBanca(ctx.bancaId, source_consultant_email),
      isConsultantInBanca(ctx.bancaId, target_consultant_email),
    ]);

    if (!sourceInBanca) {
      console.log(`${LOG_PREFIX} POST source consultant not in banca (400): source_consultant_email=${source_consultant_email}, bancaId=${ctx.bancaId}`);
      return errorResponse('Consultor origem não pertence à banca selecionada.', 400);
    }
    if (!targetInBanca) {
      console.log(`${LOG_PREFIX} POST target consultant not in banca (400): target_consultant_email=${target_consultant_email}, bancaId=${ctx.bancaId}`);
      return errorResponse('Consultor destino não pertence à banca selecionada.', 400);
    }

    console.log(`${LOG_PREFIX} POST calling CRM redistributeLeads: source=${source_consultant_email}, target=${target_consultant_email}, leads_ids=${leads_ids.length} items`);
    const client = createCrmRedistributionClient(ctx.crmBaseUrl);
    const result = await client.redistributeLeads({
      source_consultant_email,
      target_consultant_email,
      leads_ids,
    });

    if (!result.success) {
      console.log(`${LOG_PREFIX} POST CRM error (400):`, { error: result.error, message: result.message, fullResult: result });
      return errorResponse(result.error ?? result.message ?? 'Erro ao redistribuir leads no CRM', 400);
    }

    const count = result.count ?? result.data?.count ?? leads_ids.length;
    console.log(`${LOG_PREFIX} POST CRM success: count=${count}, message=${result.message ?? 'n/a'}`);

    const { data: insertedLog, error: logError } = await supabaseServiceRole
      .from('admin_lead_transfer_logs')
      .insert({
        banca_id: ctx.bancaId,
        performed_by_user_id: ctx.userId,
        source_consultant_email,
        target_consultant_email,
        leads_ids,
        count,
        transfer_type,
        deadline_days: transfer_deadline_days,
        filters_snapshot: filters_snapshot ?? null,
        crm_response: result as unknown as Record<string, unknown>,
      })
      .select('id')
      .single();

    if (logError) {
      console.error(`${LOG_PREFIX} POST audit log insert error:`, logError);
    } else {
      console.log(`${LOG_PREFIX} POST audit log inserted: banca_id=${ctx.bancaId}, performed_by=${ctx.userId}, count=${count}`);
      if (insertedLog?.id && Array.isArray(leads_ids) && leads_ids.length > 0) {
        const snapshotByLeadId = new Map<string, {
          balance?: number | null;
          last_interaction?: string | null;
          total_depositado?: number | null;
          total_apostado?: number | null;
          total_ganho?: number | null;
          available_withdraw?: number | null;
          total_saque?: number | null;
        }>();
        if (Array.isArray(lead_snapshots)) {
          for (const s of lead_snapshots) {
            const id = String(s.lead_id);
            snapshotByLeadId.set(id, {
              balance: s.balance ?? null,
              last_interaction: s.last_interaction ?? null,
              total_depositado: s.total_depositado ?? null,
              total_apostado: s.total_apostado ?? null,
              total_ganho: s.total_ganho ?? null,
              available_withdraw: s.available_withdraw ?? null,
              total_saque: s.total_saque ?? null,
            });
          }
        }
        const entries = leads_ids.map((leadId) => {
          const sid = String(leadId);
          const snap = snapshotByLeadId.get(sid);
          const balance = snap?.balance != null ? Number(snap.balance) : null;
          const hadBalance = (balance ?? 0) > 0;
          return {
            transfer_log_id: insertedLog.id,
            banca_id: ctx.bancaId,
            lead_id: sid,
            source_consultant_email,
            target_consultant_email,
            transfer_type,
            saldo_snapshot: balance,
            last_interaction_snapshot: snap?.last_interaction ?? null,
            had_balance: hadBalance,
            total_depositado_snapshot: snap?.total_depositado != null ? Number(snap.total_depositado) : null,
            total_apostado_snapshot: snap?.total_apostado != null ? Number(snap.total_apostado) : null,
            total_ganho_snapshot: snap?.total_ganho != null ? Number(snap.total_ganho) : null,
            available_withdraw_snapshot: snap?.available_withdraw != null ? Number(snap.available_withdraw) : null,
            total_saque_snapshot: snap?.total_saque != null ? Number(snap.total_saque) : null,
          };
        });
        const { error: entriesError } = await supabaseServiceRole
          .from('admin_lead_transfer_entries')
          .insert(entries);
        if (entriesError) {
          console.error(`${LOG_PREFIX} POST admin_lead_transfer_entries insert error:`, entriesError);
        } else {
          console.log(`${LOG_PREFIX} POST admin_lead_transfer_entries inserted: ${entries.length} row(s)`);
        }
      }

      // Marca as entries da transferência de origem como 'repassado' (remove da lista Mover leads)
      if (source_transfer_log_id && Array.isArray(leads_ids) && leads_ids.length > 0) {
        const leadIdStrings = leads_ids.map((id) => String(id));
        const { error: updateSourceError } = await supabaseServiceRole
          .from('admin_lead_transfer_entries')
          .update({
            resolution_status: 'repassado',
            resolved_at: new Date().toISOString(),
          })
          .eq('transfer_log_id', source_transfer_log_id)
          .eq('banca_id', ctx.bancaId)
          .in('lead_id', leadIdStrings)
          .eq('resolution_status', 'disponivel_retransferencia');
        if (updateSourceError) {
          console.warn(`${LOG_PREFIX} POST update source entries to repassado (optional):`, updateSourceError);
        } else {
          console.log(`${LOG_PREFIX} POST source entries marked repassado: log=${source_transfer_log_id}, count=${leadIdStrings.length}`);
        }
      }

      const isDevolucao = filters_snapshot != null && typeof filters_snapshot === 'object' && 'devolucao' in filters_snapshot && 'log_origem_id' in filters_snapshot;
      const logOrigemId = isDevolucao && typeof (filters_snapshot as { log_origem_id?: string }).log_origem_id === 'string' ? (filters_snapshot as { log_origem_id: string }).log_origem_id.trim() : null;
      if (logOrigemId) {
        const devolvidoAt = new Date().toISOString();
        const { error: updateDevolvidoError } = await supabaseServiceRole
          .from('admin_lead_transfer_logs')
          .update({ devolvido_at: devolvidoAt })
          .eq('id', logOrigemId);
        if (updateDevolvidoError) {
          console.error(`${LOG_PREFIX} POST update devolvido_at on origin log:`, updateDevolvidoError);
        } else {
          console.log(`${LOG_PREFIX} POST origin log ${logOrigemId} marked as devolvido_at=${devolvidoAt}`);
        }
      }
    }

    return successResponse(
      {
        count,
        transfer_log_id: insertedLog?.id ?? null,
        message: result.message ?? `${count} lead(s) transferido(s) com sucesso.`,
      },
      result.message ?? `${count} lead(s) transferido(s) com sucesso.`
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('não tem permissão') || message.includes('obrigatório')) {
      return errorResponse(message, 403);
    }
    if (message.includes('CRM_API_KEY')) {
      return errorResponse('Configuração do servidor incompleta. Entre em contato com o suporte.', 503);
    }
    console.error(`${LOG_PREFIX} POST error:`, { message, stack: err instanceof Error ? err.stack : undefined, err });
    return serverErrorResponse(err);
  }
}
