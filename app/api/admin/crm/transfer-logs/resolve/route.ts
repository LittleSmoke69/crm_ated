/**
 * POST /api/admin/crm/transfer-logs/resolve
 *
 * Resolve uma transferência expirada (após o prazo em dias do log):
 * - Busca dados atuais dos leads no CRM (consultor destino).
 * - Compara total_depositado e total_apostado atuais com o snapshot.
 * - Se o lead teve atividade → vinculado (fica com o consultor).
 * - Caso contrário → disponivel_retransferencia (pode ser movido para o próximo).
 *
 * Query/body: log_id (obrigatório), banca_id (obrigatório).
 */

import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { getAdminBancaId } from '@/lib/server/crm/adminLeadTransferContext';
import { resolveOneTransferLog } from '@/lib/server/crm/resolveTransferLog';

const LOG_PREFIX = '[admin][transfer-logs][resolve]';

export async function POST(req: NextRequest) {
  try {
    const { userId, profile } = await requireAdmin(req);

    let logId = req.nextUrl.searchParams.get('log_id')?.trim() || null;
    let bancaId = req.nextUrl.searchParams.get('banca_id')?.trim() || null;
    if (req.headers.get('content-type')?.toLowerCase().includes('application/json')) {
      try {
        const body = await req.json();
        const b = body as { log_id?: string; banca_id?: string };
        if (!logId) logId = b?.log_id?.trim() || null;
        if (!bancaId) bancaId = b?.banca_id?.trim() || null;
      } catch {
        // ignore
      }
    }

    if (!logId || !bancaId) {
      return errorResponse('log_id e banca_id são obrigatórios.', 400);
    }

    const resolved = await getAdminBancaId(userId, profile, bancaId);
    if (!resolved) {
      return errorResponse('Banca não encontrada ou sem permissão.', 403);
    }

    const result = await resolveOneTransferLog(
      { bancaId: resolved.bancaId, crmBaseUrl: resolved.crmBaseUrl },
      logId
    );

    if (result.resolved === 0) {
      return errorResponse(result.message, 400);
    }

    return successResponse({
      resolved: result.resolved,
      vinculado: result.vinculado,
      disponivel_retransferencia: result.disponivel_retransferencia,
      message: `Resolução concluída: ${result.message}`,
    });
  } catch (err: unknown) {
    console.error(`${LOG_PREFIX} error:`, err);
    return serverErrorResponse(err as Error);
  }
}
