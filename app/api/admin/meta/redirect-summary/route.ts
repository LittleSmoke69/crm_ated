/**
 * GET /api/admin/meta/redirect-summary — agregado global de redirects VSL (cliques, grupos, slugs por projeto).
 */

import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const dateFrom = req.nextUrl.searchParams.get('date_from')?.trim() || null;
    const dateToRaw = req.nextUrl.searchParams.get('date_to')?.trim() || null;
    const dateTo =
      dateToRaw && !dateToRaw.includes('T') ? `${dateToRaw}T23:59:59.999Z` : dateToRaw;

    let clicksHeadQuery = supabaseServiceRole
      .from('redirect_clicks')
      .select('id', { count: 'exact', head: true });
    if (dateFrom) clicksHeadQuery = clicksHeadQuery.gte('selected_at', dateFrom);
    if (dateTo) clicksHeadQuery = clicksHeadQuery.lte('selected_at', dateTo);

    const [clicksHead, groupsRes, slugsRes, projectsRes] = await Promise.all([
      clicksHeadQuery,
      supabaseServiceRole.from('redirect_groups').select('project_id, is_active'),
      supabaseServiceRole.from('redirect_slugs').select('id, project_id, slug, is_active'),
      supabaseServiceRole.from('vsl_projects').select('id, name, slug').order('name'),
    ]);

    if (clicksHead.error) return errorResponse(`redirect_clicks count: ${clicksHead.error.message}`, 500);
    if (groupsRes.error) return errorResponse(`redirect_groups: ${groupsRes.error.message}`, 500);
    if (slugsRes.error) return errorResponse(`redirect_slugs: ${slugsRes.error.message}`, 500);
    if (projectsRes.error) return errorResponse(`vsl_projects: ${projectsRes.error.message}`, 500);

    const projects = projectsRes.data ?? [];

    /** Contagem por projeto via `count` no servidor — evita limite de linhas do PostgREST ao listar `redirect_clicks`. */
    const clickCountResults = await Promise.all(
      projects.map(async (p) => {
        let q = supabaseServiceRole
          .from('redirect_clicks')
          .select('id', { count: 'exact', head: true })
          .eq('project_id', p.id);
        if (dateFrom) q = q.gte('selected_at', dateFrom);
        if (dateTo) q = q.lte('selected_at', dateTo);
        const { count, error } = await q;
        return { projectId: String(p.id), count: count ?? 0, error };
      })
    );
    const firstClickErr = clickCountResults.find((r) => r.error)?.error;
    if (firstClickErr) {
      return errorResponse(`redirect_clicks por projeto: ${firstClickErr.message}`, 500);
    }

    const totalClicks = clicksHead.count ?? 0;
    const groups = groupsRes.data ?? [];
    const totalGroups = groups.length;
    const activeGroups = groups.filter((g) => g.is_active).length;

    const slugs = slugsRes.data ?? [];
    const totalRedirectSlugs = slugs.length;
    const activeRedirectSlugs = slugs.filter((s) => s.is_active).length;

    const clicksByProject = new Map<string, number>(
      clickCountResults.map((r) => [r.projectId, r.count] as const)
    );

    const groupsByProject = new Map<string, { total: number; active: number }>();
    for (const g of groups) {
      const pid = String(g.project_id);
      const cur = groupsByProject.get(pid) ?? { total: 0, active: 0 };
      cur.total += 1;
      if (g.is_active) cur.active += 1;
      groupsByProject.set(pid, cur);
    }

    const slugByProject = new Map(slugs.map((s) => [String(s.project_id), s]));

    const byProject = projects.map((p) => {
      const pid = String(p.id);
      const rs = slugByProject.get(pid);
      const gstats = groupsByProject.get(pid) ?? { total: 0, active: 0 };
      return {
        project_id: pid,
        name: p.name,
        project_slug: p.slug,
        redirect_slug: rs?.slug ?? null,
        redirect_active: rs?.is_active ?? null,
        clicks: clicksByProject.get(pid) ?? 0,
        groups_total: gstats.total,
        groups_active: gstats.active,
      };
    });

    const totals = {
      total_clicks: totalClicks,
      total_groups: totalGroups,
      active_groups: activeGroups,
      redirect_slugs: totalRedirectSlugs,
      active_redirect_slugs: activeRedirectSlugs,
      vsl_projects: projects.length,
    };

    return successResponse({ totals, projects: byProject });
  } catch (err: any) {
    if (err?.message?.includes('Acesso negado') || err?.message?.includes('não autenticado')) {
      return errorResponse(err.message, 403);
    }
    return serverErrorResponse(err);
  }
}
