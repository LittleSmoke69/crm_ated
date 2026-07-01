/**
 * GET /api/banca-analysis/consultant-metrics?banca_id=&consultant=&date_from=&date_to=
 *
 * Métricas (cohort) individuais de um consultor via CRM `/api/crm/cohort-real-players-metrics`
 * (endpoint leve, só os totais), com o parâmetro `consultant` (email → só os dados dele).
 * Escopo por papel igual ao /api/banca-analysis.
 */

import { NextRequest } from 'next/server';
import { requireStatusOrSidebarPermission } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { getBancasDoUsuario } from '@/lib/crm/user-bancas';
import { fetchCohortRealPlayersMetrics } from '@/lib/services/dashboard/dono-banca';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export const maxDuration = 120;
export const dynamic = 'force-dynamic';

function toCrmBaseUrl(bancaUrl: string | null | undefined): string {
  const host = String(bancaUrl || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/api\/crm\/?/i, '')
    .replace(/\/+$/, '')
    .trim()
    .toLowerCase();
  return host ? `https://${host}` : '';
}

export async function GET(req: NextRequest) {
  try {
    const { userId, profile } = await requireStatusOrSidebarPermission(
      req,
      ['dono_banca', 'super_admin', 'admin', 'gestor'],
      'gestao_banca'
    );

    const sp = req.nextUrl.searchParams;
    const dateFrom = sp.get('date_from')?.trim() || '';
    const dateTo = sp.get('date_to')?.trim() || '';
    const consultant = sp.get('consultant')?.trim() || '';
    const bancaId = sp.get('banca_id')?.trim() || null;

    const status = String(profile?.status ?? '').trim().toLowerCase();
    const isAdminOrSuper = status === 'super_admin' || status === 'admin';
    const isDono = status === 'dono_banca';

    let bancaUrl: string | null = null;

    if (isDono) {
      const { data: dono } = await supabaseServiceRole
        .from('profiles')
        .select('banca_url')
        .eq('id', userId)
        .single();
      bancaUrl = dono?.banca_url ?? null;
    } else {
      if (!bancaId) return errorResponse('Informe banca_id.', 400);
      if (!isAdminOrSuper) {
        const bancas = await getBancasDoUsuario(userId);
        if (!bancas.some((b) => b.id === bancaId)) {
          return errorResponse('Você não tem acesso a esta banca.', 403);
        }
      }
      const { data: banca } = await supabaseServiceRole
        .from('crm_bancas')
        .select('url')
        .eq('id', bancaId)
        .single();
      bancaUrl = banca?.url ?? null;
    }

    const crmBaseUrl = toCrmBaseUrl(bancaUrl);
    if (!crmBaseUrl) return errorResponse('Não foi possível resolver a banca.', 400);
    if (!consultant) return errorResponse('Informe consultant (email).', 400);

    // Totais do cohort do consultor (endpoint leve cohort-real-players-metrics).
    const t = await fetchCohortRealPlayersMetrics(
      crmBaseUrl,
      dateFrom || undefined,
      dateTo || undefined,
      consultant,
      req.signal
    );
    if (!t) return successResponse({ consultant, metrics: null });

    return successResponse({
      consultant,
      metrics: {
        cadastros: Number(t.cohort_size) || 0,
        faturamento: Number(t.total_deposited_in_window) || 0,
        total_deposits_count: Number(t.total_deposits_count_in_window) || 0,
        players_that_deposited: Number(t.players_that_deposited) || 0,
        ltv: Number(t.total_ltv_in_window) || 0,
        players_with_ltv: Number(t.players_with_ltv) || 0,
        ltv_avg: Number(t.ltv_avg) || 0,
      },
    });
  } catch (err: any) {
    if (err?.message?.includes('Acesso negado') || err?.message?.includes('autenticado')) {
      return errorResponse(err.message, 403);
    }
    return serverErrorResponse(err);
  }
}
