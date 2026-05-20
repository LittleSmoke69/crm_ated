/**
 * Núcleo compartilhado: CRM redistribute + persistência em admin_lead_transfer_*.
 * Usado por /api/admin/crm/redistribute-leads e /api/gerente/crm/redistribute-leads.
 */

import { createCrmRedistributionClient, type RedistributeLeadsResponse } from '@/lib/server/crm/crmRedistributionClient';
import { buildLeadIdSetUnderConsultant, leadIdMatchKey, normalizeCrmLeadIdForRedistribute } from '@/lib/server/crm/crmLeadIdsForCrmApi';
import { isConsultantInBanca } from '@/lib/server/crm/adminLeadTransferContext';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

const LOG_PREFIX = '[lead-transfer][core]';

/**
 * E-mails nas entries do pacote que podem ser o titular no CRM (repasse pós-resolução / estoque).
 * Ordem: original_source (doador real na reserva) → source → target da entry.
 */
async function fetchEntryEmailCandidatesForCrmSource(
  transferLogId: string,
  bancaId: string,
  leadIds: Array<string | number>
): Promise<string[]> {
  const CHUNK = 200;
  const uniqueIds = [...new Set(leadIds.map((id) => String(id).trim()).filter(Boolean))];
  if (!transferLogId?.trim() || !bancaId?.trim() || uniqueIds.length === 0) return [];

  const ordered: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string | null | undefined) => {
    const em = (raw ?? '').trim();
    const low = em.toLowerCase();
    if (!low.includes('@')) return;
    if (seen.has(low)) return;
    seen.add(low);
    ordered.push(em);
  };

  for (let i = 0; i < uniqueIds.length; i += CHUNK) {
    const chunk = uniqueIds.slice(i, i + CHUNK);
    const { data, error } = await supabaseServiceRole
      .from('admin_lead_transfer_entries')
      .select('original_source_consultant_email, source_consultant_email, target_consultant_email')
      .eq('transfer_log_id', transferLogId.trim())
      .eq('banca_id', bancaId.trim())
      .in('lead_id', chunk);
    if (error) {
      console.warn(`${LOG_PREFIX} fetchEntryEmailCandidates: ${error.message}`);
      continue;
    }
    for (const row of data ?? []) {
      const r = row as {
        original_source_consultant_email?: string | null;
        source_consultant_email?: string | null;
        target_consultant_email?: string | null;
      };
      push(r.original_source_consultant_email);
      push(r.source_consultant_email);
      push(r.target_consultant_email);
    }
  }
  return ordered;
}

/** Agrupa lead_ids por `original_source_consultant_email` nas entries (CRM titular real por lead). */
async function groupLeadIdsByEntryOriginalSource(
  transferLogId: string,
  bancaId: string,
  leadIds: Array<string | number>
): Promise<Map<string, (string | number)[]>> {
  const out = new Map<string, (string | number)[]>();
  const CHUNK = 200;
  const uniqueIds = [...new Set(leadIds.map((id) => String(id).trim()).filter(Boolean))];
  if (!transferLogId?.trim() || !bancaId?.trim() || uniqueIds.length === 0) return out;

  for (let i = 0; i < uniqueIds.length; i += CHUNK) {
    const chunk = uniqueIds.slice(i, i + CHUNK);
    const { data, error } = await supabaseServiceRole
      .from('admin_lead_transfer_entries')
      .select('lead_id, original_source_consultant_email')
      .eq('transfer_log_id', transferLogId.trim())
      .eq('banca_id', bancaId.trim())
      .in('lead_id', chunk);
    if (error) {
      console.warn(`${LOG_PREFIX} groupLeadIdsByEntryOriginalSource: ${error.message}`);
      continue;
    }
    for (const row of data ?? []) {
      const lid = (row as { lead_id?: string | number }).lead_id;
      const orig = String((row as { original_source_consultant_email?: string | null }).original_source_consultant_email ?? '').trim();
      if (lid == null || lid === '') continue;
      if (!orig.toLowerCase().includes('@')) continue;
      const arr = out.get(orig) ?? [];
      arr.push(lid);
      out.set(orig, arr);
    }
  }
  return out;
}

/** Normaliza e-mail do lead para persistir em admin_lead_transfer_entries.lead_email (busca no histórico). */
export function normalizeLeadEmailForDb(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s.includes('@') || s.length < 5) return null;
  return s;
}

export type TransferKind = 'standard' | 'admin_to_gerente_stock' | 'gerente_stock_to_consultant';

export type LeadSnapshotInput = {
  lead_id: number | string;
  /** E-mail do lead (CRM/listagem); gravado em entries.lead_email para busca no histórico. */
  email?: string | null;
  name?: string | null;
  phone?: string | null;
  balance?: number | null;
  last_interaction?: string | null;
  total_depositado?: number | null;
  total_apostado?: number | null;
  total_ganho?: number | null;
  available_withdraw?: number | null;
  /** CRM pode enviar número ou string; normalizamos ao persistir. */
  total_saque?: number | string | null;
};

export type LeadRedistributionContext = {
  userId: string;
  bancaId: string;
  crmBaseUrl: string;
};

export type ExecuteLeadRedistributionParams = {
  ctx: LeadRedistributionContext;
  transferKind: TransferKind;
  source_consultant_email: string;
  target_consultant_email: string;
  leads_ids: Array<number | string>;
  transfer_type: 'TF' | 'TF1' | 'TF2' | 'TF3';
  transfer_deadline_days: number;
  filters_snapshot?: Record<string, unknown> | null;
  lead_snapshots?: LeadSnapshotInput[];
  source_transfer_log_id?: string;
  original_source_consultant_email?: string;
  force_db_only: boolean;
};

export type ExecuteLeadRedistributionSuccess = {
  ok: true;
  count: number;
  crm_count: number;
  transfer_log_id: string | null;
  message: string;
};

export type ExecuteLeadRedistributionFailure = {
  ok: false;
  status: number;
  error: string;
  extra?: Record<string, unknown>;
};

export type ExecuteLeadRedistributionResult = ExecuteLeadRedistributionSuccess | ExecuteLeadRedistributionFailure;

function normalizeCrmBaseUrl(raw: string): string {
  const cleaned = raw.trim().replace(/^https?:\/\//i, '').replace(/\/api\/crm\/?/i, '').replace(/\/+$/, '').trim();
  if (!cleaned) return '';
  return `https://${cleaned}`;
}

function buildRedistributeCurlLog(params: {
  crmBaseUrl: string;
  sourceConsultantEmail: string;
  targetConsultantEmail: string;
  leadIds: Array<number | string>;
}): string {
  const baseUrl = normalizeCrmBaseUrl(params.crmBaseUrl);
  const payload = JSON.stringify(
    {
      source_consultant_email: params.sourceConsultantEmail,
      target_consultant_email: params.targetConsultantEmail,
      leads_ids: params.leadIds,
    },
    null,
    2
  );

  return [
    `curl -X POST "${baseUrl}/api/crm/redistribute-leads" \\`,
    `  -H "x-api-key: $CRM_API_KEY" \\`,
    `  -H "Accept: application/json" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '${payload}'`,
  ].join('\n');
}

/** Preenche leads_ids a partir de entries/log quando devolução/reverse envia lista vazia. */
export async function resolveLeadsIdsFromTransferLog(
  leads_ids: Array<number | string>,
  filters_snapshot: Record<string, unknown> | null | undefined,
  bancaId: string
): Promise<Array<number | string>> {
  let out = [...(leads_ids || [])];
  const fs = filters_snapshot != null && typeof filters_snapshot === 'object' ? filters_snapshot : null;
  const logIdForEntries =
    (fs?.log_origem_id ?? fs?.log_devolucao_id) != null ? String(fs?.log_origem_id ?? fs?.log_devolucao_id).trim() : null;
  if ((!out || out.length === 0) && logIdForEntries && bancaId) {
    const { data: entries } = await supabaseServiceRole
      .from('admin_lead_transfer_entries')
      .select('lead_id')
      .eq('transfer_log_id', logIdForEntries)
      .eq('banca_id', bancaId);
    const fromEntries = Array.isArray(entries) ? entries.map((e: { lead_id?: string }) => e?.lead_id).filter(Boolean) as string[] : [];
    if (fromEntries.length > 0) {
      out = fromEntries;
      console.log(`${LOG_PREFIX} leads_ids from admin_lead_transfer_entries: log_id=${logIdForEntries}, count=${fromEntries.length}`);
    } else {
      const { data: logRow } = await supabaseServiceRole
        .from('admin_lead_transfer_logs')
        .select('leads_ids')
        .eq('id', logIdForEntries)
        .eq('banca_id', bancaId)
        .maybeSingle();
      const fromLog = Array.isArray((logRow as { leads_ids?: unknown[] })?.leads_ids)
        ? (logRow as { leads_ids: (string | number)[] }).leads_ids.filter((id) => id != null && String(id).trim() !== '')
        : [];
      if (fromLog.length > 0) {
        out = fromLog;
        console.log(`${LOG_PREFIX} leads_ids from admin_lead_transfer_logs.leads_ids: log_id=${logIdForEntries}, count=${fromLog.length}`);
      }
    }
  }
  return out;
}

export async function executeLeadRedistributionCore(
  params: ExecuteLeadRedistributionParams
): Promise<ExecuteLeadRedistributionResult> {
  const {
    ctx,
    transferKind,
    transfer_type,
    transfer_deadline_days,
    filters_snapshot,
    lead_snapshots,
    source_transfer_log_id,
    original_source_consultant_email,
    force_db_only,
  } = params;

  let source_consultant_email = params.source_consultant_email.trim();
  let target_consultant_email = params.target_consultant_email.trim();

  let leads_ids = await resolveLeadsIdsFromTransferLog(params.leads_ids, filters_snapshot, ctx.bancaId);

  const normalizedLeadIds = (leads_ids || []).map((id) => {
    if (typeof id === 'number' && Number.isFinite(id)) return id;
    const s = String(id).trim();
    const n = Number(s);
    return s !== '' && Number.isFinite(n) ? n : s;
  });
  if (normalizedLeadIds.length === 0) {
    return { ok: false, status: 400, error: 'Nenhum lead_id válido para transferir. Informe leads_ids ou use um log que possua entries.' };
  }

  const crmLeadIds = normalizedLeadIds.map((id) => normalizeCrmLeadIdForRedistribute(id));

  const fs = filters_snapshot != null && typeof filters_snapshot === 'object' ? filters_snapshot : null;
  const isDevolucao = fs != null && 'devolucao' in fs && 'log_origem_id' in fs;
  const isReverse = fs != null && 'reverse_devolucao' in fs;
  if (isDevolucao) {
    console.log(
      `${LOG_PREFIX} [DEVOLUÇÃO] ${normalizedLeadIds.length} lead(s) → origem. target=${target_consultant_email} sample=${JSON.stringify(normalizedLeadIds.slice(0, 10))}`
    );
  }
  if (isReverse) {
    console.log(
      `${LOG_PREFIX} [REVERSE] ${normalizedLeadIds.length} lead(s) → destino. target=${target_consultant_email} sample=${JSON.stringify(normalizedLeadIds.slice(0, 10))}`
    );
  }

  const curlForVerification = buildRedistributeCurlLog({
    crmBaseUrl: ctx.crmBaseUrl,
    sourceConsultantEmail: source_consultant_email,
    targetConsultantEmail: target_consultant_email,
    leadIds: normalizedLeadIds,
  });
  console.log(`${LOG_PREFIX} CRM cURL (verificação):\n${curlForVerification}`);

  const [sourceInBanca, targetInBanca] = await Promise.all([
    isConsultantInBanca(ctx.bancaId, source_consultant_email),
    isConsultantInBanca(ctx.bancaId, target_consultant_email),
  ]);

  if (!sourceInBanca) {
    console.log(`${LOG_PREFIX} source not in banca: ${source_consultant_email}, bancaId=${ctx.bancaId}`);
    return { ok: false, status: 400, error: 'Consultor origem não pertence à banca selecionada.' };
  }
  if (!targetInBanca) {
    console.log(`${LOG_PREFIX} target not in banca: ${target_consultant_email}, bancaId=${ctx.bancaId}`);
    return { ok: false, status: 400, error: 'Consultor destino não pertence à banca selecionada.' };
  }

  const client = createCrmRedistributionClient(ctx.crmBaseUrl);

  let preSkippedAlreadyAtTarget: (string | number)[] = [];
  let crmLeadIdsToSend = crmLeadIds;
  if (!force_db_only && crmLeadIds.length > 0) {
    try {
      const atTargetSet = await buildLeadIdSetUnderConsultant(client, target_consultant_email);
      preSkippedAlreadyAtTarget = crmLeadIds.filter((id) => atTargetSet.has(leadIdMatchKey(id)));
      crmLeadIdsToSend = crmLeadIds.filter((id) => !atTargetSet.has(leadIdMatchKey(id)));
      if (preSkippedAlreadyAtTarget.length > 0) {
        const sample = JSON.stringify(preSkippedAlreadyAtTarget.slice(0, 20));
        const tail = preSkippedAlreadyAtTarget.length > 20 ? '…' : '';
        console.log(
          `${LOG_PREFIX} ${preSkippedAlreadyAtTarget.length} lead(s) já no consultor de destino no CRM — omitidos do redistributeLeads. sample=${sample}${tail}`
        );
      }
    } catch (e) {
      console.warn(`${LOG_PREFIX} falha ao listar indicados do destino; enviando todos os leads ao redistributeLeads.`, e);
      preSkippedAlreadyAtTarget = [];
      crmLeadIdsToSend = crmLeadIds;
    }
  }

  const preSkippedKeySet = new Set(preSkippedAlreadyAtTarget.map((id) => leadIdMatchKey(id)));
  const leadsIdsForTransfer = force_db_only
    ? normalizedLeadIds
    : normalizedLeadIds.filter((id, idx) => {
        const crmId = crmLeadIds[idx] ?? id;
        return !preSkippedKeySet.has(leadIdMatchKey(crmId));
      });

  /** Repasse origem→mesmo destino no CRM: não há movimento possível — não registrar log nem entries. */
  if (!force_db_only && leadsIdsForTransfer.length === 0 && preSkippedAlreadyAtTarget.length > 0) {
    const n = preSkippedAlreadyAtTarget.length;
    console.log(
      `${LOG_PREFIX} transferência ignorada: ${n} lead(s) já no destino ${target_consultant_email} (origem ${source_consultant_email})`
    );
    return {
      ok: true,
      count: 0,
      crm_count: 0,
      transfer_log_id: null,
      message: `${n} lead(s) ignorado(s): já estão com o consultor de destino (${target_consultant_email}) no CRM. Nenhuma transferência foi registrada.`,
    };
  }

  console.log(
    `${LOG_PREFIX} calling CRM redistributeLeads: source=${source_consultant_email}, target=${target_consultant_email}, n=${crmLeadIdsToSend.length} total=${leadsIdsForTransfer.length} preSkipped=${preSkippedAlreadyAtTarget.length} kind=${transferKind}`
  );

  /** Objeto + propriedade mutável: evita reassignment a `let` que o Turbopack trata como const. */
  const crmLast: { r: RedistributeLeadsResponse } = {
    r: force_db_only
      ? (() => {
          console.warn(
            `${LOG_PREFIX} [FORCE_DB_ONLY] CRM skipped. source=${source_consultant_email}, target=${target_consultant_email}, leads=${normalizedLeadIds.length}`
          );
          return { success: true as const, count: normalizedLeadIds.length, message: 'force_db_only — CRM skipped by admin' };
        })()
      : await client.redistributeLeads({
            source_consultant_email,
            target_consultant_email,
            leads_ids: crmLeadIdsToSend,
          }),
  };

  console.log(`${LOG_PREFIX} CRM response: success=${crmLast.r.success}, full=${JSON.stringify(crmLast.r)}`);

  if (!crmLast.r.success) {
    const rawMessage = (crmLast.r.error ?? crmLast.r.message ?? 'Erro ao redistribuir leads no CRM').trim();
    const userMessage = rawMessage.toLowerCase() === 'consultant not found' ? 'Consultor Destino não cadastrado na banca' : rawMessage;
    return { ok: false, status: 400, error: userMessage };
  }

  const rawCrmCount =
    crmLeadIdsToSend.length === 0 ? undefined : (crmLast.r.count ?? ('data' in crmLast.r ? crmLast.r.data?.count : undefined));
  /** CRM declarou 0 leads movidos no POST (ainda pode haver leads pré-omitidos por já estarem no destino). */
  const crmExplicitZero =
    crmLeadIdsToSend.length > 0 &&
    rawCrmCount !== undefined &&
    rawCrmCount !== null &&
    String(rawCrmCount).trim() !== '' &&
    Number(rawCrmCount) === 0;

  let count: number;
  if (force_db_only) {
    count = leadsIdsForTransfer.length;
  } else if (rawCrmCount != null && Number.isFinite(Number(rawCrmCount))) {
    count = Number(rawCrmCount);
  } else {
    count = crmLeadIdsToSend.length;
  }
  if ((isDevolucao || isReverse) && leadsIdsForTransfer.length > 0 && count === 0) {
    count = leadsIdsForTransfer.length;
  }

  const skipOriginalFallback = transferKind === 'gerente_stock_to_consultant';

  if (!isDevolucao && !isReverse && !skipOriginalFallback && crmExplicitZero && crmLeadIdsToSend.length > 0) {
    const targetLow = target_consultant_email.trim().toLowerCase();
    const primaryLow = source_consultant_email.trim().toLowerCase();

    const altSources: string[] = [];
    const pushSrc = (em: string | null | undefined) => {
      const t = (em ?? '').trim();
      const low = t.toLowerCase();
      if (!low.includes('@') || low === targetLow) return;
      if (low === primaryLow) return;
      if (altSources.some((x) => x.toLowerCase() === low)) return;
      altSources.push(t);
    };

    pushSrc(original_source_consultant_email);
    if (source_transfer_log_id) {
      const fromDb = await fetchEntryEmailCandidatesForCrmSource(
        source_transfer_log_id,
        ctx.bancaId,
        normalizedLeadIds
      );
      for (const x of fromDb) pushSrc(x);
    }

    let recovered = false;
    for (const alt of altSources) {
      console.warn(`${LOG_PREFIX} CRM count=0 — tentativa origem alternativa: ${alt}`);
      const r = await client.redistributeLeads({
        source_consultant_email: alt,
        target_consultant_email,
        leads_ids: crmLeadIdsToSend,
      });
      const c = Number(r.count ?? r.data?.count ?? 0);
      if (r.success && c > 0) {
        count = c;
        source_consultant_email = alt;
        crmLast.r = r;
        recovered = true;
        break;
      }
    }

    if (!recovered) {
      if (source_transfer_log_id && crmLeadIdsToSend.length > 0) {
        const groups = await groupLeadIdsByEntryOriginalSource(source_transfer_log_id, ctx.bancaId, crmLeadIdsToSend);
        if (groups.size > 1) {
          let subtotal = 0;
          let lastOk: RedistributeLeadsResponse | null = null;
          let lastSourceUsed = source_consultant_email;
          for (const [srcEmail, ids] of groups) {
            const sl = srcEmail.trim().toLowerCase();
            if (!sl.includes('@') || sl === targetLow || ids.length === 0) continue;
            const crmIds = ids.map((id) => normalizeCrmLeadIdForRedistribute(id));
            console.warn(
              `${LOG_PREFIX} CRM count=0 — repasse segmentado por original_source: ${srcEmail} → ${target_consultant_email} (n=${crmIds.length})`
            );
            const r = await client.redistributeLeads({
              source_consultant_email: srcEmail.trim(),
              target_consultant_email,
              leads_ids: crmIds,
            });
            const c = Number(r.count ?? r.data?.count ?? 0);
            if (r.success && c > 0) {
              subtotal += c;
              lastOk = r;
              lastSourceUsed = srcEmail.trim();
            }
          }
          if (subtotal > 0) {
            count = subtotal;
            source_consultant_email = lastSourceUsed;
            if (lastOk) crmLast.r = lastOk;
            recovered = true;
          }
        }
      }
    }

    if (!recovered) {
      if (altSources.length === 0) {
        return {
          ok: false,
          status: 400,
          error: `CRM não redistribuiu nenhum lead (count=0). Verifique se o consultor de origem (${source_consultant_email}) ainda possui os leads na banca.`,
        };
      }
      let dbDiag = 'n/a';
      if (source_transfer_log_id) {
        try {
          const { data: diagEntries } = await supabaseServiceRole
            .from('admin_lead_transfer_entries')
            .select('target_consultant_email, resolution_status, original_source_consultant_email')
            .eq('transfer_log_id', source_transfer_log_id)
            .eq('banca_id', ctx.bancaId)
            .in('resolution_status', ['disponivel_retransferencia', 'pending']);
          if (diagEntries && diagEntries.length > 0) {
            const counts: Record<string, number> = {};
            for (const e of diagEntries) {
              const key = `${e.target_consultant_email ?? 'null'}|${e.resolution_status ?? 'null'}|orig=${(e as { original_source_consultant_email?: string }).original_source_consultant_email ?? 'null'}`;
              counts[key] = (counts[key] ?? 0) + 1;
            }
            dbDiag = JSON.stringify(counts);
          }
        } catch {
          /* ignore */
        }
      }
      return {
        ok: false,
        status: 409,
        error:
          'O CRM devolveu 0 leads movidos para todas as origens tentadas (titular do pacote, doador do log e e-mails nas entries). Os leads podem estar com outro consultor no CRM ou os IDs não coincidem. Confira titular no CRM ou use «Forçar registro» se o CRM já estiver correto.',
        extra: { code: 'CRM_DESYNC', diag: dbDiag, attempted_sources: [primaryLow, ...altSources.map((s) => s.toLowerCase())] },
      };
    }
  }

  if (!isDevolucao && !isReverse && skipOriginalFallback && crmExplicitZero && leadsIdsForTransfer.length > 0) {
    return {
      ok: false,
      status: 400,
      error: `CRM não redistribuiu nenhum lead (count=0). Verifique se o estoque (${source_consultant_email}) ainda possui os leads na banca.`,
    };
  }

  const refLogId = (fs?.log_origem_id ?? fs?.log_devolucao_id) != null ? String(fs?.log_origem_id ?? fs?.log_devolucao_id).trim() : null;
  type SnapshotRow = {
    lead_id: string;
    lead_email?: string | null;
    lead_name?: string | null;
    lead_phone?: string | null;
    saldo_snapshot?: number | null;
    last_interaction_snapshot?: string | null;
    total_depositado_snapshot?: number | null;
    total_apostado_snapshot?: number | null;
    total_ganho_snapshot?: number | null;
    available_withdraw_snapshot?: number | null;
    total_saque_snapshot?: number | null;
  };
  const snapshotByLeadId = new Map<string, SnapshotRow>();

  if (Array.isArray(lead_snapshots) && lead_snapshots.length > 0) {
    for (const s of lead_snapshots) {
      const id = String(s.lead_id);
      snapshotByLeadId.set(id, {
        lead_id: id,
        lead_email: normalizeLeadEmailForDb(s.email),
        lead_name: s.name ?? null,
        lead_phone: s.phone ?? null,
        saldo_snapshot: s.balance ?? null,
        last_interaction_snapshot: s.last_interaction ?? null,
        total_depositado_snapshot: s.total_depositado ?? null,
        total_apostado_snapshot: s.total_apostado ?? null,
        total_ganho_snapshot: s.total_ganho ?? null,
        available_withdraw_snapshot: s.available_withdraw ?? null,
        total_saque_snapshot:
          s.total_saque == null || s.total_saque === ''
            ? null
            : Number.isFinite(Number(s.total_saque))
              ? Number(s.total_saque)
              : null,
      });
    }
  } else if (source_transfer_log_id && ctx.bancaId) {
    const selectFullSnap =
      'lead_id, lead_email, lead_name, lead_phone, saldo_snapshot, last_interaction_snapshot, total_depositado_snapshot, total_apostado_snapshot, total_ganho_snapshot, available_withdraw_snapshot, total_saque_snapshot';
    const selectBasicSnap =
      'lead_id, saldo_snapshot, last_interaction_snapshot, total_depositado_snapshot, total_apostado_snapshot, total_ganho_snapshot, available_withdraw_snapshot, total_saque_snapshot';
    let srcResult: { data: Record<string, unknown>[] | null; error: { code?: string; message?: string } | null } =
      await supabaseServiceRole.from('admin_lead_transfer_entries').select(selectFullSnap).eq('transfer_log_id', source_transfer_log_id).eq('banca_id', ctx.bancaId);
    if (
      srcResult.error?.code === 'PGRST204' ||
      srcResult.error?.message?.includes('lead_name') ||
      srcResult.error?.message?.includes('lead_email')
    ) {
      srcResult = await supabaseServiceRole
        .from('admin_lead_transfer_entries')
        .select(selectBasicSnap)
        .eq('transfer_log_id', source_transfer_log_id)
        .eq('banca_id', ctx.bancaId);
    }
    if (Array.isArray(srcResult.data)) {
      for (const e of srcResult.data as unknown as SnapshotRow[]) {
        snapshotByLeadId.set(String(e.lead_id), e);
      }
    }
  } else if (refLogId && ctx.bancaId && (isDevolucao || isReverse)) {
    const selectFullSnap =
      'lead_id, lead_email, lead_name, lead_phone, saldo_snapshot, last_interaction_snapshot, total_depositado_snapshot, total_apostado_snapshot, total_ganho_snapshot, available_withdraw_snapshot, total_saque_snapshot';
    const selectBasicSnap =
      'lead_id, saldo_snapshot, last_interaction_snapshot, total_depositado_snapshot, total_apostado_snapshot, total_ganho_snapshot, available_withdraw_snapshot, total_saque_snapshot';
    let refResult: { data: Record<string, unknown>[] | null; error: { code?: string; message?: string } | null } =
      await supabaseServiceRole.from('admin_lead_transfer_entries').select(selectFullSnap).eq('transfer_log_id', refLogId).eq('banca_id', ctx.bancaId);
    if (
      refResult.error?.code === 'PGRST204' ||
      refResult.error?.message?.includes('lead_name') ||
      refResult.error?.message?.includes('lead_email')
    ) {
      refResult = await supabaseServiceRole.from('admin_lead_transfer_entries').select(selectBasicSnap).eq('transfer_log_id', refLogId).eq('banca_id', ctx.bancaId);
    }
    if (Array.isArray(refResult.data)) {
      for (const e of refResult.data as unknown as SnapshotRow[]) {
        snapshotByLeadId.set(String(e.lead_id), e);
      }
    }
  }

  const insertPayload: Record<string, unknown> = {
    banca_id: ctx.bancaId,
    performed_by_user_id: ctx.userId,
    source_consultant_email,
    target_consultant_email,
    leads_ids: leadsIdsForTransfer,
    count,
    transfer_type,
    deadline_days: transfer_deadline_days,
    filters_snapshot: filters_snapshot ?? null,
    crm_response: {
      ...(crmLast.r as unknown as Record<string, unknown>),
      ...(preSkippedAlreadyAtTarget.length > 0
        ? {
            skipped_already_at_target: preSkippedAlreadyAtTarget.length,
            skipped_lead_ids: preSkippedAlreadyAtTarget,
          }
        : {}),
    },
    transfer_kind: transferKind,
  };

  const { data: insertedLog, error: logError } = await supabaseServiceRole
    .from('admin_lead_transfer_logs')
    .insert(insertPayload as never)
    .select('id')
    .single();

  if (logError) {
    console.error(`${LOG_PREFIX} audit log insert error:`, logError);
    return {
      ok: false,
      status: 500,
      error: 'Transferência realizada no CRM, mas não foi possível salvar o log da transferência no banco de dados.',
    };
  }

  if (insertedLog?.id && leadsIdsForTransfer.length > 0) {
    const entries = leadsIdsForTransfer.map((leadId) => {
      const sid = String(leadId);
      const snap = snapshotByLeadId.get(sid);
      const balance = snap?.saldo_snapshot != null ? Number(snap.saldo_snapshot) : null;
      const hadBalance = (balance ?? 0) > 0;
      return {
        transfer_log_id: insertedLog.id,
        banca_id: ctx.bancaId,
        lead_id: sid,
        source_consultant_email,
        target_consultant_email,
        transfer_type,
        lead_email: normalizeLeadEmailForDb(snap?.lead_email),
        lead_name: snap?.lead_name ?? null,
        lead_phone: snap?.lead_phone ?? null,
        saldo_snapshot: balance,
        last_interaction_snapshot: snap?.last_interaction_snapshot ?? null,
        had_balance: hadBalance,
        total_depositado_snapshot: snap?.total_depositado_snapshot != null ? Number(snap.total_depositado_snapshot) : null,
        total_apostado_snapshot: snap?.total_apostado_snapshot != null ? Number(snap.total_apostado_snapshot) : null,
        total_ganho_snapshot: snap?.total_ganho_snapshot != null ? Number(snap.total_ganho_snapshot) : null,
        available_withdraw_snapshot: snap?.available_withdraw_snapshot != null ? Number(snap.available_withdraw_snapshot) : null,
        total_saque_snapshot: snap?.total_saque_snapshot != null ? Number(snap.total_saque_snapshot) : null,
      };
    });
    let { error: entriesError } = await supabaseServiceRole.from('admin_lead_transfer_entries').insert(entries);
    if (entriesError?.code === 'PGRST204' && entriesError.message?.includes('lead_email')) {
      const entriesNoEmail = entries.map(({ lead_email: _e, ...rest }) => rest);
      const retryEmail = await supabaseServiceRole.from('admin_lead_transfer_entries').insert(entriesNoEmail);
      entriesError = retryEmail.error;
    }
    if (entriesError?.code === 'PGRST204' && entriesError.message?.includes('lead_name')) {
      const entriesWithoutNamePhone = entries.map(({ lead_name: _n, lead_phone: _p, ...rest }) => rest);
      const retry = await supabaseServiceRole.from('admin_lead_transfer_entries').insert(entriesWithoutNamePhone);
      entriesError = retry.error;
    }
    if (entriesError) {
      console.error(`${LOG_PREFIX} admin_lead_transfer_entries insert error:`, entriesError);
      return {
        ok: false,
        status: 500,
        error: 'Transferência realizada no CRM, mas não foi possível salvar os leads transferidos no banco de dados.',
      };
    }
  }

  if (source_transfer_log_id && leadsIdsForTransfer.length > 0) {
    const leadIdStrings = leadsIdsForTransfer.map((id) => String(id));
    const { error: updateSourceError } = await supabaseServiceRole
      .from('admin_lead_transfer_entries')
      .update({
        resolution_status: 'repassado',
        resolved_at: new Date().toISOString(),
      })
      .eq('transfer_log_id', source_transfer_log_id)
      .eq('banca_id', ctx.bancaId)
      .in('lead_id', leadIdStrings)
      .eq('resolution_status', 'disponivel_retransferencia');
    if (updateSourceError) {
      console.warn(`${LOG_PREFIX} update source entries repassado:`, updateSourceError);
    }
  }

  const isDevolucaoLog =
    filters_snapshot != null && typeof filters_snapshot === 'object' && 'devolucao' in filters_snapshot && 'log_origem_id' in filters_snapshot;
  const logOrigemId =
    isDevolucaoLog && typeof (filters_snapshot as { log_origem_id?: string }).log_origem_id === 'string'
      ? (filters_snapshot as { log_origem_id: string }).log_origem_id.trim()
      : null;
  if (logOrigemId) {
    const devolvidoAt = new Date().toISOString();
    await supabaseServiceRole.from('admin_lead_transfer_logs').update({ devolvido_at: devolvidoAt }).eq('id', logOrigemId);
    const leadIdStrings = leadsIdsForTransfer.map((id) => String(id));
    await supabaseServiceRole
      .from('admin_lead_transfer_entries')
      .update({ resolution_status: 'devolvido', resolved_at: devolvidoAt })
      .eq('transfer_log_id', logOrigemId)
      .eq('banca_id', ctx.bancaId)
      .in('lead_id', leadIdStrings);
  }

  const isReverseLog = filters_snapshot != null && typeof filters_snapshot === 'object' && 'reverse_devolucao' in filters_snapshot;
  const logDevolucaoId =
    isReverseLog && typeof (filters_snapshot as { log_devolucao_id?: string }).log_devolucao_id === 'string'
      ? (filters_snapshot as { log_devolucao_id: string }).log_devolucao_id.trim()
      : null;
  if (logDevolucaoId) {
    const reversedAt = new Date().toISOString();
    const leadIdStrings = leadsIdsForTransfer.map((id) => String(id));
    await supabaseServiceRole
      .from('admin_lead_transfer_entries')
      .update({ resolution_status: 'reversed', resolved_at: reversedAt })
      .eq('transfer_log_id', logDevolucaoId)
      .eq('banca_id', ctx.bancaId)
      .in('lead_id', leadIdStrings);

    const fromDevolvidoAt = (filters_snapshot as { from_devolvido_at?: boolean }).from_devolvido_at;
    if (fromDevolvidoAt) {
      const { data: devLogRow } = await supabaseServiceRole
        .from('admin_lead_transfer_logs')
        .select('filters_snapshot')
        .eq('id', logDevolucaoId)
        .eq('banca_id', ctx.bancaId)
        .maybeSingle();
      const devFs = devLogRow?.filters_snapshot as Record<string, unknown> | null;
      const origLogId = devFs?.log_origem_id ? String(devFs.log_origem_id).trim() : null;
      if (origLogId) {
        await supabaseServiceRole
          .from('admin_lead_transfer_entries')
          .update({ resolution_status: null, resolved_at: null })
          .eq('transfer_log_id', origLogId)
          .eq('banca_id', ctx.bancaId)
          .in('lead_id', leadIdStrings)
          .eq('resolution_status', 'devolvido');
      }
    }
  }

  const crmReportedCount = crmLast.r.count ?? ('data' in crmLast.r ? crmLast.r.data?.count : undefined) ?? count;
  const skippedNote =
    preSkippedAlreadyAtTarget.length > 0
      ? ` ${preSkippedAlreadyAtTarget.length} lead(s) ignorado(s) por já estarem com o destino no CRM.`
      : '';
  const baseMessage = crmLast.r.message ?? `${count} lead(s) transferido(s) com sucesso.`;
  return {
    ok: true,
    count,
    crm_count: crmReportedCount,
    transfer_log_id: insertedLog?.id ?? null,
    message: `${baseMessage}${skippedNote}`.trim(),
  };
}
