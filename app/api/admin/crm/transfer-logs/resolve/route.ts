/**
 * POST /api/admin/crm/transfer-logs/resolve
 *
 * Resolve uma transferência expirada (após 10 dias):
 * - Busca dados atuais dos leads no CRM (consultor destino).
 * - Compara total_depositado e total_apostado atuais com o snapshot da transferência.
 * - Se o lead teve atividade (depósito ou aposta maior que no snapshot) → vinculado (fica com o consultor).
 * - Caso contrário → disponivel_retransferencia (pode ser movido para o próximo).
 *
 * Query/body: log_id (obrigatório), banca_id (obrigatório).
 */

import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { getAdminBancaId } from '@/lib/server/crm/adminLeadTransferContext';
import { createCrmRedistributionClient } from '@/lib/server/crm/crmRedistributionClient';

const LOG_PREFIX = '[admin][transfer-logs][resolve]';
const DAYS_DEADLINE = 10;

function isTransferExpired(createdAt: string | null | undefined): boolean {
  if (!createdAt) return true;
  const transferredAt = new Date(createdAt);
  const now = new Date();
  const diffMs = now.getTime() - transferredAt.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return diffDays >= DAYS_DEADLINE;
}

export async function POST(req: NextRequest) {
  try {
    const { userId, profile } = await requireAdmin(req);

    let logId = req.nextUrl.searchParams.get('log_id')?.trim() || null;
    let bancaId = req.nextUrl.searchParams.get('banca_id')?.trim() || null;
    if (req.headers.get('content-type')?.toLowerCase().includes('application/json')) {
      try {
        const body = await req.json();
        const b = body as { log_id?: string; banca_id?: string };
        if (!logId) logId = b?.log_id?.trim() || null;
        if (!bancaId) bancaId = b?.banca_id?.trim() || null;
      } catch {
        // ignore
      }
    }

    if (!logId || !bancaId) {
      return errorResponse('log_id e banca_id são obrigatórios.', 400);
    }

    const resolved = await getAdminBancaId(userId, profile, bancaId);
    if (!resolved) {
      return errorResponse('Banca não encontrada ou sem permissão.', 403);
    }

    const { data: log, error: logError } = await supabaseServiceRole
      .from('admin_lead_transfer_logs')
      .select('id, created_at')
      .eq('id', logId)
      .eq('banca_id', resolved.bancaId)
      .single();

    if (logError || !log) {
      return errorResponse('Transferência não encontrada.', 404);
    }

    if (!isTransferExpired(log.created_at)) {
      return errorResponse('Só é possível resolver transferências após o prazo de 10 dias.', 400);
    }

    const { data: entries, error: entriesError } = await supabaseServiceRole
      .from('admin_lead_transfer_entries')
      .select('id, lead_id, target_consultant_email, total_depositado_snapshot, total_apostado_snapshot')
      .eq('transfer_log_id', logId)
      .eq('banca_id', resolved.bancaId);

    if (entriesError || !entries?.length) {
      return errorResponse('Nenhum lead encontrado nesta transferência.', 404);
    }

    const targetEmail = (entries[0] as { target_consultant_email?: string }).target_consultant_email?.trim();
    if (!targetEmail || !resolved.crmBaseUrl) {
      return errorResponse('Dados da transferência incompletos para consultar o CRM.', 400);
    }

    const client = createCrmRedistributionClient(resolved.crmBaseUrl);

    const result = await client.getIndicatedsByConsultant(targetEmail, 5000, 1, {
      transferredFilter: 'yes',
      sort: 'created_at',
      direction: 'desc',
    });
    const currentByLeadId = new Map<string, { total_depositado?: number; total_apostado?: number }>();
    const details = Array.isArray(result.data) ? result.data : [];
    for (const d of details) {
      const id = d?.id != null ? String(d.id) : '';
      if (!id) continue;
      currentByLeadId.set(id, {
        total_depositado: d.total_depositado != null ? Number(d.total_depositado) : undefined,
        total_apostado: d.total_apostado != null ? Number(d.total_apostado) : undefined,
      });
    }

    let vinculado = 0;
    let disponivel = 0;

    for (const entry of entries as Array<{
      id: string;
      lead_id: string | number;
      total_depositado_snapshot?: number | null;
      total_apostado_snapshot?: number | null;
    }>) {
      const leadId = String(entry.lead_id ?? '');
      const current = currentByLeadId.get(leadId);
      const snapDep = entry.total_depositado_snapshot != null ? Number(entry.total_depositado_snapshot) : 0;
      const snapApost = entry.total_apostado_snapshot != null ? Number(entry.total_apostado_snapshot) : 0;
      const curDep = current?.total_depositado ?? 0;
      const curApost = current?.total_apostado ?? 0;

      const teveAtividade = curDep > snapDep || curApost > snapApost;
      const resolution_status = teveAtividade ? 'vinculado' : 'disponivel_retransferencia';
      if (teveAtividade) vinculado++;
      else disponivel++;

      await supabaseServiceRole
        .from('admin_lead_transfer_entries')
        .update({
          resolution_status,
          resolved_at: new Date().toISOString(),
          current_total_depositado_at_resolution: curDep > 0 ? curDep : null,
          current_total_apostado_at_resolution: curApost > 0 ? curApost : null,
        })
        .eq('id', entry.id);
    }

    return successResponse({
      resolved: entries.length,
      vinculado,
      disponivel_retransferencia: disponivel,
      message: `Resolução concluída: ${vinculado} lead(s) vinculado(s) ao consultor, ${disponivel} disponível(is) para repasse.`,
    });
  } catch (err: unknown) {
    console.error(`${LOG_PREFIX} error:`, err);
    return serverErrorResponse(err as Error);
  }
}
