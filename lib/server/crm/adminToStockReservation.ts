/**
 * Reserva lógica de leads no estoque de um gerente (sem movimentação no CRM).
 * Grava em admin_lead_transfer_logs/entries com transfer_kind='admin_to_gerente_stock'.
 * Os leads permanecem com o consultor de origem no CRM até o gerente distribuir.
 */

import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { isConsultantInBanca } from '@/lib/server/crm/adminLeadTransferContext';
import type { LeadSnapshotInput } from '@/lib/server/crm/leadRedistributionCore';

const LOG_PREFIX = '[lead-transfer][admin-to-stock-reservation]';

export type ReserveAdminToStockParams = {
  userId: string;
  bancaId: string;
  gerenteUserId: string;
  gerenteDisplayEmail: string;
  sourceConsultantEmail: string;
  leadsIds: Array<number | string>;
  transferType: 'TF' | 'TF1' | 'TF2' | 'TF3';
  transferDeadlineDays: number;
  filtersSnapshot?: Record<string, unknown> | null;
  leadSnapshots?: LeadSnapshotInput[];
};

export type ReserveAdminToStockResult =
  | { ok: true; count: number; transfer_log_id: string; message: string }
  | { ok: false; status: number; error: string };

/** Normaliza um id (number quando possível, senão string). */
function normalizeLeadId(id: number | string): number | string {
  if (typeof id === 'number' && Number.isFinite(id)) return id;
  const s = String(id).trim();
  const n = Number(s);
  return s !== '' && Number.isFinite(n) ? n : s;
}

export async function reserveAdminToGerenteStock(
  params: ReserveAdminToStockParams
): Promise<ReserveAdminToStockResult> {
  const {
    userId,
    bancaId,
    gerenteUserId,
    gerenteDisplayEmail,
    sourceConsultantEmail,
    transferType,
    transferDeadlineDays,
    filtersSnapshot,
    leadSnapshots,
  } = params;

  const source = sourceConsultantEmail.trim();
  if (!source) {
    return { ok: false, status: 400, error: 'Consultor de origem é obrigatório.' };
  }

  const normalizedLeadIds = (params.leadsIds || []).map(normalizeLeadId);
  if (normalizedLeadIds.length === 0) {
    return { ok: false, status: 400, error: 'Nenhum lead informado para reserva.' };
  }

  const sourceInBanca = await isConsultantInBanca(bancaId, source);
  if (!sourceInBanca) {
    return { ok: false, status: 400, error: 'Consultor origem não pertence à banca selecionada.' };
  }

  console.log(
    `${LOG_PREFIX} reservando ${normalizedLeadIds.length} lead(s) no estoque gerente=${gerenteUserId} banca=${bancaId} origem=${source} (sem chamada ao CRM)`
  );

  const targetDisplay = gerenteDisplayEmail.trim().toLowerCase() || `stock:${gerenteUserId}`;
  const fsBase = typeof filtersSnapshot === 'object' && filtersSnapshot !== null ? { ...filtersSnapshot } : {};
  const fs: Record<string, unknown> = {
    ...fsBase,
    to_gerente_stock: true,
    gerente_stock_gerente_id: gerenteUserId,
    stock_reservation: true,
  };

  const insertPayload = {
    banca_id: bancaId,
    performed_by_user_id: userId,
    source_consultant_email: source,
    target_consultant_email: targetDisplay,
    leads_ids: normalizedLeadIds,
    count: normalizedLeadIds.length,
    transfer_type: transferType,
    deadline_days: transferDeadlineDays,
    filters_snapshot: fs,
    crm_response: { stock_reservation: true, crm_skipped: true } as Record<string, unknown>,
    transfer_kind: 'admin_to_gerente_stock',
  };

  const { data: insertedLog, error: logError } = await supabaseServiceRole
    .from('admin_lead_transfer_logs')
    .insert(insertPayload as never)
    .select('id')
    .single();

  if (logError || !insertedLog?.id) {
    console.error(`${LOG_PREFIX} erro ao inserir log:`, logError);
    return { ok: false, status: 500, error: 'Não foi possível gravar a reserva no estoque.' };
  }

  const snapshotByLeadId = new Map<string, LeadSnapshotInput>();
  if (Array.isArray(leadSnapshots)) {
    for (const s of leadSnapshots) snapshotByLeadId.set(String(s.lead_id), s);
  }

  const entries = normalizedLeadIds.map((leadId) => {
    const sid = String(leadId);
    const snap = snapshotByLeadId.get(sid);
    const balance = snap?.balance != null ? Number(snap.balance) : null;
    const hadBalance = (balance ?? 0) > 0;
    const totalSaqueRaw = snap?.total_saque;
    const totalSaque =
      totalSaqueRaw == null || totalSaqueRaw === ''
        ? null
        : Number.isFinite(Number(totalSaqueRaw))
          ? Number(totalSaqueRaw)
          : null;
    return {
      transfer_log_id: insertedLog.id,
      banca_id: bancaId,
      lead_id: sid,
      source_consultant_email: source,
      target_consultant_email: targetDisplay,
      transfer_type: transferType,
      lead_name: snap?.name ?? null,
      lead_phone: snap?.phone ?? null,
      saldo_snapshot: balance,
      last_interaction_snapshot: snap?.last_interaction ?? null,
      had_balance: hadBalance,
      total_depositado_snapshot: snap?.total_depositado != null ? Number(snap.total_depositado) : null,
      total_apostado_snapshot: snap?.total_apostado != null ? Number(snap.total_apostado) : null,
      total_ganho_snapshot: snap?.total_ganho != null ? Number(snap.total_ganho) : null,
      available_withdraw_snapshot: snap?.available_withdraw != null ? Number(snap.available_withdraw) : null,
      total_saque_snapshot: totalSaque,
      original_source_consultant_email: source,
      stock_status: 'em_estoque',
      stock_gerente_user_id: gerenteUserId,
    };
  });

  let { error: entriesError } = await supabaseServiceRole.from('admin_lead_transfer_entries').insert(entries);
  if (
    entriesError?.code === 'PGRST204' &&
    (entriesError.message?.includes('stock_status') ||
      entriesError.message?.includes('stock_gerente_user_id') ||
      entriesError.message?.includes('original_source_consultant_email'))
  ) {
    console.error(
      `${LOG_PREFIX} colunas de reserva ausentes. Execute migrations/add_stock_reservation_fields.sql.`
    );
    return {
      ok: false,
      status: 500,
      error:
        'Estrutura do banco desatualizada para reservas de estoque. Peça ao administrador para aplicar a migration add_stock_reservation_fields.sql.',
    };
  }
  if (entriesError?.code === 'PGRST204' && entriesError.message?.includes('lead_name')) {
    const entriesWithoutNamePhone = entries.map(({ lead_name: _n, lead_phone: _p, ...rest }) => rest);
    const retry = await supabaseServiceRole.from('admin_lead_transfer_entries').insert(entriesWithoutNamePhone);
    entriesError = retry.error;
  }
  if (entriesError) {
    console.error(`${LOG_PREFIX} erro ao inserir entries:`, entriesError);
    return {
      ok: false,
      status: 500,
      error: 'Reserva gravada parcialmente: log criado mas não foi possível salvar os leads da reserva.',
    };
  }

  return {
    ok: true,
    count: normalizedLeadIds.length,
    transfer_log_id: insertedLog.id,
    message: `${normalizedLeadIds.length} lead(s) reservado(s) no estoque do gerente.`,
  };
}
