/**
 * POST /api/admin/crm/transfer-logs/recheck-disponivel
 *
 * Reprocessa entries marcadas como `disponivel_retransferencia` que ficaram com
 * essa classificação por causa de um bug de comparação de `status_code` (number
 * vs string). Para cada entry: consulta o histórico de depósitos no CRM e, se
 * houver depósito aprovado em data >= data da transferência (log.created_at),
 * promove a entry para `vinculado`, gravando os totais atuais para cálculo de
 * lucro.
 *
 * Body: { banca_id?: string, log_ids?: string[], max_entries?: number }
 *   - sem banca_id: usa todas as bancas permitidas (admin/super_admin).
 *   - com log_ids: limita aos logs informados (ainda exige permissão na banca).
 *   - max_entries: corta o processamento (default 200) — evita 504.
 *
 * Retorno: { promoted_to_vinculado, kept_disponivel, processed, remaining, results }
 *
 * Requer admin. maxDuration 300s.
 */
export const maxDuration = 300;

import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { getAdminBancaId, getAdminAllowedBancaIds } from '@/lib/server/crm/adminLeadTransferContext';
import { getEffectiveZaplotoId } from '@/lib/tenant-context';
import { createCrmRedistributionClient } from '@/lib/server/crm/crmRedistributionClient';
import { isLeadConvertedAfterTransfer } from '@/lib/server/crm/resolveTransferLog';

const LOG_PREFIX = '[admin][transfer-logs][recheck-disponivel]';
const DEFAULT_MAX_ENTRIES = 200;
const HARD_MAX_ENTRIES = 1500;

type EntryRow = {
  id: string;
  lead_id: string | number;
  banca_id: string;
  transfer_log_id: string;
  target_consultant_email: string | null;
};

type LogRow = {
  id: string;
  banca_id: string;
  created_at: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST(req: NextRequest) {
  try {
    const { userId, profile } = await requireAdmin(req);

    let body: { banca_id?: string; log_ids?: string[]; max_entries?: number } = {};
    try {
      body = req.headers.get('content-type')?.toLowerCase().includes('application/json')
        ? await req.json()
        : {};
    } catch {
      body = {};
    }

    const bancaIdParam = body.banca_id?.trim() || null;
    const logIdsParam = Array.isArray(body.log_ids)
      ? body.log_ids.map((id) => String(id).trim()).filter(Boolean)
      : [];
    const maxEntries =
      typeof body.max_entries === 'number' && Number.isFinite(body.max_entries) && body.max_entries >= 1
        ? Math.min(HARD_MAX_ENTRIES, Math.floor(body.max_entries))
        : DEFAULT_MAX_ENTRIES;

    let bancaIds: string[];
    const crmUrlByBancaId = new Map<string, string | null>();

    if (bancaIdParam) {
      const resolved = await getAdminBancaId(userId, profile, bancaIdParam, { skipLeadTransferLock: true });
      if (!resolved) return errorResponse('Banca não encontrada ou sem permissão.', 403);
      bancaIds = [resolved.bancaId];
      crmUrlByBancaId.set(resolved.bancaId, resolved.crmBaseUrl);
    } else {
      const zaplotoId = await getEffectiveZaplotoId(req, profile);
      const allowed = await getAdminAllowedBancaIds(profile, zaplotoId);
      if (!allowed?.length) {
        return successResponse({
          promoted_to_vinculado: 0,
          kept_disponivel: 0,
          processed: 0,
          remaining: 0,
          results: [],
          message: 'Sem bancas acessíveis.',
        });
      }
      bancaIds = allowed;
      for (const bid of bancaIds) {
        const resolved = await getAdminBancaId(userId, profile, bid, { skipLeadTransferLock: true });
        crmUrlByBancaId.set(bid, resolved?.crmBaseUrl ?? null);
      }
    }

    let entriesQuery = supabaseServiceRole
      .from('admin_lead_transfer_entries')
      .select('id, lead_id, banca_id, transfer_log_id, target_consultant_email')
      .eq('resolution_status', 'disponivel_retransferencia')
      .in('banca_id', bancaIds)
      .order('created_at', { ascending: true });

    if (logIdsParam.length > 0) {
      entriesQuery = entriesQuery.in('transfer_log_id', logIdsParam);
    }

    entriesQuery = entriesQuery.limit(maxEntries + 1);

    const { data: entriesRaw, error: entriesErr } = await entriesQuery;
    if (entriesErr) {
      console.error(`${LOG_PREFIX} fetch entries error:`, entriesErr);
      return errorResponse('Erro ao buscar entries disponíveis para repasse.', 500);
    }

    const all = (entriesRaw ?? []) as EntryRow[];
    const entries = all.slice(0, maxEntries);
    const hasMore = all.length > maxEntries;

    if (entries.length === 0) {
      return successResponse({
        promoted_to_vinculado: 0,
        kept_disponivel: 0,
        processed: 0,
        remaining: 0,
        results: [],
        message: 'Nenhuma entry pendente de reavaliação.',
      });
    }

    const logIds = [...new Set(entries.map((e) => e.transfer_log_id).filter(Boolean))];
    const { data: logsRaw } = await supabaseServiceRole
      .from('admin_lead_transfer_logs')
      .select('id, banca_id, created_at')
      .in('id', logIds);

    const logById = new Map<string, LogRow>();
    for (const l of (logsRaw ?? []) as LogRow[]) {
      logById.set(l.id, l);
    }

    /** Pré-carrega totais (depositado, apostado) por consultor para gravar ao vincular. */
    const totalsByLeadId = new Map<string, { total_depositado: number; total_apostado: number }>();
    const consultantsByBanca = new Map<string, Set<string>>();
    for (const e of entries) {
      const email = (e.target_consultant_email ?? '').trim().toLowerCase();
      if (!email || !e.banca_id) continue;
      const set = consultantsByBanca.get(e.banca_id) ?? new Set<string>();
      set.add(email);
      consultantsByBanca.set(e.banca_id, set);
    }

    for (const [bancaId, emails] of consultantsByBanca.entries()) {
      const crmBaseUrl = crmUrlByBancaId.get(bancaId);
      if (!crmBaseUrl) continue;
      const client = createCrmRedistributionClient(crmBaseUrl);
      for (const email of emails) {
        try {
          const result = await client.getIndicatedsByConsultant(email, 3000, 1, {
            transferredFilter: 'yes',
            sort: 'created_at',
            direction: 'desc',
          });
          const list = result.success && Array.isArray(result.data) ? result.data : [];
          for (const lead of list) {
            const id = lead?.id != null ? String(lead.id) : '';
            if (!id) continue;
            const td = lead.total_depositado != null ? Number(lead.total_depositado) : 0;
            const ta = lead.total_apostado != null ? Number(lead.total_apostado) : 0;
            totalsByLeadId.set(id, { total_depositado: td, total_apostado: ta });
          }
        } catch (err) {
          console.warn(`${LOG_PREFIX} totais por consultor ${email}:`, err instanceof Error ? err.message : err);
        }
      }
    }

    type ResultItem = {
      entry_id: string;
      lead_id: string;
      banca_id: string;
      transfer_log_id: string;
      action: 'promoted' | 'kept' | 'skipped';
      reason?: string;
    };

    const results: ResultItem[] = [];
    let promoted = 0;
    let kept = 0;

    for (const entry of entries) {
      const log = logById.get(entry.transfer_log_id);
      if (!log) {
        results.push({
          entry_id: entry.id,
          lead_id: String(entry.lead_id ?? ''),
          banca_id: entry.banca_id,
          transfer_log_id: entry.transfer_log_id,
          action: 'skipped',
          reason: 'log_not_found',
        });
        continue;
      }
      const crmBaseUrl = crmUrlByBancaId.get(entry.banca_id);
      if (!crmBaseUrl) {
        results.push({
          entry_id: entry.id,
          lead_id: String(entry.lead_id ?? ''),
          banca_id: entry.banca_id,
          transfer_log_id: entry.transfer_log_id,
          action: 'skipped',
          reason: 'crm_url_missing',
        });
        continue;
      }
      const transferDate = new Date(log.created_at);
      if (Number.isNaN(transferDate.getTime())) {
        results.push({
          entry_id: entry.id,
          lead_id: String(entry.lead_id ?? ''),
          banca_id: entry.banca_id,
          transfer_log_id: entry.transfer_log_id,
          action: 'skipped',
          reason: 'invalid_transfer_date',
        });
        continue;
      }
      const leadId = String(entry.lead_id ?? '').trim();
      if (!leadId) {
        results.push({
          entry_id: entry.id,
          lead_id: '',
          banca_id: entry.banca_id,
          transfer_log_id: entry.transfer_log_id,
          action: 'skipped',
          reason: 'empty_lead_id',
        });
        continue;
      }

      const client = createCrmRedistributionClient(crmBaseUrl);
      let isConverted = false;
      let crmCallOk = true;
      try {
        let result = await client.getUserDepositHistory(leadId, 100, 1);
        const rateLimited = !result.success && (
          (result.error ?? result.message ?? '').toLowerCase().includes('too many attempts') ||
          (result.error ?? result.message ?? '').toLowerCase().includes('429')
        );
        if (rateLimited) {
          await sleep(5000);
          result = await client.getUserDepositHistory(leadId, 100, 1);
        }
        const history = result.success && Array.isArray(result.history) ? result.history : [];
        if (!result.success) crmCallOk = false;
        if (isLeadConvertedAfterTransfer(history, transferDate)) {
          isConverted = true;
        }
      } catch (err) {
        crmCallOk = false;
        console.warn(`${LOG_PREFIX} getUserDepositHistory exception lead=${leadId}:`, err instanceof Error ? err.message : err);
      }

      if (!crmCallOk) {
        results.push({
          entry_id: entry.id,
          lead_id: leadId,
          banca_id: entry.banca_id,
          transfer_log_id: entry.transfer_log_id,
          action: 'skipped',
          reason: 'crm_error',
        });
        continue;
      }

      if (!isConverted) {
        kept++;
        results.push({
          entry_id: entry.id,
          lead_id: leadId,
          banca_id: entry.banca_id,
          transfer_log_id: entry.transfer_log_id,
          action: 'kept',
        });
        continue;
      }

      const totals = totalsByLeadId.get(leadId);
      const { error: updErr } = await supabaseServiceRole
        .from('admin_lead_transfer_entries')
        .update({
          resolution_status: 'vinculado',
          resolved_at: new Date().toISOString(),
          current_total_depositado_at_resolution: totals?.total_depositado ?? null,
          current_total_apostado_at_resolution: totals?.total_apostado ?? null,
        })
        .eq('id', entry.id)
        .eq('resolution_status', 'disponivel_retransferencia');

      if (updErr) {
        console.warn(`${LOG_PREFIX} update vinculado falhou entry=${entry.id}:`, updErr.message);
        results.push({
          entry_id: entry.id,
          lead_id: leadId,
          banca_id: entry.banca_id,
          transfer_log_id: entry.transfer_log_id,
          action: 'skipped',
          reason: 'db_update_error',
        });
        continue;
      }

      promoted++;
      results.push({
        entry_id: entry.id,
        lead_id: leadId,
        banca_id: entry.banca_id,
        transfer_log_id: entry.transfer_log_id,
        action: 'promoted',
      });
    }

    return successResponse(
      {
        promoted_to_vinculado: promoted,
        kept_disponivel: kept,
        processed: entries.length,
        remaining: hasMore ? -1 : 0,
        results,
      },
      `${promoted} entry(ies) promovida(s) para vinculado; ${kept} mantida(s) como disponível.${hasMore ? ' Há mais entries — rode novamente.' : ''}`
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Acesso negado') || msg.includes('não tem permissão')) {
      return errorResponse(msg, 403);
    }
    console.error(`${LOG_PREFIX} error:`, err);
    return serverErrorResponse(err as Error);
  }
}
