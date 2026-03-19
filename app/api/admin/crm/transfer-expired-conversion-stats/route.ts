import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { getAdminBancaId, getAdminAllowedBancaIds } from '@/lib/server/crm/adminLeadTransferContext';
import { getEffectiveZaplotoId } from '@/lib/tenant-context';
import { normalizeDateParam, dateToStartOfDaySãoPauloISO, dateToEndOfDaySãoPauloISO } from '@/lib/server/crm/transfer-date-utils';

const LOG_PREFIX = '[admin][transfer-expired-conversion-stats]';
/** Prazo em dias para considerar transferência expirada (igual ao frontend). */
const DAYS_EXPIRED = 10;

/** Data/hora limite: transferências com created_at <= este valor já expiraram. */
function getExpiredCutoffISO(): string {
  const cutoff = new Date(Date.now() - DAYS_EXPIRED * 24 * 60 * 60 * 1000);
  return cutoff.toISOString();
}

type EntryRow = { target_consultant_email?: string | null };
type VinculadoRow = { target_consultant_email?: string | null; banca_id?: string | null };

/**
 * Busca em admin_lead_transfer_entries:
 * - Total de entries por consultor destino (target_consultant_email) = total_transferidos na banca.
 * - Convertidos = busca explícita com resolution_status = 'vinculado', agrupado por banca e por consultor que realizou a conversão (target_consultant_email).
 * Retorna totais e convertidos por consultor na banca.
 */
async function getConversionByConsultant(
  bancaId: string,
  _crmBaseUrl: string,
  logIds: string[]
): Promise<{ consultant_email: string; consultant_name: string; total_transferidos: number; convertidos: number }[]> {
  if (logIds.length === 0) return [];

  const BATCH = 800;

  // 1) Total de entries por consultor (todos os status) — para total_transferidos
  const allEntries: EntryRow[] = [];
  for (let i = 0; i < logIds.length; i += BATCH) {
    const chunk = logIds.slice(i, i + BATCH);
    const { data: batch, error } = await supabaseServiceRole
      .from('admin_lead_transfer_entries')
      .select('target_consultant_email')
      .in('transfer_log_id', chunk)
      .eq('banca_id', bancaId);
    if (error) return [];
    allEntries.push(...(Array.isArray(batch) ? batch : []));
  }

  // 2) Convertidos: busca explícita na tabela com resolution_status = 'vinculado' (quem realizou a conversão = target_consultant_email; banca = banca_id)
  const vinculadoEntries: VinculadoRow[] = [];
  for (let i = 0; i < logIds.length; i += BATCH) {
    const chunk = logIds.slice(i, i + BATCH);
    const { data: batch, error } = await supabaseServiceRole
      .from('admin_lead_transfer_entries')
      .select('target_consultant_email, banca_id')
      .in('transfer_log_id', chunk)
      .eq('banca_id', bancaId)
      .eq('resolution_status', 'vinculado');
    if (error) return [];
    vinculadoEntries.push(...(Array.isArray(batch) ? batch : []));
  }

  const totalByConsultant = new Map<string, number>();
  for (const e of allEntries) {
    const email = (e.target_consultant_email ?? '').trim().toLowerCase();
    if (!email) continue;
    totalByConsultant.set(email, (totalByConsultant.get(email) ?? 0) + 1);
  }

  const convertidosByConsultant = new Map<string, number>();
  for (const e of vinculadoEntries) {
    const email = (e.target_consultant_email ?? '').trim().toLowerCase();
    if (!email) continue;
    convertidosByConsultant.set(email, (convertidosByConsultant.get(email) ?? 0) + 1);
  }

  const consultantEmails = new Set([...totalByConsultant.keys(), ...convertidosByConsultant.keys()]);
  const results: { consultant_email: string; consultant_name: string; total_transferidos: number; convertidos: number }[] = [];
  for (const consultantEmail of consultantEmails) {
    results.push({
      consultant_email: consultantEmail,
      consultant_name: consultantEmail,
      total_transferidos: totalByConsultant.get(consultantEmail) ?? 0,
      convertidos: convertidosByConsultant.get(consultantEmail) ?? 0,
    });
  }

  if (results.length > 0) {
    const emails = Array.from(consultantEmails);
    const { data: profiles } = await supabaseServiceRole
      .from('profiles')
      .select('email, full_name')
      .not('email', 'is', null);
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
 * Estatísticas de conversão apenas para transferências já expiradas (prazo 10d).
 * Fonte: tabela admin_lead_transfer_entries. Convertidos = busca com resolution_status = 'vinculado';
 * computado por banca (banca_id) e por consultor que realizou a conversão (target_consultant_email).
 * Query: banca_id (opcional), from (YYYY-MM-DD), to (YYYY-MM-DD), source_consultant_email? (consultor doador)
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
    const sourceConsultantEmail = searchParams.get('source_consultant_email')?.trim() || null;
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
      if (sourceConsultantEmail) logsQuery = logsQuery.ilike('source_consultant_email', sourceConsultantEmail);
      const { data: logs } = await logsQuery.order('created_at', { ascending: false });
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
      if (sourceConsultantEmail) logsQuery = logsQuery.ilike('source_consultant_email', sourceConsultantEmail);
      const { data: logs } = await logsQuery.order('created_at', { ascending: false });
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
