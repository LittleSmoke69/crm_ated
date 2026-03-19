/**
 * GET /api/gestor-trafego/zaplink/bancas
 * Lista apenas as bancas às quais o gestor está atribuído (user_bancas), para usar no Zaplink ao atribuir leads.
 * Retorna id, name, url — só bancas da banca do gestor.
 */
import { NextRequest } from 'next/server';
import { requireGestorTrafego } from '@/lib/middleware/gestor-trafego-access';
import { successResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireGestorTrafego(req);

    const { data: ubRow } = await supabaseServiceRole
      .from('user_bancas')
      .select('banca_ids')
      .eq('user_id', userId)
      .maybeSingle();

    const bancaIds = Array.isArray(ubRow?.banca_ids) ? (ubRow.banca_ids as string[]) : [];
    if (bancaIds.length === 0) {
      return successResponse([]);
    }

    const { data: list, error } = await supabaseServiceRole
      .from('crm_bancas')
      .select('id, name, url')
      .in('id', bancaIds)
      .order('name', { ascending: true });

    if (error) {
      return successResponse([]);
    }
    return successResponse(list ?? []);
  } catch (e) {
    return serverErrorResponse(e);
  }
}
