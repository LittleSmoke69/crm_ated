/**
 * POST /api/admin/meta/campaign-kind
 * Define campaign_kind (normal | bolao) em meta_campaigns.
 * Body: { banca_id, campaign_id, campaign_kind: 'normal' | 'bolao', name? }
 * Se ainda não existir linha em meta_campaigns (ex.: só live na Meta), faz insert mínimo.
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

    const nameRaw = body?.name;
    const name =
      nameRaw != null && String(nameRaw).trim() !== '' ? String(nameRaw).trim().slice(0, 2000) : null;

    const now = new Date().toISOString();

    const { data: updated, error: upErr } = await supabaseServiceRole
      .from('meta_campaigns')
      .update({ campaign_kind: campaignKind, updated_at: now })
      .eq('banca_id', bancaId)
      .eq('campaign_id', campaignId)
      .select('banca_id,campaign_id,campaign_kind')
      .maybeSingle();

    if (upErr) return errorResponse(upErr.message, 500);
    if (updated) {
      return successResponse({ row: updated });
    }

    const { data: inserted, error: insErr } = await supabaseServiceRole
      .from('meta_campaigns')
      .insert({
        banca_id: bancaId,
        campaign_id: campaignId,
        campaign_kind: campaignKind,
        name,
        updated_at: now,
      })
      .select('banca_id,campaign_id,campaign_kind')
      .single();

    if (insErr) {
      if (insErr.code === '23505') {
        const { data: retry, error: retryErr } = await supabaseServiceRole
          .from('meta_campaigns')
          .update({ campaign_kind: campaignKind, updated_at: now })
          .eq('banca_id', bancaId)
          .eq('campaign_id', campaignId)
          .select('banca_id,campaign_id,campaign_kind')
          .maybeSingle();
        if (retryErr) return errorResponse(retryErr.message, 500);
        if (retry) return successResponse({ row: retry });
      }
      return errorResponse(insErr.message, 500);
    }

    return successResponse({ row: inserted });
  } catch (err: any) {
    if (err?.message?.includes('Acesso negado') || err?.message?.includes('não autenticado')) {
      return errorResponse(err.message, 403);
    }
    return serverErrorResponse(err);
  }
}
