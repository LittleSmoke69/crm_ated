/**
 * Reserva lógica de leads no estoque de um gerente (sem movimentação no CRM).
 * Grava em admin_lead_transfer_logs/entries com transfer_kind='admin_to_gerente_stock'.
 * Os leads permanecem com o consultor de origem no CRM até o gerente distribuir.
 */

import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { isConsultantInBanca } from '@/lib/server/crm/adminLeadTransferContext';
import { normalizeLeadEmailForDb, type LeadSnapshotInput } from '@/lib/server/crm/leadRedistributionCore';

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
  /** Log de origem (expirado/resolvido): usado para copiar lead_name/lead_email das entries quando o payload não traz nome. */
  sourceTransferLogId?: string | null;
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
    sourceTransferLogId,
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

  const sourceLogId = (sourceTransferLogId ?? '').trim();
  if (sourceLogId && bancaId) {
    const needEnrich = normalizedLeadIds.filter((lid) => {
      const sid = String(lid);
      const cur = snapshotByLeadId.get(sid);
      const nameEmpty = !cur?.name || String(cur.name).trim() === '';
      const emailEmpty = !cur?.email || String(cur.email).trim() === '';
      return nameEmpty || emailEmpty;
    });
    const selectFull =
      'lead_id, lead_name, lead_email, lead_phone, saldo_snapshot, last_interaction_snapshot, total_depositado_snapshot, total_apostado_snapshot, total_ganho_snapshot, available_withdraw_snapshot, total_saque_snapshot';
    const chunkSize = 120;
    for (let i = 0; i < needEnrich.length; i += chunkSize) {
      const chunk = needEnrich.slice(i, i + chunkSize).map(String);
      let chunkRows: Record<string, unknown>[] | null = null;
      let chunkErr = await supabaseServiceRole
        .from('admin_lead_transfer_entries')
        .select(selectFull)
        .eq('transfer_log_id', sourceLogId)
        .eq('banca_id', bancaId)
        .in('lead_id', chunk);
      let error = chunkErr.error;
      chunkRows = Array.isArray(chunkErr.data) ? (chunkErr.data as Record<string, unknown>[]) : [];
      if (error?.code === 'PGRST204' || (error?.message ?? '').includes('lead_name')) {
        const r2 = await supabaseServiceRole
          .from('admin_lead_transfer_entries')
          .select(
            'lead_id, saldo_snapshot, last_interaction_snapshot, total_depositado_snapshot, total_apostado_snapshot, total_ganho_snapshot, available_withdraw_snapshot, total_saque_snapshot'
          )
          .eq('transfer_log_id', sourceLogId)
          .eq('banca_id', bancaId)
          .in('lead_id', chunk);
        error = r2.error;
        chunkRows = Array.isArray(r2.data) ? (r2.data as Record<string, unknown>[]) : [];
      }
      if (error) {
        console.warn(`${LOG_PREFIX} enrich snapshots (log=${sourceLogId}):`, error.message ?? error);
        continue;
      }
      for (const row of chunkRows ?? []) {
        const lid = row.lead_id != null ? String(row.lead_id) : '';
        if (!lid) continue;
        const prev = snapshotByLeadId.get(lid) ?? { lead_id: row.lead_id as number | string };
        const ln = typeof row.lead_name === 'string' ? row.lead_name.trim() : '';
        const em = typeof row.lead_email === 'string' ? row.lead_email.trim() : '';
        const ph = typeof row.lead_phone === 'string' ? row.lead_phone.trim() : '';
        const prevNameOk = prev.name != null && String(prev.name).trim() !== '';
        const prevEmailOk = prev.email != null && String(prev.email).trim() !== '';
        snapshotByLeadId.set(lid, {
          ...prev,
          lead_id: prev.lead_id,
          name: prevNameOk ? prev.name : ln || null,
          email: prevEmailOk ? prev.email : em || null,
          phone: prev.phone != null && String(prev.phone).trim() !== '' ? prev.phone : ph || null,
          balance:
            prev.balance != null
              ? prev.balance
              : row.saldo_snapshot != null
                ? Number(row.saldo_snapshot)
                : prev.balance,
          last_interaction:
            prev.last_interaction ??
            (typeof row.last_interaction_snapshot === 'string' ? row.last_interaction_snapshot : null),
          total_depositado:
            prev.total_depositado ??
            (row.total_depositado_snapshot != null ? Number(row.total_depositado_snapshot) : null),
          total_apostado:
            prev.total_apostado ??
            (row.total_apostado_snapshot != null ? Number(row.total_apostado_snapshot) : null),
          total_ganho: prev.total_ganho ?? (row.total_ganho_snapshot != null ? Number(row.total_ganho_snapshot) : null),
          available_withdraw:
            prev.available_withdraw ??
            (row.available_withdraw_snapshot != null ? Number(row.available_withdraw_snapshot) : null),
          total_saque:
            prev.total_saque != null && prev.total_saque !== ''
              ? prev.total_saque
              : row.total_saque_snapshot != null && row.total_saque_snapshot !== ''
                ? Number(row.total_saque_snapshot as number | string)
                : null,
        });
      }
    }
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
      lead_email: normalizeLeadEmailForDb(snap?.email),
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
  if (entriesError?.code === 'PGRST204' && entriesError.message?.includes('lead_email')) {
    const entriesNoEmail = entries.map(({ lead_email: _e, ...rest }) => rest);
    const retryE = await supabaseServiceRole.from('admin_lead_transfer_entries').insert(entriesNoEmail);
    entriesError = retryE.error;
  }
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
