/**
 * GET /api/admin/crm/consultant-registered
 *
 * Verifica se o consultor está cadastrado na banca via endpoint total-indicateds-by-consultant do CRM.
 * 200 = cadastrado na banca; 404 = não cadastrado (não segue para as demais requisições).
 * Query: banca_id (obrigatório), email (obrigatório).
 */

import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { getAdminBancaId } from '@/lib/server/crm/adminLeadTransferContext';

const LOG_PREFIX = '[admin][consultant-registered]';

function normalizeBancaUrl(raw: string): string {
  let u = raw.trim();
  u = u.replace(/^https?:\/\//i, '').replace(/\/api\/crm\/?/i, '').replace(/\/+$/, '').trim();
  if (!u) return '';
  return u.startsWith('http') ? u : `https://${u}`;
}

export async function GET(req: NextRequest) {
  try {
    const { userId, profile } = await requireAdmin(req);
    const bancaId = req.nextUrl.searchParams.get('banca_id')?.trim() || null;
    const email = req.nextUrl.searchParams.get('email')?.trim() || null;

    if (!bancaId || !email) {
      return errorResponse('banca_id e email são obrigatórios.', 400);
    }

    const resolved = await getAdminBancaId(userId, profile, bancaId);
    if (!resolved?.crmBaseUrl) {
      return errorResponse('Banca não encontrada ou sem permissão.', 404);
    }

    const base = normalizeBancaUrl(resolved.crmBaseUrl);
    if (!base) {
      return errorResponse('URL da banca inválida.', 400);
    }

    const apiKey = process.env.CRM_API_KEY?.trim();
    if (!apiKey) {
      console.warn(`${LOG_PREFIX} CRM_API_KEY não configurada; assumindo consultor cadastrado.`);
      return successResponse({ registered: true });
    }

    const url = `${base}/api/crm/total-indicateds-by-consultant?consultant=${encodeURIComponent(email)}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json', 'x-api-key': apiKey },
      signal: AbortSignal.timeout(15000),
    });

    const registered = res.status === 200;
    if (res.status !== 200 && res.status !== 404) {
      console.warn(`${LOG_PREFIX} total-indicateds-by-consultant status inesperado: ${res.status} para email=${email}`);
    }
    return successResponse({ registered });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('não tem permissão') || message.includes('obrigatório')) {
      return errorResponse(message, 403);
    }
    console.error(`${LOG_PREFIX} GET error:`, err);
    return serverErrorResponse(err as Error);
  }
}
