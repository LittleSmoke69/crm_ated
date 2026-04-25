/**
 * Meta Ads Sync Service
 * Sincroniza campanhas, adsets e insights da Meta Graph API para o Supabase.
 * Usa token descriptografado apenas em memória; nunca em logs.
 */

import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { encryptionService } from '@/lib/services/encryption-service';
import {
  getMe,
  getAdAccounts,
  listCampaigns,
  listAdSets,
  getInsightsDaily,
  getAccountFinance,
  mapInsightToRow,
  normalizeBudget,
  formatMetaDate,
  type InsightsDateOption,
  type MetaInsight,
} from '@/lib/meta/metaClient';
import {
  getActiveCampaignsSpend,
  type GetActiveCampaignsSpendOptions,
  type ActiveCampaignSpendRow,
} from '@/lib/meta/metaAdsService';
import { buildCampaignConsultorSummary } from '@/lib/services/meta-campaign-consultors';
import { buildGestorNamesByCrmBancaIdMap, type CrmBancaLite } from '@/lib/services/gestor-names-by-crm-banca';

const DEFAULT_BASE_URL = 'https://graph.facebook.com/v25.0';
const DEFAULT_DATE_PRESET = 'last_30d';

/** Logs do retorno bruto da Meta (admin / sync); nunca incluir token. */
const META_API_LOG = '[Meta Ads API]';

function logMetaReturn(context: string, data: Record<string, unknown>): void {
  console.log(META_API_LOG, context, data);
}

/**
 * IDs explícitos no cadastro (vírgula = várias contas). Normaliza com prefixo act_.
 * Quando não vazio, a sincronização deve usar só estes IDs — não misturar com outras contas do token
 * (senão a 2ª integração na mesma banca caía na primeira conta retornada pelo token).
 */
function parseConfiguredAdAccountIds(raw: string | null | undefined): string[] {
  if (raw == null || String(raw).trim() === '') return [];
  const parts = String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    const id = p.startsWith('act_') ? p : `act_${p}`;
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

/** Retorna time_range desde (hoje - dias) até hoje em YYYY-MM-DD. Meta usa timezone da conta. */
function getTimeRangeSinceUntil(daysAgo: number): { since: string; until: string } {
  const now = new Date();
  const until = formatMetaDate(now);
  const since = new Date(now);
  since.setDate(since.getDate() - daysAgo);
  return { since: formatMetaDate(since), until };
}

/** Mantém só linhas diárias cuja `date_start` cai no intervalo inclusivo (YYYY-MM-DD). */
function filterInsightsByDateStartRange(
  insights: MetaInsight[],
  dateFrom: string,
  dateTo: string
): MetaInsight[] {
  if (!dateFrom || !dateTo || dateFrom > dateTo) return insights;
  return insights.filter((ins) => {
    const ds = ins.date_start || '';
    return ds >= dateFrom && ds <= dateTo;
  });
}

/** Soma dias a uma data YYYY-MM-DD (calendário). */
function addCalendarDays(isoDate: string, deltaDays: number): string {
  const parts = String(isoDate).trim().split('-').map((n) => parseInt(n, 10));
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return isoDate;
  const [y, m, d] = parts;
  const t = Date.UTC(y, m - 1, d) + deltaDays * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * Insights em nível de campanha: `date_preset` (ex. last_30d) usa o fuso da conta na Meta.
 * O time_range montado em UTC no servidor costuma devolver 0 linhas mesmo com campanhas ativas.
 * Quando `preferTimeRangeFirst` (ex.: período explícito na UI), tenta o intervalo antes do preset.
 *
 * `strictInsightRange`: painel admin com datas da UI — só devolve linhas cuja `date_start` cai no intervalo.
 * Usa time_range ampliado (±dias) para contornar fuso da conta na Meta e **não** usa last_90d (que misturaria períodos).
 */
async function fetchCampaignInsightsWithFallbacks(
  baseUrl: string,
  token: string,
  adAccountId: string,
  datePreset: string,
  timeRangeUtc: { since: string; until: string },
  options?: {
    preferTimeRangeFirst?: boolean;
    strictInsightRange?: { from: string; to: string };
  }
): Promise<{ insights: MetaInsight[]; sourceLabel: string }> {
  const preset = (datePreset || DEFAULT_DATE_PRESET).trim() || DEFAULT_DATE_PRESET;
  const strict = options?.strictInsightRange;
  if (strict && strict.from && strict.to && strict.from <= strict.to) {
    const padDays = [0, 1, 3, 7, 14];
    for (const pad of padDays) {
      const since = addCalendarDays(strict.from, -pad);
      const until = addCalendarDays(strict.to, pad);
      const rows = await getInsightsDaily(baseUrl, token, adAccountId, { since, until });
      const filtered = filterInsightsByDateStartRange(rows, strict.from, strict.to);
      if (filtered.length > 0) {
        logMetaReturn('fetchCampaignInsightsWithFallbacks ← usado (strict range + padding)', {
          ad_account_id: adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`,
          ui_range: `${strict.from}..${strict.to}`,
          request_range: `${since}..${until}`,
          padding_days: pad,
          rows_raw: rows.length,
          rows_filtered: filtered.length,
        });
        return {
          insights: filtered,
          sourceLabel: `${strict.from}..${strict.to} (Meta time_range ±${pad}d, filtrado por dia)`,
        };
      }
    }
    logMetaReturn('fetchCampaignInsightsWithFallbacks ← strict range sem linhas após padding', {
      ad_account_id: adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`,
      ui_range: `${strict.from}..${strict.to}`,
    });
    return {
      insights: [],
      sourceLabel: `${strict.from}..${strict.to} (sem insights no Graph neste intervalo)`,
    };
  }

  const rangeOpt: InsightsDateOption = timeRangeUtc;
  const rangeLabelUi = `${timeRangeUtc.since}..${timeRangeUtc.until} (time_range)`;
  const rangeLabelFallback = `${timeRangeUtc.since}..${timeRangeUtc.until} (time_range, servidor UTC)`;

  const attempts: Array<{ label: string; opt: InsightsDateOption }> = options?.preferTimeRangeFirst
    ? [
        { label: rangeLabelUi, opt: rangeOpt },
        { label: preset, opt: preset },
        { label: 'last_90d', opt: 'last_90d' },
        { label: 'last_year', opt: 'last_year' },
        { label: 'maximum', opt: 'maximum' },
      ]
    : [
        { label: preset, opt: preset },
        { label: rangeLabelFallback, opt: rangeOpt },
        { label: 'last_90d', opt: 'last_90d' },
        { label: 'last_year', opt: 'last_year' },
        { label: 'maximum', opt: 'maximum' },
      ];

  for (const { label, opt } of attempts) {
    const rows = await getInsightsDaily(baseUrl, token, adAccountId, opt);
    if (rows.length > 0) {
      logMetaReturn('fetchCampaignInsightsWithFallbacks ← usado', {
        ad_account_id: adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`,
        source: label,
        rows: rows.length,
      });
      return { insights: rows, sourceLabel: label };
    }
  }

  logMetaReturn('fetchCampaignInsightsWithFallbacks ← vazio após tentativas', {
    ad_account_id: adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`,
    tried: attempts.map((a) => a.label),
  });
  return { insights: [], sourceLabel: `${preset} (0 linhas após fallbacks)` };
}

export interface MetaConfigInput {
  base_url?: string;
  access_token?: string;
  ad_account_id?: string;
  pixel_id?: string;
  default_campaign_id?: string;
  is_active?: boolean;
}

export interface MetaIntegrationRow {
  /** integration_id (novo modelo compartilhado) */
  id: string;
  /** banca_id selecionada no contexto (para compat/UI) */
  banca_id: string;
  base_url: string;
  access_token_encrypted: string | null;
  token_last4: string | null;
  ad_account_id: string | null;
  pixel_id: string | null;
  default_campaign_id: string | null;
  is_active: boolean;
  currency: string | null;
  last_sync_at: string | null;
  last_sync_error: string | null;
  last_sync_date_preset: string | null;
  banca_ids?: string[];
}

/** Todas as integrações Meta vinculadas à banca (ordem de criação do vínculo). */
export async function listIntegrationIdsByBanca(bancaId: string): Promise<string[]> {
  const { data, error } = await supabaseServiceRole
    .from('meta_integration_bancas')
    .select('integration_id, created_at')
    .eq('banca_id', bancaId)
    .order('created_at', { ascending: true });
  if (error || !data?.length) return [];
  return data.map((r: { integration_id: string }) => String(r.integration_id));
}

async function resolveIntegrationIdByBanca(bancaId: string): Promise<string | null> {
  const ids = await listIntegrationIdsByBanca(bancaId);
  return ids[0] ?? null;
}

export async function listBancasByIntegration(integrationId: string): Promise<string[]> {
  const { data, error } = await supabaseServiceRole
    .from('meta_integration_bancas')
    .select('banca_id')
    .eq('integration_id', integrationId);
  if (error || !data) return [];
  return data.map((r: any) => String(r.banca_id));
}

export async function isMetaIntegrationLinkedToBanca(integrationId: string, bancaId: string): Promise<boolean> {
  const { data } = await supabaseServiceRole
    .from('meta_integration_bancas')
    .select('integration_id')
    .eq('integration_id', integrationId)
    .eq('banca_id', bancaId)
    .maybeSingle();
  return Boolean(data);
}

/**
 * Para `create_new`: copia token de outra integração já vinculada a pelo menos uma das bancas alvo.
 * Ordem: `explicitSourceId` (se válido e compartilha banca), depois outras integrações da `bancaId` de contexto.
 */
async function resolveTokenCopySourceForNewIntegration(
  contextBancaId: string,
  desiredBancaIds: string[],
  explicitSourceId?: string | null
): Promise<{ access_token_encrypted: string; token_last4: string | null } | null> {
  const desired = new Set(
    (desiredBancaIds.length ? desiredBancaIds : [contextBancaId]).map((x) => String(x).trim()).filter(Boolean)
  );
  if (desired.size === 0) return null;

  const candidateIds: string[] = [];
  const push = (id: string) => {
    const s = String(id).trim();
    if (s && !candidateIds.includes(s)) candidateIds.push(s);
  };

  if (explicitSourceId?.trim()) push(explicitSourceId.trim());
  for (const id of await listIntegrationIdsByBanca(contextBancaId)) push(id);

  for (const integrationId of candidateIds) {
    const linked = await listBancasByIntegration(integrationId);
    if (!linked.some((b) => desired.has(b))) continue;

    const { data, error } = await supabaseServiceRole
      .from('meta_integration_configs')
      .select('access_token_encrypted, token_last4')
      .eq('id', integrationId)
      .maybeSingle();

    if (error || !data) continue;
    const enc = (data as { access_token_encrypted?: string | null }).access_token_encrypted;
    if (enc != null && String(enc).trim() !== '') {
      return {
        access_token_encrypted: String(enc),
        token_last4: (data as { token_last4?: string | null }).token_last4 ?? null,
      };
    }
  }
  return null;
}

export type DecryptTokenOptions = { requireActive?: boolean };

export async function getDecryptedTokenByIntegrationId(
  integrationId: string,
  options?: DecryptTokenOptions
): Promise<string | null> {
  const requireActive = options?.requireActive !== false;
  let q = supabaseServiceRole
    .from('meta_integration_configs')
    .select('access_token_encrypted')
    .eq('id', integrationId);
  if (requireActive) q = q.eq('is_active', true);
  const { data } = await q.maybeSingle();
  const encrypted = data?.access_token_encrypted as string | null | undefined;
  if (!encrypted) return null;
  try {
    return encryptionService.decrypt(encrypted);
  } catch {
    return null;
  }
}

async function resolveMetaApiContextByIntegrationId(integrationId: string): Promise<{
  baseUrl: string;
  adAccountId: string | null;
}> {
  const { data } = await supabaseServiceRole
    .from('meta_integration_configs')
    .select('base_url, ad_account_id')
    .eq('id', integrationId)
    .maybeSingle();
  return {
    baseUrl: (data?.base_url as string) || DEFAULT_BASE_URL,
    adAccountId: (data?.ad_account_id as string) || null,
  };
}

async function getLegacyDecryptedToken(bancaId: string, requireActive = true): Promise<string | null> {
  let q = supabaseServiceRole
    .from('meta_integrations')
    .select('access_token_encrypted')
    .eq('banca_id', bancaId);
  if (requireActive) q = q.eq('is_active', true);
  const { data } = await q.maybeSingle();
  const encrypted = data?.access_token_encrypted as string | null | undefined;
  if (!encrypted) return null;
  try {
    return encryptionService.decrypt(encrypted);
  } catch {
    return null;
  }
}

/** Moeda da conta Meta (integração compartilhada ou legado por banca). */
async function getMetaCurrencyForBanca(bancaId: string): Promise<string> {
  for (const integrationId of await listIntegrationIdsByBanca(bancaId)) {
    const { data } = await supabaseServiceRole
      .from('meta_integration_configs')
      .select('currency')
      .eq('id', integrationId)
      .maybeSingle();
    if (data?.currency) return String(data.currency);
  }
  const { data: leg } = await supabaseServiceRole
    .from('meta_integrations')
    .select('currency')
    .eq('banca_id', bancaId)
    .maybeSingle();
  return (leg?.currency as string) || 'BRL';
}

/** Modelo legado (por banca): ainda usado quando não há linha em meta_integration_bancas. */
async function getLegacyMetaIntegrationByBanca(bancaId: string): Promise<MetaIntegrationRow | null> {
  const { data, error } = await supabaseServiceRole
    .from('meta_integrations')
    .select(
      'id, banca_id, base_url, access_token_encrypted, token_last4, ad_account_id, pixel_id, default_campaign_id, is_active, currency, last_sync_at, last_sync_error, last_sync_date_preset'
    )
    .eq('banca_id', bancaId)
    .maybeSingle();
  if (error || !data) return null;
  const d = data as Record<string, unknown>;
  return {
    id: String(d.id),
    banca_id: bancaId,
    base_url: String(d.base_url ?? DEFAULT_BASE_URL),
    access_token_encrypted: (d.access_token_encrypted as string | null) ?? null,
    token_last4: (d.token_last4 as string | null) ?? null,
    ad_account_id: (d.ad_account_id as string | null) ?? null,
    pixel_id: (d.pixel_id as string | null) ?? null,
    default_campaign_id: (d.default_campaign_id as string | null) ?? null,
    is_active: d.is_active !== false,
    currency: (d.currency as string | null) ?? null,
    last_sync_at: (d.last_sync_at as string | null) ?? null,
    last_sync_error: (d.last_sync_error as string | null) ?? null,
    last_sync_date_preset: (d.last_sync_date_preset as string | null) ?? null,
    banca_ids: [bancaId],
  };
}

/** base_url e ad_account: primeira integração vinculada à banca ou legado. */
async function resolveMetaApiContext(bancaId: string): Promise<{
  baseUrl: string;
  adAccountId: string | null;
}> {
  const ids = await listIntegrationIdsByBanca(bancaId);
  if (ids.length > 0) {
    return resolveMetaApiContextByIntegrationId(ids[0]);
  }
  const { data: leg } = await supabaseServiceRole
    .from('meta_integrations')
    .select('base_url, ad_account_id')
    .eq('banca_id', bancaId)
    .maybeSingle();
  return {
    baseUrl: (leg?.base_url as string) || DEFAULT_BASE_URL,
    adAccountId: (leg?.ad_account_id as string) || null,
  };
}

export async function listMetaIntegrationsForBanca(bancaId: string): Promise<MetaIntegrationRow[]> {
  const rows: MetaIntegrationRow[] = [];
  for (const integrationId of await listIntegrationIdsByBanca(bancaId)) {
    const { data, error } = await supabaseServiceRole
      .from('meta_integration_configs')
      .select(
        'id, base_url, token_last4, ad_account_id, pixel_id, default_campaign_id, is_active, currency, last_sync_at, last_sync_error, last_sync_date_preset, access_token_encrypted'
      )
      .eq('id', integrationId)
      .maybeSingle();
    if (error || !data) continue;
    const banca_ids = await listBancasByIntegration(integrationId);
    rows.push({ ...(data as any), banca_id: bancaId, banca_ids } as MetaIntegrationRow);
  }
  const leg = await getLegacyMetaIntegrationByBanca(bancaId);
  if (leg) {
    const dup = rows.some((r) => String(r.id) === String(leg.id));
    if (!dup) rows.push(leg);
  }
  return rows;
}

export async function getMetaConfig(bancaId: string): Promise<MetaIntegrationRow | null> {
  const list = await listMetaIntegrationsForBanca(bancaId);
  return list[0] ?? null;
}

export type MetaConfigForBancasResult =
  | { ok: true; mode: 'unconfigured'; banca_ids: string[] }
  | { ok: true; mode: 'configured'; row: MetaIntegrationRow }
  | { ok: false; error: string };

/**
 * Resolve uma única integração Meta para um conjunto de bancas.
 * Bancas sem vínculo são ignoradas na detecção de conflito (útil para incluir novas bancas no mesmo save).
 */
export async function getMetaConfigForBancaIds(bancaIds: string[]): Promise<MetaConfigForBancasResult> {
  const unique = Array.from(new Set(bancaIds.map((x) => String(x).trim()).filter(Boolean)));
  if (unique.length === 0) {
    return { ok: true, mode: 'unconfigured', banca_ids: [] };
  }

  /** Não bloquear GET com várias bancas só porque alguma tem N integrações: usamos a primeira por banca em `resolveIntegrationIdByBanca` e validamos conflitos abaixo. */

  const integrationIdByBanca = new Map<string, string | null>();
  for (const bid of unique) {
    integrationIdByBanca.set(bid, await resolveIntegrationIdByBanca(bid));
  }

  const linkedIds = [...integrationIdByBanca.values()].filter((x): x is string => Boolean(x));
  const distinctIntegrationIds = Array.from(new Set(linkedIds));

  if (distinctIntegrationIds.length === 0) {
    const legacyEntries: { row: MetaIntegrationRow }[] = [];
    for (const bid of unique) {
      const row = await getLegacyMetaIntegrationByBanca(bid);
      if (row) legacyEntries.push({ row });
    }
    if (legacyEntries.length === 0) {
      return { ok: true, mode: 'unconfigured', banca_ids: unique };
    }
    const legacyIds = Array.from(new Set(legacyEntries.map((e) => e.row.id)));
    if (legacyIds.length > 1) {
      return {
        ok: false,
        error:
          'As bancas selecionadas têm cadastros Meta antigos (meta_integrations) diferentes. Edite uma banca por vez ou unifique no modelo compartilhado.',
      };
    }
    const baseRow = legacyEntries[0].row;
    return {
      ok: true,
      mode: 'configured',
      row: { ...baseRow, banca_ids: unique, banca_id: baseRow.banca_id },
    };
  }

  if (distinctIntegrationIds.length > 1) {
    return {
      ok: false,
      error:
        'As bancas selecionadas estão vinculadas a integrações Meta diferentes. Selecione apenas bancas que compartilham a mesma integração ou edite uma por vez.',
    };
  }

  const integrationId = distinctIntegrationIds[0];
  const bancaComVinculo = unique.find((b) => integrationIdByBanca.get(b) === integrationId);
  if (!bancaComVinculo) {
    return { ok: true, mode: 'unconfigured', banca_ids: unique };
  }

  const row = await getMetaConfig(bancaComVinculo);
  if (!row) {
    return { ok: true, mode: 'unconfigured', banca_ids: unique };
  }
  return { ok: true, mode: 'configured', row };
}

export type UpsertMetaConfigOptions = {
  /** Qual integração editar quando a banca tem várias (UUID de meta_integration_configs). */
  integration_id?: string | null;
  /** Cria nova integração + vínculo(s); não altera configs existentes. */
  create_new?: boolean;
  /**
   * Com `create_new` e sem `access_token` no body: copia o token criptografado desta integração,
   * desde que ela compartilhe vínculo com alguma das bancas alvo. Se omitido, usa a primeira integração irmã da banca de contexto.
   */
  reuse_token_from_integration_id?: string | null;
};

export async function upsertMetaConfig(
  bancaId: string,
  input: MetaConfigInput,
  bancaIdsToLink?: string[] | null,
  options?: UpsertMetaConfigOptions
): Promise<MetaIntegrationRow> {
  const baseUrl = input.base_url?.trim() || DEFAULT_BASE_URL;
  const now = new Date().toISOString();

  const updatePayload: Record<string, unknown> = {
    base_url: baseUrl,
    pixel_id: input.pixel_id?.trim() || null,
    default_campaign_id: input.default_campaign_id?.trim() || null,
    is_active: input.is_active ?? true,
    updated_at: now,
  };

  if (input.ad_account_id !== undefined) {
    updatePayload.ad_account_id = input.ad_account_id?.trim() || null;
  }

  if (input.access_token?.trim()) {
    const token = input.access_token.trim();
    updatePayload.access_token_encrypted = encryptionService.encrypt(token);
    updatePayload.token_last4 = token.length >= 4 ? token.slice(-4) : '****';
  }

  if (options?.create_new) {
    const desiredBancas =
      Array.isArray(bancaIdsToLink) && bancaIdsToLink.length > 0
        ? Array.from(new Set(bancaIdsToLink.map((x) => String(x).trim()).filter(Boolean)))
        : [bancaId];

    if (!input.access_token?.trim()) {
      const copied = await resolveTokenCopySourceForNewIntegration(
        bancaId,
        desiredBancas,
        options.reuse_token_from_integration_id
      );
      if (copied) {
        updatePayload.access_token_encrypted = copied.access_token_encrypted;
        if (copied.token_last4 != null && String(copied.token_last4).trim() !== '') {
          updatePayload.token_last4 = copied.token_last4;
        }
      } else {
        throw new Error(
          'Nova integração sem token: informe um Access Token ou mantenha outra integração Meta nesta banca para reutilizar o token existente.'
        );
      }
    }

    const { data: created, error: createError } = await supabaseServiceRole
      .from('meta_integration_configs')
      .insert({ ...updatePayload })
      .select()
      .single();
    if (createError) throw new Error(createError.message);
    const newIntegrationId = String((created as { id: string }).id);
    await supabaseServiceRole
      .from('meta_integration_bancas')
      .insert(desiredBancas.map((id) => ({ integration_id: newIntegrationId, banca_id: id })));
    const banca_ids = await listBancasByIntegration(newIntegrationId);
    return { ...(created as MetaIntegrationRow), banca_id: bancaId, banca_ids } as MetaIntegrationRow;
  }

  let targetIntegrationId =
    options?.integration_id != null && String(options.integration_id).trim() !== ''
      ? String(options.integration_id).trim()
      : null;

  const idsOnBanca = await listIntegrationIdsByBanca(bancaId);
  if (!targetIntegrationId) {
    if (idsOnBanca.length === 1) {
      targetIntegrationId = idsOnBanca[0];
    } else if (idsOnBanca.length > 1) {
      throw new Error(
        'Esta banca tem várias integrações Meta. Envie integration_id no corpo da requisição para indicar qual alterar, ou create_new_integration: true para cadastrar outra conta de anúncio.'
      );
    }
  } else {
    const linked = await listBancasByIntegration(targetIntegrationId);
    if (!linked.includes(bancaId)) {
      throw new Error('integration_id informado não está vinculado a esta banca.');
    }
  }

  const existingIntegrationId = targetIntegrationId;

  // Atualiza config existente (uma vez) e atualiza vínculos (opcional)
  if (existingIntegrationId) {
    const { data, error } = await supabaseServiceRole
      .from('meta_integration_configs')
      .update(updatePayload)
      .eq('id', existingIntegrationId)
      .select()
      .single();
    if (error) throw new Error(error.message);

    if (Array.isArray(bancaIdsToLink) && bancaIdsToLink.length > 0) {
      // Substitui o conjunto de bancas vinculadas (remove ausentes e adiciona novas)
      const desired = Array.from(new Set(bancaIdsToLink.map((x) => String(x).trim()).filter(Boolean)));

      const current = await listBancasByIntegration(existingIntegrationId);
      const currentSet = new Set(current);
      const desiredSet = new Set(desired);

      const toRemove = current.filter((id) => !desiredSet.has(id));
      const toAdd = desired.filter((id) => !currentSet.has(id));

      if (toRemove.length > 0) {
        await supabaseServiceRole
          .from('meta_integration_bancas')
          .delete()
          .eq('integration_id', existingIntegrationId)
          .in('banca_id', toRemove);
      }
      if (toAdd.length > 0) {
        await supabaseServiceRole
          .from('meta_integration_bancas')
          .insert(toAdd.map((id) => ({ integration_id: existingIntegrationId, banca_id: id })));
      }
    }

    const banca_ids = await listBancasByIntegration(existingIntegrationId);
    return { ...(data as any), banca_id: bancaId, banca_ids } as MetaIntegrationRow;
  }

  // Cria nova integração + vínculo
  const { data: created, error: createError } = await supabaseServiceRole
    .from('meta_integration_configs')
    .insert({ ...updatePayload })
    .select()
    .single();
  if (createError) throw new Error(createError.message);

  const integrationId = String((created as any).id);
  const desired = Array.isArray(bancaIdsToLink) && bancaIdsToLink.length > 0
    ? Array.from(new Set(bancaIdsToLink.map((x) => String(x).trim()).filter(Boolean)))
    : [bancaId];

  await supabaseServiceRole
    .from('meta_integration_bancas')
    .insert(desired.map((id) => ({ integration_id: integrationId, banca_id: id })));

  const banca_ids = await listBancasByIntegration(integrationId);
  return { ...(created as any), banca_id: bancaId, banca_ids } as MetaIntegrationRow;
}

/**
 * Substitui apenas os vínculos meta_integration_bancas (não altera token nem outros campos da config).
 * Exige ao menos uma banca; para zerar vínculos, use deleteMetaIntegrationConfig.
 */
export async function setMetaIntegrationBancaLinks(integrationId: string, bancaIds: string[]): Promise<string[]> {
  const id = String(integrationId).trim();
  const desired = Array.from(new Set(bancaIds.map((x) => String(x).trim()).filter(Boolean)));
  if (!id) throw new Error('integration_id é obrigatório.');
  if (desired.length === 0) {
    throw new Error('Informe ao menos uma banca vinculada, ou remova a integração inteira.');
  }

  const { data: exists, error: exErr } = await supabaseServiceRole
    .from('meta_integration_configs')
    .select('id')
    .eq('id', id)
    .maybeSingle();
  if (exErr) throw new Error(exErr.message);
  if (!exists) throw new Error('Integração Meta não encontrada.');

  const current = await listBancasByIntegration(id);
  const currentSet = new Set(current);
  const desiredSet = new Set(desired);

  const toRemove = current.filter((bid) => !desiredSet.has(bid));
  const toAdd = desired.filter((bid) => !currentSet.has(bid));

  if (toRemove.length > 0) {
    const { error: delErr } = await supabaseServiceRole
      .from('meta_integration_bancas')
      .delete()
      .eq('integration_id', id)
      .in('banca_id', toRemove);
    if (delErr) throw new Error(delErr.message);
  }
  if (toAdd.length > 0) {
    const { error: insErr } = await supabaseServiceRole
      .from('meta_integration_bancas')
      .insert(toAdd.map((bid) => ({ integration_id: id, banca_id: bid })));
    if (insErr) throw new Error(insErr.message);
  }

  return listBancasByIntegration(id);
}

/**
 * Atualiza os vínculos da integração alvo e move as bancas informadas
 * removendo vínculos dessas bancas em outras integrações.
 */
export async function moveMetaIntegrationToBancas(integrationId: string, bancaIds: string[]): Promise<string[]> {
  const id = String(integrationId).trim();
  const desired = Array.from(new Set(bancaIds.map((x) => String(x).trim()).filter(Boolean)));
  if (!id) throw new Error('integration_id é obrigatório.');
  if (desired.length === 0) {
    throw new Error('Informe ao menos uma banca vinculada, ou remova a integração inteira.');
  }

  const { data: exists, error: exErr } = await supabaseServiceRole
    .from('meta_integration_configs')
    .select('id')
    .eq('id', id)
    .maybeSingle();
  if (exErr) throw new Error(exErr.message);
  if (!exists) throw new Error('Integração Meta não encontrada.');

  // Remove vínculos dessas bancas em outras integrações para "mover" de fato.
  const { data: conflictingLinks, error: conflictErr } = await supabaseServiceRole
    .from('meta_integration_bancas')
    .select('integration_id, banca_id')
    .in('banca_id', desired)
    .neq('integration_id', id);
  if (conflictErr) throw new Error(conflictErr.message);

  for (const link of conflictingLinks ?? []) {
    const otherIntegrationId = String((link as { integration_id: string }).integration_id);
    const bancaId = String((link as { banca_id: string }).banca_id);
    const { error: delErr } = await supabaseServiceRole
      .from('meta_integration_bancas')
      .delete()
      .eq('integration_id', otherIntegrationId)
      .eq('banca_id', bancaId);
    if (delErr) throw new Error(delErr.message);
  }

  return setMetaIntegrationBancaLinks(id, desired);
}

/**
 * Remove integração Meta: primeiro `meta_integration_configs` (modelo compartilhado;
 * vínculos em `meta_integration_bancas` caem por CASCADE), senão `meta_integrations` (legado por banca).
 * A UI lista os dois tipos com `integration_id` = id da respectiva tabela.
 */
export async function deleteMetaIntegrationConfig(integrationId: string): Promise<void> {
  const id = String(integrationId).trim();
  if (!id) throw new Error('integration_id é obrigatório.');

  const { data: cfgDeleted, error: cfgErr } = await supabaseServiceRole
    .from('meta_integration_configs')
    .delete()
    .eq('id', id)
    .select('id');
  if (cfgErr) throw new Error(cfgErr.message);
  if (cfgDeleted?.length) return;

  const { data: legDeleted, error: legErr } = await supabaseServiceRole
    .from('meta_integrations')
    .delete()
    .eq('id', id)
    .select('id');
  if (legErr) throw new Error(legErr.message);
  if (!legDeleted?.length) throw new Error('Integração Meta não encontrada ou já removida.');
}

/** Primeiro token válido entre todas as integrações da banca; senão legado. */
export async function getDecryptedToken(bancaId: string): Promise<string | null> {
  for (const integrationId of await listIntegrationIdsByBanca(bancaId)) {
    const t = await getDecryptedTokenByIntegrationId(integrationId);
    if (t) return t;
  }
  return getLegacyDecryptedToken(bancaId, true);
}

/**
 * Revelação admin: mesma ordem de `getDecryptedToken`, porém inclui linhas inativas
 * (token existe no banco mas is_active = false) e valida descriptografia.
 */
export async function getDecryptedTokenForReveal(bancaId: string): Promise<string | null> {
  for (const integrationId of await listIntegrationIdsByBanca(bancaId)) {
    const t = await getDecryptedTokenByIntegrationId(integrationId, { requireActive: false });
    if (t) return t;
  }
  return getLegacyDecryptedToken(bancaId, false);
}

export async function testConnection(
  bancaId: string,
  integrationId?: string | null
): Promise<{
  success: boolean;
  me?: { id: string; name?: string };
  adAccounts?: Array<{ id: string; name?: string }>;
  error?: string;
}> {
  const token = integrationId
    ? await getDecryptedTokenByIntegrationId(integrationId)
    : await getDecryptedToken(bancaId);
  if (!token) {
    return { success: false, error: 'Token não configurado ou inválido. Configure o token primeiro.' };
  }

  const { baseUrl } = integrationId
    ? await resolveMetaApiContextByIntegrationId(integrationId)
    : await resolveMetaApiContext(bancaId);

  try {
    const me = await getMe(baseUrl, token);
    const adAccounts = await getAdAccounts(baseUrl, token);
    logMetaReturn('testConnection ← Meta', {
      banca_id: bancaId,
      base_url_host: (() => {
        try {
          return new URL(baseUrl).host;
        } catch {
          return 'invalid';
        }
      })(),
      me: { id: me.id, name: me.name ?? null },
      ad_accounts_count: adAccounts.length,
      ad_accounts_sample: adAccounts.slice(0, 5).map((a) => ({
        id: a.id,
        name: a.name ?? null,
        account_status: a.account_status ?? null,
        currency: a.currency ?? null,
      })),
    });
    return {
      success: true,
      me: { id: me.id, name: me.name },
      adAccounts: adAccounts.map((a) => ({ id: a.id, name: a.name })),
    };
  } catch (err: any) {
    logMetaReturn('testConnection ✗ Meta', { banca_id: bancaId, error: err?.message ?? String(err) });
    return { success: false, error: err?.message || 'Erro ao conectar com a Meta API' };
  }
}

export async function loadCampaigns(
  bancaId: string,
  integrationId?: string | null
): Promise<{
  success: boolean;
  campaigns?: Array<{ id: string; name?: string }>;
  error?: string;
}> {
  const token = integrationId
    ? await getDecryptedTokenByIntegrationId(integrationId)
    : await getDecryptedToken(bancaId);
  if (!token) {
    return { success: false, error: 'Token não configurado.' };
  }

  const { baseUrl, adAccountId: adAccountIdRaw } = integrationId
    ? await resolveMetaApiContextByIntegrationId(integrationId)
    : await resolveMetaApiContext(bancaId);
  const configuredActs = parseConfiguredAdAccountIds(adAccountIdRaw ?? undefined);
  const adAccountId = configuredActs[0];
  if (!adAccountId) {
    return { success: false, error: 'Ad Account ID não configurado.' };
  }

  try {
    const campaigns = await listCampaigns(baseUrl, token, adAccountId);
    const adAcct = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
    logMetaReturn('loadCampaigns ← Meta', {
      banca_id: bancaId,
      ad_account_id: adAcct,
      campaigns_count: campaigns.length,
      campaigns_sample: campaigns.slice(0, 8).map((c) => ({
        id: c.id,
        name: c.name ?? null,
        status: c.status ?? null,
        effective_status: c.effective_status ?? null,
      })),
    });
    return {
      success: true,
      campaigns: campaigns.map((c) => ({ id: c.id, name: c.name })),
    };
  } catch (err: any) {
    logMetaReturn('loadCampaigns ✗ Meta', { banca_id: bancaId, error: err?.message ?? String(err) });
    return { success: false, error: err?.message || 'Erro ao carregar campanhas' };
  }
}

export interface MetaInsightsAggregated {
  reach: number;
  impressions: number;
  clicks: number;
  leads: number;
  spend: number;
  currency: string;
}

export async function getMetaInsightsAggregated(
  bancaId: string,
  dateFrom?: string | null,
  dateTo?: string | null,
  activeOnly = true
): Promise<MetaInsightsAggregated | null> {
  const [campaignsResult, currency] = await Promise.all([
    activeOnly
      ? supabaseServiceRole
          .from('meta_campaigns')
          .select('campaign_id')
          .eq('banca_id', bancaId)
          .or('effective_status.eq.ACTIVE,status.eq.ACTIVE')
      : Promise.resolve({ data: null }),
    getMetaCurrencyForBanca(bancaId),
  ]);

  let campaignIds: string[] | null = null;
  if (activeOnly) {
    const ids: string[] = ((campaignsResult as any).data || []).map((c: { campaign_id: string }) => c.campaign_id);
    if (ids.length === 0) return null;
    campaignIds = ids;
  }

  let query = supabaseServiceRole
    .from('meta_insights_daily')
    .select('campaign_id, reach, impressions, clicks, leads, spend')
    .eq('banca_id', bancaId);

  if (dateFrom) query = query.gte('date', dateFrom);
  if (dateTo) query = query.lte('date', dateTo);
  if (campaignIds && campaignIds.length > 0) query = query.in('campaign_id', campaignIds);

  const { data, error } = await query;
  if (error || !data?.length) return null;

  const firstInsight = data[0] as Record<string, unknown>;
  console.log('[Meta Ads] getMetaInsightsAggregated payload:', {
    bancaId,
    dateFrom: dateFrom ?? null,
    dateTo: dateTo ?? null,
    activeOnly,
    rows: data.length,
    fields: Object.keys(firstInsight ?? {}),
    sample: {
      campaign_id: firstInsight?.campaign_id ?? null,
      reach: firstInsight?.reach ?? null,
      impressions: firstInsight?.impressions ?? null,
      clicks: firstInsight?.clicks ?? null,
      leads: firstInsight?.leads ?? null,
      spend: firstInsight?.spend ?? null,
    },
  });

  const aggregated = data.reduce(
    (acc, row) => ({
      reach: acc.reach + (Number(row.reach) || 0),
      impressions: acc.impressions + (Number(row.impressions) || 0),
      clicks: acc.clicks + (Number(row.clicks) || 0),
      leads: acc.leads + (Number(row.leads) || 0),
      spend: acc.spend + (Number(row.spend) || 0),
    }),
    { reach: 0, impressions: 0, clicks: 0, leads: 0, spend: 0 }
  );

  return { ...aggregated, currency };
}

export interface MetaCampaignWithMetrics {
  campaign_id: string;
  campaign_name: string;
  adsets: string[];
  reach: number;
  impressions: number;
  clicks: number;
  spend: number;
  leads: number;
  results: number;
  cost_per_result: number | null;
  assigned_consultors?: Array<{
    id: string;
    email: string;
    full_name: string | null;
    total_leads: number;
    total_deposited: number;
  }>;
  consultor_total_leads?: number;
  consultor_total_deposited?: number;
}

const META_RESULT_ACTION_TYPES = new Set([
  'lead',
  'omni_lead',
  'leadgen_grouped',
  'purchase',
  'complete_registration',
  'app_install',
  'subscribe',
  'contact',
  'submit_application',
]);

function extractResultsFromRawActions(rawActions: Array<{ action_type: string; value: string }> | null | undefined): number {
  if (!rawActions || !Array.isArray(rawActions)) return 0;
  return rawActions
    .filter((a) => META_RESULT_ACTION_TYPES.has(a.action_type))
    .reduce((sum, a) => sum + (parseInt(a.value || '0', 10) || 0), 0);
}

export async function getMetaCampaignsWithInsights(
  bancaId: string,
  dateFrom?: string | null,
  dateTo?: string | null,
  activeOnly = true
): Promise<MetaCampaignWithMetrics[]> {
  let campaignsQuery = supabaseServiceRole
    .from('meta_campaigns')
    .select('campaign_id, name')
    .eq('banca_id', bancaId);
  if (activeOnly) {
    campaignsQuery = campaignsQuery.or('effective_status.eq.ACTIVE,status.eq.ACTIVE');
  }
  const { data: campaigns } = await campaignsQuery;
  if (!campaigns?.length) return [];

  const campaignIds = campaigns.map((c: { campaign_id: string }) => c.campaign_id);

  const { data: adsets } = await supabaseServiceRole
    .from('meta_adsets')
    .select('campaign_id, name')
    .eq('banca_id', bancaId)
    .in('campaign_id', campaignIds);

  const adsetsByCampaign = new Map<string, string[]>();
  (adsets || []).forEach((a: { campaign_id: string; name: string | null }) => {
    const list = adsetsByCampaign.get(a.campaign_id) || [];
    if (a.name) list.push(a.name);
    adsetsByCampaign.set(a.campaign_id, list);
  });

  let insightsQuery = supabaseServiceRole
    .from('meta_insights_daily')
    .select('campaign_id, campaign_name, reach, impressions, clicks, spend, leads, raw_actions')
    .eq('banca_id', bancaId)
    .in('campaign_id', campaignIds);
  if (dateFrom) insightsQuery = insightsQuery.gte('date', dateFrom);
  if (dateTo) insightsQuery = insightsQuery.lte('date', dateTo);

  const { data: insights } = await insightsQuery;
  const campaignIdsForSummary = campaigns.map((c: { campaign_id: string }) => c.campaign_id);
  const consultorSummaryByCampaign = await buildCampaignConsultorSummary(
    bancaId,
    campaignIdsForSummary,
    dateFrom ?? null,
    dateTo ?? null
  );

  if (!insights?.length) {
    return campaigns.map((c: { campaign_id: string; name: string | null }) => {
      const consultorSummary = consultorSummaryByCampaign.get(c.campaign_id);
      return {
      campaign_id: c.campaign_id,
      campaign_name: c.name || c.campaign_id,
      adsets: adsetsByCampaign.get(c.campaign_id) || [],
      reach: 0,
      impressions: 0,
      clicks: 0,
      spend: 0,
      leads: 0,
      results: 0,
      cost_per_result: null,
      assigned_consultors: consultorSummary?.assigned_consultors ?? [],
      consultor_total_leads: consultorSummary?.consultor_total_leads ?? 0,
      consultor_total_deposited: consultorSummary?.consultor_total_deposited ?? 0,
    };
    });
  }

  const firstCampaignInsight = insights[0] as Record<string, unknown>;
  const firstRawActions = Array.isArray(firstCampaignInsight?.raw_actions)
    ? (firstCampaignInsight.raw_actions as Array<{ action_type?: string; value?: string }>)
    : [];
  console.log('[Meta Ads] getMetaCampaignsWithInsights payload:', {
    bancaId,
    dateFrom: dateFrom ?? null,
    dateTo: dateTo ?? null,
    activeOnly,
    campaignCount: campaigns.length,
    insightsRows: insights.length,
    fields: Object.keys(firstCampaignInsight ?? {}),
    sample: {
      campaign_id: firstCampaignInsight?.campaign_id ?? null,
      campaign_name: firstCampaignInsight?.campaign_name ?? null,
      reach: firstCampaignInsight?.reach ?? null,
      impressions: firstCampaignInsight?.impressions ?? null,
      clicks: firstCampaignInsight?.clicks ?? null,
      spend: firstCampaignInsight?.spend ?? null,
      leads: firstCampaignInsight?.leads ?? null,
      raw_actions_count: firstRawActions.length,
      raw_action_types: firstRawActions
        .map((action) => action?.action_type)
        .filter((type): type is string => Boolean(type))
        .slice(0, 15),
    },
  });

  const metricsByCampaign = new Map<string, { reach: number; impressions: number; clicks: number; spend: number; leads: number; results: number }>();
  insights.forEach((row: { campaign_id: string; campaign_name?: string | null; reach?: number; impressions?: number; clicks?: number; spend?: number; leads?: number; raw_actions?: Array<{ action_type: string; value: string }> | null }) => {
    const cur = metricsByCampaign.get(row.campaign_id) || { reach: 0, impressions: 0, clicks: 0, spend: 0, leads: 0, results: 0 };
    cur.reach += Number(row.reach) || 0;
    cur.impressions += Number(row.impressions) || 0;
    cur.clicks += Number(row.clicks) || 0;
    cur.spend += Number(row.spend) || 0;
    cur.leads += Number(row.leads) || 0;
    cur.results += extractResultsFromRawActions(row.raw_actions);
    metricsByCampaign.set(row.campaign_id, cur);
  });

  return campaigns.map((c: { campaign_id: string; name: string | null }) => {
    const m = metricsByCampaign.get(c.campaign_id) || { reach: 0, impressions: 0, clicks: 0, spend: 0, leads: 0, results: 0 };
    const consultorSummary = consultorSummaryByCampaign.get(c.campaign_id);
    return {
      campaign_id: c.campaign_id,
      campaign_name: c.name || c.campaign_id,
      adsets: adsetsByCampaign.get(c.campaign_id) || [],
      reach: m.reach,
      impressions: m.impressions,
      clicks: m.clicks,
      spend: m.spend,
      leads: m.leads,
      results: m.results,
      cost_per_result: m.results > 0 ? m.spend / m.results : null,
      assigned_consultors: consultorSummary?.assigned_consultors ?? [],
      consultor_total_leads: consultorSummary?.consultor_total_leads ?? 0,
      consultor_total_deposited: consultorSummary?.consultor_total_deposited ?? 0,
    };
  });
}

function leadsFromMetaInsightActions(actions: MetaInsight['actions']): number {
  if (!actions?.length) return 0;
  const lead = actions.find((a) => a.action_type === 'lead');
  return lead ? parseInt(lead.value || '0', 10) || 0 : 0;
}

function extractResultsFromInsightActions(actions: MetaInsight['actions']): number {
  if (!actions?.length) return 0;
  return actions
    .filter((a) => META_RESULT_ACTION_TYPES.has(a.action_type))
    .reduce((sum, a) => sum + (parseInt(a.value || '0', 10) || 0), 0);
}

/**
 * Gestão de Tráfego: métricas Meta em tempo real via Graph API (insights diários por campanha).
 * Atribuição de consultores continua vinda do CRM (`buildCampaignConsultorSummary`).
 */
export async function fetchGestorMetaDashboardFromGraph(
  bancaId: string,
  dateFrom?: string | null,
  dateTo?: string | null,
  activeOnly = true
): Promise<{
  success: boolean;
  metaFunnel: MetaInsightsAggregated | null;
  metaCampaignsData: MetaCampaignWithMetrics[];
  error?: string;
}> {
  try {
    const token = await getDecryptedToken(bancaId);
    if (!token) {
      return { success: false, metaFunnel: null, metaCampaignsData: [], error: 'Token Meta não configurado.' };
    }
    const { baseUrl, adAccountId } = await resolveMetaApiContext(bancaId);
    if (!adAccountId) {
      return { success: false, metaFunnel: null, metaCampaignsData: [], error: 'Ad Account Meta não configurado.' };
    }

    const timeRange =
      dateFrom && dateTo
        ? { since: dateFrom, until: dateTo }
        : (() => {
            const now = new Date();
            const until = formatMetaDate(now);
            const since = new Date(now);
            since.setDate(since.getDate() - 29);
            return { since: formatMetaDate(since), until };
          })();

    const [insights, graphCampaigns, graphAdsets, currency] = await Promise.all([
      getInsightsDaily(baseUrl, token, adAccountId, timeRange),
      listCampaigns(baseUrl, token, adAccountId),
      listAdSets(baseUrl, token, adAccountId),
      getMetaCurrencyForBanca(bancaId),
    ]);

    const visibleCampaigns = graphCampaigns.filter((c) => {
      if (!activeOnly) return true;
      return c.status === 'ACTIVE' || c.effective_status === 'ACTIVE';
    });
    const allowedIds = new Set(visibleCampaigns.map((c) => String(c.id)));

    const filteredInsights = insights.filter(
      (ins) => ins.campaign_id && allowedIds.has(String(ins.campaign_id))
    );

    let reach = 0;
    let impressions = 0;
    let clicks = 0;
    let leads = 0;
    let spend = 0;
    for (const ins of filteredInsights) {
      reach += parseInt(ins.reach || '0', 10) || 0;
      impressions += parseInt(ins.impressions || '0', 10) || 0;
      clicks += parseInt(ins.clicks || '0', 10) || 0;
      spend += parseFloat(ins.spend || '0') || 0;
      leads += leadsFromMetaInsightActions(ins.actions);
    }

    const metaFunnel: MetaInsightsAggregated = { reach, impressions, clicks, leads, spend, currency };

    const adsetsByCampaign = new Map<string, string[]>();
    for (const a of graphAdsets) {
      const cid = String(a.campaign_id || '');
      if (!cid || !allowedIds.has(cid)) continue;
      const list = adsetsByCampaign.get(cid) || [];
      if (a.name) list.push(a.name);
      adsetsByCampaign.set(cid, list);
    }

    const metricsByCampaign = new Map<
      string,
      { reach: number; impressions: number; clicks: number; spend: number; leads: number; results: number }
    >();
    for (const ins of filteredInsights) {
      const cid = String(ins.campaign_id);
      const cur = metricsByCampaign.get(cid) || { reach: 0, impressions: 0, clicks: 0, spend: 0, leads: 0, results: 0 };
      cur.reach += parseInt(ins.reach || '0', 10) || 0;
      cur.impressions += parseInt(ins.impressions || '0', 10) || 0;
      cur.clicks += parseInt(ins.clicks || '0', 10) || 0;
      cur.spend += parseFloat(ins.spend || '0') || 0;
      cur.leads += leadsFromMetaInsightActions(ins.actions);
      cur.results += extractResultsFromInsightActions(ins.actions);
      metricsByCampaign.set(cid, cur);
    }

    const orderedIds = visibleCampaigns.map((c) => String(c.id));
    const consultorSummaryByCampaign = await buildCampaignConsultorSummary(
      bancaId,
      orderedIds,
      dateFrom ?? null,
      dateTo ?? null
    );

    const metaCampaignsData: MetaCampaignWithMetrics[] = visibleCampaigns.map((c) => {
      const id = String(c.id);
      const m = metricsByCampaign.get(id) || { reach: 0, impressions: 0, clicks: 0, spend: 0, leads: 0, results: 0 };
      const consultorSummary = consultorSummaryByCampaign.get(id);
      return {
        campaign_id: id,
        campaign_name: c.name || id,
        adsets: adsetsByCampaign.get(id) || [],
        reach: m.reach,
        impressions: m.impressions,
        clicks: m.clicks,
        spend: m.spend,
        leads: m.leads,
        results: m.results,
        cost_per_result: m.results > 0 ? m.spend / m.results : null,
        assigned_consultors: consultorSummary?.assigned_consultors ?? [],
        consultor_total_leads: consultorSummary?.consultor_total_leads ?? 0,
        consultor_total_deposited: consultorSummary?.consultor_total_deposited ?? 0,
      };
    });

    metaCampaignsData.sort((a, b) => b.spend - a.spend);

    return { success: true, metaFunnel, metaCampaignsData };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[Gestor Meta Live] Graph falhou:', msg);
    return { success: false, metaFunnel: null, metaCampaignsData: [], error: msg };
  }
}

/** Job único por integração (token Meta) para o painel admin — evita chamadas duplicadas. */
export type AdminMetaLiveJob =
  | { kind: 'shared'; integrationId: string; representativeBancaId: string; linkedBancaIds: string[] }
  | { kind: 'legacy'; representativeBancaId: string; linkedBancaIds: string[] };

export interface AdminMetaLiveCampaignRow {
  banca_id: string;
  banca_name: string;
  banca_url: string | null;
  /** Gestores (hierarquia + user_bancas) da banca CRM atribuída à linha — preenchido em `enrichAdminMetaCampaignRowsWithBancaNames`. */
  gestor_names?: string[];
  campaign_id: string;
  /** Tipo salvo em `meta_campaigns` (sincronizado). */
  campaign_kind: 'normal' | 'bolao';
  name: string;
  objective: string | null;
  status: string | null;
  effective_status: string | null;
  daily_budget: number | null;
  lifetime_budget: number | null;
  start_time: string | null;
  stop_time: string | null;
  reach: number;
  impressions: number;
  clicks: number;
  leads: number;
  results: number;
  spend: number;
  integration_id: string | null;
  ad_account_id: string | null;
  insights_source: string | null;
}

export interface AdminMetaLiveIntegrationTrace {
  integration_id: string | null;
  representative_banca_id: string;
  ad_account_id: string | null;
  insights_source: string | null;
  error?: string;
}

export interface AdminMetaLiveAggregateResult {
  success: boolean;
  error?: string;
  date_from: string | null;
  date_to: string | null;
  totals: {
    campaigns_with_metrics: number;
    reach: number;
    impressions: number;
    clicks: number;
    leads: number;
    results: number;
    spend: number;
    /** Gasto só em campanhas marcadas como bolão no CRM. */
    spend_bolao: number;
    /** Soma de resultados (ações Meta) em campanhas tipo normal / bolão. */
    results_normal: number;
    results_bolao: number;
  };
  campaigns: AdminMetaLiveCampaignRow[];
  integrations: AdminMetaLiveIntegrationTrace[];
}

export async function listAdminMetaLiveJobs(includeInactiveIntegrations = false): Promise<AdminMetaLiveJob[]> {
  const jobs: AdminMetaLiveJob[] = [];
  const bancasCoveredByShared = new Set<string>();

  let cfgQuery = supabaseServiceRole
    .from('meta_integration_configs')
    .select('id')
    .not('access_token_encrypted', 'is', null);
  if (!includeInactiveIntegrations) {
    cfgQuery = cfgQuery.eq('is_active', true);
  }
  const { data: configs, error: cfgErr } = await cfgQuery;
  if (cfgErr) {
    logMetaReturn('listAdminMetaLiveJobs configs', { error: cfgErr.message });
  }

  for (const row of configs ?? []) {
    const integrationId = String((row as { id: string }).id);
    const linked = await listBancasByIntegration(integrationId);
    if (linked.length === 0) continue;
    for (const b of linked) bancasCoveredByShared.add(b);
    jobs.push({
      kind: 'shared',
      integrationId,
      representativeBancaId: linked[0],
      linkedBancaIds: linked,
    });
  }

  const { data: legacies, error: legErr } = await supabaseServiceRole
    .from('meta_integrations')
    .select('banca_id')
    .eq('is_active', true)
    .not('access_token_encrypted', 'is', null);
  if (legErr) {
    logMetaReturn('listAdminMetaLiveJobs legacies', { error: legErr.message });
  }

  for (const row of legacies ?? []) {
    const bid = String((row as { banca_id: string }).banca_id);
    if (bancasCoveredByShared.has(bid)) continue;
    jobs.push({ kind: 'legacy', representativeBancaId: bid, linkedBancaIds: [bid] });
  }

  const sharedJobs = jobs.filter((j) => j.kind === 'shared');
  const legacyJobs = jobs.filter((j) => j.kind === 'legacy');
  const totalSharedBancas = sharedJobs.reduce((sum, j) => sum + j.linkedBancaIds.length, 0);
  logMetaReturn('listAdminMetaLiveJobs ← deduplicação por integração', {
    include_inactive_integrations: includeInactiveIntegrations,
    integrations_total: jobs.length,
    shared_integrations: sharedJobs.length,
    bancas_cobertas_shared: totalSharedBancas,
    legacy_integrations: legacyJobs.length,
    deduplicacao_eficiencia: sharedJobs.length > 0
      ? `${sharedJobs.length} chamada(s) cobrem ${totalSharedBancas} banca(s)`
      : 'sem integrações compartilhadas',
  });

  return jobs;
}

export type ConsolidateAllActiveCampaignsSpendOptions = GetActiveCampaignsSpendOptions & {
  /** Quando true, inclui linhas inativas em `meta_integration_configs`. */
  includeInactiveIntegrations?: boolean;
};

/** Campanha ativa (insights) + origem multi-tenant. */
export type ConsolidatedActiveCampaignSpendEntry = ActiveCampaignSpendRow & {
  integration_id: string;
  source: 'shared' | 'legacy';
  ad_account_id: string;
  banca_ids: string[];
};

export type ConsolidatedActiveCampaignsSpendIntegrationSlice = {
  integration_id: string;
  source: 'shared' | 'legacy';
  ad_account_id: string | null;
  banca_ids: string[];
  total_spend: number;
  campaigns: ActiveCampaignSpendRow[];
  error?: string;
};

export type ConsolidatedActiveCampaignsSpendAllResult = {
  campaigns: ConsolidatedActiveCampaignSpendEntry[];
  by_integration: ConsolidatedActiveCampaignsSpendIntegrationSlice[];
  summary: {
    integrations_total: number;
    integrations_ok: number;
    integrations_failed: number;
    campaigns_total: number;
    total_spend: number;
  };
};

/**
 * Percorre todas as integrações Meta com token (modelo compartilhado + legado sem vínculo duplicado),
 * busca insights de campanhas com entrega ativa por conta e consolida em uma resposta.
 * Chamadas Graph são **sequenciais** para reduzir risco de rate limit.
 */
export async function consolidateActiveCampaignsSpendAllIntegrations(
  options?: ConsolidateAllActiveCampaignsSpendOptions
): Promise<ConsolidatedActiveCampaignsSpendAllResult> {
  const { includeInactiveIntegrations, ...spendOpts } = options ?? {};
  const jobs = await listAdminMetaLiveJobs(includeInactiveIntegrations === true);
  const by_integration: ConsolidatedActiveCampaignsSpendIntegrationSlice[] = [];
  const campaignsFlat: ConsolidatedActiveCampaignSpendEntry[] = [];

  for (const job of jobs) {
    const banca_ids = job.linkedBancaIds;
    let integration_id = '';
    const source: 'shared' | 'legacy' = job.kind === 'shared' ? 'shared' : 'legacy';
    let baseUrl = DEFAULT_BASE_URL;
    let adAccountId: string | null = null;
    let token: string | null = null;

    if (job.kind === 'shared') {
      integration_id = job.integrationId;
      token = await getDecryptedTokenByIntegrationId(integration_id);
      const { data } = await supabaseServiceRole
        .from('meta_integration_configs')
        .select('base_url, ad_account_id')
        .eq('id', integration_id)
        .maybeSingle();
      baseUrl = String(data?.base_url ?? DEFAULT_BASE_URL).trim() || DEFAULT_BASE_URL;
      adAccountId = data?.ad_account_id != null ? String(data.ad_account_id).trim() : null;
    } else {
      token = await getLegacyDecryptedToken(job.representativeBancaId);
      const { data } = await supabaseServiceRole
        .from('meta_integrations')
        .select('id, base_url, ad_account_id')
        .eq('banca_id', job.representativeBancaId)
        .maybeSingle();
      integration_id = data?.id != null ? String(data.id) : `legacy:${job.representativeBancaId}`;
      baseUrl = String(data?.base_url ?? DEFAULT_BASE_URL).trim() || DEFAULT_BASE_URL;
      adAccountId = data?.ad_account_id != null ? String(data.ad_account_id).trim() : null;
    }

    if (!token || !adAccountId) {
      by_integration.push({
        integration_id,
        source,
        ad_account_id: adAccountId,
        banca_ids,
        total_spend: 0,
        campaigns: [],
        error: !token ? 'Token indisponível.' : 'ad_account_id não configurado.',
      });
      continue;
    }

    try {
      const { campaigns, totalSpend } = await getActiveCampaignsSpend(baseUrl, token, adAccountId, spendOpts);
      by_integration.push({
        integration_id,
        source,
        ad_account_id: adAccountId,
        banca_ids,
        total_spend: totalSpend,
        campaigns,
      });
      for (const c of campaigns) {
        campaignsFlat.push({
          ...c,
          integration_id,
          source,
          ad_account_id: adAccountId,
          banca_ids: [...banca_ids],
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      by_integration.push({
        integration_id,
        source,
        ad_account_id: adAccountId,
        banca_ids,
        total_spend: 0,
        campaigns: [],
        error: msg,
      });
    }
  }

  const integrations_ok = by_integration.filter((s) => !s.error).length;
  const integrations_failed = by_integration.filter((s) => Boolean(s.error)).length;
  const total_spend = by_integration.reduce((s, x) => s + x.total_spend, 0);

  return {
    campaigns: campaignsFlat,
    by_integration,
    summary: {
      integrations_total: jobs.length,
      integrations_ok,
      integrations_failed,
      campaigns_total: campaignsFlat.length,
      total_spend,
    },
  };
}

/**
 * Lista jobs só para integrações que têm vínculo em `meta_integration_bancas` com alguma das bancas pedidas.
 * Garante que, com duas (ou mais) integrações na mesma banca, todas entram no live aggregate (scan global por configs pode falhar em edge cases / ordem).
 */
async function listAdminMetaLiveJobsForBancaScope(
  bancaIds: string[],
  includeInactiveIntegrations: boolean
): Promise<AdminMetaLiveJob[]> {
  const scope = Array.from(new Set(bancaIds.map((s) => String(s).trim()).filter(Boolean)));
  if (scope.length === 0) return [];

  const { data: links, error: linkErr } = await supabaseServiceRole
    .from('meta_integration_bancas')
    .select('integration_id')
    .in('banca_id', scope);
  if (linkErr) {
    logMetaReturn('listAdminMetaLiveJobsForBancaScope links', { error: linkErr.message });
    return [];
  }

  const integrationIds = Array.from(
    new Set((links ?? []).map((r: { integration_id: string }) => String(r.integration_id)).filter(Boolean))
  );

  const jobs: AdminMetaLiveJob[] = [];
  const bancasCoveredByShared = new Set<string>();

  for (const integrationId of integrationIds) {
    let cfgQuery = supabaseServiceRole
      .from('meta_integration_configs')
      .select('id')
      .eq('id', integrationId)
      .not('access_token_encrypted', 'is', null);
    if (!includeInactiveIntegrations) {
      cfgQuery = cfgQuery.eq('is_active', true);
    }
    const { data: cfg, error: cfgErr } = await cfgQuery.maybeSingle();
    if (cfgErr || !cfg) continue;

    const linked = await listBancasByIntegration(integrationId);
    if (linked.length === 0) continue;
    if (!linked.some((b) => scope.includes(b))) continue;

    for (const b of linked) bancasCoveredByShared.add(b);
    const rep = scope.find((b) => linked.includes(b)) ?? linked[0];
    jobs.push({
      kind: 'shared',
      integrationId,
      representativeBancaId: rep,
      linkedBancaIds: linked,
    });
  }

  const { data: legacies, error: legErr } = await supabaseServiceRole
    .from('meta_integrations')
    .select('banca_id')
    .eq('is_active', true)
    .not('access_token_encrypted', 'is', null);
  if (legErr) {
    logMetaReturn('listAdminMetaLiveJobsForBancaScope legacies', { error: legErr.message });
  }
  for (const row of legacies ?? []) {
    const bid = String((row as { banca_id: string }).banca_id);
    if (!scope.includes(bid) || bancasCoveredByShared.has(bid)) continue;
    jobs.push({ kind: 'legacy', representativeBancaId: bid, linkedBancaIds: [bid] });
    bancasCoveredByShared.add(bid);
  }

  return jobs;
}

function normalizeScopeBancaIdsForAggregate(ids: string[]): string[] {
  return Array.from(new Set(ids.map((s) => String(s ?? '').trim()).filter(Boolean)));
}

/** Monta a lista de jobs do painel admin live: por escopo de banca(s) ou todas. */
async function resolveAdminMetaLiveJobsForAggregate(
  scopeBancaIds: string[],
  overviewBancaId: string | null
): Promise<AdminMetaLiveJob[]> {
  const scopeNorm = normalizeScopeBancaIdsForAggregate(scopeBancaIds);
  const overview = overviewBancaId?.trim() || null;
  const bancasParaBusca = scopeNorm.length > 0 ? scopeNorm : overview ? [overview] : [];

  let allJobs: AdminMetaLiveJob[];
  if (bancasParaBusca.length > 0) {
    allJobs = await listAdminMetaLiveJobsForBancaScope(bancasParaBusca, true);
  } else {
    allJobs = await listAdminMetaLiveJobs(true);
  }

  const filtered = allJobs.filter((j) => jobMatchesScope(j, scopeNorm, overview));

  const sharedIds = filtered
    .filter((j): j is AdminMetaLiveJob & { kind: 'shared' } => j.kind === 'shared')
    .map((j) => j.integrationId);

  logMetaReturn('resolveAdminMetaLiveJobsForAggregate', {
    bancas_buscadas: bancasParaBusca,
    overview_banca_id: overview,
    candidatos: allJobs.length,
    jobs_finais: filtered.length,
    integration_ids_shared: sharedIds,
  });

  return filtered;
}

function jobMatchesScope(job: AdminMetaLiveJob, scopeBancaIds: string[], overviewBancaId: string | null): boolean {
  const linked = new Set(job.linkedBancaIds);
  if (overviewBancaId && !linked.has(overviewBancaId)) return false;
  if (scopeBancaIds.length === 0) return true;
  return job.linkedBancaIds.some((id) => scopeBancaIds.includes(id));
}

function resolveCampaignOwnerBancaId(
  job: AdminMetaLiveJob,
  campaignId: string,
  ownerByCampaign: Map<string, string>
): string | null {
  const owned = ownerByCampaign.get(String(campaignId));
  if (owned) return owned;
  if (job.linkedBancaIds.length === 1) return job.linkedBancaIds[0];
  return null;
}

export type AdminMetaLiveJobProcessContext = {
  datePreset: string;
  timeRangeUtc: { since: string; until: string };
  preferTimeRangeFirst: boolean;
  dateFrom: string | null;
  dateTo: string | null;
  overviewBancaId: string | null;
  scopeBancaIds: string[];
  activeOnly: boolean;
};

function computeAdminMetaTotalsFromCampaignRows(rows: AdminMetaLiveCampaignRow[]): AdminMetaLiveAggregateResult['totals'] {
  return rows.reduce(
    (acc, row) => {
      acc.campaigns_with_metrics += 1;
      acc.reach += row.reach;
      acc.impressions += row.impressions;
      acc.clicks += row.clicks;
      acc.leads += row.leads;
      acc.results += row.results;
      acc.spend += row.spend;
      if (row.campaign_kind === 'bolao') {
        acc.spend_bolao += row.spend;
        acc.results_bolao += row.results;
      } else {
        acc.results_normal += row.results;
      }
      return acc;
    },
    {
      campaigns_with_metrics: 0,
      reach: 0,
      impressions: 0,
      clicks: 0,
      leads: 0,
      results: 0,
      spend: 0,
      spend_bolao: 0,
      results_normal: 0,
      results_bolao: 0,
    }
  );
}

async function enrichAdminMetaCampaignRowsWithBancaNames(rows: AdminMetaLiveCampaignRow[]): Promise<void> {
  const bancaIds = Array.from(new Set(rows.map((r) => r.banca_id)));
  if (bancaIds.length === 0) return;
  const { data: bancas } = await supabaseServiceRole.from('crm_bancas').select('id,name,url').in('id', bancaIds);
  const bancaById = new Map<string, CrmBancaLite>(
    (bancas ?? []).map((b: { id: string; name: string | null; url: string | null }) => [b.id, b])
  );
  let gestorByBanca = new Map<string, string[]>();
  try {
    gestorByBanca = await buildGestorNamesByCrmBancaIdMap(bancaIds, bancaById);
  } catch (err: unknown) {
    logMetaReturn('enrichAdminMetaCampaignRowsWithBancaNames gestor_names', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  for (const row of rows) {
    const b = bancaById.get(row.banca_id);
    row.banca_name = b?.name ?? b?.url ?? row.banca_id;
    row.banca_url = b?.url ?? null;
    row.gestor_names = gestorByBanca.get(row.banca_id) ?? [];
  }
}

/**
 * Uma integração Meta (job) → linhas de campanha + trace. Usado em paralelo (aggregate) ou em série (stream).
 */
async function processAdminMetaLiveJob(
  job: AdminMetaLiveJob,
  ctx: AdminMetaLiveJobProcessContext
): Promise<{ traces: AdminMetaLiveIntegrationTrace[]; rows: AdminMetaLiveCampaignRow[] }> {
  const traces: AdminMetaLiveIntegrationTrace[] = [];
  const campaignRows: AdminMetaLiveCampaignRow[] = [];
  const {
    datePreset,
    timeRangeUtc,
    preferTimeRangeFirst,
    dateFrom,
    dateTo,
    overviewBancaId,
    scopeBancaIds,
    activeOnly,
  } = ctx;

  const integrationId = job.kind === 'shared' ? job.integrationId : null;
  const rep = job.representativeBancaId;
  const token =
    integrationId != null ? await getDecryptedTokenByIntegrationId(integrationId) : await getDecryptedToken(rep);
  if (!token) {
    traces.push({
      integration_id: integrationId,
      representative_banca_id: rep,
      ad_account_id: null,
      insights_source: null,
      error: 'Token não configurado.',
    });
    return { traces, rows: campaignRows };
  }

  const { baseUrl, adAccountId: configuredAdAccountIdRaw } =
    integrationId != null
      ? await resolveMetaApiContextByIntegrationId(integrationId)
      : await resolveMetaApiContext(rep);

  const configuredIds = parseConfiguredAdAccountIds(configuredAdAccountIdRaw ?? undefined);

  let candidateAccountIds: string[] = [...configuredIds];
  if (candidateAccountIds.length === 0) {
    try {
      const fromToken = await getAdAccounts(baseUrl, token);
      candidateAccountIds.push(...fromToken.map((a) => String(a.id)).filter(Boolean));
    } catch {
      /* ignore */
    }
  }
  candidateAccountIds = Array.from(new Set(candidateAccountIds));

  if (candidateAccountIds.length === 0) {
    traces.push({
      integration_id: integrationId,
      representative_banca_id: rep,
      ad_account_id: null,
      insights_source: null,
      error: 'Nenhuma conta de anúncio disponível.',
    });
    return { traces, rows: campaignRows };
  }

  const allCampaigns: Awaited<ReturnType<typeof listCampaigns>> = [];
  const workingAccountIds: string[] = [];
  const attemptErrors: string[] = [];

  for (const candidateId of candidateAccountIds) {
    try {
      const c = await listCampaigns(baseUrl, token, candidateId);
      allCampaigns.push(...c);
      workingAccountIds.push(candidateId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      attemptErrors.push(`${candidateId}: ${msg}`);
    }
  }

  if (workingAccountIds.length === 0) {
    traces.push({
      integration_id: integrationId,
      representative_banca_id: rep,
      ad_account_id: null,
      insights_source: null,
      error: `Falha ao listar campanhas: ${attemptErrors.join(' | ')}`,
    });
    return { traces, rows: campaignRows };
  }

  const strictInsightRange =
    preferTimeRangeFirst && dateFrom && dateTo && dateFrom <= dateTo
      ? { from: dateFrom, to: dateTo }
      : undefined;

  const allInsightsResults = await Promise.allSettled(
    workingAccountIds.map((accountId) =>
      fetchCampaignInsightsWithFallbacks(baseUrl, token, accountId, datePreset, timeRangeUtc, {
        preferTimeRangeFirst,
        strictInsightRange,
      })
    )
  );

  let insights: MetaInsight[] = [];
  let sourceLabel = '';
  for (const result of allInsightsResults) {
    if (result.status === 'fulfilled') {
      insights.push(...result.value.insights);
      if (!sourceLabel) sourceLabel = result.value.sourceLabel;
    }
  }
  if (preferTimeRangeFirst && dateFrom && dateTo) {
    insights = filterInsightsByDateStartRange(insights, dateFrom, dateTo);
  }

  const normalizedAdAccountIds = workingAccountIds.map((id) => (id.startsWith('act_') ? id : `act_${id}`));
  const campaigns = allCampaigns;

  const visible = campaigns.filter((c) => {
    if (!activeOnly) return true;
    return c.status === 'ACTIVE' || c.effective_status === 'ACTIVE';
  });
  const visibleIds = new Set(visible.map((c) => String(c.id)));

  const fetchedCampaignIds = Array.from(visibleIds);
  const ownerByCampaign = new Map<string, string>();
  const kindByBancaCampaign = new Map<string, 'normal' | 'bolao'>();
  if (fetchedCampaignIds.length > 0) {
    const { data: existingOwners } = await supabaseServiceRole
      .from('meta_campaigns')
      .select('campaign_id, banca_id, updated_at, campaign_kind')
      .in('campaign_id', fetchedCampaignIds)
      .in('banca_id', job.linkedBancaIds)
      .order('updated_at', { ascending: false });
    for (const row of existingOwners ?? []) {
      const campaignId = String((row as { campaign_id: string }).campaign_id);
      const ownerBancaId = String((row as { banca_id: string }).banca_id);
      if (!ownerByCampaign.has(campaignId)) ownerByCampaign.set(campaignId, ownerBancaId);
      const bk = `${ownerBancaId}:${campaignId}`;
      if (!kindByBancaCampaign.has(bk)) {
        const rawKind = (row as { campaign_kind?: string | null }).campaign_kind;
        kindByBancaCampaign.set(bk, String(rawKind || 'normal') === 'bolao' ? 'bolao' : 'normal');
      }
    }
  }

  const metricsByCampaign = new Map<
    string,
    { reach: number; impressions: number; clicks: number; spend: number; leads: number; results: number }
  >();

  for (const ins of insights) {
    const cid = ins.campaign_id ? String(ins.campaign_id) : '';
    if (!cid || !visibleIds.has(cid)) continue;
    const cur = metricsByCampaign.get(cid) ?? {
      reach: 0,
      impressions: 0,
      clicks: 0,
      spend: 0,
      leads: 0,
      results: 0,
    };
    cur.reach += parseInt(ins.reach || '0', 10) || 0;
    cur.impressions += parseInt(ins.impressions || '0', 10) || 0;
    cur.clicks += parseInt(ins.clicks || '0', 10) || 0;
    cur.spend += parseFloat(ins.spend || '0') || 0;
    cur.leads += leadsFromMetaInsightActions(ins.actions);
    cur.results += extractResultsFromInsightActions(ins.actions);
    metricsByCampaign.set(cid, cur);
  }

  const normalizedAdAccount = normalizedAdAccountIds.join(', ');

  for (const c of visible) {
    const cid = String(c.id);
    const m = metricsByCampaign.get(cid) ?? {
      reach: 0,
      impressions: 0,
      clicks: 0,
      spend: 0,
      leads: 0,
      results: 0,
    };
    const hasMetrics =
      m.reach > 0 ||
      m.impressions > 0 ||
      m.clicks > 0 ||
      m.leads > 0 ||
      m.results > 0 ||
      m.spend > 0;
    if (!hasMetrics) continue;

    let resolvedBancaId = resolveCampaignOwnerBancaId(job, cid, ownerByCampaign);
    if (!resolvedBancaId && overviewBancaId && job.linkedBancaIds.includes(overviewBancaId)) {
      resolvedBancaId = overviewBancaId;
    }
    if (!resolvedBancaId && scopeBancaIds.length === 1 && job.linkedBancaIds.includes(scopeBancaIds[0])) {
      resolvedBancaId = scopeBancaIds[0];
    }
    if (!resolvedBancaId) continue;
    if (overviewBancaId && resolvedBancaId !== overviewBancaId) continue;
    if (scopeBancaIds.length > 0 && !scopeBancaIds.includes(resolvedBancaId)) continue;

    const kindKey = `${resolvedBancaId}:${cid}`;
    const campaign_kind = kindByBancaCampaign.get(kindKey) ?? 'normal';

    campaignRows.push({
      banca_id: resolvedBancaId,
      banca_name: resolvedBancaId,
      banca_url: null,
      campaign_id: cid,
      campaign_kind,
      name: c.name || cid,
      objective: c.objective ?? null,
      status: c.status ?? null,
      effective_status: c.effective_status ?? null,
      daily_budget: normalizeBudget(c.daily_budget ?? null),
      lifetime_budget: normalizeBudget(c.lifetime_budget ?? null),
      start_time: c.start_time ?? null,
      stop_time: c.stop_time ?? null,
      reach: m.reach,
      impressions: m.impressions,
      clicks: m.clicks,
      leads: m.leads,
      results: m.results,
      spend: m.spend,
      integration_id: integrationId,
      ad_account_id: normalizedAdAccount,
      insights_source: sourceLabel,
    });
  }

  traces.push({
    integration_id: integrationId,
    representative_banca_id: rep,
    ad_account_id: normalizedAdAccount,
    insights_source: sourceLabel,
  });

  return { traces, rows: campaignRows };
}

export type AdminMetaLiveStreamBatchEvent = {
  type: 'batch';
  batchIndex: number;
  totalBatches: number;
  integrations_delta: AdminMetaLiveIntegrationTrace[];
  campaigns_delta: AdminMetaLiveCampaignRow[];
  totals: AdminMetaLiveAggregateResult['totals'];
};

export type AdminMetaLiveStreamCompleteEvent = {
  type: 'complete';
  date_from: string | null;
  date_to: string | null;
  totals: AdminMetaLiveAggregateResult['totals'];
  campaigns: AdminMetaLiveCampaignRow[];
  integrations: AdminMetaLiveIntegrationTrace[];
};

export type AdminMetaLiveStreamErrorEvent = {
  type: 'error';
  error: string;
};

/**
 * Processa integrações em série e emite um lote após cada uma (NDJSON no cliente).
 */
export async function* iterateAdminMetaLiveAggregateStream(opts: {
  dateFrom: string | null;
  dateTo: string | null;
  scopeBancaIds: string[];
  overviewBancaId: string | null;
  activeOnly: boolean;
  datePreset?: string;
}): AsyncGenerator<AdminMetaLiveStreamBatchEvent | AdminMetaLiveStreamCompleteEvent | AdminMetaLiveStreamErrorEvent> {
  const { dateFrom, dateTo, scopeBancaIds, overviewBancaId, activeOnly } = opts;
  const datePreset = (opts.datePreset || DEFAULT_DATE_PRESET).trim() || DEFAULT_DATE_PRESET;
  const preferTimeRangeFirst = Boolean(dateFrom && dateTo && dateFrom <= dateTo);
  const timeRangeUtc =
    dateFrom && dateTo ? { since: dateFrom, until: dateTo } : getTimeRangeSinceUntil(30);

  const ctx: AdminMetaLiveJobProcessContext = {
    datePreset,
    timeRangeUtc,
    preferTimeRangeFirst,
    dateFrom,
    dateTo,
    overviewBancaId,
    scopeBancaIds,
    activeOnly,
  };

  let allJobs = await resolveAdminMetaLiveJobsForAggregate(scopeBancaIds, overviewBancaId);

  if (allJobs.length === 0) {
    const emptyTotals = computeAdminMetaTotalsFromCampaignRows([]);
    yield {
      type: 'complete',
      date_from: dateFrom,
      date_to: dateTo,
      totals: emptyTotals,
      campaigns: [],
      integrations: [],
    };
    return;
  }

  const accumulated: AdminMetaLiveCampaignRow[] = [];
  const integrationTraces: AdminMetaLiveIntegrationTrace[] = [];

  for (let i = 0; i < allJobs.length; i++) {
    const job = allJobs[i];
    try {
      const { traces, rows } = await processAdminMetaLiveJob(job, ctx);
      integrationTraces.push(...traces);
      accumulated.push(...rows);
      await enrichAdminMetaCampaignRowsWithBancaNames(rows);
      const totals = computeAdminMetaTotalsFromCampaignRows(accumulated);
      yield {
        type: 'batch',
        batchIndex: i,
        totalBatches: allJobs.length,
        integrations_delta: traces,
        campaigns_delta: rows,
        totals,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logMetaReturn('iterateAdminMetaLiveAggregateStream job error', { batchIndex: i, error: msg });
      yield {
        type: 'error',
        error: msg,
      };
    }
  }

  accumulated.sort((a, b) => b.spend - a.spend);
  const totals = computeAdminMetaTotalsFromCampaignRows(accumulated);
  yield {
    type: 'complete',
    date_from: dateFrom,
    date_to: dateTo,
    totals,
    campaigns: accumulated,
    integrations: integrationTraces,
  };
}

/**
 * Painel Admin Meta: mesma estratégia de insights que runSync (`fetchCampaignInsightsWithFallbacks`),
 * em todas as integrações ativas, com nomes de campanha vindos do Graph e métricas somadas no intervalo
 * (série diária da Meta, `time_increment=1`). Respeita filtro de bancas e período da UI.
 */
export async function fetchAdminMetaLiveAggregate(opts: {
  dateFrom: string | null;
  dateTo: string | null;
  scopeBancaIds: string[];
  overviewBancaId: string | null;
  activeOnly: boolean;
  datePreset?: string;
}): Promise<AdminMetaLiveAggregateResult> {
  const { dateFrom, dateTo, scopeBancaIds, overviewBancaId, activeOnly } = opts;
  const datePreset = (opts.datePreset || DEFAULT_DATE_PRESET).trim() || DEFAULT_DATE_PRESET;
  /** Com início/fim na UI, não priorizar last_30d (senão soma 30 dias ignorando o filtro). */
  const preferTimeRangeFirst = Boolean(dateFrom && dateTo && dateFrom <= dateTo);

  const timeRangeUtc =
    dateFrom && dateTo
      ? { since: dateFrom, until: dateTo }
      : getTimeRangeSinceUntil(30);

  let allJobs = await resolveAdminMetaLiveJobsForAggregate(scopeBancaIds, overviewBancaId);
  if (allJobs.length === 0) {
    return {
      success: true,
      date_from: dateFrom,
      date_to: dateTo,
      totals: {
        campaigns_with_metrics: 0,
        reach: 0,
        impressions: 0,
        clicks: 0,
        leads: 0,
        results: 0,
        spend: 0,
        spend_bolao: 0,
        results_normal: 0,
        results_bolao: 0,
      },
      campaigns: [],
      integrations: [],
    };
  }

  const integrationTraces: AdminMetaLiveIntegrationTrace[] = [];
  const campaignRows: AdminMetaLiveCampaignRow[] = [];

  const jobCtx: AdminMetaLiveJobProcessContext = {
    datePreset,
    timeRangeUtc,
    preferTimeRangeFirst,
    dateFrom,
    dateTo,
    overviewBancaId,
    scopeBancaIds,
    activeOnly,
  };

  const settled = await Promise.allSettled(
    allJobs.map((job) => processAdminMetaLiveJob(job, jobCtx))
  );

  for (const r of settled) {
    if (r.status === 'fulfilled') {
      integrationTraces.push(...r.value.traces);
      campaignRows.push(...r.value.rows);
    } else {
      logMetaReturn('fetchAdminMetaLiveAggregate job rejected', {
        error: r.reason instanceof Error ? r.reason.message : String(r.reason),
      });
    }
  }

  await enrichAdminMetaCampaignRowsWithBancaNames(campaignRows);

  campaignRows.sort((a, b) => b.spend - a.spend);

  const totals = computeAdminMetaTotalsFromCampaignRows(campaignRows);

  return {
    success: true,
    date_from: dateFrom,
    date_to: dateTo,
    totals,
    campaigns: campaignRows,
    integrations: integrationTraces,
  };
}

/**
 * Reatribui uma campanha (e seus dados sincronizados) para outra banca
 * dentro do mesmo vínculo de integração compartilhada.
 */
async function findSharedIntegrationContainingBancas(
  sourceBancaId: string,
  targetBancaId: string
): Promise<string | null> {
  for (const iid of await listIntegrationIdsByBanca(sourceBancaId)) {
    const linked = new Set(await listBancasByIntegration(iid));
    if (linked.has(sourceBancaId) && linked.has(targetBancaId)) return iid;
  }
  return null;
}

export async function assignCampaignToBanca(
  contextBancaId: string,
  sourceBancaId: string,
  targetBancaId: string,
  campaignId: string
): Promise<{ success: boolean; moved?: { campaigns: number; adsets: number; insights: number }; error?: string }> {
  const integrationId =
    (await findSharedIntegrationContainingBancas(sourceBancaId, targetBancaId)) ??
    (await resolveIntegrationIdByBanca(contextBancaId));
  if (!integrationId) {
    return { success: false, error: 'Integração Meta não encontrada para a banca informada.' };
  }

  const linkedBancas = await listBancasByIntegration(integrationId);
  const linkedSet = new Set(linkedBancas);
  if (!linkedSet.has(sourceBancaId) || !linkedSet.has(targetBancaId)) {
    return { success: false, error: 'A banca de origem/destino não pertence à mesma integração.' };
  }
  if (!campaignId) {
    return { success: false, error: 'campaign_id é obrigatório.' };
  }
  if (sourceBancaId === targetBancaId) {
    return { success: true, moved: { campaigns: 0, adsets: 0, insights: 0 } };
  }

  const now = new Date().toISOString();
  try {
    // Evita conflito de chave única no destino quando já existir a mesma campanha.
    await supabaseServiceRole
      .from('meta_campaigns')
      .delete()
      .eq('banca_id', targetBancaId)
      .eq('campaign_id', campaignId);

    // Se já houver linhas de insights no destino para o mesmo campaign/date, mantém só a origem (mais recente do fluxo manual).
    await supabaseServiceRole
      .from('meta_insights_daily')
      .delete()
      .eq('banca_id', targetBancaId)
      .eq('campaign_id', campaignId);

    const { data: movedCampaigns, error: campaignErr } = await supabaseServiceRole
      .from('meta_campaigns')
      .update({ banca_id: targetBancaId, updated_at: now })
      .eq('banca_id', sourceBancaId)
      .eq('campaign_id', campaignId)
      .select('campaign_id');
    if (campaignErr) return { success: false, error: campaignErr.message };

    const { data: movedAdsets, error: adsetErr } = await supabaseServiceRole
      .from('meta_adsets')
      .update({ banca_id: targetBancaId, updated_at: now })
      .eq('banca_id', sourceBancaId)
      .eq('campaign_id', campaignId)
      .select('adset_id');
    if (adsetErr) return { success: false, error: adsetErr.message };

    const { data: movedInsights, error: insightErr } = await supabaseServiceRole
      .from('meta_insights_daily')
      .update({ banca_id: targetBancaId, updated_at: now })
      .eq('banca_id', sourceBancaId)
      .eq('campaign_id', campaignId)
      .select('date');
    if (insightErr) return { success: false, error: insightErr.message };

    return {
      success: true,
      moved: {
        campaigns: movedCampaigns?.length ?? 0,
        adsets: movedAdsets?.length ?? 0,
        insights: movedInsights?.length ?? 0,
      },
    };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Erro ao reatribuir campanha.' };
  }
}

/**
 * Sincroniza uma integração específica (ou legado quando integrationIdForConfig é null).
 */
async function runSyncSingle(
  bancaId: string,
  integrationIdForConfig: string | null,
  datePreset: string
): Promise<{
  success: boolean;
  campaignsCount?: number;
  adsetsCount?: number;
  insightsCount?: number;
  error?: string;
}> {
  let token: string | null = null;
  let baseUrl = DEFAULT_BASE_URL;
  let adAccountIdRaw: string | null = null;

  if (integrationIdForConfig) {
    token = await getDecryptedTokenByIntegrationId(integrationIdForConfig);
    const ctx = await resolveMetaApiContextByIntegrationId(integrationIdForConfig);
    baseUrl = ctx.baseUrl;
    adAccountIdRaw = ctx.adAccountId;
  } else {
    token = await getLegacyDecryptedToken(bancaId);
    const { data: leg } = await supabaseServiceRole
      .from('meta_integrations')
      .select('base_url, ad_account_id')
      .eq('banca_id', bancaId)
      .maybeSingle();
    baseUrl = (leg?.base_url as string) || DEFAULT_BASE_URL;
    adAccountIdRaw = (leg?.ad_account_id as string) || null;
  }

  if (!token) {
    return { success: false, error: 'Token não configurado.' };
  }

  const configuredExplicit = parseConfiguredAdAccountIds(adAccountIdRaw ?? undefined);

  let campaignsCount = 0;
  let adsetsCount = 0;
  let insightsCount = 0;

  // Referência UTC para fallback; insights usam principalmente date_preset (fuso da conta na Meta).
  const timeRange = getTimeRangeSinceUntil(30);

  try {
    let candidateAccountIds: string[] = [];
    if (configuredExplicit.length > 0) {
      candidateAccountIds = configuredExplicit;
    } else {
      try {
        const fromToken = await getAdAccounts(baseUrl, token);
        candidateAccountIds = Array.from(
          new Set(fromToken.map((a) => String(a.id)).filter(Boolean))
        );
      } catch {
        /* sem contas via token */
      }
    }
    if (candidateAccountIds.length === 0) {
      return {
        success: false,
        error: 'Ad Account ID não configurado e nenhuma conta de anúncio disponível no token.',
      };
    }

    let adAccountId = candidateAccountIds[0];
    let campaigns: Awaited<ReturnType<typeof listCampaigns>> | null = null;
    let adsets: Awaited<ReturnType<typeof listAdSets>> | null = null;
    let accountFinance: Awaited<ReturnType<typeof getAccountFinance>> | null = null;
    const attemptErrors: string[] = [];

    for (const candidateId of candidateAccountIds) {
      try {
        const [c, a, f] = await Promise.all([
          listCampaigns(baseUrl, token, candidateId),
          listAdSets(baseUrl, token, candidateId),
          getAccountFinance(baseUrl, token, candidateId).catch(() => null),
        ]);
        adAccountId = candidateId;
        campaigns = c;
        adsets = a;
        accountFinance = f;
        break;
      } catch (err: any) {
        const msg = err?.message || String(err);
        attemptErrors.push(`${candidateId}: ${msg}`);
      }
    }

    if (!campaigns || !adsets) {
      return {
        success: false,
        error: `Nenhuma conta de anúncio permitiu sincronizar. Tentativas: ${attemptErrors.join(' | ')}`,
      };
    }

    const { insights, sourceLabel: insightsSourceLabel } = await fetchCampaignInsightsWithFallbacks(
      baseUrl,
      token,
      adAccountId,
      datePreset,
      timeRange
    );

    const linkedBancas = integrationIdForConfig
      ? await listBancasByIntegration(integrationIdForConfig)
      : [bancaId];
    const scopeBancas = linkedBancas.length > 0 ? linkedBancas : [bancaId];
    const fetchedCampaignIds = Array.from(new Set(campaigns.map((c) => String(c.id)).filter(Boolean)));
    const ownerByCampaign = new Map<string, string>();
    if (fetchedCampaignIds.length > 0) {
      const { data: existingOwners } = await supabaseServiceRole
        .from('meta_campaigns')
        .select('campaign_id, banca_id, updated_at')
        .in('campaign_id', fetchedCampaignIds)
        .in('banca_id', scopeBancas)
        .order('updated_at', { ascending: false });
      for (const row of existingOwners ?? []) {
        const campaignId = String((row as { campaign_id: string }).campaign_id);
        const ownerBancaId = String((row as { banca_id: string }).banca_id);
        if (!ownerByCampaign.has(campaignId)) ownerByCampaign.set(campaignId, ownerBancaId);
      }
    }
    const resolveCampaignOwner = (campaignId: string | null | undefined): string =>
      (campaignId ? ownerByCampaign.get(String(campaignId)) : null) ?? bancaId;

    const kindByBancaCampaign = new Map<string, string>();
    if (fetchedCampaignIds.length > 0 && scopeBancas.length > 0) {
      const { data: kindRows } = await supabaseServiceRole
        .from('meta_campaigns')
        .select('banca_id,campaign_id,campaign_kind')
        .in('campaign_id', fetchedCampaignIds)
        .in('banca_id', scopeBancas);
      for (const row of kindRows ?? []) {
        const r = row as { banca_id: string; campaign_id: string; campaign_kind?: string | null };
        kindByBancaCampaign.set(`${r.banca_id}:${r.campaign_id}`, String(r.campaign_kind || 'normal'));
      }
    }

    const ins0 = insights[0] as unknown as Record<string, unknown> | undefined;
    const camp0 = campaigns[0] as unknown as Record<string, unknown> | undefined;
    const campaignStatusStats = campaigns.reduce<Record<string, number>>((acc, c) => {
      const s = String(c.effective_status || c.status || 'UNKNOWN');
      acc[s] = (acc[s] || 0) + 1;
      return acc;
    }, {});
    const campaignObjectiveStats = campaigns.reduce<Record<string, number>>((acc, c) => {
      const o = String(c.objective || 'UNKNOWN');
      acc[o] = (acc[o] || 0) + 1;
      return acc;
    }, {});
    const campaignOwnerPreview = campaigns.slice(0, 20).map((c) => ({
      campaign_id: c.id,
      campaign_name: c.name ?? null,
      owner_banca_id: resolveCampaignOwner(c.id),
    }));
    const metaMetricsByCampaign = new Map<
      string,
      { campaign_id: string; campaign_name: string | null; reach: number; impressions: number; clicks: number; leads: number; spend: number; insights_rows: number }
    >();
    for (const ins of insights) {
      const cid = String(ins.campaign_id ?? '').trim();
      if (!cid) continue;
      const cur =
        metaMetricsByCampaign.get(cid) ?? {
          campaign_id: cid,
          campaign_name: (ins.campaign_name as string | undefined) ?? null,
          reach: 0,
          impressions: 0,
          clicks: 0,
          leads: 0,
          spend: 0,
          insights_rows: 0,
        };
      cur.reach += Number(ins.reach) || 0;
      cur.impressions += Number(ins.impressions) || 0;
      cur.clicks += Number(ins.clicks) || 0;
      cur.leads += Number((ins as { leads?: number | string | null }).leads) || 0;
      cur.spend += Number(ins.spend) || 0;
      cur.insights_rows += 1;
      if (!cur.campaign_name && ins.campaign_name) cur.campaign_name = String(ins.campaign_name);
      metaMetricsByCampaign.set(cid, cur);
    }
    const topCampaignMetricsFromMeta = [...metaMetricsByCampaign.values()]
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 20);
    const metricCoverageStats = {
      campaigns_from_meta: campaigns.length,
      campaigns_with_metrics: metaMetricsByCampaign.size,
      campaigns_without_metrics: Math.max(campaigns.length - metaMetricsByCampaign.size, 0),
      insights_rows_from_meta: insights.length,
    };
    const insightsWithCpa = insights.filter(
      (ins) => Array.isArray(ins.cost_per_action_type) && ins.cost_per_action_type.length > 0
    );
    const firstWithCpa = insightsWithCpa[0] as unknown as Record<string, unknown> | undefined;
    const adAcct = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
    logMetaReturn('runSync ← Meta (antes de gravar no DB)', {
      banca_id: bancaId,
      integration_id: integrationIdForConfig,
      ad_account_id: adAcct,
      time_range: timeRange,
      date_preset_param: datePreset,
      campaigns_from_meta: campaigns.length,
      first_campaign_keys: camp0 ? Object.keys(camp0) : [],
      first_campaign_sample: camp0
        ? {
            id: camp0.id ?? null,
            name: camp0.name ?? null,
            objective: camp0.objective ?? null,
            status: camp0.status ?? null,
            effective_status: camp0.effective_status ?? null,
            daily_budget: camp0.daily_budget ?? null,
            lifetime_budget: camp0.lifetime_budget ?? null,
            start_time: camp0.start_time ?? null,
            stop_time: camp0.stop_time ?? null,
          }
        : null,
      campaign_status_stats: campaignStatusStats,
      campaign_objective_stats: campaignObjectiveStats,
      campaign_owner_preview: campaignOwnerPreview,
      campaign_metrics_coverage: metricCoverageStats,
      top_campaign_metrics_from_meta: topCampaignMetricsFromMeta,
      adsets_from_meta: adsets.length,
      insights_rows_from_meta: insights.length,
      account_finance: accountFinance
        ? {
            currency: accountFinance.currency ?? null,
            timezone_name: accountFinance.timezone_name ?? null,
            has_amount_spent: accountFinance.amount_spent != null,
            has_balance: accountFinance.balance != null,
          }
        : null,
      first_insight_keys: ins0 ? Object.keys(ins0) : [],
      first_insight_sample: ins0
        ? {
            date_start: ins0.date_start ?? null,
            campaign_id: ins0.campaign_id ?? null,
            campaign_name: ins0.campaign_name ?? null,
            spend: ins0.spend ?? null,
            impressions: ins0.impressions ?? null,
            actions_len: Array.isArray(ins0.actions) ? (ins0.actions as unknown[]).length : 0,
            cost_per_action_type_len: Array.isArray(ins0.cost_per_action_type)
              ? (ins0.cost_per_action_type as unknown[]).length
              : 0,
            cost_per_action_type_sample: Array.isArray(ins0.cost_per_action_type)
              ? (ins0.cost_per_action_type as unknown[]).slice(0, 5)
              : null,
          }
        : null,
      cost_per_action_type_stats: {
        insights_with_cost_per_action_type: insightsWithCpa.length,
        first_campaign_with_cost_per_action_type: firstWithCpa?.campaign_id ?? null,
        first_cost_per_action_type_sample: Array.isArray(firstWithCpa?.cost_per_action_type)
          ? (firstWithCpa!.cost_per_action_type as unknown[]).slice(0, 5)
          : null,
      },
    });

    const accountCurrency = accountFinance?.currency || 'BRL';

    const now = new Date().toISOString();

    for (const c of campaigns) {
      const ownerBancaId = resolveCampaignOwner(c.id);
      const preservedKind = kindByBancaCampaign.get(`${ownerBancaId}:${c.id}`) ?? 'normal';
      const { error } = await supabaseServiceRole
        .from('meta_campaigns')
        .upsert(
          {
            banca_id: ownerBancaId,
            campaign_id: c.id,
            name: c.name,
            objective: c.objective,
            status: c.status,
            effective_status: c.effective_status,
            daily_budget: normalizeBudget(c.daily_budget),
            lifetime_budget: normalizeBudget(c.lifetime_budget),
            start_time: c.start_time || null,
            stop_time: c.stop_time || null,
            campaign_kind: preservedKind,
            updated_at: now,
          },
          { onConflict: 'banca_id,campaign_id' }
        );
      if (!error) campaignsCount++;
    }

    for (const a of adsets) {
      const ownerBancaId = resolveCampaignOwner(a.campaign_id);
      const { error } = await supabaseServiceRole
        .from('meta_adsets')
        .upsert(
          {
            banca_id: ownerBancaId,
            adset_id: a.id,
            campaign_id: a.campaign_id,
            name: a.name,
            status: a.status,
            effective_status: a.effective_status,
            daily_budget: normalizeBudget(a.daily_budget),
            lifetime_budget: normalizeBudget(a.lifetime_budget),
            billing_event: a.billing_event,
            optimization_goal: a.optimization_goal,
            start_time: a.start_time || null,
            end_time: a.end_time || null,
            updated_at: now,
          },
          { onConflict: 'banca_id,adset_id' }
        );
      if (!error) adsetsCount++;
    }

    for (const ins of insights) {
      const ownerBancaId = resolveCampaignOwner(ins.campaign_id);
      const row = mapInsightToRow(ins, ownerBancaId);
      const { error } = await supabaseServiceRole
        .from('meta_insights_daily')
        .upsert(
          {
            ...row,
            updated_at: now,
          },
          { onConflict: 'banca_id,date,campaign_id' }
        );
      if (!error) insightsCount++;
    }

    const presetLabel = insightsSourceLabel;
    if (integrationIdForConfig) {
      await supabaseServiceRole
        .from('meta_integration_configs')
        .update({
        last_sync_at: now,
        last_sync_error: null,
        last_sync_date_preset: presetLabel,
        ad_account_id: adAccountId,
        currency: accountCurrency,
        updated_at: now,
        })
        .eq('id', integrationIdForConfig);
    } else {
      await supabaseServiceRole
        .from('meta_integrations')
        .update({
          last_sync_at: now,
          last_sync_error: null,
          last_sync_date_preset: presetLabel,
          ad_account_id: adAccountId,
          currency: accountCurrency,
          updated_at: now,
        })
        .eq('banca_id', bancaId);
    }

    logMetaReturn('runSync → DB concluído', {
      banca_id: bancaId,
      integration_id: integrationIdForConfig,
      ad_account_id: adAcct,
      campaigns_upsert_ok: campaignsCount,
      adsets_upsert_ok: adsetsCount,
      insights_upsert_ok: insightsCount,
      preset_label: presetLabel,
      currency: accountCurrency,
    });

    return {
      success: true,
      campaignsCount,
      adsetsCount,
      insightsCount,
    };
  } catch (err: any) {
    const errMsg = err?.message || 'Erro ao sincronizar';
    logMetaReturn('runSync ✗', {
      banca_id: bancaId,
      integration_id: integrationIdForConfig,
      error: errMsg,
    });
    const ts = new Date().toISOString();
    if (integrationIdForConfig) {
      await supabaseServiceRole
        .from('meta_integration_configs')
        .update({
        last_sync_at: ts,
        last_sync_error: errMsg,
        updated_at: ts,
        })
        .eq('id', integrationIdForConfig);
    } else {
      await supabaseServiceRole
        .from('meta_integrations')
        .update({
          last_sync_at: ts,
          last_sync_error: errMsg,
          updated_at: ts,
        })
        .eq('banca_id', bancaId);
    }

    return { success: false, error: errMsg };
  }
}

export async function runSync(bancaId: string, datePreset = DEFAULT_DATE_PRESET): Promise<{
  success: boolean;
  campaignsCount?: number;
  adsetsCount?: number;
  insightsCount?: number;
  error?: string;
}> {
  const shared = await listIntegrationIdsByBanca(bancaId);
  const targets: Array<string | null> = shared.length > 0 ? [...shared] : [null];

  let campaignsCount = 0;
  let adsetsCount = 0;
  let insightsCount = 0;
  const errors: string[] = [];

  for (const tid of targets) {
    const r = await runSyncSingle(bancaId, tid, datePreset);
    if (!r.success) {
      errors.push(tid ? `${tid.slice(0, 8)}…: ${r.error || 'falha'}` : r.error || 'falha');
    } else {
      campaignsCount += r.campaignsCount ?? 0;
      adsetsCount += r.adsetsCount ?? 0;
      insightsCount += r.insightsCount ?? 0;
    }
  }

  return {
    success: errors.length === 0,
    error: errors.length ? errors.join(' | ') : undefined,
    campaignsCount,
    adsetsCount,
    insightsCount,
  };
}
