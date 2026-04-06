import { NextRequest } from 'next/server';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { requireAdminLeadTransferContext } from '@/lib/server/crm/adminLeadTransferContext';
import { executeLeadRedistributionCore, type TransferKind } from '@/lib/server/crm/leadRedistributionCore';
import { resolveGerenteStockPoolEmail } from '@/lib/server/crm/gerenteLeadStock';
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

    let target_consultant_email = (parsed.data.target_consultant_email ?? '').trim();
    let filters_snapshot = parsed.data.filters_snapshot ?? null;
    let transferKind: TransferKind = 'standard';

    if (parsed.data.to_gerente_stock_gerente_id) {
      const stockEmail = await resolveGerenteStockPoolEmail(parsed.data.to_gerente_stock_gerente_id, ctx.bancaId);
      if (!stockEmail) {
        return errorResponse(
          'Não foi possível determinar o e-mail de estoque do gerente nesta banca. Verifique vínculo do gerente à banca e e-mail no perfil.',
          400
        );
      }
      target_consultant_email = stockEmail;
      transferKind = 'admin_to_gerente_stock';
      const fs = typeof filters_snapshot === 'object' && filters_snapshot !== null ? { ...filters_snapshot } : {};
      fs.to_gerente_stock = true;
      fs.gerente_stock_gerente_id = parsed.data.to_gerente_stock_gerente_id;
      filters_snapshot = fs;
      console.log(`${LOG_PREFIX} POST admin → estoque gerente=${parsed.data.to_gerente_stock_gerente_id} pool=${target_consultant_email}`);
    }

    if (
      parsed.data.source_consultant_email.trim().toLowerCase() === target_consultant_email.toLowerCase() &&
      !parsed.data.to_gerente_stock_gerente_id
    ) {
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
