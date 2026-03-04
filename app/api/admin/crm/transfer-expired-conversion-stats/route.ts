import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { getAdminBancaId, getAdminAllowedBancaIds } from '@/lib/server/crm/adminLeadTransferContext';
import { getEffectiveZaplotoId } from '@/lib/tenant-context';
import { createCrmRedistributionClient } from '@/lib/server/crm/crmRedistributionClient';
import { normalizeDateParam, dateToStartOfDaySãoPauloISO, dateToEndOfDaySãoPauloISO } from '@/lib/server/crm/transfer-date-utils';

const LOG_PREFIX = '[admin][transfer-expired-conversion-stats]';
/** Prazo em dias para considerar transferência expirada (igual ao frontend). */
const DAYS_EXPIRED = 10;

/** Data/hora limite: transferências com created_at <= este valor já expiraram. */
function getExpiredCutoffISO(): string {
  const cutoff = new Date(Date.now() - DAYS_EXPIRED * 24 * 60 * 60 * 1000);
  return cutoff.toISOString();
}

type EntryRow = {
  lead_id: string;
  target_consultant_email?: string | null;
  total_depositado_snapshot?: number | null;
  total_apostado_snapshot?: number | null;
  available_withdraw_snapshot?: number | null;
};

/**
 * Para uma banca: busca entries dos logs expirados, agrupa por consultor, chama CRM e retorna totais e convertidos por consultor.
 */
async function getConversionByConsultant(
  bancaId: string,
  crmBaseUrl: string,
  logIds: string[]
): Promise<{ consultant_email: string; consultant_name: string; total_transferidos: number; convertidos: number }[]> {
  if (logIds.length === 0) return [];

  const BATCH = 800;
  const rawEntries: EntryRow[] = [];
  for (let i = 0; i < logIds.length; i += BATCH) {
    const chunk = logIds.slice(i, i + BATCH);
    const { data: batch, error } = await supabaseServiceRole
      .from('admin_lead_transfer_entries')
      .select('lead_id, target_consultant_email, total_depositado_snapshot, total_apostado_snapshot, available_withdraw_snapshot')
      .in('transfer_log_id', chunk)
      .eq('banca_id', bancaId)
      .limit(50000);
    if (error) return [];
    rawEntries.push(...(Array.isArray(batch) ? batch : []));
  }

  const byConsultant = new Map<string, EntryRow[]>();
  for (const e of rawEntries) {
    const email = (e.target_consultant_email ?? '').trim().toLowerCase();
    if (!email) continue;
    if (!byConsultant.has(email)) byConsultant.set(email, []);
    byConsultant.get(email)!.push(e);
  }

  const client = createCrmRedistributionClient(crmBaseUrl);
  const results: { consultant_email: string; consultant_name: string; total_transferidos: number; convertidos: number }[] = [];

  for (const [consultantEmail, entries] of byConsultant.entries()) {
    let convertidos = 0;
    try {
      const result = await client.getIndicatedsByConsultant(
        consultantEmail,
        3000,
        1,
        { transferredFilter: 'yes', sort: 'created_at', direction: 'desc' }
      );
      const leads = result.success && Array.isArray(result.data) ? result.data : [];
      const currentByLeadId = new Map<string, number>();
      for (const l of leads) {
        const id = l?.id != null ? String(l.id) : '';
        if (!id) continue;
        currentByLeadId.set(id, Number(l.total_depositado ?? 0));
      }
      for (const entry of entries) {
        const leadId = String(entry.lead_id ?? '');
        const snapDep = entry.total_depositado_snapshot != null ? Number(entry.total_depositado_snapshot) : 0;
        const curDep = currentByLeadId.get(leadId) ?? 0;
        if (curDep > snapDep) convertidos++;
      }
    } catch (err) {
      console.warn(`${LOG_PREFIX} CRM failed for ${consultantEmail}:`, err);
    }
    results.push({
      consultant_email: consultantEmail,
      consultant_name: consultantEmail,
      total_transferidos: entries.length,
      convertidos,
    });
  }

  if (results.length > 0) {
    const emails = results.map((r) => r.consultant_email);
    const { data: profiles } = await supabaseServiceRole
      .from('profiles')
      .select('email, full_name')
      .not('email', 'is', null)
      .limit(2000);
    const emailToName = new Map<string, string>();
    (profiles ?? []).forEach((p: { email: string | null; full_name: string | null }) => {
      const email = (p.email ?? '').trim().toLowerCase();
      if (email && emails.includes(email)) {
        emailToName.set(email, (p.full_name ?? p.email ?? '').trim() || email);
      }
    });
    results.forEach((r) => {
      r.consultant_name = emailToName.get(r.consultant_email) ?? r.consultant_email;
    });
  }

  return results;
}

/**
 * GET /api/admin/crm/transfer-expired-conversion-stats
 * Estatísticas de conversão (depósito após transferência) apenas para transferências já expiradas (prazo 10d).
 * Query: banca_id (opcional), from (YYYY-MM-DD), to (YYYY-MM-DD)
 * - Sem banca_id: retorna by_banca (total_transferidos e convertidos por banca).
 * - Com banca_id: retorna by_consultant (total_transferidos e convertidos por consultor destino).
 */
export async function GET(req: NextRequest) {
  try {
    const { userId, profile } = await requireAdmin(req);
    const { searchParams } = req.nextUrl;

    const bancaId = searchParams.get('banca_id')?.trim() || null;
    const fromParam = normalizeDateParam(searchParams.get('from'));
    const toParam = normalizeDateParam(searchParams.get('to'));
    const expiredCutoff = getExpiredCutoffISO();

    if (bancaId) {
      const resolved = await getAdminBancaId(userId, profile, bancaId);
      if (!resolved) return errorResponse('Banca não encontrada ou sem permissão.');

      let logsQuery = supabaseServiceRole
        .from('admin_lead_transfer_logs')
        .select('id')
        .eq('banca_id', resolved.bancaId)
        .lte('created_at', expiredCutoff);
      if (fromParam) logsQuery = logsQuery.gte('created_at', dateToStartOfDaySãoPauloISO(fromParam));
      if (toParam) logsQuery = logsQuery.lte('created_at', dateToEndOfDaySãoPauloISO(toParam));
      const { data: logs } = await logsQuery.order('created_at', { ascending: false }).limit(5000);
      const logIds = (logs ?? []).map((r: { id: string }) => r.id);
      const byConsultant = await getConversionByConsultant(resolved.bancaId, resolved.crmBaseUrl, logIds);
      return successResponse({ by_banca: null, by_consultant: byConsultant });
    }

    const zaplotoId = await getEffectiveZaplotoId(req, profile);
    const allowedBancaIds = await getAdminAllowedBancaIds(profile, zaplotoId);
    if (!allowedBancaIds || allowedBancaIds.length === 0) {
      return successResponse({ by_banca: [], by_consultant: null });
    }

    const { data: bancas } = await supabaseServiceRole
      .from('crm_bancas')
      .select('id, name, url')
      .in('id', allowedBancaIds);
    const bancaList = Array.isArray(bancas) ? bancas : [];
    const byBanca: { banca_id: string; banca_name: string; total_transferidos: number; convertidos: number }[] = [];

    for (const b of bancaList) {
      const bid = b.id as string;
      const resolved = await getAdminBancaId(userId, profile, bid);
      if (!resolved) continue;

      let logsQuery = supabaseServiceRole
        .from('admin_lead_transfer_logs')
        .select('id')
        .eq('banca_id', bid)
        .lte('created_at', expiredCutoff);
      if (fromParam) logsQuery = logsQuery.gte('created_at', dateToStartOfDaySãoPauloISO(fromParam));
      if (toParam) logsQuery = logsQuery.lte('created_at', dateToEndOfDaySãoPauloISO(toParam));
      const { data: logs } = await logsQuery.order('created_at', { ascending: false }).limit(5000);
      const logIds = (logs ?? []).map((r: { id: string }) => r.id);
      const byConsultant = await getConversionByConsultant(resolved.bancaId, resolved.crmBaseUrl, logIds);
      const total_transferidos = byConsultant.reduce((s, r) => s + r.total_transferidos, 0);
      const convertidos = byConsultant.reduce((s, r) => s + r.convertidos, 0);
      byBanca.push({
        banca_id: bid,
        banca_name: (b.name ?? b.url ?? bid) as string,
        total_transferidos,
        convertidos,
      });
    }

    return successResponse({ by_banca: byBanca, by_consultant: null });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('não tem permissão') || message.includes('obrigatório')) {
      return errorResponse(message, 403);
    }
    console.error(`${LOG_PREFIX} GET error:`, err);
    return serverErrorResponse(err);
  }
}
