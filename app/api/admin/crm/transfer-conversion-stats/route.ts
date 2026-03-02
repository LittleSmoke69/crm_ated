import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { getAdminBancaId } from '@/lib/server/crm/adminLeadTransferContext';
import { createCrmRedistributionClient } from '@/lib/server/crm/crmRedistributionClient';
import { normalizeDateParam, dateToStartOfDaySãoPauloISO, dateToEndOfDaySãoPauloISO } from '@/lib/server/crm/transfer-date-utils';

const LOG_PREFIX = '[admin][transfer-conversion-stats]';

/**
 * GET /api/admin/crm/transfer-conversion-stats
 * Estatísticas de transferência e conversão.
 * Query: banca_id (obrigatório), from (YYYY-MM-DD), to (YYYY-MM-DD), target_consultant_email (opcional - para conversão do consultor)
 * Retorna: totalTransferred, byType (TF, TF1, TF2, TF3), e se target_consultant_email: receivedByTarget, convertedCount (leads transferidos que já depositaram)
 */
export async function GET(req: NextRequest) {
  try {
    const { userId, profile } = await requireAdmin(req);
    const { searchParams } = req.nextUrl;

    const bancaId = searchParams.get('banca_id')?.trim() || null;
    if (!bancaId) {
      return errorResponse('banca_id é obrigatório.');
    }

    const resolved = await getAdminBancaId(userId, profile, bancaId);
    if (!resolved) {
      return errorResponse('Banca não encontrada ou sem permissão.');
    }

    const fromParam = normalizeDateParam(searchParams.get('from'));
    const toParam = normalizeDateParam(searchParams.get('to'));
    const targetConsultantEmail = searchParams.get('target_consultant_email')?.trim() || null;

    let query = supabaseServiceRole
      .from('admin_lead_transfer_logs')
      .select('count, transfer_type, target_consultant_email')
      .eq('banca_id', resolved.bancaId);

    if (fromParam) {
      query = query.gte('created_at', dateToStartOfDaySãoPauloISO(fromParam));
    }
    if (toParam) {
      query = query.lte('created_at', dateToEndOfDaySãoPauloISO(toParam));
    }

    let list: { count?: number; transfer_type?: string | null; target_consultant_email?: string | null }[] = [];
    let totalTransferred = 0;
    const byType: Record<string, number> = { TF: 0, TF1: 0, TF2: 0, TF3: 0 };

    const { data: logs, error } = await query;

    if (error) {
      console.error(`${LOG_PREFIX} GET error:`, error);
      return errorResponse('Erro ao buscar estatísticas.');
    }

    list = Array.isArray(logs) ? logs : [];
    for (const row of list) {
      const count = Number(row.count) || 0;
      const type = (row.transfer_type && ['TF', 'TF1', 'TF2', 'TF3'].includes(String(row.transfer_type)))
        ? String(row.transfer_type)
        : 'TF';
      totalTransferred += count;
      if (byType[type] !== undefined) {
        byType[type] += count;
      } else {
        byType[type] = count;
      }
    }

    const payload: {
      totalTransferred: number;
      byType: Record<string, number>;
      receivedByTarget?: number;
      convertedCount?: number;
    } = { totalTransferred, byType };

    if (targetConsultantEmail) {
      const emailNorm = targetConsultantEmail.toLowerCase().trim();
      const receivedByTarget = list
        .filter((r) => String(r.target_consultant_email ?? '').toLowerCase().trim() === emailNorm)
        .reduce((s, r) => s + (Number(r.count) || 0), 0);
      payload.receivedByTarget = receivedByTarget;

      try {
        const client = createCrmRedistributionClient(resolved.crmBaseUrl);
        const result = await client.getIndicatedsByConsultant(targetConsultantEmail, 3000, 1, {
          transferredFilter: 'yes',
          sort: 'created_at',
          direction: 'desc',
        });
        const leads = result.success && Array.isArray(result.data) ? result.data : [];
        const isTransferred = (lead: any) =>
          lead.transferred === true || lead.transferred === 'true' || lead.transferred === 1;
        const transferredLeads = leads.filter((l: any) => isTransferred(l));
        const convertedCount = transferredLeads.filter(
          (l: any) => (parseInt(String(l.total_depositos_count), 10) || 0) >= 1
        ).length;
        payload.convertedCount = convertedCount;
      } catch (crmErr) {
        console.warn(`${LOG_PREFIX} CRM getIndicatedsByConsultant failed:`, crmErr);
        payload.convertedCount = undefined;
      }
    }

    return successResponse(payload);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('não tem permissão') || message.includes('obrigatório')) {
      return errorResponse(message, 403);
    }
    console.error(`${LOG_PREFIX} GET error:`, err);
    return serverErrorResponse(err);
  }
}
