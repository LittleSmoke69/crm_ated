import { NextRequest } from 'next/server';
import { requireLeadTransferApiAccess } from '@/lib/middleware/permissions';
import {
  ApiHttpError,
  successResponse,
  errorResponse,
  serverErrorResponse,
} from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { getLeadTransferBancaAccess, gerenteLeadTransferOwnActionsOnly } from '@/lib/server/crm/adminLeadTransferContext';
import { createCrmRedistributionClient } from '@/lib/server/crm/crmRedistributionClient';

const LOG_PREFIX = '[admin][transfer-logs-entries]';

/** Dados do lead vindos do CRM (quando disponível) */
export type EntryLeadDetail = {
  name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  status?: string | null;
  temperature?: string | null;
  total_depositado?: number | null;
  total_apostado?: number | null;
  total_ganho?: number | null;
  created_at?: string | null;
};

/**
 * GET /api/admin/crm/transfer-logs/entries
 * Retorna as entries (leads) de um log de transferência para exibir no modal.
 * Enriquece com nome, telefone, email etc. do CRM (consultor destino).
 * Query: log_id (obrigatório), banca_id (obrigatório)
 */
export async function GET(req: NextRequest) {
  try {
    const { userId, profile } = await requireLeadTransferApiAccess(req);
    const { searchParams } = req.nextUrl;

    const logId = searchParams.get('log_id')?.trim() || null;
    const bancaId = searchParams.get('banca_id')?.trim() || null;

    if (!logId || !bancaId) {
      return errorResponse('log_id e banca_id são obrigatórios.');
    }

    const resolved = await getLeadTransferBancaAccess(userId, profile, bancaId);
    if (!resolved) {
      return errorResponse('Banca não encontrada ou sem permissão.');
    }

    if (gerenteLeadTransferOwnActionsOnly(profile)) {
      const { data: logMeta, error: logMetaErr } = await supabaseServiceRole
        .from('admin_lead_transfer_logs')
        .select('performed_by_user_id')
        .eq('id', logId)
        .maybeSingle();
      if (logMetaErr || !logMeta) {
        return errorResponse('Pacote de transferência não encontrado.', 404);
      }
      if ((logMeta as { performed_by_user_id?: string | null }).performed_by_user_id !== userId) {
        return errorResponse('Sem permissão para este pacote de transferência.', 403);
      }
    }

    const entryColumnsFull =
      'lead_id, had_balance, saldo_snapshot, source_consultant_email, target_consultant_email, transfer_type, total_depositado_snapshot, total_apostado_snapshot, total_ganho_snapshot, available_withdraw_snapshot, resolution_status, resolved_at, current_total_depositado_at_resolution, current_total_apostado_at_resolution, lead_name, lead_email, lead_phone, last_interaction_snapshot, total_saque_snapshot';

    let { data: entries, error } = await supabaseServiceRole
      .from('admin_lead_transfer_entries')
      .select(entryColumnsFull)
      .eq('banca_id', resolved.bancaId)
      .eq('transfer_log_id', logId)
      .order('lead_id', { ascending: true });

    if (
      error?.code === 'PGRST204' ||
      (error?.message ?? '').includes('lead_name') ||
      (error?.message ?? '').includes('lead_email')
    ) {
      const retry = await supabaseServiceRole
        .from('admin_lead_transfer_entries')
        .select(
          'lead_id, had_balance, saldo_snapshot, source_consultant_email, target_consultant_email, transfer_type, total_depositado_snapshot, total_apostado_snapshot, total_ganho_snapshot, available_withdraw_snapshot, resolution_status, resolved_at, current_total_depositado_at_resolution, current_total_apostado_at_resolution'
        )
        .eq('banca_id', resolved.bancaId)
        .eq('transfer_log_id', logId)
        .order('lead_id', { ascending: true });
      entries = retry.data as unknown as typeof entries;
      error = retry.error;
    }

    if (error) {
      console.error(`${LOG_PREFIX} GET error:`, error);
      return errorResponse('Erro ao buscar leads da transferência.');
    }

    let rawList: unknown[] = Array.isArray(entries) ? entries : [];

    /**
     * Compatibilidade com dados inconsistentes:
     * - `resolved-list` conta disponibilidade apenas por `transfer_log_id`
     * - alguns admins podem ter `admin_lead_transfer_entries.banca_id` divergente do log
     *
     * Para esses casos, a query restrita por banca_id devolve lista vazia e o modal mostra 0.
     * Fazemos fallback consultando apenas por `transfer_log_id`.
     */
    if (rawList.length === 0) {
      const { data: entriesByLogOnly, error: entriesByLogOnlyErr } = await supabaseServiceRole
        .from('admin_lead_transfer_entries')
        .select(entryColumnsFull)
        .eq('transfer_log_id', logId)
        .order('lead_id', { ascending: true });

      if (
        entriesByLogOnlyErr?.code === 'PGRST204' ||
        (entriesByLogOnlyErr?.message ?? '').includes('lead_name')
      ) {
        const r2 = await supabaseServiceRole
          .from('admin_lead_transfer_entries')
          .select(
            'lead_id, had_balance, saldo_snapshot, source_consultant_email, target_consultant_email, transfer_type, total_depositado_snapshot, total_apostado_snapshot, total_ganho_snapshot, available_withdraw_snapshot, resolution_status, resolved_at, current_total_depositado_at_resolution, current_total_apostado_at_resolution'
          )
          .eq('transfer_log_id', logId)
          .order('lead_id', { ascending: true });
        rawList = Array.isArray(r2.data) ? r2.data : [];
      } else if (entriesByLogOnlyErr) {
        console.error(`${LOG_PREFIX} Fallback query (entries by log only) error:`, entriesByLogOnlyErr);
      } else {
        rawList = Array.isArray(entriesByLogOnly) ? entriesByLogOnly : [];
      }
    }

    // Backfill: transferências antigas/expiradas podem ter apenas o log (leads_ids) sem entries; cria entries a partir do log.
    if (rawList.length === 0) {
      const { data: logRow, error: logError } = await supabaseServiceRole
        .from('admin_lead_transfer_logs')
        .select('id, banca_id, source_consultant_email, target_consultant_email, leads_ids, transfer_type')
        .eq('id', logId)
        .single();

      if (!logError && logRow) {
        const leadsIds = logRow.leads_ids;
        const sourceEmail = (logRow as { source_consultant_email?: string }).source_consultant_email ?? '';
        const targetEmail = (logRow as { target_consultant_email?: string }).target_consultant_email ?? '';
        const transferType = ((logRow as { transfer_type?: string }).transfer_type ?? 'TF').trim();
        const validType = ['TF', 'TF1', 'TF2', 'TF3'].includes(transferType) ? transferType : 'TF';

        const ids: string[] = Array.isArray(leadsIds)
          ? leadsIds.map((id: unknown) => (id != null ? String(id).trim() : '')).filter(Boolean)
          : [];
        if (ids.length > 0 && sourceEmail && targetEmail) {
          const insertRows = ids.map((leadId) => ({
            transfer_log_id: logId,
            banca_id: resolved.bancaId,
            lead_id: leadId,
            source_consultant_email: sourceEmail,
            target_consultant_email: targetEmail,
            transfer_type: validType,
          }));
          const { error: insertError } = await supabaseServiceRole
            .from('admin_lead_transfer_entries')
            .insert(insertRows);
          if (insertError) {
            console.warn(`${LOG_PREFIX} Backfill entries from log failed:`, insertError.message);
          } else {
            const { data: entriesAfter } = await supabaseServiceRole
              .from('admin_lead_transfer_entries')
              .select('lead_id, had_balance, saldo_snapshot, source_consultant_email, target_consultant_email, transfer_type, total_depositado_snapshot, total_apostado_snapshot, total_ganho_snapshot, available_withdraw_snapshot, resolution_status, resolved_at, current_total_depositado_at_resolution, current_total_apostado_at_resolution')
              .eq('banca_id', resolved.bancaId)
              .eq('transfer_log_id', logId)
              .order('lead_id', { ascending: true });
            rawList = Array.isArray(entriesAfter) ? entriesAfter : [];
          }
        }
      }
    }
    const targetEmail = (rawList[0] as { target_consultant_email?: string | null } | undefined)?.target_consultant_email?.trim();
    const detailByLeadId = new Map<string, EntryLeadDetail>();

    if (targetEmail && resolved.crmBaseUrl) {
      try {
        const client = createCrmRedistributionClient(resolved.crmBaseUrl);
        const result = await client.getIndicatedsByConsultant(targetEmail, 2000, 1, {
          transferredFilter: 'yes',
          sort: 'created_at',
          direction: 'desc',
        });
        const details = Array.isArray(result.data) ? result.data : [];
        for (const d of details) {
          const id = d?.id != null ? String(d.id) : '';
          if (!id) continue;
          detailByLeadId.set(id, {
            name: d.name ?? null,
            last_name: d.last_name ?? null,
            email: d.email ?? null,
            phone: d.phone ?? d.whatsapp ?? null,
            whatsapp: d.whatsapp ?? null,
            status: d.status ?? null,
            temperature: d.temperature ?? null,
            total_depositado: d.total_depositado != null ? Number(d.total_depositado) : null,
            total_apostado: d.total_apostado != null ? Number(d.total_apostado) : null,
            total_ganho: d.total_ganho != null ? Number(d.total_ganho) : null,
            created_at: d.created_at ?? null,
          });
        }
      } catch (err) {
        console.warn(`${LOG_PREFIX} CRM enrichment failed (modal mostra dados do DB; sem saldo/atualização do CRM):`, err);
      }
    }

    type EntryRow = {
      lead_id: string | number;
      had_balance?: boolean;
      saldo_snapshot?: number | null;
      source_consultant_email?: string | null;
      target_consultant_email?: string | null;
      transfer_type?: string | null;
      total_depositado_snapshot?: number | null;
      total_apostado_snapshot?: number | null;
      total_ganho_snapshot?: number | null;
      available_withdraw_snapshot?: number | null;
      resolution_status?: string | null;
      resolved_at?: string | null;
      current_total_depositado_at_resolution?: number | null;
      current_total_apostado_at_resolution?: number | null;
      lead_name?: string | null;
      lead_email?: string | null;
      lead_phone?: string | null;
      last_interaction_snapshot?: string | null;
      total_saque_snapshot?: number | null;
    };
    const list = (rawList as EntryRow[]).map((e: EntryRow) => {
      const leadId = String(e.lead_id ?? '');
      let detail = detailByLeadId.get(leadId) ?? {};
      if (!detail.name && !detail.email && leadId.includes('-')) {
        const tail = leadId.split('-').pop() ?? '';
        if (tail && tail !== leadId) {
          const alt = detailByLeadId.get(tail);
          if (alt && (alt.name || alt.email)) detail = alt;
        }
      }
      const dbLeadName = (e.lead_name ?? '').trim();
      const dbEmail = (e.lead_email ?? '').trim();
      const dbPhone = (e.lead_phone ?? '').trim();
      const crmNameParts = `${detail.name ?? ''} ${detail.last_name ?? ''}`.trim();
      const mergedEmail = (detail.email ?? '').trim() || dbEmail || null;
      const mergedPhone =
        (detail.phone ?? detail.whatsapp ?? '').trim() || dbPhone || null;
      return {
        lead_id: e.lead_id,
        had_balance: e.had_balance === true,
        saldo_snapshot: e.saldo_snapshot != null ? Number(e.saldo_snapshot) : null,
        source_consultant_email: e.source_consultant_email ?? null,
        target_consultant_email: e.target_consultant_email ?? null,
        transfer_type: (e.transfer_type ?? 'TF').trim(),
        total_depositado_snapshot: e.total_depositado_snapshot != null ? Number(e.total_depositado_snapshot) : null,
        total_apostado_snapshot: e.total_apostado_snapshot != null ? Number(e.total_apostado_snapshot) : null,
        total_ganho_snapshot: e.total_ganho_snapshot != null ? Number(e.total_ganho_snapshot) : null,
        available_withdraw_snapshot: e.available_withdraw_snapshot != null ? Number(e.available_withdraw_snapshot) : null,
        resolution_status: e.resolution_status ?? 'pending',
        resolved_at: e.resolved_at ?? null,
        current_total_depositado_at_resolution: e.current_total_depositado_at_resolution != null ? Number(e.current_total_depositado_at_resolution) : null,
        current_total_apostado_at_resolution: e.current_total_apostado_at_resolution != null ? Number(e.current_total_apostado_at_resolution) : null,
        name: crmNameParts ? (detail.name ?? null) : dbLeadName || null,
        last_name: crmNameParts ? (detail.last_name ?? null) : null,
        email: mergedEmail,
        phone: mergedPhone || null,
        whatsapp: detail.whatsapp ?? null,
        status: detail.status ?? null,
        temperature: detail.temperature ?? null,
        total_depositado: detail.total_depositado ?? null,
        total_apostado: detail.total_apostado ?? null,
        total_ganho: detail.total_ganho ?? null,
        created_at: detail.created_at ?? null,
        last_interaction_snapshot: e.last_interaction_snapshot ?? null,
        total_saque_snapshot: e.total_saque_snapshot != null ? Number(e.total_saque_snapshot) : null,
      };
    });

    const leadsComEmail = list.filter((row: { email?: string | null }) => (row.email ?? '').trim().length > 0).length;
    console.info(`${LOG_PREFIX} GET (modal Ver leads)`, {
      transfer_log_id: logId,
      banca_id: resolved.bancaId,
      leads_retornados: list.length,
      leads_com_email_crm_ou_db: leadsComEmail,
      consultor_destino_entries:
        (rawList[0] as { target_consultant_email?: string | null } | undefined)?.target_consultant_email ?? null,
      nota: 'Nome/e-mail: CRM (destino) quando bate o lead_id; senão usa lead_name/lead_email gravados na transferência.',
    });

    return successResponse(list);
  } catch (err: unknown) {
    if (err instanceof ApiHttpError) {
      return errorResponse(err.message, err.statusCode);
    }
    const message = err instanceof Error ? err.message : String(err);
    if (
      message === 'Não autenticado' ||
      message === 'Usuário inválido' ||
      message === 'Perfil não encontrado'
    ) {
      return errorResponse(message, 401);
    }
    if (message.startsWith('Acesso negado')) {
      return errorResponse(message, 403);
    }
    if (message.includes('não tem permissão') || message.includes('obrigatório')) {
      return errorResponse(message, 403);
    }
    console.error(`${LOG_PREFIX} GET error:`, err);
    return serverErrorResponse(err);
  }
}
