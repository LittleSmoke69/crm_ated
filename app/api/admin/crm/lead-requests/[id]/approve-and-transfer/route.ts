import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { requireAdminLeadTransferContext, isConsultantInBanca } from '@/lib/server/crm/adminLeadTransferContext';
import { assertGerenteHasBanca } from '@/lib/server/crm/gerenteLeadStock';
import { createCrmRedistributionClient, type IndicatedDetail } from '@/lib/server/crm/crmRedistributionClient';

const LOG_PREFIX = '[admin/crm/lead-requests][approve-and-transfer]';
const LEAD_TYPES = ['registered', 'with_balance', 'has_won', 'has_withdrawn'] as const;
const DETAIL_PAGE_SIZE = 2000;
const MAX_DETAIL_PAGES = 15;

/** Distribui um inteiro `total` proporcionalmente a `weights` (maiores restos primeiro). */
function splitIntegerProportional(weights: number[], total: number): number[] {
  const n = weights.length;
  if (n === 0 || total <= 0) return weights.map(() => 0);
  const sumW = weights.reduce((a, b) => a + b, 0);
  if (sumW <= 0) return weights.map(() => 0);
  const exact = weights.map((w) => (total * w) / sumW);
  const floors = exact.map((x) => Math.floor(x));
  let rem = total - floors.reduce((a, b) => a + b, 0);
  const fractional = exact.map((x, i) => ({ i, frac: x - Math.floor(x) })).sort((a, b) => b.frac - a.frac);
  for (let k = 0; k < rem; k++) {
    floors[fractional[k].i] += 1;
  }
  return floors;
}

/** Embaralha array (Fisher-Yates) */
function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Verifica se o lead atende a pelo menos um dos tipos selecionados (usando dados enriquecidos). */
function leadMatchesTypes(lead: Record<string, unknown>, types: string[]): boolean {
  const balance = parseFloat(String(lead.balance ?? lead.saldo ?? 0)) || 0;
  const totalDepositado = parseFloat(String(lead.total_depositado ?? 0)) || 0;
  const totalGanho = parseFloat(String(lead.total_ganho ?? 0)) || 0;
  const availableWithdraw = parseFloat(String(lead.available_withdraw ?? 0)) || 0;

  for (const t of types) {
    if (t === 'registered' && totalDepositado <= 0) return true;
    if (t === 'with_balance' && balance > 0) return true;
    if (t === 'has_won' && totalGanho > 0) return true;
    if (t === 'has_withdrawn' && availableWithdraw > 0) return true;
  }
  return false;
}

/**
 * POST /api/admin/crm/lead-requests/[id]/approve-and-transfer
 * Aprova a solicitação, busca leads do doador conforme os tipos, verifica disponibilidade, seleciona aleatoriamente e executa as transferências (um lote por recebedor).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId, profile } = await requireAdmin(req);
    const { id: requestId } = await params;
    if (!requestId) return errorResponse('ID da solicitação é obrigatório.', 400);

    const body = await req.json();
    const {
      lead_type: leadTypeParam,
      consultores,
      source_consultant_id: sourceConsultantId,
      source_consultant_email: sourceConsultantEmailParam,
      banca_id: bancaIdParam,
      transfer_mode: transferModeRaw,
      to_gerente_stock_gerente_id: toGerenteStockGerenteIdBody,
      direct_lead_count: directLeadCountBody,
      stock_lead_count: stockLeadCountBody,
    } = body;

    const toGerenteStockGerenteId =
      typeof toGerenteStockGerenteIdBody === 'string' ? toGerenteStockGerenteIdBody.trim() : '';

    const leadTypes = Array.isArray(leadTypeParam)
      ? leadTypeParam.filter((t: unknown) => typeof t === 'string' && LEAD_TYPES.includes(t as typeof LEAD_TYPES[number]))
      : typeof leadTypeParam === 'string' && LEAD_TYPES.includes(leadTypeParam as typeof LEAD_TYPES[number])
        ? [leadTypeParam]
        : [];
    if (leadTypes.length === 0) return errorResponse('Selecione ao menos um tipo de lead.', 400);

    if (!sourceConsultantId || typeof sourceConsultantId !== 'string' || !sourceConsultantId.trim()) {
      return errorResponse('Informe o consultor doador (source_consultant_id).', 400);
    }

    const consultoresList = Array.isArray(consultores) ? consultores : [];
    const validConsultores = consultoresList.filter(
      (c: unknown) => typeof c === 'object' && c !== null && 'consultor_id' in c && 'quantity' in c && (c as { quantity: number }).quantity > 0
    );
    if (validConsultores.length === 0) return errorResponse('Informe ao menos um consultor recebedor com quantidade.', 400);

    const totalNeeded = validConsultores.reduce((s: number, c: { quantity: number }) => s + c.quantity, 0);

    const { data: requestRow, error: fetchReqError } = await supabaseServiceRole
      .from('gerente_lead_requests')
      .select('id, status, banca_id, gerente_name')
      .eq('id', requestId)
      .single();

    if (fetchReqError || !requestRow) return errorResponse('Solicitação não encontrada.', 404);
    if (requestRow.status !== 'pending' && requestRow.status !== 'partial') return errorResponse('Esta solicitação já foi processada.', 400);

    const bancaId = (bancaIdParam ?? requestRow.banca_id)?.trim();
    if (!bancaId) return errorResponse('Banca não definida na solicitação. Selecione a banca no modal.', 400);

    const ctx = await requireAdminLeadTransferContext(req, bancaId);
    if (!ctx) return errorResponse('Banca não encontrada ou sem permissão.', 400);

    const hasExplicitSplit =
      typeof directLeadCountBody === 'number' &&
      Number.isFinite(directLeadCountBody) &&
      typeof stockLeadCountBody === 'number' &&
      Number.isFinite(stockLeadCountBody);

    let directCount: number;
    let stockCount: number;
    if (hasExplicitSplit) {
      directCount = Math.max(0, Math.floor(directLeadCountBody as number));
      stockCount = Math.max(0, Math.floor(stockLeadCountBody as number));
      if (directCount + stockCount !== totalNeeded) {
        return errorResponse(
          `Direto (${directCount}) + estoque (${stockCount}) deve somar ${totalNeeded} (total da solicitação).`,
          400
        );
      }
    } else {
      const legacyMode = transferModeRaw === 'gerente_stock' ? 'gerente_stock' : 'direct';
      if (legacyMode === 'gerente_stock') {
        directCount = 0;
        stockCount = totalNeeded;
      } else {
        directCount = totalNeeded;
        stockCount = 0;
      }
    }

    const transferModeEffective: 'direct' | 'gerente_stock' | 'mixed' =
      directCount > 0 && stockCount > 0 ? 'mixed' : stockCount > 0 ? 'gerente_stock' : 'direct';

    if (stockCount > 0) {
      if (profile.status !== 'admin' && profile.status !== 'super_admin') {
        return errorResponse('Apenas administrador ou super administrador podem enviar leads ao estoque do gerente.', 403);
      }
      if (!toGerenteStockGerenteId) {
        return errorResponse('Informe o gerente do estoque (to_gerente_stock_gerente_id).', 400);
      }
      const gerenteOk = await assertGerenteHasBanca(toGerenteStockGerenteId, ctx.bancaId);
      if (!gerenteOk) {
        return errorResponse('Gerente não está vinculado a esta banca.', 400);
      }
    }

    const { data: sourceProfile } = await supabaseServiceRole
      .from('profiles')
      .select('id, email')
      .eq('id', sourceConsultantId.trim())
      .single();
    const sourceEmail = (sourceConsultantEmailParam ?? sourceProfile?.email)?.trim();
    if (!sourceEmail) return errorResponse('E-mail do consultor doador não encontrado.', 400);

    const emailById = new Map<string, string>();
    const targetIds = [...new Set(validConsultores.map((c: { consultor_id: string }) => String(c.consultor_id).trim()))];
    const { data: targetProfiles } = await supabaseServiceRole.from('profiles').select('id, email').in('id', targetIds);
    (targetProfiles ?? []).forEach((p: { id: string; email: string | null }) => {
      if (p.email) emailById.set(p.id, p.email.trim());
    });
    for (const c of validConsultores) {
      if (!emailById.has(c.consultor_id)) {
        return errorResponse(`E-mail do consultor recebedor não encontrado: ${c.consultor_id}`, 400);
      }
    }

    if (directCount > 0) {
      // Doador pode ser qualquer usuário do sistema; a disponibilidade de leads é validada no CRM abaixo.
      for (const c of validConsultores) {
        const email = emailById.get(c.consultor_id);
        if (email && !(await isConsultantInBanca(ctx.bancaId, email))) {
          return errorResponse(`O consultor recebedor ${email} não pertence à banca.`, 400);
        }
      }
    }

    if (stockCount > 0) {
      const primary = validConsultores[0] as { consultor_id: string };
      const stockCrmTarget = (emailById.get(primary.consultor_id) ?? '').trim().toLowerCase();
      if (!stockCrmTarget) {
        return errorResponse('Não foi possível resolver o e-mail do consultor recebedor para o estoque.', 400);
      }
      if (!(await isConsultantInBanca(ctx.bancaId, stockCrmTarget))) {
        return errorResponse('O consultor recebedor da solicitação não pertence à banca (destino CRM ao sair do estoque).', 400);
      }
    }

    const client = createCrmRedistributionClient(ctx.crmBaseUrl);
    console.log(`${LOG_PREFIX} Aplicando filtros do modal: lead_types=${leadTypes.join(',')}`);
    const redistributionResult = await client.getRedistributionLeads({
      source_consultant_email: sourceEmail,
      days_inactive: 0,
      lead_types: leadTypes,
    });
    if (!redistributionResult.success || !Array.isArray(redistributionResult.data)) {
      return errorResponse(redistributionResult.error ?? 'Erro ao buscar leads do doador no CRM.', 400);
    }
    const baseLeadIds = (redistributionResult.data as { id: number | string }[]).map((l) => String(l.id));
    if (baseLeadIds.length === 0) {
      return errorResponse('O consultor doador não possui leads disponíveis (não transferidos) para os critérios.', 400);
    }

    const detailsById = new Map<string, IndicatedDetail>();
    let page = 1;
    let hasMore = true;
    while (hasMore && page <= MAX_DETAIL_PAGES) {
      const detailResult = await client.getIndicatedsByConsultant(sourceEmail, DETAIL_PAGE_SIZE, page, {
        transferredFilter: 'no',
        sort: 'created_at',
        direction: 'desc',
        leadTypes,
      });
      if (!detailResult.success || !Array.isArray(detailResult.data)) break;
      const chunk = detailResult.data as IndicatedDetail[];
      for (const d of chunk) {
        const id = d?.id != null ? String(d.id) : '';
        if (id) detailsById.set(id, d);
      }
      const lastPage = detailResult.pagination?.last_page ?? 1;
      if (chunk.length < DETAIL_PAGE_SIZE || page >= lastPage) hasMore = false;
      else page++;
    }

    const enrichedLeads: Record<string, unknown>[] = baseLeadIds.map((id) => {
      const detail = detailsById.get(id);
      const balance = detail?.balance ?? (detail as Record<string, unknown>)?.saldo;
      return {
        id,
        balance: balance != null ? Number(balance) : 0,
        total_depositado: detail?.total_depositado,
        total_apostado: detail?.total_apostado,
        total_ganho: detail?.total_ganho,
        available_withdraw: detail?.available_withdraw,
        total_saque: detail?.total_saque,
        last_interaction: (detail as Record<string, unknown>)?.last_deposit_at,
      };
    });

    const matchingLeads = enrichedLeads.filter((l) => leadMatchesTypes(l, leadTypes));
    console.log(
      `${LOG_PREFIX} Filtros do modal aplicados: ${leadTypes.join(', ')}. Leads antes: ${enrichedLeads.length}, após filtro: ${matchingLeads.length} (necessário: ${totalNeeded})`
    );
    if (matchingLeads.length < totalNeeded) {
      return errorResponse(
        `O consultor doador não possui leads suficientes que atendam aos filtros selecionados. Necessário: ${totalNeeded}, disponível: ${matchingLeads.length}.`,
        400
      );
    }

    const shuffled = shuffle(matchingLeads);
    const selected = shuffled.slice(0, totalNeeded);
    const selectedIds = selected.map((l) => l.id as string);
    const snapshotByLeadId = new Map<
      string,
      {
        email?: string | null;
        balance?: number;
        total_depositado?: number;
        total_apostado?: number;
        total_ganho?: number;
        available_withdraw?: number;
        total_saque?: number;
        last_interaction?: string | null;
      }
    >();
    for (const l of selected) {
      const id = String(l.id);
      const em = (l as { email?: string | null }).email;
      snapshotByLeadId.set(id, {
        email: em != null && String(em).trim() !== '' ? String(em).trim().toLowerCase() : null,
        balance: l.balance != null ? Number(l.balance) : undefined,
        total_depositado: l.total_depositado != null ? Number(l.total_depositado) : undefined,
        total_apostado: l.total_apostado != null ? Number(l.total_apostado) : undefined,
        total_ganho: l.total_ganho != null ? Number(l.total_ganho) : undefined,
        available_withdraw: l.available_withdraw != null ? Number(l.available_withdraw) : undefined,
        total_saque: l.total_saque != null ? Number(l.total_saque) : undefined,
        last_interaction: (l.last_interaction as string) ?? null,
      });
    }

    const origin = req.url ? new URL(req.url).origin : (process.env.NEXTAUTH_URL ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000'));
    const approvedAtIso = new Date().toISOString();
    const transferResults: { consultor_id: string; consultor_email: string; quantity_requested: number; quantity_transferred: number; transfer_log_id: string | null; lead_ids: string[]; channel?: 'crm_direct' | 'gerente_stock' }[] =
      [];

    let gerenteStockDisplayName = '';
    if (stockCount > 0 && toGerenteStockGerenteId) {
      const { data: gp } = await supabaseServiceRole
        .from('profiles')
        .select('full_name, email')
        .eq('id', toGerenteStockGerenteId)
        .maybeSingle();
      gerenteStockDisplayName = (
        (gp?.full_name ?? '').trim() ||
        (gp?.email ?? '').trim() ||
        toGerenteStockGerenteId
      ).trim();
    }

    const directLeadIds = directCount > 0 ? selectedIds.slice(0, directCount) : [];
    const stockLeadIds = stockCount > 0 ? selectedIds.slice(directCount, directCount + stockCount) : [];

    const mapSnapshots = (batchIds: string[]) =>
      batchIds.map((leadId) => {
        const snap = snapshotByLeadId.get(String(leadId));
        return {
          lead_id: leadId,
          email: snap?.email ?? null,
          balance: snap?.balance ?? null,
          last_interaction: snap?.last_interaction ?? null,
          total_depositado: snap?.total_depositado ?? null,
          total_apostado: snap?.total_apostado ?? null,
          total_ganho: snap?.total_ganho ?? null,
          available_withdraw: snap?.available_withdraw ?? null,
          total_saque: snap?.total_saque ?? null,
        };
      });

    if (directCount > 0 && directLeadIds.length > 0) {
      const weights = validConsultores.map((c: { quantity: number }) => c.quantity);
      const amounts = splitIntegerProportional(weights, directCount);
      let offsetDirect = 0;
      for (let i = 0; i < validConsultores.length; i++) {
        const rec = validConsultores[i];
        const amt = amounts[i] ?? 0;
        const batchIds = directLeadIds.slice(offsetDirect, offsetDirect + amt);
        offsetDirect += amt;
        if (batchIds.length === 0) continue;
        const targetEmail = emailById.get(rec.consultor_id)!;
        const leadSnapshots = mapSnapshots(batchIds);
        const res = await fetch(`${origin}/api/admin/crm/redistribute-leads`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
          body: JSON.stringify({
            banca_id: ctx.bancaId,
            source_consultant_email: sourceEmail,
            target_consultant_email: targetEmail,
            leads_ids: batchIds,
            transfer_type: 'TF',
            gerente_destino_crm_direto: true,
            filters_snapshot: {
              lead_types: leadTypes,
              from_solicitation: requestId,
              split_direct_portion: directCount,
              split_stock_portion: stockCount,
            },
            lead_snapshots: leadSnapshots,
          }),
        });
        const json = await res.json();
        if (!res.ok || !json.success) {
          return errorResponse(json?.error ?? 'Erro ao transferir um dos lotes de leads. Tente novamente ou realize a transferência manual.', 400);
        }
        const countTransferred = json?.data?.count ?? batchIds.length;
        transferResults.push({
          consultor_id: rec.consultor_id,
          consultor_email: targetEmail,
          quantity_requested: amt,
          quantity_transferred: countTransferred,
          transfer_log_id: json?.data?.transfer_log_id ?? null,
          lead_ids: batchIds,
          channel: 'crm_direct',
        });
      }
    }

    if (stockCount > 0 && stockLeadIds.length > 0 && toGerenteStockGerenteId) {
      const leadSnapshots = mapSnapshots(stockLeadIds);
      const resStock = await fetch(`${origin}/api/admin/crm/redistribute-leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
        body: JSON.stringify({
          banca_id: ctx.bancaId,
          source_consultant_email: sourceEmail,
          to_gerente_stock_gerente_id: toGerenteStockGerenteId,
          leads_ids: stockLeadIds,
          transfer_type: 'TF',
          transfer_deadline_days: 10,
          filters_snapshot: {
            lead_types: leadTypes,
            from_solicitation: requestId,
            approve_transfer_mode: 'gerente_stock',
            split_direct_portion: directCount,
            split_stock_portion: stockCount,
            stock_crm_target_consultant_email: (emailById.get(validConsultores[0].consultor_id) ?? '').trim().toLowerCase(),
          },
          lead_snapshots: leadSnapshots,
        }),
      });
      const jsonStock = await resStock.json();
      if (!resStock.ok || !jsonStock.success) {
        return errorResponse(
          jsonStock?.error ?? 'Erro ao reservar leads no estoque do gerente. Tente novamente ou use a transferência manual.',
          400
        );
      }
      const countTransferred = jsonStock?.data?.count ?? stockLeadIds.length;
      transferResults.push({
        consultor_id: toGerenteStockGerenteId,
        consultor_email: gerenteStockDisplayName ? `estoque:${gerenteStockDisplayName}` : `stock:${toGerenteStockGerenteId}`,
        quantity_requested: stockCount,
        quantity_transferred: countTransferred,
        transfer_log_id: jsonStock?.data?.transfer_log_id ?? null,
        lead_ids: stockLeadIds,
        channel: 'gerente_stock',
      });
    }

    const transferLogIds = transferResults.map((r) => r.transfer_log_id).filter(Boolean) as string[];
    const approvalSnapshot = {
      approved_at_iso: approvedAtIso,
      approved_by_user_id: userId,
      banca_id: bancaId,
      source_consultant_id: sourceConsultantId.trim(),
      source_consultant_email: sourceEmail,
      lead_types: [...new Set(leadTypes)],
      total_leads_transferred: totalNeeded,
      total_receivers: validConsultores.length,
      receivers: transferResults,
      transfer_log_ids: transferLogIds,
      filters_applied: {
        lead_types: leadTypes,
        from_solicitation: requestId,
        transfer_mode_effective: transferModeEffective,
        direct_lead_count: directCount,
        stock_lead_count: stockCount,
        ...(stockCount > 0 && toGerenteStockGerenteId
          ? {
              to_gerente_stock_gerente_id: toGerenteStockGerenteId,
              gerente_stock_display_name: gerenteStockDisplayName || undefined,
            }
          : {}),
      },
      consultores_requested: validConsultores,
    };

    const { error: updateError } = await supabaseServiceRole
      .from('gerente_lead_requests')
      .update({
        status: 'approved',
        approved_by_user_id: userId,
        approved_at: approvedAtIso,
        source_consultant_id: sourceConsultantId.trim(),
        source_consultant_email: sourceEmail,
        banca_id: bancaId,
        lead_type: [...new Set(leadTypes)].join(','),
        consultores: validConsultores,
        approval_snapshot: approvalSnapshot,
      })
      .eq('id', requestId);

    if (updateError) {
      console.error(`${LOG_PREFIX} Update request error:`, updateError);
      return errorResponse('Transferências realizadas, mas falha ao atualizar status da solicitação.', 500);
    }

    const msgParts: string[] = [];
    if (directCount > 0) msgParts.push(`${directCount} direto (CRM)`);
    if (stockCount > 0) msgParts.push(`${stockCount} reservado(s) no estoque${gerenteStockDisplayName ? ` (${gerenteStockDisplayName})` : ''}`);
    const summaryMsg =
      msgParts.length > 0
        ? `Solicitação atendida: ${msgParts.join('; ')}.`
        : `${totalNeeded} lead(s) processado(s) com sucesso.`;

    return successResponse(
      {
        total_transferred: totalNeeded,
        direct_lead_count: directCount,
        stock_lead_count: stockCount,
        transfer_mode_effective: transferModeEffective,
        receivers: validConsultores.length,
      },
      summaryMsg
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Acesso negado') || msg.includes('não tem permissão')) return errorResponse(msg, 403);
    console.error(`${LOG_PREFIX} Error:`, err);
    return serverErrorResponse(err);
  }
}
