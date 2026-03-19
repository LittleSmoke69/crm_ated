/**
 * GET /api/admin/zaplink/submissions - Lista submissões com paginação
 * Query: status=pending|assigned|all (default pending), page=1, limit=20, form_id=...
 */
import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export const dynamic = 'force-dynamic';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);

    const status = req.nextUrl.searchParams.get('status') || 'pending';
    const formId = req.nextUrl.searchParams.get('form_id')?.trim() || null;
    const page = Math.max(1, parseInt(req.nextUrl.searchParams.get('page') || '1', 10));
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(req.nextUrl.searchParams.get('limit') || String(DEFAULT_LIMIT), 10)));

    const selectFields = `
        id,
        zaplink_form_id,
        full_name,
        email,
        phone,
        instagram_handle,
        status,
        banca_id,
        gerente_id,
        consultor_user_id,
        assigned_at,
        created_at,
        zaplink_forms ( slug, name, form_type, gestor_trafego_user_id ),
        crm_bancas ( name )
      `;

    let query = supabaseServiceRole
      .from('zaplink_form_submissions')
      .select(selectFields, { count: 'exact' })
      .order('created_at', { ascending: false });

    if (status !== 'all') {
      if (status === 'assigned') {
        query = query.in('status', ['assigned', 'cadastrado']);
      } else {
        query = query.eq('status', status);
      }
    }
    if (formId) {
      query = query.eq('zaplink_form_id', formId);
    }

    const from = (page - 1) * limit;
    const to = from + limit - 1;
    const { data: rows, error, count } = await query.range(from, to);

    if (error) {
      return errorResponse(`Erro ao buscar submissões: ${error.message}`, 500);
    }

    type Row = {
      gerente_id: string | null;
      crm_bancas?: { name: string } | { name: string }[] | null;
      [key: string]: unknown;
    };
    const list = (rows ?? []) as Row[];
    const gerenteIds = [...new Set(list.map((r) => r.gerente_id).filter(Boolean))] as string[];
    let gerenteNames: Record<string, string> = {};
    if (gerenteIds.length > 0) {
      const { data: profiles } = await supabaseServiceRole
        .from('profiles')
        .select('id, full_name')
        .in('id', gerenteIds);
      gerenteNames = (profiles ?? []).reduce(
        (acc, p: { id: string; full_name: string | null }) => {
          acc[p.id] = p.full_name || '';
          return acc;
        },
        {} as Record<string, string>
      );
    }

    type ZaplinkFormRow = { slug?: string; name?: string; form_type?: string; gestor_trafego_user_id?: string | null } | null;
    const formCreatorIds = [...new Set(
      list
        .map((r: Row) => (r.zaplink_forms as ZaplinkFormRow)?.gestor_trafego_user_id)
        .filter(Boolean)
    )] as string[];
    let formCreatorNames: Record<string, string> = {};
    if (formCreatorIds.length > 0) {
      const { data: creatorProfiles } = await supabaseServiceRole
        .from('profiles')
        .select('id, full_name, email')
        .in('id', formCreatorIds);
      formCreatorNames = (creatorProfiles ?? []).reduce(
        (acc, p: { id: string; full_name: string | null; email: string }) => {
          acc[p.id] = p.full_name?.trim() || p.email || '—';
          return acc;
        },
        {} as Record<string, string>
      );
    }

    const data = list.map((r: Row) => {
      const { crm_bancas, ...rest } = r;
      const bancaName = Array.isArray(crm_bancas)
        ? (crm_bancas[0]?.name ?? null)
        : (crm_bancas?.name ?? null);
      const zf = r.zaplink_forms as ZaplinkFormRow;
      const formName = zf?.name ?? null;
      const formCreatorId = zf?.gestor_trafego_user_id ?? null;
      const formCreatorName = formCreatorId ? (formCreatorNames[formCreatorId] ?? null) : null;
      return {
        ...rest,
        banca_name: bancaName,
        gerente_name: r.gerente_id ? gerenteNames[r.gerente_id] ?? null : null,
        form_name: formName,
        form_creator_name: formCreatorName,
      };
    });

    const total = typeof count === 'number' ? count : 0;
    const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;

    return successResponse({
      data,
      total,
      page,
      limit,
      total_pages: totalPages,
    });
  } catch (e) {
    return serverErrorResponse(e);
  }
}
