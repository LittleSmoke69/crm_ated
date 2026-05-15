/**
 * Quando houve reserva Admin→Estoque no Zaploto: envia os leads ao consultor no CRM (origem → destino),
 * tira-os do estoque do gerente no sistema (repassado) e alinha «Transferido» no CRM.
 */

import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { getBancaCrmBaseForTransfer } from '@/lib/server/crm/gerenteLeadStock';
import { assertLeadTransferNotLockedForBanca, isConsultantInBanca } from '@/lib/server/crm/adminLeadTransferContext';
import { createCrmRedistributionClient } from '@/lib/server/crm/crmRedistributionClient';
import {
  buildLeadIdSetUnderConsultant,
  leadIdMatchKey,
  normalizeCrmLeadIdForRedistribute,
} from '@/lib/server/crm/crmLeadIdsForCrmApi';
import { markStockEntriesDirectCrmSyncToConsultant } from '@/lib/server/crm/gerenteStockReservation';

const LOG_PREFIX = '[syncStockReservationAsDirectCrm]';

export async function syncStockReservationAsDirectCrmTransfer(params: {
  transferLogId: string;
  bancaId: string;
  /** Consultor que deve aparecer com os leads em «Transferido» no CRM. Se vazio, usa filters_snapshot (reserva). */
  targetConsultantEmail?: string;
}): Promise<
  | {
      ok: true;
      crm_count: number;
      entries_updated: number;
      skipped_already_at_target: number;
      destination_consultant_email: string;
    }
  | { ok: false; error: string; status?: number }
> {
  const { transferLogId, bancaId } = params;
  const paramTrim = (params.targetConsultantEmail ?? '').trim().toLowerCase();

  const { data: logRow, error: logErr } = await supabaseServiceRole
    .from('admin_lead_transfer_logs')
    .select('id, banca_id, transfer_kind, source_consultant_email, target_consultant_email, filters_snapshot')
    .eq('id', transferLogId)
    .eq('banca_id', bancaId)
    .maybeSingle();

  if (logErr || !logRow) {
    return { ok: false, error: 'Log de transferência não encontrado.', status: 404 };
  }

  const kind = String((logRow as { transfer_kind?: string }).transfer_kind ?? '').trim();
  if (kind !== 'admin_to_gerente_stock') {
    return { ok: false, error: 'Apenas pacotes Admin → Estoque (reserva) permitem esta sincronização.', status: 400 };
  }

  const fs = (logRow as { filters_snapshot?: Record<string, unknown> | null }).filters_snapshot;
  const gerenteUserId =
    fs != null && typeof fs === 'object' && typeof (fs as { gerente_stock_gerente_id?: string }).gerente_stock_gerente_id === 'string'
      ? String((fs as { gerente_stock_gerente_id: string }).gerente_stock_gerente_id).trim()
      : '';
  if (!gerenteUserId) {
    return { ok: false, error: 'Pacote sem gerente de estoque no registro (filters_snapshot).', status: 400 };
  }

  const source = String((logRow as { source_consultant_email?: string }).source_consultant_email ?? '').trim().toLowerCase();
  if (!source) {
    return { ok: false, error: 'Consultor de origem ausente no log.', status: 400 };
  }

  const logColTarget = String((logRow as { target_consultant_email?: string | null }).target_consultant_email ?? '').trim().toLowerCase();
  /** Coluna «Destino» do log (mesmo critério do histórico). Não filtrar pelo e-mail do gerente: pode coincidir com o consultor exibido na UI. */
  const fromLogColumn = logColTarget.includes('@') && logColTarget !== source ? logColTarget : '';

  const fromSnapshot =
    fs != null && typeof fs === 'object'
      ? String((fs as { stock_crm_target_consultant_email?: string }).stock_crm_target_consultant_email ?? '').trim().toLowerCase()
      : '';
  const fromLastDirect =
    fs != null && typeof fs === 'object'
      ? String((fs as { stock_direct_crm_target_email?: string }).stock_direct_crm_target_email ?? '').trim().toLowerCase()
      : '';
  const targetTrim =
    (paramTrim.includes('@') ? paramTrim : '') ||
    (fromSnapshot.includes('@') ? fromSnapshot : '') ||
    (fromLastDirect.includes('@') ? fromLastDirect : '') ||
    (fromLogColumn.includes('@') ? fromLogColumn : '');

  if (!targetTrim.includes('@')) {
    return {
      ok: false,
      error:
        'Pacote sem consultor de destino (CRM) utilizável. Confira se a coluna Destino do log é um consultor (não só o gerente do estoque) ou informe o e-mail na API.',
      status: 400,
    };
  }
  if (source === targetTrim) {
    return { ok: false, error: 'Consultor de destino deve ser diferente do consultor de origem.', status: 400 };
  }

  const { data: entryRows, error: entErr } = await supabaseServiceRole
    .from('admin_lead_transfer_entries')
    .select('lead_id')
    .eq('transfer_log_id', transferLogId)
    .eq('banca_id', bancaId)
    .eq('stock_gerente_user_id', gerenteUserId)
    .in('stock_status', ['em_estoque', 'cancelado']);

  if (entErr) {
    console.error(`${LOG_PREFIX} entries:`, entErr.message);
    return { ok: false, error: 'Erro ao ler leads deste pacote no estoque.', status: 500 };
  }

  const leadIds = [...new Set((entryRows ?? []).map((r) => String((r as { lead_id?: string }).lead_id ?? '').trim()).filter(Boolean))];
  if (leadIds.length === 0) {
    return {
      ok: false,
      error:
        'Nenhum lead aplicável neste pacote (só repassados/revertidos ou sem vínculo ao estoque). São considerados em estoque ou cancelados (legado) ligados ao gerente do pacote.',
      status: 400,
    };
  }

  await assertLeadTransferNotLockedForBanca(bancaId);

  const [srcOk, tgtOk] = await Promise.all([isConsultantInBanca(bancaId, source), isConsultantInBanca(bancaId, targetTrim)]);
  if (!srcOk || !tgtOk) {
    return { ok: false, error: 'Origem ou destino não está cadastrado nesta banca.', status: 400 };
  }

  const bancaCtx = await getBancaCrmBaseForTransfer(bancaId);
  if (!bancaCtx?.crmBaseUrl) {
    return { ok: false, error: 'Configure a URL do CRM da banca para sincronizar a transferência.', status: 400 };
  }

  const crmLeadIds = leadIds.map((id) => normalizeCrmLeadIdForRedistribute(id));
  const client = createCrmRedistributionClient(bancaCtx.crmBaseUrl);

  let preSkipped: (string | number)[] = [];
  let crmLeadIdsToSend = crmLeadIds;
  try {
    const atTarget = await buildLeadIdSetUnderConsultant(client, targetTrim);
    preSkipped = crmLeadIds.filter((id) => atTarget.has(leadIdMatchKey(id)));
    crmLeadIdsToSend = crmLeadIds.filter((id) => !atTarget.has(leadIdMatchKey(id)));
    if (preSkipped.length > 0) {
      console.log(`${LOG_PREFIX} ${preSkipped.length} lead(s) já no destino no CRM — omitidos do POST.`);
    }
  } catch (e) {
    console.warn(`${LOG_PREFIX} falha ao listar indicados do destino; enviando todos ao CRM.`, e);
    preSkipped = [];
    crmLeadIdsToSend = crmLeadIds;
  }

  let crmCount = 0;
  let usedSourceForCrm = source;
  if (crmLeadIdsToSend.length > 0) {
    console.log(
      `${LOG_PREFIX} CRM redistribute pkg=${transferLogId} from=${source} to=${targetTrim} n=${crmLeadIdsToSend.length} preSkipped=${preSkipped.length}`
    );
    let crmResult = await client.redistributeLeads({
      source_consultant_email: usedSourceForCrm,
      target_consultant_email: targetTrim,
      leads_ids: crmLeadIdsToSend,
    });
    if (!crmResult.success) {
      const raw = (crmResult.error ?? crmResult.message ?? 'Erro ao sincronizar no CRM').trim();
      return { ok: false, error: `CRM: ${raw}`, status: 502 };
    }
    let rawC = crmResult.count ?? (crmResult as { data?: { count?: number } }).data?.count;
    let rawNum = rawC != null && String(rawC).trim() !== '' ? Number(rawC) : NaN;

    const crmExplicitZero =
      crmLeadIdsToSend.length > 0 &&
      Number.isFinite(rawNum) &&
      rawNum === 0 &&
      crmResult.success;

    if (crmExplicitZero) {
      const { data: origRows } = await supabaseServiceRole
        .from('admin_lead_transfer_entries')
        .select('original_source_consultant_email')
        .eq('transfer_log_id', transferLogId)
        .eq('banca_id', bancaId)
        .eq('stock_gerente_user_id', gerenteUserId)
        .in('stock_status', ['em_estoque', 'cancelado']);

      const freq = new Map<string, number>();
      for (const r of origRows ?? []) {
        const e = String((r as { original_source_consultant_email?: string | null }).original_source_consultant_email ?? '')
          .trim()
          .toLowerCase();
        if (!e.includes('@') || e === targetTrim) continue;
        freq.set(e, (freq.get(e) ?? 0) + 1);
      }
      const alts = [...freq.entries()]
        .filter(([e]) => e !== source)
        .sort((a, b) => b[1] - a[1])
        .map(([e]) => e);

      for (const alt of alts.slice(0, 6)) {
        if (alt === usedSourceForCrm) continue;
        const srcOkAlt = await isConsultantInBanca(bancaId, alt);
        if (!srcOkAlt) continue;
        console.warn(`${LOG_PREFIX} CRM count=0 com origem=${usedSourceForCrm}; tentando original_source das entries: ${alt}`);
        const retry = await client.redistributeLeads({
          source_consultant_email: alt,
          target_consultant_email: targetTrim,
          leads_ids: crmLeadIdsToSend,
        });
        if (!retry.success) continue;
        const rc = retry.count ?? (retry as { data?: { count?: number } }).data?.count;
        const rNum = rc != null && String(rc).trim() !== '' ? Number(rc) : NaN;
        if (Number.isFinite(rNum) && rNum > 0) {
          crmResult = retry;
          rawC = rc;
          rawNum = rNum;
          usedSourceForCrm = alt;
          console.log(`${LOG_PREFIX} retry CRM ok: origem efetiva=${usedSourceForCrm} count=${rNum}`);
          break;
        }
      }
    }

    if (Number.isFinite(rawNum) && rawNum === 0) {
      let diagLine = '';
      try {
        const atSource = await buildLeadIdSetUnderConsultant(client, usedSourceForCrm);
        const under = crmLeadIdsToSend.filter((id) => atSource.has(leadIdMatchKey(id))).length;
        diagLine = ` Diagnóstico: dos ${crmLeadIdsToSend.length} ID(s) enviados ao CRM, ${under} aparecem na listagem de indicados de «${usedSourceForCrm}» (mesma API usada pelo Zaploto). Se for 0, no CRM esses leads não estão como titulares desse e-mail (ou os IDs no CRM não batem com os do pacote). Se for próximo do total mas o CRM ainda devolve count=0, o próprio endpoint redistribute-leads do CRM está a recusar o movimento (regra de negócio deles).`;
        console.warn(`${LOG_PREFIX} count=0 ${under}/${crmLeadIdsToSend.length} IDs sob origem ${usedSourceForCrm} nos indicateds`);
      } catch (e) {
        console.warn(`${LOG_PREFIX} count=0 diagnostic skipped:`, e);
      }
      const crmMsg = String(crmResult.message ?? (crmResult as { data?: { message?: string } }).data?.message ?? '').trim();
      return {
        ok: false,
        error: `O CRM não moveu nenhum lead (count=0). Pedido: origem «${usedSourceForCrm}» → destino «${targetTrim}» (${crmLeadIdsToSend.length} ID(s)).${
          crmMsg ? ` Mensagem do CRM: «${crmMsg}».` : ''
        }${diagLine} Nota: reserva no estoque do gerente no Zaploto não altera o CRM — em tese os leads continuam com o consultor de origem do pacote até alguém repassar no CRM; se alguém já os moveu no CRM, ou o e-mail de origem do pacote não coincide com o titular no CRM, o count fica 0.`,
        status: 409,
      };
    }
    const moved = Number.isFinite(rawNum) ? rawNum : crmLeadIdsToSend.length;
    crmCount = moved + preSkipped.length;
  } else {
    crmCount = preSkipped.length;
    console.log(`${LOG_PREFIX} todos os ${leadIds.length} lead(s) já estavam no consultor destino no CRM — POST omitido.`);
  }

  const dbResult = await markStockEntriesDirectCrmSyncToConsultant({
    transferLogId,
    bancaId,
    gerenteUserId,
    destinationConsultantEmail: targetTrim,
  });

  if ('error' in dbResult) {
    console.error(`${LOG_PREFIX} DB:`, dbResult.error);
    return {
      ok: false,
      error:
        'O CRM pode ter sido atualizado, mas falhou ao marcar o estoque no Zaploto. Verifique o pacote e o CRM antes de repetir.',
      status: 500,
    };
  }

  if (dbResult.updated === 0) {
    return { ok: false, error: 'Nenhuma linha foi atualizada no Zaploto (estados podem ter mudado).', status: 409 };
  }

  const prevFs = fs && typeof fs === 'object' && !Array.isArray(fs) ? { ...fs } : {};
  await supabaseServiceRole
    .from('admin_lead_transfer_logs')
    .update({
      filters_snapshot: {
        ...prevFs,
        stock_direct_crm_sync_at: new Date().toISOString(),
        stock_direct_crm_target_email: targetTrim,
      } as never,
    })
    .eq('id', transferLogId);

  return {
    ok: true,
    crm_count: crmCount,
    entries_updated: dbResult.updated,
    skipped_already_at_target: preSkipped.length,
    destination_consultant_email: targetTrim,
  };
}
