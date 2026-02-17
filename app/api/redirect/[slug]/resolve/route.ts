import { NextRequest } from 'next/server';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { selectGroupByWeight } from '@/lib/vsl/redirect-weight';

export const dynamic = 'force-dynamic';

const LOGO_SIGNED_EXPIRES = 3600;

/**
 * GET /api/redirect/[slug]/resolve
 * Resolve redirect por slug, escolhe grupo por peso, cria click e retorna invite_url + timer + logo.
 * Query: sid (opcional, session_id)
 */
/** Decodifica o slug da URL (pode vir codificado uma ou duas vezes). */
function decodeSlug(raw: string): string {
  if (!raw) return '';
  let s = raw;
  try {
    for (let i = 0; i < 3; i++) {
      const next = decodeURIComponent(s);
      if (next === s) break;
      s = next;
    }
  } catch {
    // mantém o original se der erro
  }
  return s.trim();
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug: rawSlug } = await params;
    if (!rawSlug) {
      return errorResponse('Slug é obrigatório', 400);
    }
    const slug = decodeSlug(rawSlug);
    const sid = req.nextUrl.searchParams.get('sid') ?? null;

    let redirectRow: { id: string; project_id: string } | null = null;

    const { data: bySlug } = await supabaseServiceRole
      .from('redirect_slugs')
      .select('id, project_id')
      .eq('slug', slug)
      .eq('is_active', true)
      .maybeSingle();
    redirectRow = bySlug ?? null;

    if (!redirectRow) {
      const { data: pageByRedirectSlug } = await supabaseServiceRole
        .from('vsl_pages')
        .select('project_id')
        .eq('redirect_slug', slug)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();
      if (pageByRedirectSlug?.project_id) {
        const { data: project } = await supabaseServiceRole
          .from('vsl_projects')
          .select('slug')
          .eq('id', pageByRedirectSlug.project_id)
          .single();
        if (project?.slug) {
          const { data: redirectByProject } = await supabaseServiceRole
            .from('redirect_slugs')
            .select('id, project_id')
            .eq('project_id', pageByRedirectSlug.project_id)
            .eq('slug', project.slug)
            .eq('is_active', true)
            .maybeSingle();
          redirectRow = redirectByProject ?? null;
        }
      }
    }

    if (!redirectRow) {
      return errorResponse('Redirect não encontrado', 404);
    }

    const { data: project } = await supabaseServiceRole
      .from('vsl_projects')
      .select('id, name, redirect_timer_seconds, logo_path')
      .eq('id', redirectRow.project_id)
      .single();

    if (!project) {
      return errorResponse('Projeto não encontrado', 404);
    }

    const { data: linkRows } = await supabaseServiceRole
      .from('redirect_slug_groups')
      .select('group_id')
      .eq('redirect_slug_id', redirectRow.id);

    const groupIds = (linkRows ?? []).map((r: { group_id: string }) => r.group_id);
    if (groupIds.length === 0) {
      return errorResponse('Nenhum grupo vinculado ao redirect', 400);
    }

    const { data: groups } = await supabaseServiceRole
      .from('redirect_groups')
      .select('id, name, invite_url, weight_percent')
      .in('id', groupIds)
      .eq('is_active', true);

    const withWeight = (groups ?? []).filter((g: { weight_percent: number }) => g.weight_percent > 0);
    const selected = selectGroupByWeight(withWeight);
    if (!selected) {
      return errorResponse('Nenhum grupo ativo com peso configurado', 400);
    }

    let utm_campaign: string | null = null;
    let fbclid: string | null = null;
    if (sid) {
      const { data: sess } = await supabaseServiceRole
        .from('vsl_sessions')
        .select('utm_campaign, fbclid')
        .eq('id', sid)
        .single();
      if (sess) {
        utm_campaign = sess.utm_campaign ?? null;
        fbclid = sess.fbclid ?? null;
      }
    }

    const { data: clickRow, error: clickError } = await supabaseServiceRole
      .from('redirect_clicks')
      .insert({
        project_id: redirectRow.project_id,
        redirect_slug_id: redirectRow.id,
        group_id: selected.id,
        session_id: sid,
        utm_campaign,
        fbclid,
      })
      .select('id')
      .single();

    if (clickError || !clickRow) {
      console.error('[redirect/resolve] insert click', clickError?.message);
      return errorResponse('Erro ao registrar click', 500);
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

    return successResponse({
      invite_url: selected.invite_url,
      timer_seconds: project.redirect_timer_seconds ?? 3,
      logo_url,
      project_name: project.name,
      group_id: selected.id,
      click_id: clickRow.id,
    });
  } catch (e) {
    return serverErrorResponse(e);
  }
}
