/**
 * Leads que ainda estão no estoque CRM do gerente:
 * entrada admin_to_gerente_stock para este gerente menos saídas gerente_stock_to_consultant pelo pool.
 */

import { supabaseServiceRole } from '@/lib/services/supabase-service';

export type GerenteStockLeadMeta = {
  lead_id: string;
  deadline_days: number;
  transfer_type: string;
  received_at: string;
  transfer_log_id: string;
};

function fsGerenteId(fs: Record<string, unknown> | null): string | null {
  if (!fs || typeof fs !== 'object') return null;
  const raw = fs.gerente_stock_gerente_id ?? fs['gerente_stock_gerente_id'];
  if (raw == null) return null;
  const s = String(raw).trim();
  return s || null;
}

/**
 * IDs ainda no estoque + metadados do lote de entrada (último admin→estoque por lead).
 */
export async function getGerenteStockLeadInventory(
  gerenteUserId: string,
  bancaId: string,
  poolEmailNorm: string
): Promise<Map<string, GerenteStockLeadMeta>> {
  const gid = gerenteUserId.trim();

  const { data: inLogs, error: inErr } = await supabaseServiceRole
    .from('admin_lead_transfer_logs')
    .select('id, created_at, deadline_days, transfer_type, filters_snapshot')
    .eq('banca_id', bancaId)
    .eq('transfer_kind', 'admin_to_gerente_stock');

  if (inErr || !Array.isArray(inLogs)) {
    console.warn('[gerenteStockInventory] inbound logs:', inErr?.message);
    return new Map();
  }

  const stockLogIds = inLogs
    .filter((row) => {
      const fs = row.filters_snapshot as Record<string, unknown> | null;
      const g = fsGerenteId(fs);
      return g === gid;
    })
    .map((r) => r.id as string);

  if (stockLogIds.length === 0) return new Map();

  const logById = new Map<string, (typeof inLogs)[0]>();
  for (const row of inLogs) {
    if (stockLogIds.includes(row.id as string)) logById.set(row.id as string, row);
  }

  const { data: inboundEntries, error: entErr } = await supabaseServiceRole
    .from('admin_lead_transfer_entries')
    .select('lead_id, transfer_log_id')
    .eq('banca_id', bancaId)
    .in('transfer_log_id', stockLogIds);

  if (entErr || !Array.isArray(inboundEntries)) {
    console.warn('[gerenteStockInventory] inbound entries:', entErr?.message);
    return new Map();
  }

  /** Último recebimento por lead (mais recente vence). */
  const inboundMeta = new Map<string, GerenteStockLeadMeta>();
  for (const e of inboundEntries) {
    const lid = String(e.lead_id ?? '').trim();
    const logId = String(e.transfer_log_id ?? '').trim();
    if (!lid || !logId) continue;
    const log = logById.get(logId);
    if (!log) continue;
    const created = String(log.created_at ?? '');
    const prev = inboundMeta.get(lid);
    if (prev && prev.received_at >= created) continue;
    inboundMeta.set(lid, {
      lead_id: lid,
      deadline_days: Number(log.deadline_days ?? 10) || 10,
      transfer_type: String(log.transfer_type ?? 'TF'),
      received_at: created,
      transfer_log_id: logId,
    });
  }

  const pe = poolEmailNorm.trim().toLowerCase();

  const { data: outLogs } = await supabaseServiceRole
    .from('admin_lead_transfer_logs')
    .select('id')
    .eq('banca_id', bancaId)
    .eq('transfer_kind', 'gerente_stock_to_consultant')
    .ilike('source_consultant_email', pe);

  const outLogIds = Array.isArray(outLogs) ? outLogs.map((r) => r.id as string).filter(Boolean) : [];
  const outLeadIds = new Set<string>();

  if (outLogIds.length > 0) {
    const { data: outEntries } = await supabaseServiceRole
      .from('admin_lead_transfer_entries')
      .select('lead_id')
      .eq('banca_id', bancaId)
      .in('transfer_log_id', outLogIds);

    if (Array.isArray(outEntries)) {
      for (const o of outEntries) {
        const lid = String(o.lead_id ?? '').trim();
        if (lid) outLeadIds.add(lid);
      }
    }
  }

  const still = new Map<string, GerenteStockLeadMeta>();
  for (const [lid, meta] of inboundMeta) {
    if (!outLeadIds.has(lid)) still.set(lid, meta);
  }
  return still;
}

export function bucketDeadlineDays(days: number): '10' | '20' | '30' | 'other' {
  if (days === 10) return '10';
  if (days === 20) return '20';
  if (days === 30) return '30';
  return 'other';
}
