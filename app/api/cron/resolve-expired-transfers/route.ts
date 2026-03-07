/**
 * POST /api/cron/resolve-expired-transfers
 *
 * Formação automática: resolve todas as transferências expiradas (entries com resolution_status = 'pending').
 * Deve ser chamado por um cron a cada 30 minutos (ex.: Netlify scheduled function).
 *
 * Requer header: X-Cron-Secret = process.env.TRANSFER_RESOLVE_CRON_SECRET
 * Se TRANSFER_RESOLVE_CRON_SECRET não estiver definido, a rota retorna 501.
 */

import { NextRequest } from 'next/server';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { resolveOneTransferLog, isTransferExpired } from '@/lib/server/crm/resolveTransferLog';

const DEFAULT_DEADLINE_DAYS = 10;

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret')?.trim() || '';
  const expected = process.env.TRANSFER_RESOLVE_CRON_SECRET?.trim();
  if (!expected) {
    return new Response(JSON.stringify({ success: false, error: 'Cron não configurado (TRANSFER_RESOLVE_CRON_SECRET).' }), {
      status: 501,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (secret !== expected) {
    return new Response(JSON.stringify({ success: false, error: 'Não autorizado.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const { data: logs, error: logsError } = await supabaseServiceRole
      .from('admin_lead_transfer_logs')
      .select('id, banca_id, created_at, deadline_days')
      .order('created_at', { ascending: false });

    if (logsError || !logs?.length) {
      return successResponse({ results: [], total_resolved: 0, total_vinculado: 0, total_disponivel: 0, message: 'Nenhum log.' });
    }

    const expired = (logs as { id: string; banca_id: string; created_at: string; deadline_days?: number | null }[]).filter((log) =>
      isTransferExpired(log.created_at, log.deadline_days ?? DEFAULT_DEADLINE_DAYS)
    );
    if (expired.length === 0) {
      return successResponse({ results: [], total_resolved: 0, total_vinculado: 0, total_disponivel: 0, message: 'Nenhuma transferência expirada.' });
    }

    const expiredIds = expired.map((l) => l.id);
    const { data: pendingRows } = await supabaseServiceRole
      .from('admin_lead_transfer_entries')
      .select('transfer_log_id')
      .in('transfer_log_id', expiredIds)
      .eq('resolution_status', 'pending');

    const logsWithPending = new Set<string>();
    (pendingRows ?? []).forEach((r: { transfer_log_id: string }) => logsWithPending.add(r.transfer_log_id));
    const toResolve = expired.filter((log) => logsWithPending.has(log.id));
    if (toResolve.length === 0) {
      return successResponse({ results: [], total_resolved: 0, total_vinculado: 0, total_disponivel: 0, message: 'Nenhuma transferência expirada com leads pendentes.' });
    }

    const bancaIds = [...new Set(toResolve.map((l) => l.banca_id))];
    const { data: bancas } = await supabaseServiceRole.from('crm_bancas').select('id, url').in('id', bancaIds);
    const crmUrlByBancaId = new Map<string, string>();
    (bancas ?? []).forEach((b: { id: string; url?: string | null }) => {
      const url = (b.url ?? '').trim().replace(/\/+$/, '');
      if (url) crmUrlByBancaId.set(b.id, url);
    });

    const results: Array<{ log_id: string; banca_id: string; resolved: number; vinculado: number; disponivel_retransferencia: number; message: string }> = [];
    let total_resolved = 0;
    let total_vinculado = 0;
    let total_disponivel = 0;

    for (const log of toResolve) {
      const crmBaseUrl = crmUrlByBancaId.get(log.banca_id) ?? null;
      const result = await resolveOneTransferLog({ bancaId: log.banca_id, crmBaseUrl }, log.id);
      results.push({
        log_id: log.id,
        banca_id: log.banca_id,
        resolved: result.resolved,
        vinculado: result.vinculado,
        disponivel_retransferencia: result.disponivel_retransferencia,
        message: result.message,
      });
      total_resolved += result.resolved;
      total_vinculado += result.vinculado;
      total_disponivel += result.disponivel_retransferencia;
    }

    return successResponse({
      results,
      total_resolved,
      total_vinculado,
      total_disponivel,
      message: `Resolvidas ${results.length} transferência(s): ${total_vinculado} vinculado(s), ${total_disponivel} disponível(is) para repasse.`,
    });
  } catch (err: unknown) {
    console.error('[cron][resolve-expired-transfers] error:', err);
    return serverErrorResponse(err as Error);
  }
}
