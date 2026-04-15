import { NextRequest } from 'next/server';
import { requireVslProjectAccess } from '@/lib/middleware/vsl-admin';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { fetchAllSupabasePages } from '@/lib/supabase/fetch-all-pages';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';

type ClickRow = { selected_at: string; group_id: string };

function parseIso(s: string | null): Date | null {
  if (!s?.trim()) return null;
  const d = new Date(s.trim());
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Hora 0–23 no fuso America/Sao_Paulo */
function hourInSaoPaulo(iso: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    hour: 'numeric',
    hour12: false,
  }).formatToParts(new Date(iso));
  const h = parts.find((p) => p.type === 'hour')?.value;
  return Math.min(23, Math.max(0, parseInt(h ?? '0', 10)));
}

/** Chave yyyy-mm-dd no fuso America/Sao_Paulo */
function dayKeySaoPaulo(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

function aggregateClicks(
  rows: ClickRow[],
  groupNames: Record<string, string>
): {
  total: number;
  by_day: Record<string, number>;
  by_hour_of_day: number[];
  by_group: { group_id: string; name: string; count: number }[];
} {
  const by_day: Record<string, number> = {};
  const by_hour_of_day = Array.from({ length: 24 }, () => 0);
  const by_group_count: Record<string, number> = {};

  for (const r of rows) {
    const day = dayKeySaoPaulo(r.selected_at);
    by_day[day] = (by_day[day] ?? 0) + 1;
    by_hour_of_day[hourInSaoPaulo(r.selected_at)] += 1;
    by_group_count[r.group_id] = (by_group_count[r.group_id] ?? 0) + 1;
  }

  const by_group = Object.entries(by_group_count)
    .map(([group_id, count]) => ({
      group_id,
      name: groupNames[group_id] ?? group_id.slice(0, 8),
      count,
    }))
    .sort((a, b) => b.count - a.count);

  return {
    total: rows.length,
    by_day,
    by_hour_of_day,
    by_group,
  };
}

/**
 * GET /api/admin/redirect/clicks-analytics?project_id=uuid&from=ISO&to=ISO&compare=1
 * Agrega redirect_clicks no intervalo [from, to) e, se compare=1, o período anterior de mesma duração.
 */
export async function GET(req: NextRequest) {
  try {
    const url = req.nextUrl;
    const projectId = url.searchParams.get('project_id')?.trim() ?? '';
    if (!projectId) return errorResponse('project_id é obrigatório', 400);

    const fromD = parseIso(url.searchParams.get('from'));
    const toD = parseIso(url.searchParams.get('to'));
    if (!fromD || !toD || fromD >= toD) {
      return errorResponse('from e to devem ser datas ISO válidas com from < to', 400);
    }

    await requireVslProjectAccess(req, projectId);

    const { data: groups, error: gErr } = await supabaseServiceRole
      .from('redirect_groups')
      .select('id, name')
      .eq('project_id', projectId);
    if (gErr) {
      console.error('[clicks-analytics] redirect_groups', gErr.message);
      return errorResponse('Erro ao listar grupos', 500);
    }
    const groupNames: Record<string, string> = {};
    for (const row of groups ?? []) {
      const g = row as { id: string; name: string };
      groupNames[g.id] = g.name ?? g.id;
    }

    const fetchClicksInRange = async (start: Date, end: Date) => {
      const startIso = start.toISOString();
      const endIso = end.toISOString();
      const { data, error } = await fetchAllSupabasePages<ClickRow>(async (from, to) => {
        const res = await supabaseServiceRole
          .from('redirect_clicks')
          .select('selected_at, group_id')
          .eq('project_id', projectId)
          .gte('selected_at', startIso)
          .lt('selected_at', endIso)
          .order('selected_at', { ascending: true })
          .range(from, to);
        return { data: res.data as ClickRow[] | null, error: res.error };
      });
      if (error) {
        return { ok: false as const, message: error.message };
      }
      return { ok: true as const, rows: data };
    };

    const current = await fetchClicksInRange(fromD, toD);
    if (!current.ok) {
      console.error('[clicks-analytics] redirect_clicks', current.message);
      return errorResponse('Erro ao carregar cliques', 500);
    }

    const currentAgg = aggregateClicks(current.rows, groupNames);

    const compare = url.searchParams.get('compare') === '1' || url.searchParams.get('compare') === 'true';
    let previousAgg: ReturnType<typeof aggregateClicks> | null = null;
    if (compare) {
      const ms = toD.getTime() - fromD.getTime();
      const prevEnd = new Date(fromD.getTime());
      const prevStart = new Date(fromD.getTime() - ms);
      const prev = await fetchClicksInRange(prevStart, prevEnd);
      if (prev.ok) {
        previousAgg = aggregateClicks(prev.rows, groupNames);
      }
    }

    return successResponse({
      current: currentAgg,
      previous: previousAgg,
      range: {
        from: fromD.toISOString(),
        to: toD.toISOString(),
      },
      previous_range:
        compare && previousAgg
          ? {
              from: new Date(fromD.getTime() - (toD.getTime() - fromD.getTime())).toISOString(),
              to: fromD.toISOString(),
            }
          : null,
    });
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes('Acesso negado')) {
      return errorResponse(e.message, 403);
    }
    return serverErrorResponse(e);
  }
}
