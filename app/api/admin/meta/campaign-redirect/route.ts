/**
 * GET /api/admin/meta/campaign-redirect?banca_id=uuid
 * Lista redirects/VSL da banca para seleção na tabela Meta Ads.
 *
 * POST /api/admin/meta/campaign-redirect
 * Body: { banca_id, campaign_id, redirect_project_id: uuid | null, name? }
 */

import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { errorResponse, serverErrorResponse, successResponse } from '@/lib/utils/response';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isMissingRedirectColumnError(err: { code?: string; message?: string } | null): boolean {
  const msg = String(err?.message ?? '').toLowerCase();
  return err?.code === '42703' || msg.includes('redirect_project_id');
}

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const bancaId = req.nextUrl.searchParams.get('banca_id')?.trim() || '';
    if (!bancaId || !UUID_RE.test(bancaId)) {
      return errorResponse('banca_id válido é obrigatório.', 400);
    }

    const { data, error } = await supabaseServiceRole
      .from('vsl_projects')
      .select('id, name, slug, banca_id, owner_user_id, created_at')
      .eq('banca_id', bancaId)
      .eq('is_active', true)
      .order('name', { ascending: true });

    if (error) return errorResponse(error.message, 500);
    return successResponse({ redirects: data ?? [] });
  } catch (err: any) {
    if (err?.message?.includes('Acesso negado') || err?.message?.includes('não autenticado')) {
      return errorResponse(err.message, 403);
    }
    return serverErrorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin(req);
    const body = await req.json().catch(() => ({}));
    const bancaId = String(body?.banca_id ?? '').trim();
    const campaignId = String(body?.campaign_id ?? '').trim();
    const redirectProjectIdRaw = body?.redirect_project_id;
    const redirectProjectId =
      redirectProjectIdRaw === null || redirectProjectIdRaw === undefined || String(redirectProjectIdRaw).trim() === ''
        ? null
        : String(redirectProjectIdRaw).trim();

    if (!bancaId || !campaignId) {
      return errorResponse('banca_id e campaign_id são obrigatórios.', 400);
    }
    if (!UUID_RE.test(bancaId)) {
      return errorResponse('banca_id inválido.', 400);
    }
    if (redirectProjectId && !UUID_RE.test(redirectProjectId)) {
      return errorResponse('redirect_project_id inválido.', 400);
    }

    if (redirectProjectId) {
      const { data: redirectProject, error: redirectErr } = await supabaseServiceRole
        .from('vsl_projects')
        .select('id, banca_id, name, slug')
        .eq('id', redirectProjectId)
        .maybeSingle();
      if (redirectErr) return errorResponse(redirectErr.message, 500);
      if (!redirectProject) return errorResponse('Redirect não encontrado.', 404);
      if (String(redirectProject.banca_id ?? '') !== bancaId) {
        return errorResponse('Este redirect não pertence à banca da campanha.', 400);
      }
    }

    const nameRaw = body?.name;
    const name =
      nameRaw != null && String(nameRaw).trim() !== ''
        ? String(nameRaw).trim().slice(0, 2000)
        : null;

    const now = new Date().toISOString();
    const { data: updated, error: upErr } = await supabaseServiceRole
      .from('meta_campaigns')
      .update({ redirect_project_id: redirectProjectId, updated_at: now })
      .eq('banca_id', bancaId)
      .eq('campaign_id', campaignId)
      .select('banca_id,campaign_id,redirect_project_id')
      .maybeSingle();

    if (upErr) {
      if (isMissingRedirectColumnError(upErr)) {
        return errorResponse(
          'Migração pendente: aplique migrations/add_redirect_project_to_meta_campaigns.sql para vincular campanhas a redirects.',
          500
        );
      }
      return errorResponse(upErr.message, 500);
    }
    if (updated) return successResponse({ row: updated });

    const insertPayload: Record<string, unknown> = {
      banca_id: bancaId,
      campaign_id: campaignId,
      redirect_project_id: redirectProjectId,
      updated_at: now,
    };
    if (name != null) insertPayload.name = name;

    const { data: inserted, error: insErr } = await supabaseServiceRole
      .from('meta_campaigns')
      .insert(insertPayload)
      .select('banca_id,campaign_id,redirect_project_id')
      .single();

    if (insErr) {
      if (isMissingRedirectColumnError(insErr)) {
        return errorResponse(
          'Migração pendente: aplique migrations/add_redirect_project_to_meta_campaigns.sql para vincular campanhas a redirects.',
          500
        );
      }
      if (insErr.code === '23505') {
        const { data: retry, error: retryErr } = await supabaseServiceRole
          .from('meta_campaigns')
          .update({ redirect_project_id: redirectProjectId, updated_at: now })
          .eq('banca_id', bancaId)
          .eq('campaign_id', campaignId)
          .select('banca_id,campaign_id,redirect_project_id')
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
