/**
 * GET /api/gerente/zaplink/submissions
 * Lista submissões aprovadas (atribuídas) ao gerente logado.
 * Query: page=1, limit=20
 */
import { NextRequest } from 'next/server';
import { requireStatus } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
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
      zaplink_form_id,
      full_name,
      email,
      phone,
      instagram_handle,
      status,
      banca_id,
      gerente_id,
      assigned_at,
      created_at,
      zaplink_forms ( slug, name, form_type ),
      crm_bancas ( name )
    `;

    const from = (page - 1) * limit;
    const to = from + limit - 1;
    const { data: rows, error, count } = await supabaseServiceRole
      .from('zaplink_form_submissions')
      .select(selectFields, { count: 'exact' })
      .eq('gerente_id', userId)
      .in('status', ['assigned', 'cadastrado'])
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) {
      return errorResponse(`Erro ao buscar submissões: ${error.message}`, 500);
    }

    type Row = {
      crm_bancas?: { name: string } | { name: string }[] | null;
      [key: string]: unknown;
    };
    const list = (rows ?? []) as Row[];
    const data = list.map((r: Row) => {
      const { crm_bancas, ...rest } = r;
      const bancaName = Array.isArray(crm_bancas)
        ? (crm_bancas[0]?.name ?? null)
        : (crm_bancas?.name ?? null);
      return {
        ...rest,
        banca_name: bancaName,
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
