/**
 * POST /api/admin/crm/transfer-logs/unlink-all-vinculados
 *
 * Desvincula em massa todos os leads que estão vinculados aos consultores (resolution_status = 'vinculado').
 * Eles passam a ficar disponíveis para repasse (disponivel_retransferencia).
 * Body: { banca_id?: string } — se omitido, aplica em todas as bancas permitidas ao admin.
 */

import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { getAdminBancaId, getAdminAllowedBancaIds } from '@/lib/server/crm/adminLeadTransferContext';
import { getEffectiveZaplotoId } from '@/lib/tenant-context';

export async function POST(req: NextRequest) {
  try {
    const { userId, profile } = await requireAdmin(req);

    let body: { banca_id?: string } = {};
    try {
      body = req.headers.get('content-type')?.toLowerCase().includes('application/json')
        ? await req.json()
        : {};
    } catch {
      body = {};
    }

    const bancaIdParam = body.banca_id?.trim() || null;

    let bancaIds: string[];
    if (bancaIdParam) {
      const resolved = await getAdminBancaId(userId, profile, bancaIdParam);
      if (!resolved) return errorResponse('Banca não encontrada ou sem permissão.', 403);
      bancaIds = [resolved.bancaId];
    } else {
      const zaplotoId = await getEffectiveZaplotoId(req, profile);
      const allowed = await getAdminAllowedBancaIds(profile, zaplotoId);
      if (!allowed?.length) return successResponse({ count: 0, message: 'Nenhuma banca permitida.' });
      bancaIds = allowed;
    }

    const { data: updated, error } = await supabaseServiceRole
      .from('admin_lead_transfer_entries')
      .update({
        resolution_status: 'disponivel_retransferencia',
        resolved_at: new Date().toISOString(),
      })
      .in('banca_id', bancaIds)
      .eq('resolution_status', 'vinculado')
      .select('id');

    if (error) {
      console.error('[admin][transfer-logs][unlink-all-vinculados] update error:', error);
      return errorResponse('Erro ao desvincular leads.');
    }

    const count = Array.isArray(updated) ? updated.length : 0;
    return successResponse({
      count,
      message: count === 0
        ? 'Nenhum lead vinculado encontrado para desvincular.'
        : `${count} lead(s) desvinculado(s). Agora disponíveis para repasse.`,
    });
  } catch (err: unknown) {
    console.error('[admin][transfer-logs][unlink-all-vinculados] error:', err);
    return serverErrorResponse(err as Error);
  }
}
