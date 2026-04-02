/**
 * GET /api/admin/meta/live-aggregate-stream
 * Mesmos filtros que /live-aggregate; resposta NDJSON (uma linha JSON por lote).
 * Cada integração Meta é processada em série; após cada uma o cliente recebe um evento `batch`
 * com deltas e totais acumulados; ao fim, um evento `complete` com lista ordenada.
 *
 * Query: date_from, date_to, banca_id, scope_banca_ids, active_only — iguais ao live-aggregate.
 */

import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { iterateAdminMetaLiveAggregateStream } from '@/lib/services/meta-sync-service';

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

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const evt of iterateAdminMetaLiveAggregateStream({
            dateFrom,
            dateTo,
            scopeBancaIds,
            overviewBancaId,
            activeOnly,
          })) {
            controller.enqueue(encoder.encode(`${JSON.stringify(evt)}\n`));
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'error', error: msg })}\n`));
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err: unknown) {
    if (err instanceof Error && (err.message.includes('Acesso negado') || err.message.includes('não autenticado'))) {
      return errorResponse(err.message, 403);
    }
    return serverErrorResponse(err);
  }
}
