import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { getAdminBancaId } from '@/lib/server/crm/adminLeadTransferContext';
import { createCrmRedistributionClient } from '@/lib/server/crm/crmRedistributionClient';
import { normalizeDateParam, dateToStartOfDaySãoPauloISO, dateToEndOfDaySãoPauloISO } from '@/lib/server/crm/transfer-date-utils';

const LOG_PREFIX = '[admin][transfer-consultant-verifier-details]';

export type VerifierDetailLead = {
  lead_id: string;
  name: string | null;
  phone: string | null;
  depositaram_depois: boolean;
  jogaram_depois: boolean;
  sacaram_depois: boolean;
  total_depositado_snapshot: number;
  total_depositado_atual: number;
  total_apostado_snapshot: number;
  total_apostado_atual: number;
  total_saque_atual: number;
  available_withdraw_snapshot: number;
  available_withdraw_atual: number;
};

/**
 * GET /api/admin/crm/transfer-consultant-verifier/details
 * Retorna os leads do consultor que tiveram modificação: depositaram depois OU sacaram depois (e jogaram depois).
 * Query: banca_id, from, to (YYYY-MM-DD), consultant_email (obrigatório).
 */
export async function GET(req: NextRequest) {
  try {
    const { userId, profile } = await requireAdmin(req);
    const { searchParams } = req.nextUrl;

    const bancaId = searchParams.get('banca_id')?.trim() || null;
    const consultantEmail = searchParams.get('consultant_email')?.trim()?.toLowerCase() || null;

    if (!bancaId || !consultantEmail) {
      return errorResponse('banca_id e consultant_email são obrigatórios.');
    }

    const resolved = await getAdminBancaId(userId, profile, bancaId, { skipLeadTransferLock: true });
    if (!resolved) {
      return errorResponse('Banca não encontrada ou sem permissão.');
    }

    const fromParam = normalizeDateParam(searchParams.get('from'));
    const toParam = normalizeDateParam(searchParams.get('to'));

    let logsQuery = supabaseServiceRole
      .from('admin_lead_transfer_logs')
      .select('id')
      .eq('banca_id', resolved.bancaId);

    if (fromParam) {
      logsQuery = logsQuery.gte('created_at', dateToStartOfDaySãoPauloISO(fromParam));
    }
    if (toParam) {
      logsQuery = logsQuery.lte('created_at', dateToEndOfDaySãoPauloISO(toParam));
    }
    const { data: logs, error: logsError } = await logsQuery.order('created_at', { ascending: false }).limit(5000);

    if (logsError || !Array.isArray(logs) || logs.length === 0) {
      return successResponse([]);
    }

    const logIds = logs.map((r: { id: string }) => r.id);

    const { data: entries, error: entriesError } = await supabaseServiceRole
      .from('admin_lead_transfer_entries')
      .select('lead_id, total_depositado_snapshot, total_apostado_snapshot, available_withdraw_snapshot')
      .in('transfer_log_id', logIds)
      .eq('banca_id', resolved.bancaId)
      .ilike('target_consultant_email', consultantEmail)
      .limit(50000);

    if (entriesError || !Array.isArray(entries)) {
      console.error(`${LOG_PREFIX} entries error:`, entriesError);
      return errorResponse('Erro ao buscar leads.');
    }

    if (entries.length === 0) {
      return successResponse([]);
    }

    const client = createCrmRedistributionClient(resolved.crmBaseUrl);
    const leadDetailsById = new Map<string, { name?: string | null; phone?: string | null; total_depositado?: number; total_apostado?: number; total_saque?: number; available_withdraw?: number }>();

    try {
      const result = await client.getIndicatedsByConsultant(
        consultantEmail,
        3000,
        1,
        { transferredFilter: 'yes', sort: 'created_at', direction: 'desc' }
      );
      const leads = result.success && Array.isArray(result.data) ? result.data : [];
      for (const l of leads) {
        const id = l?.id != null ? String(l.id) : '';
        if (!id) continue;
        const fullName = [l.name, l.last_name].filter(Boolean).map(String).join(' ').trim() || null;
      leadDetailsById.set(id, {
          name: fullName,
          phone: l.phone ?? l.whatsapp ?? null,
          total_depositado: l.total_depositado != null ? Number(l.total_depositado) : undefined,
          total_apostado: l.total_apostado != null ? Number(l.total_apostado) : undefined,
          total_saque: l.total_saque != null ? Number(l.total_saque) : undefined,
          available_withdraw: l.available_withdraw != null ? Number(l.available_withdraw) : undefined,
        });
      }
    } catch (crmErr) {
      console.warn(`${LOG_PREFIX} CRM failed for ${consultantEmail}:`, crmErr);
    }

    const list: VerifierDetailLead[] = [];

    for (const entry of entries) {
      const leadId = String(entry.lead_id ?? '');
      const current = leadDetailsById.get(leadId);
      const snapDep = entry.total_depositado_snapshot != null ? Number(entry.total_depositado_snapshot) : 0;
      const snapApost = entry.total_apostado_snapshot != null ? Number(entry.total_apostado_snapshot) : 0;
      const snapWithdraw = entry.available_withdraw_snapshot != null ? Number(entry.available_withdraw_snapshot) : 0;
      const curDep = current?.total_depositado ?? 0;
      const curApost = current?.total_apostado ?? 0;
      const curSaque = current?.total_saque ?? 0;
      const curWithdraw = current?.available_withdraw ?? 0;

      const depositaramDepois = curDep > snapDep;
      const jogaramDepois = curApost > snapApost;
      const sacaramDepois = curSaque > 0 || (snapWithdraw > 0 && curWithdraw < snapWithdraw);

      if (!depositaramDepois && !sacaramDepois) continue;

      const name = current?.name ?? null;
      const phone = current?.phone ?? null;
      list.push({
        lead_id: leadId,
        name: name && String(name).trim() ? String(name).trim() : null,
        phone: phone && String(phone).trim() ? String(phone).trim() : null,
        depositaram_depois: depositaramDepois,
        jogaram_depois: jogaramDepois,
        sacaram_depois: sacaramDepois,
        total_depositado_snapshot: snapDep,
        total_depositado_atual: curDep,
        total_apostado_snapshot: snapApost,
        total_apostado_atual: curApost,
        total_saque_atual: curSaque,
        available_withdraw_snapshot: snapWithdraw,
        available_withdraw_atual: curWithdraw,
      });
    }

    return successResponse(list);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('não tem permissão') || message.includes('obrigatório')) {
      return errorResponse(message, 403);
    }
    console.error(`${LOG_PREFIX} GET error:`, err);
    return serverErrorResponse(err);
  }
}
