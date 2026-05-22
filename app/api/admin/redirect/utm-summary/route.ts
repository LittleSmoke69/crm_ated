import { NextRequest } from 'next/server';
import { requireVslProjectAccess } from '@/lib/middleware/vsl-admin';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/admin/redirect/utm-summary?project_id=uuid|slug
 */
export async function GET(req: NextRequest) {
  try {
    let projectId = req.nextUrl.searchParams.get('project_id')?.trim() ?? '';
    if (!projectId) return errorResponse('project_id é obrigatório', 400);

    const isSlug = !UUID_RE.test(projectId);
    if (isSlug) {
      const { data: proj } = await supabaseServiceRole
        .from('vsl_projects')
        .select('id')
        .eq('slug', projectId.toLowerCase())
        .maybeSingle();
      if (!proj?.id) return errorResponse('Projeto não encontrado', 404);
      projectId = proj.id;
    }

    await requireVslProjectAccess(req, projectId);

    const [{ data: utmVisits }, { count: utmTotalCount }, { data: utmRows }] = await Promise.all([
      supabaseServiceRole
        .from('redirect_visits')
        .select('id, utm_source, utm_medium, utm_campaign, utm_content, utm_term, status, created_at')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(100),
      supabaseServiceRole
        .from('redirect_visits')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', projectId),
      supabaseServiceRole
        .from('redirect_visits')
        .select('utm_source, utm_medium, utm_campaign, created_at')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(5000),
    ]);

    const bySource: Record<string, number> = {};
    const byMedium: Record<string, number> = {};
    const byCampaign: Record<string, number> = {};
    const bySourceMedium: Record<string, number> = {};
    const byDay: Record<string, number> = {};
    for (const r of utmRows ?? []) {
      const row = r as {
        utm_source: string | null;
        utm_medium: string | null;
        utm_campaign: string | null;
        created_at: string;
      };
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

    return successResponse({
      utm_visits: utmVisits ?? [],
      utm_summary: {
        total: utmTotalCount ?? 0,
        by_source: bySource,
        by_medium: byMedium,
        by_campaign: byCampaign,
        by_source_medium: bySourceMedium,
        by_day: byDay,
        sample_size: (utmRows ?? []).length,
      },
    });
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes('Acesso negado')) {
      return errorResponse(e.message, 403);
    }
    return serverErrorResponse(e);
  }
}
