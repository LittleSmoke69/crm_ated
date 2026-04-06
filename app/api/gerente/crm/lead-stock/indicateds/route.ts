import { NextRequest } from 'next/server';
import { requireStatus } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import {
  assertGerenteHasBanca,
  resolveGerenteStockPoolEmail,
  getBancaCrmBaseForTransfer,
} from '@/lib/server/crm/gerenteLeadStock';
import { createCrmRedistributionClient } from '@/lib/server/crm/crmRedistributionClient';

const LOG_PREFIX = '[gerente][lead-stock][indicateds]';

/**
 * GET /api/gerente/crm/lead-stock/indicateds?banca_id=&transferred_filter=no&page=1&per_page=2000
 * Lista leads do CRM no e-mail de estoque do gerente.
 */
export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireStatus(req, ['gerente']);
    const { searchParams } = req.nextUrl;
    const bancaId = searchParams.get('banca_id')?.trim();
    if (!bancaId) return errorResponse('banca_id é obrigatório.', 400);

    const has = await assertGerenteHasBanca(userId, bancaId);
    if (!has) return errorResponse('Banca não disponível.', 403);

    const poolEmail = await resolveGerenteStockPoolEmail(userId, bancaId);
    if (!poolEmail) {
      return errorResponse('E-mail de estoque indisponível para esta banca.', 400);
    }

    const banca = await getBancaCrmBaseForTransfer(bancaId);
    if (!banca?.crmBaseUrl) return errorResponse('Banca sem CRM.', 400);

    const transferredFilter = searchParams.get('transferred_filter')?.trim() === 'yes' ? 'yes' : 'no';
    const perPage = Math.min(5000, Math.max(1, parseInt(searchParams.get('per_page') ?? '2000', 10) || 2000));
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1);

    const client = createCrmRedistributionClient(banca.crmBaseUrl);
    const result = await client.getIndicatedsByConsultant(poolEmail, perPage, page, {
      transferredFilter,
      sort: 'created_at',
      direction: 'desc',
    });

    if (!result.success) {
      return errorResponse(result.error ?? result.message ?? 'Erro ao buscar leads no CRM.', 400);
    }

    const data = Array.isArray(result.data) ? result.data : [];
    return successResponse({
      consultant: poolEmail,
      count: data.length,
      total: result.pagination?.total ?? data.length,
      data,
      pagination: result.pagination,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('Acesso negado')) return errorResponse(message, 403);
    console.error(`${LOG_PREFIX}`, err);
    return serverErrorResponse(err);
  }
}
