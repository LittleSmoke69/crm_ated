/**
 * Lógica compartilhada para resolver uma transferência expirada (vincular ou disponível para repasse).
 * Usado por POST /api/admin/crm/transfer-logs/resolve e resolve-batch.
 */

import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { createCrmRedistributionClient } from '@/lib/server/crm/crmRedistributionClient';

const DEFAULT_DEADLINE_DAYS = 10;

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

export type ResolveResult = {
  resolved: number;
  vinculado: number;
  disponivel_retransferencia: number;
  message: string;
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
    return { resolved: 0, vinculado: 0, disponivel_retransferencia: 0, message: 'Transferência não encontrada.' };
  }

  const deadlineDays = (log as { deadline_days?: number | null }).deadline_days;
  if (!isTransferExpired(log.created_at, deadlineDays)) {
    return { resolved: 0, vinculado: 0, disponivel_retransferencia: 0, message: 'Transferência ainda no prazo.' };
  }

  const { data: entries, error: entriesError } = await supabaseServiceRole
    .from('admin_lead_transfer_entries')
    .select('id, lead_id, target_consultant_email, total_depositado_snapshot, total_apostado_snapshot')
    .eq('transfer_log_id', logId)
    .eq('banca_id', bancaId);

  if (entriesError || !entries?.length) {
    return { resolved: 0, vinculado: 0, disponivel_retransferencia: 0, message: 'Nenhum lead nesta transferência.' };
  }

  const targetEmail = (entries[0] as { target_consultant_email?: string }).target_consultant_email?.trim();
  if (!targetEmail || !crmBaseUrl) {
    return { resolved: 0, vinculado: 0, disponivel_retransferencia: 0, message: 'Dados incompletos para consultar CRM.' };
  }

  const client = createCrmRedistributionClient(crmBaseUrl);
  let currentByLeadId = new Map<string, { total_depositado?: number; total_apostado?: number }>();
  try {
    const result = await client.getIndicatedsByConsultant(targetEmail, 5000, 1, {
      transferredFilter: 'yes',
      sort: 'created_at',
      direction: 'desc',
    });
    const details = Array.isArray(result.data) ? result.data : [];
    for (const d of details) {
      const id = d?.id != null ? String(d.id) : '';
      if (!id) continue;
      currentByLeadId.set(id, {
        total_depositado: d.total_depositado != null ? Number(d.total_depositado) : undefined,
        total_apostado: d.total_apostado != null ? Number(d.total_apostado) : undefined,
      });
    }
  } catch {
    // CRM falhou: considera todos como disponível para repasse
  }

  let vinculado = 0;
  let disponivel = 0;

  for (const entry of entries as Array<{
    id: string;
    lead_id: string | number;
    total_depositado_snapshot?: number | null;
    total_apostado_snapshot?: number | null;
  }>) {
    const leadId = String(entry.lead_id ?? '');
    const current = currentByLeadId.get(leadId);
    const snapDep = entry.total_depositado_snapshot != null ? Number(entry.total_depositado_snapshot) : 0;
    const snapApost = entry.total_apostado_snapshot != null ? Number(entry.total_apostado_snapshot) : 0;
    const curDep = current?.total_depositado ?? 0;
    const curApost = current?.total_apostado ?? 0;

    const teveAtividade = curDep > snapDep || curApost > snapApost;
    const resolution_status = teveAtividade ? 'vinculado' : 'disponivel_retransferencia';
    if (teveAtividade) vinculado++;
    else disponivel++;

    await supabaseServiceRole
      .from('admin_lead_transfer_entries')
      .update({
        resolution_status,
        resolved_at: new Date().toISOString(),
        current_total_depositado_at_resolution: curDep > 0 ? curDep : null,
        current_total_apostado_at_resolution: curApost > 0 ? curApost : null,
      })
      .eq('id', entry.id);
  }

  return {
    resolved: entries.length,
    vinculado,
    disponivel_retransferencia: disponivel,
    message: `${vinculado} vinculado(s), ${disponivel} disponível(is) para repasse.`,
  };
}
