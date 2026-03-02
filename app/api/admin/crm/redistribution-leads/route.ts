import { NextRequest } from 'next/server';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { requireAdminLeadTransferContext, isConsultantInBanca } from '@/lib/server/crm/adminLeadTransferContext';
import { createCrmRedistributionClient, type RedistributionLead } from '@/lib/server/crm/crmRedistributionClient';
import { z } from 'zod';

const balanceFilterEnum = z.enum(['all', 'with_balance', 'without_balance', 'range']);
const apostaFilterEnum = z.enum(['all', 'with_bet', 'without_bet', 'range']);
const numericFilterEnum = z.enum(['all', 'with_value', 'without_value', 'range']);
const optionalNumber = z
  .union([
    z.string().transform((s) => {
      if (s === '' || s == null) return null;
      const n = parseFloat(String(s).replace(',', '.'));
      return Number.isFinite(n) ? n : null;
    }),
    z.null(),
  ])
  .optional();

const querySchema = z.object({
  banca_id: z.string().uuid(),
  source_consultant_email: z.string().email(),
  days_inactive: z.union([z.coerce.number().int().min(0), z.null()]).optional().transform((v) => (v == null ? undefined : v)),
  min_inactive_days: z.union([z.coerce.number().int().min(0), z.null()]).optional().transform((v) => (v == null ? undefined : v)),
  tag: z.union([z.string(), z.null()]).optional().transform((v) => (v == null ? undefined : v)),
  /** Para comparação com CRM: 'no' = só leads ainda não transferidos (busca para transferir), 'yes' = só transferidos. */
  transferred_filter: z.string().optional().transform((v): 'yes' | 'no' | undefined => (v === 'yes' || v === 'no' ? v : undefined)),
  balance_filter: balanceFilterEnum.optional().default('all'),
  saldo_min: optionalNumber,
  saldo_max: optionalNumber,
  aposta_filter: apostaFilterEnum.optional().default('all'),
  aposta_min: optionalNumber,
  aposta_max: optionalNumber,
  total_depositado_filter: numericFilterEnum.optional().default('all'),
  total_depositado_min: optionalNumber,
  total_depositado_max: optionalNumber,
  available_withdraw_filter: numericFilterEnum.optional().default('all'),
  available_withdraw_min: optionalNumber,
  available_withdraw_max: optionalNumber,
  total_ganho_filter: numericFilterEnum.optional().default('all'),
  total_ganho_min: optionalNumber,
  total_ganho_max: optionalNumber,
});

const LOG_PREFIX = '[lead-transfer][redistribution-leads]';

/** Tamanho de cada página ao buscar detalhes no CRM (requisições menores evitam timeout Netlify). */
const DETAIL_PAGE_SIZE = 1500;
/** Máximo de páginas de detalhes para manter a função dentro do timeout típico do Netlify (~26s). */
const MAX_DETAIL_PAGES = 12;
/** Acima deste número de leads, retornamos a lista imediatamente e o detalhamento é feito em background pelo front. */
const ENRICHMENT_DEFERRED_THRESHOLD = 5000;

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
      transferred_filter: searchParams.get('transferred_filter') ?? null,
      balance_filter: searchParams.get('balance_filter') ?? 'all',
      saldo_min: searchParams.get('saldo_min') ?? null,
      saldo_max: searchParams.get('saldo_max') ?? null,
      aposta_filter: searchParams.get('aposta_filter') ?? 'all',
      aposta_min: searchParams.get('aposta_min') ?? null,
      aposta_max: searchParams.get('aposta_max') ?? null,
      total_depositado_filter: searchParams.get('total_depositado_filter') ?? 'all',
      total_depositado_min: searchParams.get('total_depositado_min') ?? null,
      total_depositado_max: searchParams.get('total_depositado_max') ?? null,
      available_withdraw_filter: searchParams.get('available_withdraw_filter') ?? 'all',
      available_withdraw_min: searchParams.get('available_withdraw_min') ?? null,
      available_withdraw_max: searchParams.get('available_withdraw_max') ?? null,
      total_ganho_filter: searchParams.get('total_ganho_filter') ?? 'all',
      total_ganho_min: searchParams.get('total_ganho_min') ?? null,
      total_ganho_max: searchParams.get('total_ganho_max') ?? null,
    });

    if (!parsed.success) {
      const issues = parsed.error?.issues ?? [];
      const first = issues[0];
      const msg = first?.message ?? 'Parâmetros inválidos. banca_id e source_consultant_email são obrigatórios.';
      console.warn(`${LOG_PREFIX} Validação falhou (400):`, JSON.stringify(issues, null, 2));
      return errorResponse(msg, 400);
    }

    const {
      banca_id,
      source_consultant_email,
      days_inactive,
      min_inactive_days,
      tag,
      transferred_filter,
      balance_filter,
      saldo_min,
      saldo_max,
      aposta_filter,
      aposta_min,
      aposta_max,
      total_depositado_filter,
      total_depositado_min,
      total_depositado_max,
      available_withdraw_filter,
      available_withdraw_min,
      available_withdraw_max,
      total_ganho_filter,
      total_ganho_min,
      total_ganho_max,
    } = parsed.data;
    const effectiveDaysInactive = days_inactive ?? min_inactive_days ?? 10;
    const effectiveTransferredFilter = transferred_filter ?? 'no';
    console.log(`${LOG_PREFIX} GET parsed params: banca_id=${banca_id}, source_consultant_email=${source_consultant_email}, days_inactive=${effectiveDaysInactive}, transferred_filter=${effectiveTransferredFilter}, balance_filter=${balance_filter}, tag=${tag ?? 'n/a'}, saldo_min=${saldo_min ?? 'n/a'}, saldo_max=${saldo_max ?? 'n/a'}, aposta_filter=${aposta_filter}, total_depositado_filter=${total_depositado_filter}, available_withdraw_filter=${available_withdraw_filter}`);
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
    const totalLeadsFromCrm = leadsOut.length;
    const deferEnrichment = totalLeadsFromCrm > ENRICHMENT_DEFERRED_THRESHOLD;

    if (leadsOut.length > 0 && !deferEnrichment) {
      const detailsById = new Map<string, Record<string, unknown>>();
      let page = 1;
      let hasMore = true;

      while (hasMore && page <= MAX_DETAIL_PAGES) {
        const detailsResult = await client.getIndicatedsByConsultant(source_consultant_email, DETAIL_PAGE_SIZE, page, {
          transferredFilter: effectiveTransferredFilter,
          sort: 'created_at',
          direction: 'desc',
        });
        if (!detailsResult.success || !Array.isArray(detailsResult.data)) break;
        const chunk = detailsResult.data;
        for (const d of chunk) {
          const id = d?.id != null ? String(d.id) : '';
          if (id) detailsById.set(id, d as Record<string, unknown>);
        }
        const lastPage = detailsResult.pagination?.last_page ?? 1;
        if (chunk.length < DETAIL_PAGE_SIZE || page >= lastPage) hasMore = false;
        else page++;
      }

      if (page > MAX_DETAIL_PAGES && hasMore) {
        console.log(`${LOG_PREFIX} GET detail fetch capped at ${MAX_DETAIL_PAGES} pages (${detailsById.size} details) to avoid Netlify timeout; remaining leads keep base data only`);
      }
      if (detailsById.size > 0) {
        leadsOut = leadsOut.map((lead: Record<string, unknown>) => {
          const id = lead?.id != null ? String(lead.id) : '';
          const detail = detailsById.get(id);
          return (detail ? { ...lead, ...detail } : lead) as typeof leadsOut[0];
        });
        console.log(`${LOG_PREFIX} GET enriched ${leadsOut.length} lead(s) with get-indicateds-by-consultant (matched ${detailsById.size} details, ${page} page(s))`);
      } else {
        console.log(`${LOG_PREFIX} GET getIndicatedsByConsultant skipped or empty, returning leads without detail`);
      }
    }
    if (deferEnrichment) {
      console.log(`${LOG_PREFIX} GET returning ${totalLeadsFromCrm} lead(s) immediately (enrichment deferred to frontend, threshold=${ENRICHMENT_DEFERRED_THRESHOLD})`);
    }

    if (balance_filter === 'with_balance') {
      leadsOut = leadsOut.filter((l: RedistributionLead) => (parseFloat(String(l.balance ?? l.saldo ?? 0)) || 0) > 0);
    } else if (balance_filter === 'without_balance') {
      leadsOut = leadsOut.filter((l: RedistributionLead) => (parseFloat(String(l.balance ?? l.saldo ?? 0)) || 0) <= 0);
    }

    if (saldo_min != null && Number.isFinite(saldo_min)) {
      leadsOut = leadsOut.filter((l: RedistributionLead) => (parseFloat(String(l.balance ?? l.saldo ?? 0)) || 0) >= saldo_min);
    }
    if (saldo_max != null && Number.isFinite(saldo_max)) {
      leadsOut = leadsOut.filter((l: RedistributionLead) => (parseFloat(String(l.balance ?? l.saldo ?? 0)) || 0) <= saldo_max);
    }

    if (aposta_filter && aposta_filter !== 'all') {
      leadsOut = leadsOut.filter((l: RedistributionLead) => {
        const aposta = parseFloat(String((l as Record<string, unknown>).total_apostado ?? 0)) || 0;
        if (aposta_filter === 'with_bet') return aposta > 0;
        if (aposta_filter === 'without_bet') return aposta <= 0;
        if (aposta_filter === 'range') {
          if (aposta_min != null && Number.isFinite(aposta_min) && aposta < aposta_min) return false;
          if (aposta_max != null && Number.isFinite(aposta_max) && aposta > aposta_max) return false;
          return true;
        }
        return true;
      });
    }

    if (total_depositado_filter && total_depositado_filter !== 'all') {
      leadsOut = leadsOut.filter((l: RedistributionLead) => {
        const v = parseFloat(String((l as Record<string, unknown>).total_depositado ?? 0)) || 0;
        if (total_depositado_filter === 'with_value') return v > 0;
        if (total_depositado_filter === 'without_value') return v <= 0;
        if (total_depositado_filter === 'range') {
          if (total_depositado_min != null && Number.isFinite(total_depositado_min) && v < total_depositado_min) return false;
          if (total_depositado_max != null && Number.isFinite(total_depositado_max) && v > total_depositado_max) return false;
          return true;
        }
        return true;
      });
    }

    if (available_withdraw_filter && available_withdraw_filter !== 'all') {
      leadsOut = leadsOut.filter((l: RedistributionLead) => {
        const v = parseFloat(String((l as Record<string, unknown>).available_withdraw ?? 0)) || 0;
        if (available_withdraw_filter === 'with_value') return v > 0;
        if (available_withdraw_filter === 'without_value') return v <= 0;
        if (available_withdraw_filter === 'range') {
          if (available_withdraw_min != null && Number.isFinite(available_withdraw_min) && v < available_withdraw_min) return false;
          if (available_withdraw_max != null && Number.isFinite(available_withdraw_max) && v > available_withdraw_max) return false;
          return true;
        }
        return true;
      });
    }

    if (total_ganho_filter && total_ganho_filter !== 'all') {
      leadsOut = leadsOut.filter((l: RedistributionLead) => {
        const v = parseFloat(String((l as Record<string, unknown>).total_ganho ?? 0)) || 0;
        if (total_ganho_filter === 'with_value') return v > 0;
        if (total_ganho_filter === 'without_value') return v <= 0;
        if (total_ganho_filter === 'range') {
          if (total_ganho_min != null && Number.isFinite(total_ganho_min) && v < total_ganho_min) return false;
          if (total_ganho_max != null && Number.isFinite(total_ganho_max) && v > total_ganho_max) return false;
          return true;
        }
        return true;
      });
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
    const totalEnrichmentPages = Math.ceil(totalLeadsFromCrm / DETAIL_PAGE_SIZE);
    return successResponse({
      leads: leadsOut,
      success: result.success,
      message: result.message,
      ...(deferEnrichment && {
        enrichmentDeferred: true,
        enrichmentPageSize: DETAIL_PAGE_SIZE,
        totalEnrichmentPages,
      }),
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
