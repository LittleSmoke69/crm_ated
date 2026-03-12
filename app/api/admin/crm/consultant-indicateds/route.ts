/**
 * GET /api/admin/crm/consultant-indicateds
 *
 * Lista indicados do consultor no CRM (get-indicateds-by-consultant).
 * Usado na aba Análise para verificar leads não transferidos (transferred_filter=no).
 * Query: banca_id (obrigatório), consultant (email obrigatório), transferred_filter (opcional, default 'no'), per_page?, page?.
 */

import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { getAdminBancaId } from '@/lib/server/crm/adminLeadTransferContext';
import { createCrmRedistributionClient } from '@/lib/server/crm/crmRedistributionClient';

const LOG_PREFIX = '[admin][consultant-indicateds]';

export async function GET(req: NextRequest) {
  try {
    const { userId, profile } = await requireAdmin(req);
    const bancaId = req.nextUrl.searchParams.get('banca_id')?.trim() || null;
    const consultant = req.nextUrl.searchParams.get('consultant')?.trim() || null;
    const transferredFilter = (req.nextUrl.searchParams.get('transferred_filter')?.trim() === 'yes' ? 'yes' : 'no') as 'yes' | 'no';
    const perPage = Math.min(5000, Math.max(1, parseInt(req.nextUrl.searchParams.get('per_page') ?? '2000', 10) || 2000));
    const page = Math.max(1, parseInt(req.nextUrl.searchParams.get('page') ?? '1', 10) || 1);

    if (!bancaId || !consultant) {
      return errorResponse('banca_id e consultant (email) são obrigatórios.', 400);
    }

    const resolved = await getAdminBancaId(userId, profile, bancaId);
    if (!resolved?.crmBaseUrl) {
      return errorResponse('Banca não encontrada ou sem permissão.', 404);
    }

    const client = createCrmRedistributionClient(resolved.crmBaseUrl);
    const result = await client.getIndicatedsByConsultant(consultant, perPage, page, {
      transferredFilter,
      sort: 'created_at',
      direction: 'desc',
    });

    if (!result.success) {
      return errorResponse(result.error ?? result.message ?? 'Erro ao buscar indicados no CRM.', 400);
    }

    const data = Array.isArray(result.data) ? result.data : [];
    const total = result.pagination?.total ?? data.length;
    return successResponse({
      count: data.length,
      total: typeof total === 'number' ? total : data.length,
      data,
      pagination: result.pagination,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('não tem permissão') || message.includes('obrigatório') || message.includes('CRM_API_KEY')) {
      return errorResponse(message, 403);
    }
    console.error(`${LOG_PREFIX} GET error:`, err);
    return serverErrorResponse(err as Error);
  }
}
