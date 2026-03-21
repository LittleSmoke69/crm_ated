import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { requireAdminLeadTransferContext } from '@/lib/server/crm/adminLeadTransferContext';
import { createCrmRedistributionClient } from '@/lib/server/crm/crmRedistributionClient';

const LOG_PREFIX = '[admin/crm/donor-lead-counts-batch]';

/**
 * POST /api/admin/crm/donor-lead-counts-batch
 * Retorna a contagem de leads disponíveis para múltiplos consultores em uma única chamada.
 * O servidor busca todos em paralelo, reduzindo o número de round-trips do browser.
 * Body: { banca_id: string, emails: string[] }
 * Response: { counts: Record<string, number>, failed: string[] }
 *   - counts: somente emails com resultado definitivo (sucesso OU 404 "Consultant not found")
 *   - failed: emails que falharam por rate limit (429) ou erro transitório — NÃO cachear no cliente
 */
export async function POST(req: NextRequest) {
  try {
    await requireAdmin(req);

    const body = await req.json() as { banca_id?: string; emails?: unknown };
    const bancaId = typeof body.banca_id === 'string' ? body.banca_id.trim() : '';
    const emails: string[] = Array.isArray(body.emails)
      ? (body.emails as unknown[]).filter((e): e is string => typeof e === 'string' && e.trim().length > 0).map((e) => e.trim())
      : [];

    if (!bancaId) return errorResponse('banca_id é obrigatório.', 400);
    if (emails.length === 0) return successResponse({ counts: {}, failed: [] }, 'Nenhum e-mail fornecido.');
    if (emails.length > 200) return errorResponse('Máximo de 200 e-mails por requisição.', 400);

    const ctx = await requireAdminLeadTransferContext(req, bancaId);
    const client = createCrmRedistributionClient(ctx.crmBaseUrl);

    const counts: Record<string, number> = {};
    const failed: string[] = [];

    // Fetch em paralelo no servidor (concorrência 5 — conservador para não disparar rate limit do CRM)
    const CONCURRENCY = 5;
    const queue = [...emails];

    const runWorker = async () => {
      while (queue.length > 0) {
        const email = queue.shift();
        if (!email) break;
        const key = email.toLowerCase();
        try {
          const result = await client.getRedistributionLeads({
            source_consultant_email: email,
            days_inactive: 0,
            transferred_filter: 'no',
          });
          if (result.success) {
            // Resultado definitivo: consultor existe, contar leads
            counts[key] = Array.isArray(result.data) ? result.data.length : 0;
          } else {
            const err = (result.error ?? result.message ?? '').toLowerCase();
            if (err.includes('consultant not found') || err.includes('not found')) {
              // Consultor não existe no CRM → 0 leads (pode cachear)
              counts[key] = 0;
            } else {
              // Erro transitório (429, timeout, etc.) → não cachear
              failed.push(key);
            }
          }
        } catch {
          // Exceção de rede/timeout → não cachear
          failed.push(key);
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, emails.length) }, () => runWorker()));

    console.log(`${LOG_PREFIX} banca=${bancaId} total=${emails.length} success=${Object.keys(counts).length} failed=${failed.length}`);
    return successResponse({ counts, failed }, `${emails.length} consultor(es) consultado(s).`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Acesso negado') || msg.includes('não tem permissão')) return errorResponse(msg, 403);
    console.error(`${LOG_PREFIX} Error:`, err);
    return serverErrorResponse(err);
  }
}
