import { NextRequest } from 'next/server';
import { requireStatus } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import {
  assertGerenteHasBanca,
  resolveGerenteStockPoolEmail,
  getBancaCrmBaseForTransfer,
  isConsultantDirectReportOfGerente,
} from '@/lib/server/crm/gerenteLeadStock';
import { isConsultantInBanca } from '@/lib/server/crm/adminLeadTransferContext';
import { executeLeadRedistributionCore } from '@/lib/server/crm/leadRedistributionCore';
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
    target_consultant_email: z.string().email(),
    leads_ids: z.array(z.union([z.number(), z.string()])).min(1),
    transfer_type: transferTypeEnum.optional().default('TF'),
    transfer_deadline_days: z.number().int().min(1).max(365).optional().default(10),
    filters_snapshot: z.record(z.string(), z.unknown()).optional(),
    lead_snapshots: z.array(leadSnapshotSchema).optional(),
  })
  .refine(
    (d) => {
      const fs = d.filters_snapshot;
      if (fs && typeof fs === 'object' && ('devolucao' in fs || 'reverse_devolucao' in fs)) {
        return false;
      }
      return true;
    },
    { message: 'Operação não permitida para gerente.', path: ['filters_snapshot'] }
  );

const LOG_PREFIX = '[gerente][redistribute-leads]';

/**
 * POST /api/gerente/crm/redistribute-leads
 * Transfere leads do estoque CRM do gerente (pool) para um consultor direto, na mesma banca.
 */
export async function POST(req: NextRequest) {
  try {
    const { userId, profile } = await requireStatus(req, ['gerente']);
    const body = await req.json();
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      const msg = parsed.error?.issues?.[0]?.message ?? 'Dados inválidos.';
      return errorResponse(msg, 400);
    }

    const { banca_id, target_consultant_email, leads_ids, transfer_type, transfer_deadline_days, filters_snapshot, lead_snapshots } =
      parsed.data;

    const hasBanca = await assertGerenteHasBanca(userId, banca_id);
    if (!hasBanca) {
      return errorResponse('Banca não disponível para o seu usuário.', 403);
    }

    const stockEmail = await resolveGerenteStockPoolEmail(userId, banca_id);
    if (!stockEmail) {
      return errorResponse(
        'E-mail de estoque indisponível nesta banca. Confirme seu vínculo à banca e que há e-mail cadastrado no seu perfil.',
        400
      );
    }

    const source_consultant_email = stockEmail;
    const target = target_consultant_email.trim();

    if (source_consultant_email.toLowerCase() === target.toLowerCase()) {
      return errorResponse('Origem e destino não podem ser o mesmo.', 400);
    }

    const isDirect = await isConsultantDirectReportOfGerente(userId, target);
    if (!isDirect) {
      return errorResponse('O destino deve ser um consultor da sua equipe (cadastrado sob você).', 400);
    }

    const targetInBanca = await isConsultantInBanca(banca_id, target);
    if (!targetInBanca) {
      return errorResponse('Consultor destino não está na banca selecionada.', 400);
    }

    const bancaCtx = await getBancaCrmBaseForTransfer(banca_id);
    if (!bancaCtx?.crmBaseUrl) {
      return errorResponse('Banca sem URL de CRM configurada.', 400);
    }

    const fs =
      typeof filters_snapshot === 'object' && filters_snapshot !== null
        ? { ...filters_snapshot, from_gerente_stock: true, gerente_user_id: userId }
        : { from_gerente_stock: true, gerente_user_id: userId };

    const core = await executeLeadRedistributionCore({
      ctx: { userId, bancaId: banca_id, crmBaseUrl: bancaCtx.crmBaseUrl },
      transferKind: 'gerente_stock_to_consultant',
      source_consultant_email,
      target_consultant_email: target,
      leads_ids,
      transfer_type,
      transfer_deadline_days,
      filters_snapshot: fs,
      lead_snapshots,
      force_db_only: false,
    });

    if (!core.ok) {
      return errorResponse(core.error, core.status, core.extra);
    }

    console.log(`${LOG_PREFIX} OK gerente=${profile.email} banca=${banca_id} → ${target} count=${core.count}`);

    return successResponse(
      {
        count: core.count,
        crm_count: core.crm_count,
        transfer_log_id: core.transfer_log_id,
        message: core.message,
        source_consultant_email,
      },
      core.message
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('Acesso negado') || message.includes('não tem permissão')) {
      return errorResponse(message, 403);
    }
    if (message.includes('CRM_API_KEY')) {
      return errorResponse('Configuração do servidor incompleta.', 503);
    }
    console.error(`${LOG_PREFIX} error:`, err);
    return serverErrorResponse(err);
  }
}
