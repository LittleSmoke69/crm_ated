/**
 * GET /api/admin/meta/data - Lista campanhas, adsets e insights sincronizados
 * Query: banca_id (UUID) - obrigatório
 */

import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const bancaId = req.nextUrl.searchParams.get('banca_id');
    if (!bancaId) {
      return errorResponse('banca_id é obrigatório', 400);
    }

    const [campaignsRes, adsetsRes, insightsRes] = await Promise.all([
      supabaseServiceRole
        .from('meta_campaigns')
        .select('*')
        .eq('banca_id', bancaId)
        .order('updated_at', { ascending: false }),
      supabaseServiceRole
        .from('meta_adsets')
        .select('*')
        .eq('banca_id', bancaId)
        .order('updated_at', { ascending: false }),
      supabaseServiceRole
        .from('meta_insights_daily')
        .select('*')
        .eq('banca_id', bancaId)
        .order('date', { ascending: false })
        .limit(200),
    ]);

    if (campaignsRes.error) {
      return errorResponse(`Erro ao buscar campanhas: ${campaignsRes.error.message}`, 500);
    }
    if (adsetsRes.error) {
      return errorResponse(`Erro ao buscar adsets: ${adsetsRes.error.message}`, 500);
    }
    if (insightsRes.error) {
      return errorResponse(`Erro ao buscar insights: ${insightsRes.error.message}`, 500);
    }

    return successResponse({
      campaigns: campaignsRes.data ?? [],
      adsets: adsetsRes.data ?? [],
      insights: insightsRes.data ?? [],
    });
  } catch (err: any) {
    if (err?.message?.includes('Acesso negado') || err?.message?.includes('não autenticado')) {
      return errorResponse(err.message, 403);
    }
    return serverErrorResponse(err);
  }
}
