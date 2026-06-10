/**
 * GET /api/admin/meta/spend-vs-deposit-daily
 * Série diária para o card de linhas: GASTO de ads (meta_insights_daily) × DEPÓSITO
 * (volume de recarga, CRM `/api/crm/dashboard-metrics` — mesma fonte do ranking Banca×Ads).
 *
 * Query params:
 *   - date_from / date_to   YYYY-MM-DD  (default: hoje em `tz`, range degenerado de 1 dia)
 *   - scope_banca_ids       csv         (escopo explícito de bancas)
 *   - banca_id              string      (atalho single-banca; sobrepõe scope se ambos)
 *   - tz                    IANA        (default: America/Sao_Paulo)
 */

import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { getMetaSpendVsDepositDaily } from '@/lib/services/meta-spend-vs-deposit-daily';

/** Fan-out CRM externo (banca × dia) — Netlify precisa de margem além do default. */
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);

    const sp = req.nextUrl.searchParams;
    const dateFrom = sp.get('date_from')?.trim() || null;
    const dateTo = sp.get('date_to')?.trim() || null;
    const tz = sp.get('tz')?.trim() || null;
    const bancaId = sp.get('banca_id')?.trim() || null;
    const scopeRaw = sp.get('scope_banca_ids')?.trim() || '';
    const depositsOnly = sp.get('deposits_only') === '1';

    for (const [name, value] of [
      ['date_from', dateFrom],
      ['date_to', dateTo],
    ] as const) {
      if (value && !YMD.test(value)) {
        return errorResponse(`Parâmetro \`${name}\` inválido. Use YYYY-MM-DD.`, 400);
      }
    }

    const bancaIds = bancaId
      ? [bancaId]
      : scopeRaw
        ? Array.from(new Set(scopeRaw.split(',').map((s) => s.trim()).filter(Boolean)))
        : [];

    const result = await getMetaSpendVsDepositDaily({
      dateFrom: dateFrom ?? '',
      dateTo: dateTo ?? '',
      tz,
      bancaIds,
      depositsOnly,
    });

    return successResponse(result);
  } catch (err: any) {
    if (err?.message?.includes('Acesso negado') || err?.message?.includes('não autenticado')) {
      return errorResponse(err.message, 403);
    }
    return serverErrorResponse(err);
  }
}
