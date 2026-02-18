import { NextRequest } from 'next/server';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { requireAdminLeadTransferContext, isConsultantInBanca } from '@/lib/server/crm/adminLeadTransferContext';
import { createCrmRedistributionClient, type IndicatedDetail } from '@/lib/server/crm/crmRedistributionClient';
import { z } from 'zod';

const LOG_PREFIX = '[lead-transfer][redistribution-leads-enrichment]';
const DETAIL_PAGE_SIZE = 1500;

const querySchema = z.object({
  banca_id: z.string().uuid(),
  source_consultant_email: z.string().email(),
  page: z.coerce.number().int().min(1),
});

/**
 * GET /api/admin/crm/redistribution-leads/enrichment
 * Retorna uma página de detalhes (get-indicateds-by-consultant) para o frontend
 * enriquecer a lista de leads em background quando enrichmentDeferred foi true.
 * Query: banca_id, source_consultant_email, page (obrigatórios).
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url ?? '');
    const parsed = querySchema.safeParse({
      banca_id: searchParams.get('banca_id'),
      source_consultant_email: searchParams.get('source_consultant_email'),
      page: searchParams.get('page'),
    });

    if (!parsed.success) {
      const msg = parsed.error?.issues?.[0]?.message ?? 'banca_id, source_consultant_email e page são obrigatórios.';
      return errorResponse(msg, 400);
    }

    const { banca_id, source_consultant_email, page } = parsed.data;

    const ctx = await requireAdminLeadTransferContext(req, banca_id);
    const isInBanca = await isConsultantInBanca(ctx.bancaId, source_consultant_email);
    if (!isInBanca) {
      return errorResponse('Consultor origem não pertence à banca selecionada.', 400);
    }

    const client = createCrmRedistributionClient(ctx.crmBaseUrl);
    const result = await client.getIndicatedsByConsultant(source_consultant_email, DETAIL_PAGE_SIZE, page);

    if (!result.success) {
      return errorResponse(result.error ?? result.message ?? 'Erro ao buscar detalhes no CRM', 400);
    }

    const details: IndicatedDetail[] = Array.isArray(result.data) ? result.data : [];
    const withBalance = details.map((d) => {
      const raw = d.balance ?? (d as Record<string, unknown>).saldo;
      const balance = raw != null ? parseFloat(String(raw)) : null;
      const value = Number.isFinite(balance) ? balance : null;
      return { ...d, balance: value ?? 0 } as IndicatedDetail;
    });

    return successResponse({
      details: withBalance,
      page,
      perPage: DETAIL_PAGE_SIZE,
    });
  } catch (err: unknown) {
    console.error(`${LOG_PREFIX} Exceção:`, err);
    return serverErrorResponse(err);
  }
}
