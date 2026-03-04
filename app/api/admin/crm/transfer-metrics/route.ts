import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { getAdminBancaId, getAdminAllowedBancaIds } from '@/lib/server/crm/adminLeadTransferContext';
import { getEffectiveZaplotoId } from '@/lib/tenant-context';
import { createCrmRedistributionClient } from '@/lib/server/crm/crmRedistributionClient';
import { normalizeDateParam, dateToStartOfDaySãoPauloISO, dateToEndOfDaySãoPauloISO } from '@/lib/server/crm/transfer-date-utils';

const LOG_PREFIX = '[admin][transfer-metrics]';

/**
 * GET /api/admin/crm/transfer-metrics
 * KPIs de transferência: total, com saldo, sem saldo; conversão por consultor destino.
 * Query: banca_id (opcional; omitir = Todas as Bancas), from, to, transfer_type?, target_consultant_email? (conversão só quando uma banca é selecionada)
 */
export async function GET(req: NextRequest) {
  try {
    const { userId, profile } = await requireAdmin(req);
    const { searchParams } = req.nextUrl;

    const bancaId = searchParams.get('banca_id')?.trim() || null;
    let bancaIds: string[];
    let singleResolved: { bancaId: string; crmBaseUrl: string } | null = null;

    if (bancaId) {
      const resolved = await getAdminBancaId(userId, profile, bancaId);
      if (!resolved) {
        return errorResponse('Banca não encontrada ou sem permissão.');
      }
      bancaIds = [resolved.bancaId];
      singleResolved = { bancaId: resolved.bancaId, crmBaseUrl: resolved.crmBaseUrl };
    } else {
      const zaplotoId = await getEffectiveZaplotoId(req, profile);
      const allowed = await getAdminAllowedBancaIds(profile, zaplotoId);
      if (!allowed || allowed.length === 0) {
        return successResponse({
          transferidos_total: 0,
          transferidos_com_saldo: 0,
          transferidos_sem_saldo: 0,
          by_type: { TF: 0, TF1: 0, TF2: 0, TF3: 0 },
          receivedByTarget: undefined,
          convertedCount: undefined,
        });
      }
      bancaIds = allowed;
    }

    const fromParam = normalizeDateParam(searchParams.get('from'));
    const toParam = normalizeDateParam(searchParams.get('to'));
    const transferType = searchParams.get('transfer_type')?.trim();
    const targetConsultantEmail = searchParams.get('target_consultant_email')?.trim() || null;

    let idsOnlyQuery = supabaseServiceRole
      .from('admin_lead_transfer_logs')
      .select('id')
      .in('banca_id', bancaIds);
    if (fromParam) idsOnlyQuery = idsOnlyQuery.gte('created_at', dateToStartOfDaySãoPauloISO(fromParam));
    if (toParam) idsOnlyQuery = idsOnlyQuery.lte('created_at', dateToEndOfDaySãoPauloISO(toParam));
    if (transferType && ['TF', 'TF1', 'TF2', 'TF3'].includes(transferType)) {
      idsOnlyQuery = idsOnlyQuery.eq('transfer_type', transferType);
    }
    const { data: logIds } = await idsOnlyQuery;
    const logIdsFilter = (logIds ?? []).map((r: { id: string }) => r.id);
    if (logIdsFilter.length === 0) {
      return successResponse({
        transferidos_total: 0,
        transferidos_com_saldo: 0,
        transferidos_sem_saldo: 0,
        by_type: { TF: 0, TF1: 0, TF2: 0, TF3: 0 },
        receivedByTarget: targetConsultantEmail ? 0 : undefined,
        convertedCount: targetConsultantEmail ? 0 : undefined,
      });
    }

    let countQuery = supabaseServiceRole
      .from('admin_lead_transfer_entries')
      .select('id', { count: 'exact', head: true })
      .in('banca_id', bancaIds)
      .in('transfer_log_id', logIdsFilter);
    if (targetConsultantEmail?.trim()) {
      countQuery = countQuery.ilike('target_consultant_email', targetConsultantEmail.trim());
    }
    const { count: transferidos_totalCount } = await countQuery;

    const entriesQuery = supabaseServiceRole
      .from('admin_lead_transfer_entries')
      .select('id, transfer_log_id, lead_id, had_balance, target_consultant_email')
      .in('banca_id', bancaIds)
      .in('transfer_log_id', logIdsFilter)
      .limit(50000);
    const { data: entries, error: entriesError } = await entriesQuery;

    if (entriesError) {
      console.error(`${LOG_PREFIX} entries error:`, entriesError);
      return errorResponse('Erro ao buscar métricas de transferência.');
    }

    const list = Array.isArray(entries) ? entries : [];
    const emailNorm = targetConsultantEmail ? targetConsultantEmail.toLowerCase().trim() : null;
    const listToUse = emailNorm
      ? list.filter((e: { target_consultant_email?: string }) => String(e.target_consultant_email ?? '').toLowerCase().trim() === emailNorm)
      : list;

    const transferidos_total = typeof transferidos_totalCount === 'number' ? transferidos_totalCount : listToUse.length;
    const transferidos_com_saldo = listToUse.filter((e: { had_balance?: boolean }) => e.had_balance === true).length;
    const transferidos_sem_saldo = transferidos_total - transferidos_com_saldo;

    // byType deve ser derivado das mesmas entries (listToUse) para bater com total e com/sem saldo
    const logIdsFromList = [...new Set(listToUse.map((e: { transfer_log_id?: string }) => e.transfer_log_id).filter(Boolean))];
    let byType: Record<string, number> = { TF: 0, TF1: 0, TF2: 0, TF3: 0 };
    if (logIdsFromList.length > 0) {
      const { data: logsForType } = await supabaseServiceRole
        .from('admin_lead_transfer_logs')
        .select('id, transfer_type')
        .in('banca_id', bancaIds)
        .in('id', logIdsFromList);
      const logIdToType = new Map<string, string>();
      for (const row of Array.isArray(logsForType) ? logsForType : []) {
        const type = (row.transfer_type && ['TF', 'TF1', 'TF2', 'TF3'].includes(String(row.transfer_type)))
          ? String(row.transfer_type)
          : 'TF';
        logIdToType.set(String(row.id), type);
      }
      for (const entry of listToUse) {
        const type = logIdToType.get(String(entry.transfer_log_id ?? '')) ?? 'TF';
        if (byType[type] !== undefined) byType[type] += 1;
        else byType[type] = 1;
      }
    }

    const payload: {
      transferidos_total: number;
      transferidos_com_saldo: number;
      transferidos_sem_saldo: number;
      by_type: Record<string, number>;
      receivedByTarget?: number;
      convertedCount?: number;
    } = {
      transferidos_total,
      transferidos_com_saldo,
      transferidos_sem_saldo,
      by_type: byType,
    };

    if (targetConsultantEmail && singleResolved) {
      payload.receivedByTarget = listToUse.length;
      try {
        const client = createCrmRedistributionClient(singleResolved.crmBaseUrl);
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
