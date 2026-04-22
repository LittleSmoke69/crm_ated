import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { getAdminBancaId } from '@/lib/server/crm/adminLeadTransferContext';
import { createCrmRedistributionClient } from '@/lib/server/crm/crmRedistributionClient';
import { normalizeDateParam, dateToStartOfDaySãoPauloISO, dateToEndOfDaySãoPauloISO } from '@/lib/server/crm/transfer-date-utils';

const LOG_PREFIX = '[admin][transfer-consultant-verifier]';

function isCrmRateLimitMessage(message?: string | null): boolean {
  const msg = String(message ?? '').toLowerCase();
  return msg.includes('too many attempts') || msg.includes('too many requests') || msg.includes('429');
}

export type ConsultantVerifierRow = {
  consultant_email: string;
  consultant_name: string;
  total_transferidos: number;
  depositaram_depois: number;
  jogaram_depois: number;
  sacaram_depois: number;
};

/**
 * GET /api/admin/crm/transfer-consultant-verifier
 * Verificador de consultores: com base em admin_lead_transfer_logs e admin_lead_transfer_entries,
 * compara snapshot no momento da transferência com dados atuais do CRM (get-indicateds-by-consultant
 * com transferred_filter=yes) e retorna por consultor: quantos depositaram, jogaram e sacaram depois.
 * Query: banca_id (obrigatório), from (YYYY-MM-DD), to (YYYY-MM-DD), consultant (opcional - filtrar por email destino).
 */
export async function GET(req: NextRequest) {
  try {
    const { userId, profile } = await requireAdmin(req);
    const { searchParams } = req.nextUrl;

    const bancaId = searchParams.get('banca_id')?.trim() || null;
    if (!bancaId) {
      return errorResponse('banca_id é obrigatório.');
    }

    const resolved = await getAdminBancaId(userId, profile, bancaId, { skipLeadTransferLock: true });
    if (!resolved) {
      return errorResponse('Banca não encontrada ou sem permissão.');
    }

    const fromParam = normalizeDateParam(searchParams.get('from'));
    const toParam = normalizeDateParam(searchParams.get('to'));
    const consultantFilter = searchParams.get('consultant')?.trim()?.toLowerCase() || null;

    // 1) Buscar logs no período para obter transfer_log_ids
    let logsQuery = supabaseServiceRole
      .from('admin_lead_transfer_logs')
      .select('id')
      .eq('banca_id', resolved.bancaId);

    if (fromParam) {
      logsQuery = logsQuery.gte('created_at', dateToStartOfDaySãoPauloISO(fromParam));
    }
    if (toParam) {
      logsQuery = logsQuery.lte('created_at', dateToEndOfDaySãoPauloISO(toParam));
    }
    // Buscar todos os logs do período (Supabase default é 1000; usamos 5000 para não perder consultores)
    const { data: logs, error: logsError } = await logsQuery
      .order('created_at', { ascending: false })
      .limit(5000);

    if (logsError || !Array.isArray(logs) || logs.length === 0) {
      if (logsError) console.error(`${LOG_PREFIX} logs error:`, logsError);
      return successResponse([]);
    }

    const logIds = logs.map((r: { id: string }) => r.id);

    // 2) Buscar TODAS as entries desses logs (em lotes de logIds se > 800 para evitar URL/query grande; limite 50k por lote)
    const BATCH_LOG_IDS = 800;
    const rawEntries: { lead_id: string; target_consultant_email?: string | null; total_depositado_snapshot?: number | null; total_apostado_snapshot?: number | null; available_withdraw_snapshot?: number | null }[] = [];
    for (let i = 0; i < logIds.length; i += BATCH_LOG_IDS) {
      const chunk = logIds.slice(i, i + BATCH_LOG_IDS);
      const { data: batchEntries, error: entriesError } = await supabaseServiceRole
        .from('admin_lead_transfer_entries')
        .select('lead_id, target_consultant_email, total_depositado_snapshot, total_apostado_snapshot, available_withdraw_snapshot')
        .in('transfer_log_id', chunk)
        .eq('banca_id', resolved.bancaId)
        .limit(50000);
      if (entriesError) {
        console.error(`${LOG_PREFIX} entries error (batch):`, entriesError);
        return errorResponse('Erro ao buscar leads transferidos.');
      }
      rawEntries.push(...(Array.isArray(batchEntries) ? batchEntries : []));
    }
    const entriesByConsultant = new Map<string, typeof rawEntries>();
    for (const e of rawEntries) {
      const email = (e.target_consultant_email ?? '').trim().toLowerCase();
      if (!email) continue;
      if (consultantFilter && email !== consultantFilter) continue;
      if (!entriesByConsultant.has(email)) {
        entriesByConsultant.set(email, []);
      }
      entriesByConsultant.get(email)!.push(e);
    }

    const client = createCrmRedistributionClient(resolved.crmBaseUrl);
    const results: ConsultantVerifierRow[] = [];
    const emailToName = new Map<string, string>();
    let crmRateLimitDetected = false;

    for (const [consultantEmail, consultantEntries] of entriesByConsultant.entries()) {
      let depositaramDepois = 0;
      let jogaramDepois = 0;
      let sacaramDepois = 0;

      try {
        const result = await client.getIndicatedsByConsultant(
          consultantEmail,
          3000,
          1,
          { transferredFilter: 'yes', sort: 'created_at', direction: 'desc' }
        );
        if (!result.success) {
          if (isCrmRateLimitMessage(result.error ?? result.message)) {
            crmRateLimitDetected = true;
          }
          results.push({
            consultant_email: consultantEmail,
            consultant_name: emailToName.get(consultantEmail) ?? consultantEmail,
            total_transferidos: consultantEntries.length,
            depositaram_depois: 0,
            jogaram_depois: 0,
            sacaram_depois: 0,
          });
          continue;
        }
        const leads = result.success && Array.isArray(result.data) ? result.data : [];
        const currentByLeadId = new Map<string, { total_depositado?: number; total_apostado?: number; total_saque?: number; available_withdraw?: number }>();
        for (const l of leads) {
          const id = l?.id != null ? String(l.id) : '';
          if (!id) continue;
          currentByLeadId.set(id, {
            total_depositado: l.total_depositado != null ? Number(l.total_depositado) : undefined,
            total_apostado: l.total_apostado != null ? Number(l.total_apostado) : undefined,
            total_saque: l.total_saque != null ? Number(l.total_saque) : undefined,
            available_withdraw: l.available_withdraw != null ? Number(l.available_withdraw) : undefined,
          });
        }

        for (const entry of consultantEntries) {
          const leadId = String(entry.lead_id ?? '');
          const current = currentByLeadId.get(leadId);
          const snapDep = entry.total_depositado_snapshot != null ? Number(entry.total_depositado_snapshot) : 0;
          const snapApost = entry.total_apostado_snapshot != null ? Number(entry.total_apostado_snapshot) : 0;
          const snapWithdraw = entry.available_withdraw_snapshot != null ? Number(entry.available_withdraw_snapshot) : 0;
          const curDep = current?.total_depositado ?? 0;
          const curApost = current?.total_apostado ?? 0;
          const curSaque = current?.total_saque ?? 0;
          const curWithdraw = current?.available_withdraw ?? 0;

          if (curDep > snapDep) depositaramDepois++;
          if (curApost > snapApost) jogaramDepois++;
          if (curSaque > 0 || (snapWithdraw > 0 && curWithdraw < snapWithdraw)) sacaramDepois++;
        }
      } catch (crmErr) {
        console.warn(`${LOG_PREFIX} CRM getIndicatedsByConsultant failed for ${consultantEmail}:`, crmErr);
      }

      results.push({
        consultant_email: consultantEmail,
        consultant_name: emailToName.get(consultantEmail) ?? consultantEmail,
        total_transferidos: consultantEntries.length,
        depositaram_depois: depositaramDepois,
        jogaram_depois: jogaramDepois,
        sacaram_depois: sacaramDepois,
      });
    }

    // Resolver nomes (profiles) para consultant_email
    const allEmails = results.map((r) => r.consultant_email);
    if (allEmails.length > 0) {
      const { data: profiles } = await supabaseServiceRole
        .from('profiles')
        .select('email, full_name')
        .not('email', 'is', null)
        .limit(2000);
      (profiles ?? []).forEach((p: { email: string | null; full_name: string | null }) => {
        const email = (p.email ?? '').trim().toLowerCase();
        if (email && allEmails.includes(email)) {
          const name = (p.full_name ?? p.email ?? '').trim();
          emailToName.set(email, name || email);
        }
      });
      results.forEach((r) => {
        r.consultant_name = emailToName.get(r.consultant_email) ?? r.consultant_email;
      });
    }

    if (crmRateLimitDetected) {
      return successResponse(results, {
        meta: {
          crm_warning: 'CRM temporariamente com muitas tentativas (429). Parte dos consultores pode aparecer com contagem incompleta.',
        },
      });
    }
    return successResponse(results);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('não tem permissão') || message.includes('obrigatório')) {
      return errorResponse(message, 403);
    }
    console.error(`${LOG_PREFIX} GET error:`, err);
    return serverErrorResponse(err);
  }
}
