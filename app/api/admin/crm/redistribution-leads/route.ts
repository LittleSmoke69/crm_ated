import { NextRequest } from 'next/server';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { requireAdminLeadTransferContext, isConsultantInBanca } from '@/lib/server/crm/adminLeadTransferContext';
import { createCrmRedistributionClient, type RedistributionLead } from '@/lib/server/crm/crmRedistributionClient';
import { z } from 'zod';

const balanceFilterEnum = z.enum(['all', 'with_balance', 'without_balance']);
const querySchema = z.object({
  banca_id: z.string().uuid(),
  source_consultant_email: z.string().email(),
  days_inactive: z.union([z.coerce.number().int().min(0), z.null()]).optional().transform((v) => (v == null ? undefined : v)),
  min_inactive_days: z.union([z.coerce.number().int().min(0), z.null()]).optional().transform((v) => (v == null ? undefined : v)),
  tag: z.union([z.string(), z.null()]).optional().transform((v) => (v == null ? undefined : v)),
  balance_filter: balanceFilterEnum.optional().default('all'),
});

const LOG_PREFIX = '[lead-transfer][redistribution-leads]';

/**
 * GET /api/admin/crm/redistribution-leads
 * Proxy para CRM: listar leads disponíveis para redistribuição.
 * Query: banca_id, source_consultant_email (obrigatórios); days_inactive?, tag?
 */
export async function GET(req: NextRequest) {
  const url = req.url ?? '';
  try {
    const { searchParams } = new URL(url);
    const bancaIdRaw = searchParams.get('banca_id');
    const emailRaw = searchParams.get('source_consultant_email');
    console.log(`${LOG_PREFIX} Request query: banca_id=${bancaIdRaw ?? 'null'}, source_consultant_email=${emailRaw ?? 'null'}`);

    const parsed = querySchema.safeParse({
      banca_id: bancaIdRaw,
      source_consultant_email: emailRaw,
      days_inactive: searchParams.get('days_inactive') ?? searchParams.get('min_inactive_days') ?? null,
      min_inactive_days: searchParams.get('min_inactive_days') ?? null,
      tag: searchParams.get('tag') ?? null,
      balance_filter: searchParams.get('balance_filter') ?? 'all',
    });

    if (!parsed.success) {
      const issues = parsed.error?.issues ?? [];
      const first = issues[0];
      const msg = first?.message ?? 'Parâmetros inválidos. banca_id e source_consultant_email são obrigatórios.';
      console.warn(`${LOG_PREFIX} Validação falhou (400):`, JSON.stringify(issues, null, 2));
      return errorResponse(msg, 400);
    }

    const { banca_id, source_consultant_email, days_inactive, min_inactive_days, tag, balance_filter } = parsed.data;
    const effectiveDaysInactive = days_inactive ?? min_inactive_days ?? 10;
    console.log(`${LOG_PREFIX} GET parsed params: banca_id=${banca_id}, source_consultant_email=${source_consultant_email}, days_inactive=${effectiveDaysInactive}, balance_filter=${balance_filter}, tag=${tag ?? 'n/a'}`);
    console.log(`${LOG_PREFIX} GET resolving context for banca_id=${banca_id}`);

    const ctx = await requireAdminLeadTransferContext(req, banca_id);
    console.log(`${LOG_PREFIX} GET context: userId=${ctx.userId}, bancaId=${ctx.bancaId}, crmBaseUrl=${ctx.crmBaseUrl}, bancaName=${ctx.bancaName ?? 'n/a'}`);

    const isInBanca = await isConsultantInBanca(ctx.bancaId, source_consultant_email);
    if (!isInBanca) {
      console.warn(`${LOG_PREFIX} Consultor não está na banca (400): email=${source_consultant_email}, bancaId=${ctx.bancaId}`);
      return errorResponse('Consultor origem não pertence à banca selecionada. Vincule o consultor à banca em Meu Perfil / Hierarquia.', 400);
    }

    // CRM é chamado na URL registrada da banca (crm_bancas.url), uma única barra antes de api; ex.: https://web.suabanca.site/api/crm/redistribution-leads?source_consultant_email=...
    const baseUrl = ctx.crmBaseUrl.replace(/\/+$/, '');
    console.log(`${LOG_PREFIX} Chamando CRM na URL da banca: ${baseUrl}/api/crm/redistribution-leads?source_consultant_email=${source_consultant_email}`);
    const client = createCrmRedistributionClient(ctx.crmBaseUrl);
    const result = await client.getRedistributionLeads({
      source_consultant_email,
      days_inactive: effectiveDaysInactive === 0 ? undefined : effectiveDaysInactive,
      tag: tag ?? undefined,
    });

    if (!result.success) {
      const msg = result.error ?? result.message ?? 'Erro ao buscar leads no CRM';
      console.error(`${LOG_PREFIX} CRM retornou erro (400):`, {
        message: msg,
        error: result.error,
        crmMessage: result.message,
        crmBaseUrl: ctx.crmBaseUrl,
        fullResult: JSON.stringify(result),
      });
      return errorResponse(msg, 400);
    }

    let leadsOut = result.data ?? [];

    if (leadsOut.length > 0) {
      const detailsResult = await client.getIndicatedsByConsultant(source_consultant_email, 2000);
      if (detailsResult.success && Array.isArray(detailsResult.data) && detailsResult.data.length > 0) {
        const detailsById = new Map<string, Record<string, unknown>>();
        for (const d of detailsResult.data) {
          const id = d?.id != null ? String(d.id) : '';
          if (id) detailsById.set(id, d as Record<string, unknown>);
        }
        leadsOut = leadsOut.map((lead: Record<string, unknown>) => {
          const id = lead?.id != null ? String(lead.id) : '';
          const detail = detailsById.get(id);
          return (detail ? { ...lead, ...detail } : lead) as typeof leadsOut[0];
        });
        console.log(`${LOG_PREFIX} GET enriched ${leadsOut.length} lead(s) with get-indicateds-by-consultant (matched ${detailsById.size} details)`);
      } else {
        console.log(`${LOG_PREFIX} GET getIndicatedsByConsultant skipped or empty, returning leads without detail`);
      }
    }

    if (balance_filter === 'with_balance') {
      leadsOut = leadsOut.filter((l: RedistributionLead) => (parseFloat(String(l.balance ?? l.saldo ?? 0)) || 0) > 0);
    } else if (balance_filter === 'without_balance') {
      leadsOut = leadsOut.filter((l: RedistributionLead) => (parseFloat(String(l.balance ?? l.saldo ?? 0)) || 0) <= 0);
    }

    // Garantir que cada lead tenha "balance" numérico (CRM pode retornar "saldo"), para o frontend e lead_snapshots na transferência
    leadsOut = leadsOut.map((l: Record<string, unknown>) => {
      const raw = l.balance ?? l.saldo;
      const balance = raw != null ? parseFloat(String(raw)) : null;
      const value = Number.isFinite(balance) ? balance : null;
      return { ...l, balance: value ?? 0 } as unknown as RedistributionLead;
    });

    const leadCount = leadsOut.length;
    const leadIds = leadsOut.map((l: RedistributionLead) => l.id);
    console.log(`${LOG_PREFIX} GET success: ${leadCount} lead(s)`, { leadIds: leadIds.slice(0, 50), truncated: leadIds.length > 50 });
    return successResponse({
      leads: leadsOut,
      success: result.success,
      message: result.message,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('não tem permissão') || message.includes('obrigatório')) {
      return errorResponse(message, 403);
    }
    console.error(`${LOG_PREFIX} Exceção (500):`, {
      message,
      stack: err instanceof Error ? err.stack : undefined,
      err,
    });
    return serverErrorResponse(err);
  }
}
