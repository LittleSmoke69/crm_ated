import { NextRequest } from 'next/server';
import { requireLeadTransferApiAccess } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import {
  getLeadTransferBancaAccess,
  resolveLeadTransferQueryBancaIds,
} from '@/lib/server/crm/adminLeadTransferContext';
import { createCrmRedistributionClient } from '@/lib/server/crm/crmRedistributionClient';
import { normalizeDateParam, dateToStartOfDaySãoPauloISO, dateToEndOfDaySãoPauloISO } from '@/lib/server/crm/transfer-date-utils';

const LOG_PREFIX = '[admin][transfer-metrics]';
const LOGS_PAGE_SIZE = 1000;
const IN_BATCH_SIZE = 150;

function normalizeCrmWarning(message?: string | null): string | null {
  const msg = String(message ?? '').trim();
  const lower = msg.toLowerCase();
  if (!msg) return null;
  if (lower.includes('too many attempts') || lower.includes('too many requests') || lower.includes('429')) {
    return 'CRM temporariamente com muitas tentativas (429). Alguns números podem ficar incompletos.';
  }
  return null;
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

/**
 * GET /api/admin/crm/transfer-metrics
 * KPIs de transferência: total, com saldo, sem saldo; por tipo; conversão por consultor.
 * Com/sem saldo: COUNT(lead_id) em admin_lead_transfer_entries WHERE had_balance = true|false (+ escopo por banca/período/log).
 * Tudo via contagens (sem buscar linhas de entries); logs paginados para não capar no PostgREST.
 */
export async function GET(req: NextRequest) {
  try {
    const { userId, profile } = await requireLeadTransferApiAccess(req);
    const { searchParams } = req.nextUrl;

    const bancaId = searchParams.get('banca_id')?.trim() || null;
    const sourceConsultantEmail = searchParams.get('source_consultant_email')?.trim() || null;
    let bancaIds: string[];
    let singleResolved: { bancaId: string; crmBaseUrl: string } | null = null;

    if (bancaId) {
      const resolved = await getLeadTransferBancaAccess(userId, profile, bancaId);
      if (!resolved) return errorResponse('Banca não encontrada ou sem permissão.');
      bancaIds = [resolved.bancaId];
      singleResolved = { bancaId: resolved.bancaId, crmBaseUrl: resolved.crmBaseUrl };
    } else {
      const scope = await resolveLeadTransferQueryBancaIds(req, userId, profile, null);
      if (scope.error) return errorResponse(scope.error);
      if (!scope.bancaIds.length) {
        return successResponse({
          transferidos_total: 0,
          transferidos_com_saldo: 0,
          transferidos_sem_saldo: 0,
          by_type: { TF: 0, TF1: 0, TF2: 0, TF3: 0 },
          receivedByTarget: undefined,
          convertedCount: undefined,
        });
      }
      bancaIds = scope.bancaIds;
    }

    const fromParam = normalizeDateParam(searchParams.get('from'));
    const toParam = normalizeDateParam(searchParams.get('to'));
    const transferType = searchParams.get('transfer_type')?.trim();
    const targetConsultantEmail = searchParams.get('target_consultant_email')?.trim() || null;
    const transferKindParam = searchParams.get('transfer_kind')?.trim() || null;

    // 1) Trazer todos os logs do escopo (paginado), com id e transfer_type para by_type
    type LogRow = { id: string; transfer_type?: string | null };
    const allLogs: LogRow[] = [];
    let logsOffset = 0;
    let logsHasMore = true;
    while (logsHasMore) {
      let q = supabaseServiceRole
        .from('admin_lead_transfer_logs')
        .select('id, transfer_type')
        .in('banca_id', bancaIds)
        .order('created_at', { ascending: false })
        .range(logsOffset, logsOffset + LOGS_PAGE_SIZE - 1);
      if (fromParam) q = q.gte('created_at', dateToStartOfDaySãoPauloISO(fromParam));
      if (toParam) q = q.lte('created_at', dateToEndOfDaySãoPauloISO(toParam));
      if (transferType && ['TF', 'TF1', 'TF2', 'TF3'].includes(transferType)) q = q.eq('transfer_type', transferType);
      if (sourceConsultantEmail) q = q.ilike('source_consultant_email', sourceConsultantEmail);
      if (
        transferKindParam &&
        ['standard', 'admin_to_gerente_stock', 'gerente_stock_to_consultant'].includes(transferKindParam)
      ) {
        q = q.eq('transfer_kind', transferKindParam);
      }
      const { data: page } = await q;
      const rows = (Array.isArray(page) ? page : []) as LogRow[];
      allLogs.push(...rows);
      logsHasMore = rows.length >= LOGS_PAGE_SIZE;
      logsOffset += LOGS_PAGE_SIZE;
    }

    const logIdsFilter = allLogs.map((r) => r.id);
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

    const logIdChunks = chunkArray(logIdsFilter, IN_BATCH_SIZE);

    // 2) Contagens diretas: com saldo e sem saldo (as duas queries), em paralelo por chunk
    // Equivalente: SELECT count(lead_id) FROM admin_lead_transfer_entries WHERE had_balance = true|false (+ escopo)
    let transferidos_com_saldo = 0;
    let transferidos_sem_saldo = 0;
    for (const chunk of logIdChunks) {
      let qCom = supabaseServiceRole
        .from('admin_lead_transfer_entries')
        .select('lead_id', { count: 'exact', head: true })
        .in('banca_id', bancaIds)
        .in('transfer_log_id', chunk)
        .eq('had_balance', true);
      let qSem = supabaseServiceRole
        .from('admin_lead_transfer_entries')
        .select('lead_id', { count: 'exact', head: true })
        .in('banca_id', bancaIds)
        .in('transfer_log_id', chunk)
        .eq('had_balance', false);
      if (targetConsultantEmail) {
        qCom = qCom.ilike('target_consultant_email', targetConsultantEmail);
        qSem = qSem.ilike('target_consultant_email', targetConsultantEmail);
      }
      const [rCom, rSem] = await Promise.all([qCom, qSem]);
      transferidos_com_saldo += typeof rCom.count === 'number' ? rCom.count : 0;
      transferidos_sem_saldo += typeof rSem.count === 'number' ? rSem.count : 0;
    }

    const transferidos_total = transferidos_com_saldo + transferidos_sem_saldo;

    // 3) by_type: contagem por transfer_type (logs já têm transfer_type)
    const typeToLogIds: Record<string, string[]> = { TF: [], TF1: [], TF2: [], TF3: [] };
    for (const log of allLogs) {
      const t = log.transfer_type && ['TF', 'TF1', 'TF2', 'TF3'].includes(log.transfer_type) ? log.transfer_type : 'TF';
      if (typeToLogIds[t]) typeToLogIds[t].push(log.id);
    }
    const byType: Record<string, number> = { TF: 0, TF1: 0, TF2: 0, TF3: 0 };
    for (const type of ['TF', 'TF1', 'TF2', 'TF3'] as const) {
      const ids = typeToLogIds[type];
      if (ids.length === 0) continue;
      for (const chunk of chunkArray(ids, IN_BATCH_SIZE)) {
        let q = supabaseServiceRole
          .from('admin_lead_transfer_entries')
          .select('lead_id', { count: 'exact', head: true })
          .in('banca_id', bancaIds)
          .in('transfer_log_id', chunk);
        if (targetConsultantEmail) q = q.ilike('target_consultant_email', targetConsultantEmail);
        const { count } = await q;
        byType[type] += typeof count === 'number' ? count : 0;
      }
    }

    const payload: {
      transferidos_total: number;
      transferidos_com_saldo: number;
      transferidos_sem_saldo: number;
      by_type: Record<string, number>;
      receivedByTarget?: number;
      convertedCount?: number;
      crm_warning?: string;
    } = {
      transferidos_total,
      transferidos_com_saldo,
      transferidos_sem_saldo,
      by_type: byType,
    };

    if (targetConsultantEmail) {
      let receivedByTarget = 0;
      for (const chunk of logIdChunks) {
        let q = supabaseServiceRole
          .from('admin_lead_transfer_entries')
          .select('lead_id', { count: 'exact', head: true })
          .in('banca_id', bancaIds)
          .in('transfer_log_id', chunk)
          .ilike('target_consultant_email', targetConsultantEmail);
        const { count } = await q;
        receivedByTarget += typeof count === 'number' ? count : 0;
      }
      payload.receivedByTarget = receivedByTarget;
      if (singleResolved) {
        try {
          const client = createCrmRedistributionClient(singleResolved.crmBaseUrl);
          const result = await client.getIndicatedsByConsultant(targetConsultantEmail, 3000, 1, {
            transferredFilter: 'yes',
            sort: 'created_at',
            direction: 'desc',
          });
          if (!result.success) {
            payload.convertedCount = undefined;
            payload.crm_warning = normalizeCrmWarning(result.error ?? result.message) ?? undefined;
            return successResponse(payload);
          }
          const leads = result.success && Array.isArray(result.data) ? result.data : [];
          const isTransferred = (lead: unknown) => {
            const l = lead as { transferred?: unknown };
            return l.transferred === true || l.transferred === 'true' || l.transferred === 1;
          };
          const transferredLeads = leads.filter(isTransferred);
          const convertedCount = transferredLeads.filter((lead: unknown) => {
            const l = lead as { total_depositos_count?: unknown };
            return (parseInt(String(l.total_depositos_count), 10) || 0) >= 1;
          }).length;
          payload.convertedCount = convertedCount;
        } catch (crmErr) {
          console.warn(`${LOG_PREFIX} CRM getIndicatedsByConsultant failed:`, crmErr);
        }
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
