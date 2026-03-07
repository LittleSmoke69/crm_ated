/**
 * GET /api/admin/crm/transfer-logs/resolved-stats
 *
 * Estatísticas de transferências já resolvidas no banco (com leads disponíveis para mover).
 * Query: banca_id?, from?, to? (mesmo período dos filtros do Histórico).
 * Retorno: total_resolved_logs, total_disponivel, by_type: { TF, TF1, TF2, TF3 }
 */

import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { getAdminBancaId, getAdminAllowedBancaIds } from '@/lib/server/crm/adminLeadTransferContext';
import { getEffectiveZaplotoId } from '@/lib/tenant-context';
import { normalizeDateParam, dateToStartOfDaySãoPauloISO, dateToEndOfDaySãoPauloISO } from '@/lib/server/crm/transfer-date-utils';
import { isTransferExpired } from '@/lib/server/crm/resolveTransferLog';
import { createCrmRedistributionClient } from '@/lib/server/crm/crmRedistributionClient';

const DEFAULT_DEADLINE_DAYS = 10;

export async function GET(req: NextRequest) {
  try {
    const { userId, profile } = await requireAdmin(req);
    const searchParams = req.nextUrl.searchParams;
    const bancaId = searchParams.get('banca_id')?.trim() || null;
    const fromParam = normalizeDateParam(searchParams.get('from'));
    const toParam = normalizeDateParam(searchParams.get('to'));

    let bancaIds: string[];
    if (bancaId) {
      const resolved = await getAdminBancaId(userId, profile, bancaId);
      if (!resolved) return errorResponse('Banca não encontrada ou sem permissão.', 403);
      bancaIds = [resolved.bancaId];
    } else {
      const zaplotoId = await getEffectiveZaplotoId(req, profile);
      const allowed = await getAdminAllowedBancaIds(profile, zaplotoId);
      if (!allowed?.length) return successResponse({ total_resolved_logs: 0, total_disponivel: 0, total_vinculado: 0, total_lucro_realizado: 0, total_aposta_realizado: 0, by_type: { TF: 0, TF1: 0, TF2: 0, TF3: 0 } });
      bancaIds = allowed;
    }

    const MAX_ROWS = 500000;
    let q = supabaseServiceRole
      .from('admin_lead_transfer_logs')
      .select('id, banca_id, created_at, deadline_days, transfer_type')
      .in('banca_id', bancaIds)
      .order('created_at', { ascending: false })
      .limit(MAX_ROWS);

    if (fromParam) q = q.gte('created_at', dateToStartOfDaySãoPauloISO(fromParam));
    if (toParam) q = q.lte('created_at', dateToEndOfDaySãoPauloISO(toParam));

    const { data: logs, error: logsError } = await q;

    if (logsError || !logs?.length) {
      return successResponse({ total_resolved_logs: 0, total_disponivel: 0, total_vinculado: 0, total_lucro_realizado: 0, total_aposta_realizado: 0, by_type: { TF: 0, TF1: 0, TF2: 0, TF3: 0 } });
    }

    type LogRow = { id: string; banca_id: string; created_at: string; deadline_days?: number | null; transfer_type?: string | null };
    const expiredLogs = (logs as LogRow[]).filter((log) =>
      isTransferExpired(log.created_at, log.deadline_days ?? DEFAULT_DEADLINE_DAYS)
    );

    if (expiredLogs.length === 0) {
      return successResponse({ total_resolved_logs: 0, total_disponivel: 0, total_vinculado: 0, total_lucro_realizado: 0, total_aposta_realizado: 0, by_type: { TF: 0, TF1: 0, TF2: 0, TF3: 0 } });
    }

    const logIds = expiredLogs.map((l) => l.id);
    const { data: entries } = await supabaseServiceRole
      .from('admin_lead_transfer_entries')
      .select('transfer_log_id, banca_id, lead_id, target_consultant_email, resolution_status, total_depositado_snapshot, current_total_depositado_at_resolution, total_apostado_snapshot, current_total_apostado_at_resolution')
      .in('transfer_log_id', logIds)
      .in('banca_id', bancaIds)
      .limit(MAX_ROWS);

    const pendingByLogId = new Map<string, boolean>();
    const disponivelByLogId = new Map<string, number>();
    const vinculadoByLogId = new Map<string, number>();
    type EntryRow = { transfer_log_id: string; resolution_status?: string | null; total_depositado_snapshot?: number | null; current_total_depositado_at_resolution?: number | null; total_apostado_snapshot?: number | null; current_total_apostado_at_resolution?: number | null };
    (entries ?? []).forEach((e: EntryRow) => {
      const logId = e.transfer_log_id;
      if (e.resolution_status === 'pending') pendingByLogId.set(logId, true);
      if (e.resolution_status === 'disponivel_retransferencia') {
        disponivelByLogId.set(logId, (disponivelByLogId.get(logId) ?? 0) + 1);
      }
      if (e.resolution_status === 'vinculado') {
        vinculadoByLogId.set(logId, (vinculadoByLogId.get(logId) ?? 0) + 1);
      }
    });

    const resolvedLogIds = new Set(expiredLogs.filter((l) => !pendingByLogId.has(l.id)).map((l) => l.id));

    type EntryRowFull = { transfer_log_id: string; banca_id: string; lead_id?: string | number; target_consultant_email?: string | null; resolution_status?: string | null; total_depositado_snapshot?: number | null; current_total_depositado_at_resolution?: number | null; total_apostado_snapshot?: number | null; current_total_apostado_at_resolution?: number | null };
    const entriesFull = (entries ?? []) as EntryRowFull[];
    const needFallback = entriesFull.filter(
      (e) => resolvedLogIds.has(e.transfer_log_id) && e.resolution_status === 'vinculado'
        && ((e.total_depositado_snapshot != null && e.current_total_depositado_at_resolution == null)
          || (e.total_apostado_snapshot != null && e.current_total_apostado_at_resolution == null))
    );
    const crmDepositByKey = new Map<string, number>();
    const crmApostaByKey = new Map<string, number>();
    if (needFallback.length > 0 && bancaIds.length > 0) {
      const byTarget = new Map<string, { bancaId: string; leadIds: string[] }>();
      for (const e of needFallback) {
        const target = (e.target_consultant_email ?? '').trim();
        const leadId = e.lead_id != null ? String(e.lead_id) : '';
        if (!target || !leadId) continue;
        const key = `${e.banca_id}:${target}`;
        if (!byTarget.has(key)) byTarget.set(key, { bancaId: e.banca_id, leadIds: [] });
        if (!byTarget.get(key)!.leadIds.includes(leadId)) byTarget.get(key)!.leadIds.push(leadId);
      }
      for (const [key, { bancaId: bid }] of byTarget) {
        const parts = key.split(':');
        const target = parts.length > 1 ? parts.slice(1).join(':') : '';
        if (!target) continue;
        const resolved = await getAdminBancaId(userId, profile, bid);
        if (!resolved?.crmBaseUrl) continue;
        try {
          const client = createCrmRedistributionClient(resolved.crmBaseUrl);
          const result = await client.getIndicatedsByConsultant(target, 5000, 1, { transferredFilter: 'yes', sort: 'created_at', direction: 'desc' });
          const details = Array.isArray(result.data) ? result.data : [];
          for (const d of details) {
            const id = d?.id != null ? String(d.id) : '';
            if (!id) continue;
            const dep = d.total_depositado != null ? Number(d.total_depositado) : 0;
            const apost = d.total_apostado != null ? Number(d.total_apostado) : 0;
            crmDepositByKey.set(`${bid}:${target}:${id}`, dep);
            crmApostaByKey.set(`${bid}:${target}:${id}`, apost);
          }
        } catch {
          // CRM falhou; usa 0 como fallback
        }
      }
    }

    let total_lucro_realizado = 0;
    let total_aposta_realizado = 0;
    for (const e of entriesFull) {
      if (!resolvedLogIds.has(e.transfer_log_id)) continue;
      if (e.resolution_status !== 'vinculado') continue;
      const target = (e.target_consultant_email ?? '').trim();
      const leadId = e.lead_id != null ? String(e.lead_id) : '';
      const crmKey = target && leadId ? `${e.banca_id}:${target}:${leadId}` : '';
      // Só conta lucro quando há dados anteriores (snapshot) — sem antes não é possível calcular o ganho real
      // Alinha com o modal: usa total_depositado do CRM como fallback quando current_total_depositado_at_resolution é null
      if (e.total_depositado_snapshot != null) {
        const depAntes = Number(e.total_depositado_snapshot);
        const depDepois = e.current_total_depositado_at_resolution != null
          ? Number(e.current_total_depositado_at_resolution)
          : (crmKey ? (crmDepositByKey.get(crmKey) ?? 0) : 0);
        if (depAntes === 0) total_lucro_realizado += depDepois;
        else total_lucro_realizado += Math.max(0, depDepois - depAntes);
      }
      // Só conta aposta quando há dados anteriores (snapshot) — sem antes não é possível calcular o total real
      // Alinha com o modal: usa total_apostado do CRM como fallback quando current_total_apostado_at_resolution é null
      if (e.total_apostado_snapshot != null) {
        const apAntes = Number(e.total_apostado_snapshot);
        const apDepois = e.current_total_apostado_at_resolution != null
          ? Number(e.current_total_apostado_at_resolution)
          : (crmKey ? (crmApostaByKey.get(crmKey) ?? 0) : 0);
        if (apAntes === 0) total_aposta_realizado += apDepois;
        else total_aposta_realizado += Math.max(0, apDepois - apAntes);
      }
    }

    const byType: Record<string, number> = { TF: 0, TF1: 0, TF2: 0, TF3: 0 };
    let total_resolved_logs = 0;
    let total_disponivel = 0;
    let total_vinculado = 0;

    for (const log of expiredLogs) {
      if (pendingByLogId.has(log.id)) continue;
      const disp = disponivelByLogId.get(log.id) ?? 0;
      const vinc = vinculadoByLogId.get(log.id) ?? 0;
      total_vinculado += vinc;
      if (disp > 0) {
        total_resolved_logs += 1;
        total_disponivel += disp;
        const t = (log.transfer_type && ['TF', 'TF1', 'TF2', 'TF3'].includes(String(log.transfer_type))) ? String(log.transfer_type) : 'TF';
        byType[t] = (byType[t] ?? 0) + disp;
      }
    }

    return successResponse({ total_resolved_logs, total_disponivel, total_vinculado, total_lucro_realizado, total_aposta_realizado, by_type: byType });
  } catch (err: unknown) {
    console.error('[admin][transfer-logs][resolved-stats] GET error:', err);
    return serverErrorResponse(err as Error);
  }
}
