/**
 * POST /api/cron/resolve-expired-transfers
 *
 * Formação automática: resolve transferências expiradas (entries com resolution_status = 'pending').
 * Deve ser chamado por um cron a cada 1 hora (ex.: Netlify scheduled function com schedule = "0 * * * *").
 *
 * Para evitar timeout (504), use max_entries (ex.: 2–3): processa poucas entries por request.
 * Body: { max_entries?: number } (cron) ou { max_logs?: number }. Resposta inclui remaining_logs.
 *
 * Requer header: X-Cron-Secret = process.env.TRANSFER_RESOLVE_CRON_SECRET
 */

import { NextRequest } from 'next/server';
import { successResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { resolveOneTransferLog, isTransferExpired, type ConvertedLead } from '@/lib/server/crm/resolveTransferLog';

const DEFAULT_DEADLINE_DAYS = 10;
const DEFAULT_MAX_LOGS_PER_RUN = 5;
/** Quando setado, processa no máximo N entries (do primeiro log pendente) por request — resposta rápida, evita 504. */
const DEFAULT_MAX_ENTRIES_PER_RUN = 3;

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

  let maxLogs = DEFAULT_MAX_LOGS_PER_RUN;
  let maxEntries: number | undefined;
  try {
    const body = req.headers.get('content-type')?.toLowerCase().includes('application/json')
      ? await req.json().catch(() => ({}))
      : {};
    const b = body as { max_logs?: number; max_entries?: number };
    if (typeof b.max_entries === 'number' && b.max_entries >= 1) {
      maxEntries = Math.min(50, Math.floor(b.max_entries));
    }
    if (typeof b.max_logs === 'number' && b.max_logs >= 1 && maxEntries == null) {
      maxLogs = Math.min(100, Math.floor(b.max_logs));
    }
  } catch {
    // usa default
  }

  try {
    const { data: logs, error: logsError } = await supabaseServiceRole
      .from('admin_lead_transfer_logs')
      .select('id, banca_id, created_at, deadline_days')
      .order('created_at', { ascending: false });

    if (logsError || !logs?.length) {
      return successResponse({ results: [], total_resolved: 0, total_vinculado: 0, total_disponivel: 0, remaining_logs: 0, message: 'Nenhum log.' });
    }

    const expired = (logs as { id: string; banca_id: string; created_at: string; deadline_days?: number | null }[]).filter((log) =>
      isTransferExpired(log.created_at, log.deadline_days ?? DEFAULT_DEADLINE_DAYS)
    );
    if (expired.length === 0) {
      return successResponse({ results: [], total_resolved: 0, total_vinculado: 0, total_disponivel: 0, remaining_logs: 0, message: 'Nenhuma transferência expirada.' });
    }

    const expiredIds = expired.map((l) => l.id);
    const { data: pendingRows } = await supabaseServiceRole
      .from('admin_lead_transfer_entries')
      .select('transfer_log_id')
      .in('transfer_log_id', expiredIds)
      .eq('resolution_status', 'pending');

    const logsWithPending = new Set<string>();
    (pendingRows ?? []).forEach((r: { transfer_log_id: string }) => logsWithPending.add(r.transfer_log_id));
    const toResolveFull = expired.filter((log) => logsWithPending.has(log.id));
    if (toResolveFull.length === 0) {
      return successResponse({ results: [], total_resolved: 0, total_vinculado: 0, total_disponivel: 0, remaining_logs: 0, message: 'Nenhuma transferência expirada com leads pendentes.' });
    }

    const useMaxEntries = maxEntries != null;
    const toResolve = useMaxEntries ? toResolveFull.slice(0, 1) : toResolveFull.slice(0, maxLogs);
    const bancaIds = [...new Set(toResolve.map((l) => l.banca_id))];
    const { data: bancas } = await supabaseServiceRole.from('crm_bancas').select('id, url').in('id', bancaIds);
    const crmUrlByBancaId = new Map<string, string>();
    (bancas ?? []).forEach((b: { id: string; url?: string | null }) => {
      const url = (b.url ?? '').trim().replace(/\/+$/, '');
      if (url) crmUrlByBancaId.set(b.id, url);
    });

    const results: Array<{ log_id: string; banca_id: string; resolved: number; vinculado: number; disponivel_retransferencia: number; message: string }> = [];
    const allConverted: ConvertedLead[] = [];
    let total_resolved = 0;
    let total_vinculado = 0;
    let total_disponivel = 0;
    let remainingCount: number;

    if (useMaxEntries && toResolve.length > 0) {
      const log = toResolve[0];
      const crmBaseUrl = crmUrlByBancaId.get(log.banca_id) ?? null;
      const result = await resolveOneTransferLog(
        { bancaId: log.banca_id, crmBaseUrl },
        log.id,
        { maxEntries: maxEntries ?? DEFAULT_MAX_ENTRIES_PER_RUN }
      );
      results.push({
        log_id: log.id,
        banca_id: log.banca_id,
        resolved: result.resolved,
        vinculado: result.vinculado,
        disponivel_retransferencia: result.disponivel_retransferencia,
        message: result.message,
      });
      total_resolved = result.resolved;
      total_vinculado = result.vinculado;
      total_disponivel = result.disponivel_retransferencia;
      if (result.converted?.length) allConverted.push(...result.converted);
      remainingCount = result.hasMorePendingInLog ? toResolveFull.length : Math.max(0, toResolveFull.length - 1);
    } else {
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
        if (result.converted?.length) allConverted.push(...result.converted);
      }
      remainingCount = toResolveFull.length - toResolve.length;
    }

    if (allConverted.length > 0) {
      console.log('\n========== [resolve-expired-transfers] RELATÓRIO FINAL - CONVERTIDOS ==========');
      console.log(`Total convertidos (vinculados): ${allConverted.length}`);
      console.log('---');
      allConverted.forEach((c, i) => {
        console.log(`  ${i + 1}. Lead ${c.lead_id} | Consultor: ${c.consultant_email} | Banca: ${c.banca_id}`);
      });
      console.log('===============================================================================\n');
    } else {
      console.log('\n[resolve-expired-transfers] Nenhum lead convertido nesta execução.\n');
    }

    const message =
      remainingCount > 0
        ? `Resolvidas ${results.length} transferência(s) nesta execução (${remainingCount} restante(s) na próxima). ${total_vinculado} vinculado(s), ${total_disponivel} disponível(is) para repasse.`
        : `Resolvidas ${results.length} transferência(s): ${total_vinculado} vinculado(s), ${total_disponivel} disponível(is) para repasse.`;

    return successResponse({
      results,
      total_resolved,
      total_vinculado,
      total_disponivel,
      remaining_logs: remainingCount,
      message,
    });
  } catch (err: unknown) {
    console.error('[cron][resolve-expired-transfers] error:', err);
    return serverErrorResponse(err as Error);
  }
}
