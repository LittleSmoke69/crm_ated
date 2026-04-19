import { NextRequest } from 'next/server';
import { requireStatus } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import {
  assertGerenteHasBanca,
  resolveGerenteStockPoolEmail,
  getBancaCrmBaseForTransfer,
} from '@/lib/server/crm/gerenteLeadStock';
import { createCrmRedistributionClient } from '@/lib/server/crm/crmRedistributionClient';
import type { IndicatedDetail } from '@/lib/server/crm/crmRedistributionClient';
import {
  getGerenteStockLeadInventory,
  bucketDeadlineDays,
  type GerenteStockLeadMeta,
} from '@/lib/server/crm/gerenteStockInventory';

const LOG_PREFIX = '[gerente][lead-stock][indicateds]';

const MAX_PAGES = 60;
const PAGE_SIZE = 500;

/**
 * GET /api/gerente/crm/lead-stock/indicateds?banca_id=&transferred_filter=no&page=1&per_page=2000&deadline_days=all|10|20|30|other
 * Lista leads do CRM no e-mail de estoque do gerente, restritos aos que entraram via admin → estoque deste gerente
 * e que ainda não foram repassados a um consultor (auditoria Zaploto).
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

    const deadlineParam = searchParams.get('deadline_days')?.trim().toLowerCase() ?? 'all';
    const allowedBuckets = new Set(['all', '10', '20', '30', 'other']);
    const deadlineBucket = allowedBuckets.has(deadlineParam) ? deadlineParam : 'all';

    const inventory = await getGerenteStockLeadInventory(userId, bancaId, poolEmail);
    const counts = { all: 0, '10': 0, '20': 0, '30': 0, other: 0 };
    for (const meta of inventory.values()) {
      counts.all++;
      counts[bucketDeadlineDays(meta.deadline_days)]++;
    }

    let wanted = new Map<string, GerenteStockLeadMeta>();
    for (const [lid, meta] of inventory) {
      if (deadlineBucket === 'all') {
        wanted.set(lid, meta);
        continue;
      }
      const b = bucketDeadlineDays(meta.deadline_days);
      if (b === deadlineBucket) wanted.set(lid, meta);
    }

    if (wanted.size === 0) {
      return successResponse({
        consultant: poolEmail,
        count: 0,
        total: 0,
        data: [],
        pagination: { current_page: 1, per_page: PAGE_SIZE, total: 0, last_page: 1 },
        stock_meta: { counts, expected_in_crm: 0, matched_in_crm: 0, deadline_filter: deadlineBucket },
      });
    }

    const client = createCrmRedistributionClient(banca.crmBaseUrl);
    const wantedIds = wanted;
    const enriched: Array<IndicatedDetail & { stock_meta?: GerenteStockLeadMeta }> = [];
    let page = 1;
    let lastPagination: { current_page?: number; last_page?: number; total?: number; per_page?: string | number } | undefined;

    while (page <= MAX_PAGES && enriched.length < wantedIds.size) {
      const result = await client.getIndicatedsByConsultant(poolEmail, PAGE_SIZE, page, {
        transferredFilter,
        sort: 'created_at',
        direction: 'desc',
      });

      if (!result.success) {
        return errorResponse(result.error ?? result.message ?? 'Erro ao buscar leads no CRM.', 400);
      }

      const chunk = Array.isArray(result.data) ? result.data : [];
      lastPagination = result.pagination;

      for (const row of chunk) {
        const id = row?.id != null ? String(row.id) : '';
        if (!id || !wantedIds.has(id)) continue;
        const meta = wantedIds.get(id);
        enriched.push({ ...(row as IndicatedDetail), stock_meta: meta });
      }

      const lastPage = result.pagination?.last_page ?? page;
      if (page >= lastPage || chunk.length < PAGE_SIZE) break;
      if (enriched.length >= wantedIds.size) break;
      page++;
    }

    const expected = wantedIds.size;
    console.log(
      `${LOG_PREFIX} pool=${poolEmail} banca=${bancaId} esperados=${expected} encontrados_crm=${enriched.length} filtro=${deadlineBucket}`
    );

    return successResponse({
      consultant: poolEmail,
      count: enriched.length,
      total: enriched.length,
      data: enriched,
      pagination: lastPagination ?? { current_page: 1, per_page: PAGE_SIZE, total: enriched.length, last_page: 1 },
      stock_meta: {
        counts,
        expected_in_crm: expected,
        matched_in_crm: enriched.length,
        deadline_filter: deadlineBucket,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('Acesso negado')) return errorResponse(message, 403);
    console.error(`${LOG_PREFIX}`, err);
    return serverErrorResponse(err);
  }
}
