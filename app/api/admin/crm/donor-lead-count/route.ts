import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { requireAdminLeadTransferContext } from '@/lib/server/crm/adminLeadTransferContext';
import { createCrmRedistributionClient } from '@/lib/server/crm/crmRedistributionClient';

const LOG_PREFIX = '[admin/crm/donor-lead-count]';

/**
 * GET /api/admin/crm/donor-lead-count
 * Retorna o total de leads disponíveis (não transferidos) de um consultor doador.
 * Não exige que o doador pertença à banca (doadores podem ser de qualquer perfil).
 * Query: banca_id (UUID), source_email (e-mail do doador)
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const { searchParams } = new URL(req.url);
    const bancaId = searchParams.get('banca_id')?.trim();
    const sourceEmail = searchParams.get('source_email')?.trim();

    if (!bancaId) return errorResponse('banca_id é obrigatório.', 400);
    if (!sourceEmail) return errorResponse('source_email é obrigatório.', 400);

    const ctx = await requireAdminLeadTransferContext(req, bancaId);
    const client = createCrmRedistributionClient(ctx.crmBaseUrl);

    const result = await client.getRedistributionLeads({
      source_consultant_email: sourceEmail,
      days_inactive: 0,
      transferred_filter: 'no',
    });

    if (!result.success) {
      console.warn(`${LOG_PREFIX} CRM error for ${sourceEmail}:`, result.error ?? result.message);
      return errorResponse(result.error ?? 'Erro ao buscar leads no CRM.', 400);
    }

    const count = Array.isArray(result.data) ? result.data.length : 0;
    console.log(`${LOG_PREFIX} donor=${sourceEmail} count=${count}`);
    return successResponse({ count }, `${count} lead(s) disponível(is) para ${sourceEmail}.`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Acesso negado') || msg.includes('não tem permissão')) return errorResponse(msg, 403);
    console.error(`${LOG_PREFIX} Error:`, err);
    return serverErrorResponse(err);
  }
}
