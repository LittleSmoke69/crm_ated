import { NextRequest } from 'next/server';
import { getClientIpHashFromHeaders } from '@/lib/redirect/client-ip';
import { decodeRedirectSlug } from '@/lib/redirect/decode-slug';
import {
  loadRedirectGroupsForSlug,
  loadRedirectProject,
  pickRedirectGroup,
  resolveRedirectSlugRowReadOnly,
} from '@/lib/redirect/resolve-redirect';
import { createRedirectClickToken, createRedirectVisitToken } from '@/lib/redirect/tracking-token';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';

export const dynamic = 'force-dynamic';

const LOGO_SIGNED_EXPIRES = 3600;

/**
 * GET /api/redirect/[slug]/resolve
 * Mesma lógica da página /r/[slug] (somente leitura no slug).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug: rawSlug } = await params;
    if (!rawSlug) {
      return errorResponse('Slug é obrigatório', 400);
    }
    const slug = decodeRedirectSlug(rawSlug).toLowerCase();
    const sid = req.nextUrl.searchParams.get('sid')?.trim() || null;
    const utm_source = req.nextUrl.searchParams.get('utm_source')?.trim() || null;
    const utm_medium = req.nextUrl.searchParams.get('utm_medium')?.trim() || null;
    const utm_campaign = req.nextUrl.searchParams.get('utm_campaign')?.trim() || null;
    const utm_content = req.nextUrl.searchParams.get('utm_content')?.trim() || null;
    const utm_term = req.nextUrl.searchParams.get('utm_term')?.trim() || null;
    const fbclid = req.nextUrl.searchParams.get('fbclid')?.trim() || null;

    const redirectRow = await resolveRedirectSlugRowReadOnly(slug);
    if (!redirectRow) {
      return errorResponse('Redirect não encontrado', 404);
    }

    const project = await loadRedirectProject(redirectRow.project_id);
    if (!project) {
      return errorResponse('Projeto não encontrado', 404);
    }

    const ipHash = getClientIpHashFromHeaders(req.headers);
    const selectionSeed = sid ?? ipHash;

    const groups = await loadRedirectGroupsForSlug(redirectRow.id, redirectRow.project_id);
    const selected = pickRedirectGroup(groups, selectionSeed);
    if (!selected) {
      return errorResponse('Nenhum grupo ativo disponível', 400);
    }

    let visit_id: string | null = null;
    let visit_token: string | null = null;
    const hasUtm = [utm_source, utm_medium, utm_campaign, utm_content, utm_term].some((v) => v && v.length > 0);
    if (hasUtm) {
      const { data: visitRow } = await supabaseServiceRole
        .from('redirect_visits')
        .insert({
          project_id: redirectRow.project_id,
          redirect_slug_id: redirectRow.id,
          utm_source,
          utm_medium,
          utm_campaign,
          utm_content,
          utm_term,
          ip_hash: ipHash,
          status: 'pending',
        })
        .select('id')
        .single();
      if (visitRow?.id) {
        visit_id = visitRow.id;
        visit_token = await createRedirectVisitToken(visitRow.id);
      }
    }

    let clickUtmCampaign: string | null = utm_campaign;
    let clickFbclid: string | null = fbclid;
    if (sid) {
      const { data: sess } = await supabaseServiceRole
        .from('vsl_sessions')
        .select('utm_campaign, fbclid')
        .eq('id', sid)
        .single();
      if (sess) {
        clickUtmCampaign = sess.utm_campaign ?? clickUtmCampaign;
        clickFbclid = sess.fbclid ?? clickFbclid;
      }
    }

    const timerSeconds = project.redirect_timer_seconds ?? 3;
    const completedAt = timerSeconds === 0 ? new Date().toISOString() : null;

    const { data: clickRow, error: clickError } = await supabaseServiceRole
      .from('redirect_clicks')
      .insert({
        project_id: redirectRow.project_id,
        redirect_slug_id: redirectRow.id,
        group_id: selected.id,
        session_id: sid,
        utm_campaign: clickUtmCampaign,
        fbclid: clickFbclid,
        ip_hash: ipHash,
        completed_at: completedAt,
      })
      .select('id')
      .single();

    if (clickError || !clickRow) {
      console.error('[redirect/resolve] insert click', clickError?.message);
      return errorResponse('Erro ao registrar click', 500);
    }

    if (timerSeconds === 0 && visit_id) {
      await supabaseServiceRole.from('redirect_visits').update({ status: 'complete' }).eq('id', visit_id);
    }

    if (sid) {
      await supabaseServiceRole.from('vsl_events').insert({
        session_id: sid,
        project_id: redirectRow.project_id,
        event_name: 'REDIRECT_SELECTED',
        event_id: crypto.randomUUID(),
        metadata: { redirect_slug: slug, group_id: selected.id, click_id: clickRow.id },
      });
    }

    let logo_url: string | null = null;
    if (project.logo_path) {
      const { data: signed } = await supabaseServiceRole.storage
        .from('brand-assets')
        .createSignedUrl(project.logo_path, LOGO_SIGNED_EXPIRES);
      if (signed?.signedUrl) logo_url = signed.signedUrl;
    }

    const click_token = await createRedirectClickToken(clickRow.id);

    return successResponse({
      invite_url: selected.invite_url,
      timer_seconds: timerSeconds,
      logo_url,
      project_name: project.name,
      group_id: selected.id,
      click_id: clickRow.id,
      click_token,
      pixel_id: project.pixel_id ?? null,
      visit_id,
      visit_token,
    });
  } catch (e) {
    return serverErrorResponse(e);
  }
}
