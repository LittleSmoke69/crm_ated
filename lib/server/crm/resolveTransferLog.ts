/**
 * Lógica compartilhada para resolver uma transferência expirada (vincular ou disponível para repasse).
 * Usado por POST /api/admin/crm/transfer-logs/resolve e resolve-batch.
 *
 * Critério de vinculado: data do último depósito aprovado (API get-user-deposit-history) >= data da transferência.
 * Caso contrário ou se não houver depósito aprovado → disponivel_retransferencia.
 */

import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { createCrmRedistributionClient } from '@/lib/server/crm/crmRedistributionClient';
import type { DepositHistoryItem } from '@/lib/server/crm/crmRedistributionClient';

const DEFAULT_DEADLINE_DAYS = 10;
const STATUS_APROVADO = 1;
const LOG_PREFIX = '[resolve-expired-transfers]';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitError(result: { success: boolean; error?: string; message?: string }): boolean {
  const msg = (result.error ?? result.message ?? '').toLowerCase();
  return !result.success && (msg.includes('too many attempts') || msg.includes('429'));
}

export type ResolveContext = {
  bancaId: string;
  crmBaseUrl: string | null;
};

export function isTransferExpired(createdAt: string | null | undefined, deadlineDays?: number | null): boolean {
  if (!createdAt) return true;
  const days = deadlineDays != null && deadlineDays >= 1 ? deadlineDays : DEFAULT_DEADLINE_DAYS;
  const transferredAt = new Date(createdAt);
  const now = new Date();
  const diffMs = now.getTime() - transferredAt.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return diffDays >= days;
}

/**
 * Retorna a data do último depósito aprovado (status_code === 1) no histórico, ou null se não houver.
 * A API pode retornar itens em qualquer ordem; considera o maior date entre os aprovados.
 */
function getLastApprovedDepositDate(history: DepositHistoryItem[]): Date | null {
  const approved = history.filter((item) => item.status_code === STATUS_APROVADO);
  if (approved.length === 0) return null;
  let latest: Date | null = null;
  for (const item of approved) {
    const d = item.date ? new Date(item.date) : null;
    if (d && !Number.isNaN(d.getTime()) && (latest === null || d.getTime() > latest.getTime())) {
      latest = d;
    }
  }
  return latest;
}

async function updateEntryResolution(entryId: string, resolutionStatus: 'vinculado' | 'disponivel_retransferencia'): Promise<void> {
  await supabaseServiceRole
    .from('admin_lead_transfer_entries')
    .update({
      resolution_status: resolutionStatus,
      resolved_at: new Date().toISOString(),
      current_total_depositado_at_resolution: null,
      current_total_apostado_at_resolution: null,
    })
    .eq('id', entryId);
}

export type ConvertedLead = {
  lead_id: string;
  consultant_email: string;
  banca_id: string;
};

export type ResolveResult = {
  resolved: number;
  vinculado: number;
  disponivel_retransferencia: number;
  message: string;
  /** Lista de leads convertidos (vinculados) com consultor e banca para relatório */
  converted: ConvertedLead[];
};

export async function resolveOneTransferLog(
  ctx: ResolveContext,
  logId: string
): Promise<ResolveResult> {
  const { bancaId, crmBaseUrl } = ctx;

  const { data: log, error: logError } = await supabaseServiceRole
    .from('admin_lead_transfer_logs')
    .select('id, created_at, deadline_days')
    .eq('id', logId)
    .eq('banca_id', bancaId)
    .single();

  if (logError || !log) {
    return { resolved: 0, vinculado: 0, disponivel_retransferencia: 0, message: 'Transferência não encontrada.', converted: [] };
  }

  const deadlineDays = (log as { deadline_days?: number | null }).deadline_days;
  if (!isTransferExpired(log.created_at, deadlineDays)) {
    return { resolved: 0, vinculado: 0, disponivel_retransferencia: 0, message: 'Transferência ainda no prazo.', converted: [] };
  }

  const { data: entries, error: entriesError } = await supabaseServiceRole
    .from('admin_lead_transfer_entries')
    .select('id, lead_id, target_consultant_email')
    .eq('transfer_log_id', logId)
    .eq('banca_id', bancaId);

  if (entriesError || !entries?.length) {
    return { resolved: 0, vinculado: 0, disponivel_retransferencia: 0, message: 'Nenhum lead nesta transferência.', converted: [] };
  }

  if (!crmBaseUrl) {
    return { resolved: 0, vinculado: 0, disponivel_retransferencia: 0, message: 'URL do CRM não configurada.', converted: [] };
  }

  const transferDate = new Date(log.created_at);
  if (Number.isNaN(transferDate.getTime())) {
    return { resolved: 0, vinculado: 0, disponivel_retransferencia: 0, message: 'Data de transferência inválida.', converted: [] };
  }

  const client = createCrmRedistributionClient(crmBaseUrl);
  let vinculado = 0;
  let disponivel = 0;
  const converted: ConvertedLead[] = [];

  for (const entry of entries as Array<{ id: string; lead_id: string | number; target_consultant_email?: string | null }>) {
    const leadId = String(entry.lead_id ?? '');
    if (!leadId) {
      disponivel++;
      await updateEntryResolution(entry.id, 'disponivel_retransferencia');
      continue;
    }

    let isConverted = false;
    try {
      let result = await client.getUserDepositHistory(leadId, 100, 1);
      if (isRateLimitError(result)) {
        console.log(`${LOG_PREFIX} 429 Too Many Attempts para lead ${leadId}; aguardando 5s e reenviando...`);
        await sleep(5000);
        result = await client.getUserDepositHistory(leadId, 100, 1);
      }
      const history = result.success && Array.isArray(result.history) ? result.history : [];
      const lastApprovedDate = getLastApprovedDepositDate(history);
      if (lastApprovedDate !== null && lastApprovedDate.getTime() >= transferDate.getTime()) {
        isConverted = true;
      }
    } catch {
      // API falhou: considera como disponível para repasse
    }

    if (isConverted) {
      console.log(`${LOG_PREFIX} Lead ${leadId} convertido (cliente depositante - vinculado).`);
      converted.push({
        lead_id: leadId,
        consultant_email: (entry.target_consultant_email ?? '').trim() || '(sem email)',
        banca_id: bancaId,
      });
    } else {
      console.log(`${LOG_PREFIX} Lead ${leadId} não convertido (disponível para repasse).`);
    }

    const resolution_status = isConverted ? 'vinculado' : 'disponivel_retransferencia';
    if (isConverted) vinculado++;
    else disponivel++;

    await updateEntryResolution(entry.id, resolution_status);
  }

  return {
    resolved: entries.length,
    vinculado,
    disponivel_retransferencia: disponivel,
    message: `${vinculado} vinculado(s), ${disponivel} disponível(is) para repasse.`,
    converted,
  };
}
