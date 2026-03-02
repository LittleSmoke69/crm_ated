import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { getAdminBancaId } from '@/lib/server/crm/adminLeadTransferContext';
import { createCrmRedistributionClient } from '@/lib/server/crm/crmRedistributionClient';

const LOG_PREFIX = '[admin][transfer-logs][backfill-balances]';

/** Tamanho do lote ao buscar leads no CRM (recalcular saldo em segundo plano). */
const BATCH_SIZE = 2000;

/**
 * POST /api/admin/crm/transfer-logs/backfill-balances
 *
 * - Com log_id + banca_id: busca no CRM os saldos dos leads transferidos (consultor destino,
 *   transferred_filter=yes), atualiza saldo_snapshot em cada entry dessa transferência, soma e
 *   grava total_balance_snapshot no log. Assim "Recalcular saldo" preenche e exibe o total correto.
 *
 * - Sem log_id: backfill para todas as entries com saldo NULL (agrupadas por banca).
 *
 * Query/body: banca_id (obrigatório se log_id for informado). log_id (opcional).
 */
export async function POST(req: NextRequest) {
  try {
    const { userId, profile } = await requireAdmin(req);

    let bancaIdParam = req.nextUrl.searchParams.get('banca_id')?.trim() || null;
    let logIdParam = req.nextUrl.searchParams.get('log_id')?.trim() || null;
    if (req.headers.get('content-type')?.toLowerCase().includes('application/json')) {
      try {
        const body = await req.json();
        const b = body as { banca_id?: string; log_id?: string };
        if (!bancaIdParam) bancaIdParam = b?.banca_id?.trim() || null;
        if (!logIdParam) logIdParam = b?.log_id?.trim() || null;
      } catch {
        // body vazio ou inválido
      }
    }

    if (logIdParam && !bancaIdParam) {
      return errorResponse('banca_id é obrigatório quando log_id é informado.', 400);
    }

    // Recalcular para uma transferência: buscar saldos no CRM (leads transferidos), atualizar entries e somar no log
    if (logIdParam && bancaIdParam) {
      const resolved = await getAdminBancaId(userId, profile, bancaIdParam);
      if (!resolved) {
        return errorResponse('Banca não encontrada ou sem permissão.', 403);
      }

      const { data: entries, error: fetchError } = await supabaseServiceRole
        .from('admin_lead_transfer_entries')
        .select('id, lead_id, target_consultant_email, saldo_snapshot')
        .eq('banca_id', resolved.bancaId)
        .eq('transfer_log_id', logIdParam);

      if (fetchError) {
        console.error(`${LOG_PREFIX} GET entries error (log_id):`, fetchError);
        return errorResponse('Erro ao buscar leads da transferência.', 500);
      }

      const list = Array.isArray(entries) ? entries : [];
      if (list.length === 0) {
        return successResponse({
          updated: 0,
          totalBalance: 0,
          message: 'Nenhum lead nesta transferência.',
        });
      }

      const byTarget = new Map<string, typeof list>();
      for (const e of list) {
        const email = (e.target_consultant_email ?? '').trim().toLowerCase();
        if (!email) continue;
        if (!byTarget.has(email)) byTarget.set(email, []);
        byTarget.get(email)!.push(e);
      }

      const client = createCrmRedistributionClient(resolved.crmBaseUrl);
      let totalUpdated = 0;

      const updateLogTotal = async () => {
        const { data: entriesSum, error: sumError } = await supabaseServiceRole
          .from('admin_lead_transfer_entries')
          .select('id, saldo_snapshot')
          .eq('banca_id', resolved.bancaId)
          .eq('transfer_log_id', logIdParam);
        if (sumError) return;
        const total = (Array.isArray(entriesSum) ? entriesSum : []).reduce((s, e) => s + (e.saldo_snapshot != null ? Number(e.saldo_snapshot) : 0), 0);
        await supabaseServiceRole
          .from('admin_lead_transfer_logs')
          .update({ total_balance_snapshot: total })
          .eq('id', logIdParam);
      };

      for (const [targetEmail, groupEntries] of byTarget) {
        try {
          let page = 1;
          let hasMore = true;
          while (hasMore) {
            const result = await client.getIndicatedsByConsultant(targetEmail, BATCH_SIZE, page, {
              transferredFilter: 'yes',
              sort: 'created_at',
              direction: 'desc',
            });
            const details = Array.isArray(result.data) ? result.data : [];
            const balanceByLeadId = new Map<string, number>();
            for (const d of details) {
              const id = d?.id != null ? String(d.id) : '';
              if (!id) continue;
              const raw = (d as { balance?: number; saldo?: number }).balance ?? (d as { balance?: number; saldo?: number }).saldo;
              const balance = raw != null ? Number(raw) : 0;
              balanceByLeadId.set(id, Number.isFinite(balance) ? balance : 0);
            }

            for (const entry of groupEntries) {
              const leadId = String(entry.lead_id ?? '');
              if (!balanceByLeadId.has(leadId)) continue;
              const balance = balanceByLeadId.get(leadId)!;
              const hadBalance = balance > 0;
              const saldoToSave = Number.isFinite(balance) ? balance : 0;

              const { error: updateError } = await supabaseServiceRole
                .from('admin_lead_transfer_entries')
                .update({ saldo_snapshot: saldoToSave, had_balance: hadBalance })
                .eq('id', entry.id);

              if (!updateError) totalUpdated += 1;
            }

            await updateLogTotal();

            const lastPage = result.pagination?.last_page ?? 1;
            if (details.length < BATCH_SIZE || page >= lastPage) hasMore = false;
            else page += 1;
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`${LOG_PREFIX} CRM failed for log ${logIdParam} target ${targetEmail}:`, msg);
        }
      }

      const { data: entriesAfter, error: fetchAfterError } = await supabaseServiceRole
        .from('admin_lead_transfer_entries')
        .select('id, saldo_snapshot')
        .eq('banca_id', resolved.bancaId)
        .eq('transfer_log_id', logIdParam);

      if (fetchAfterError) {
        console.error(`${LOG_PREFIX} GET entries after update error:`, fetchAfterError);
        return errorResponse('Erro ao somar saldos após atualização.', 500);
      }

      const listAfter = Array.isArray(entriesAfter) ? entriesAfter : [];
      const totalBalance = listAfter.reduce((sum, e) => sum + (e.saldo_snapshot != null ? Number(e.saldo_snapshot) : 0), 0);

      const { error: updateLogError } = await supabaseServiceRole
        .from('admin_lead_transfer_logs')
        .update({ total_balance_snapshot: totalBalance })
        .eq('id', logIdParam);

      const columnMissing = updateLogError?.code === 'PGRST204' || (updateLogError?.message ?? '').includes('total_balance_snapshot');
      if (updateLogError && !columnMissing) {
        console.error(`${LOG_PREFIX} UPDATE log total_balance_snapshot error:`, updateLogError);
        return errorResponse('Erro ao gravar total saldo no registro da transferência.', 500);
      }
      if (!columnMissing) {
        console.log(`${LOG_PREFIX} Recalc log_id=${logIdParam}: ${totalUpdated} entries atualizadas, total saldo=${totalBalance}`);
      }

      const message = columnMissing
        ? `Total saldo antes: R$ ${totalBalance.toFixed(2).replace('.', ',')} (${listAfter.length} lead(s)). Execute a migration no Supabase para gravar na tabela principal.`
        : `Total saldo antes: R$ ${totalBalance.toFixed(2).replace('.', ',')} (${listAfter.length} lead(s)). ${totalUpdated} saldo(s) atualizado(s) no CRM.`;

      return successResponse({
        updated: totalUpdated,
        totalBalance,
        message,
      });
    }

    const listBancas: { bancaId: string; crmBaseUrl: string }[] = [];

    if (bancaIdParam) {
      const resolved = await getAdminBancaId(userId, profile, bancaIdParam);
      if (!resolved) {
        return errorResponse('Banca não encontrada ou sem permissão.', 403);
      }
      listBancas.push({ bancaId: resolved.bancaId, crmBaseUrl: resolved.crmBaseUrl });
    } else {
      const { data: bancas } = await supabaseServiceRole
        .from('crm_bancas')
        .select('id, url')
        .not('url', 'is', null);
      const withUrl = (bancas ?? []).filter((b: { url?: string | null }) => b?.url?.trim());
      for (const b of withUrl) {
        const allowed = await getAdminBancaId(userId, profile, b.id);
        if (allowed) {
          listBancas.push({
            bancaId: b.id,
            crmBaseUrl: (b.url as string).trim().replace(/\/+$/, ''),
          });
        }
      }
    }

    if (listBancas.length === 0) {
      return successResponse({ updated: 0, totalBalance: null, message: 'Nenhuma banca para processar.' });
    }

    const errors: string[] = [];
    let totalUpdated = 0;

    for (const { bancaId, crmBaseUrl } of listBancas) {
      const { data: entries, error: fetchError } = await supabaseServiceRole
        .from('admin_lead_transfer_entries')
        .select('id, transfer_log_id, banca_id, lead_id, target_consultant_email')
        .eq('banca_id', bancaId)
        .is('saldo_snapshot', null);

      if (fetchError) {
        errors.push(`Banca ${bancaId}: ${fetchError.message}`);
        continue;
      }

      const list = Array.isArray(entries) ? entries : [];
      if (list.length === 0) continue;

      const byTargetConsultant = new Map<string, typeof list>();
      for (const e of list) {
        const email = (e.target_consultant_email ?? '').trim().toLowerCase();
        if (!email) continue;
        if (!byTargetConsultant.has(email)) {
          byTargetConsultant.set(email, []);
        }
        byTargetConsultant.get(email)!.push(e);
      }

      const client = createCrmRedistributionClient(crmBaseUrl);

      for (const [targetEmail, groupEntries] of byTargetConsultant) {
        try {
          const result = await client.getIndicatedsByConsultant(targetEmail, 2000, 1, {
            transferredFilter: 'yes',
            sort: 'created_at',
            direction: 'desc',
          });
          const details = Array.isArray(result.data) ? result.data : [];
          const balanceByLeadId = new Map<string, number>();
          for (const d of details) {
            const id = d?.id != null ? String(d.id) : '';
            if (!id) continue;
            const raw = (d as { balance?: number; saldo?: number }).balance ?? (d as { balance?: number; saldo?: number }).saldo;
            const balance = raw != null ? Number(raw) : 0;
            balanceByLeadId.set(id, Number.isFinite(balance) ? balance : 0);
          }

          for (const entry of groupEntries) {
            const leadId = String(entry.lead_id ?? '');
            const balance = balanceByLeadId.get(leadId);
            const hadBalance = balance != null && balance > 0;
            const saldoToSave = balance != null && Number.isFinite(balance) ? balance : 0;

            const { error: updateError } = await supabaseServiceRole
              .from('admin_lead_transfer_entries')
              .update({
                saldo_snapshot: saldoToSave,
                had_balance: hadBalance,
              })
              .eq('id', entry.id);

            if (updateError) {
              errors.push(`Entry ${entry.id}: ${updateError.message}`);
            } else {
              totalUpdated += 1;
            }
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`CRM ${targetEmail} (banca ${bancaId}): ${msg}`);
        }
      }
    }

    console.log(`${LOG_PREFIX} Backfill concluído: ${totalUpdated} entries atualizadas, ${errors.length} erros.`);
    return successResponse({
      updated: totalUpdated,
      errors: errors.length > 0 ? errors : undefined,
      message:
        totalUpdated > 0
          ? `${totalUpdated} saldo(s) de transferência preenchido(s).`
          : errors.length > 0
            ? 'Nenhum saldo atualizado. Verifique erros.'
            : 'Nenhuma entry sem saldo encontrada.',
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('não tem permissão') || message.includes('obrigatório')) {
      return errorResponse(message, 403);
    }
    console.error(`${LOG_PREFIX} Error:`, err);
    return serverErrorResponse(err);
  }
}
