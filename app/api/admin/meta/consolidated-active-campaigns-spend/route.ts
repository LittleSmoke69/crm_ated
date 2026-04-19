/**
 * GET /api/admin/meta/consolidated-active-campaigns-spend
 * Todas as integrações Meta (tokens/contas distintas) → campanhas ativas consolidadas.
 * Query: tz? (IANA), date_preset? (ex. last_7d — opcional), since? + until?, time_increment?,
 *   include_inactive_integrations=1
 * Padrão sem período: **hoje** no `tz` (default America/Sao_Paulo), time_increment=1.
 */

import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import {
  consolidateActiveCampaignsSpendAllIntegrations,
  type ConsolidateAllActiveCampaignsSpendOptions,
} from '@/lib/services/meta-sync-service';

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const sp = req.nextUrl.searchParams;
    const datePreset = sp.get('date_preset')?.trim() || undefined;
    const since = sp.get('since')?.trim();
    const until = sp.get('until')?.trim();
    const timeRange =
      since && until
        ? {
            since,
            until,
          }
        : undefined;
    const ti = sp.get('time_increment');
    const timeIncrement = ti != null && ti !== '' ? parseInt(ti, 10) : undefined;
    const calendarTimeZone = sp.get('tz')?.trim() || undefined;
    const includeInactiveIntegrations = sp.get('include_inactive_integrations') === '1';

    const spendOpts: ConsolidateAllActiveCampaignsSpendOptions = { includeInactiveIntegrations };
    if (datePreset) spendOpts.datePreset = datePreset;
    if (timeRange) spendOpts.timeRange = timeRange;
    if (Number.isFinite(timeIncrement as number)) spendOpts.timeIncrement = timeIncrement;
    if (calendarTimeZone) spendOpts.calendarTimeZone = calendarTimeZone;

    const report = await consolidateActiveCampaignsSpendAllIntegrations(spendOpts);

    return successResponse(report);
  } catch (err: any) {
    if (err?.message?.includes('Acesso negado') || err?.message?.includes('não autenticado')) {
      return errorResponse(err.message, 403);
    }
    return serverErrorResponse(err);
  }
}
