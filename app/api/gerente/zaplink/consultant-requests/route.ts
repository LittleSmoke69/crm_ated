/**
 * GET /api/gerente/zaplink/consultant-requests
 * Lista solicitações de consultor do gerente com consultores enviados (fulfillments).
 * Query: page=1, limit=20
 */
import { NextRequest } from 'next/server';
import { requireStatus } from '@/lib/middleware/permissions';
import { successResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export const dynamic = 'force-dynamic';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireStatus(req, ['gerente']);

    const page = Math.max(1, parseInt(req.nextUrl.searchParams.get('page') || '1', 10));
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(req.nextUrl.searchParams.get('limit') || String(DEFAULT_LIMIT), 10)));

    const selectFields = `
        id,
        banca_id,
        quantity_requested,
        quantity_sent,
        created_at,
        updated_at,
        crm_bancas ( name )
      `;

    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const { data: requests, error: reqError, count } = await supabaseServiceRole
      .from('zaplink_consultant_requests')
      .select(selectFields, { count: 'exact' })
      .eq('gerente_id', userId)
      .order('created_at', { ascending: false })
      .range(from, to);

    if (reqError) return successResponse({ data: [], total: 0, page: 1, limit, total_pages: 0 });
    const list = requests ?? [];

    const requestIds = list.map((r: { id: string }) => r.id);
    const total = typeof count === 'number' ? count : 0;
    const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;

    if (requestIds.length === 0) {
      return successResponse({ data: [], total, page, limit, total_pages: totalPages });
    }

    const { data: fulfillments } = await supabaseServiceRole
      .from('zaplink_consultant_request_fulfillments')
      .select('request_id, consultant_user_id, sent_at')
      .in('request_id', requestIds);

    const consultantIds = [...new Set((fulfillments ?? []).map((f: { consultant_user_id: string }) => f.consultant_user_id))];
    let profiles: { id: string; full_name: string | null; email: string }[] = [];
    if (consultantIds.length > 0) {
      const { data: p } = await supabaseServiceRole
        .from('profiles')
        .select('id, full_name, email')
        .in('id', consultantIds);
      profiles = p ?? [];
    }
    const profileById = Object.fromEntries(profiles.map((p) => [p.id, p]));

    const byRequest = new Map<string, { consultant_user_id: string; sent_at: string; full_name: string | null; email: string }[]>();
    for (const f of fulfillments ?? []) {
      const arr = byRequest.get(f.request_id) ?? [];
      const prof = profileById[f.consultant_user_id];
      arr.push({
        consultant_user_id: f.consultant_user_id,
        sent_at: f.sent_at,
        full_name: prof?.full_name ?? null,
        email: prof?.email ?? '',
      });
      byRequest.set(f.request_id, arr);
    }

    const result = list.map((r: { id: string; crm_bancas?: { name: string } | { name: string }[] | null; [k: string]: unknown }) => {
      const bancaName = Array.isArray(r.crm_bancas) ? r.crm_bancas[0]?.name : (r.crm_bancas as { name?: string })?.name;
      const { crm_bancas, ...rest } = r;
      return {
        ...rest,
        banca_name: bancaName ?? null,
        consultants_sent: (byRequest.get(r.id) ?? []).sort((a, b) => new Date(b.sent_at).getTime() - new Date(a.sent_at).getTime()),
      };
    });

    return successResponse({
      data: result,
      total,
      page,
      limit,
      total_pages: totalPages,
    });
  } catch (e) {
    return serverErrorResponse(e);
  }
}
