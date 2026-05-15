/**
 * Estoque lógico do gerente: inventário baseado em admin_lead_transfer_entries
 * (stock_status='em_estoque'). Não depende mais do CRM externo — as informações
 * do lead vêm dos snapshots gravados no momento da reserva admin→estoque.
 */

import { supabaseServiceRole } from '@/lib/services/supabase-service';

export type StockPackage = {
  transfer_log_id: string;
  banca_id: string;
  created_at: string;
  transfer_type: 'TF' | 'TF1' | 'TF2' | 'TF3' | string;
  deadline_days: number;
  performed_by_user_id: string | null;
  performed_by_name: string | null;
  total_leads: number;
  pending_leads: number;
  distributed_leads: number;
  canceled_leads: number;
  /** Reserva encerrada como reversão ao consultor doador (sem usar repasse CRM em leads ainda em_estoque). */
  reverted_leads: number;
};

/** Pacote + dono do estoque (admin vendo vários gerentes na mesma banca). */
export type StockPackageWithGerente = StockPackage & {
  stock_gerente_user_id: string;
  gerente_name: string | null;
};

export type StockLeadRow = {
  lead_id: string;
  transfer_log_id: string;
  banca_id: string;
  original_source_consultant_email: string | null;
  stock_status: 'em_estoque' | 'repassado' | 'cancelado' | 'revertido';
  stock_resolved_at: string | null;
  received_at: string;
  deadline_days: number;
  transfer_type: string;
  lead_name: string | null;
  lead_phone: string | null;
  saldo_snapshot: number | null;
  last_interaction_snapshot: string | null;
  total_depositado_snapshot: number | null;
  total_apostado_snapshot: number | null;
  total_ganho_snapshot: number | null;
  available_withdraw_snapshot: number | null;
  total_saque_snapshot: number | null;
};

type RawEntry = {
  lead_id: string | null;
  transfer_log_id: string;
  banca_id: string;
  original_source_consultant_email: string | null;
  stock_status: string | null;
  stock_resolved_at: string | null;
  transfer_type: string | null;
  lead_name: string | null;
  lead_phone: string | null;
  saldo_snapshot: number | null;
  last_interaction_snapshot: string | null;
  total_depositado_snapshot: number | null;
  total_apostado_snapshot: number | null;
  total_ganho_snapshot: number | null;
  available_withdraw_snapshot: number | null;
  total_saque_snapshot: number | null;
};

type RawLog = {
  id: string;
  created_at: string | null;
  transfer_type: string | null;
  deadline_days: number | null;
  performed_by_user_id: string | null;
};

/**
 * Lista os pacotes (um por admin_lead_transfer_logs) com contagem por estado.
 * Considera apenas logs de transfer_kind='admin_to_gerente_stock' cujas entries
 * tenham stock_gerente_user_id = gerenteUserId e banca_id = bancaId.
 */
export async function listStockPackagesForGerente(
  gerenteUserId: string,
  bancaId: string
): Promise<StockPackage[]> {
  const { data: entries, error: entriesErr } = await supabaseServiceRole
    .from('admin_lead_transfer_entries')
    .select('transfer_log_id, stock_status')
    .eq('banca_id', bancaId)
    .eq('stock_gerente_user_id', gerenteUserId);

  if (entriesErr || !Array.isArray(entries) || entries.length === 0) {
    if (entriesErr) console.warn('[gerenteStockReservation] listPackages entries:', entriesErr.message);
    return [];
  }

  const byLog = new Map<string, { pending: number; distributed: number; canceled: number; reverted: number; total: number }>();
  for (const e of entries) {
    const lid = String(e.transfer_log_id ?? '');
    if (!lid) continue;
    const bucket = byLog.get(lid) ?? { pending: 0, distributed: 0, canceled: 0, reverted: 0, total: 0 };
    bucket.total++;
    switch (e.stock_status) {
      case 'em_estoque':
        bucket.pending++;
        break;
      case 'repassado':
        bucket.distributed++;
        break;
      case 'cancelado':
        bucket.canceled++;
        break;
      case 'revertido':
        bucket.reverted++;
        break;
    }
    byLog.set(lid, bucket);
  }

  const logIds = Array.from(byLog.keys());
  if (logIds.length === 0) return [];

  const { data: logs, error: logsErr } = await supabaseServiceRole
    .from('admin_lead_transfer_logs')
    .select('id, created_at, transfer_type, deadline_days, performed_by_user_id')
    .in('id', logIds)
    .eq('banca_id', bancaId)
    .eq('transfer_kind', 'admin_to_gerente_stock');

  if (logsErr || !Array.isArray(logs)) {
    console.warn('[gerenteStockReservation] listPackages logs:', logsErr?.message);
    return [];
  }

  const performerIds = Array.from(
    new Set((logs as RawLog[]).map((l) => (l.performed_by_user_id ?? '').trim()).filter(Boolean))
  );
  const performerNameById = new Map<string, string>();
  if (performerIds.length > 0) {
    const { data: profiles } = await supabaseServiceRole
      .from('profiles')
      .select('id, full_name, email')
      .in('id', performerIds);
    for (const p of (profiles ?? []) as { id: string; full_name: string | null; email: string | null }[]) {
      const name = (p.full_name && p.full_name.trim()) || (p.email && p.email.trim()) || '';
      performerNameById.set(p.id, name);
    }
  }

  return (logs as RawLog[])
    .map<StockPackage>((log) => {
      const bucket = byLog.get(log.id) ?? { pending: 0, distributed: 0, canceled: 0, reverted: 0, total: 0 };
      return {
        transfer_log_id: log.id,
        banca_id: bancaId,
        created_at: log.created_at ?? new Date(0).toISOString(),
        transfer_type: (log.transfer_type ?? 'TF') as StockPackage['transfer_type'],
        deadline_days: Number(log.deadline_days ?? 10) || 10,
        performed_by_user_id: log.performed_by_user_id ?? null,
        performed_by_name: log.performed_by_user_id ? performerNameById.get(log.performed_by_user_id) ?? null : null,
        total_leads: bucket.total,
        pending_leads: bucket.pending,
        distributed_leads: bucket.distributed,
        canceled_leads: bucket.canceled,
        reverted_leads: bucket.reverted,
      };
    })
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
}

/**
 * Lista pacotes de estoque na banca para todos os gerentes que tenham reservas (admin/super_admin).
 */
export async function listStockPackagesAllGerentesForBanca(bancaId: string): Promise<StockPackageWithGerente[]> {
  const { data: entries, error: entriesErr } = await supabaseServiceRole
    .from('admin_lead_transfer_entries')
    .select('transfer_log_id, stock_status, stock_gerente_user_id')
    .eq('banca_id', bancaId)
    .not('stock_gerente_user_id', 'is', null);

  if (entriesErr || !Array.isArray(entries) || entries.length === 0) {
    if (entriesErr) console.warn('[gerenteStockReservation] listPackagesAllGerentes entries:', entriesErr.message);
    return [];
  }

  type Bucket = { pending: number; distributed: number; canceled: number; reverted: number; total: number; gerenteId: string };
  const byLog = new Map<string, Bucket>();
  for (const e of entries) {
    const lid = String(e.transfer_log_id ?? '');
    const gid = String((e as { stock_gerente_user_id?: string }).stock_gerente_user_id ?? '').trim();
    if (!lid || !gid) continue;
    let bucket = byLog.get(lid);
    if (!bucket) {
      bucket = { pending: 0, distributed: 0, canceled: 0, reverted: 0, total: 0, gerenteId: gid };
    }
    if (bucket.gerenteId !== gid) {
      console.warn('[gerenteStockReservation] transfer_log_id com gerentes distintos; usando primeiro:', lid);
    }
    bucket.total++;
    switch ((e as { stock_status?: string }).stock_status) {
      case 'em_estoque':
        bucket.pending++;
        break;
      case 'repassado':
        bucket.distributed++;
        break;
      case 'cancelado':
        bucket.canceled++;
        break;
      case 'revertido':
        bucket.reverted++;
        break;
      default:
        break;
    }
    byLog.set(lid, bucket);
  }

  const logIds = Array.from(byLog.keys());
  if (logIds.length === 0) return [];

  const { data: logs, error: logsErr } = await supabaseServiceRole
    .from('admin_lead_transfer_logs')
    .select('id, created_at, transfer_type, deadline_days, performed_by_user_id')
    .in('id', logIds)
    .eq('banca_id', bancaId)
    .eq('transfer_kind', 'admin_to_gerente_stock');

  if (logsErr || !Array.isArray(logs)) {
    console.warn('[gerenteStockReservation] listPackagesAllGerentes logs:', logsErr?.message);
    return [];
  }

  const performerIds = Array.from(
    new Set((logs as RawLog[]).map((l) => (l.performed_by_user_id ?? '').trim()).filter(Boolean))
  );
  const performerNameById = new Map<string, string>();
  if (performerIds.length > 0) {
    const { data: profiles } = await supabaseServiceRole
      .from('profiles')
      .select('id, full_name, email')
      .in('id', performerIds);
    for (const p of (profiles ?? []) as { id: string; full_name: string | null; email: string | null }[]) {
      const name = (p.full_name && p.full_name.trim()) || (p.email && p.email.trim()) || '';
      performerNameById.set(p.id, name);
    }
  }

  const gerenteIds = Array.from(new Set([...byLog.values()].map((b) => b.gerenteId).filter(Boolean)));
  const gerenteNameById = new Map<string, string>();
  if (gerenteIds.length > 0) {
    const { data: gprofs } = await supabaseServiceRole
      .from('profiles')
      .select('id, full_name, email')
      .in('id', gerenteIds);
    for (const p of (gprofs ?? []) as { id: string; full_name: string | null; email: string | null }[]) {
      const name = (p.full_name && p.full_name.trim()) || (p.email && p.email.trim()) || '';
      gerenteNameById.set(p.id, name || p.email || '');
    }
  }

  return (logs as RawLog[])
    .map<StockPackageWithGerente>((log) => {
      const bucket = byLog.get(log.id);
      const gId = bucket?.gerenteId ?? '';
      const baseBucket = bucket ?? { pending: 0, distributed: 0, canceled: 0, reverted: 0, total: 0, gerenteId: gId };
      return {
        transfer_log_id: log.id,
        banca_id: bancaId,
        created_at: log.created_at ?? new Date(0).toISOString(),
        transfer_type: (log.transfer_type ?? 'TF') as StockPackageWithGerente['transfer_type'],
        deadline_days: Number(log.deadline_days ?? 10) || 10,
        performed_by_user_id: log.performed_by_user_id ?? null,
        performed_by_name: log.performed_by_user_id ? performerNameById.get(log.performed_by_user_id) ?? null : null,
        total_leads: baseBucket.total,
        pending_leads: baseBucket.pending,
        distributed_leads: baseBucket.distributed,
        canceled_leads: baseBucket.canceled,
        reverted_leads: baseBucket.reverted,
        stock_gerente_user_id: gId,
        gerente_name: gId ? gerenteNameById.get(gId) ?? null : null,
      };
    })
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
}

/**
 * Lista leads de um pacote específico do estoque do gerente.
 * Retorna apenas entries onde stock_gerente_user_id = gerente (segurança).
 */
export async function listStockPackageLeads(
  gerenteUserId: string,
  bancaId: string,
  transferLogId: string,
  options?: { statusFilter?: 'em_estoque' | 'repassado' | 'cancelado' | 'revertido' | 'all' }
): Promise<{ package: StockPackage | null; leads: StockLeadRow[] }> {
  const { data: log } = await supabaseServiceRole
    .from('admin_lead_transfer_logs')
    .select('id, created_at, transfer_type, deadline_days, performed_by_user_id, banca_id, transfer_kind')
    .eq('id', transferLogId)
    .eq('banca_id', bancaId)
    .maybeSingle();

  if (!log || (log as { transfer_kind?: string }).transfer_kind !== 'admin_to_gerente_stock') {
    return { package: null, leads: [] };
  }

  const statusFilter = options?.statusFilter ?? 'em_estoque';
  let q = supabaseServiceRole
    .from('admin_lead_transfer_entries')
    .select(
      'lead_id, transfer_log_id, banca_id, original_source_consultant_email, stock_status, stock_resolved_at, transfer_type, lead_name, lead_phone, saldo_snapshot, last_interaction_snapshot, total_depositado_snapshot, total_apostado_snapshot, total_ganho_snapshot, available_withdraw_snapshot, total_saque_snapshot, created_at'
    )
    .eq('banca_id', bancaId)
    .eq('stock_gerente_user_id', gerenteUserId)
    .eq('transfer_log_id', transferLogId);

  if (statusFilter !== 'all') q = q.eq('stock_status', statusFilter);

  const { data: entries } = await q;
  const rows = Array.isArray(entries) ? entries : [];

  const logDeadline = Number((log as RawLog).deadline_days ?? 10) || 10;
  const logType = String((log as RawLog).transfer_type ?? 'TF');
  const receivedAt = String((log as RawLog).created_at ?? new Date().toISOString());

  const leads: StockLeadRow[] = rows.map((e) => {
    const raw = e as RawEntry & { created_at?: string };
    return {
      lead_id: String(raw.lead_id ?? '').trim(),
      transfer_log_id: raw.transfer_log_id,
      banca_id: raw.banca_id,
      original_source_consultant_email: raw.original_source_consultant_email ?? null,
      stock_status: (raw.stock_status ?? 'em_estoque') as StockLeadRow['stock_status'],
      stock_resolved_at: raw.stock_resolved_at ?? null,
      received_at: raw.created_at ?? receivedAt,
      deadline_days: logDeadline,
      transfer_type: raw.transfer_type ?? logType,
      lead_name: raw.lead_name ?? null,
      lead_phone: raw.lead_phone ?? null,
      saldo_snapshot: raw.saldo_snapshot != null ? Number(raw.saldo_snapshot) : null,
      last_interaction_snapshot: raw.last_interaction_snapshot ?? null,
      total_depositado_snapshot: raw.total_depositado_snapshot != null ? Number(raw.total_depositado_snapshot) : null,
      total_apostado_snapshot: raw.total_apostado_snapshot != null ? Number(raw.total_apostado_snapshot) : null,
      total_ganho_snapshot: raw.total_ganho_snapshot != null ? Number(raw.total_ganho_snapshot) : null,
      available_withdraw_snapshot: raw.available_withdraw_snapshot != null ? Number(raw.available_withdraw_snapshot) : null,
      total_saque_snapshot: raw.total_saque_snapshot != null ? Number(raw.total_saque_snapshot) : null,
    };
  });

  const packageMeta: StockPackage = {
    transfer_log_id: log.id,
    banca_id: bancaId,
    created_at: receivedAt,
    transfer_type: logType as StockPackage['transfer_type'],
    deadline_days: logDeadline,
    performed_by_user_id: (log as RawLog).performed_by_user_id ?? null,
    performed_by_name: null,
    total_leads: leads.length,
    pending_leads: leads.filter((l) => l.stock_status === 'em_estoque').length,
    distributed_leads: leads.filter((l) => l.stock_status === 'repassado').length,
    canceled_leads: leads.filter((l) => l.stock_status === 'cancelado').length,
    reverted_leads: leads.filter((l) => l.stock_status === 'revertido').length,
  };

  return { package: packageMeta, leads };
}

/**
 * Busca entries ainda em estoque pelos ids de lead (usado no repasse do gerente).
 * Retorna apenas as que pertencem ao gerente e à banca indicados.
 */
export async function getPendingStockEntriesByLeadIds(
  gerenteUserId: string,
  bancaId: string,
  leadIds: string[]
): Promise<{ lead_id: string; transfer_log_id: string; original_source_consultant_email: string | null; entry_id: string }[]> {
  const uniq = Array.from(new Set(leadIds.map((s) => String(s).trim()).filter(Boolean)));
  if (uniq.length === 0) return [];

  const { data, error } = await supabaseServiceRole
    .from('admin_lead_transfer_entries')
    .select('id, lead_id, transfer_log_id, original_source_consultant_email, stock_status')
    .eq('banca_id', bancaId)
    .eq('stock_gerente_user_id', gerenteUserId)
    .eq('stock_status', 'em_estoque')
    .in('lead_id', uniq);

  if (error || !Array.isArray(data)) return [];
  return data.map((row) => ({
    entry_id: row.id,
    lead_id: String(row.lead_id ?? ''),
    transfer_log_id: String(row.transfer_log_id ?? ''),
    original_source_consultant_email: row.original_source_consultant_email ?? null,
  }));
}

export async function markStockEntriesDistributed(entryIds: string[]): Promise<boolean> {
  if (entryIds.length === 0) return true;
  const { error } = await supabaseServiceRole
    .from('admin_lead_transfer_entries')
    .update({ stock_status: 'repassado', stock_resolved_at: new Date().toISOString() })
    .in('id', entryIds);
  return !error;
}

/**
 * Encerra reservas ainda em_estoque como revertido ao consultor doador.
 * Não chama o CRM: neste fluxo os leads continuam com o consultor de origem até o gerente repassar.
 */
export async function markStockEntriesRevertedToDonor(params: {
  transferLogId: string;
  bancaId: string;
  gerenteUserId: string;
  leadIds?: string[] | null;
}): Promise<{ reverted: number } | { error: string }> {
  const { transferLogId, bancaId, gerenteUserId } = params;
  const wanted = params.leadIds?.map((x) => String(x).trim()).filter(Boolean) ?? [];
  let q = supabaseServiceRole
    .from('admin_lead_transfer_entries')
    .update({ stock_status: 'revertido', stock_resolved_at: new Date().toISOString() })
    .eq('transfer_log_id', transferLogId)
    .eq('banca_id', bancaId)
    .eq('stock_gerente_user_id', gerenteUserId)
    .eq('stock_status', 'em_estoque');
  if (wanted.length > 0) q = q.in('lead_id', wanted);
  const { data, error } = await q.select('id');
  if (error) return { error: error.message };
  return { reverted: Array.isArray(data) ? data.length : 0 };
}

/**
 * Encerra pacote admin→estoque: marca como revertido linhas ainda em_estoque ou já repassadas para consultor.
 */
export async function markAdminStockPackageEntriesReleasedToOrigin(params: {
  transferLogId: string;
  bancaId: string;
  gerenteUserId: string;
}): Promise<{ released: number } | { error: string }> {
  const { transferLogId, bancaId, gerenteUserId } = params;
  const { data, error } = await supabaseServiceRole
    .from('admin_lead_transfer_entries')
    .update({ stock_status: 'revertido', stock_resolved_at: new Date().toISOString() })
    .eq('transfer_log_id', transferLogId)
    .eq('banca_id', bancaId)
    .eq('stock_gerente_user_id', gerenteUserId)
    .in('stock_status', ['em_estoque', 'repassado'])
    .select('id');
  if (error) {
    let msg = error.message;
    if (msg.includes('stock_status_check') || msg.includes('violates check constraint')) {
      msg +=
        ' Verifique se a migration que permite stock_status=revertido foi aplicada (ex.: 20260507180000_stock_status_revertido.sql).';
    }
    return { error: msg };
  }
  return { released: Array.isArray(data) ? data.length : 0 };
}

/**
 * Desfaz cancelamento da reserva admin→estoque: volta cancelado → em_estoque no estoque do gerente.
 * Não chama o CRM.
 */
export async function markStockEntriesRestoreCanceledToEmEstoque(params: {
  transferLogId: string;
  bancaId: string;
  gerenteUserId: string;
  leadIds?: string[] | null;
}): Promise<{ restored: number } | { error: string }> {
  const { transferLogId, bancaId, gerenteUserId } = params;
  const wanted = params.leadIds?.map((x) => String(x).trim()).filter(Boolean) ?? [];
  let q = supabaseServiceRole
    .from('admin_lead_transfer_entries')
    .update({ stock_status: 'em_estoque', stock_resolved_at: null })
    .eq('transfer_log_id', transferLogId)
    .eq('banca_id', bancaId)
    .eq('stock_gerente_user_id', gerenteUserId)
    .eq('stock_status', 'cancelado');
  if (wanted.length > 0) q = q.in('lead_id', wanted);
  const { data, error } = await q.select('id');
  if (error) return { error: error.message };
  return { restored: Array.isArray(data) ? data.length : 0 };
}

/**
 * Marca leads em_estoque ou cancelados (legado) como repassados após envio ao consultor no CRM
 * (origem → consultor destino). Atualiza target_consultant_email para o consultor real.
 */
export async function markStockEntriesDirectCrmSyncToConsultant(params: {
  transferLogId: string;
  bancaId: string;
  gerenteUserId: string;
  destinationConsultantEmail: string;
}): Promise<{ updated: number } | { error: string }> {
  const dest = params.destinationConsultantEmail.trim().toLowerCase();
  if (!dest) return { error: 'E-mail do consultor destino inválido.' };
  const { data, error } = await supabaseServiceRole
    .from('admin_lead_transfer_entries')
    .update({
      stock_status: 'repassado',
      stock_resolved_at: new Date().toISOString(),
      target_consultant_email: dest,
    })
    .eq('transfer_log_id', params.transferLogId)
    .eq('banca_id', params.bancaId)
    .eq('stock_gerente_user_id', params.gerenteUserId)
    .in('stock_status', ['em_estoque', 'cancelado'])
    .select('id');
  if (error) return { error: error.message };
  return { updated: Array.isArray(data) ? data.length : 0 };
}
