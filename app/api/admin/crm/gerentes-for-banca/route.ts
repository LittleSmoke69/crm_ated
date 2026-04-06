import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { getAdminBancaId } from '@/lib/server/crm/adminLeadTransferContext';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * GET /api/admin/crm/gerentes-for-banca?banca_id=
 * Gerentes que possuem a banca em user_bancas (ex.: destino “estoque do gerente”).
 */
export async function GET(req: NextRequest) {
  try {
    const { userId, profile } = await requireAdmin(req);
    const bancaId = req.nextUrl.searchParams.get('banca_id')?.trim();
    if (!bancaId) return errorResponse('banca_id é obrigatório.', 400);

    const resolved = await getAdminBancaId(userId, profile, bancaId);
    if (!resolved) return errorResponse('Banca não encontrada ou sem permissão.', 404);

    const { data: ubRows } = await supabaseServiceRole.from('user_bancas').select('user_id, banca_ids');
    const gerenteUserIds = new Set<string>();
    for (const row of ubRows ?? []) {
      const ids = Array.isArray(row.banca_ids) ? (row.banca_ids as string[]) : [];
      if (ids.includes(bancaId)) {
        gerenteUserIds.add(row.user_id as string);
      }
    }

    if (gerenteUserIds.size === 0) {
      return successResponse([]);
    }

    const { data: profs } = await supabaseServiceRole
      .from('profiles')
      .select('id, email, full_name, status')
      .in('id', [...gerenteUserIds])
      .eq('status', 'gerente')
      .order('full_name', { ascending: true });

    return successResponse(profs ?? []);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('não tem permissão')) return errorResponse(message, 403);
    return serverErrorResponse(err);
  }
}
