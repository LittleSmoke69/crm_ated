import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { getAdminBancaId } from '@/lib/server/crm/adminLeadTransferContext';
import { createCrmRedistributionClient } from '@/lib/server/crm/crmRedistributionClient';

const LOG_PREFIX = '[admin][transfer-logs][backfill-balances]';

/**
 * POST /api/admin/crm/transfer-logs/backfill-balances
 *
 * - Com log_id: apenas SOMA os saldo_snapshot já gravados nas entries dessa transferência e retorna
 *   o total. NÃO chama o CRM e NÃO altera nenhum dado (evita zerar saldos, pois os leads já
 *   pertencem ao consultor destino e o CRM não retornaria os valores do consultor origem).
 *
 * - Sem log_id: backfill para entries com saldo NULL (busca no CRM por consultor origem e preenche).
 *
 * Query/body: banca_id (obrigatório se log_id for informado). log_id (opcional) = só retornar a soma.
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

    // Recalcular total de uma transferência: só ler entries e somar saldo_snapshot (não altera nada)
    if (logIdParam && bancaIdParam) {
      const resolved = await getAdminBancaId(userId, profile, bancaIdParam);
      if (!resolved) {
        return errorResponse('Banca não encontrada ou sem permissão.', 403);
      }
      const { data: entries, error: fetchError } = await supabaseServiceRole
        .from('admin_lead_transfer_entries')
        .select('id, saldo_snapshot')
        .eq('banca_id', resolved.bancaId)
        .eq('transfer_log_id', logIdParam);

      if (fetchError) {
        console.error(`${LOG_PREFIX} GET entries error (log_id):`, fetchError);
        return errorResponse('Erro ao buscar leads da transferência.', 500);
      }

      const list = Array.isArray(entries) ? entries : [];
      const totalBalance = list.reduce((sum, e) => sum + (e.saldo_snapshot != null ? Number(e.saldo_snapshot) : 0), 0);

      const { error: updateLogError } = await supabaseServiceRole
        .from('admin_lead_transfer_logs')
        .update({ total_balance_snapshot: totalBalance })
        .eq('id', logIdParam);

      const columnMissing = updateLogError?.code === 'PGRST204' || (updateLogError?.message ?? '').includes('total_balance_snapshot');
      if (updateLogError && !columnMissing) {
        console.error(`${LOG_PREFIX} UPDATE log total_balance_snapshot error:`, updateLogError);
        return errorResponse('Erro ao gravar total saldo no registro da transferência.', 500);
      }
      if (columnMissing) {
        console.warn(`${LOG_PREFIX} Coluna total_balance_snapshot não existe. Execute a migration add_total_balance_snapshot_to_transfer_logs.sql no Supabase.`);
      } else {
        console.log(`${LOG_PREFIX} Total saldo gravado no log log_id=${logIdParam}: ${list.length} leads, total=${totalBalance}`);
      }

      const message = columnMissing
        ? `Total saldo: R$ ${totalBalance.toFixed(2).replace('.', ',')} (${list.length} lead(s)). Execute a migration no Supabase para gravar na tabela principal.`
        : `Total saldo: R$ ${totalBalance.toFixed(2).replace('.', ',')} (${list.length} lead(s)). Atualizado na tabela principal.`;

      return successResponse({
        updated: 0,
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
        .select('id, transfer_log_id, banca_id, lead_id, source_consultant_email')
        .eq('banca_id', bancaId)
        .is('saldo_snapshot', null);

      if (fetchError) {
        errors.push(`Banca ${bancaId}: ${fetchError.message}`);
        continue;
      }

      const list = Array.isArray(entries) ? entries : [];
      if (list.length === 0) continue;

      const byConsultant = new Map<string, typeof list>();
      for (const e of list) {
        const email = (e.source_consultant_email ?? '').trim().toLowerCase();
        if (!email) continue;
        if (!byConsultant.has(email)) {
          byConsultant.set(email, []);
        }
        byConsultant.get(email)!.push(e);
      }

      const client = createCrmRedistributionClient(crmBaseUrl);

      for (const [consultantEmail, groupEntries] of byConsultant) {
        try {
          const result = await client.getIndicatedsByConsultant(consultantEmail, 2000);
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
            const balance = balanceByLeadId.get(leadId) ?? 0;
            const hadBalance = balance > 0;

            const { error: updateError } = await supabaseServiceRole
              .from('admin_lead_transfer_entries')
              .update({
                saldo_snapshot: balance,
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
          errors.push(`CRM ${consultantEmail} (banca ${bancaId}): ${msg}`);
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
