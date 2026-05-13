/**
 * Desfaz um repasse Estoque → Consultor (log gerente_stock_to_consultant):
 * CRM move leads do consultor destino de volta ao consultor doador;
 * linhas de reserva admin→estoque voltam de repassado para em_estoque no estoque do gerente.
 */

import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { getBancaCrmBaseForTransfer } from '@/lib/server/crm/gerenteLeadStock';
import { assertLeadTransferNotLockedForBanca, isConsultantInBanca } from '@/lib/server/crm/adminLeadTransferContext';
import { createCrmRedistributionClient } from '@/lib/server/crm/crmRedistributionClient';

const LOG_PREFIX = '[reverseGerenteStockRepass]';

function normalizeCrmLeadId(id: number | string): number | string {
  if (typeof id === 'number') return id;
  const s = String(id).trim();
  if (!s.includes('-')) {
    const n = Number(s);
    return Number.isFinite(n) && n > 0 ? n : s;
  }
  const last = s.split('-').pop() ?? '';
  const n = Number(last);
  return Number.isFinite(n) && n > 0 ? n : s;
}

export async function reverseGerenteStockRepassToDonor(params: {
  transferLogId: string;
  bancaId: string;
}): Promise<
  | { ok: true; crm_count: number; stock_updated: number }
  | { ok: false; error: string; status?: number }
> {
  const { transferLogId, bancaId } = params;

  const { data: logRow, error: logErr } = await supabaseServiceRole
    .from('admin_lead_transfer_logs')
    .select(
      'id, banca_id, transfer_kind, source_consultant_email, target_consultant_email, performed_by_user_id, leads_ids, filters_snapshot'
    )
    .eq('id', transferLogId)
    .eq('banca_id', bancaId)
    .maybeSingle();

  if (logErr || !logRow) {
    return { ok: false, error: 'Log de transferência não encontrado.', status: 404 };
  }

  const kind = String((logRow as { transfer_kind?: string }).transfer_kind ?? '').trim();
  if (kind !== 'gerente_stock_to_consultant') {
    return { ok: false, error: 'Apenas repasses Estoque → Consultor podem ser revertidos por esta ação.', status: 400 };
  }

  const fs = (logRow as { filters_snapshot?: Record<string, unknown> | null }).filters_snapshot;
  if (fs && typeof fs === 'object' && fs.reversed_at != null && String(fs.reversed_at).trim() !== '') {
    return { ok: false, error: 'Este repasse já foi revertido.', status: 400 };
  }

  const source = String((logRow as { source_consultant_email?: string }).source_consultant_email ?? '').trim().toLowerCase();
  const target = String((logRow as { target_consultant_email?: string }).target_consultant_email ?? '').trim().toLowerCase();
  const gerenteUserId = String((logRow as { performed_by_user_id?: string }).performed_by_user_id ?? '').trim();

  if (!source || !target || source === target) {
    return { ok: false, error: 'Origem ou destino inválidos neste log.', status: 400 };
  }
  if (!gerenteUserId) {
    return { ok: false, error: 'Log sem gerente responsável.', status: 400 };
  }

  const rawIds = (logRow as { leads_ids?: unknown }).leads_ids;
  const leadsArr = Array.isArray(rawIds) ? rawIds : [];
  const leadIdStrings = leadsArr.map((x) => String(x).trim()).filter(Boolean);
  if (leadIdStrings.length === 0) {
    return { ok: false, error: 'Este log não possui leads associados.', status: 400 };
  }

  await assertLeadTransferNotLockedForBanca(bancaId);

  const srcOk = await isConsultantInBanca(bancaId, source);
  const tgtOk = await isConsultantInBanca(bancaId, target);
  if (!srcOk || !tgtOk) {
    return { ok: false, error: 'Origem ou destino não está cadastrado nesta banca.', status: 400 };
  }

  const bancaCtx = await getBancaCrmBaseForTransfer(bancaId);
  if (!bancaCtx?.crmBaseUrl) {
    return { ok: false, error: 'Banca sem URL de CRM configurada.', status: 400 };
  }

  const crmLeadIds = leadIdStrings.map((id) => normalizeCrmLeadId(id));
  const client = createCrmRedistributionClient(bancaCtx.crmBaseUrl);

  console.log(
    `${LOG_PREFIX} CRM revert banca=${bancaId} log=${transferLogId} from=${target} to=${source} (donor) n=${crmLeadIds.length}`
  );

  const crmResult = await client.redistributeLeads({
    source_consultant_email: target,
    target_consultant_email: source,
    leads_ids: crmLeadIds,
  });

  if (!crmResult.success) {
    const raw = (crmResult.error ?? crmResult.message ?? 'Erro ao reverter no CRM').trim();
    const userMessage = raw.toLowerCase() === 'consultant not found' ? 'Consultor não encontrado na banca no CRM.' : raw;
    return { ok: false, error: userMessage, status: 502 };
  }

  const crmCount =
    Number(crmResult.count ?? crmResult.data?.count ?? 0) || leadIdStrings.length;

  const { data: stockRows } = await supabaseServiceRole
    .from('admin_lead_transfer_entries')
    .select('id, transfer_log_id')
    .eq('banca_id', bancaId)
    .eq('stock_gerente_user_id', gerenteUserId)
    .eq('stock_status', 'repassado')
    .in('lead_id', leadIdStrings);

  const rows = Array.isArray(stockRows) ? stockRows : [];
  const pkgIds = [...new Set(rows.map((r) => String((r as { transfer_log_id?: string }).transfer_log_id ?? '')).filter(Boolean))];

  let entryIds: string[] = [];
  if (pkgIds.length > 0) {
    const { data: pkgLogs } = await supabaseServiceRole
      .from('admin_lead_transfer_logs')
      .select('id, transfer_kind')
      .in('id', pkgIds);

    const adminPkg = new Set(
      (pkgLogs ?? [])
        .filter((p) => String((p as { transfer_kind?: string }).transfer_kind ?? '') === 'admin_to_gerente_stock')
        .map((p) => String((p as { id: string }).id))
    );

    entryIds = rows
      .filter((r) => adminPkg.has(String((r as { transfer_log_id?: string }).transfer_log_id ?? '')))
      .map((r) => String((r as { id: string }).id));
  }

  let stockUpdated = 0;
  if (entryIds.length > 0) {
    const { data: updated, error: upErr } = await supabaseServiceRole
      .from('admin_lead_transfer_entries')
      .update({ stock_status: 'em_estoque', stock_resolved_at: null })
      .in('id', entryIds)
      .select('id');

    if (upErr) {
      console.error(`${LOG_PREFIX} CRM ok mas falha ao atualizar estoque:`, upErr.message);
      return {
        ok: false,
        error:
          'O CRM reverteu o lead, mas falhou ao atualizar o estoque no Zaploto. Entre em contato com suporte.',
        status: 500,
      };
    }
    stockUpdated = Array.isArray(updated) ? updated.length : 0;
  } else {
    console.warn(`${LOG_PREFIX} CRM reverteu mas nenhuma linha de estoque repassado encontrada para estes leads.`);
  }

  const prevFs =
    fs && typeof fs === 'object' && fs !== null && !Array.isArray(fs) ? { ...fs } : {};
  const nextFs = {
    ...prevFs,
    reversed_at: new Date().toISOString(),
    reversed_flow: 'gerente_stock_repass_to_donor',
  };

  await supabaseServiceRole.from('admin_lead_transfer_logs').update({ filters_snapshot: nextFs }).eq('id', transferLogId);

  return { ok: true, crm_count: crmCount, stock_updated: stockUpdated };
}
