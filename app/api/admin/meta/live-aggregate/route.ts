/**
 * GET /api/admin/meta/live-aggregate
 * Métricas em tempo real via Meta Graph API (mesma estratégia de fallbacks do sync),
 * agregando todas as integrações ativas e respeitando período + filtros de banca.
 *
 * Query:
 * - date_from, date_to (YYYY-MM-DD) — intervalo; se ambos informados, a Meta é consultada com esse time_range
 *   (granularidade diária, time_increment=1) e as linhas são filtradas ao intervalo. Se omitido, comportamento legado (preset last_30d + fallbacks).
 * - banca_id — filtra métricas para uma banca (dropdown Meta).
 * - scope_banca_ids — IDs separados por vírgula; limita integrações que tocam essas bancas.
 * - active_only — 1 (default) só ACTIVE; 0 inclui pausadas.
 */

import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { fetchAdminMetaLiveAggregate } from '@/lib/services/meta-sync-service';

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const sp = req.nextUrl.searchParams;
    const dateFrom = (sp.get('date_from') ?? '').trim() || null;
    const dateTo = (sp.get('date_to') ?? '').trim() || null;
    const overviewBancaId = (sp.get('banca_id') ?? '').trim() || null;
    const scopeRaw = (sp.get('scope_banca_ids') ?? '').trim();
    const scopeBancaIds = scopeRaw
      ? Array.from(
          new Set(
            scopeRaw
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          )
        )
      : [];
    const activeOnlyParam = (sp.get('active_only') ?? '1').trim();
    const activeOnly = !(activeOnlyParam === '0' || activeOnlyParam.toLowerCase() === 'false');

    const result = await fetchAdminMetaLiveAggregate({
      dateFrom,
      dateTo,
      scopeBancaIds,
      overviewBancaId,
      activeOnly,
    });

    if (!result.success) {
      return errorResponse(result.error || 'Falha ao agregar métricas Meta.', 500);
    }

    return successResponse(result);
  } catch (err: unknown) {
    if (err instanceof Error && (err.message.includes('Acesso negado') || err.message.includes('não autenticado'))) {
      return errorResponse(err.message, 403);
    }
    return serverErrorResponse(err);
  }
}
