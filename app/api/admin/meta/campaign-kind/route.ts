/**
 * POST /api/admin/meta/campaign-kind
 * Define campaign_kind (normal | bolao) em meta_campaigns.
 * Body: { banca_id, campaign_id, campaign_kind: 'normal' | 'bolao' }
 */

import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

const ALLOWED = new Set(['normal', 'bolao']);

export async function POST(req: NextRequest) {
  try {
    await requireAdmin(req);
    const body = await req.json();
    const bancaId = String(body?.banca_id ?? '').trim();
    const campaignId = String(body?.campaign_id ?? '').trim();
    const campaignKind = String(body?.campaign_kind ?? '').trim();

    if (!bancaId || !campaignId) {
      return errorResponse('banca_id e campaign_id são obrigatórios.', 400);
    }
    if (!ALLOWED.has(campaignKind)) {
      return errorResponse('campaign_kind deve ser "normal" ou "bolao".', 400);
    }

    const now = new Date().toISOString();
    const { data, error } = await supabaseServiceRole
      .from('meta_campaigns')
      .update({ campaign_kind: campaignKind, updated_at: now })
      .eq('banca_id', bancaId)
      .eq('campaign_id', campaignId)
      .select('banca_id,campaign_id,campaign_kind')
      .maybeSingle();

    if (error) return errorResponse(error.message, 500);
    if (!data) {
      return errorResponse('Campanha não encontrada para esta banca. Sincronize antes de classificar.', 404);
    }

    return successResponse({ row: data });
  } catch (err: any) {
    if (err?.message?.includes('Acesso negado') || err?.message?.includes('não autenticado')) {
      return errorResponse(err.message, 403);
    }
    return serverErrorResponse(err);
  }
}
