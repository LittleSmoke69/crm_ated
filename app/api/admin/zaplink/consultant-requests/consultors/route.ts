/**
 * GET /api/admin/zaplink/consultant-requests/consultors
 * Lista consultores (profiles status=consultor) para o admin selecionar ao atender solicitação.
 * Query: search= (opcional), limit=50
 */
import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const search = req.nextUrl.searchParams.get('search')?.trim() || '';
    const limit = Math.min(100, Math.max(1, parseInt(req.nextUrl.searchParams.get('limit') || '50', 10)));

    let query = supabaseServiceRole
      .from('profiles')
      .select('id, full_name, email')
      .eq('status', 'consultor')
      .order('full_name', { ascending: true })
      .limit(limit);

    if (search) {
      query = query.or(`full_name.ilike.%${search}%,email.ilike.%${search}%`);
    }
    const { data, error } = await query;
    if (error) return successResponse([]);
    return successResponse(data ?? []);
  } catch (e) {
    return serverErrorResponse(e);
  }
}
