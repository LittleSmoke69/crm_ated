import { NextRequest } from 'next/server';
import { requireStatus } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import {
  assertGerenteHasBanca,
  getBancaCrmBaseForTransfer,
  isConsultantDirectReportOfGerente,
} from '@/lib/server/crm/gerenteLeadStock';
import { assertLeadTransferNotLockedForBanca, isConsultantInBanca } from '@/lib/server/crm/adminLeadTransferContext';
import { createCrmRedistributionClient } from '@/lib/server/crm/crmRedistributionClient';
import { buildLeadIdSetUnderConsultant, leadIdMatchKey } from '@/lib/server/crm/crmLeadIdsForCrmApi';
import {
  getPendingStockEntriesByLeadIds,
  markStockEntriesDistributed,
} from '@/lib/server/crm/gerenteStockReservation';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { z } from 'zod';

const bodySchema = z
  .object({
    banca_id: z.string().uuid(),
    target_consultant_email: z.string().email(),
    leads_ids: z.array(z.union([z.number(), z.string()])).min(1),
  })
  .strict();

const LOG_PREFIX = '[gerente][redistribute-leads]';

/** Converte id de lead (aceita numérico-string ou número) para o formato aceito pelo CRM. */
function normalizeCrmId(id: number | string): number | string {
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

/**
 * POST /api/gerente/crm/redistribute-leads
 * Repasse do estoque lógico para um consultor da equipe (na mesma banca).
 * - Agrupa leads por original_source_consultant_email (quem tem o lead no CRM).
 * - Chama o CRM uma vez por grupo (origem→destino).
 * - Herda TF e deadline_days do pacote (admin_lead_transfer_logs do qual cada entry veio).
 * - Marca as entries como stock_status='repassado'.
 * - Grava um log agregado por origem com transfer_kind='gerente_stock_to_consultant'.
 */
export async function POST(req: NextRequest) {
  try {
    const { userId, profile } = await requireStatus(req, ['gerente']);
    const body = await req.json();
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      const msg = parsed.error?.issues?.[0]?.message ?? 'Dados inválidos.';
      return errorResponse(msg, 400);
    }

    const { banca_id, target_consultant_email, leads_ids } = parsed.data;
    const target = target_consultant_email.trim();

    await assertLeadTransferNotLockedForBanca(banca_id);

    const hasBanca = await assertGerenteHasBanca(userId, banca_id);
    if (!hasBanca) return errorResponse('Banca não disponível para o seu usuário.', 403);

    const isDirect = await isConsultantDirectReportOfGerente(userId, target);
    if (!isDirect) return errorResponse('O destino deve ser um consultor da sua equipe (cadastrado sob você).', 400);

    const targetInBanca = await isConsultantInBanca(banca_id, target);
    if (!targetInBanca) return errorResponse('Consultor destino não está na banca selecionada.', 400);

    const bancaCtx = await getBancaCrmBaseForTransfer(banca_id);
    if (!bancaCtx?.crmBaseUrl) return errorResponse('Banca sem URL de CRM configurada.', 400);

    const leadIdStrings = leads_ids.map((x) => String(x).trim()).filter(Boolean);
    const entries = await getPendingStockEntriesByLeadIds(userId, banca_id, leadIdStrings);
    if (entries.length === 0) {
      return errorResponse('Nenhum dos leads informados está em estoque para este gerente/banca.', 400);
    }

    const foundLeadIds = new Set(entries.map((e) => e.lead_id));
    const missingLeadIds = leadIdStrings.filter((id) => !foundLeadIds.has(id));

    const logIds = Array.from(new Set(entries.map((e) => e.transfer_log_id).filter(Boolean)));
    const { data: logs } = await supabaseServiceRole
      .from('admin_lead_transfer_logs')
      .select('id, transfer_type, deadline_days')
      .in('id', logIds)
      .eq('banca_id', banca_id);
    const logMeta = new Map<string, { transfer_type: string; deadline_days: number }>();
    for (const l of (logs ?? []) as Array<{ id: string; transfer_type: string | null; deadline_days: number | null }>) {
      logMeta.set(l.id, {
        transfer_type: String(l.transfer_type ?? 'TF'),
        deadline_days: Number(l.deadline_days ?? 10) || 10,
      });
    }

    type Group = {
      sourceEmail: string;
      transferType: string;
      deadlineDays: number;
      leadIds: string[];
      entryIds: string[];
      logIds: Set<string>;
    };
    const groups = new Map<string, Group>();
    for (const e of entries) {
      const src = (e.original_source_consultant_email ?? '').trim().toLowerCase();
      if (!src) continue;
      const meta = logMeta.get(e.transfer_log_id) ?? { transfer_type: 'TF', deadline_days: 10 };
      const key = `${src}|${meta.transfer_type}|${meta.deadline_days}`;
      const g = groups.get(key) ?? {
        sourceEmail: src,
        transferType: meta.transfer_type,
        deadlineDays: meta.deadline_days,
        leadIds: [],
        entryIds: [],
        logIds: new Set<string>(),
      };
      g.leadIds.push(e.lead_id);
      g.entryIds.push(e.entry_id);
      g.logIds.add(e.transfer_log_id);
      groups.set(key, g);
    }

    if (groups.size === 0) {
      return errorResponse('As reservas selecionadas não possuem consultor de origem para repassar no CRM.', 400);
    }

    const client = createCrmRedistributionClient(bancaCtx.crmBaseUrl);
    let atTargetSet: Set<string> | null = null;
    try {
      atTargetSet = await buildLeadIdSetUnderConsultant(client, target);
    } catch (e) {
      console.warn(`${LOG_PREFIX} falha ao listar indicados do destino; repasse sem filtro prévio.`, e);
    }
    const resultSummaries: Array<{
      source: string;
      transfer_type: string;
      deadline_days: number;
      crm_count: number;
      marked: number;
      transfer_log_id: string | null;
    }> = [];
    const failures: Array<{ source: string; error: string; leads: number }> = [];

    for (const group of groups.values()) {
      const sourceInBanca = await isConsultantInBanca(banca_id, group.sourceEmail);
      if (!sourceInBanca) {
        failures.push({ source: group.sourceEmail, error: 'Origem não está na banca', leads: group.leadIds.length });
        continue;
      }
      if (group.sourceEmail === target.toLowerCase()) {
        failures.push({
          source: group.sourceEmail,
          error: 'Origem e destino são o mesmo consultor',
          leads: group.leadIds.length,
        });
        continue;
      }

      let leadIdsToSend = group.leadIds;
      let entryIdsToSend = group.entryIds;
      if (atTargetSet) {
        const keptLeadIds: string[] = [];
        const keptEntryIds: string[] = [];
        for (let i = 0; i < group.leadIds.length; i += 1) {
          const lid = group.leadIds[i];
          const crmId = normalizeCrmId(lid);
          if (!atTargetSet.has(leadIdMatchKey(crmId))) {
            keptLeadIds.push(lid);
            keptEntryIds.push(group.entryIds[i]);
          }
        }
        if (keptLeadIds.length === 0) {
          console.log(
            `${LOG_PREFIX} repasse ignorado: ${group.leadIds.length} lead(s) já no destino ${target} (origem ${group.sourceEmail})`
          );
          await markStockEntriesDistributed(group.entryIds);
          continue;
        }
        leadIdsToSend = keptLeadIds;
        entryIdsToSend = keptEntryIds;
      }

      const crmLeadIds = leadIdsToSend.map((id) => normalizeCrmId(id));
      console.log(
        `${LOG_PREFIX} repasse estoque→consultor gerente=${profile.email} banca=${banca_id} src=${group.sourceEmail} dst=${target} tf=${group.transferType} prazo=${group.deadlineDays} n=${leadIdsToSend.length} skipped=${group.leadIds.length - leadIdsToSend.length}`
      );

      const crmResult = await client.redistributeLeads({
        source_consultant_email: group.sourceEmail,
        target_consultant_email: target,
        leads_ids: crmLeadIds,
      });

      if (!crmResult.success) {
        const raw = (crmResult.error ?? crmResult.message ?? 'Erro ao redistribuir no CRM').trim();
        const userMessage = raw.toLowerCase() === 'consultant not found' ? 'Consultor destino não cadastrado na banca' : raw;
        failures.push({ source: group.sourceEmail, error: userMessage, leads: group.leadIds.length });
        continue;
      }

      const crmCount =
        Number(crmResult.count ?? crmResult.data?.count ?? 0) || leadIdsToSend.length;

      const snapshotByLeadId = new Map<string, Record<string, unknown>>();
      const selectSnapWithEmail =
        'lead_id, lead_email, lead_name, lead_phone, saldo_snapshot, last_interaction_snapshot, total_depositado_snapshot, total_apostado_snapshot, total_ganho_snapshot, available_withdraw_snapshot, total_saque_snapshot';
      const selectSnapBasic =
        'lead_id, lead_name, lead_phone, saldo_snapshot, last_interaction_snapshot, total_depositado_snapshot, total_apostado_snapshot, total_ganho_snapshot, available_withdraw_snapshot, total_saque_snapshot';
      const snapFirst = await supabaseServiceRole.from('admin_lead_transfer_entries').select(selectSnapWithEmail).in('id', entryIdsToSend);
      const snapRows =
        snapFirst.error && ((snapFirst.error.message ?? '').includes('lead_email') || snapFirst.error.code === 'PGRST204')
          ? (await supabaseServiceRole.from('admin_lead_transfer_entries').select(selectSnapBasic).in('id', entryIdsToSend)).data
          : snapFirst.data;
      for (const s of (snapRows ?? []) as Array<Record<string, unknown>>) {
        snapshotByLeadId.set(String(s.lead_id), s);
      }

      const logPayload = {
        banca_id,
        performed_by_user_id: userId,
        source_consultant_email: group.sourceEmail,
        target_consultant_email: target,
        leads_ids: leadIdsToSend,
        count: crmCount,
        transfer_type: group.transferType,
        deadline_days: group.deadlineDays,
        filters_snapshot: {
          from_gerente_stock: true,
          gerente_user_id: userId,
          origin_stock_log_ids: Array.from(group.logIds),
        },
        crm_response: crmResult as unknown as Record<string, unknown>,
        transfer_kind: 'gerente_stock_to_consultant',
      };

      const { data: insertedLog, error: logError } = await supabaseServiceRole
        .from('admin_lead_transfer_logs')
        .insert(logPayload as never)
        .select('id')
        .single();

      if (logError || !insertedLog?.id) {
        console.error(`${LOG_PREFIX} erro ao inserir log repasse:`, logError);
        failures.push({ source: group.sourceEmail, error: 'Repasse no CRM feito, mas falhou ao registrar log.', leads: group.leadIds.length });
        continue;
      }

      const newEntries = leadIdsToSend.map((leadId) => {
        const snap = snapshotByLeadId.get(leadId) ?? {};
        const balance = snap.saldo_snapshot != null ? Number(snap.saldo_snapshot) : null;
        return {
          transfer_log_id: insertedLog.id,
          banca_id,
          lead_id: leadId,
          source_consultant_email: group.sourceEmail,
          target_consultant_email: target,
          transfer_type: group.transferType,
          lead_email:
            snap.lead_email != null && String(snap.lead_email).trim() !== ''
              ? String(snap.lead_email).trim().toLowerCase()
              : null,
          lead_name: snap.lead_name ?? null,
          lead_phone: snap.lead_phone ?? null,
          saldo_snapshot: balance,
          last_interaction_snapshot: snap.last_interaction_snapshot ?? null,
          had_balance: (balance ?? 0) > 0,
          total_depositado_snapshot: snap.total_depositado_snapshot != null ? Number(snap.total_depositado_snapshot) : null,
          total_apostado_snapshot: snap.total_apostado_snapshot != null ? Number(snap.total_apostado_snapshot) : null,
          total_ganho_snapshot: snap.total_ganho_snapshot != null ? Number(snap.total_ganho_snapshot) : null,
          available_withdraw_snapshot: snap.available_withdraw_snapshot != null ? Number(snap.available_withdraw_snapshot) : null,
          total_saque_snapshot: snap.total_saque_snapshot != null ? Number(snap.total_saque_snapshot) : null,
        };
      });

      let { error: entriesError } = await supabaseServiceRole.from('admin_lead_transfer_entries').insert(newEntries);
      if (entriesError?.code === 'PGRST204' && entriesError.message?.includes('lead_email')) {
        const retryE = await supabaseServiceRole
          .from('admin_lead_transfer_entries')
          .insert(newEntries.map(({ lead_email: _e, ...rest }) => rest));
        entriesError = retryE.error;
      }
      if (entriesError?.code === 'PGRST204' && entriesError.message?.includes('lead_name')) {
        const retry = await supabaseServiceRole
          .from('admin_lead_transfer_entries')
          .insert(newEntries.map(({ lead_name: _n, lead_phone: _p, ...rest }) => rest));
        entriesError = retry.error;
      }
      if (entriesError) {
        console.error(`${LOG_PREFIX} erro ao inserir entries repasse:`, entriesError);
      }

      const skippedEntryIds = group.entryIds.filter((id) => !entryIdsToSend.includes(id));
      if (skippedEntryIds.length > 0) {
        await markStockEntriesDistributed(skippedEntryIds);
      }
      const marked = await markStockEntriesDistributed(entryIdsToSend);
      if (!marked) {
        console.warn(`${LOG_PREFIX} falha ao marcar entries como repassado (source=${group.sourceEmail}).`);
      }

      resultSummaries.push({
        source: group.sourceEmail,
        transfer_type: group.transferType,
        deadline_days: group.deadlineDays,
        crm_count: crmCount,
        marked: entryIdsToSend.length + skippedEntryIds.length,
        transfer_log_id: insertedLog.id,
      });
    }

    const totalSuccessCount = resultSummaries.reduce((acc, r) => acc + r.crm_count, 0);

    if (resultSummaries.length === 0) {
      return errorResponse(
        failures[0]?.error ?? 'Não foi possível repassar os leads selecionados.',
        400,
        { failures }
      );
    }

    return successResponse(
      {
        count: totalSuccessCount,
        groups: resultSummaries,
        failures,
        missing_lead_ids: missingLeadIds,
        target_consultant_email: target,
      },
      failures.length === 0
        ? `${totalSuccessCount} lead(s) repassado(s) para ${target}.`
        : `${totalSuccessCount} lead(s) repassado(s); ${failures.reduce((a, f) => a + f.leads, 0)} com falhas (veja detalhes).`
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (
      message.includes('Acesso negado') ||
      message.includes('não tem permissão') ||
      message.includes('bloqueada para transferência')
    ) {
      return errorResponse(message, 403);
    }
    if (message.includes('CRM_API_KEY')) return errorResponse('Configuração do servidor incompleta.', 503);
    console.error(`${LOG_PREFIX} error:`, err);
    return serverErrorResponse(err);
  }
}
