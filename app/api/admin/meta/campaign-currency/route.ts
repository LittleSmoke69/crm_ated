/**
 * POST /api/admin/meta/campaign-currency
 * Define currency_override (BRL | USD | null) em meta_campaigns.
 * Body: { banca_id, campaign_id, currency: 'BRL' | 'USD' | null, name? }
 *  - currency = null limpa o override (volta a usar a moeda da Ad Account).
 * Se ainda não existir linha em meta_campaigns (ex.: só live na Meta), faz insert mínimo.
 */

import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

const ALLOWED = new Set(['BRL', 'USD']);

function normalizeCurrency(raw: unknown): string | null | 'invalid' {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string') {
    const v = raw.trim().toUpperCase();
    if (v === '' || v === 'NULL') return null;
    if (ALLOWED.has(v)) return v;
  }
  return 'invalid';
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin(req);
    const body = await req.json();
    const bancaId = String(body?.banca_id ?? '').trim();
    const campaignId = String(body?.campaign_id ?? '').trim();
    const normalized = normalizeCurrency(body?.currency);

    if (!bancaId || !campaignId) {
      return errorResponse('banca_id e campaign_id são obrigatórios.', 400);
    }
    if (normalized === 'invalid') {
      return errorResponse('currency deve ser "BRL", "USD" ou null.', 400);
    }

    const nameRaw = body?.name;
    const name =
      nameRaw != null && String(nameRaw).trim() !== ''
        ? String(nameRaw).trim().slice(0, 2000)
        : null;

    const now = new Date().toISOString();

    const { data: updated, error: upErr } = await supabaseServiceRole
      .from('meta_campaigns')
      .update({ currency_override: normalized, updated_at: now })
      .eq('banca_id', bancaId)
      .eq('campaign_id', campaignId)
      .select('banca_id,campaign_id,currency_override')
      .maybeSingle();

    if (upErr) return errorResponse(upErr.message, 500);
    if (updated) {
      return successResponse({ row: updated });
    }

    const insertPayload: Record<string, unknown> = {
      banca_id: bancaId,
      campaign_id: campaignId,
      currency_override: normalized,
      updated_at: now,
    };
    if (name != null) insertPayload.name = name;

    const { data: inserted, error: insErr } = await supabaseServiceRole
      .from('meta_campaigns')
      .insert(insertPayload)
      .select('banca_id,campaign_id,currency_override')
      .single();

    if (insErr) {
      if (insErr.code === '23505') {
        const { data: retry, error: retryErr } = await supabaseServiceRole
          .from('meta_campaigns')
          .update({ currency_override: normalized, updated_at: now })
          .eq('banca_id', bancaId)
          .eq('campaign_id', campaignId)
          .select('banca_id,campaign_id,currency_override')
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
