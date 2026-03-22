/**
 * GET /api/admin/zaplink/consultant-removals
 * Lista consultores removidos pelos gerentes (admin Zaplink).
 */
import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);

    const limit = Math.min(100, Math.max(1, parseInt(req.nextUrl.searchParams.get('limit') || '50', 10)));

    const { data: removals, error } = await supabaseServiceRole
      .from('zaplink_consultant_removals')
      .select(`
        id,
        gerente_id,
        consultant_user_id,
        request_id,
        removed_at,
        created_at
      `)
      .order('removed_at', { ascending: false })
      .limit(limit);

    if (error) return successResponse([]);

    const list = removals ?? [];
    const gerenteIds = [...new Set(list.map((r: { gerente_id: string }) => r.gerente_id))];
    const consultantIds = [...new Set(list.map((r: { consultant_user_id: string }) => r.consultant_user_id))];

    let gerenteProfiles: { id: string; full_name: string | null; email: string }[] = [];
    let consultantProfiles: { id: string; full_name: string | null; email: string }[] = [];
    if (gerenteIds.length > 0) {
      const { data: gp } = await supabaseServiceRole
        .from('profiles')
        .select('id, full_name, email')
        .in('id', gerenteIds);
      gerenteProfiles = gp ?? [];
    }
    if (consultantIds.length > 0) {
      const { data: cp } = await supabaseServiceRole
        .from('profiles')
        .select('id, full_name, email')
        .in('id', consultantIds);
      consultantProfiles = cp ?? [];
    }
    const gerenteById = Object.fromEntries(gerenteProfiles.map((p) => [p.id, p]));
    const consultantById = Object.fromEntries(consultantProfiles.map((p) => [p.id, p]));

    const result = list.map((r: { gerente_id: string; consultant_user_id: string; request_id?: string | null; removed_at: string; [k: string]: unknown }) => ({
      ...r,
      gerente_name: gerenteById[r.gerente_id]?.full_name ?? null,
      gerente_email: gerenteById[r.gerente_id]?.email ?? null,
      consultant_name: consultantById[r.consultant_user_id]?.full_name ?? null,
      consultant_email: consultantById[r.consultant_user_id]?.email ?? null,
    }));

    return successResponse(result);
  } catch (e) {
    return serverErrorResponse(e);
  }
}
