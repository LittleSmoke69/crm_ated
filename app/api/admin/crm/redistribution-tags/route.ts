import { NextRequest } from 'next/server';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { requireAdminLeadTransferContext, isConsultantInBanca } from '@/lib/server/crm/adminLeadTransferContext';
import { createCrmRedistributionClient } from '@/lib/server/crm/crmRedistributionClient';
import { z } from 'zod';

const querySchema = z.object({
  banca_id: z.string().uuid(),
  consultant_email: z.string().email(),
});

const LOG_PREFIX = '[lead-transfer][redistribution-tags]';

/**
 * GET /api/admin/crm/redistribution-tags
 * Proxy para CRM: listar tags do consultor (para filtro).
 * Query: banca_id, consultant_email (obrigatórios)
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const bancaIdRaw = searchParams.get('banca_id');
    const consultantEmailRaw = searchParams.get('consultant_email');

    console.log(`${LOG_PREFIX} GET request: banca_id=${bancaIdRaw ?? 'null'}, consultant_email=${consultantEmailRaw ?? 'null'}`);

    const parsed = querySchema.safeParse({
      banca_id: bancaIdRaw,
      consultant_email: consultantEmailRaw,
    });

    if (!parsed.success) {
      const issues = parsed.error?.issues ?? [];
      console.log(`${LOG_PREFIX} GET validation failed (400):`, JSON.stringify(issues, null, 2));
      return errorResponse('Parâmetros inválidos. banca_id e consultant_email são obrigatórios.', 400);
    }

    const { banca_id, consultant_email } = parsed.data;
    const ctx = await requireAdminLeadTransferContext(req, banca_id);
    console.log(`${LOG_PREFIX} GET context: userId=${ctx.userId}, bancaId=${ctx.bancaId}, crmBaseUrl=${ctx.crmBaseUrl}`);

    const isInBanca = await isConsultantInBanca(ctx.bancaId, consultant_email);
    if (!isInBanca) {
      console.log(`${LOG_PREFIX} GET consultant not in banca (400): consultant_email=${consultant_email}, bancaId=${ctx.bancaId}`);
      return errorResponse('Consultor não pertence à banca selecionada.', 400);
    }

    const client = createCrmRedistributionClient(ctx.crmBaseUrl);
    const result = await client.getRedistributionTags({ consultant_email });

    if (!result.success) {
      console.log(`${LOG_PREFIX} GET CRM returned error (fallback empty tags):`, { error: result.error, message: result.message });
      return successResponse({ tags: [] });
    }

    const tags = result.data ?? result.tags ?? [];
    const tagsArray = Array.isArray(tags) ? tags : [];
    console.log(`${LOG_PREFIX} GET success: ${tagsArray.length} tag(s)`, tagsArray);
    return successResponse({ tags: tagsArray });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('não tem permissão') || message.includes('obrigatório')) {
      return errorResponse(message, 403);
    }
    console.error(`${LOG_PREFIX} GET error:`, { message, stack: err instanceof Error ? err.stack : undefined, err });
    return serverErrorResponse(err);
  }
}
