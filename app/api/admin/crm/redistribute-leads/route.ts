import { NextRequest } from 'next/server';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { requireAdminLeadTransferContext } from '@/lib/server/crm/adminLeadTransferContext';
import { executeLeadRedistributionCore, type TransferKind } from '@/lib/server/crm/leadRedistributionCore';
import { findGerenteUserIdIfEmailIsGerenteOnBanca } from '@/lib/server/crm/gerenteLeadStock';
import { reserveAdminToGerenteStock } from '@/lib/server/crm/adminToStockReservation';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { z } from 'zod';

const transferTypeEnum = z.enum(['TF', 'TF1', 'TF2', 'TF3']);

const leadSnapshotSchema = z.object({
  lead_id: z.union([z.number(), z.string()]),
  name: z.union([z.string(), z.null()]).optional(),
  phone: z.union([z.string(), z.null()]).optional(),
  balance: z.union([z.number(), z.null()]).optional(),
  last_interaction: z.union([z.string(), z.null()]).optional(),
  total_depositado: z.union([z.number(), z.null()]).optional(),
  total_apostado: z.union([z.number(), z.null()]).optional(),
  total_ganho: z.union([z.number(), z.null()]).optional(),
  available_withdraw: z.union([z.number(), z.null()]).optional(),
  total_saque: z.union([z.number(), z.string(), z.null()]).optional(),
});
const bodySchema = z
  .object({
    banca_id: z.string().uuid(),
    source_consultant_email: z.string().email(),
    target_consultant_email: z.string().email().optional(),
    /** Quando informado, o destino é o e-mail de estoque CRM do gerente (override em gerente_lead_stock_pools ou e-mail do perfil). */
    to_gerente_stock_gerente_id: z.string().uuid().optional(),
    leads_ids: z.array(z.union([z.number(), z.string()])).default([]),
    transfer_type: transferTypeEnum.optional().default('TF'),
    transfer_deadline_days: z.number().int().min(1).max(365).optional().default(10),
    filters_snapshot: z.record(z.string(), z.unknown()).optional(),
    lead_snapshots: z.array(leadSnapshotSchema).optional(),
    source_transfer_log_id: z.string().uuid().optional(),
    original_source_consultant_email: z.string().email().optional(),
    force_db_only: z.boolean().optional().default(false),
  })
  .refine(
    (data) => !!(data.to_gerente_stock_gerente_id || (data.target_consultant_email && String(data.target_consultant_email).trim())),
    { message: 'Informe o consultor destino ou o envio para estoque do gerente.', path: ['target_consultant_email'] }
  )
  .refine(
    (data) => {
      if (data.to_gerente_stock_gerente_id) return true;
      return data.source_consultant_email.toLowerCase() !== (data.target_consultant_email ?? '').trim().toLowerCase();
    },
    { message: 'Consultor origem e destino devem ser diferentes.', path: ['target_consultant_email'] }
  );

const LOG_PREFIX = '[lead-transfer][redistribute-leads]';

/**
 * POST /api/admin/crm/redistribute-leads
 * Proxy para CRM: redistribuir leads de um consultor para outro.
 * Opcional: to_gerente_stock_gerente_id envia para o e-mail de estoque do gerente (mesma banca_id).
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    console.log(`${LOG_PREFIX} POST request body:`, {
      banca_id: body?.banca_id,
      source_consultant_email: body?.source_consultant_email,
      target_consultant_email: body?.target_consultant_email,
      to_gerente_stock_gerente_id: body?.to_gerente_stock_gerente_id,
      leads_ids_count: Array.isArray(body?.leads_ids) ? body.leads_ids.length : 0,
    });

    const parsed = bodySchema.safeParse(body);

    if (!parsed.success) {
      const issues = parsed.error?.issues ?? [];
      const firstError = issues[0];
      const msg = firstError?.message ?? 'Dados inválidos. Verifique banca_id, emails e leads_ids.';
      console.log(`${LOG_PREFIX} POST validation failed (400):`, JSON.stringify(issues, null, 2));
      return errorResponse(msg, 400);
    }

    const ctx = await requireAdminLeadTransferContext(req, parsed.data.banca_id);
    console.log(`${LOG_PREFIX} POST context: userId=${ctx.userId}, bancaId=${ctx.bancaId}, crmBaseUrl=${ctx.crmBaseUrl}`);

    let toGerenteStockGerenteId = parsed.data.to_gerente_stock_gerente_id;
    if (!toGerenteStockGerenteId && parsed.data.target_consultant_email?.trim()) {
      const autoGerenteId = await findGerenteUserIdIfEmailIsGerenteOnBanca(parsed.data.target_consultant_email.trim(), ctx.bancaId);
      if (autoGerenteId) {
        toGerenteStockGerenteId = autoGerenteId;
        console.log(
          `${LOG_PREFIX} POST destino é gerente na banca → reserva lógica no estoque (admin_to_gerente_stock) gerente_id=${autoGerenteId}`
        );
      }
    }

    /** Fluxo reserva lógica: admin envia ao estoque do gerente SEM chamar o CRM.
     *  Os leads continuam com o consultor de origem no CRM. O gerente distribui depois
     *  aos consultores da equipe — e esse repasse sim chama o CRM (origem real → consultor). */
    if (toGerenteStockGerenteId) {
      const { data: gerenteProfile } = await supabaseServiceRole
        .from('profiles')
        .select('id, email, status')
        .eq('id', toGerenteStockGerenteId)
        .maybeSingle();
      if (!gerenteProfile?.id || gerenteProfile.status !== 'gerente') {
        return errorResponse('Gerente de destino inválido para reserva no estoque.', 400);
      }
      const gerenteEmail = String(gerenteProfile.email ?? '').trim().toLowerCase();

      const reservation = await reserveAdminToGerenteStock({
        userId: ctx.userId,
        bancaId: ctx.bancaId,
        gerenteUserId: toGerenteStockGerenteId,
        gerenteDisplayEmail: gerenteEmail,
        sourceConsultantEmail: parsed.data.source_consultant_email,
        leadsIds: parsed.data.leads_ids,
        transferType: parsed.data.transfer_type,
        transferDeadlineDays: parsed.data.transfer_deadline_days,
        filtersSnapshot: parsed.data.filters_snapshot ?? null,
        leadSnapshots: parsed.data.lead_snapshots,
      });

      if (!reservation.ok) {
        return errorResponse(reservation.error, reservation.status);
      }

      return successResponse(
        {
          count: reservation.count,
          crm_count: 0,
          transfer_log_id: reservation.transfer_log_id,
          message: reservation.message,
          transfer_kind: 'admin_to_gerente_stock' as TransferKind,
          stock_reservation: true,
        },
        reservation.message
      );
    }

    const target_consultant_email = (parsed.data.target_consultant_email ?? '').trim();
    const filters_snapshot = parsed.data.filters_snapshot ?? null;
    const transferKind: TransferKind = 'standard';

    if (parsed.data.source_consultant_email.trim().toLowerCase() === target_consultant_email.toLowerCase()) {
      return errorResponse('Consultor origem e destino devem ser diferentes.', 400);
    }

    const core = await executeLeadRedistributionCore({
      ctx: { userId: ctx.userId, bancaId: ctx.bancaId, crmBaseUrl: ctx.crmBaseUrl },
      transferKind,
      source_consultant_email: parsed.data.source_consultant_email,
      target_consultant_email,
      leads_ids: parsed.data.leads_ids,
      transfer_type: parsed.data.transfer_type,
      transfer_deadline_days: parsed.data.transfer_deadline_days,
      filters_snapshot,
      lead_snapshots: parsed.data.lead_snapshots,
      source_transfer_log_id: parsed.data.source_transfer_log_id,
      original_source_consultant_email: parsed.data.original_source_consultant_email,
      force_db_only: parsed.data.force_db_only,
    });

    if (!core.ok) {
      return errorResponse(core.error, core.status, core.extra);
    }

    return successResponse(
      {
        count: core.count,
        crm_count: core.crm_count,
        transfer_log_id: core.transfer_log_id,
        message: core.message,
        transfer_kind: transferKind,
      },
      core.message
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (
      message.includes('não tem permissão') ||
      message.includes('obrigatório') ||
      message.includes('bloqueada para transferência')
    ) {
      return errorResponse(message, 403);
    }
    if (message.includes('CRM_API_KEY')) {
      return errorResponse('Configuração do servidor incompleta. Entre em contato com o suporte.', 503);
    }
    console.error(`${LOG_PREFIX} POST error:`, { message, stack: err instanceof Error ? err.stack : undefined, err });
    return serverErrorResponse(err);
  }
}
