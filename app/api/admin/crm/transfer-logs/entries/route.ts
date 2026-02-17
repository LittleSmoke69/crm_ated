import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { getAdminBancaId } from '@/lib/server/crm/adminLeadTransferContext';
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
    const { userId, profile } = await requireAdmin(req);
    const { searchParams } = req.nextUrl;

    const logId = searchParams.get('log_id')?.trim() || null;
    const bancaId = searchParams.get('banca_id')?.trim() || null;

    if (!logId || !bancaId) {
      return errorResponse('log_id e banca_id são obrigatórios.');
    }

    const resolved = await getAdminBancaId(userId, profile, bancaId);
    if (!resolved) {
      return errorResponse('Banca não encontrada ou sem permissão.');
    }

    const { data: entries, error } = await supabaseServiceRole
      .from('admin_lead_transfer_entries')
      .select('lead_id, had_balance, saldo_snapshot, target_consultant_email')
      .eq('banca_id', resolved.bancaId)
      .eq('transfer_log_id', logId)
      .order('lead_id', { ascending: true });

    if (error) {
      console.error(`${LOG_PREFIX} GET error:`, error);
      return errorResponse('Erro ao buscar leads da transferência.');
    }

    const rawList = Array.isArray(entries) ? entries : [];
    const targetEmail = rawList[0]?.target_consultant_email?.trim();
    const detailByLeadId = new Map<string, EntryLeadDetail>();

    if (targetEmail && resolved.crmBaseUrl) {
      try {
        const client = createCrmRedistributionClient(resolved.crmBaseUrl);
        const result = await client.getIndicatedsByConsultant(targetEmail, 2000);
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
        console.warn(`${LOG_PREFIX} CRM enrichment failed (modal ainda mostra ID/saldo):`, err);
      }
    }

    const list = rawList.map((e: { lead_id: string | number; had_balance?: boolean; saldo_snapshot?: number | null }) => {
      const leadId = String(e.lead_id ?? '');
      const detail = detailByLeadId.get(leadId) ?? {};
      return {
        lead_id: e.lead_id,
        had_balance: e.had_balance === true,
        saldo_snapshot: e.saldo_snapshot != null ? Number(e.saldo_snapshot) : null,
        name: detail.name ?? null,
        last_name: detail.last_name ?? null,
        email: detail.email ?? null,
        phone: detail.phone ?? detail.whatsapp ?? null,
        whatsapp: detail.whatsapp ?? null,
        status: detail.status ?? null,
        temperature: detail.temperature ?? null,
        total_depositado: detail.total_depositado ?? null,
        total_apostado: detail.total_apostado ?? null,
        total_ganho: detail.total_ganho ?? null,
        created_at: detail.created_at ?? null,
      };
    });

    return successResponse(list);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('não tem permissão') || message.includes('obrigatório')) {
      return errorResponse(message, 403);
    }
    console.error(`${LOG_PREFIX} GET error:`, err);
    return serverErrorResponse(err);
  }
}
