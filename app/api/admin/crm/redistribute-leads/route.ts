import { NextRequest } from 'next/server';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { requireAdminLeadTransferContext, isConsultantInBanca } from '@/lib/server/crm/adminLeadTransferContext';
import { createCrmRedistributionClient } from '@/lib/server/crm/crmRedistributionClient';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { z } from 'zod';

const transferTypeEnum = z.enum(['TF', 'TF1', 'TF2', 'TF3']);

const leadSnapshotSchema = z.object({
  lead_id: z.union([z.number(), z.string()]),
  name: z.union([z.string(), z.null()]).optional(),
  phone: z.union([z.string(), z.null()]).optional(),
  balance: z.union([z.number(), z.null()]).optional(),
  last_interaction: z.union([z.string(), z.null()]).optional(),
  total_depositado: z.union([z.number(), z.null()]).optional(),
  total_apostado: z.union([z.number(), z.null()]).optional(),
  total_ganho: z.union([z.number(), z.null()]).optional(),
  available_withdraw: z.union([z.number(), z.null()]).optional(),
  total_saque: z.union([z.number(), z.null()]).optional(),
});
const bodySchema = z.object({
  banca_id: z.string().uuid(),
  source_consultant_email: z.string().email(),
  target_consultant_email: z.string().email(),
  /** Pode vir vazio em devolução/reverse; o backend preenche das entries quando filters_snapshot tem log_origem_id ou log_devolucao_id */
  leads_ids: z.array(z.union([z.number(), z.string()])).default([]),
  transfer_type: transferTypeEnum.optional().default('TF'),
  /** Prazo em dias para conversão (definido pelo usuário no passo Destino). */
  transfer_deadline_days: z.number().int().min(1).max(365).optional().default(10),
  filters_snapshot: z.record(z.string(), z.unknown()).optional(),
  lead_snapshots: z.array(leadSnapshotSchema).optional(),
  /** ID do log de origem (ao mover do modal Mover leads). Marca entries como repassado para removê-las da lista. */
  source_transfer_log_id: z.string().uuid().optional(),
}).refine(
  (data) => data.source_consultant_email.toLowerCase() !== data.target_consultant_email.toLowerCase(),
  { message: 'Consultor origem e destino devem ser diferentes.', path: ['target_consultant_email'] }
);

const LOG_PREFIX = '[lead-transfer][redistribute-leads]';

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
  const payload = JSON.stringify({
    source_consultant_email: params.sourceConsultantEmail,
    target_consultant_email: params.targetConsultantEmail,
    leads_ids: params.leadIds,
  }, null, 2);

  return [
    `curl -X POST "${baseUrl}/api/crm/redistribute-leads" \\`,
    `  -H "x-api-key: $CRM_API_KEY" \\`,
    `  -H "Accept: application/json" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '${payload}'`,
  ].join('\n');
}

/**
 * POST /api/admin/crm/redistribute-leads
 * Proxy para CRM: redistribuir leads de um consultor para outro.
 * Body: banca_id, source_consultant_email, target_consultant_email, leads_ids
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    console.log(`${LOG_PREFIX} POST request body:`, {
      banca_id: body?.banca_id,
      source_consultant_email: body?.source_consultant_email,
      target_consultant_email: body?.target_consultant_email,
      leads_ids_count: Array.isArray(body?.leads_ids) ? body.leads_ids.length : 0,
      leads_ids: Array.isArray(body?.leads_ids) ? body.leads_ids : body?.leads_ids,
    });

    const parsed = bodySchema.safeParse(body);

    if (!parsed.success) {
      const issues = parsed.error?.issues ?? [];
      const firstError = issues[0];
      const msg = firstError?.message ?? 'Dados inválidos. Verifique banca_id, emails e leads_ids.';
      console.log(`${LOG_PREFIX} POST validation failed (400):`, JSON.stringify(issues, null, 2));
      return errorResponse(msg, 400);
    }

    let { banca_id, source_consultant_email, target_consultant_email, leads_ids, transfer_type, transfer_deadline_days, filters_snapshot, lead_snapshots, source_transfer_log_id } = parsed.data;
    const ctx = await requireAdminLeadTransferContext(req, banca_id);
    console.log(`${LOG_PREFIX} POST context: userId=${ctx.userId}, bancaId=${ctx.bancaId}, crmBaseUrl=${ctx.crmBaseUrl}, bancaName=${ctx.bancaName ?? 'n/a'}`);

    // Fallback: em devolução/reverse, se leads_ids vier vazio, buscar IDs do log referenciado (entries ou leads_ids do próprio log)
    const fs = filters_snapshot != null && typeof filters_snapshot === 'object' ? filters_snapshot as Record<string, unknown> : null;
    const logIdForEntries = (fs?.log_origem_id ?? fs?.log_devolucao_id) != null ? String(fs?.log_origem_id ?? fs?.log_devolucao_id).trim() : null;
    if ((!leads_ids || leads_ids.length === 0) && logIdForEntries && ctx.bancaId) {
      const { data: entries } = await supabaseServiceRole
        .from('admin_lead_transfer_entries')
        .select('lead_id')
        .eq('transfer_log_id', logIdForEntries)
        .eq('banca_id', ctx.bancaId);
      let fromEntries = Array.isArray(entries) ? entries.map((e: { lead_id?: string }) => e?.lead_id).filter(Boolean) as string[] : [];
      if (fromEntries.length > 0) {
        leads_ids = fromEntries;
        console.log(`${LOG_PREFIX} POST leads_ids preenchido a partir de admin_lead_transfer_entries: log_id=${logIdForEntries}, count=${fromEntries.length}`);
      } else {
        const { data: logRow } = await supabaseServiceRole
          .from('admin_lead_transfer_logs')
          .select('leads_ids')
          .eq('id', logIdForEntries)
          .eq('banca_id', ctx.bancaId)
          .maybeSingle();
        const fromLog = Array.isArray((logRow as { leads_ids?: unknown[] })?.leads_ids)
          ? (logRow as { leads_ids: (string | number)[] }).leads_ids.filter((id) => id != null && String(id).trim() !== '')
          : [];
        if (fromLog.length > 0) {
          leads_ids = fromLog;
          console.log(`${LOG_PREFIX} POST leads_ids preenchido a partir de admin_lead_transfer_logs.leads_ids: log_id=${logIdForEntries}, count=${fromLog.length}`);
        }
      }
    }

    const normalizedLeadIds = (leads_ids || []).map((id) => {
      if (typeof id === 'number' && Number.isFinite(id)) return id;
      const s = String(id).trim();
      const n = Number(s);
      return s !== '' && Number.isFinite(n) ? n : s;
    });
    if (normalizedLeadIds.length === 0) {
      return errorResponse('Nenhum lead_id válido para transferir. Informe leads_ids ou use um log que possua entries.', 400);
    }

    const isDevolucao = fs != null && 'devolucao' in fs && 'log_origem_id' in fs;
    const isReverse = fs != null && 'reverse_devolucao' in fs;
    if (isDevolucao) {
      console.log(`${LOG_PREFIX} POST [DEVOLUÇÃO] Atribuindo ${normalizedLeadIds.length} lead(s) ao consultor ORIGEM (doador): target_consultant_email=${target_consultant_email} (quem recebe os leads de volta). IDs (amostra): ${JSON.stringify(normalizedLeadIds.slice(0, 10))}`);
    }
    if (isReverse) {
      console.log(`${LOG_PREFIX} POST [REVERSE] Atribuindo ${normalizedLeadIds.length} lead(s) ao consultor DESTINO: target_consultant_email=${target_consultant_email}. IDs (amostra): ${JSON.stringify(normalizedLeadIds.slice(0, 10))}`);
    }

    const curlForVerification = buildRedistributeCurlLog({
      crmBaseUrl: ctx.crmBaseUrl,
      sourceConsultantEmail: source_consultant_email,
      targetConsultantEmail: target_consultant_email,
      leadIds: normalizedLeadIds,
    });
    console.log(`${LOG_PREFIX} POST CRM cURL (verificação):\n${curlForVerification}`);

    const [sourceInBanca, targetInBanca] = await Promise.all([
      isConsultantInBanca(ctx.bancaId, source_consultant_email),
      isConsultantInBanca(ctx.bancaId, target_consultant_email),
    ]);

    if (!sourceInBanca) {
      console.log(`${LOG_PREFIX} POST source consultant not in banca (400): source_consultant_email=${source_consultant_email}, bancaId=${ctx.bancaId}`);
      return errorResponse('Consultor origem não pertence à banca selecionada.', 400);
    }
    if (!targetInBanca) {
      console.log(`${LOG_PREFIX} POST target consultant not in banca (400): target_consultant_email=${target_consultant_email}, bancaId=${ctx.bancaId}`);
      return errorResponse('Consultor destino não pertence à banca selecionada.', 400);
    }

    console.log(`${LOG_PREFIX} POST calling CRM redistributeLeads: source=${source_consultant_email}, target=${target_consultant_email}, leads_ids=${normalizedLeadIds.length} items (sample: ${JSON.stringify(normalizedLeadIds.slice(0, 5))})`);
    const client = createCrmRedistributionClient(ctx.crmBaseUrl);
    const result = await client.redistributeLeads({
      source_consultant_email,
      target_consultant_email,
      leads_ids: normalizedLeadIds,
    });

    console.log(`${LOG_PREFIX} POST CRM response: success=${result.success}, count=${result.count ?? result.data?.count ?? 'n/a'}, message=${result.message ?? 'n/a'}, fullResult=${JSON.stringify(result)}`);

    if (!result.success) {
      console.log(`${LOG_PREFIX} POST CRM error (400):`, { error: result.error, message: result.message, fullResult: result });
      const rawMessage = (result.error ?? result.message ?? 'Erro ao redistribuir leads no CRM').trim();
      const userMessage = rawMessage.toLowerCase() === 'consultant not found'
        ? 'Consultor Destino não cadastrado na banca'
        : rawMessage;
      return errorResponse(userMessage, 400);
    }

    let count = result.count ?? result.data?.count ?? normalizedLeadIds.length;
    if ((isDevolucao || isReverse) && normalizedLeadIds.length > 0 && (count == null || Number(count) === 0)) {
      count = normalizedLeadIds.length;
    }
    console.log(`${LOG_PREFIX} POST CRM success: count=${count}, message=${result.message ?? 'n/a'}`);

    // Se o CRM retornou success=true mas count=0 numa transferência normal (não devolução/reverse)
    // com leads enviados, os leads NÃO foram movidos no CRM. Retorna erro para evitar inconsistência.
    if (!isDevolucao && !isReverse && Number(count) === 0 && normalizedLeadIds.length > 0) {
      console.warn(`${LOG_PREFIX} POST CRM count=0 com ${normalizedLeadIds.length} leads enviados — transferência ignorada para preservar integridade.`);
      return errorResponse(
        `CRM não redistribuiu nenhum lead (count=0). Os leads não foram movidos. Verifique se o consultor de origem ainda possui os leads na banca.`,
        400
      );
    }

    // Para devolução/reverse: buscar snapshots das entries existentes (mesma lógica da transferência normal)
    const refLogId = (fs?.log_origem_id ?? fs?.log_devolucao_id) != null ? String(fs?.log_origem_id ?? fs?.log_devolucao_id).trim() : null;
    type SnapshotRow = { lead_id: string; lead_name?: string | null; lead_phone?: string | null; saldo_snapshot?: number | null; last_interaction_snapshot?: string | null; total_depositado_snapshot?: number | null; total_apostado_snapshot?: number | null; total_ganho_snapshot?: number | null; available_withdraw_snapshot?: number | null; total_saque_snapshot?: number | null };
    const snapshotByLeadId = new Map<string, SnapshotRow>();

    if (Array.isArray(lead_snapshots) && lead_snapshots.length > 0) {
      for (const s of lead_snapshots) {
        const id = String(s.lead_id);
        snapshotByLeadId.set(id, {
          lead_id: id,
          lead_name: s.name ?? null,
          lead_phone: s.phone ?? null,
          saldo_snapshot: s.balance ?? null,
          last_interaction_snapshot: s.last_interaction ?? null,
          total_depositado_snapshot: s.total_depositado ?? null,
          total_apostado_snapshot: s.total_apostado ?? null,
          total_ganho_snapshot: s.total_ganho ?? null,
          available_withdraw_snapshot: s.available_withdraw ?? null,
          total_saque_snapshot: s.total_saque ?? null,
        });
      }
    } else if (source_transfer_log_id && ctx.bancaId) {
      const selectFullSnap = 'lead_id, lead_name, lead_phone, saldo_snapshot, last_interaction_snapshot, total_depositado_snapshot, total_apostado_snapshot, total_ganho_snapshot, available_withdraw_snapshot, total_saque_snapshot';
      const selectBasicSnap = 'lead_id, saldo_snapshot, last_interaction_snapshot, total_depositado_snapshot, total_apostado_snapshot, total_ganho_snapshot, available_withdraw_snapshot, total_saque_snapshot';
      let srcResult: { data: Record<string, unknown>[] | null; error: { code?: string; message?: string } | null } = await supabaseServiceRole
        .from('admin_lead_transfer_entries')
        .select(selectFullSnap)
        .eq('transfer_log_id', source_transfer_log_id)
        .eq('banca_id', ctx.bancaId);
      if (srcResult.error?.code === 'PGRST204' || srcResult.error?.message?.includes('lead_name')) {
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
        console.log(`${LOG_PREFIX} POST snapshots copiados de entries originais (Mover leads): log=${source_transfer_log_id}, count=${srcResult.data.length}`);
      }
    } else if (refLogId && ctx.bancaId && (isDevolucao || isReverse)) {
      const selectFullSnap = 'lead_id, lead_name, lead_phone, saldo_snapshot, last_interaction_snapshot, total_depositado_snapshot, total_apostado_snapshot, total_ganho_snapshot, available_withdraw_snapshot, total_saque_snapshot';
      const selectBasicSnap = 'lead_id, saldo_snapshot, last_interaction_snapshot, total_depositado_snapshot, total_apostado_snapshot, total_ganho_snapshot, available_withdraw_snapshot, total_saque_snapshot';
      let refResult: { data: Record<string, unknown>[] | null; error: { code?: string; message?: string } | null } = await supabaseServiceRole
        .from('admin_lead_transfer_entries')
        .select(selectFullSnap)
        .eq('transfer_log_id', refLogId)
        .eq('banca_id', ctx.bancaId);
      if (refResult.error?.code === 'PGRST204' || refResult.error?.message?.includes('lead_name')) {
        refResult = await supabaseServiceRole
          .from('admin_lead_transfer_entries')
          .select(selectBasicSnap)
          .eq('transfer_log_id', refLogId)
          .eq('banca_id', ctx.bancaId);
      }
      if (Array.isArray(refResult.data)) {
        for (const e of refResult.data as unknown as SnapshotRow[]) {
          snapshotByLeadId.set(String(e.lead_id), e);
        }
        console.log(`${LOG_PREFIX} POST snapshots copiados de entries existentes: log=${refLogId}, count=${refResult.data.length}`);
      }
    }

    const { data: insertedLog, error: logError } = await supabaseServiceRole
      .from('admin_lead_transfer_logs')
      .insert({
        banca_id: ctx.bancaId,
        performed_by_user_id: ctx.userId,
        source_consultant_email,
        target_consultant_email,
        leads_ids: normalizedLeadIds,
        count,
        transfer_type,
        deadline_days: transfer_deadline_days,
        filters_snapshot: filters_snapshot ?? null,
        crm_response: result as unknown as Record<string, unknown>,
      })
      .select('id')
      .single();

    if (logError) {
      console.error(`${LOG_PREFIX} POST audit log insert error:`, logError);
      return errorResponse(
        'Transferência realizada no CRM, mas não foi possível salvar o log da transferência no banco de dados.',
        500
      );
    }

    console.log(`${LOG_PREFIX} POST audit log inserted: banca_id=${ctx.bancaId}, performed_by=${ctx.userId}, count=${count}`);
    if (insertedLog?.id && normalizedLeadIds.length > 0) {
      const entries = normalizedLeadIds.map((leadId) => {
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
      let { error: entriesError } = await supabaseServiceRole
        .from('admin_lead_transfer_entries')
        .insert(entries);
      if (entriesError?.code === 'PGRST204' && entriesError.message?.includes('lead_name')) {
        const entriesWithoutNamePhone = entries.map(({ lead_name: _n, lead_phone: _p, ...rest }) => rest);
        const retry = await supabaseServiceRole.from('admin_lead_transfer_entries').insert(entriesWithoutNamePhone);
        entriesError = retry.error;
        if (!entriesError) console.log(`${LOG_PREFIX} POST entries inserted without lead_name/lead_phone (migration pending)`);
      }
      if (entriesError) {
        console.error(`${LOG_PREFIX} POST admin_lead_transfer_entries insert error:`, entriesError);
        return errorResponse(
          'Transferência realizada no CRM, mas não foi possível salvar os leads transferidos no banco de dados.',
          500
        );
      } else {
        const tipo = isDevolucao ? 'devolução' : isReverse ? 'reverse' : 'transferência';
        console.log(`${LOG_PREFIX} POST admin_lead_transfer_entries inserted: ${entries.length} row(s) com snapshots — ${tipo}`);
      }
    }

    // Marca as entries da transferência de origem como 'repassado' (remove da lista Mover leads)
    if (source_transfer_log_id && normalizedLeadIds.length > 0) {
      const leadIdStrings = normalizedLeadIds.map((id) => String(id));
      const { error: updateSourceError, count: updatedCount } = await supabaseServiceRole
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
        console.warn(`${LOG_PREFIX} POST update source entries to repassado (optional):`, updateSourceError);
      } else {
        console.log(`${LOG_PREFIX} POST source entries marked repassado: log=${source_transfer_log_id}, count=${leadIdStrings.length}`);
      }
    }

    const isDevolucaoLog = filters_snapshot != null && typeof filters_snapshot === 'object' && 'devolucao' in filters_snapshot && 'log_origem_id' in filters_snapshot;
    const logOrigemId = isDevolucaoLog && typeof (filters_snapshot as { log_origem_id?: string }).log_origem_id === 'string' ? (filters_snapshot as { log_origem_id: string }).log_origem_id.trim() : null;
    if (logOrigemId) {
      const devolvidoAt = new Date().toISOString();
      const { error: updateDevolvidoError } = await supabaseServiceRole
        .from('admin_lead_transfer_logs')
        .update({ devolvido_at: devolvidoAt })
        .eq('id', logOrigemId);
      if (updateDevolvidoError) {
        console.error(`${LOG_PREFIX} POST update devolvido_at on origin log:`, updateDevolvidoError);
      } else {
        console.log(`${LOG_PREFIX} POST origin log ${logOrigemId} marked as devolvido_at=${devolvidoAt}`);
      }

      // Marcar entries da transferência original como 'devolvido' para que não apareçam no CRM transferido do consultor destino antigo
      const leadIdStrings = normalizedLeadIds.map((id) => String(id));
      const { error: updateOrigEntriesErr, count: updatedOrigEntries } = await supabaseServiceRole
        .from('admin_lead_transfer_entries')
        .update({ resolution_status: 'devolvido', resolved_at: devolvidoAt })
        .eq('transfer_log_id', logOrigemId)
        .eq('banca_id', ctx.bancaId)
        .in('lead_id', leadIdStrings);
      if (updateOrigEntriesErr) {
        console.warn(`${LOG_PREFIX} POST update original entries to devolvido:`, updateOrigEntriesErr);
      } else {
        console.log(`${LOG_PREFIX} POST original entries marked devolvido: log=${logOrigemId}, count=${updatedOrigEntries ?? leadIdStrings.length}`);
      }
    }

    // Reverse: marcar entries da devolução como 'reversed' para que não apareçam no CRM transferido do doador original
    const isReverseLog = filters_snapshot != null && typeof filters_snapshot === 'object' && 'reverse_devolucao' in filters_snapshot;
    const logDevolucaoId = isReverseLog && typeof (filters_snapshot as { log_devolucao_id?: string }).log_devolucao_id === 'string' ? (filters_snapshot as { log_devolucao_id: string }).log_devolucao_id.trim() : null;
    if (logDevolucaoId) {
      const reversedAt = new Date().toISOString();
      const leadIdStrings = normalizedLeadIds.map((id) => String(id));
      const { error: updateDevEntriesErr, count: updatedDevEntries } = await supabaseServiceRole
        .from('admin_lead_transfer_entries')
        .update({ resolution_status: 'reversed', resolved_at: reversedAt })
        .eq('transfer_log_id', logDevolucaoId)
        .eq('banca_id', ctx.bancaId)
        .in('lead_id', leadIdStrings);
      if (updateDevEntriesErr) {
        console.warn(`${LOG_PREFIX} POST update devolução entries to reversed:`, updateDevEntriesErr);
      } else {
        console.log(`${LOG_PREFIX} POST devolução entries marked reversed: log=${logDevolucaoId}, count=${updatedDevEntries ?? leadIdStrings.length}`);
      }

      // Também "reativar" as entries originais (que foram marcadas como 'devolvido') para que voltem ao CRM do consultor destino
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
          const { error: reactivateErr, count: reactivatedCount } = await supabaseServiceRole
            .from('admin_lead_transfer_entries')
            .update({ resolution_status: null, resolved_at: null })
            .eq('transfer_log_id', origLogId)
            .eq('banca_id', ctx.bancaId)
            .in('lead_id', leadIdStrings)
            .eq('resolution_status', 'devolvido');
          if (reactivateErr) {
            console.warn(`${LOG_PREFIX} POST reactivate original entries after reverse:`, reactivateErr);
          } else {
            console.log(`${LOG_PREFIX} POST original entries reactivated (devolvido→null): log=${origLogId}, count=${reactivatedCount ?? leadIdStrings.length}`);
          }
        }
      }
    }

    const crmReportedCount = result.count ?? result.data?.count ?? count;
    return successResponse(
      {
        count,
        crm_count: crmReportedCount,
        transfer_log_id: insertedLog?.id ?? null,
        message: result.message ?? `${count} lead(s) transferido(s) com sucesso.`,
      },
      result.message ?? `${count} lead(s) transferido(s) com sucesso.`
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('não tem permissão') || message.includes('obrigatório')) {
      return errorResponse(message, 403);
    }
    if (message.includes('CRM_API_KEY')) {
      return errorResponse('Configuração do servidor incompleta. Entre em contato com o suporte.', 503);
    }
    console.error(`${LOG_PREFIX} POST error:`, { message, stack: err instanceof Error ? err.stack : undefined, err });
    return serverErrorResponse(err);
  }
}
