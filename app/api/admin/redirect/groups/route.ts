import { NextRequest } from 'next/server';
import { requireVslProjectAccess } from '@/lib/middleware/vsl-admin';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';

const WHATSAPP_INVITE_PREFIX = 'https://chat.whatsapp.com/';

/**
 * GET /api/admin/redirect/groups?project_id=xxx
 * project_id pode ser UUID do projeto ou slug (ex: lotox). Se for slug, resolve o projeto.
 * Lista grupos do redirect do projeto (redirect_slug = project.slug) com contagem de cliques.
 */
export async function GET(req: NextRequest) {
  try {
    let projectId = req.nextUrl.searchParams.get('project_id');
    if (!projectId) return errorResponse('project_id é obrigatório', 400);
    projectId = projectId.trim();
    const isSlug = !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectId);
    if (isSlug) {
      const { data: proj } = await supabaseServiceRole
        .from('vsl_projects')
        .select('id')
        .eq('slug', projectId)
        .single();
      if (!proj?.id) return errorResponse('Projeto não encontrado', 404);
      projectId = proj.id;
    }
    if (!projectId) return errorResponse('Projeto não encontrado', 404);
    await requireVslProjectAccess(req, projectId);

    const { data: project } = await supabaseServiceRole
      .from('vsl_projects')
      .select('slug, pixel_id')
      .eq('id', projectId)
      .single();
    if (!project) return errorResponse('Projeto não encontrado', 404);

    const { data: redirectRow } = await supabaseServiceRole
      .from('redirect_slugs')
      .select('id')
      .eq('project_id', projectId)
      .eq('slug', project.slug)
      .single();
    const emptyUtmSummary = { total: 0, by_source: {}, by_medium: {}, by_campaign: {}, by_source_medium: {}, by_day: {}, sample_size: 0 };
    if (!redirectRow) return successResponse({ groups: [], redirect_slug_id: null, project_id: projectId, redirect_slug: project.slug, pixel_id: project.pixel_id ?? null, total_clicks: 0, total_groups: 0, active_groups: 0, utm_visits: [], utm_summary: emptyUtmSummary });

    const { data: groups } = await supabaseServiceRole
      .from('redirect_groups')
      .select('id, name, invite_url, weight_percent, is_active, created_at')
      .eq('project_id', projectId)
      .order('name');

    const groupIds = (groups ?? []).map((g: { id: string }) => g.id);
    const counts: Record<string, number> = {};
    if (groupIds.length > 0) {
      const { data: clicks } = await supabaseServiceRole
        .from('redirect_clicks')
        .select('group_id')
        .eq('redirect_slug_id', redirectRow.id);
      for (const c of clicks ?? []) {
        const gid = (c as { group_id: string }).group_id;
        counts[gid] = (counts[gid] ?? 0) + 1;
      }
    }

    const list = (groups ?? []).map((g: { id: string; name: string; invite_url: string; weight_percent: number; is_active: boolean; created_at: string }) => ({
      ...g,
      clicks: counts[g.id] ?? 0,
    }));

    const total_clicks = Object.values(counts).reduce((a, b) => a + b, 0);

    const { data: utmVisits } = await supabaseServiceRole
      .from('redirect_visits')
      .select('id, utm_source, utm_medium, utm_campaign, utm_content, utm_term, created_at')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(100);

    const { count: utmTotalCount } = await supabaseServiceRole
      .from('redirect_visits')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId);

    const { data: utmRows } = await supabaseServiceRole
      .from('redirect_visits')
      .select('utm_source, utm_medium, utm_campaign, created_at')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(5000);

    const bySource: Record<string, number> = {};
    const byMedium: Record<string, number> = {};
    const byCampaign: Record<string, number> = {};
    const bySourceMedium: Record<string, number> = {};
    const byDay: Record<string, number> = {};
    for (const r of utmRows ?? []) {
      const row = r as { utm_source: string | null; utm_medium: string | null; utm_campaign: string | null; created_at: string };
      const src = row.utm_source?.trim() || '(vazio)';
      const med = row.utm_medium?.trim() || '(vazio)';
      const camp = row.utm_campaign?.trim() || '(vazio)';
      bySource[src] = (bySource[src] ?? 0) + 1;
      byMedium[med] = (byMedium[med] ?? 0) + 1;
      byCampaign[camp] = (byCampaign[camp] ?? 0) + 1;
      const key = `${src} | ${med}`;
      bySourceMedium[key] = (bySourceMedium[key] ?? 0) + 1;
      const day = row.created_at ? row.created_at.slice(0, 10) : '';
      if (day) byDay[day] = (byDay[day] ?? 0) + 1;
    }

    const utm_summary = {
      total: utmTotalCount ?? 0,
      by_source: bySource,
      by_medium: byMedium,
      by_campaign: byCampaign,
      by_source_medium: bySourceMedium,
      by_day: byDay,
      sample_size: (utmRows ?? []).length,
    };

    return successResponse({
      groups: list,
      redirect_slug_id: redirectRow.id,
      redirect_slug: project.slug,
      project_id: projectId,
      pixel_id: project.pixel_id ?? null,
      total_clicks,
      total_groups: list.length,
      active_groups: list.filter((g: { is_active: boolean }) => g.is_active).length,
      utm_visits: utmVisits ?? [],
      utm_summary,
    });
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes('Acesso negado')) {
      return errorResponse(e.message, 403);
    }
    return serverErrorResponse(e);
  }
}

/**
 * POST /api/admin/redirect/groups
 * Adiciona grupo. Body: project_id, name, invite_url, is_active?, weight_percent?
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({})) as {
      project_id?: string;
      name?: string;
      invite_url?: string;
      is_active?: boolean;
      weight_percent?: number;
    };
    const { project_id, name, invite_url } = body;
    if (!project_id || !name?.trim() || !invite_url?.trim()) {
      return errorResponse('project_id, name e invite_url são obrigatórios', 400);
    }
    if (!invite_url.trim().toLowerCase().startsWith(WHATSAPP_INVITE_PREFIX)) {
      return errorResponse('invite_url deve começar com https://chat.whatsapp.com/', 400);
    }
    await requireVslProjectAccess(req, project_id);

    const { data: project } = await supabaseServiceRole
      .from('vsl_projects')
      .select('slug')
      .eq('id', project_id)
      .single();
    if (!project) return errorResponse('Projeto não encontrado', 404);

    const { data: redirectRow } = await supabaseServiceRole
      .from('redirect_slugs')
      .select('id')
      .eq('project_id', project_id)
      .eq('slug', project.slug)
      .single();
    if (!redirectRow) return errorResponse('Redirect do projeto não encontrado', 404);

    const weight = Math.min(100, Math.max(0, body.weight_percent ?? 0));

    const { data: group, error: groupError } = await supabaseServiceRole
      .from('redirect_groups')
      .insert({
        project_id,
        name: name.trim(),
        invite_url: invite_url.trim(),
        weight_percent: weight,
        is_active: body.is_active !== false,
      })
      .select()
      .single();

    if (groupError || !group) {
      console.error('[admin/redirect/groups]', groupError?.message);
      return errorResponse('Erro ao criar grupo', 500);
    }

    await supabaseServiceRole.from('redirect_slug_groups').insert({
      redirect_slug_id: redirectRow.id,
      group_id: group.id,
    });

    return successResponse({ ...group, clicks: 0 });
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes('Acesso negado')) {
      return errorResponse(e.message, 403);
    }
    return serverErrorResponse(e);
  }
}
