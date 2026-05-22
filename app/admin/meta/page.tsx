'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { convertMetaSpendToBrl } from '@/lib/services/exchange-rate-service';
import { useRequireAuth } from '@/utils/useRequireAuth';
import { useTenantRouter } from '@/lib/utils/tenant-href';
import Layout from '@/components/Layout';
import {
  BarChart3,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Save,
  ExternalLink,
  Building2,
  Key,
  Hash,
  Calendar,
  ChevronDown,
  ChevronUp,
  Target,
  Layers,
  TrendingUp,
  DollarSign,
  MousePointer,
  Eye,
  Link2,
  Users,
  UserPlus,
  Trash2,
  Radio,
  Unplug,
  X,
} from 'lucide-react';
import BancaXAdsRanking from '@/components/Meta/BancaXAdsRanking';

function formatBRL(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);
}

/**
 * Formata um valor monetário na moeda original da Ad Account.
 * - Para BRL/null: usa o pt-BR padrão.
 * - Para USD/EUR/...: usa pt-BR com a moeda informada (ex.: "US$ 12,34").
 */
function formatMoneyByCurrency(value: number, currency: string | null | undefined): string {
  const code = String(currency ?? '').trim().toUpperCase() || 'BRL';
  const safe = Number.isFinite(value) ? value : 0;
  try {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(safe);
  } catch {
    return formatBRL(safe);
  }
}

/** Símbolo curto da moeda para uso em badges (BRL → R$ / USD → US$ / EUR → €). */
function currencySymbol(code: string | null | undefined): string {
  const c = String(code ?? '').trim().toUpperCase();
  if (!c || c === 'BRL') return 'R$';
  if (c === 'USD') return 'US$';
  if (c === 'EUR') return '€';
  if (c === 'GBP') return '£';
  return c;
}

/** Chave estável por linha (campanha pode existir em mais de uma integração/conta). */
function metaCampaignStableKey(row: {
  banca_id?: unknown;
  campaign_id?: unknown;
  integration_id?: unknown;
  ad_account_id?: unknown;
}): string {
  return [
    String(row.banca_id ?? ''),
    String(row.campaign_id ?? ''),
    row.integration_id != null ? String(row.integration_id) : '',
    row.ad_account_id != null ? String(row.ad_account_id) : '',
  ].join(':');
}

type LocalMetaCurrencyChoice = 'BRL' | 'USD' | 'AUTO';

/** Cruza linha live com `campaigns-all` priorizando integração + conta quando existirem no cache. */
function findAllCampaignRowForLiveMerge(
  rows: any[] | undefined,
  bancaId: string,
  campaignId: string,
  integrationId: unknown,
  adAccountId: unknown
): any | undefined {
  if (!rows?.length) return undefined;
  const integ = integrationId != null && String(integrationId).trim() !== '' ? String(integrationId) : null;
  const ad = adAccountId != null && String(adAccountId).trim() !== '' ? String(adAccountId) : null;
  if (integ || ad) {
    const match = rows.find((r: any) => {
      if (String(r.banca_id) !== bancaId || String(r.campaign_id) !== campaignId) return false;
      if (integ && String(r.integration_id ?? '') !== integ) return false;
      if (ad && String(r.ad_account_id ?? '') !== ad) return false;
      return true;
    });
    if (match) return match;
  }
  return rows.find((r: any) => String(r.banca_id) === bancaId && String(r.campaign_id) === campaignId);
}

function shortUuid(id: string | null | undefined): string {
  const s = String(id ?? '').trim();
  if (!s) return '—';
  return s.length > 10 ? `${s.slice(0, 8)}…` : s;
}

function formatActShort(act: string | null | undefined): string {
  const s = String(act ?? '').trim();
  if (!s) return '—';
  const clean = s.startsWith('act_') ? s.slice(4) : s;
  return clean.length > 12 ? `…${clean.slice(-10)}` : clean;
}

/** IDs de conta de anúncio no campo (vírgula, ponto-e-vírgula ou quebra de linha). */
function parseAdAccountIdsField(raw: string | null | undefined): string[] {
  return String(raw ?? '')
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function adAccountIdsFieldWithoutIndex(raw: string, index: number): string {
  const ids = parseAdAccountIdsField(raw);
  ids.splice(index, 1);
  return ids.join(', ');
}

/**
 * Modo "Todas as bancas": a mesma `campaign_id` Meta pode existir em `meta_campaigns` para mais de uma banca
 * (ex.: conta duplicada entre integrações). Uma campanha = uma linha na tabela e nos totais de cache.
 */
function pickCanonicalMetaCampaignRowAmongDuplicates(candidates: any[]): any {
  if (!candidates?.length) return undefined;
  if (candidates.length === 1) return candidates[0];
  return [...candidates].sort((a, b) => {
    const ua = String(a?.updated_at ?? '').trim();
    const ub = String(b?.updated_at ?? '').trim();
    if (ua && ub && ua !== ub) return ub.localeCompare(ua);
    if (ua && !ub) return -1;
    if (!ua && ub) return 1;
    const sa = Number(a?.spend) || 0;
    const sb = Number(b?.spend) || 0;
    if (sa !== sb) return sb - sa;
    return String(a?.banca_id ?? '').localeCompare(String(b?.banca_id ?? ''));
  })[0];
}

function dedupeMetaCampaignRowsByGlobalCampaignId(rows: any[]): any[] {
  if (!rows?.length) return [];
  const byCampaign = new Map<string, any[]>();
  for (const r of rows) {
    const cid = String(r?.campaign_id ?? '').trim();
    if (!cid) continue;
    const arr = byCampaign.get(cid) ?? [];
    arr.push(r);
    byCampaign.set(cid, arr);
  }
  const winner = new Map<string, any>();
  for (const [cid, arr] of byCampaign) {
    winner.set(cid, pickCanonicalMetaCampaignRowAmongDuplicates(arr));
  }
  const seen = new Set<string>();
  const out: any[] = [];
  for (const r of rows) {
    const cid = String(r?.campaign_id ?? '').trim();
    if (!cid) {
      out.push(r);
      continue;
    }
    if (seen.has(cid)) continue;
    seen.add(cid);
    const w = winner.get(cid);
    if (w) out.push(w);
  }
  return out;
}

/** Cards e painéis — coerente com Layout (`dark:bg-[#1a1a1a]` no main). */
const metaCard =
  'bg-white dark:bg-[#252525] rounded-2xl border border-gray-200 dark:border-[#404040] shadow-sm dark:shadow-black/40';
const metaCardOverflow = `${metaCard} overflow-hidden`;

interface Banca {
  id: string;
  name: string;
  url: string;
}

interface MetaIntegrationPublic {
  integration_id: string;
  base_url: string;
  token_last4: string | null;
  ad_account_id: string | null;
  pixel_id: string | null;
  default_campaign_id: string | null;
  is_active: boolean;
  last_sync_at: string | null;
  last_sync_error: string | null;
  last_sync_date_preset: string | null;
  /** Bancas com vínculo em meta_integration_bancas para esta integração. */
  banca_ids?: string[];
}

interface MetaConfig {
  configured: boolean;
  integration_id?: string | null;
  integrations?: MetaIntegrationPublic[];
  banca_ids?: string[];
  base_url: string;
  token_last4: string | null;
  ad_account_id: string | null;
  pixel_id: string | null;
  default_campaign_id: string | null;
  is_active: boolean;
  last_sync_at: string | null;
  last_sync_error: string | null;
  last_sync_date_preset: string | null;
}

type MetaCampaignKind = 'normal' | 'bolao';

interface CampaignOption {
  id: string;
  name?: string;
  campaign_kind?: MetaCampaignKind;
}

type LiveAggregateTotalsShape = {
  campaigns_with_metrics: number;
  reach: number;
  impressions: number;
  clicks: number;
  leads: number;
  results: number;
  spend: number;
  spend_bolao?: number;
  results_normal?: number;
  results_bolao?: number;
};

type LiveAggregateBillingShape = {
  source?: string;
  unit?: string;
  accounts_count?: number;
  accounts_with_balance_due?: number;
  accounts_with_amount_spent?: number;
  accounts_with_card_charges?: number;
  currencies?: string[];
  currency?: string | null;
  total_balance_due?: number;
  total_amount_spent?: number;
  total_spend_cap?: number;
  total_card_charges?: number;
  /** Soma das cobranças em contas USD, em dólar (antes da conversão). */
  total_card_charges_usd?: number;
  card_charges_count?: number;
  total_card_charges_window?: number;
  total_card_charges_window_usd?: number;
  card_charges_count_window?: number;
  card_charges_period?: { since?: string | null; until?: string | null } | null;
  card_charges_window?: { since?: string | null; until?: string | null } | null;
  latest_card_charge?: {
    ad_account_id?: string;
    amount?: number | null;
    amount_brl?: number | null;
    event_time?: string | null;
    currency?: string | null;
    transaction_id?: string | null;
  } | null;
  accounts?: Array<Record<string, unknown>>;
};

interface MetaOverviewRow {
  banca_id: string;
  banca_name: string;
  banca_url: string;
  integration_id: string | null;
  integrations_count: number;
  integration_index: number;
  configured: boolean;
  is_active: boolean;
  base_url: string | null;
  token_last4: string | null;
  ad_account_id: string | null;
  pixel_id: string | null;
  default_campaign_id: string | null;
  last_sync_at: string | null;
  last_sync_error: string | null;
  last_sync_date_preset: string | null;
  metrics: {
    reach: number;
    impressions: number;
    clicks: number;
    leads: number;
    spend: number;
    insights_rows: number;
  };
  campaigns: {
    total: number;
    active: number;
    sample: Array<{
      campaign_id: string;
      name: string | null;
      status: string | null;
      effective_status: string | null;
      updated_at: string | null;
    }>;
  };
}

type OverviewKindSummaryBucket = {
  campaigns: number;
  reach: number;
  impressions: number;
  clicks: number;
  leads: number;
  spend: number;
  insights_rows: number;
};

/** `cost_per_action_type` da Meta Insights API, persistido como `raw_cost_per_action_type` (JSONB). */
function formatCostPerActionTypeCell(raw: unknown): { short: string; title: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { short: '—', title: '' };
  }
  const parts: string[] = [];
  for (const item of raw) {
    const o = item as { action_type?: string; value?: string };
    parts.push(`${o.action_type ?? '?'}: ${o.value ?? ''}`);
  }
  const title = parts.join('\n');
  const short =
    parts.slice(0, 2).join(' · ') + (parts.length > 2 ? ` (+${parts.length - 2})` : '');
  return { short, title };
}

/** Sugestões de imposto no card «Cobrado no Cartão» (percentual somado ao valor da Meta). */
const CARD_CHARGE_TAX_PRESETS = [12.15, 12.25, 13, 13.8, 14, 15] as const;
const CARD_CHARGE_TAX_DEFAULT = 12.25;
const CARD_CHARGE_TAX_MIN = 0;
const CARD_CHARGE_TAX_MAX = 50;
const CARD_CHARGE_TAX_STORAGE_KEY = 'admin_meta_card_charge_tax_pct';

function parseCardChargeTaxPct(raw: string | number | null): number {
  if (raw == null || raw === '') return CARD_CHARGE_TAX_DEFAULT;
  const n = Number(String(raw).replace(',', '.').trim());
  if (!Number.isFinite(n)) return CARD_CHARGE_TAX_DEFAULT;
  const clamped = Math.min(CARD_CHARGE_TAX_MAX, Math.max(CARD_CHARGE_TAX_MIN, n));
  return Math.round(clamped * 100) / 100;
}

function formatCardTaxPercentLabel(pct: number): string {
  const rounded = Math.round(pct * 100) / 100;
  const formatted = rounded.toLocaleString('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  return `${formatted}%`;
}

function formatCardTaxPercentForInput(pct: number): string {
  const rounded = Math.round(pct * 100) / 100;
  return rounded.toLocaleString('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function isCardChargeTaxPreset(pct: number): boolean {
  return CARD_CHARGE_TAX_PRESETS.some((p) => Math.abs(p - pct) < 0.0001);
}

const CARD_CHARGE_TAX_CUSTOM_OPTION = '__custom__';

export default function AdminMetaPage() {
  const { checking, userId } = useRequireAuth();
  const router = useTenantRouter();
  const [bancas, setBancas] = useState<Banca[]>([]);
  /** Bancas vinculadas à integração em edição (multiseleção). */
  const [selectedBancaIds, setSelectedBancaIds] = useState<string[]>([]);
  /** Banca de contexto escolhida no seletor (usada em testar conexão/revelar token/sync da integração). */
  const [selectedIntegrationContextBancaId, setSelectedIntegrationContextBancaId] = useState<string>('');
  /** Dropdown multiseleção — detalhes da integração */
  const [bancaPickerOpen, setBancaPickerOpen] = useState(false);
  const [bancaPickerSearch, setBancaPickerSearch] = useState('');
  const bancaPickerRef = useRef<HTMLDivElement | null>(null);
  const overviewFilterBancaRef = useRef<HTMLDivElement | null>(null);
  /** Descarta respostas antigas de live-aggregate quando várias requisições rodam em paralelo. */
  const liveAggregateRequestSeqRef = useRef(0);
  /** Mantém loading enquanto houver pelo menos uma chamada a live-aggregate em andamento. */
  const liveAggregateInFlightRef = useRef(0);
  const [configLoadError, setConfigLoadError] = useState<string | null>(null);
  const [config, setConfig] = useState<MetaConfig | null>(null);
  /** Só true durante fetch de config; início false evita spinner eterno sem bancas selecionadas ou antes do primeiro load. */
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    me?: any;
    adAccounts?: any[];
    error?: string;
    infoMessage?: string;
  } | null>(null);
  const [syncResult, setSyncResult] = useState<{ success: boolean; campaignsCount?: number; adsetsCount?: number; insightsCount?: number; error?: string } | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignOption[]>([]);
  const [syncedData, setSyncedData] = useState<{ campaigns: any[]; adsets: any[]; insights: any[] } | null>(null);
  const [syncedDataPage, setSyncedDataPage] = useState<{ campaigns: number; adsets: number; insights: number }>({
    campaigns: 1,
    adsets: 1,
    insights: 1,
  });
  const [loadingData, setLoadingData] = useState(false);
  const [expandedTab, setExpandedTab] = useState<'campaigns' | 'adsets' | 'insights' | null>('campaigns');
  const [overviewRows, setOverviewRows] = useState<MetaOverviewRow[]>([]);
  const [overviewKindSummary, setOverviewKindSummary] = useState<Record<'normal' | 'bolao', OverviewKindSummaryBucket>>({
    normal: { campaigns: 0, reach: 0, impressions: 0, clicks: 0, leads: 0, spend: 0, insights_rows: 0 },
    bolao: { campaigns: 0, reach: 0, impressions: 0, clicks: 0, leads: 0, spend: 0, insights_rows: 0 },
  });
  const [overviewApiTotals, setOverviewApiTotals] = useState<{
    total_reach: number;
    total_impressions: number;
    total_clicks: number;
    total_spend: number;
    total_leads: number;
    insights_rows: number;
    cost_per_action_type?: Record<string, number>;
  } | null>(null);
  const [overviewTopContributors, setOverviewTopContributors] = useState<Array<{
    banca_id: string;
    banca_name: string;
    reach: number;
    impressions: number;
    clicks: number;
    leads: number;
    spend: number;
    insights_rows: number;
    cost_per_action_type?: Record<string, number>;
  }> | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(false);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [overviewSearch, setOverviewSearch] = useState('');
  /** filtro do dropdown de bancas para os cards da visão geral */
  const [overviewFilterBancaId, setOverviewFilterBancaId] = useState<string>('');
  /** IDs das bancas selecionadas para filtrar os cards de visão geral */
  const [overviewSelectedBancaIds, setOverviewSelectedBancaIds] = useState<string[]>([]);
  const [overviewFilterBancaSearch, setOverviewFilterBancaSearch] = useState('');
  const [overviewFilterBancaOpen, setOverviewFilterBancaOpen] = useState(false);
  const [overviewPage, setOverviewPage] = useState(1);
  /** Período das métricas diárias (meta_insights_daily) na visão geral e em Dados Sincronizados. */
  const [metaInsightsPeriod, setMetaInsightsPeriod] = useState<'daily' | 'yesterday' | '7days' | '15days' | '30days' | 'custom' | 'all'>('daily');
  const [metaInsightsCustomFrom, setMetaInsightsCustomFrom] = useState('');
  const [metaInsightsCustomTo, setMetaInsightsCustomTo] = useState('');

  /** Agregação live (mesma pilha de fallbacks do sync), todas as integrações, período = filtro da UI. */
  const [liveAggregate, setLiveAggregate] = useState<{
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
      spend_bolao?: number;
      results_normal?: number;
      results_bolao?: number;
    };
    campaigns: Array<Record<string, unknown>>;
    integrations: Array<Record<string, unknown>>;
    billing?: LiveAggregateBillingShape | null;
    /**
     * Cotações usadas no backend para converter spend não-BRL em BRL nos totais.
     * Cada item segue ExchangeRateSnapshot (pair, rate, source, fetched_at, ttl_seconds).
     */
    exchange_rates?: Array<{
      pair: string;
      rate: number;
      source: string;
      fetched_at?: string;
      ttl_seconds?: number;
      error?: string;
    }>;
  } | null>(null);
  const [loadingLiveAggregate, setLoadingLiveAggregate] = useState(false);
  /** Após o 1º lote NDJSON: totais já aparecem; este estado indica quantas integrações ainda faltam. */
  const [liveAggregateStreamProgress, setLiveAggregateStreamProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);
  const [liveAggregateError, setLiveAggregateError] = useState<string | null>(null);
  /** Último pacote completo ao vivo da Meta (stream NDJSON). */
  const [liveMetricsUpdatedAt, setLiveMetricsUpdatedAt] = useState<Date | null>(null);

  // Modal: criar nova integração
  const [newIntegrationOpen, setNewIntegrationOpen] = useState(false);
  const [newIntegrationSaving, setNewIntegrationSaving] = useState(false);
  const [newIntegrationError, setNewIntegrationError] = useState<string | null>(null);
  const [newIntegrationForm, setNewIntegrationForm] = useState({
    banca_ids: [] as string[],
    base_url: 'https://graph.facebook.com/v25.0',
    access_token: '',
    ad_account_id: '',
    pixel_id: '',
    default_campaign_id: '',
  });

  // Todas as campanhas (todas as integrações)
  const [allCampaignsRows, setAllCampaignsRows] = useState<any[]>([]);
  /** Inicia true: o primeiro paint após auth não mostra R$ 0,00 antes do primeiro fetch de campaigns-all. */
  const [allCampaignsLoading, setAllCampaignsLoading] = useState(true);
  const [allCampaignsError, setAllCampaignsError] = useState<string | null>(null);
  const [allCampaignsSearch, setAllCampaignsSearch] = useState('');
  /** Opcional: quando true, inclui campanhas não ACTIVE nas somas, overview e tabelas (active_only=0 na API). */
  /**
   * Default false: o painel administrativo precisa refletir apenas campanhas ACTIVE (status ou effective_status).
   * Marque para incluir pausadas em auditorias de spend por campanha.
   */
  const [allCampaignsShowInactive, setAllCampaignsShowInactive] = useState(false);
  const [allCampaignsKindFilter, setAllCampaignsKindFilter] = useState<'all' | MetaCampaignKind>('all');
  const [allCampaignsPage, setAllCampaignsPage] = useState(1);
  const [campaignOwnerDraft, setCampaignOwnerDraft] = useState<Record<string, string>>({});
  const [campaignOwnerSavingKey, setCampaignOwnerSavingKey] = useState<string | null>(null);
  const [campaignRedirectDraft, setCampaignRedirectDraft] = useState<Record<string, string>>({});
  const [campaignRedirectSavingKey, setCampaignRedirectSavingKey] = useState<string | null>(null);
  /** Por `owner_user_id` (gestor): opções `redirect_slugs` dos projetos desse dono. */
  const [redirectSlugOptionsByOwner, setRedirectSlugOptionsByOwner] = useState<
    Record<
      string,
      Array<{
        project_id: string;
        owner_user_id: string | null;
        redirect_slug_id: string | null;
        slug: string;
        project_name: string | null;
        project_slug: string | null;
      }>
    >
  >({});
  const [campaignKindSavingKey, setCampaignKindSavingKey] = useState<string | null>(null);
  /**
   * Override manual de moeda em andamento (chave: `${banca_id}:${campaign_id}`).
   * Usado para desabilitar o select enquanto o POST /api/admin/meta/campaign-currency
   * está em curso, evitando cliques duplos com cotações conflitantes.
   */
  const [campaignCurrencySavingKey, setCampaignCurrencySavingKey] = useState<string | null>(null);
  /**
   * Ajuste imediato de moeda BRL/USD sem refazer o stream live-aggregate.
   * `AUTO` = após "limpar override", usa só `currency_account` e ignora `currency_override` stale no payload.
   */
  const [localMetaCurrencyByKey, setLocalMetaCurrencyByKey] = useState<
    Record<string, LocalMetaCurrencyChoice>
  >({});
  const [campaignConsultorDraft, setCampaignConsultorDraft] = useState<Record<string, string[]>>({});
  /** Consultores que recebem o spend no card Ads (Meu Desempenho); [] = automático pelos vínculos. */
  const [campaignAdsAttributionDraft, setCampaignAdsAttributionDraft] = useState<Record<string, string[]>>({});
  const [campaignAdsAttributionSavingKey, setCampaignAdsAttributionSavingKey] = useState<string | null>(null);
  const [campaignConsultorSavingKey, setCampaignConsultorSavingKey] = useState<string | null>(null);
  const [consultorsByBanca, setConsultorsByBanca] = useState<Record<string, Array<{ id: string; email: string; full_name: string | null }>>>({});
  /** Filtro por banca para o select «Consultor · card Ads» (nome/e-mail). */
  const [consultorAdsFilterByBanca, setConsultorAdsFilterByBanca] = useState<Record<string, string>>({});
  /** Chave da campanha com o dropdown de consultores aberto (banca_id:campaign_id). */
  const [openAdsDropdownKey, setOpenAdsDropdownKey] = useState<string | null>(null);
  /** Imposto estimado sobre cobranças no cartão (soma ao valor Meta no card e no selo de resumo). */
  const [cardChargeTaxPercent, setCardChargeTaxPercent] = useState<number>(() => {
    if (typeof window === 'undefined') return CARD_CHARGE_TAX_DEFAULT;
    try {
      return parseCardChargeTaxPct(localStorage.getItem(CARD_CHARGE_TAX_STORAGE_KEY));
    } catch {
      return CARD_CHARGE_TAX_DEFAULT;
    }
  });
  /** UI: lista de presets ou campo «Outro valor» (formato 12,15). */
  const [cardChargeTaxUiCustom, setCardChargeTaxUiCustom] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      const pct = parseCardChargeTaxPct(localStorage.getItem(CARD_CHARGE_TAX_STORAGE_KEY));
      return !isCardChargeTaxPreset(pct);
    } catch {
      return false;
    }
  });
  const [cardChargeTaxInput, setCardChargeTaxInput] = useState(() =>
    formatCardTaxPercentForInput(
      typeof window === 'undefined'
        ? CARD_CHARGE_TAX_DEFAULT
        : (() => {
            try {
              return parseCardChargeTaxPct(localStorage.getItem(CARD_CHARGE_TAX_STORAGE_KEY));
            } catch {
              return CARD_CHARGE_TAX_DEFAULT;
            }
          })()
    )
  );

  const commitCardChargeTaxInput = useCallback(() => {
    const trimmed = cardChargeTaxInput.trim();
    if (!trimmed) {
      setCardChargeTaxPercent(CARD_CHARGE_TAX_DEFAULT);
      setCardChargeTaxInput(formatCardTaxPercentForInput(CARD_CHARGE_TAX_DEFAULT));
      return;
    }
    const parsed = parseCardChargeTaxPct(trimmed);
    setCardChargeTaxPercent(parsed);
    setCardChargeTaxInput(formatCardTaxPercentForInput(parsed));
  }, [cardChargeTaxInput]);
  const [consultorModalOpen, setConsultorModalOpen] = useState(false);
  const [consultorModalCampaignKey, setConsultorModalCampaignKey] = useState<string>('');
  const [consultorModalSearch, setConsultorModalSearch] = useState('');
  const ALL_CAMPAIGNS_PAGE_SIZE = 20;
  const SYNCED_DATA_PAGE_SIZE = 5;

  const [form, setForm] = useState({
    base_url: 'https://graph.facebook.com/v25.0',
    access_token: '',
    ad_account_id: '',
    pixel_id: '',
    default_campaign_id: '',
  });
  /** Quando já existe token salvo, mostra máscara no campo até o usuário clicar em «Alterar token». */
  const [editingToken, setEditingToken] = useState(false);
  /** Após «Revelar token», mostra o valor em texto claro (não como password). */
  const [accessTokenRevealed, setAccessTokenRevealed] = useState(false);
  const [revealTokenLoading, setRevealTokenLoading] = useState(false);
  const [revealTokenError, setRevealTokenError] = useState<string | null>(null);
  /** Qual linha de `meta_integration_configs` está em edição quando a banca tem várias integrações. */
  const [adminMetaSelectedIntegrationId, setAdminMetaSelectedIntegrationId] = useState('');
  const [adminMetaCreateNewIntegration, setAdminMetaCreateNewIntegration] = useState(false);
  /** Integração da qual copiar token ao salvar «nova integração» sem access_token (prioridade no backend). */
  const [adminMetaReuseTokenFromIntegrationId, setAdminMetaReuseTokenFromIntegrationId] = useState('');
  const [metaIntegrationUiBusy, setMetaIntegrationUiBusy] = useState(false);
  /** Linha da visão geral em processo de desvínculo banca ↔ integração (`banca_id:integration_id`). */
  const [overviewUnlinkKey, setOverviewUnlinkKey] = useState<string | null>(null);
  /** Valor atual da seleção no dropdown (para loadConfig assíncrono não voltar sempre à «primary» da API). */
  const adminMetaSelectedIntegrationIdRef = useRef('');

  const loadConfig = useCallback(async (idsOverride?: string[]) => {
    const ids = (idsOverride?.length ? idsOverride : selectedBancaIds).map((x) => String(x).trim()).filter(Boolean);
    if (!ids.length || !userId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setConfigLoadError(null);
    try {
      const qs = ids.map((id) => encodeURIComponent(id)).join(',');
      const res = await fetch(`/api/admin/meta/config?banca_ids=${qs}`, {
        headers: { 'X-User-Id': userId },
      });
      const data = await res.json();
      if (!data.success) {
        setConfig(null);
        setEditingToken(false);
        setAccessTokenRevealed(false);
        setRevealTokenError(null);
        setAdminMetaSelectedIntegrationId('');
        setAdminMetaCreateNewIntegration(false);
        setAdminMetaReuseTokenFromIntegrationId('');
        setConfigLoadError(data.error || 'Erro ao carregar integração');
        setTestResult({ success: false, error: data.error || 'Erro ao carregar integração' });
        return;
      }
      if (data.data?.configured && Array.isArray(data.data.banca_ids) && data.data.banca_ids.length > 0) {
        setSelectedBancaIds((prev) => {
          const merged = Array.from(new Set([...data.data.banca_ids, ...ids]));
          const a = [...merged].sort().join('|');
          const b = [...prev].sort().join('|');
          return a === b ? prev : merged;
        });
      }
      if (data.data) {
        setEditingToken(false);
        setAccessTokenRevealed(false);
        setRevealTokenError(null);
        const d = data.data as MetaConfig;

        if (d.configured) {
          setAdminMetaCreateNewIntegration(false);
          setAdminMetaReuseTokenFromIntegrationId('');

          const validIds = new Set(
            (d.integrations || []).map((i) => String(i.integration_id))
          );
          const prevSel = adminMetaSelectedIntegrationIdRef.current.trim();
          const fallbackId = d.integration_id ? String(d.integration_id) : '';
          const nextSel = prevSel && validIds.has(prevSel) ? prevSel : fallbackId;

          const row = nextSel
            ? d.integrations?.find((i) => String(i.integration_id) === String(nextSel))
            : undefined;

          const merged: MetaConfig = row
            ? {
                ...d,
                integration_id: row.integration_id,
                base_url: row.base_url ?? d.base_url,
                token_last4: row.token_last4 ?? null,
                ad_account_id: row.ad_account_id,
                pixel_id: row.pixel_id,
                default_campaign_id: row.default_campaign_id,
                is_active: row.is_active,
                last_sync_at: row.last_sync_at,
                last_sync_error: row.last_sync_error,
                last_sync_date_preset: row.last_sync_date_preset,
              }
            : d;

          setConfig(merged);
          setAdminMetaSelectedIntegrationId(nextSel);
          setForm((f) => ({
            ...f,
            base_url:
              merged.base_url != null && String(merged.base_url).trim() !== ''
                ? String(merged.base_url)
                : f.base_url,
            ad_account_id: merged.ad_account_id != null ? String(merged.ad_account_id) : '',
            pixel_id: merged.pixel_id != null ? String(merged.pixel_id) : '',
            default_campaign_id:
              merged.default_campaign_id != null ? String(merged.default_campaign_id) : '',
            access_token: '',
          }));
        } else {
          setConfig(d);
          setAdminMetaSelectedIntegrationId('');
          setAdminMetaCreateNewIntegration(false);
          setAdminMetaReuseTokenFromIntegrationId('');
          setForm((f) => ({
            ...f,
            base_url:
              d.base_url != null && String(d.base_url).trim() !== '' ? String(d.base_url) : f.base_url,
            ad_account_id: d.ad_account_id != null ? String(d.ad_account_id) : '',
            pixel_id: d.pixel_id != null ? String(d.pixel_id) : '',
            default_campaign_id:
              d.default_campaign_id != null ? String(d.default_campaign_id) : '',
            access_token: '',
          }));
        }
      }
    } catch (err) {
      console.error(err);
      setConfig(null);
      setEditingToken(false);
      setAccessTokenRevealed(false);
      setRevealTokenError(null);
      setAdminMetaSelectedIntegrationId('');
      setAdminMetaCreateNewIntegration(false);
      setAdminMetaReuseTokenFromIntegrationId('');
      setConfigLoadError('Erro de rede ao carregar integração');
      setTestResult({ success: false, error: 'Erro de rede ao carregar integração' });
    } finally {
      setLoading(false);
    }
  }, [selectedBancaIds, userId]);

  useEffect(() => {
    adminMetaSelectedIntegrationIdRef.current = adminMetaSelectedIntegrationId;
  }, [adminMetaSelectedIntegrationId]);

  useEffect(() => {
    try {
      localStorage.setItem(CARD_CHARGE_TAX_STORAGE_KEY, String(cardChargeTaxPercent));
    } catch {
      /* ignore */
    }
  }, [cardChargeTaxPercent]);

  useEffect(() => {
    if (!userId || checking) return;
    const check = async () => {
      try {
        const res = await fetch('/api/user/profile', { headers: { 'X-User-Id': userId } });
        const data = await res.json();
        if (data.success && (data.data?.status === 'super_admin' || data.data?.status === 'admin')) {
          // OK
        } else {
          router.replace('/admin');
        }
      } catch {
        router.replace('/admin');
      }
    };
    check();
  }, [userId, checking, router]);

  useEffect(() => {
    if (!userId) return;
    const fetchBancas = async () => {
      try {
        const res = await fetch('/api/admin/crm/bancas', { headers: { 'X-User-Id': userId } });
        const data = await res.json();
        if (data.success && Array.isArray(data.data)) {
          setBancas(data.data);
        }
      } catch (err) {
        console.error(err);
      }
    };
    fetchBancas();
  }, [userId]);

  useEffect(() => {
    if (selectedBancaIds.length === 0) {
      setLoading(false);
      return;
    }
    void loadConfig();
  }, [selectedBancaIds.join(','), loadConfig]);

  const configuredBancaMeta = useMemo(() => {
    const m = new Map<string, { configured: boolean; is_active: boolean }>();
    for (const r of overviewRows) {
      const cur = m.get(r.banca_id) ?? { configured: false, is_active: false };
      m.set(r.banca_id, {
        configured: cur.configured || r.configured,
        is_active: cur.is_active || (r.configured && r.is_active),
      });
    }
    return m;
  }, [overviewRows]);

  const bancasForPicker = useMemo(() => {
    const q = bancaPickerSearch.trim().toLowerCase();
    if (!q) return bancas;
    return bancas.filter(
      (b) =>
        (b.name || '').toLowerCase().includes(q) || (b.url || '').toLowerCase().includes(q)
    );
  }, [bancas, bancaPickerSearch]);
  const bancasForMetaFilter = useMemo(() => {
    const q = overviewFilterBancaSearch.trim().toLowerCase();
    if (!q) return bancas;
    return bancas.filter(
      (b) =>
        (b.name || '').toLowerCase().includes(q) || (b.url || '').toLowerCase().includes(q)
    );
  }, [bancas, overviewFilterBancaSearch]);

  useEffect(() => {
    if (!bancaPickerOpen) return;
    const onDocDown = (e: MouseEvent) => {
      if (bancaPickerRef.current && !bancaPickerRef.current.contains(e.target as Node)) {
        setBancaPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [bancaPickerOpen]);

  useEffect(() => {
    if (!overviewFilterBancaOpen) return;
    const onDocDown = (e: MouseEvent) => {
      if (overviewFilterBancaRef.current && !overviewFilterBancaRef.current.contains(e.target as Node)) {
        setOverviewFilterBancaOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [overviewFilterBancaOpen]);

  useEffect(() => {
    if (!openAdsDropdownKey) return;
    const onDocDown = (e: MouseEvent) => {
      const target = e.target as Node;
      const dropdowns = document.querySelectorAll('[data-ads-dropdown]');
      for (const el of Array.from(dropdowns)) {
        if (el.contains(target)) return;
      }
      setOpenAdsDropdownKey(null);
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [openAdsDropdownKey]);

  const META_TIMEZONE = 'America/Sao_Paulo';

  const toMetaDateString = (d: Date) => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: META_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(d);
    const y = parts.find((p) => p.type === 'year')?.value ?? '';
    const m = parts.find((p) => p.type === 'month')?.value ?? '';
    const day = parts.find((p) => p.type === 'day')?.value ?? '';
    return `${y}-${m}-${day}`;
  };

  const adminMetaInsightsDateRange = useMemo(() => {
    const now = new Date();
    const todayStr = toMetaDateString(now);
    switch (metaInsightsPeriod) {
      case 'daily':
        return { dateFrom: todayStr, dateTo: todayStr, label: `Hoje (${todayStr})` };
      case 'yesterday': {
        const y = new Date(now);
        y.setDate(y.getDate() - 1);
        const yStr = toMetaDateString(y);
        return { dateFrom: yStr, dateTo: yStr, label: `Ontem (${yStr})` };
      }
      case '7days': {
        const s = new Date(now);
        s.setDate(s.getDate() - 6);
        return { dateFrom: toMetaDateString(s), dateTo: todayStr, label: `Últimos 7 dias (${toMetaDateString(s)} → ${todayStr})` };
      }
      case '15days': {
        const s = new Date(now);
        s.setDate(s.getDate() - 14);
        return { dateFrom: toMetaDateString(s), dateTo: todayStr, label: `Últimos 15 dias (${toMetaDateString(s)} → ${todayStr})` };
      }
      case '30days': {
        const s = new Date(now);
        s.setDate(s.getDate() - 29);
        return { dateFrom: toMetaDateString(s), dateTo: todayStr, label: `Últimos 30 dias (${toMetaDateString(s)} → ${todayStr})` };
      }
      case 'custom': {
        const df = metaInsightsCustomFrom.trim();
        const dt = metaInsightsCustomTo.trim();
        if (df && dt) {
          return { dateFrom: df, dateTo: dt, label: `Personalizado (${df} → ${dt})` };
        }
        return { dateFrom: null as string | null, dateTo: null as string | null, label: 'Personalizado (preencha início e fim)' };
      }
      case 'all':
      default:
        return { dateFrom: null as string | null, dateTo: null as string | null, label: 'Todo o período' };
    }
  }, [metaInsightsPeriod, metaInsightsCustomFrom, metaInsightsCustomTo]);

  /**
   * Bancas realmente vinculadas à integração selecionada no dropdown (cada linha de meta_integration_configs tem seu próprio conjunto).
   * O filtro da visão geral (overview) não pode forçar banca_id se essa banca não estiver vinculada à integração atual — senão test/sync/revelam erro.
   */
  const bancaIdsLinkedToSelectedIntegration = useMemo(() => {
    if (adminMetaCreateNewIntegration) {
      return selectedBancaIds;
    }
    if (!config?.configured) return [];
    const integId =
      adminMetaSelectedIntegrationId || (config.integration_id ? String(config.integration_id) : '');
    if (!integId || !config.integrations?.length) {
      return Array.isArray(config.banca_ids) ? config.banca_ids : [];
    }
    const row = config.integrations.find((i) => i.integration_id === integId);
    if (row?.banca_ids && row.banca_ids.length > 0) return row.banca_ids;
    return Array.isArray(config.banca_ids) ? config.banca_ids : [];
  }, [
    adminMetaCreateNewIntegration,
    adminMetaSelectedIntegrationId,
    config,
    selectedBancaIds,
  ]);

  /** Na «nova integração», a máscara do token reflete a integração irmã cujo token será copiado ao salvar (se o campo ficar vazio). */
  const adminMetaDisplayTokenLast4 = useMemo(() => {
    if (!adminMetaCreateNewIntegration) return config?.token_last4 ?? null;
    const src = adminMetaReuseTokenFromIntegrationId.trim();
    if (src && config?.integrations?.length) {
      const row = config.integrations.find((i) => i.integration_id === src);
      if (row?.token_last4) return row.token_last4;
    }
    return config?.token_last4 ?? null;
  }, [adminMetaCreateNewIntegration, adminMetaReuseTokenFromIntegrationId, config?.integrations, config?.token_last4]);

  const primaryBancaId = useMemo(() => {
    if (adminMetaCreateNewIntegration) {
      return (
        (overviewFilterBancaId && selectedBancaIds.includes(overviewFilterBancaId)
          ? overviewFilterBancaId
          : null) ||
        selectedBancaIds[0] ||
        ''
      );
    }
    const linked = bancaIdsLinkedToSelectedIntegration;
    if (selectedIntegrationContextBancaId && linked.includes(selectedIntegrationContextBancaId)) {
      return selectedIntegrationContextBancaId;
    }
    if (overviewFilterBancaId && linked.includes(overviewFilterBancaId)) {
      return overviewFilterBancaId;
    }
    const fromPicker = selectedBancaIds.find((id) => linked.includes(id));
    if (fromPicker) return fromPicker;
    if (linked.length > 0) return linked[0];
    return overviewFilterBancaId || selectedBancaIds[0] || '';
  }, [
    adminMetaCreateNewIntegration,
    bancaIdsLinkedToSelectedIntegration,
    selectedIntegrationContextBancaId,
    overviewFilterBancaId,
    selectedBancaIds,
  ]);

  useEffect(() => {
    if (selectedBancaIds.length === 0) {
      if (selectedIntegrationContextBancaId) setSelectedIntegrationContextBancaId('');
      return;
    }
    if (!selectedIntegrationContextBancaId || !selectedBancaIds.includes(selectedIntegrationContextBancaId)) {
      setSelectedIntegrationContextBancaId(selectedBancaIds[0]);
    }
  }, [selectedBancaIds, selectedIntegrationContextBancaId]);

  const loadSyncedData = useCallback(async () => {
    if (!primaryBancaId || !userId) return;
    setLoadingData(true);
    try {
      const params = new URLSearchParams({ banca_id: primaryBancaId });
      if (adminMetaInsightsDateRange.dateFrom) params.set('date_from', adminMetaInsightsDateRange.dateFrom);
      if (adminMetaInsightsDateRange.dateTo) params.set('date_to', adminMetaInsightsDateRange.dateTo);
      const res = await fetch(`/api/admin/meta/data?${params.toString()}`, {
        headers: { 'X-User-Id': userId },
        cache: 'no-store',
      });
      const data = await res.json();
      if (data.success && data.data) {
        setSyncedData(data.data);
        setSyncedDataPage({ campaigns: 1, adsets: 1, insights: 1 });
      } else {
        setSyncedData(null);
      }
    } catch {
      setSyncedData(null);
    } finally {
      setLoadingData(false);
    }
  }, [primaryBancaId, userId, adminMetaInsightsDateRange.dateFrom, adminMetaInsightsDateRange.dateTo]);

  const loadOverview = useCallback(async () => {
    if (!userId) return;
    setLoadingOverview(true);
    setOverviewError(null);
    try {
      const qs = new URLSearchParams();
      if (adminMetaInsightsDateRange.dateFrom) qs.set('date_from', adminMetaInsightsDateRange.dateFrom);
      if (adminMetaInsightsDateRange.dateTo) qs.set('date_to', adminMetaInsightsDateRange.dateTo);
      // Se filtro "Todas as Bancas" está ativo (nenhuma banca específica), não passa banca_id
      // Caso contrário, passa a banca selecionada
      if (overviewFilterBancaId) qs.set('banca_id', overviewFilterBancaId);
      // Alinhado ao checkbox «incluir campanhas pausadas» e à lista campaigns-all
      qs.set('active_only', allCampaignsShowInactive ? '0' : '1');
      const url = qs.toString() ? `/api/admin/meta/overview?${qs.toString()}` : '/api/admin/meta/overview';
      const res = await fetch(url, {
        headers: { 'X-User-Id': userId },
        cache: 'no-store',
      });
      const data = await res.json();
      if (data.success && Array.isArray(data.data?.rows)) {
        setOverviewRows(data.data.rows);

        // Captura totals consolidados
        if (data.data?.totals) {
          setOverviewApiTotals({
            total_reach: Number(data.data.totals.total_reach) || 0,
            total_impressions: Number(data.data.totals.total_impressions) || 0,
            total_clicks: Number(data.data.totals.total_clicks) || 0,
            total_spend: Number(data.data.totals.total_spend) || 0,
            total_leads: Number(data.data.totals.total_leads) || 0,
            insights_rows: Number(data.data.totals.insights_rows) || 0,
            cost_per_action_type: data.data.totals.cost_per_action_type || {},
          });
        } else {
          setOverviewApiTotals(null);
        }

        // Captura top contributors
        if (Array.isArray(data.data?.top_contributors)) {
          setOverviewTopContributors(data.data.top_contributors);
        } else {
          setOverviewTopContributors(null);
        }

        const ks = data.data?.kind_summary;
        if (ks?.normal && ks?.bolao) {
          setOverviewKindSummary({
            normal: {
              campaigns: Number(ks.normal.campaigns) || 0,
              reach: Number(ks.normal.reach) || 0,
              impressions: Number(ks.normal.impressions) || 0,
              clicks: Number(ks.normal.clicks) || 0,
              leads: Number(ks.normal.leads) || 0,
              spend: Number(ks.normal.spend) || 0,
              insights_rows: Number(ks.normal.insights_rows) || 0,
            },
            bolao: {
              campaigns: Number(ks.bolao.campaigns) || 0,
              reach: Number(ks.bolao.reach) || 0,
              impressions: Number(ks.bolao.impressions) || 0,
              clicks: Number(ks.bolao.clicks) || 0,
              leads: Number(ks.bolao.leads) || 0,
              spend: Number(ks.bolao.spend) || 0,
              insights_rows: Number(ks.bolao.insights_rows) || 0,
            },
          });
        } else {
          setOverviewKindSummary({
            normal: { campaigns: 0, reach: 0, impressions: 0, clicks: 0, leads: 0, spend: 0, insights_rows: 0 },
            bolao: { campaigns: 0, reach: 0, impressions: 0, clicks: 0, leads: 0, spend: 0, insights_rows: 0 },
          });
        }
      } else {
        setOverviewRows([]);
        setOverviewApiTotals(null);
        setOverviewTopContributors(null);
        setOverviewKindSummary({
          normal: { campaigns: 0, reach: 0, impressions: 0, clicks: 0, leads: 0, spend: 0, insights_rows: 0 },
          bolao: { campaigns: 0, reach: 0, impressions: 0, clicks: 0, leads: 0, spend: 0, insights_rows: 0 },
        });
        setOverviewError(data.error || 'Erro ao carregar visão geral das integrações.');
      }
    } catch (err: any) {
      setOverviewRows([]);
      setOverviewApiTotals(null);
      setOverviewTopContributors(null);
      setOverviewKindSummary({
        normal: { campaigns: 0, reach: 0, impressions: 0, clicks: 0, leads: 0, spend: 0, insights_rows: 0 },
        bolao: { campaigns: 0, reach: 0, impressions: 0, clicks: 0, leads: 0, spend: 0, insights_rows: 0 },
      });
      setOverviewError(err?.message || 'Erro ao carregar visão geral das integrações.');
    } finally {
      setLoadingOverview(false);
    }
  }, [
    userId,
    adminMetaInsightsDateRange.dateFrom,
    adminMetaInsightsDateRange.dateTo,
    overviewFilterBancaId,
    allCampaignsShowInactive,
  ]);

  /** Limite para o fluxo NDJSON inteiro (várias integrações em série). */
  const LIVE_AGGREGATE_STREAM_MS = 600_000;

  const loadLiveAggregate = useCallback(async () => {
    if (!userId) return;
    const seq = ++liveAggregateRequestSeqRef.current;
    liveAggregateInFlightRef.current += 1;
    setLoadingLiveAggregate(true);
    setLiveAggregateStreamProgress(null);
    setLiveAggregateError(null);
    // Evita exibir totais/campanhas do pedido anterior (ex.: «Todas») após mudar banca ou período.
    setLiveAggregate(null);
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), LIVE_AGGREGATE_STREAM_MS);
    try {
      const params = new URLSearchParams();
      if (adminMetaInsightsDateRange.dateFrom) params.set('date_from', adminMetaInsightsDateRange.dateFrom);
      if (adminMetaInsightsDateRange.dateTo) params.set('date_to', adminMetaInsightsDateRange.dateTo);
      if (overviewFilterBancaId) params.set('scope_banca_ids', overviewFilterBancaId);
      params.set('active_only', allCampaignsShowInactive ? '0' : '1');
      const res = await fetch(`/api/admin/meta/live-aggregate-stream?${params.toString()}`, {
        headers: { 'X-User-Id': userId },
        cache: 'no-store',
        signal: controller.signal,
      });
      if (seq !== liveAggregateRequestSeqRef.current) return;
      if (!res.ok || !res.body) {
        setLiveAggregate(null);
        setLiveAggregateError(`HTTP ${res.status} ao carregar métricas na Meta.`);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let sawComplete = false;
      const processLine = (trimmed: string) => {
        if (!trimmed) return;
        let evt: Record<string, unknown>;
        try {
          evt = JSON.parse(trimmed) as Record<string, unknown>;
        } catch {
          return;
        }
        if (seq !== liveAggregateRequestSeqRef.current) return;
        if (evt.type === 'batch') {
          const totals = evt.totals as LiveAggregateTotalsShape;
          const deltaCamp = (evt.campaigns_delta as Array<Record<string, unknown>>) ?? [];
          const deltaInt = (evt.integrations_delta as Array<Record<string, unknown>>) ?? [];
          const batchIndex = Number(evt.batchIndex) || 0;
          const totalBatches = Number(evt.totalBatches) || 1;
          const evtRates = Array.isArray((evt as { exchange_rates?: unknown }).exchange_rates)
            ? ((evt as { exchange_rates?: unknown }).exchange_rates as Array<Record<string, unknown>>)
            : null;
          setLiveAggregate((prev) => ({
            date_from: adminMetaInsightsDateRange.dateFrom ?? null,
            date_to: adminMetaInsightsDateRange.dateTo ?? null,
            totals,
            billing: (evt.billing as LiveAggregateBillingShape | null) ?? prev?.billing ?? null,
            campaigns: [...(prev?.campaigns ?? []), ...deltaCamp],
            integrations: [...(prev?.integrations ?? []), ...deltaInt],
            exchange_rates:
              (evtRates as Array<{ pair: string; rate: number; source: string }> | null) ??
              prev?.exchange_rates,
          }));
          setLiveAggregateStreamProgress({ current: batchIndex + 1, total: totalBatches });
          setLoadingLiveAggregate(false);
        } else if (evt.type === 'complete') {
          sawComplete = true;
          const completeRates = Array.isArray((evt as { exchange_rates?: unknown }).exchange_rates)
            ? ((evt as { exchange_rates?: unknown }).exchange_rates as Array<{
                pair: string;
                rate: number;
                source: string;
              }>)
            : undefined;
          setLiveAggregate({
            date_from: (evt.date_from as string | null) ?? null,
            date_to: (evt.date_to as string | null) ?? null,
            totals: evt.totals as LiveAggregateTotalsShape,
            billing: (evt.billing as LiveAggregateBillingShape | null) ?? null,
            campaigns: (evt.campaigns as Array<Record<string, unknown>>) ?? [],
            integrations: (evt.integrations as Array<Record<string, unknown>>) ?? [],
            exchange_rates: completeRates,
          });
          setLiveAggregateStreamProgress(null);
          setLoadingLiveAggregate(false);
          setLiveMetricsUpdatedAt(new Date());
        } else if (evt.type === 'error') {
          const msg = typeof evt.error === 'string' ? evt.error : 'Erro no stream Meta.';
          setLiveAggregateError((prev) => (prev ? `${prev} · ${msg}` : msg));
        }
      };
      while (true) {
        const { done, value } = await reader.read();
        if (seq !== liveAggregateRequestSeqRef.current) {
          await reader.cancel().catch(() => {});
          return;
        }
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          processLine(line.trim());
        }
      }
      if (buffer.trim()) {
        processLine(buffer.trim());
      }
      if (seq !== liveAggregateRequestSeqRef.current) return;
      if (!sawComplete) {
        setLiveAggregateError((prev) => prev || 'Resposta vinda da Meta incompleta.');
      }
    } catch (err: unknown) {
      if (seq !== liveAggregateRequestSeqRef.current) return;
      const aborted = err instanceof Error && err.name === 'AbortError';
      if (aborted) {
        setLiveAggregateError(
          (prev) =>
            prev ||
            `Tempo esgotado (${Math.round(LIVE_AGGREGATE_STREAM_MS / 1000)}s) ao buscar métricas na Meta. Os dados parciais permanecem na tela.`
        );
      } else if (err instanceof Error) {
        setLiveAggregateError((prev) => prev || err.message);
      } else {
        setLiveAggregateError((prev) => prev || 'Erro ao carregar métricas em tempo real.');
      }
    } finally {
      window.clearTimeout(timeoutId);
      liveAggregateInFlightRef.current = Math.max(0, liveAggregateInFlightRef.current - 1);
      if (liveAggregateInFlightRef.current === 0) {
        setLoadingLiveAggregate(false);
        setLiveAggregateStreamProgress(null);
      }
    }
  }, [
    userId,
    adminMetaInsightsDateRange.dateFrom,
    adminMetaInsightsDateRange.dateTo,
    overviewFilterBancaId,
    allCampaignsShowInactive,
  ]);

  useEffect(() => {
    if (primaryBancaId) loadSyncedData();
    else setSyncedData(null);
  }, [primaryBancaId, loadSyncedData]);

  useEffect(() => {
    if (!userId) return;
    void loadOverview();
    void loadLiveAggregate();
  }, [userId, loadOverview, loadLiveAggregate]);

  /**
   * Sem polling automático: métricas ao vivo só são consultadas no carregamento da página
   * ou quando o admin trocar período/banca. O usuário pode forçar uma nova chamada
   * pelo botão «Atualizar agora» do painel.
   */

  // Remove da seleção IDs que deixaram de existir na visão geral (ex.: após refresh da lista)
  useEffect(() => {
    if (!overviewRows.length) return;
    setOverviewSelectedBancaIds((prev) => prev.filter((id) => overviewRows.some((r) => r.banca_id === id)));
    if (overviewFilterBancaId && !overviewRows.some((r) => r.banca_id === overviewFilterBancaId)) {
      setOverviewFilterBancaId('');
    }
  }, [overviewRows, overviewFilterBancaId]);

  // Garante que a seleção dos cards siga o dropdown (0 ou 1 banca)
  useEffect(() => {
    setOverviewSelectedBancaIds(overviewFilterBancaId ? [overviewFilterBancaId] : []);
    setOverviewPage(1);
  }, [overviewFilterBancaId]);

  const handleSave = async () => {
    if (!userId || selectedBancaIds.length === 0) return;
    const ids = selectedBancaIds.map((x) => String(x).trim()).filter(Boolean);
    let contextBancaId = ids[0];
    if (!adminMetaCreateNewIntegration && config?.configured) {
      const integId =
        adminMetaSelectedIntegrationId || (config.integration_id ? String(config.integration_id) : '');
      const row = integId ? config.integrations?.find((i) => i.integration_id === integId) : null;
      const linked =
        row?.banca_ids && row.banca_ids.length > 0
          ? row.banca_ids
          : Array.isArray(config.banca_ids)
            ? config.banca_ids
            : [];
      contextBancaId = ids.find((id) => linked.includes(id)) ?? linked[0] ?? ids[0];
    }
    if (!contextBancaId) return;
    setSaving(true);
    setTestResult(null);
    setSyncResult(null);
    try {
      const res = await fetch('/api/admin/meta/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
        body: JSON.stringify({
          banca_id: contextBancaId,
          banca_ids: ids,
          base_url: form.base_url,
          access_token: form.access_token || undefined,
          ad_account_id: form.ad_account_id,
          pixel_id: form.pixel_id,
          default_campaign_id: form.default_campaign_id || null,
          is_active: true,
          ...(adminMetaCreateNewIntegration
            ? {
                create_new_integration: true,
                ...(!form.access_token?.trim() && adminMetaReuseTokenFromIntegrationId.trim()
                  ? { reuse_token_from_integration_id: adminMetaReuseTokenFromIntegrationId.trim() }
                  : {}),
              }
            : {
                integration_id:
                  adminMetaSelectedIntegrationId ||
                  (config?.integration_id ? String(config.integration_id) : undefined),
              }),
        }),
      });
      const data = await res.json();
      if (data.success) {
        await loadConfig(ids);
        await loadOverview();
      } else {
        setTestResult({ success: false, error: data.error || 'Erro ao salvar' });
      }
    } catch (err: any) {
      setTestResult({ success: false, error: err?.message || 'Erro ao salvar' });
    } finally {
      setSaving(false);
    }
  };

  /** Atualiza só meta_integration_bancas (não reenvia token nem demais campos). */
  const handleApplyIntegrationBancaLinks = async () => {
    if (!userId || adminMetaCreateNewIntegration || !config?.configured) return;
    const integ =
      adminMetaSelectedIntegrationId || (config.integration_id ? String(config.integration_id) : '');
    if (!integ) return;
    const ids = selectedBancaIds.map((x) => String(x).trim()).filter(Boolean);
    if (ids.length === 0) {
      setTestResult({ success: false, error: 'Marque ao menos uma banca nos vínculos.' });
      return;
    }
    setMetaIntegrationUiBusy(true);
    setTestResult(null);
    setSyncResult(null);
    try {
      const res = await fetch('/api/admin/meta/integration', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
        body: JSON.stringify({
          integration_id: integ,
          banca_ids: ids,
          move_bancas_from_other_integrations: true,
        }),
      });
      const data = await res.json();
      if (data.success) {
        await loadConfig(ids);
        await loadOverview();
        setTestResult({
          success: true,
          infoMessage: 'Vínculos da integração com as bancas foram atualizados (com migração entre integrações).',
        });
      } else {
        setTestResult({ success: false, error: data.error || 'Erro ao atualizar vínculos.' });
      }
    } catch (err: any) {
      setTestResult({ success: false, error: err?.message || 'Erro ao atualizar vínculos.' });
    } finally {
      setMetaIntegrationUiBusy(false);
    }
  };

  /** Remove uma banca da integração atual via API; exige ao menos 2 bancas selecionadas (mantém as demais). */
  const handleQuickUnlinkBancaFromIntegration = async (bancaId: string) => {
    if (!userId || adminMetaCreateNewIntegration || !config?.configured) return;
    const integ =
      adminMetaSelectedIntegrationId || (config.integration_id ? String(config.integration_id) : '');
    if (!integ) return;
    const linked = Array.from(
      new Set(selectedBancaIds.map((x) => String(x).trim()).filter(Boolean))
    );
    if (!linked.includes(bancaId) || linked.length <= 1) return;

    const bancaLabel = (() => {
      const banca = bancas.find((b) => String(b.id) === String(bancaId));
      return banca?.name || banca?.url || bancaId;
    })();
    const ok = window.confirm(
      `Remover a banca "${bancaLabel}" desta integração?\n\nAs outras bancas vinculadas serão mantidas.`
    );
    if (!ok) return;

    const remaining = linked.filter((id) => id !== bancaId);
    setMetaIntegrationUiBusy(true);
    setTestResult(null);
    setSyncResult(null);
    try {
      const res = await fetch('/api/admin/meta/integration', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
        body: JSON.stringify({ integration_id: integ, banca_ids: remaining }),
      });
      const data = await res.json();
      if (!data.success) {
        setTestResult({ success: false, error: data.error || 'Erro ao remover vínculo da banca.' });
        return;
      }
      setSelectedBancaIds(remaining);
      setSelectedIntegrationContextBancaId((prev) =>
        prev === bancaId ? remaining[0] || '' : prev
      );
      await loadOverview();
      await loadConfig(remaining);
      void loadLiveAggregate();
      void loadAllCampaigns();
      setTestResult({
        success: true,
        infoMessage: `Banca "${bancaLabel}" removida desta integração. As demais permanecem vinculadas.`,
      });
    } catch (err: any) {
      setTestResult({ success: false, error: err?.message || 'Erro ao remover vínculo da banca.' });
    } finally {
      setMetaIntegrationUiBusy(false);
    }
  };

  /** Visão geral: desvincular esta linha (banca + integração) sem precisar do seletor de configuração. */
  const handleOverviewUnlinkBancaRow = async (row: MetaOverviewRow) => {
    if (!userId || !row.integration_id || !row.configured) return;
    const rowKey = `${row.banca_id}:${row.integration_id}`;
    const label = row.banca_name || row.banca_url || row.banca_id;
    const onlyBancaOnIntegration = row.integrations_count <= 1;
    const ok = window.confirm(
      onlyBancaOnIntegration
        ? `Remover a banca «${label}» desta integração?\n\nÉ a única banca vinculada: a integração Meta será excluída por completo.`
        : `Remover a banca «${label}» desta integração (conta ${row.integration_index}/${row.integrations_count})?\n\nAs outras bancas permanecem vinculadas à mesma integração.`
    );
    if (!ok) return;

    const remainingSelected = selectedBancaIds
      .map((x) => String(x).trim())
      .filter((id) => id !== String(row.banca_id).trim());

    setOverviewUnlinkKey(rowKey);
    setTestResult(null);
    try {
      const res = await fetch('/api/admin/meta/integration', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
        body: JSON.stringify({
          integration_id: row.integration_id,
          remove_banca_id: row.banca_id,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        setTestResult({ success: false, error: data.error || 'Erro ao desvincular banca.' });
        return;
      }

      setSelectedBancaIds(remainingSelected);
      setSelectedIntegrationContextBancaId((prev) =>
        String(prev) === String(row.banca_id) ? remainingSelected[0] || '' : prev
      );

      await loadOverview();
      if (remainingSelected.length > 0) {
        await loadConfig(remainingSelected);
      } else {
        setConfig(null);
        setAdminMetaSelectedIntegrationId('');
        setAdminMetaCreateNewIntegration(false);
        setAdminMetaReuseTokenFromIntegrationId('');
        setSyncedData(null);
      }
      void loadLiveAggregate();
      void loadAllCampaigns();

      setTestResult({
        success: true,
        infoMessage:
          data.data?.removed_integration === true
            ? `Integração Meta da banca «${label}» foi removida. A visão geral foi atualizada.`
            : `Banca «${label}» desvinculada. A visão geral foi atualizada.`,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setTestResult({ success: false, error: msg || 'Erro ao desvincular.' });
    } finally {
      setOverviewUnlinkKey(null);
    }
  };

  const handleRemoveMetaIntegration = async () => {
    if (!userId || adminMetaCreateNewIntegration || !config?.configured) return;
    const integ =
      adminMetaSelectedIntegrationId || (config.integration_id ? String(config.integration_id) : '');
    if (!integ) return;
    const selectedRow = config.integrations?.find((i) => String(i.integration_id) === String(integ));
    const linkedBancaIds = Array.from(
      new Set(
        (
          selectedRow?.banca_ids && selectedRow.banca_ids.length > 0
            ? selectedRow.banca_ids
            : Array.isArray(config.banca_ids)
              ? config.banca_ids
              : selectedBancaIds
        )
          .map((id) => String(id).trim())
          .filter(Boolean)
      )
    );
    if (linkedBancaIds.length === 0) {
      setTestResult({ success: false, error: 'Nenhuma banca vinculada a esta integração.' });
      return;
    }

    const normalize = (v: string) =>
      String(v ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();

    const preferredBancaToRemove =
      linkedBancaIds.find((id) => id === primaryBancaId) ||
      linkedBancaIds.find((id) => id === overviewFilterBancaId) ||
      linkedBancaIds[0];

    let bancaToRemove = preferredBancaToRemove;
    if (linkedBancaIds.length > 1) {
      const menu = linkedBancaIds
        .map((id, idx) => {
          const banca = bancas.find((b) => String(b.id) === id);
          const label = banca?.name || banca?.url || id;
          return `${idx + 1}) ${label}`;
        })
        .join('\n');
      const raw = window.prompt(
        `Qual banca deseja remover desta integração?\n\n${menu}\n\nDigite o número ou o ID da banca:`
      );
      if (raw == null) return;
      const input = raw.trim();
      if (!input) return;
      const idx = Number.parseInt(input, 10);
      if (!Number.isNaN(idx) && idx >= 1 && idx <= linkedBancaIds.length) {
        bancaToRemove = linkedBancaIds[idx - 1];
      } else if (linkedBancaIds.includes(input)) {
        bancaToRemove = input;
      } else {
        const normalizedInput = normalize(input);
        const matchedByLabel = linkedBancaIds.find((id) => {
          const banca = bancas.find((b) => String(b.id) === id);
          const name = normalize(banca?.name || '');
          const url = normalize(banca?.url || '');
          return (
            (name && (name === normalizedInput || name.includes(normalizedInput))) ||
            (url && (url === normalizedInput || url.includes(normalizedInput)))
          );
        });
        if (matchedByLabel) {
          bancaToRemove = matchedByLabel;
        } else {
          setTestResult({
            success: false,
            error: 'Banca inválida. Informe número, ID, nome ou URL da banca vinculada.',
          });
          return;
        }
      }
    }

    const bancaLabel = (() => {
      const banca = bancas.find((b) => String(b.id) === String(bancaToRemove));
      return banca?.name || banca?.url || bancaToRemove;
    })();
    const removingEntireIntegration = linkedBancaIds.length === 1;
    const ok = window.confirm(
      removingEntireIntegration
        ? `Esta integração está vinculada apenas à banca "${bancaLabel}".\n\nConfirma remover a integração inteira?`
        : `Confirma remover a banca "${bancaLabel}" desta integração?\n\nAs outras bancas vinculadas serão mantidas.`
    );
    if (!ok) return;

    setMetaIntegrationUiBusy(true);
    setTestResult(null);
    setSyncResult(null);
    try {
      if (removingEntireIntegration) {
        const res = await fetch('/api/admin/meta/integration', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
          body: JSON.stringify({ integration_id: integ }),
        });
        const data = await res.json();
        if (!data.success) {
          setTestResult({ success: false, error: data.error || 'Erro ao remover integração.' });
          return;
        }
      } else {
        const remainingBancas = linkedBancaIds.filter((id) => id !== bancaToRemove);
        const res = await fetch('/api/admin/meta/integration', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
          body: JSON.stringify({ integration_id: integ, banca_ids: remainingBancas }),
        });
        const data = await res.json();
        if (!data.success) {
          setTestResult({ success: false, error: data.error || 'Erro ao remover vínculo da banca.' });
          return;
        }
      }
      const anchor = selectedBancaIds[0] || primaryBancaId || overviewFilterBancaId || '';
      await loadOverview();
      if (anchor) {
        await loadConfig([anchor]);
      } else {
        setConfig(null);
        setAdminMetaSelectedIntegrationId('');
        setAdminMetaReuseTokenFromIntegrationId('');
        setSelectedBancaIds([]);
      }
      void loadLiveAggregate();
      void loadAllCampaigns();
      setTestResult({
        success: true,
        infoMessage: removingEntireIntegration
          ? 'Integração removida.'
          : `Banca "${bancaLabel}" removida da integração. As demais bancas vinculadas foram mantidas.`,
      });
    } catch (err: any) {
      setTestResult({ success: false, error: err?.message || 'Erro ao remover integração.' });
    } finally {
      setMetaIntegrationUiBusy(false);
    }
  };

  const handleTestConnection = async () => {
    if (!userId || !primaryBancaId) return;
    setTesting(true);
    setTestResult(null);
    try {
      const integ =
        !adminMetaCreateNewIntegration &&
        (adminMetaSelectedIntegrationId || (config?.integration_id ? String(config.integration_id) : ''));
      const res = await fetch('/api/admin/meta/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
        body: JSON.stringify({
          banca_id: primaryBancaId,
          ...(integ ? { integration_id: integ } : {}),
        }),
      });
      const data = await res.json();
      if (data.success && data.data) {
        setTestResult(data.data);
      } else {
        setTestResult({ success: false, error: data.error || 'Erro ao testar' });
      }
    } catch (err: any) {
      setTestResult({ success: false, error: err?.message || 'Erro ao testar' });
    } finally {
      setTesting(false);
    }
  };

  const handleRevealAccessToken = async () => {
    if (!userId || !primaryBancaId) return;
    setRevealTokenLoading(true);
    setRevealTokenError(null);
    try {
      const integ = adminMetaCreateNewIntegration
        ? adminMetaReuseTokenFromIntegrationId.trim() ||
          (config?.integration_id ? String(config.integration_id) : '')
        : adminMetaSelectedIntegrationId || (config?.integration_id ? String(config.integration_id) : '');
      const res = await fetch('/api/admin/meta/reveal-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
        body: JSON.stringify({
          banca_id: primaryBancaId,
          ...(integ ? { integration_id: integ } : {}),
        }),
      });
      const data = await res.json();
      if (data.success && typeof data.data?.access_token === 'string') {
        setEditingToken(true);
        setAccessTokenRevealed(true);
        setForm((f) => ({ ...f, access_token: data.data.access_token }));
      } else {
        setRevealTokenError(data.error || 'Não foi possível revelar o token.');
      }
    } catch (err: any) {
      setRevealTokenError(err?.message || 'Erro ao revelar o token.');
    } finally {
      setRevealTokenLoading(false);
    }
  };

  const handleLoadCampaigns = async () => {
    if (!userId || !primaryBancaId) return;
    setLoadingCampaigns(true);
    setCampaigns([]);
    try {
      const integ =
        !adminMetaCreateNewIntegration &&
        (adminMetaSelectedIntegrationId || (config?.integration_id ? String(config.integration_id) : ''));
      const q = new URLSearchParams({ banca_id: primaryBancaId });
      if (integ) q.set('integration_id', integ);
      const res = await fetch(`/api/admin/meta/campaigns?${q.toString()}`, {
        headers: { 'X-User-Id': userId },
      });
      const data = await res.json();
      if (data.success && data.data?.campaigns) {
        setCampaigns(data.data.campaigns);
        if (data.data.error) {
          setTestResult({ success: false, error: data.data.error });
        }
      } else if (data.data?.error) {
        setTestResult({ success: false, error: data.data.error });
      }
    } catch (err: any) {
      setTestResult({ success: false, error: err?.message });
    } finally {
      setLoadingCampaigns(false);
    }
  };

  const handleSync = async () => {
    if (!userId || !primaryBancaId) return;
    setSyncing(true);
    try {
      const res = await fetch('/api/admin/meta/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
        body: JSON.stringify({ banca_id: primaryBancaId, date_preset: 'last_30d' }),
      });
      const data = await res.json();
      if (data.success && data.data) {
        setSyncResult(data.data);
        // Libera o botão imediatamente após concluir o endpoint de sync.
        // Os refreshes de tela rodam em sequência sem manter o botão travado.
        setSyncing(false);
        setAllCampaignsPage(1);
        void Promise.allSettled([
          loadConfig(selectedBancaIds),
          loadSyncedData(),
          loadOverview(),
          loadAllCampaigns(),
          loadLiveAggregate(),
        ]);
      } else {
        setSyncResult({ success: false, error: data.error || 'Erro ao sincronizar' });
      }
    } catch (err: any) {
      setSyncResult({ success: false, error: err?.message || 'Erro ao sincronizar' });
    } finally {
      setSyncing(false);
    }
  };

  const loadAllCampaigns = useCallback(async () => {
    if (!userId) return;
    setAllCampaignsLoading(true);
    setAllCampaignsError(null);
    try {
      const offset = (allCampaignsPage - 1) * ALL_CAMPAIGNS_PAGE_SIZE;
      const params = new URLSearchParams({
        limit: String(ALL_CAMPAIGNS_PAGE_SIZE),
        offset: String(offset),
      });
      if (allCampaignsSearch.trim()) params.set('search', allCampaignsSearch.trim());
      params.set('active_only', allCampaignsShowInactive ? '0' : '1');
      if (overviewFilterBancaId) params.set('banca_id', overviewFilterBancaId);
      if (allCampaignsKindFilter !== 'all') params.set('campaign_kind', allCampaignsKindFilter);
      if (adminMetaInsightsDateRange.dateFrom) params.set('date_from', adminMetaInsightsDateRange.dateFrom);
      if (adminMetaInsightsDateRange.dateTo) params.set('date_to', adminMetaInsightsDateRange.dateTo);
      const res = await fetch(`/api/admin/meta/campaigns-all?${params.toString()}`, {
        headers: { 'X-User-Id': userId },
        cache: 'no-store',
      });
      if (!res.ok && offset > 0) {
        // Em alguns cenários a API pode falhar em página alta após mudança de filtro.
        // Recuamos para a primeira página para manter a tela funcional.
        setAllCampaignsPage(1);
      }
      const data = await res.json();
      if (data.success && data.data?.rows) {
        setAllCampaignsRows(data.data.rows);
        const nextDraft: Record<string, string[]> = {};
        const nextRedirectDraft: Record<string, string> = {};
        const nextAdsAttrDraft: Record<string, string[]> = {};
        for (const row of data.data.rows as any[]) {
          const key = `${String(row.banca_id)}:${String(row.campaign_id)}`;
          nextDraft[key] = Array.isArray(row.assigned_consultors)
            ? row.assigned_consultors.map((c: any) => String(c.id)).filter(Boolean)
            : [];
          nextRedirectDraft[key] = row.redirect_project_id ? String(row.redirect_project_id) : '';
          const fromArr = Array.isArray(row.ads_attribution_consultor_ids)
            ? row.ads_attribution_consultor_ids.map((x: unknown) => String(x ?? '').trim()).filter(Boolean)
            : [];
          nextAdsAttrDraft[key] =
            fromArr.length > 0
              ? Array.from(new Set(fromArr))
              : row.ads_attribution_consultor_id
                ? [String(row.ads_attribution_consultor_id)]
                : [];
        }
        setCampaignConsultorDraft(nextDraft);
        setCampaignRedirectDraft(nextRedirectDraft);
        setCampaignAdsAttributionDraft(nextAdsAttrDraft);
      } else {
        setAllCampaignsRows([]);
        setAllCampaignsError(data.error || 'Erro ao carregar campanhas (todas as integrações).');
      }
    } catch (err: any) {
      setAllCampaignsRows([]);
      setAllCampaignsError(err?.message || 'Erro ao carregar campanhas (todas as integrações).');
    } finally {
      setAllCampaignsLoading(false);
    }
  }, [
    userId,
    allCampaignsPage,
    allCampaignsSearch,
    allCampaignsShowInactive,
    overviewFilterBancaId,
    allCampaignsKindFilter,
    adminMetaInsightsDateRange.dateFrom,
    adminMetaInsightsDateRange.dateTo,
  ]);

  const handleSaveCampaignKind = useCallback(
    async (
      bancaId: string,
      campaignId: string,
      campaign_kind: MetaCampaignKind,
      campaignName?: string | null
    ) => {
      if (!userId) return;
      const key = `${bancaId}:${campaignId}`;
      setCampaignKindSavingKey(key);
      setAllCampaignsError(null);
      try {
        const res = await fetch('/api/admin/meta/campaign-kind', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
          body: JSON.stringify({
            banca_id: bancaId,
            campaign_id: campaignId,
            campaign_kind,
            ...(campaignName != null && String(campaignName).trim() !== ''
              ? { name: String(campaignName).trim() }
              : {}),
          }),
        });
        const data = await res.json();
        if (!data.success) {
          setAllCampaignsError(data.error || 'Erro ao salvar tipo de campanha.');
          return;
        }
        await loadAllCampaigns();
        await loadOverview();
        /** Tabela "Métricas" usa `liveAggregate`; sem este reload o tipo/moeda parecem "voltar". */
        await loadLiveAggregate();
        if (primaryBancaId === bancaId) {
          await loadSyncedData();
          fetch(`/api/admin/meta/campaigns?banca_id=${encodeURIComponent(bancaId)}`, {
            headers: { 'X-User-Id': userId },
          })
            .then((r) => r.json())
            .then((d) => {
              if (d.success && d.data?.campaigns) setCampaigns(d.data.campaigns);
            })
            .catch(() => {});
        }
      } catch (err: any) {
        setAllCampaignsError(err?.message || 'Erro ao salvar tipo de campanha.');
      } finally {
        setCampaignKindSavingKey(null);
      }
    },
    [userId, loadAllCampaigns, loadOverview, loadLiveAggregate, loadSyncedData, primaryBancaId]
  );

  const handleSaveCampaignAdsAttribution = useCallback(
    async (
      bancaId: string,
      campaignId: string,
      adsAttributionConsultorIds: string[],
      campaignName?: string | null
    ) => {
      if (!userId) return;
      const key = `${bancaId}:${campaignId}`;
      setCampaignAdsAttributionSavingKey(key);
      setAllCampaignsError(null);
      try {
        const res = await fetch('/api/admin/meta/campaign-ads-attribution', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
          body: JSON.stringify({
            banca_id: bancaId,
            campaign_id: campaignId,
            ads_attribution_consultor_ids: adsAttributionConsultorIds,
            ...(campaignName != null && String(campaignName).trim() !== ''
              ? { name: String(campaignName).trim() }
              : {}),
          }),
        });
        const data = await res.json();
        if (!data.success) {
          setAllCampaignsError(data.error || 'Erro ao salvar consultor do card Ads.');
          await loadAllCampaigns();
          return;
        }
        await loadAllCampaigns();
      } catch (err: any) {
        setAllCampaignsError(err?.message || 'Erro ao salvar consultor do card Ads.');
        await loadAllCampaigns();
      } finally {
        setCampaignAdsAttributionSavingKey(null);
      }
    },
    [userId, loadAllCampaigns]
  );

  /**
   * Persiste `currency_override` no CRM. Não dispara novo stream live-aggregate — a linha é atualizada
   * via `localMetaCurrencyByKey` + recálculo local de `spend_brl` com a cotação já carregada.
   */
  const handleSaveCampaignCurrency = useCallback(
    async (
      bancaId: string,
      campaignId: string,
      currency: 'BRL' | 'USD' | null,
      campaignName?: string | null,
      rowStableKey?: string
    ) => {
      if (!userId) return;
      const savingKey = rowStableKey ?? `${bancaId}:${campaignId}`;
      setCampaignCurrencySavingKey(savingKey);
      setAllCampaignsError(null);
      try {
        const res = await fetch('/api/admin/meta/campaign-currency', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
          body: JSON.stringify({
            banca_id: bancaId,
            campaign_id: campaignId,
            currency,
            ...(campaignName != null && String(campaignName).trim() !== ''
              ? { name: String(campaignName).trim() }
              : {}),
          }),
        });
        const data = await res.json();
        if (!data.success) {
          setLocalMetaCurrencyByKey((prev) => {
            const next = { ...prev };
            delete next[savingKey];
            return next;
          });
          setAllCampaignsError(data.error || 'Erro ao salvar moeda da campanha.');
          return;
        }
      } catch (err: any) {
        setLocalMetaCurrencyByKey((prev) => {
          const next = { ...prev };
          delete next[savingKey];
          return next;
        });
        setAllCampaignsError(err?.message || 'Erro ao salvar moeda da campanha.');
      } finally {
        setCampaignCurrencySavingKey(null);
      }
    },
    [userId]
  );

  const handleAssignCampaignOwner = useCallback(async (row: any) => {
    if (!userId) return;
    const key = `${row.banca_id}:${row.campaign_id}`;
    const targetBancaId = (campaignOwnerDraft[key] || '').trim();
    if (!targetBancaId || targetBancaId === String(row.banca_id)) return;

    setCampaignOwnerSavingKey(key);
    setAllCampaignsError(null);
    try {
      const res = await fetch('/api/admin/meta/campaign-owner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
        body: JSON.stringify({
          banca_id: row.banca_id,
          source_banca_id: row.banca_id,
          target_banca_id: targetBancaId,
          campaign_id: row.campaign_id,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        setAllCampaignsError(data.error || 'Erro ao vincular campanha à banca.');
        return;
      }
      await loadAllCampaigns();
      await loadOverview();
      if (selectedBancaIds.includes(String(row.banca_id)) || selectedBancaIds.includes(targetBancaId)) {
        await loadSyncedData();
      }
    } catch (err: any) {
      setAllCampaignsError(err?.message || 'Erro ao vincular campanha à banca.');
    } finally {
      setCampaignOwnerSavingKey(null);
    }
  }, [userId, campaignOwnerDraft, loadAllCampaigns, loadOverview, selectedBancaIds, loadSyncedData]);

  const handleSaveCampaignRedirect = useCallback(async (row: any) => {
    if (!userId) return;
    const key = `${String(row.banca_id)}:${String(row.campaign_id)}`;
    const redirectProjectId = (campaignRedirectDraft[key] || '').trim() || null;

    setCampaignRedirectSavingKey(key);
    setAllCampaignsError(null);
    try {
      const res = await fetch('/api/admin/meta/campaign-redirect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
        body: JSON.stringify({
          banca_id: String(row.banca_id),
          campaign_id: String(row.campaign_id),
          redirect_project_id: redirectProjectId,
          ...(row.name != null && String(row.name).trim() !== ''
            ? { name: String(row.name).trim() }
            : {}),
        }),
      });
      const data = await res.json();
      if (!data.success) {
        setAllCampaignsError(data.error || 'Erro ao vincular campanha ao redirect.');
        return;
      }
      await loadAllCampaigns();
      await loadLiveAggregate();
    } catch (err: any) {
      setAllCampaignsError(err?.message || 'Erro ao vincular campanha ao redirect.');
    } finally {
      setCampaignRedirectSavingKey(null);
    }
  }, [userId, campaignRedirectDraft, loadAllCampaigns, loadLiveAggregate]);

  const handleSaveCampaignConsultors = useCallback(async (row: any) => {
    if (!userId) return;
    const key = `${String(row.banca_id)}:${String(row.campaign_id)}`;
    const consultorIds = campaignConsultorDraft[key] || [];
    setCampaignConsultorSavingKey(key);
    setAllCampaignsError(null);
    try {
      const res = await fetch('/api/admin/meta/campaign-consultors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
        body: JSON.stringify({
          banca_id: row.banca_id,
          campaign_id: row.campaign_id,
          consultor_ids: consultorIds,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        setAllCampaignsError(data.error || 'Erro ao salvar consultores da campanha.');
        return false;
      }
      await loadAllCampaigns();
      return true;
    } catch (err: any) {
      setAllCampaignsError(err?.message || 'Erro ao salvar consultores da campanha.');
      return false;
    } finally {
      setCampaignConsultorSavingKey(null);
    }
  }, [userId, campaignConsultorDraft, loadAllCampaigns]);

  useEffect(() => {
    if (!userId) return;
    void loadAllCampaigns();
  }, [userId, loadAllCampaigns]);

  useEffect(() => {
    if (!userId) return;
    const bancaIds = Array.from(new Set((allCampaignsRows || []).map((row: any) => String(row.banca_id)).filter(Boolean)));
    if (!bancaIds.length) return;
    void (async () => {
      const entries = await Promise.all(
        bancaIds.map(async (bancaId) => {
          try {
            const res = await fetch(`/api/admin/meta/campaign-consultors?banca_id=${encodeURIComponent(bancaId)}`, {
              headers: { 'X-User-Id': userId },
            });
            const data = await res.json();
            if (!data.success) return [bancaId, []] as const;
            return [bancaId, data.data?.consultors || []] as const;
          } catch {
            return [bancaId, []] as const;
          }
        })
      );
      setConsultorsByBanca((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
    })();
  }, [userId, allCampaignsRows]);

  // Complementary fetch: loads consultors for live-stream banca_ids not already covered by the allCampaignsRows page.
  // allCampaignsRows is paginated, so the live stream may show campaigns from bancas not on the current DB page.
  // Uses stable string keys so the effect only re-runs when the banca_id sets actually change.
  const liveCampaignBancaKey = (liveAggregate?.campaigns ?? [])
    .map((r: any) => String(r.banca_id ?? ''))
    .filter(Boolean)
    .sort()
    .join(',');
  const dbCampaignBancaKey = (allCampaignsRows || [])
    .map((r: any) => String(r.banca_id ?? ''))
    .filter(Boolean)
    .sort()
    .join(',');
  useEffect(() => {
    if (!userId || !liveCampaignBancaKey) return;
    const dbBancaSet = new Set(dbCampaignBancaKey.split(',').filter(Boolean));
    const missingBancaIds = [...new Set(liveCampaignBancaKey.split(',').filter(Boolean))].filter(
      (id) => !dbBancaSet.has(id)
    );
    if (missingBancaIds.length === 0) return;
    void (async () => {
      const entries = await Promise.all(
        missingBancaIds.map(async (bancaId) => {
          try {
            const res = await fetch(`/api/admin/meta/campaign-consultors?banca_id=${encodeURIComponent(bancaId)}`, {
              headers: { 'X-User-Id': userId },
            });
            const data = await res.json();
            if (!data.success) return [bancaId, []] as const;
            return [bancaId, data.data?.consultors || []] as const;
          } catch {
            return [bancaId, []] as const;
          }
        })
      );
      setConsultorsByBanca((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
    })();
  }, [userId, liveCampaignBancaKey, dbCampaignBancaKey]);

  useEffect(() => {
    if (!userId) return;
    const ownerIds = new Set<string>();
    for (const row of allCampaignsRows || []) {
      const g = (row as { gestor_user_ids?: unknown }).gestor_user_ids;
      if (!Array.isArray(g)) continue;
      for (const x of g) {
        const id = String(x ?? '').trim();
        if (id) ownerIds.add(id);
      }
    }
    if (ownerIds.size === 0) {
      setRedirectSlugOptionsByOwner({});
      return;
    }
    void (async () => {
      const entries = await Promise.all(
        [...ownerIds].map(async (ownerId) => {
          try {
            const res = await fetch(
              `/api/admin/meta/campaign-redirect?owner_user_id=${encodeURIComponent(ownerId)}`,
              { headers: { 'X-User-Id': userId } }
            );
            const data = await res.json();
            if (!data.success) return [ownerId, []] as const;
            const opts = Array.isArray(data.data?.redirect_slug_options)
              ? data.data.redirect_slug_options
              : [];
            return [ownerId, opts] as const;
          } catch {
            return [ownerId, []] as const;
          }
        })
      );
      setRedirectSlugOptionsByOwner(Object.fromEntries(entries));
    })();
  }, [userId, allCampaignsRows]);

  const handleCreateIntegration = async () => {
    if (!userId) return;
    if (!newIntegrationForm.banca_ids?.length) {
      setNewIntegrationError('Selecione pelo menos uma banca.');
      return;
    }
    setNewIntegrationSaving(true);
    setNewIntegrationError(null);
    try {
      const firstBanca = newIntegrationForm.banca_ids[0];
      const res = await fetch('/api/admin/meta/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
        body: JSON.stringify({
          banca_id: firstBanca,
          banca_ids: newIntegrationForm.banca_ids,
          base_url: newIntegrationForm.base_url,
          access_token: newIntegrationForm.access_token || undefined,
          ad_account_id: newIntegrationForm.ad_account_id,
          pixel_id: newIntegrationForm.pixel_id,
          default_campaign_id: newIntegrationForm.default_campaign_id || null,
          is_active: true,
          create_new_integration: true,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        setNewIntegrationError(data.error || 'Erro ao criar integração.');
        return;
      }
      await loadOverview();
      setSelectedBancaIds([...newIntegrationForm.banca_ids]);
      setNewIntegrationOpen(false);
      setNewIntegrationForm((f) => ({ ...f, access_token: '' }));
      setTimeout(() => {
        document.getElementById('meta-config-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 0);
    } catch (err: any) {
      setNewIntegrationError(err?.message || 'Erro ao criar integração.');
    } finally {
      setNewIntegrationSaving(false);
    }
  };

  const formatDate = (s: string | null) => {
    if (!s) return '-';
    try {
      return new Date(s).toLocaleString('pt-BR');
    } catch {
      return s;
    }
  };

  const selectedBancaName =
    overviewFilterBancaId
      ? (bancas.find((b) => b.id === overviewFilterBancaId)?.name ||
         bancas.find((b) => b.id === overviewFilterBancaId)?.url ||
         overviewFilterBancaId)
      : selectedBancaIds.length === 0
      ? '-'
      : selectedBancaIds.length === 1
        ? bancas.find((b) => b.id === selectedBancaIds[0])?.name ||
          bancas.find((b) => b.id === selectedBancaIds[0])?.url ||
          selectedBancaIds[0]
        : `${selectedBancaIds.length} bancas (${selectedBancaIds
            .slice(0, 3)
            .map((id) => bancas.find((b) => b.id === id)?.name || id)
            .join(', ')}${selectedBancaIds.length > 3 ? '…' : ''})`;
  const OVERVIEW_PAGE_SIZE = 5;

  /** Prioridade de ordenação: ativa=0, inativa configurada=1, sem integração=2 */
  function overviewPriority(row: MetaOverviewRow): number {
    if (row.configured && row.is_active) return 0;
    if (row.configured) return 1;
    return 2;
  }

  const filteredOverviewRows = overviewRows
    .filter((row) => (overviewFilterBancaId ? row.banca_id === overviewFilterBancaId : true))
    .filter((row) => {
      const term = overviewSearch.trim().toLowerCase();
      if (!term) return true;
      return row.banca_name.toLowerCase().includes(term) || row.banca_url.toLowerCase().includes(term);
    })
    .sort((a, b) => {
      const diff = overviewPriority(a) - overviewPriority(b);
      if (diff !== 0) return diff;
      return a.banca_name.localeCompare(b.banca_name, 'pt-BR');
    });

  const overviewTotalPages = Math.max(1, Math.ceil(filteredOverviewRows.length / OVERVIEW_PAGE_SIZE));
  const overviewPageSafe = Math.min(overviewPage, overviewTotalPages);
  const pagedOverviewRows = filteredOverviewRows.slice(
    (overviewPageSafe - 1) * OVERVIEW_PAGE_SIZE,
    overviewPageSafe * OVERVIEW_PAGE_SIZE
  );

  /** Uma linha por banca para somas (métricas são por banca, não por integração). */
  const filteredOverviewRowsUniqueBanca = useMemo(() => {
    const seen = new Set<string>();
    const out: MetaOverviewRow[] = [];
    for (const row of filteredOverviewRows) {
      if (seen.has(row.banca_id)) continue;
      seen.add(row.banca_id);
      out.push(row);
    }
    return out;
  }, [filteredOverviewRows]);

  const overviewRowsUniqueBanca = useMemo(() => {
    const seen = new Set<string>();
    const out: MetaOverviewRow[] = [];
    for (const row of overviewRows) {
      if (seen.has(row.banca_id)) continue;
      seen.add(row.banca_id);
      out.push(row);
    }
    return out;
  }, [overviewRows]);

  const overviewTotals = filteredOverviewRowsUniqueBanca.reduce(
    (acc, row) => {
      acc.totalSpend += row.metrics.spend;
      acc.totalLeads += row.metrics.leads;
      return acc;
    },
    { totalSpend: 0, totalLeads: 0 }
  );
  const syncedTotals = (syncedData?.insights ?? []).reduce(
    (acc, row: any) => {
      acc.reach += Number(row.reach) || 0;
      acc.impressions += Number(row.impressions) || 0;
      acc.clicks += Number(row.clicks) || 0;
      acc.leads += Number(row.leads) || 0;
      acc.spend += Number(row.spend) || 0;
      return acc;
    },
    { reach: 0, impressions: 0, clicks: 0, leads: 0, spend: 0 }
  );
  /** Com banca específica no filtro, métricas de campanha vêm só do Graph (live); sem cache do DB na tabela/cards. */
  const scopedMetaBancaFilter = Boolean(overviewFilterBancaId?.trim());
  const usingLiveMetaCards = Boolean(liveAggregate && !liveAggregateError);

  /** Campanhas com métricas (lista já respeita ACTIVE por padrão via API; opcional incluir pausadas). */
  const metricSyncedCampaignRowsBase = useMemo(
    () =>
      (allCampaignsRows ?? []).filter((row: any) => {
        const reach = Number(row?.reach) || 0;
        const impressions = Number(row?.impressions) || 0;
        const clicks = Number(row?.clicks) || 0;
        const leads = Number(row?.leads) || 0;
        const spend = Number(row?.spend) || 0;
        return reach > 0 || impressions > 0 || clicks > 0 || leads > 0 || spend > 0;
      }),
    [allCampaignsRows]
  );

  /** Em "Todas as bancas", não repetir a mesma campanha Meta em linhas com `banca_id` diferentes. */
  const metricSyncedCampaignRows = useMemo(() => {
    if (scopedMetaBancaFilter) return metricSyncedCampaignRowsBase;
    return dedupeMetaCampaignRowsByGlobalCampaignId(metricSyncedCampaignRowsBase);
  }, [scopedMetaBancaFilter, metricSyncedCampaignRowsBase]);

  /** Cache local (campaigns-all) já filtrado pela banca do dropdown, para não esvaziar a tabela enquanto o live carrega. */
  const cachedMetricRowsForCrmScope = useMemo(() => {
    if (!scopedMetaBancaFilter) return metricSyncedCampaignRows;
    const bid = String(overviewFilterBancaId).trim();
    return metricSyncedCampaignRows.filter((row: any) => String(row.banca_id) === bid);
  }, [metricSyncedCampaignRows, scopedMetaBancaFilter, overviewFilterBancaId]);

  /** Totais vindos do cache (campaigns-all): gasto e leads por tipo — sem API Graph, "resultados" usam leads sincronizados. */
  const cacheKindSummary = useMemo(() => {
    return (metricSyncedCampaignRows as any[]).reduce(
      (acc, row: any) => {
        const spend = Number(row?.spend) || 0;
        const leads = Number(row?.leads) || 0;
        const kind = row?.campaign_kind === 'bolao' ? 'bolao' : 'normal';
        acc.spendAll += spend;
        if (kind === 'bolao') acc.spendBolao += spend;
        if (kind === 'bolao') acc.resultsBolao += leads;
        else acc.resultsNormal += leads;
        return acc;
      },
      { spendAll: 0, spendBolao: 0, resultsNormal: 0, resultsBolao: 0 }
    );
  }, [metricSyncedCampaignRows]);

  /** Enquanto busca na Meta ou, sem live, enquanto monta o cache da lista de campanhas. */
  const metaSummaryCardsLoading =
    (loadingLiveAggregate && !liveAggregate) ||
    (scopedMetaBancaFilter && !usingLiveMetaCards && !liveAggregateError) ||
    (!scopedMetaBancaFilter && !usingLiveMetaCards && allCampaignsLoading);

  /** Cotação USD→BRL do último aggregate (usada só para reconversão local ao mudar moeda na linha). */
  const liveUsdBrlRate = useMemo(() => {
    const rates = liveAggregate?.exchange_rates ?? [];
    const usd = rates.find((r) => r.pair === 'USD-BRL');
    return usd?.rate && Number.isFinite(Number(usd.rate)) ? Number(usd.rate) : null;
  }, [liveAggregate]);

  /** Linhas da tabela: métricas live (todas as integrações no stream) cruzadas com CRM; fallback = cache por banca. */
  const displayMetricCampaignRowsRaw = useMemo(() => {
    if (!usingLiveMetaCards || !liveAggregate) {
      return cachedMetricRowsForCrmScope;
    }
    const liveList = (liveAggregate.campaigns ?? []) as Array<Record<string, unknown>>;
    const merged = liveList.map((row) => {
      const bancaId = String(row.banca_id ?? '');
      const campaignId = String(row.campaign_id ?? '');
      const integrationId = row.integration_id ?? null;
      const adAccountId = row.ad_account_id ?? null;
      const dbRow = findAllCampaignRowForLiveMerge(
        allCampaignsRows,
        bancaId,
        campaignId,
        integrationId,
        adAccountId
      );
      const liveG = (row as { gestor_names?: unknown }).gestor_names;
      const fromLive = Array.isArray(liveG)
        ? liveG.map((x) => String(x ?? '').trim()).filter((s) => s.length > 0)
        : [];
      const fromDb = Array.isArray((dbRow as { gestor_names?: unknown } | undefined)?.gestor_names)
        ? ((dbRow as { gestor_names: unknown[] }).gestor_names ?? [])
            .map((x) => String(x ?? '').trim())
            .filter((s) => s.length > 0)
        : [];
      const gestorMerged: string[] = [];
      const seenG = new Set<string>();
      for (const n of [...fromLive, ...fromDb]) {
        if (!n || seenG.has(n)) continue;
        seenG.add(n);
        gestorMerged.push(n);
      }
      const fromLiveU = (row as { gestor_user_ids?: unknown }).gestor_user_ids;
      const fromLiveIds = Array.isArray(fromLiveU)
        ? fromLiveU.map((x) => String(x ?? '').trim()).filter((s) => s.length > 0)
        : [];
      const fromDbIds = Array.isArray((dbRow as { gestor_user_ids?: unknown } | undefined)?.gestor_user_ids)
        ? ((dbRow as { gestor_user_ids: unknown[] }).gestor_user_ids ?? [])
            .map((x) => String(x ?? '').trim())
            .filter((s) => s.length > 0)
        : [];
      const gestorUserIdsMerged: string[] = [];
      const seenGu = new Set<string>();
      for (const id of [...fromLiveIds, ...fromDbIds]) {
        if (!id || seenGu.has(id)) continue;
        seenGu.add(id);
        gestorUserIdsMerged.push(id);
      }
      return {
        ...(dbRow || {}),
        id: dbRow?.id ?? campaignId,
        banca_id: bancaId,
        integration_id: integrationId ?? (dbRow as { integration_id?: string } | undefined)?.integration_id ?? null,
        ad_account_id: adAccountId ?? (dbRow as { ad_account_id?: string } | undefined)?.ad_account_id ?? null,
        banca_name: row.banca_name ?? dbRow?.banca_name,
        banca_url: row.banca_url ?? dbRow?.banca_url ?? null,
        campaign_id: campaignId,
        name: row.name ?? dbRow?.name,
        objective: row.objective ?? dbRow?.objective ?? null,
        status: row.status ?? dbRow?.status ?? null,
        effective_status: row.effective_status ?? dbRow?.effective_status ?? null,
        daily_budget: row.daily_budget ?? dbRow?.daily_budget ?? null,
        lifetime_budget: row.lifetime_budget ?? dbRow?.lifetime_budget ?? null,
        start_time: row.start_time ?? dbRow?.start_time ?? null,
        stop_time: row.stop_time ?? dbRow?.stop_time ?? null,
        updated_at: dbRow?.updated_at ?? null,
        campaign_kind:
          (row.campaign_kind as MetaCampaignKind) ||
          (dbRow?.campaign_kind as MetaCampaignKind) ||
          'normal',
        gestor_names: gestorMerged,
        gestor_user_ids: gestorUserIdsMerged,
        reach: Number(row.reach) || 0,
        impressions: Number(row.impressions) || 0,
        clicks: Number(row.clicks) || 0,
        leads: Number(row.leads) || 0,
        spend: Number(row.spend) || 0,
        results_live: Number(row.results) || 0,
        /** Campos da linha live (não somar moedas sem eles). */
        spend_brl: Number.isFinite(Number((row as { spend_brl?: unknown }).spend_brl))
          ? Number((row as { spend_brl?: unknown }).spend_brl)
          : 0,
        currency: (row as { currency?: string | null }).currency ?? (dbRow as { currency?: string | null } | undefined)?.currency ?? null,
        currency_account:
          (row as { currency_account?: string | null }).currency_account ??
          (row as { currency?: string | null }).currency ??
          (dbRow as { currency?: string | null } | undefined)?.currency ??
          null,
        currency_override:
          (row as { currency_override?: string | null }).currency_override ??
          (dbRow as { currency_override?: string | null } | undefined)?.currency_override ??
          null,
        redirect_project_id:
          (dbRow as { redirect_project_id?: string | null } | undefined)?.redirect_project_id ??
          null,
        redirect_project:
          (dbRow as { redirect_project?: unknown } | undefined)?.redirect_project ??
          null,
        assigned_consultors: dbRow?.assigned_consultors ?? [],
        consultor_total_leads: dbRow?.consultor_total_leads ?? 0,
        consultor_total_deposited: dbRow?.consultor_total_deposited ?? 0,
        ads_attribution_consultor_ids:
          (dbRow as { ads_attribution_consultor_ids?: string[] | null } | undefined)
            ?.ads_attribution_consultor_ids ?? null,
        ads_attribution_consultor_id:
          (dbRow as { ads_attribution_consultor_id?: string | null } | undefined)
            ?.ads_attribution_consultor_id ?? null,
        ads_attribution_consultors:
          (dbRow as {
            ads_attribution_consultors?: Array<{
              id: string;
              email: string;
              full_name: string | null;
            }> | null;
          })?.ads_attribution_consultors ?? null,
        ads_attribution_consultor:
          (dbRow as { ads_attribution_consultor?: { id: string; email: string; full_name: string | null } | null }
            | undefined)?.ads_attribution_consultor ?? null,
      };
    });
    const dedup = new Map<string, (typeof merged)[0]>();
    for (const row of merged) {
      const k = [
        String(row.banca_id ?? ''),
        String(row.campaign_id ?? ''),
        row.integration_id != null ? String(row.integration_id) : '',
        row.ad_account_id != null ? String(row.ad_account_id) : '',
      ].join(':');
      dedup.set(k, row);
    }

    /**
     * Inclui linhas do cache (campaigns-all/DB) que ainda não chegaram no live durante o streaming.
     * Evita o "pisca-pisca" ao trocar do cache para o live: as campanhas existentes no DB ficam visíveis
     * até o respectivo batch da Meta chegar, momento em que a linha live sobrescreve a do cache (mesma
     * chave banca_id+campaign_id). Após o evento `complete` o live ficou canônico para tudo que veio dele
     * e o cache só preenche o que não estiver no resultado final (ex.: campanhas com métricas históricas
     * que não retornaram da Meta neste período).
     */
    const liveCampaignKeys = new Set<string>();
    for (const row of merged) {
      liveCampaignKeys.add(`${String(row.banca_id ?? '')}:${String(row.campaign_id ?? '')}`);
    }
    for (const cacheRow of cachedMetricRowsForCrmScope) {
      const cacheKey = `${String(cacheRow.banca_id ?? '')}:${String(cacheRow.campaign_id ?? '')}`;
      if (liveCampaignKeys.has(cacheKey)) continue;
      const integrationKey =
        cacheRow.integration_id != null ? String(cacheRow.integration_id) : '';
      const adAccountKey =
        cacheRow.ad_account_id != null ? String(cacheRow.ad_account_id) : '';
      const dedupKey = [
        String(cacheRow.banca_id ?? ''),
        String(cacheRow.campaign_id ?? ''),
        integrationKey,
        adAccountKey,
      ].join(':');
      if (dedup.has(dedupKey)) continue;
      const bancaIdStr = String(cacheRow.banca_id ?? '');
      const cacheGestorNames = Array.isArray((cacheRow as { gestor_names?: unknown }).gestor_names)
        ? ((cacheRow as { gestor_names: unknown[] }).gestor_names ?? [])
            .map((x) => String(x ?? '').trim())
            .filter((s) => s.length > 0)
        : [];
      const gestorMerged: string[] = [];
      const seenG = new Set<string>();
      for (const n of cacheGestorNames) {
        if (!n || seenG.has(n)) continue;
        seenG.add(n);
        gestorMerged.push(n);
      }
      const cacheGestorUids = Array.isArray((cacheRow as { gestor_user_ids?: unknown }).gestor_user_ids)
        ? ((cacheRow as { gestor_user_ids: unknown[] }).gestor_user_ids ?? [])
            .map((x) => String(x ?? '').trim())
            .filter((s) => s.length > 0)
        : [];
      const gestorUidsMerged: string[] = [];
      const seenUid = new Set<string>();
      for (const id of cacheGestorUids) {
        if (!id || seenUid.has(id)) continue;
        seenUid.add(id);
        gestorUidsMerged.push(id);
      }
      dedup.set(dedupKey, {
        ...cacheRow,
        gestor_names: gestorMerged,
        gestor_user_ids: gestorUidsMerged,
        results_live: 0,
      });
    }

    let out = Array.from(dedup.values());
    if (!scopedMetaBancaFilter) {
      out = dedupeMetaCampaignRowsByGlobalCampaignId(out);
    }
    return out;
  }, [
    usingLiveMetaCards,
    liveAggregate,
    allCampaignsRows,
    cachedMetricRowsForCrmScope,
    scopedMetaBancaFilter,
  ]);

  /**
   * Aplica escolha local de moeda + recalcula `spend_brl` sem novo request ao stream da Meta.
   */
  const displayMetricCampaignRows = useMemo(() => {
    const raw = displayMetricCampaignRowsRaw;
    const usdRate = liveUsdBrlRate != null && liveUsdBrlRate > 0 ? liveUsdBrlRate : 5;
    const rates: Record<string, number> = { BRL: 1, USD: usdRate };

    return raw.map((row: Record<string, unknown>) => {
      const key = metaCampaignStableKey(row);
      const local = localMetaCurrencyByKey[key];
      /** Valor persistido no CRM (payload live), antes de sobrescrevermos para UI. */
      const overrideFromServer = row.currency_override;

      const accountRaw = String(row.currency_account ?? row.currency ?? '').trim().toUpperCase();
      const nativeForUi =
        accountRaw === 'USD' || accountRaw === 'BRL' ? accountRaw : accountRaw ? accountRaw : 'BRL';

      let effectiveCurrency: string;
      let overrideForUi: string | null;

      if (local === 'BRL' || local === 'USD') {
        effectiveCurrency = local;
        overrideForUi = local;
      } else if (local === 'AUTO') {
        effectiveCurrency = nativeForUi;
        overrideForUi = null;
      } else {
        const ov = String(row.currency_override ?? '').trim().toUpperCase();
        if (ov === 'BRL' || ov === 'USD') {
          effectiveCurrency = ov;
          overrideForUi = ov;
        } else {
          effectiveCurrency = nativeForUi;
          overrideForUi = null;
        }
      }

      const spend = Number(row.spend) || 0;
      const spend_brl =
        convertMetaSpendToBrl(spend, effectiveCurrency, rates) ??
        (effectiveCurrency === 'BRL' || !effectiveCurrency ? spend : spend * usdRate);

      return {
        ...row,
        currency_override_server: overrideFromServer,
        currency: effectiveCurrency,
        currency_override: overrideForUi,
        currency_account: row.currency_account ?? row.currency ?? nativeForUi,
        spend_brl,
      };
    });
  }, [displayMetricCampaignRowsRaw, localMetaCurrencyByKey, liveUsdBrlRate]);

  /**
   * Totais de Insights derivados das linhas REALMENTE exibidas em `displayMetricCampaignRows`.
   * Usado para resultados e para o spend estimado por tipo de campanha. O card principal de billing
   * não usa esta soma.
   */
  const displayMetricSummary = useMemo(() => {
    const rows = Array.isArray(displayMetricCampaignRows) ? displayMetricCampaignRows : [];
    return rows.reduce(
      (acc: { spendAll: number; spendBolao: number; resultsNormal: number; resultsBolao: number }, row: any) => {
        /**
         * Sempre soma em BRL: usamos `spend_brl` quando disponível (linhas live ganham conversão automática
         * USD→BRL no backend); para linhas vindas só do cache (sem `spend_brl`), assume que `spend` já está em BRL.
         */
        const spendBrl =
          Number.isFinite(Number(row?.spend_brl)) ? Number(row?.spend_brl) : Number(row?.spend) || 0;
        const liveResults = Number(row?.results_live) || 0;
        const cachedLeads = Number(row?.leads) || 0;
        const results = liveResults > 0 ? liveResults : cachedLeads;
        const kind = row?.campaign_kind === 'bolao' ? 'bolao' : 'normal';
        acc.spendAll += spendBrl;
        if (kind === 'bolao') {
          acc.spendBolao += spendBrl;
          acc.resultsBolao += results;
        } else {
          acc.resultsNormal += results;
        }
        return acc;
      },
      { spendAll: 0, spendBolao: 0, resultsNormal: 0, resultsBolao: 0 }
    );
  }, [displayMetricCampaignRows]);

  const liveBillingDue = useMemo(() => {
    if (!usingLiveMetaCards || !liveAggregate?.billing) return 0;
    return Number(liveAggregate.billing.total_balance_due) || 0;
  }, [usingLiveMetaCards, liveAggregate]);

  /**
   * Total cobrado no cartão no período do filtro, **em BRL** (contas USD convertidas pela cotação atual).
   */
  const liveCardCharges = useMemo(() => {
    if (!usingLiveMetaCards || !liveAggregate?.billing) return 0;
    return Number(liveAggregate.billing.total_card_charges) || 0;
  }, [usingLiveMetaCards, liveAggregate]);

  /**
   * Parcela em USD das cobranças (soma das contas em dólar, antes de converter).
   * Exibir ao lado do total em R$ quando > 0.
   */
  const liveCardChargesUsdComponent = useMemo(() => {
    if (!usingLiveMetaCards || !liveAggregate?.billing) return 0;
    return Number(liveAggregate.billing.total_card_charges_usd) || 0;
  }, [usingLiveMetaCards, liveAggregate]);

  const liveCardChargesCount = useMemo(() => {
    if (!usingLiveMetaCards || !liveAggregate?.billing) return 0;
    return Number(liveAggregate.billing.card_charges_count) || 0;
  }, [usingLiveMetaCards, liveAggregate]);

  /** Total na janela ~90d (filtrado para BRL no backend). */
  const liveCardChargesWindow = useMemo(() => {
    if (!usingLiveMetaCards || !liveAggregate?.billing) return 0;
    return Number(liveAggregate.billing.total_card_charges_window) || 0;
  }, [usingLiveMetaCards, liveAggregate]);

  const liveCardChargesWindowUsdComponent = useMemo(() => {
    if (!usingLiveMetaCards || !liveAggregate?.billing) return 0;
    return Number(liveAggregate.billing.total_card_charges_window_usd) || 0;
  }, [usingLiveMetaCards, liveAggregate]);

  const liveCardChargesCountWindow = useMemo(() => {
    if (!usingLiveMetaCards || !liveAggregate?.billing) return 0;
    return Number(liveAggregate.billing.card_charges_count_window) || 0;
  }, [usingLiveMetaCards, liveAggregate]);

  /** Cobrança mais recente entre todas as contas, pra exibir como "última cobrança" quando o filtro não tem dado. */
  const liveLatestCharge = useMemo(() => {
    if (!usingLiveMetaCards) return null;
    const lc = liveAggregate?.billing?.latest_card_charge ?? null;
    if (!lc?.event_time) return null;
    const amt = lc.amount != null ? Number(lc.amount) : NaN;
    const amtBrl = lc.amount_brl != null ? Number(lc.amount_brl) : NaN;
    if (!Number.isFinite(amt) && !Number.isFinite(amtBrl)) return null;
    const date = new Date(String(lc.event_time));
    if (Number.isNaN(date.getTime())) return null;
    const cur = String(lc.currency ?? '').trim().toUpperCase() || 'BRL';
    return {
      amount: Number.isFinite(amt) ? amt : 0,
      amount_brl: Number.isFinite(amtBrl) ? amtBrl : null,
      currency: cur,
      label: date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }),
    };
  }, [usingLiveMetaCards, liveAggregate]);

  const liveBillingAccountsLabel = useMemo(() => {
    if (!usingLiveMetaCards || !liveAggregate?.billing) return null;
    const count =
      Number(liveAggregate.billing.accounts_count) ||
      (Array.isArray(liveAggregate.billing.accounts) ? liveAggregate.billing.accounts.length : 0);
    if (count <= 0) return null;
    return `${count} ${count === 1 ? 'conta' : 'contas'} Meta`;
  }, [usingLiveMetaCards, liveAggregate]);

  /**
   * Cards de resumo Meta. O número principal de gasto é a **soma do spend estimado (Insights)**
   * no período do filtro — todas as campanhas e tipos (normal + bolão), no escopo das bancas —
   * para ficar coerente com o card "Spend Insights · bolão". Cobranças no cartão vêm da API de
   * billing (`ad_account_billing_charge`) e podem divergir (threshold, fuso, contas sem permissão).
   */
  const metaSummaryCards = useMemo(() => {
    if (usingLiveMetaCards && liveAggregate?.totals) {
      return {
        spendAll: displayMetricSummary.spendAll,
        cardCharges: liveCardCharges,
        billingDue: liveBillingDue,
        spendBolao: displayMetricSummary.spendBolao,
        resultsNormal: displayMetricSummary.resultsNormal,
        resultsBolao: displayMetricSummary.resultsBolao,
        resultsSub:
          'Resultados = soma das ações Meta (lead, compra, cadastro completo, etc.) no período, por tipo da campanha no CRM.',
      };
    }
    if (scopedMetaBancaFilter) {
      return {
        spendAll: 0,
        cardCharges: 0,
        billingDue: 0,
        spendBolao: 0,
        resultsNormal: 0,
        resultsBolao: 0,
        resultsSub: liveAggregateError
          ? String(liveAggregateError)
          : 'Carregando métricas em tempo real da Meta para a banca selecionada…',
      };
    }
    if (overviewApiTotals) {
      const normal = overviewKindSummary.normal;
      const bolao = overviewKindSummary.bolao;
      const spendAll = (Number(normal.spend) || 0) + (Number(bolao.spend) || 0);
      return {
        spendAll,
        cardCharges: 0,
        billingDue: 0,
        spendBolao: bolao.spend || 0,
        resultsNormal: normal.insights_rows > 0 ? normal.leads || 0 : 0,
        resultsBolao: bolao.insights_rows > 0 ? bolao.leads || 0 : 0,
        resultsSub:
          'Dados do período selecionado, sincronizados com a Meta via Graph API.',
      };
    }
    return {
      spendAll: cacheKindSummary.spendAll,
      cardCharges: 0,
      billingDue: 0,
      spendBolao: cacheKindSummary.spendBolao,
      resultsNormal: cacheKindSummary.resultsNormal,
      resultsBolao: cacheKindSummary.resultsBolao,
      resultsSub:
        'Valores por tipo usam dados salvos no sistema até a próxima atualização bem-sucedida.',
    };
  }, [
    usingLiveMetaCards,
    liveAggregate,
    liveAggregateError,
    scopedMetaBancaFilter,
    overviewApiTotals,
    overviewKindSummary,
    cacheKindSummary,
    displayMetricSummary,
    liveBillingDue,
    liveCardCharges,
  ]);

  const cardChargeTaxMultiplier = useMemo(() => 1 + cardChargeTaxPercent / 100, [cardChargeTaxPercent]);

  const cobradoCartaoComImposto = useMemo(() => {
    const baseBrl = Number(metaSummaryCards.cardCharges) || 0;
    const baseUsd = Number(liveCardChargesUsdComponent) || 0;
    const baseWindowBrl = Number(liveCardChargesWindow) || 0;
    const baseWindowUsd = Number(liveCardChargesWindowUsdComponent) || 0;
    const m = cardChargeTaxMultiplier;
    return {
      baseBrl,
      baseUsd,
      taxBrl: baseBrl * (m - 1),
      taxUsd: baseUsd * (m - 1),
      totalBrl: baseBrl * m,
      totalUsd: baseUsd * m,
      windowTotalBrl: baseWindowBrl * m,
      windowTotalUsd: baseWindowUsd * m,
    };
  }, [
    metaSummaryCards.cardCharges,
    liveCardChargesUsdComponent,
    liveCardChargesWindow,
    liveCardChargesWindowUsdComponent,
    cardChargeTaxMultiplier,
  ]);

  const latestChargeTaxed = useMemo(() => {
    if (!liveLatestCharge) return null;
    const m = cardChargeTaxMultiplier;
    return {
      label: liveLatestCharge.label,
      currency: liveLatestCharge.currency,
      amount: liveLatestCharge.amount * m,
      amount_brl:
        liveLatestCharge.amount_brl != null && Number.isFinite(liveLatestCharge.amount_brl)
          ? liveLatestCharge.amount_brl * m
          : null,
    };
  }, [liveLatestCharge, cardChargeTaxMultiplier]);

  /** Ordenação estável para leitura humana: agrupa por banca e ordena por data dentro da banca. */
  const orderedDisplayMetricCampaignRows = useMemo(() => {
    const rows = Array.isArray(displayMetricCampaignRows) ? [...displayMetricCampaignRows] : [];
    rows.sort((a: any, b: any) => {
      const bancaA = String(a?.banca_name || a?.banca_id || '').trim().toLowerCase();
      const bancaB = String(b?.banca_name || b?.banca_id || '').trim().toLowerCase();
      if (bancaA !== bancaB) return bancaA.localeCompare(bancaB, 'pt-BR');

      const ta = a?.start_time ? new Date(String(a.start_time)).getTime() : 0;
      const tb = b?.start_time ? new Date(String(b.start_time)).getTime() : 0;
      if (ta !== tb) return tb - ta;

      const nameA = String(a?.name || a?.campaign_id || '').trim().toLowerCase();
      const nameB = String(b?.name || b?.campaign_id || '').trim().toLowerCase();
      return nameA.localeCompare(nameB, 'pt-BR');
    });
    return rows;
  }, [displayMetricCampaignRows]);

  /** Restringe vínculos de campanha às bancas da mesma integração Meta para evitar 400 no campaign-owner. */
  const ownerTargetBancaIdsByIntegration = useMemo(() => {
    const byIntegration = new Map<string, Set<string>>();

    for (const row of overviewRows) {
      const integrationId = String(row.integration_id ?? '').trim();
      const bancaId = String(row.banca_id ?? '').trim();
      if (!integrationId || !bancaId) continue;
      const set = byIntegration.get(integrationId) ?? new Set<string>();
      set.add(bancaId);
      byIntegration.set(integrationId, set);
    }

    for (const integration of config?.integrations ?? []) {
      const integrationId = String(integration.integration_id ?? '').trim();
      if (!integrationId || !Array.isArray(integration.banca_ids)) continue;
      const set = byIntegration.get(integrationId) ?? new Set<string>();
      for (const bancaId of integration.banca_ids) {
        const id = String(bancaId ?? '').trim();
        if (id) set.add(id);
      }
      byIntegration.set(integrationId, set);
    }

    const finalMap = new Map<string, string[]>();
    for (const [integrationId, bancaSet] of byIntegration.entries()) {
      finalMap.set(integrationId, Array.from(bancaSet));
    }
    return finalMap;
  }, [overviewRows, config?.integrations]);

  const ownerTargetBancaIdsBySourceBanca = useMemo(() => {
    const byBanca = new Map<string, Set<string>>();
    for (const row of overviewRows) {
      const integrationId = String(row.integration_id ?? '').trim();
      const sourceBancaId = String(row.banca_id ?? '').trim();
      if (!integrationId || !sourceBancaId) continue;
      const linked = ownerTargetBancaIdsByIntegration.get(integrationId) ?? [];
      if (linked.length === 0) continue;
      const set = byBanca.get(sourceBancaId) ?? new Set<string>();
      for (const bancaId of linked) set.add(bancaId);
      byBanca.set(sourceBancaId, set);
    }
    const finalMap = new Map<string, string[]>();
    for (const [sourceBancaId, bancaSet] of byBanca.entries()) {
      finalMap.set(sourceBancaId, Array.from(bancaSet));
    }
    return finalMap;
  }, [overviewRows, ownerTargetBancaIdsByIntegration]);

  /**
   * Fallback seguro quando a linha não traz integration_id:
   * usa apenas bancas que aparecem em TODAS as integrações vinculadas à banca de origem.
   * Evita permitir destino inválido e receber 400 no campaign-owner.
   */
  const ownerSafeTargetBancaIdsBySourceBanca = useMemo(() => {
    const integrationIdsBySource = new Map<string, string[]>();
    for (const row of overviewRows) {
      const sourceBancaId = String(row.banca_id ?? '').trim();
      const integrationId = String(row.integration_id ?? '').trim();
      if (!sourceBancaId || !integrationId) continue;
      const cur = integrationIdsBySource.get(sourceBancaId) ?? [];
      if (!cur.includes(integrationId)) cur.push(integrationId);
      integrationIdsBySource.set(sourceBancaId, cur);
    }

    const safeBySource = new Map<string, string[]>();
    for (const [sourceBancaId, integrationIds] of integrationIdsBySource.entries()) {
      const linkedLists = integrationIds
        .map((iid) => ownerTargetBancaIdsByIntegration.get(iid) ?? [])
        .filter((list) => list.length > 0);

      if (linkedLists.length === 0) {
        safeBySource.set(sourceBancaId, [sourceBancaId]);
        continue;
      }

      let intersection = new Set(linkedLists[0]);
      for (let i = 1; i < linkedLists.length; i += 1) {
        const next = new Set(linkedLists[i]);
        intersection = new Set([...intersection].filter((id) => next.has(id)));
      }
      if (!intersection.has(sourceBancaId)) intersection.add(sourceBancaId);
      safeBySource.set(sourceBancaId, Array.from(intersection));
    }
    return safeBySource;
  }, [overviewRows, ownerTargetBancaIdsByIntegration]);

  const crmCampaignsBlockLoading =
    (loadingLiveAggregate && !liveAggregate && cachedMetricRowsForCrmScope.length === 0) ||
    (allCampaignsLoading && cachedMetricRowsForCrmScope.length === 0 && !usingLiveMetaCards);

  const syncedAdsetRows = syncedData?.adsets ?? [];
  const syncedInsightRows = syncedData?.insights ?? [];
  const syncedAdsetTotalPages = Math.max(1, Math.ceil(syncedAdsetRows.length / SYNCED_DATA_PAGE_SIZE));
  const syncedInsightTotalPages = Math.max(1, Math.ceil(syncedInsightRows.length / SYNCED_DATA_PAGE_SIZE));
  const syncedAdsetPage = Math.min(syncedDataPage.adsets, syncedAdsetTotalPages);
  const syncedInsightPage = Math.min(syncedDataPage.insights, syncedInsightTotalPages);
  const pagedSyncedAdsetRows = syncedAdsetRows.slice(
    (syncedAdsetPage - 1) * SYNCED_DATA_PAGE_SIZE,
    syncedAdsetPage * SYNCED_DATA_PAGE_SIZE
  );
  const pagedSyncedInsightRows = syncedInsightRows.slice(
    (syncedInsightPage - 1) * SYNCED_DATA_PAGE_SIZE,
    syncedInsightPage * SYNCED_DATA_PAGE_SIZE
  );
  const selectedConsultorModalRow = useMemo(() => {
    const key = consultorModalCampaignKey;
    if (!key) return null;
    const fromDb = (allCampaignsRows || []).find((row: any) => `${String(row.banca_id)}:${String(row.campaign_id)}` === key);
    if (fromDb) return fromDb;
    return (displayMetricCampaignRows || []).find((row: any) => `${String(row.banca_id)}:${String(row.campaign_id)}` === key) ?? null;
  }, [allCampaignsRows, displayMetricCampaignRows, consultorModalCampaignKey]);
  const consultorModalSelectedIds = useMemo(() => {
    if (!selectedConsultorModalRow) return [];
    return campaignConsultorDraft[consultorModalCampaignKey]
      ?? (Array.isArray(selectedConsultorModalRow.assigned_consultors)
        ? selectedConsultorModalRow.assigned_consultors.map((x: any) => String(x.id))
        : []);
  }, [selectedConsultorModalRow, campaignConsultorDraft, consultorModalCampaignKey]);
  const consultorModalFilteredOptions = useMemo(() => {
    if (!selectedConsultorModalRow) return [];
    const options = consultorsByBanca[String(selectedConsultorModalRow.banca_id)] || [];
    const term = consultorModalSearch.trim().toLowerCase();
    if (!term) return options;
    return options.filter((c) => {
      const name = (c.full_name || '').toLowerCase();
      const email = (c.email || '').toLowerCase();
      return name.includes(term) || email.includes(term);
    });
  }, [selectedConsultorModalRow, consultorsByBanca, consultorModalSearch]);

  if (checking || !userId) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[400px]">
          <Loader2 className="w-8 h-8 animate-spin text-[#8CD955]" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6 text-gray-800 dark:text-gray-200">
        <div className="flex flex-wrap items-center gap-2">
          <BarChart3 className="w-6 h-6 text-[#8CD955]" />
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-50">Integração Meta Ads</h1>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <p className="text-gray-600 dark:text-gray-400">Gestão geral das integrações Meta Ads por banca.</p>
          <div className="w-full sm:w-auto shrink-0 flex items-end gap-2 flex-wrap">
            <div>
              <label className="block text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">Período Meta</label>
              <select
                value={metaInsightsPeriod}
                onChange={(e) => {
                  setMetaInsightsPeriod(e.target.value as typeof metaInsightsPeriod);
                  setOverviewPage(1);
                }}
                className="w-full sm:w-auto px-3 py-2 border border-gray-200 dark:border-[#404040] rounded-xl text-sm text-gray-800 dark:text-gray-100 bg-white dark:bg-[#2a2a2a] min-w-[150px]"
              >
                <option value="daily">Hoje</option>
                <option value="yesterday">Ontem</option>
                <option value="7days">7 dias</option>
                <option value="15days">15 dias</option>
                <option value="30days">30 dias</option>
                <option value="custom">Personalizado</option>
                <option value="all">Todo o período</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">Banca Meta</label>
              <div className="relative w-full sm:min-w-[220px]" ref={overviewFilterBancaRef}>
                <button
                  type="button"
                  onClick={() => setOverviewFilterBancaOpen((v) => !v)}
                  className="w-full px-3 py-2 border border-gray-200 dark:border-[#404040] rounded-xl text-sm text-gray-800 dark:text-gray-100 bg-white dark:bg-[#2a2a2a] flex items-center justify-between gap-2"
                >
                  <span className="truncate">
                    {overviewFilterBancaId
                      ? (bancas.find((b) => b.id === overviewFilterBancaId)?.name ||
                         bancas.find((b) => b.id === overviewFilterBancaId)?.url ||
                         overviewFilterBancaId)
                      : 'Todas as bancas'}
                  </span>
                  <ChevronDown className={`w-4 h-4 text-gray-500 dark:text-gray-400 transition-transform ${overviewFilterBancaOpen ? 'rotate-180' : ''}`} />
                </button>
                {overviewFilterBancaOpen ? (
                  <div className="absolute z-30 left-0 right-0 mt-1 rounded-xl border border-gray-200 dark:border-[#404040] bg-white dark:bg-[#2a2a2a] shadow-lg overflow-hidden">
                    <input
                      type="search"
                      value={overviewFilterBancaSearch}
                      onChange={(e) => setOverviewFilterBancaSearch(e.target.value)}
                      placeholder="Buscar banca..."
                      className="w-full px-3 py-2.5 text-sm border-b border-gray-100 dark:border-[#404040] text-gray-800 dark:text-gray-100 bg-transparent placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none"
                    />
                    <div className="max-h-56 overflow-y-auto p-1">
                      <button
                        type="button"
                        onClick={() => {
                          setOverviewFilterBancaId('');
                          setOverviewPage(1);
                          setAllCampaignsPage(1);
                          setOverviewFilterBancaOpen(false);
                        }}
                        className={`w-full text-left px-2.5 py-2 rounded-lg text-sm ${
                          overviewFilterBancaId === ''
                            ? 'bg-[#F1FAE8] dark:bg-emerald-950/50 text-[#6AAE39] dark:text-emerald-400'
                            : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#333]'
                        }`}
                      >
                        Todas as bancas
                      </button>
                      {bancasForMetaFilter.map((b) => (
                        <button
                          key={b.id}
                          type="button"
                          onClick={() => {
                            setOverviewFilterBancaId(b.id);
                            setOverviewPage(1);
                            setAllCampaignsPage(1);
                            setOverviewFilterBancaOpen(false);
                          }}
                          className={`w-full text-left px-2.5 py-2 rounded-lg text-sm ${
                            overviewFilterBancaId === b.id
                              ? 'bg-[#F1FAE8] dark:bg-emerald-950/50 text-[#6AAE39] dark:text-emerald-400'
                              : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#333]'
                          }`}
                        >
                          {b.name || b.url}
                        </button>
                      ))}
                      {bancasForMetaFilter.length === 0 ? (
                        <p className="px-2.5 py-2 text-xs text-gray-500 dark:text-gray-400">Nenhuma banca encontrada.</p>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
            {metaInsightsPeriod === 'custom' && (
              <>
                <div>
                  <label className="block text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">De</label>
                  <input
                    type="date"
                    value={metaInsightsCustomFrom}
                    onChange={(e) => {
                      setMetaInsightsCustomFrom(e.target.value);
                      setOverviewPage(1);
                    }}
                    className="px-3 py-2 border border-gray-200 dark:border-[#404040] rounded-xl text-sm text-gray-800 dark:text-gray-100 bg-white dark:bg-[#2a2a2a]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">Até</label>
                  <input
                    type="date"
                    value={metaInsightsCustomTo}
                    onChange={(e) => {
                      setMetaInsightsCustomTo(e.target.value);
                      setOverviewPage(1);
                    }}
                    className="px-3 py-2 border border-gray-200 dark:border-[#404040] rounded-xl text-sm text-gray-800 dark:text-gray-100 bg-white dark:bg-[#2a2a2a]"
                  />
                </div>
              </>
            )}
            <label className="flex items-center gap-2 cursor-pointer select-none max-w-[220px] pt-6 md:pt-0 md:items-end md:pb-0.5">
              <input
                type="checkbox"
                checked={allCampaignsShowInactive}
                onChange={(e) => {
                  setAllCampaignsShowInactive(e.target.checked);
                  setOverviewPage(1);
                  setAllCampaignsPage(1);
                }}
                className="rounded border-gray-300 dark:border-gray-600 text-[#8CD955] focus:ring-[#8CD955] shrink-0 bg-white dark:bg-[#2a2a2a]"
              />
              <span className="text-[11px] text-gray-700 dark:text-gray-300 leading-snug">
                <span className="font-semibold text-gray-600 dark:text-gray-400">Padrão do painel:</span> apenas campanhas ativas
                <span className="text-gray-500 dark:text-gray-500"> (marque para incluir pausadas)</span>
              </span>
            </label>
            <button
              type="button"
              onClick={() => {
                setNewIntegrationError(null);
                setNewIntegrationForm((f) => ({
                  ...f,
                  banca_ids: [],
                  base_url: 'https://graph.facebook.com/v25.0',
                  access_token: '',
                  ad_account_id: '',
                  pixel_id: '',
                  default_campaign_id: '',
                }));
                setNewIntegrationOpen(true);
              }}
              className="px-4 py-2 rounded-xl bg-[#8CD955] hover:bg-[#7BC84A] text-white font-medium"
            >
              Nova integração
            </button>
          </div>
        </div>

        {liveAggregateStreamProgress && liveAggregateStreamProgress.total > 0 ? (
          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-[#8CD955] shrink-0" />
            <span>
              Carregando integrações Meta em segundo plano: {liveAggregateStreamProgress.current}/
              {liveAggregateStreamProgress.total} — totais e tabela atualizam a cada lote.
            </span>
          </div>
        ) : null}
        {liveAggregateError ? (
          <div className="flex flex-wrap items-center gap-2 mb-1 text-xs text-gray-600 dark:text-gray-400">
            <span className="text-amber-700 dark:text-amber-400">Não foi possível atualizar agora. Exibindo dados salvos. {liveAggregateError}</span>
          </div>
        ) : null}

        <BancaXAdsRanking />

        <div className="space-y-4">
        <div className="grid gap-4 md:grid-cols-1 xl:grid-cols-3">
          {/* Card 1: Gasto em Anúncios */}
          <div className={`${metaCard} p-4`}>
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Gasto em Anúncios</p>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1 leading-snug">
              Total estimado pelo Meta Ads no período selecionado.
            </p>
            {metaSummaryCardsLoading ? (
              <div className="mt-3 flex items-center gap-2 text-gray-600 dark:text-gray-400 min-h-[2rem]">
                <Loader2 className="w-5 h-5 animate-spin text-[#8CD955] shrink-0" />
                <span className="text-sm">Carregando dados…</span>
              </div>
            ) : (
              <>
                <p className="text-2xl font-bold text-gray-900 dark:text-gray-50 mt-2 tabular-nums tracking-tight">
                  {formatBRL(metaSummaryCards.spendAll)}
                </p>
                {metaSummaryCards.spendBolao > 0 && (
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-2">
                    Bolão:{' '}
                    <span className="font-medium text-gray-700 dark:text-gray-300 tabular-nums">
                      {formatBRL(metaSummaryCards.spendBolao)}
                    </span>
                  </p>
                )}
                {(metaSummaryCards.resultsNormal > 0 || metaSummaryCards.resultsBolao > 0) && (
                  <div className="mt-3 pt-3 border-t border-gray-100 dark:border-[#333] flex gap-5">
                    <div>
                      <p className="text-[10px] font-medium text-gray-400 dark:text-gray-500 uppercase">Resultados Normal</p>
                      <p className="text-sm font-bold text-gray-900 dark:text-gray-50 tabular-nums">
                        {metaSummaryCards.resultsNormal.toLocaleString('pt-BR')}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] font-medium text-gray-400 dark:text-gray-500 uppercase">Resultados Bolão</p>
                      <p className="text-sm font-bold text-gray-900 dark:text-gray-50 tabular-nums">
                        {metaSummaryCards.resultsBolao.toLocaleString('pt-BR')}
                      </p>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Card 2: Cobrado no Cartão */}
          <div className={`${metaCard} p-4`}>
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide min-w-0">
                Cobrado no Cartão
              </p>
              {usingLiveMetaCards && liveAggregate?.billing ? (
                <div className="flex flex-col items-end gap-0.5 shrink-0 min-w-0">
                  <span className="text-[10px] text-gray-500 dark:text-gray-400 whitespace-nowrap">
                    Imposto s/ Meta
                  </span>
                  {cardChargeTaxUiCustom ? (
                    <div className="flex items-center gap-1">
                      <span className="inline-flex items-center rounded-md border border-gray-200 dark:border-[#404040] bg-white dark:bg-[#2a2a2a] px-1.5 py-0.5">
                        <input
                          type="text"
                          inputMode="decimal"
                          autoComplete="off"
                          value={cardChargeTaxInput}
                          onChange={(e) => setCardChargeTaxInput(e.target.value)}
                          onBlur={commitCardChargeTaxInput}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              (e.target as HTMLInputElement).blur();
                            }
                            if (e.key === 'Escape') {
                              setCardChargeTaxInput(formatCardTaxPercentForInput(cardChargeTaxPercent));
                              setCardChargeTaxUiCustom(isCardChargeTaxPreset(cardChargeTaxPercent));
                            }
                          }}
                          placeholder="12,15"
                          title="Digite o percentual (vírgula ou ponto). Enter confirma. Entre 0% e 50%."
                          className="w-[3.5rem] border-0 bg-transparent text-[11px] font-semibold text-gray-800 dark:text-gray-100 tabular-nums focus:outline-none [appearance:textfield]"
                          aria-label="Percentual personalizado de imposto"
                        />
                        <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">%</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          commitCardChargeTaxInput();
                          setCardChargeTaxUiCustom(false);
                        }}
                        className="text-[10px] font-medium text-[#5a9e38] dark:text-[#8CD955] hover:underline whitespace-nowrap"
                        title="Voltar à lista (valores fora da lista aparecem como «Outro valor»)"
                      >
                        Lista
                      </button>
                    </div>
                  ) : (
                    <select
                      value={
                        isCardChargeTaxPreset(cardChargeTaxPercent)
                          ? String(cardChargeTaxPercent)
                          : CARD_CHARGE_TAX_CUSTOM_OPTION
                      }
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === CARD_CHARGE_TAX_CUSTOM_OPTION) {
                          setCardChargeTaxInput(formatCardTaxPercentForInput(cardChargeTaxPercent));
                          setCardChargeTaxUiCustom(true);
                          return;
                        }
                        setCardChargeTaxPercent(parseCardChargeTaxPct(v));
                        setCardChargeTaxInput(formatCardTaxPercentForInput(parseCardChargeTaxPct(v)));
                        setCardChargeTaxUiCustom(false);
                      }}
                      title="Percentual somado ao valor cobrado pela Meta. Escolha «Outro valor» para digitar (ex.: 12,15 ou 13,8)."
                      className="max-w-[7.5rem] rounded-md border border-gray-200 dark:border-[#404040] bg-white dark:bg-[#2a2a2a] pl-2 pr-7 py-1 text-[11px] font-semibold text-gray-800 dark:text-gray-100 cursor-pointer"
                      aria-label="Percentual de imposto sobre cobrança no cartão"
                    >
                      {CARD_CHARGE_TAX_PRESETS.map((pct) => (
                        <option key={pct} value={String(pct)}>
                          {formatCardTaxPercentLabel(pct)}
                        </option>
                      ))}
                      <option value={CARD_CHARGE_TAX_CUSTOM_OPTION}>Outro valor…</option>
                    </select>
                  )}
                </div>
              ) : null}
            </div>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1 leading-snug">
              Débitos reais no cartão pela Meta no período. O total em destaque inclui o imposto selecionado ao lado.
            </p>
            {metaSummaryCardsLoading ? (
              <div className="mt-3 flex items-center gap-2 text-gray-600 dark:text-gray-400 min-h-[2rem]">
                <Loader2 className="w-5 h-5 animate-spin text-[#8CD955] shrink-0" />
                <span className="text-sm">Carregando dados…</span>
              </div>
            ) : usingLiveMetaCards && liveAggregate?.billing ? (
              <>
                <p className="text-2xl font-bold text-gray-900 dark:text-gray-50 mt-2 tabular-nums tracking-tight">
                  {formatBRL(cobradoCartaoComImposto.totalBrl)}
                </p>
                {cobradoCartaoComImposto.baseUsd > 0 ? (
                  <p className="text-[11px] font-medium text-amber-700 dark:text-amber-300 mt-1 tabular-nums">
                    {formatMoneyByCurrency(cobradoCartaoComImposto.totalUsd, 'USD')}
                    <span className="font-normal text-gray-500 dark:text-gray-400 ml-1">(contas USD, c/ imposto)</span>
                  </p>
                ) : null}
                {cobradoCartaoComImposto.baseBrl > 0 || cobradoCartaoComImposto.baseUsd > 0 ? (
                  <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1.5 leading-snug tabular-nums">
                    Base Meta{' '}
                    <span className="font-medium text-gray-700 dark:text-gray-300">
                      {formatBRL(cobradoCartaoComImposto.baseBrl)}
                    </span>
                    {cobradoCartaoComImposto.baseUsd > 0 ? (
                      <>
                        {' · '}
                        <span className="font-medium text-amber-800/90 dark:text-amber-200/90">
                          {formatMoneyByCurrency(cobradoCartaoComImposto.baseUsd, 'USD')}
                        </span>
                      </>
                    ) : null}
                    <span className="text-gray-400 dark:text-gray-500"> · </span>
                    +{formatCardTaxPercentLabel(cardChargeTaxPercent)} → imposto{' '}
                    <span className="font-medium text-gray-700 dark:text-gray-300">
                      {formatBRL(cobradoCartaoComImposto.taxBrl)}
                    </span>
                    {cobradoCartaoComImposto.taxUsd > 0 ? (
                      <>
                        {' · '}
                        <span className="font-medium text-amber-800/90 dark:text-amber-200/90">
                          {formatMoneyByCurrency(cobradoCartaoComImposto.taxUsd, 'USD')}
                        </span>
                      </>
                    ) : null}
                  </p>
                ) : null}
                <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
                  {liveCardChargesCount > 0
                    ? `${liveCardChargesCount} ${liveCardChargesCount === 1 ? 'cobrança' : 'cobranças'} no período`
                    : 'Sem cobranças no período.'}
                </p>
                {(liveCardChargesCountWindow > liveCardChargesCount || liveLatestCharge) ? (
                  <p
                    className="text-[11px] text-gray-500 dark:text-gray-400 mt-1"
                    title="Histórico dos últimos 90 dias (valores com o mesmo imposto selecionado)."
                  >
                    Últimos 90d:{' '}
                    <span className="font-medium text-gray-700 dark:text-gray-300 tabular-nums">
                      {formatBRL(cobradoCartaoComImposto.windowTotalBrl)}
                    </span>
                    {liveCardChargesWindowUsdComponent > 0 ? (
                      <>
                        {' · '}
                        <span className="font-medium text-amber-700 dark:text-amber-300 tabular-nums">
                          {formatMoneyByCurrency(cobradoCartaoComImposto.windowTotalUsd, 'USD')}
                        </span>
                      </>
                    ) : null}
                    {liveCardChargesCountWindow > 0
                      ? ` · ${liveCardChargesCountWindow} ${liveCardChargesCountWindow === 1 ? 'cobrança' : 'cobranças'}`
                      : ''}
                    {latestChargeTaxed ? (
                      <>
                        {' · Última: '}
                        {latestChargeTaxed.currency === 'USD' ? (
                          <>
                            <span className="font-medium text-gray-700 dark:text-gray-300 tabular-nums">
                              {formatMoneyByCurrency(latestChargeTaxed.amount, 'USD')}
                            </span>
                            {latestChargeTaxed.amount_brl != null ? (
                              <>
                                {' ≈ '}
                                <span className="font-medium text-gray-700 dark:text-gray-300 tabular-nums">
                                  {formatBRL(latestChargeTaxed.amount_brl)}
                                </span>
                              </>
                            ) : null}
                          </>
                        ) : (
                          <span className="font-medium text-gray-700 dark:text-gray-300 tabular-nums">
                            {formatBRL(latestChargeTaxed.amount_brl ?? latestChargeTaxed.amount)}
                          </span>
                        )}
                        {' em '}
                        {latestChargeTaxed.label}
                      </>
                    ) : null}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-3 italic">
                Disponível ao selecionar uma banca com dados ao vivo.
              </p>
            )}
          </div>

          {/* Card 3: A Pagar */}
          <div className={`${metaCard} p-4`}>
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">A Pagar</p>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1 leading-snug">
              Gasto acumulado ainda não cobrado no cartão. Será debitado ao atingir o próximo limite.
            </p>
            {metaSummaryCardsLoading ? (
              <div className="mt-3 flex items-center gap-2 text-gray-600 dark:text-gray-400 min-h-[2rem]">
                <Loader2 className="w-5 h-5 animate-spin text-[#8CD955] shrink-0" />
                <span className="text-sm">Carregando dados…</span>
              </div>
            ) : usingLiveMetaCards && liveAggregate?.billing ? (
              <>
                <p className="text-2xl font-bold text-gray-900 dark:text-gray-50 mt-2 tabular-nums tracking-tight">
                  {formatBRL(metaSummaryCards.billingDue)}
                </p>
                {liveBillingAccountsLabel ? (
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">{liveBillingAccountsLabel}</p>
                ) : null}
              </>
            ) : (
              <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-3 italic">
                Disponível ao selecionar uma banca com dados ao vivo.
              </p>
            )}
          </div>
        </div>
        </div>

        <div
          id="dados-sincronizados-section"
          className={`${metaCard} p-4 md:p-6 ring-1 ring-[#8CD955]/25 dark:ring-[#6AAE39]/35 shadow-md dark:shadow-black/30`}
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-5">
            <div className="min-w-0">
              <h3 className="text-lg font-bold text-gray-900 dark:text-gray-50 tracking-tight">
                Métricas de Campanhas
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                Campanhas de <span className="font-semibold text-gray-800 dark:text-gray-200">todas as integrações Meta</span>{' '}
                {scopedMetaBancaFilter ? (
                  <span className="text-gray-500 dark:text-gray-500">(banca filtrada no painel)</span>
                ) : null}
                . Métricas de alcance, cliques e spend estimado vêm da <span className="font-semibold text-emerald-700 dark:text-emerald-400">Meta em tempo real</span> quando o carregamento ao vivo conclui; o cache local complementa tipo, consultores e vínculos.
                {!scopedMetaBancaFilter ? (
                  <span className="block sm:inline sm:before:content-[' '] mt-1 sm:mt-0 text-gray-500 dark:text-gray-500">
                    Cada ID de campanha Meta aparece no máximo uma vez: se houver duplicidade entre bancas no CRM, mantemos a linha com <span className="font-medium text-gray-600 dark:text-gray-400">atualização mais recente</span> (em empate, maior spend estimado no período).
                  </span>
                ) : null}
              </p>
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <span className="text-xs text-gray-500 dark:text-gray-400">Período: {adminMetaInsightsDateRange.label}</span>
                {usingLiveMetaCards ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 dark:bg-emerald-950/80 px-2.5 py-0.5 text-[11px] font-semibold uppercase text-emerald-800 dark:text-emerald-300 border border-emerald-200/80 dark:border-emerald-800">
                    <Radio className="w-3 h-3 shrink-0 animate-pulse" />
                    Ao vivo · Meta API
                  </span>
                ) : null}
                {!usingLiveMetaCards ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 dark:bg-[#333] px-2.5 py-0.5 text-[11px] font-semibold uppercase text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-[#404040]">
                    Cache CRM / aguardando Meta
                  </span>
                ) : null}
                {usingLiveMetaCards && liveAggregate?.billing ? (
                  <>
                    <span
                      className="inline-flex items-center gap-1 rounded-full bg-rose-100 dark:bg-rose-950/70 px-2.5 py-0.5 text-[11px] font-semibold uppercase text-rose-900 dark:text-rose-300 border border-rose-200/80 dark:border-rose-800"
                      title={`Total no cartão em BRL (e USD bruto) com imposto ${formatCardTaxPercentLabel(cardChargeTaxPercent)} sobre o valor Meta.`}
                    >
                      <DollarSign className="w-3 h-3 shrink-0" />
                      Cobrado no cartão: {formatBRL(cobradoCartaoComImposto.totalBrl)}
                      {liveCardChargesUsdComponent > 0
                        ? ` · ${formatMoneyByCurrency(cobradoCartaoComImposto.totalUsd, 'USD')}`
                        : ''}
                      {liveCardChargesCount > 0
                        ? ` · ${liveCardChargesCount} ${liveCardChargesCount === 1 ? 'cobrança' : 'cobranças'}`
                        : ''}
                    </span>
                    <span
                      className="inline-flex items-center gap-1 rounded-full bg-amber-100 dark:bg-amber-950/70 px-2.5 py-0.5 text-[11px] font-semibold uppercase text-amber-900 dark:text-amber-300 border border-amber-200/80 dark:border-amber-800"
                      title="Gasto acumulado ainda não cobrado no cartão."
                    >
                      <DollarSign className="w-3 h-3 shrink-0" />
                      A pagar: {formatBRL(liveBillingDue)}
                      {liveBillingAccountsLabel ? ` · ${liveBillingAccountsLabel}` : ''}
                    </span>
                  </>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 dark:bg-amber-950/40 px-2.5 py-0.5 text-[11px] font-semibold uppercase text-amber-700 dark:text-amber-400 border border-amber-200/70 dark:border-amber-900">
                    <DollarSign className="w-3 h-3 shrink-0" />
                    Billing Meta aguardando
                  </span>
                )}
                {liveMetricsUpdatedAt ? (
                  <span className="text-[11px] text-gray-500 dark:text-gray-500">
                    Atualizado {liveMetricsUpdatedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                ) : null}
                {loadingLiveAggregate ? (
                  <span className="text-[11px] text-amber-700 dark:text-amber-400 flex items-center gap-1">
                    <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                    Sincronizando integrações com a Meta…
                  </span>
                ) : null}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => {
                  const first = (orderedDisplayMetricCampaignRows || [])[0] as
                    | { banca_id?: unknown; campaign_id?: unknown }
                    | undefined;
                  if (first) {
                    setConsultorModalCampaignKey(`${String(first.banca_id)}:${String(first.campaign_id)}`);
                  }
                  setConsultorModalOpen(true);
                }}
                disabled={orderedDisplayMetricCampaignRows.length === 0}
                className="text-sm text-blue-700 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium flex items-center gap-1 disabled:opacity-40"
              >
                <Users className="w-4 h-4" />
                Atribuir consultores
              </button>
              <button
                type="button"
                onClick={() => void loadLiveAggregate()}
                disabled={loadingLiveAggregate || !userId}
                className="text-sm text-emerald-700 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-300 font-medium flex items-center gap-1 disabled:opacity-50"
              >
                {loadingLiveAggregate ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                Atualizar na Meta
              </button>
              <button
                onClick={() => loadSyncedData()}
                disabled={loadingData}
                className="text-sm text-[#8CD955] hover:text-[#7BC84A] font-medium flex items-center gap-1 disabled:opacity-50"
              >
                {loadingData ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                Cache local
              </button>
            </div>
          </div>

          <div className="space-y-4">
            {/* Erro silencioso de campaigns-all (ex.: migration pendente) */}
            {allCampaignsError && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-300 dark:border-amber-600 bg-amber-50 dark:bg-amber-950/40 px-4 py-3 text-xs text-amber-800 dark:text-amber-300">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span><strong>Erro ao carregar campanhas do banco:</strong> {allCampaignsError}</span>
              </div>
            )}
            {/* Tabela de campanhas — sempre visível, não depende de banca específica */}
            {crmCampaignsBlockLoading ? (
              <div className="py-8 flex justify-center">
                <Loader2 className="w-6 h-6 animate-spin text-[#8CD955]" />
              </div>
            ) : (
                  <div className="border-2 border-gray-200 dark:border-[#404040] rounded-xl overflow-hidden bg-white/50 dark:bg-[#1f1f1f]/50">
                    <button
                      onClick={() => setExpandedTab(expandedTab === 'campaigns' ? null : 'campaigns')}
                      className="w-full flex items-center justify-between px-4 py-3.5 bg-gradient-to-r from-[#F1FAE8] to-gray-50 dark:from-emerald-950/40 dark:to-[#2a2a2a] hover:from-[#E8F5DC] hover:to-gray-100 dark:hover:from-emerald-950/55 dark:hover:to-[#333] transition text-gray-800 dark:text-gray-100 border-b border-gray-200/80 dark:border-[#383838]"
                    >
                      <span className="flex flex-col items-start gap-0.5 sm:flex-row sm:items-center sm:gap-2 text-left">
                        <span className="flex items-center gap-2 font-bold text-base text-gray-900 dark:text-white">
                          <Target className="w-5 h-5 text-[#8CD955] shrink-0" />
                          Campanhas
                        </span>
                        <span className="text-xs font-normal text-gray-600 dark:text-gray-400 sm:pl-1">
                          {orderedDisplayMetricCampaignRows.length} no período · todas as contas / integrações no stream ao vivo
                        </span>
                      </span>
                      {expandedTab === 'campaigns' ? <ChevronUp className="w-5 h-5 shrink-0" /> : <ChevronDown className="w-5 h-5 shrink-0" />}
                    </button>
                    {expandedTab === 'campaigns' && (
                      <div className="overflow-x-auto max-h-[min(72vh,920px)] overflow-y-auto">
                        <table className="w-full text-xs sm:text-sm text-left min-w-[1720px] xl:min-w-[2600px] text-gray-800 dark:text-gray-200">
                          <thead className="bg-gray-100 dark:bg-[#2a2a2a] text-gray-700 dark:text-gray-200 sticky top-0 z-10 shadow-sm">
                            <tr>
                              <th className="px-4 py-2.5">Início</th>
                              <th
                                className="px-4 py-2 min-w-[200px]"
                                title="Consultores do card Ads (Meu Desempenho): seleção manual; mais os do redirect quando a campanha tem projeto vinculado (grupos do redirect). Badges «Redirect» / «Manual». Sem seleção manual = regra automática de spend (vínculos + redirect)."
                              >
                                Consultores · card Ads
                              </th>
                              <th className="px-4 py-2.5">Gestor</th>
                              <th className="px-4 py-2.5">Banca</th>
                              <th className="px-4 py-2.5 min-w-[220px]">Campanha</th>
                              <th className="px-4 py-2 text-right">Gasto na Campanha</th>
                              <th className="px-4 py-2">Tipo</th>
                              <th
                                className="px-4 py-2"
                                title="Moeda da Ad Account na Meta. Valores em USD são convertidos para BRL na cotação atual para somar nos totais."
                              >
                                Moeda
                              </th>
                              <th className="px-4 py-2 text-right">Reach</th>
                              <th className="px-4 py-2 text-right">Impressões</th>
                              <th className="px-4 py-2 text-right">Cliques</th>
                              <th className="px-4 py-2 text-right">Leads</th>
                              <th className="px-4 py-2 text-right">Resultados</th>
                              <th className="px-4 py-2 text-right">Leads consultores</th>
                              <th className="px-4 py-2 text-right">Orçamento diário</th>
                              <th
                                className="px-4 py-2"
                                title="redirect_slugs dos projetos cujo owner_user_id é um dos gestores da banca (agregado por perfil gestor, não por banca)."
                              >
                                Redirect
                              </th>
                              <th className="px-4 py-2">Atribuir banca</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100 dark:divide-[#383838]">
                            {orderedDisplayMetricCampaignRows.map((c: any, rowIndex: number) => {
                              const stableKeyForCurrency = metaCampaignStableKey(c);
                              const rawCurrency = String(c.currency ?? '').trim().toUpperCase();
                              const rowCurrency = rawCurrency || 'BRL';
                              const isForeignCurrency = rowCurrency !== 'BRL';
                              const m = {
                                reach: Number(c.reach) || 0,
                                impressions: Number(c.impressions) || 0,
                                clicks: Number(c.clicks) || 0,
                                leads: Number(c.leads) || 0,
                                spend: Number(c.spend) || 0,
                                spend_brl: Number.isFinite(Number(c.spend_brl))
                                  ? Number(c.spend_brl)
                                  : Number(c.spend) || 0,
                                results: Number(c.results_live) || 0,
                              };
                              const eff = String(c.effective_status || c.status || '').toUpperCase();
                              const isActiveCampaign = eff === 'ACTIVE';
                              const ownerKey = `${String(c.banca_id)}:${String(c.campaign_id)}`;
                              const sourceBancaId = String(c.banca_id ?? '').trim();
                              const integrationId = String(c.integration_id ?? '').trim();
                              const allowedOwnerTargetIds =
                                (integrationId && ownerTargetBancaIdsByIntegration.get(integrationId)) ||
                                ownerSafeTargetBancaIdsBySourceBanca.get(sourceBancaId) ||
                                ownerTargetBancaIdsBySourceBanca.get(sourceBancaId) ||
                                [];
                              const ownerOptions =
                                allowedOwnerTargetIds.length > 0
                                  ? bancas.filter((b) => allowedOwnerTargetIds.includes(String(b.id)))
                                  : bancas.filter((b) => String(b.id) === sourceBancaId);
                              const ownerTargetRaw = campaignOwnerDraft[ownerKey] ?? sourceBancaId;
                              const ownerTarget = ownerOptions.some((b) => String(b.id) === String(ownerTargetRaw))
                                ? ownerTargetRaw
                                : sourceBancaId;
                              const currentRedirectProject = c.redirect_project as
                                | { id?: string; name?: string | null; slug?: string | null }
                                | null
                                | undefined;
                              const gestorIdsForRedirect = Array.isArray(
                                (c as { gestor_user_ids?: unknown }).gestor_user_ids
                              )
                                ? ((c as { gestor_user_ids: string[] }).gestor_user_ids ?? [])
                                    .map((x) => String(x ?? '').trim())
                                    .filter(Boolean)
                                : [];
                              const redirectOptsByKey = new Map<
                                string,
                                {
                                  project_id: string;
                                  owner_user_id: string | null;
                                  redirect_slug_id: string | null;
                                  slug: string;
                                  project_name: string | null;
                                  project_slug: string | null;
                                }
                              >();
                              for (const gid of gestorIdsForRedirect) {
                                for (const o of redirectSlugOptionsByOwner[gid] ?? []) {
                                  const k = `${o.project_id}::${o.slug}`;
                                  if (!redirectOptsByKey.has(k)) redirectOptsByKey.set(k, o);
                                }
                              }
                              const baseRedirectOptions = Array.from(redirectOptsByKey.values()).sort((a, b) => {
                                const na = `${a.project_name ?? ''} ${a.slug}`.toLocaleLowerCase('pt-BR');
                                const nb = `${b.project_name ?? ''} ${b.slug}`.toLocaleLowerCase('pt-BR');
                                return na.localeCompare(nb, 'pt-BR');
                              });
                              const assignedRedirectId = c.redirect_project_id ? String(c.redirect_project_id) : '';
                              const assignedInBase = baseRedirectOptions.some(
                                (r) => String(r.project_id) === assignedRedirectId
                              );
                              const redirectOptions =
                                currentRedirectProject?.id && !assignedInBase
                                  ? [
                                      ...baseRedirectOptions,
                                      {
                                        project_id: String(currentRedirectProject.id),
                                        owner_user_id: null,
                                        redirect_slug_id: null,
                                        slug: String(
                                          currentRedirectProject.slug ?? currentRedirectProject.id
                                        ),
                                        project_name: currentRedirectProject.name ?? null,
                                        project_slug: currentRedirectProject.slug ?? null,
                                      },
                                    ]
                                  : baseRedirectOptions;
                              const redirectTargetRaw =
                                campaignRedirectDraft[ownerKey] ??
                                (c.redirect_project_id ? String(c.redirect_project_id) : '');
                              const redirectTarget = redirectOptions.some(
                                (r) => String(r.project_id) === String(redirectTargetRaw)
                              )
                                ? String(redirectTargetRaw)
                                : '';
                              const firstRedirectOpt = redirectOptions.find(
                                (o) => String(o.project_id) === redirectTarget
                              );
                              const redirectSelectComposite = firstRedirectOpt
                                ? `${firstRedirectOpt.project_id}::${firstRedirectOpt.slug}`
                                : '';
                              /** Não usar só campaign_id / id do CRM: a mesma campanha pode vir de 2 integrações Meta. */
                              const rowKey = [
                                rowIndex,
                                String(c.banca_id ?? ''),
                                String(c.campaign_id ?? ''),
                                c.integration_id != null ? String(c.integration_id) : '',
                                c.ad_account_id != null ? String(c.ad_account_id) : '',
                              ].join(':');
                              const rowClass =
                                isActiveCampaign && usingLiveMetaCards
                                  ? 'bg-emerald-50/80 dark:bg-emerald-950/30 border-l-4 border-l-emerald-500'
                                  : isActiveCampaign
                                    ? 'bg-emerald-50/50 dark:bg-emerald-950/20 border-l-2 border-l-emerald-400'
                                    : 'hover:bg-gray-50 dark:hover:bg-[#2a2a2a]/80';
                              const bancaKeyAds = String(c.banca_id ?? '');
                              const rawAdsConsultors = consultorsByBanca[bancaKeyAds] || [];
                              const adsPickKey = `${bancaKeyAds}:${String(c.campaign_id)}`;
                              const adsIdsFromRow = (() => {
                                const ids = (c as { ads_attribution_consultor_ids?: string[] | null })
                                  .ads_attribution_consultor_ids;
                                if (Array.isArray(ids) && ids.length > 0) {
                                  return Array.from(
                                    new Set(ids.map((x) => String(x ?? '').trim()).filter((s) => s.length > 0))
                                  );
                                }
                                const one = (c as { ads_attribution_consultor_id?: string | null })
                                  .ads_attribution_consultor_id;
                                return one ? [String(one)] : [];
                              })();
                              const adsSelectedIds =
                                campaignAdsAttributionDraft[adsPickKey] ?? adsIdsFromRow;
                              const adsFilterQuery = (consultorAdsFilterByBanca[bancaKeyAds] || '').trim().toLowerCase();
                              let adsConsultorOptionsForSelect = adsFilterQuery
                                ? rawAdsConsultors.filter((co) => {
                                    const label = `${co.full_name || ''} ${co.email || ''}`.toLowerCase();
                                    return label.includes(adsFilterQuery);
                                  })
                                : rawAdsConsultors;
                              for (const sid of adsSelectedIds) {
                                const selCo = rawAdsConsultors.find((co) => co.id === sid);
                                if (
                                  selCo &&
                                  !adsConsultorOptionsForSelect.some((co) => co.id === sid)
                                ) {
                                  adsConsultorOptionsForSelect = [selCo, ...adsConsultorOptionsForSelect];
                                }
                              }
                              const isAdsDropdownOpen = openAdsDropdownKey === adsPickKey;
                              const assignedForAdsRow = Array.isArray(
                                (c as { assigned_consultors?: unknown }).assigned_consultors
                              )
                                ? ((c as { assigned_consultors: any[] }).assigned_consultors ?? [])
                                : [];
                              const fromRedirectVinculo = assignedForAdsRow.filter(
                                (ac: Record<string, unknown>) => Boolean(ac?.redirect_from_linked_project)
                              );
                              const redirectVinculoById = new Map<string, Record<string, unknown>>(
                                fromRedirectVinculo.map((ac: Record<string, unknown>) => [
                                  String(ac?.id ?? '').trim(),
                                  ac,
                                ])
                              );
                              const redirectVinculoIdSet = new Set(
                                [...redirectVinculoById.keys()].filter((id) => id.length > 0)
                              );
                              const hasRedirectVinculoChips = redirectVinculoIdSet.size > 0;
                              return (
                                <tr key={rowKey} className={rowClass}>
                                  <td className="px-4 py-2 text-gray-700 dark:text-white">{c.start_time ? formatDate(c.start_time) : '-'}</td>
                                  <td className="px-4 py-2 align-top">
                                    {c.banca_id ? (
                                      <div data-ads-dropdown className="relative flex flex-col gap-1 min-w-[200px] max-w-[260px]">
                                        {/* Chips + toggle button row */}
                                        <div
                                          className="flex flex-wrap items-center gap-1 cursor-pointer"
                                          onClick={() => setOpenAdsDropdownKey(isAdsDropdownOpen ? null : adsPickKey)}
                                        >
                                          {hasRedirectVinculoChips
                                            ? [...redirectVinculoIdSet].map((sid) => {
                                                const ac = redirectVinculoById.get(sid);
                                                const selCo = rawAdsConsultors.find((co) => co.id === sid);
                                                const pick = (u: unknown) => (typeof u === 'string' ? u.trim() : '');
                                                const name =
                                                  pick(ac?.full_name) ||
                                                  pick(ac?.email) ||
                                                  selCo?.full_name ||
                                                  selCo?.email ||
                                                  sid;
                                                const isAlsoManual = adsSelectedIds.includes(sid);
                                                return (
                                                  <span
                                                    key={`rv-${sid}`}
                                                    className={`inline-flex items-center gap-1 rounded-full text-[10px] font-medium px-2 py-0.5 leading-tight max-w-full border ${
                                                      isAlsoManual
                                                        ? 'bg-indigo-50 dark:bg-indigo-900/40 text-indigo-900 dark:text-indigo-100 border-emerald-400/70 dark:border-emerald-600/50'
                                                        : 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-900 dark:text-emerald-200 border-emerald-300/60 dark:border-emerald-700/50'
                                                    }`}
                                                  >
                                                    <span className="truncate max-w-[130px]">{name}</span>
                                                    <span
                                                      className={`shrink-0 rounded px-1 py-0 text-[8px] font-bold uppercase tracking-wide ${
                                                        isAlsoManual
                                                          ? 'bg-emerald-200/90 dark:bg-emerald-800/60 text-emerald-900 dark:text-emerald-100'
                                                          : 'bg-emerald-200/90 dark:bg-emerald-800/50 text-emerald-900 dark:text-emerald-100'
                                                      }`}
                                                      title="Consultor dos grupos do projeto de redirect vinculado a esta campanha (coluna Redirect)."
                                                    >
                                                      {isAlsoManual ? 'Redirect + manual' : 'Redirect'}
                                                    </span>
                                                    {isAlsoManual ? (
                                                      <button
                                                        type="button"
                                                        disabled={campaignAdsAttributionSavingKey === adsPickKey}
                                                        className="shrink-0 opacity-60 hover:opacity-100 disabled:pointer-events-none"
                                                        onClick={(e) => {
                                                          e.stopPropagation();
                                                          const next = adsSelectedIds.filter((id) => id !== sid);
                                                          setCampaignAdsAttributionDraft((prev) => ({
                                                            ...prev,
                                                            [adsPickKey]: next,
                                                          }));
                                                          void handleSaveCampaignAdsAttribution(
                                                            String(c.banca_id),
                                                            String(c.campaign_id),
                                                            next,
                                                            c.name ?? null
                                                          );
                                                        }}
                                                      >
                                                        ×
                                                      </button>
                                                    ) : null}
                                                  </span>
                                                );
                                              })
                                            : null}
                                          {adsSelectedIds
                                            .filter((sid) => !redirectVinculoIdSet.has(sid))
                                            .map((sid) => {
                                              const selCo = rawAdsConsultors.find((co) => co.id === sid);
                                              const name = selCo?.full_name || selCo?.email || sid;
                                              return (
                                                <span
                                                  key={`m-${sid}`}
                                                  className="inline-flex items-center gap-1 rounded-full bg-indigo-100 dark:bg-indigo-900/50 text-indigo-800 dark:text-indigo-200 text-[10px] font-medium px-2 py-0.5 leading-tight max-w-full"
                                                >
                                                  <span className="truncate max-w-[130px]">{name}</span>
                                                  <span
                                                    className="shrink-0 rounded px-1 py-0 text-[8px] font-bold uppercase tracking-wide bg-indigo-200/90 dark:bg-indigo-800/60 text-indigo-900 dark:text-indigo-100"
                                                    title="Seleção explícita no card Ads (Meu Desempenho)."
                                                  >
                                                    Manual
                                                  </span>
                                                  <button
                                                    type="button"
                                                    disabled={campaignAdsAttributionSavingKey === adsPickKey}
                                                    className="shrink-0 opacity-60 hover:opacity-100 disabled:pointer-events-none"
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      const next = adsSelectedIds.filter((id) => id !== sid);
                                                      setCampaignAdsAttributionDraft((prev) => ({
                                                        ...prev,
                                                        [adsPickKey]: next,
                                                      }));
                                                      void handleSaveCampaignAdsAttribution(
                                                        String(c.banca_id),
                                                        String(c.campaign_id),
                                                        next,
                                                        c.name ?? null
                                                      );
                                                    }}
                                                  >
                                                    ×
                                                  </button>
                                                </span>
                                              );
                                            })}
                                          {adsSelectedIds.length === 0 && !hasRedirectVinculoChips ? (
                                            <span className="text-[10px] text-gray-400 dark:text-gray-500 italic">
                                              Automático (vínculos)
                                            </span>
                                          ) : null}
                                          {adsSelectedIds.length === 0 && hasRedirectVinculoChips ? (
                                            <span
                                              className="text-[9px] text-gray-500 dark:text-gray-400 italic max-w-[200px] leading-tight"
                                              title="Nenhum consultor marcado manualmente no card Ads; o spend no Meu Desempenho segue a regra automática (vínculos + redirect)."
                                            >
                                              Sem seleção manual no card Ads
                                            </span>
                                          ) : null}
                                          {/* Chevron toggle */}
                                          <span className="ml-auto shrink-0 text-gray-400 dark:text-gray-500 text-[10px] select-none">
                                            {isAdsDropdownOpen ? '▲' : '▼'}
                                          </span>
                                        </div>
                                        {/* Collapsible dropdown */}
                                        {isAdsDropdownOpen && (
                                          <div className="absolute top-full left-0 z-50 mt-1 w-64 rounded-lg border border-gray-200 dark:border-[#404040] bg-white dark:bg-[#2a2a2a] shadow-lg p-1.5 space-y-1">
                                            {/* Filter input */}
                                            {rawAdsConsultors.length > 4 ? (
                                              <input
                                                type="search"
                                                autoFocus
                                                placeholder="Filtrar nome ou e-mail…"
                                                value={consultorAdsFilterByBanca[bancaKeyAds] ?? ''}
                                                onChange={(e) =>
                                                  setConsultorAdsFilterByBanca((prev) => ({
                                                    ...prev,
                                                    [bancaKeyAds]: e.target.value,
                                                  }))
                                                }
                                                onClick={(e) => e.stopPropagation()}
                                                className="w-full px-2 py-1 rounded-md border border-gray-200 dark:border-[#404040] text-[11px] text-gray-800 dark:text-gray-100 bg-white dark:bg-[#2a2a2a]"
                                              />
                                            ) : null}
                                            {/* Checkbox list */}
                                            <div
                                              title="Spend Meta no Meu Desempenho: consultores marcados. «Automático» = sem marcação."
                                              className={`max-h-[min(220px,36vh)] overflow-y-auto space-y-0.5 ${campaignAdsAttributionSavingKey === adsPickKey ? 'opacity-50 pointer-events-none' : ''}`}
                                            >
                                              {adsConsultorOptionsForSelect.map((co) => {
                                                const checked = adsSelectedIds.includes(co.id);
                                                return (
                                                  <label
                                                    key={co.id}
                                                    className={`flex items-start gap-2 cursor-pointer rounded px-1 py-0.5 ${checked ? 'bg-indigo-50 dark:bg-indigo-900/30' : 'hover:bg-gray-50 dark:hover:bg-[#333]'}`}
                                                  >
                                                    <input
                                                      type="checkbox"
                                                      className="mt-0.5 shrink-0 accent-indigo-600"
                                                      checked={checked}
                                                      disabled={campaignAdsAttributionSavingKey === adsPickKey}
                                                      onChange={(e) => {
                                                        const next = e.target.checked
                                                          ? Array.from(new Set([...adsSelectedIds, co.id]))
                                                          : adsSelectedIds.filter((id) => id !== co.id);
                                                        setCampaignAdsAttributionDraft((prev) => ({
                                                          ...prev,
                                                          [adsPickKey]: next,
                                                        }));
                                                        void handleSaveCampaignAdsAttribution(
                                                          String(c.banca_id),
                                                          String(c.campaign_id),
                                                          next,
                                                          c.name ?? null
                                                        );
                                                      }}
                                                    />
                                                    <span className={`text-[11px] leading-tight ${checked ? 'text-indigo-800 dark:text-indigo-200 font-medium' : 'text-gray-700 dark:text-gray-300'}`}>
                                                      {co.full_name || co.email || co.id}
                                                    </span>
                                                  </label>
                                                );
                                              })}
                                            </div>
                                            {rawAdsConsultors.length === 0 ? (
                                              <p className="text-[10px] leading-snug text-amber-700 dark:text-amber-400">
                                                Nenhum perfil elegível na rede desta banca (consultor, gerente, admin, gestor ou
                                                super_admin — vínculo em user_bancas ou hierarquia enroller abaixo do
                                                dono/gestores). Ajuste vínculos ou cadastre em Admin › Hierarquia.
                                              </p>
                                            ) : null}
                                            {rawAdsConsultors.length > 0 &&
                                            adsFilterQuery &&
                                            adsConsultorOptionsForSelect.length === 0 ? (
                                              <p className="text-[10px] text-gray-500 dark:text-gray-400">
                                                Nenhum nome coincide com o filtro.
                                              </p>
                                            ) : null}
                                          </div>
                                        )}
                                      </div>
                                    ) : (
                                      <span className="text-gray-400">—</span>
                                    )}
                                  </td>
                                  <td className="px-4 py-2 text-xs text-gray-700 dark:text-gray-300">
                                    {Array.isArray(c.gestor_names) && c.gestor_names.length > 0 ? c.gestor_names.join(', ') : '—'}
                                  </td>
                                  <td className="px-4 py-2 text-xs text-gray-600 dark:text-gray-400">
                                    <p className="font-medium text-gray-900 dark:text-gray-50">{c.banca_name || c.banca_id}</p>
                                  </td>
                                  <td className="px-4 py-3 align-top">
                                    <div className="flex flex-col gap-1.5 max-w-md">
                                      {usingLiveMetaCards && isActiveCampaign ? (
                                        <span className="inline-flex w-fit items-center rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white shadow-sm">
                                          Ativa · tempo real
                                        </span>
                                      ) : isActiveCampaign ? (
                                        <span className="inline-flex w-fit items-center rounded-full bg-emerald-100 dark:bg-emerald-900/50 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-800 dark:text-emerald-200">
                                          Ativa
                                        </span>
                                      ) : null}
                                      <span className="text-base font-semibold text-gray-900 dark:text-gray-50 leading-snug">
                                        {c.name || c.campaign_id}
                                      </span>
                                    </div>
                                  </td>
                                  <td className="px-4 py-2 text-right text-gray-700 dark:text-white tabular-nums">
                                    <div className="flex flex-col items-end gap-0.5">
                                      <span
                                        className="font-medium"
                                        title={
                                          isForeignCurrency
                                            ? `Spend exibido em ${rowCurrency}. O valor bruto vem da Meta na moeda da conta (veja coluna Moeda / override).`
                                            : 'Valor em BRL.'
                                        }
                                      >
                                        {formatMoneyByCurrency(m.spend, rowCurrency)}
                                      </span>
                                      {isForeignCurrency ? (
                                        <span
                                          className="text-[11px] text-gray-500 dark:text-gray-400 tabular-nums"
                                          title={
                                            liveUsdBrlRate && rowCurrency === 'USD'
                                              ? `Equivalente em BRL com cotação USD→BRL ${liveUsdBrlRate.toFixed(4).replace('.', ',')} — usado na soma dos totais em R$.`
                                              : 'Valor convertido para BRL nos totais.'
                                          }
                                        >
                                          ≈ {formatBRL(m.spend_brl)}
                                          {liveUsdBrlRate && rowCurrency === 'USD' ? (
                                            <span className="ml-1 text-gray-400 dark:text-gray-500">
                                              (cot. {liveUsdBrlRate.toFixed(2).replace('.', ',')})
                                            </span>
                                          ) : null}
                                        </span>
                                      ) : null}
                                    </div>
                                  </td>
                                  <td className="px-4 py-2 align-top">
                                    {c.banca_id ? (
                                      <select
                                        value={(c.campaign_kind as MetaCampaignKind) || 'normal'}
                                        disabled={campaignKindSavingKey === `${String(c.banca_id)}:${String(c.campaign_id)}`}
                                        onChange={(e) => {
                                          const v = e.target.value as MetaCampaignKind;
                                          void handleSaveCampaignKind(
                                            String(c.banca_id),
                                            String(c.campaign_id),
                                            v,
                                            c.name
                                          );
                                        }}
                                        className="px-2 py-1 rounded-lg border border-gray-200 dark:border-[#404040] text-xs text-gray-800 dark:text-gray-100 bg-white dark:bg-[#2a2a2a] max-w-[140px] disabled:opacity-50"
                                      >
                                        <option value="normal">Normal</option>
                                        <option value="bolao">Bolão</option>
                                      </select>
                                    ) : (
                                      <span className="text-xs text-gray-500 dark:text-gray-400">—</span>
                                    )}
                                  </td>
                                  <td className="px-4 py-2 align-top">
                                    {(() => {
                                      const localPick = localMetaCurrencyByKey[stableKeyForCurrency];
                                      const accountNativeRaw = String(c.currency_account ?? '').trim().toUpperCase();
                                      const nativeSelect: 'BRL' | 'USD' =
                                        accountNativeRaw === 'USD' ? 'USD' : 'BRL';
                                      let selectValue: 'BRL' | 'USD';
                                      if (localPick === 'BRL' || localPick === 'USD') {
                                        selectValue = localPick;
                                      } else if (localPick === 'AUTO') {
                                        selectValue = nativeSelect;
                                      } else {
                                        const overrideRaw = String(c.currency_override ?? '').trim().toUpperCase();
                                        if (overrideRaw === 'BRL' || overrideRaw === 'USD') {
                                          selectValue = overrideRaw as 'BRL' | 'USD';
                                        } else {
                                          selectValue = rowCurrency === 'USD' ? 'USD' : 'BRL';
                                        }
                                      }
                                      const serverOvRaw = String(
                                        (c as { currency_override_server?: string | null }).currency_override_server ??
                                          (c as { currency_override?: string | null }).currency_override ??
                                          ''
                                      ).trim().toUpperCase();
                                      const serverHasOverride =
                                        serverOvRaw === 'BRL' || serverOvRaw === 'USD';
                                      const showLimpar =
                                        localPick === 'AUTO'
                                          ? false
                                          : localPick === 'BRL' || localPick === 'USD'
                                            ? true
                                            : serverHasOverride;
                                      const saving = campaignCurrencySavingKey === stableKeyForCurrency;
                                      const selectClass = `px-2 py-1 rounded-lg border text-[10px] font-bold uppercase tracking-wide bg-white dark:bg-[#2a2a2a] disabled:opacity-50 cursor-pointer focus:outline-none focus:ring-2 focus:ring-offset-1 ${
                                        selectValue === 'USD'
                                          ? 'border-amber-200/80 dark:border-amber-800 text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/70 focus:ring-amber-400'
                                          : 'border-emerald-200/80 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/70 focus:ring-emerald-400'
                                      }`;
                                      return c.banca_id ? (
                                        <div className="flex flex-col items-start gap-0.5">
                                          <select
                                            value={selectValue}
                                            disabled={saving}
                                            onChange={(e) => {
                                              const next = e.target.value as 'BRL' | 'USD';
                                              if (next === selectValue) return;
                                              setLocalMetaCurrencyByKey((prev) => ({
                                                ...prev,
                                                [stableKeyForCurrency]: next,
                                              }));
                                              void handleSaveCampaignCurrency(
                                                String(c.banca_id),
                                                String(c.campaign_id),
                                                next,
                                                c.name,
                                                stableKeyForCurrency
                                              );
                                            }}
                                            title={
                                              showLimpar || serverHasOverride || localPick === 'BRL' || localPick === 'USD'
                                                ? `Conversão para R$ nos totais usa esta moeda (cotação atual). Conta Meta nativa: ${nativeSelect}.`
                                                : `Detectado na conta: ${nativeSelect}. Alterar só recalcula esta linha — não refaz o stream de todas as integrações.`
                                            }
                                            className={selectClass}
                                          >
                                            <option value="BRL">R$ BRL</option>
                                            <option value="USD">US$ USD</option>
                                          </select>
                                          {showLimpar ? (
                                            <button
                                              type="button"
                                              disabled={saving}
                                              onClick={() => {
                                                setLocalMetaCurrencyByKey((prev) => ({
                                                  ...prev,
                                                  [stableKeyForCurrency]: 'AUTO',
                                                }));
                                                void handleSaveCampaignCurrency(
                                                  String(c.banca_id),
                                                  String(c.campaign_id),
                                                  null,
                                                  c.name,
                                                  stableKeyForCurrency
                                                );
                                              }}
                                              className="text-[10px] text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 underline disabled:opacity-50"
                                              title="Limpar override salvo e voltar à moeda nativa da conta (sem novo carregamento Meta)."
                                            >
                                              limpar override
                                            </button>
                                          ) : (
                                            <span className="text-[10px] text-gray-400 dark:text-gray-500" title="Sem override — valor da conta Meta.">
                                              auto
                                            </span>
                                          )}
                                        </div>
                                      ) : (
                                        <span
                                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                                            isForeignCurrency
                                              ? 'bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300 border border-amber-200/80 dark:border-amber-800'
                                              : 'bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300 border border-emerald-200/80 dark:border-emerald-800'
                                          }`}
                                          title={
                                            isForeignCurrency
                                              ? `Ad Account em ${rowCurrency}. Spend nativo está em ${rowCurrency}; convertido para BRL via cotação atual nos totais.`
                                              : 'Ad Account em BRL.'
                                          }
                                        >
                                          <span className="text-sm leading-none">{currencySymbol(rowCurrency)}</span>
                                          <span>{rowCurrency}</span>
                                        </span>
                                      );
                                    })()}
                                  </td>
                                  <td className="px-4 py-2 text-right text-gray-700 dark:text-white tabular-nums">{m.reach.toLocaleString('pt-BR')}</td>
                                  <td className="px-4 py-2 text-right text-gray-700 dark:text-white tabular-nums">{m.impressions.toLocaleString('pt-BR')}</td>
                                  <td className="px-4 py-2 text-right text-gray-700 dark:text-white tabular-nums">{m.clicks.toLocaleString('pt-BR')}</td>
                                  <td className="px-4 py-2 text-right text-gray-700 dark:text-white tabular-nums">{m.leads.toLocaleString('pt-BR')}</td>
                                  <td className="px-4 py-2 text-right text-gray-700 dark:text-white tabular-nums">{m.results.toLocaleString('pt-BR')}</td>
                                  <td className="px-4 py-2 text-right text-gray-700 dark:text-white tabular-nums">{(Number(c.consultor_total_leads) || 0).toLocaleString('pt-BR')}</td>
                                  <td className="px-4 py-2 text-right text-gray-700 dark:text-white">{c.daily_budget != null ? `R$ ${Number(c.daily_budget).toFixed(2)}` : '-'}</td>
                                  <td className="px-4 py-2">
                                    {c.banca_id ? (
                                      <div className="flex flex-col gap-1 min-w-[220px]">
                                        <div className="flex items-center gap-2">
                                          <select
                                            value={redirectSelectComposite}
                                            onChange={(e) => {
                                              const v = e.target.value;
                                              if (!v) {
                                                setCampaignRedirectDraft((prev) => ({
                                                  ...prev,
                                                  [ownerKey]: '',
                                                }));
                                                return;
                                              }
                                              const sep = v.indexOf('::');
                                              const pid = sep > 0 ? v.slice(0, sep) : '';
                                              setCampaignRedirectDraft((prev) => ({
                                                ...prev,
                                                [ownerKey]: pid,
                                              }));
                                            }}
                                            className="px-2 py-1 rounded-lg border border-gray-200 dark:border-[#404040] text-xs text-gray-700 dark:text-gray-200 bg-white dark:bg-[#2a2a2a] max-w-[280px]"
                                          >
                                            <option value="">Sem redirect</option>
                                            {redirectOptions.map((opt) => (
                                              <option
                                                key={
                                                  opt.redirect_slug_id ?? `${opt.project_id}:${opt.slug}`
                                                }
                                                value={`${opt.project_id}::${opt.slug}`}
                                              >
                                                {(opt.project_name || opt.project_slug || opt.project_id)} · /r/
                                                {opt.slug}
                                              </option>
                                            ))}
                                          </select>
                                          <button
                                            type="button"
                                            disabled={
                                              campaignRedirectSavingKey === ownerKey ||
                                              String(redirectTarget || '') ===
                                                String(c.redirect_project_id || '')
                                            }
                                            onClick={() => handleSaveCampaignRedirect(c)}
                                            className="px-3 py-1.5 rounded-lg border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/40 text-xs font-medium disabled:opacity-50"
                                          >
                                            {campaignRedirectSavingKey === ownerKey ? 'Salvando…' : 'Vincular'}
                                          </button>
                                        </div>
                                        {currentRedirectProject?.id ? (
                                          <span className="text-[11px] text-gray-500 dark:text-gray-400">
                                            Atual: {currentRedirectProject.name || currentRedirectProject.slug || currentRedirectProject.id}
                                          </span>
                                        ) : redirectOptions.length === 0 ? (
                                          <span className="text-[11px] text-amber-600 dark:text-amber-400">
                                            Nenhum slug redirect do gestor (redirect_slugs) para esta banca
                                          </span>
                                        ) : null}
                                      </div>
                                    ) : (
                                      <span className="text-xs text-gray-500 dark:text-gray-400">—</span>
                                    )}
                                  </td>
                                  <td className="px-4 py-2">
                                    {c.banca_id ? (
                                      <div className="flex items-center gap-2">
                                        <select
                                          value={ownerTarget ?? ''}
                                          onChange={(e) =>
                                            setCampaignOwnerDraft((prev) => ({
                                              ...prev,
                                              [ownerKey]: e.target.value,
                                            }))
                                          }
                                          className="px-2 py-1 rounded-lg border border-gray-200 dark:border-[#404040] text-xs text-gray-700 dark:text-gray-200 bg-white dark:bg-[#2a2a2a] max-w-[220px]"
                                        >
                                          {ownerOptions.map((b) => (
                                            <option key={b.id} value={b.id}>
                                              {b.name || b.url || b.id}
                                            </option>
                                          ))}
                                        </select>
                                        <button
                                          type="button"
                                          disabled={
                                            campaignOwnerSavingKey === ownerKey ||
                                            !ownerTarget ||
                                            ownerTarget === String(c.banca_id)
                                          }
                                          onClick={() =>
                                            handleAssignCampaignOwner({
                                              banca_id: String(c.banca_id),
                                              campaign_id: String(c.campaign_id),
                                              name: c.name,
                                            })
                                          }
                                          className="px-3 py-1.5 rounded-lg border border-[#8CD955] text-[#6AAE39] hover:bg-[#F1FAE8] dark:text-[#8CD955] dark:hover:bg-[#1f2a18] dark:border-[#6AAE39] text-xs font-medium disabled:opacity-50"
                                        >
                                          {campaignOwnerSavingKey === ownerKey ? 'Salvando…' : 'Vincular banca'}
                                        </button>
                                      </div>
                                    ) : (
                                      <span className="text-xs text-gray-500 dark:text-gray-400">—</span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                        {(displayMetricCampaignRows?.length ?? 0) === 0 && (
                          <p className="px-4 py-6 text-center text-gray-500 dark:text-gray-400">
                            {usingLiveMetaCards
                              ? 'Nenhuma campanha com métrica no período (todas as integrações / contas) para o filtro atual.'
                              : 'Nenhuma campanha com métricas no cache local para este período e filtro de banca.'}
                          </p>
                        )}
                        {!usingLiveMetaCards && (allCampaignsRows?.length ?? 0) > 0 && (
                          <div className="px-4 py-3 border-t border-gray-100 dark:border-[#383838] bg-gray-50/40 dark:bg-[#252525] flex items-center justify-between">
                            <p className="text-xs text-gray-500 dark:text-gray-300">Página {allCampaignsPage}</p>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => setAllCampaignsPage((p) => Math.max(1, p - 1))}
                                disabled={allCampaignsPage <= 1}
                                className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-[#404040] text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-[#333] disabled:opacity-50"
                              >
                                ‹ Anterior
                              </button>
                              <button
                                type="button"
                                onClick={() => setAllCampaignsPage((p) => p + 1)}
                                className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-[#404040] text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-[#333] disabled:opacity-50"
                              >
                                Próximo ›
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
            )}

            {/* AdSets e Insights diários — apenas quando banca específica selecionada */}
            {syncedData && !loadingData && (
              <>
                  <div className="border border-gray-200 dark:border-[#404040] rounded-xl overflow-hidden">
                    <button
                      onClick={() => setExpandedTab(expandedTab === 'adsets' ? null : 'adsets')}
                      className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-[#2a2a2a] hover:bg-gray-100 dark:hover:bg-[#333] transition text-gray-800 dark:text-gray-100"
                    >
                      <span className="flex items-center gap-2 font-medium text-gray-800 dark:text-white">
                        <Layers className="w-4 h-4 text-blue-600" />
                        AdSets ({syncedData.adsets?.length ?? 0})
                      </span>
                      {expandedTab === 'adsets' ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                    </button>
                    {expandedTab === 'adsets' && (
                      <div className="overflow-x-auto max-h-80 overflow-y-auto">
                        <table className="w-full text-sm text-left min-w-[700px] text-gray-800 dark:text-white">
                          <thead className="bg-gray-100 dark:bg-[#2a2a2a] text-gray-700 dark:text-gray-100 sticky top-0">
                            <tr>
                              <th className="px-4 py-2">Banca</th>
                              <th className="px-4 py-2">Nome</th>
                              <th className="px-4 py-2">Status</th>
                              <th className="px-4 py-2">Campanha ID</th>
                              <th className="px-4 py-2">Orçamento diário</th>
                              <th className="px-4 py-2">Otimização</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100 dark:divide-[#383838]">
                            {pagedSyncedAdsetRows.map((a: any) => (
                              <tr key={a.id} className="hover:bg-gray-50 dark:hover:bg-[#2a2a2a]/80">
                                <td className="px-4 py-2 text-xs text-gray-600 dark:text-white">{selectedBancaName}</td>
                                <td className="px-4 py-2 font-medium text-gray-800 dark:text-white">{a.name || a.adset_id}</td>
                                <td className="px-4 py-2 text-gray-700 dark:text-white">{a.effective_status || a.status || '-'}</td>
                                <td className="px-4 py-2 text-xs text-gray-700 dark:text-white">{a.campaign_id || '-'}</td>
                                <td className="px-4 py-2 text-gray-700 dark:text-white">{a.daily_budget != null ? `R$ ${Number(a.daily_budget).toFixed(2)}` : '-'}</td>
                                <td className="px-4 py-2 text-gray-700 dark:text-white">{a.optimization_goal || '-'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {(syncedData.adsets?.length ?? 0) === 0 && (
                          <p className="px-4 py-6 text-center text-gray-500 dark:text-gray-400">Nenhum adset sincronizado.</p>
                        )}
                        {(syncedData.adsets?.length ?? 0) > 0 && (
                          <div className="px-4 py-3 border-t border-gray-100 dark:border-[#383838] bg-gray-50/40 dark:bg-[#252525] flex items-center justify-between">
                            <p className="text-xs text-gray-500 dark:text-gray-300">Página {syncedAdsetPage} de {syncedAdsetTotalPages}</p>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  setSyncedDataPage((prev) => ({ ...prev, adsets: Math.max(1, prev.adsets - 1) }))
                                }
                                disabled={syncedAdsetPage <= 1}
                                className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-[#404040] text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-[#333] disabled:opacity-50"
                              >
                                ‹ Anterior
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setSyncedDataPage((prev) => ({
                                    ...prev,
                                    adsets: Math.min(syncedAdsetTotalPages, prev.adsets + 1),
                                  }))
                                }
                                disabled={syncedAdsetPage >= syncedAdsetTotalPages}
                                className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-[#404040] text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-[#333] disabled:opacity-50"
                              >
                                Próximo ›
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="border border-gray-200 dark:border-[#404040] rounded-xl overflow-hidden">
                    <button
                      onClick={() => setExpandedTab(expandedTab === 'insights' ? null : 'insights')}
                      className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-[#2a2a2a] hover:bg-gray-100 dark:hover:bg-[#333] transition text-gray-800 dark:text-gray-100"
                    >
                      <span className="flex items-center gap-2 font-medium text-gray-800 dark:text-white">
                        <TrendingUp className="w-4 h-4 text-purple-600" />
                        Insights diários ({syncedData.insights?.length ?? 0})
                      </span>
                      {expandedTab === 'insights' ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                    </button>
                    {expandedTab === 'insights' && (
                      <div className="overflow-x-auto max-h-96 overflow-y-auto">
                        <table className="w-full text-sm text-left min-w-[1080px] text-gray-800 dark:text-white">
                          <thead className="bg-gray-100 dark:bg-[#2a2a2a] text-gray-700 dark:text-gray-100 sticky top-0">
                            <tr>
                              <th className="px-4 py-2">Banca</th>
                              <th className="px-4 py-2">Data</th>
                              <th className="px-4 py-2">Campanha</th>
                              <th className="px-4 py-2"><Eye className="w-4 h-4 inline" /> Alcance</th>
                              <th className="px-4 py-2"><MousePointer className="w-4 h-4 inline" /> Impressões</th>
                              <th className="px-4 py-2">Cliques</th>
                              <th className="px-4 py-2"><DollarSign className="w-4 h-4 inline" /> Gasto na Campanha</th>
                              <th className="px-4 py-2">Leads</th>
                              <th className="px-4 py-2">CPM</th>
                              <th className="px-4 py-2">CPC</th>
                              <th className="px-4 py-2">CTR %</th>
                              <th
                                className="px-4 py-2 min-w-[200px]"
                                title="cost_per_action_type (Meta Insights API), armazenado como raw_cost_per_action_type"
                              >
                                Custo / tipo de ação
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100 dark:divide-[#383838]">
                            {pagedSyncedInsightRows.map((i: any) => {
                              const cpa = formatCostPerActionTypeCell(
                                i.raw_cost_per_action_type ?? i.cost_per_action_type
                              );
                              return (
                                <tr key={i.id} className="hover:bg-gray-50 dark:hover:bg-[#2a2a2a]/80">
                                  <td className="px-4 py-2 text-xs text-gray-600 dark:text-white">{selectedBancaName}</td>
                                  <td className="px-4 py-2 text-gray-700 dark:text-white">{i.date}</td>
                                  <td className="px-4 py-2 font-medium text-gray-800 dark:text-white">{i.campaign_name || i.campaign_id}</td>
                                  <td className="px-4 py-2 text-gray-700 dark:text-white">{(i.reach ?? 0).toLocaleString('pt-BR')}</td>
                                  <td className="px-4 py-2 text-gray-700 dark:text-white">{(i.impressions ?? 0).toLocaleString('pt-BR')}</td>
                                  <td className="px-4 py-2 text-gray-700 dark:text-white">{(i.clicks ?? 0).toLocaleString('pt-BR')}</td>
                                  <td className="px-4 py-2 text-gray-700 dark:text-white">R$ {(Number(i.spend ?? 0)).toFixed(2)}</td>
                                  <td className="px-4 py-2 text-gray-700 dark:text-white">{(i.leads ?? 0).toLocaleString('pt-BR')}</td>
                                  <td className="px-4 py-2 text-gray-700 dark:text-white">{i.cpm != null ? Number(i.cpm).toFixed(2) : '-'}</td>
                                  <td className="px-4 py-2 text-gray-700 dark:text-white">{i.cpc != null ? Number(i.cpc).toFixed(2) : '-'}</td>
                                  <td className="px-4 py-2 text-gray-700 dark:text-white">{i.ctr != null ? Number(i.ctr).toFixed(2) : '-'}</td>
                                  <td
                                    className="px-4 py-2 text-xs text-gray-700 dark:text-white max-w-[280px] truncate align-top"
                                    title={cpa.title || undefined}
                                  >
                                    {cpa.short}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                        {(syncedData.insights?.length ?? 0) === 0 && (
                          <p className="px-4 py-6 text-center text-gray-500 dark:text-gray-400">Nenhum insight sincronizado. Execute a sincronização.</p>
                        )}
                        {(syncedData.insights?.length ?? 0) > 0 && (
                          <div className="px-4 py-3 border-t border-gray-100 dark:border-[#383838] bg-gray-50/40 dark:bg-[#252525] flex items-center justify-between">
                            <p className="text-xs text-gray-500 dark:text-gray-300">Página {syncedInsightPage} de {syncedInsightTotalPages}</p>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  setSyncedDataPage((prev) => ({ ...prev, insights: Math.max(1, prev.insights - 1) }))
                                }
                                disabled={syncedInsightPage <= 1}
                                className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-[#404040] text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-[#333] disabled:opacity-50"
                              >
                                ‹ Anterior
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setSyncedDataPage((prev) => ({
                                    ...prev,
                                    insights: Math.min(syncedInsightTotalPages, prev.insights + 1),
                                  }))
                                }
                                disabled={syncedInsightPage >= syncedInsightTotalPages}
                                className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-[#404040] text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-[#333] disabled:opacity-50"
                              >
                                Próximo ›
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
              </>
            )}
          </div>
        </div>

        <div className={metaCardOverflow}>
          <div className="p-4 border-b border-gray-100 dark:border-[#383838] bg-gray-50/50 dark:bg-[#1e1e1e] flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-50">Visão geral de todas as bancas</h2>
              <p className="text-sm text-gray-600 dark:text-gray-400">Acompanhe integração e métricas Meta por banca.</p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <input
                value={overviewSearch}
                onChange={(e) => { setOverviewSearch(e.target.value); setOverviewPage(1); }}
                placeholder="Buscar banca por nome ou URL"
                className="px-3 py-2 border border-gray-200 dark:border-[#404040] rounded-xl text-sm text-gray-800 dark:text-gray-100 placeholder:text-gray-500 dark:placeholder:text-gray-500 bg-white dark:bg-[#2a2a2a]"
              />
              <button
                type="button"
                onClick={() => {
                  void loadOverview();
                }}
                disabled={loadingOverview}
                className="px-3 py-2 bg-gray-100 dark:bg-[#333] hover:bg-gray-200 dark:hover:bg-[#404040] rounded-xl font-medium text-gray-700 dark:text-gray-200 disabled:opacity-50 flex items-center gap-2"
              >
                {loadingOverview ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                Atualizar
              </button>
            </div>
          </div>
          {overviewError && (
            <div className="mx-4 mt-4 p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300">
              {overviewError}
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-sm">
              <thead className="bg-gray-50 dark:bg-[#2a2a2a] text-gray-700 dark:text-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold">Banca</th>
                  <th className="px-4 py-3 text-left font-semibold">Integração</th>
                  <th className="px-4 py-3 text-left font-semibold">Detalhes da integração</th>
                  <th className="px-4 py-3 text-left font-semibold">Último sync</th>
                  <th className="px-4 py-3 text-left font-semibold">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-[#383838]">
                {pagedOverviewRows.map((row) => (
                    <tr
                      key={`${row.banca_id}-${row.integration_id ?? 'none'}-${row.integration_index}`}
                      className="align-top hover:bg-gray-50/60 dark:hover:bg-[#2a2a2a]/60"
                    >
                      <td className="px-4 py-3">
                        <p className="font-semibold text-gray-900 dark:text-gray-50">{row.banca_name}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 break-all">{row.banca_url}</p>
                        {row.integrations_count > 1 ? (
                          <p className="text-[11px] text-[#6AAE39] dark:text-emerald-400 font-medium mt-1">
                            Integração {row.integration_index}/{row.integrations_count}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${
                            row.configured
                              ? row.is_active
                                ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
                                : 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300'
                              : 'bg-gray-100 dark:bg-[#333] text-gray-600 dark:text-gray-300'
                          }`}
                        >
                          {row.configured ? (row.is_active ? 'Configurada e ativa' : 'Configurada (inativa)') : 'Sem integração'}
                        </span>
                        {row.last_sync_error ? (
                          <p className="text-xs text-red-600 mt-1 max-w-[220px]">{row.last_sync_error}</p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-700 dark:text-gray-300">
                        <p>Base URL: {row.base_url || '-'}</p>
                        <p>Ad Account: {row.ad_account_id || '-'}</p>
                        <p>Pixel: {row.pixel_id || '-'}</p>
                        <p>Token: {row.token_last4 ? `••••${row.token_last4}` : '-'}</p>
                        {row.integration_id ? (
                          <p className="mt-1 text-[10px] text-gray-500 dark:text-gray-500 font-mono break-all">
                            ID: {row.integration_id}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600 dark:text-gray-400">
                        <p>{formatDate(row.last_sync_at)}</p>
                        {row.last_sync_date_preset ? <p className="text-gray-500 dark:text-gray-500 mt-0.5">{row.last_sync_date_preset}</p> : null}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-2 items-start">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedBancaIds([row.banca_id]);
                              setAdminMetaCreateNewIntegration(false);
                              if (row.integration_id) setAdminMetaSelectedIntegrationId(row.integration_id);
                              else setAdminMetaSelectedIntegrationId('');
                              setSyncedData(null);
                              setTimeout(() => {
                                document.getElementById('dados-sincronizados-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                              }, 0);
                            }}
                            className="px-3 py-1.5 rounded-lg bg-[#8CD955] hover:bg-[#7BC84A] text-white text-xs font-medium"
                          >
                            Ver dados
                          </button>
                          {row.configured && row.integration_id ? (
                            <button
                              type="button"
                              disabled={overviewUnlinkKey !== null}
                              onClick={() => void handleOverviewUnlinkBancaRow(row)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200 bg-amber-50/90 dark:bg-amber-950/40 hover:bg-amber-100 dark:hover:bg-amber-950/60 text-xs font-medium disabled:opacity-50"
                              title="Remove só o vínculo desta banca com esta integração; atualiza a lista."
                            >
                              {overviewUnlinkKey === `${row.banca_id}:${row.integration_id}` ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                              ) : (
                                <Unplug className="w-3.5 h-3.5 shrink-0" />
                              )}
                              Desvincular banca
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {/* Paginação */}
          {filteredOverviewRows.length > 0 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 dark:border-[#383838] bg-gray-50/40 dark:bg-[#1e1e1e]/80">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Exibindo{' '}
                <span className="font-semibold text-gray-700 dark:text-gray-200">
                  {(overviewPageSafe - 1) * OVERVIEW_PAGE_SIZE + 1}
                </span>{' '}
                a{' '}
                <span className="font-semibold text-gray-700 dark:text-gray-200">
                  {Math.min(overviewPageSafe * OVERVIEW_PAGE_SIZE, filteredOverviewRows.length)}
                </span>{' '}
                de{' '}
                <span className="font-semibold text-gray-700 dark:text-gray-200">{filteredOverviewRows.length}</span> linhas
              </p>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setOverviewPage(1)}
                  disabled={overviewPageSafe <= 1}
                  className="px-2 py-1.5 rounded-lg border border-gray-200 dark:border-[#404040] text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#333] disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  «
                </button>
                <button
                  type="button"
                  onClick={() => setOverviewPage((p) => Math.max(1, p - 1))}
                  disabled={overviewPageSafe <= 1}
                  className="px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-[#404040] text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#333] disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  ‹ Anterior
                </button>
                {Array.from({ length: overviewTotalPages }, (_, i) => i + 1)
                  .filter((p) => p === 1 || p === overviewTotalPages || Math.abs(p - overviewPageSafe) <= 1)
                  .reduce<(number | '...')[]>((acc, p, idx, arr) => {
                    if (idx > 0 && typeof arr[idx - 1] === 'number' && (p as number) - (arr[idx - 1] as number) > 1) {
                      acc.push('...');
                    }
                    acc.push(p);
                    return acc;
                  }, [])
                  .map((item, idx) =>
                    item === '...' ? (
                      <span key={`ellipsis-${idx}`} className="px-1.5 text-xs text-gray-400 dark:text-gray-500">…</span>
                    ) : (
                      <button
                        key={item}
                        type="button"
                        onClick={() => setOverviewPage(item as number)}
                        className={`px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                          overviewPageSafe === item
                            ? 'bg-[#8CD955] border-[#8CD955] text-white'
                            : 'border-gray-200 dark:border-[#404040] text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#333]'
                        }`}
                      >
                        {item}
                      </button>
                    )
                  )}
                <button
                  type="button"
                  onClick={() => setOverviewPage((p) => Math.min(overviewTotalPages, p + 1))}
                  disabled={overviewPageSafe >= overviewTotalPages}
                  className="px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-[#404040] text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#333] disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Próximo ›
                </button>
                <button
                  type="button"
                  onClick={() => setOverviewPage(overviewTotalPages)}
                  disabled={overviewPageSafe >= overviewTotalPages}
                  className="px-2 py-1.5 rounded-lg border border-gray-200 dark:border-[#404040] text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#333] disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  »
                </button>
              </div>
            </div>
          )}
          {!loadingOverview && overviewRows.length === 0 && !overviewError && (
            <div className="p-6 text-sm text-center text-gray-500 dark:text-gray-400">
              Nenhuma banca encontrada para exibir no painel geral.
            </div>
          )}
        </div>


        <div id="meta-config-section" className={metaCardOverflow}>
          <div className="p-4 border-b border-gray-100 dark:border-[#383838] bg-gray-50/50 dark:bg-[#1e1e1e]">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">
              <Building2 className="w-4 h-4 inline mr-2" />
              Bancas desta integração
            </label>
            <div className="relative max-w-xl" ref={bancaPickerRef}>
              <button
                type="button"
                aria-expanded={bancaPickerOpen}
                aria-haspopup="listbox"
                onClick={() => setBancaPickerOpen((o) => !o)}
                className="w-full flex items-center justify-between gap-3 px-4 py-3 border border-gray-200 dark:border-[#404040] rounded-xl bg-white dark:bg-[#2a2a2a] text-left text-sm text-gray-800 dark:text-gray-100 hover:border-gray-300 dark:hover:border-[#505050] transition-colors"
              >
                <span className="truncate">
                  {selectedBancaIds.length === 0 ? (
                    <span className="text-gray-500">Escolha uma ou mais bancas…</span>
                  ) : (
                    selectedBancaName
                  )}
                </span>
                <ChevronDown
                  className={`w-5 h-5 shrink-0 text-gray-500 transition-transform ${bancaPickerOpen ? 'rotate-180' : ''}`}
                />
              </button>
              {bancaPickerOpen ? (
                <div
                  className="absolute z-30 left-0 right-0 mt-1 rounded-xl border border-gray-200 dark:border-[#404040] bg-white dark:bg-[#2a2a2a] shadow-lg flex flex-col max-h-72 overflow-hidden"
                  role="listbox"
                  aria-multiselectable="true"
                >
                  <input
                    type="search"
                    value={bancaPickerSearch}
                    onChange={(e) => setBancaPickerSearch(e.target.value)}
                    placeholder="Buscar banca…"
                    className="w-full px-3 py-2.5 text-sm border-b border-gray-100 dark:border-[#404040] text-gray-800 dark:text-gray-100 bg-transparent placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-[#8CD955]/30"
                    autoComplete="off"
                  />
                  <div className="overflow-y-auto p-2 space-y-0.5">
                    {bancasForPicker.map((b) => {
                      const checked = selectedBancaIds.includes(b.id);
                      const meta = configuredBancaMeta.get(b.id);
                      return (
                        <label
                          key={b.id}
                          className="flex items-start gap-2 text-sm text-gray-800 dark:text-gray-100 cursor-pointer rounded-lg px-2 py-2 hover:bg-gray-50 dark:hover:bg-[#333]"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              const next = e.target.checked
                                ? [...selectedBancaIds, b.id]
                                : selectedBancaIds.filter((x) => x !== b.id);
                              setSelectedBancaIds(next);
                              setSelectedIntegrationContextBancaId((prev) => {
                                if (e.target.checked) return b.id;
                                if (prev === b.id) return next[0] || '';
                                return prev;
                              });
                              setEditingToken(false);
                              setAccessTokenRevealed(false);
                              setRevealTokenError(null);
                              setTestResult(null);
                              setSyncResult(null);
                              setConfigLoadError(null);
                              if (next.length === 0) {
                                setConfig(null);
                                setSyncedData(null);
                              }
                            }}
                            className="mt-1 rounded border-gray-300 text-[#8CD955] focus:ring-[#8CD955]"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-1.5">
                              <span className="font-medium">{b.name || b.url}</span>
                              {meta?.configured ? (
                                <span
                                  className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded ${
                                    meta.is_active
                                      ? 'bg-emerald-100 text-emerald-800'
                                      : 'bg-amber-100 text-amber-900'
                                  }`}
                                >
                                  {meta.is_active ? 'Integrada · ativa' : 'Integrada · inativa'}
                                </span>
                              ) : null}
                            </span>
                            {b.url ? <span className="block text-xs text-gray-500 break-all">{b.url}</span> : null}
                          </span>
                        </label>
                      );
                    })}
                    {bancas.length === 0 ? (
                      <p className="text-sm text-gray-500 px-2 py-3">Nenhuma banca disponível.</p>
                    ) : bancasForPicker.length === 0 ? (
                      <p className="text-sm text-gray-500 px-2 py-3">Nenhum resultado para a busca.</p>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
            {selectedBancaIds.length > 0 ? (
              <div className="mt-3 max-w-xl">
                <p className="text-[11px] font-medium text-gray-600 dark:text-gray-400 mb-2">
                  {config?.configured && !adminMetaCreateNewIntegration && selectedBancaIds.length > 1
                    ? 'Bancas vinculadas — use × para desvincular uma e manter as outras'
                    : 'Bancas selecionadas neste grupo'}
                </p>
                <div className="flex flex-wrap gap-2">
                  {selectedBancaIds.map((bid) => {
                    const b = bancas.find((x) => String(x.id) === String(bid));
                    const label = b?.name || b?.url || shortUuid(bid);
                    const showRemove =
                      Boolean(config?.configured) &&
                      !adminMetaCreateNewIntegration &&
                      Boolean(adminMetaSelectedIntegrationId || config?.integration_id) &&
                      selectedBancaIds.length > 1;
                    return (
                      <span
                        key={bid}
                        className="inline-flex items-center gap-1 max-w-full rounded-lg border border-gray-200 dark:border-[#404040] bg-white dark:bg-[#2a2a2a] pl-2.5 pr-1 py-1 text-xs text-gray-800 dark:text-gray-100 shadow-sm"
                      >
                        <span className="truncate max-w-[220px]" title={label}>
                          {label}
                        </span>
                        {showRemove ? (
                          <button
                            type="button"
                            disabled={metaIntegrationUiBusy || saving}
                            onClick={() => void handleQuickUnlinkBancaFromIntegration(bid)}
                            className="shrink-0 rounded-md p-1 text-gray-500 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/50 dark:hover:text-red-300 disabled:opacity-40 touch-manipulation"
                            title={`Remover «${label}» desta integração (mantém as outras)`}
                            aria-label={`Remover ${label} desta integração`}
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        ) : null}
                      </span>
                    );
                  })}
                </div>
              </div>
            ) : null}
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-2 max-w-xl">
              Com uma integração selecionada no bloco abaixo, as caixas definem em quais bancas ela vale (tabela{' '}
              <code className="text-[11px] bg-gray-100 dark:bg-[#333] text-gray-800 dark:text-gray-200 px-1 rounded">meta_integration_bancas</code>
              ). Use &quot;Aplicar só vínculos&quot; para mudar só isso, ou &quot;Salvar configuração&quot; para vínculos + token/campos.
            </p>
            {configLoadError ? (
              <div className="mt-3 max-w-xl p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-sm text-amber-900 dark:text-amber-200">
                {configLoadError}
              </div>
            ) : null}
          </div>

          {loading && selectedBancaIds.length > 0 ? (
            <div className="p-8 flex justify-center">
              <Loader2 className="w-8 h-8 animate-spin text-[#8CD955]" />
            </div>
          ) : selectedBancaIds.length > 0 ? (
            <div className="p-6 space-y-6">
              {config?.configured && Array.isArray(config.integrations) && config.integrations.length > 0 ? (
                <div className="rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50/80 dark:bg-indigo-950/40 p-4">
                  <label className="block text-sm font-medium text-gray-800 dark:text-gray-200 mb-1">
                    Conta de anúncio (integração Meta)
                  </label>
                  <select
                    value={adminMetaCreateNewIntegration ? '__new__' : adminMetaSelectedIntegrationId || config.integration_id || ''}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === '__new__') {
                        const previousIntegrationId = (
                          adminMetaSelectedIntegrationId ||
                          (config?.integration_id ? String(config.integration_id) : '')
                        ).trim();
                        setAdminMetaReuseTokenFromIntegrationId(previousIntegrationId);
                        setAdminMetaCreateNewIntegration(true);
                        setAdminMetaSelectedIntegrationId('');
                        setForm((f) => ({
                          ...f,
                          ad_account_id: '',
                          pixel_id: '',
                          default_campaign_id: '',
                          access_token: '',
                        }));
                        setEditingToken(false);
                        setAccessTokenRevealed(false);
                        setRevealTokenError(null);
                        return;
                      }
                      setAdminMetaCreateNewIntegration(false);
                      setAdminMetaReuseTokenFromIntegrationId('');
                      setAdminMetaSelectedIntegrationId(v);
                      const row = config.integrations?.find((i) => i.integration_id === v);
                      if (row) {
                        if (row.banca_ids && row.banca_ids.length > 0) {
                          setSelectedBancaIds([...row.banca_ids]);
                        }
                        setForm((f) => ({
                          ...f,
                          base_url:
                            row.base_url != null && String(row.base_url).trim() !== ''
                              ? String(row.base_url)
                              : f.base_url,
                          ad_account_id: row.ad_account_id != null ? String(row.ad_account_id) : '',
                          pixel_id: row.pixel_id != null ? String(row.pixel_id) : '',
                          default_campaign_id:
                            row.default_campaign_id != null ? String(row.default_campaign_id) : '',
                          access_token: '',
                        }));
                        setEditingToken(false);
                        setAccessTokenRevealed(false);
                        setRevealTokenError(null);
                        setConfig((c) =>
                          c
                            ? {
                                ...c,
                                integration_id: row.integration_id,
                                banca_ids:
                                  row.banca_ids && row.banca_ids.length > 0
                                    ? row.banca_ids
                                    : c.banca_ids,
                                base_url: row.base_url,
                                token_last4: row.token_last4,
                                ad_account_id: row.ad_account_id,
                                pixel_id: row.pixel_id,
                                default_campaign_id: row.default_campaign_id,
                                is_active: row.is_active,
                                last_sync_at: row.last_sync_at,
                                last_sync_error: row.last_sync_error,
                                last_sync_date_preset: row.last_sync_date_preset,
                              }
                            : c
                        );
                      }
                    }}
                    className="w-full max-w-xl px-4 py-2 border border-gray-200 dark:border-[#404040] rounded-xl text-gray-800 dark:text-gray-100 bg-white dark:bg-[#2a2a2a]"
                  >
                    {config.integrations.map((i) => (
                      <option key={i.integration_id} value={i.integration_id}>
                        {(i.ad_account_id && String(i.ad_account_id).trim()) || 'Sem act_'}{' '}
                        {i.token_last4 ? `· ••••${i.token_last4}` : ''}
                      </option>
                    ))}
                    <option value="__new__">+ Nova integração (outra conta/token)</option>
                  </select>
                  <p className="text-xs text-gray-600 dark:text-gray-400 mt-2">
                    Cada opção é uma linha em{' '}
                    <code className="text-[11px] bg-white/80 dark:bg-[#333] px-1 rounded">meta_integration_configs</code>.
                    Testar conexão e revelar token exigem um banca_id vinculado à integração selecionada (tabela
                    meta_integration_bancas). O filtro superior da página só vale como contexto quando essa banca também
                    está entre os vínculos da integração atual.
                  </p>
                  {adminMetaCreateNewIntegration ? (
                    <p className="text-xs text-indigo-800 dark:text-indigo-200 mt-2 max-w-xl">
                      Nova integração: será criado um novo registro para esta(s) banca(s). Se você não colar um Access
                      Token, o sistema reaproveita o token já salvo de outra integração Meta vinculada à mesma banca
                      (prioridade: integração que estava selecionada antes de «Nova integração»).
                    </p>
                  ) : null}
                  {!adminMetaCreateNewIntegration ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void handleApplyIntegrationBancaLinks()}
                        disabled={
                          metaIntegrationUiBusy ||
                          saving ||
                          selectedBancaIds.length === 0 ||
                          !(adminMetaSelectedIntegrationId || config?.integration_id)
                        }
                        className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-indigo-300 dark:border-indigo-600 text-sm font-medium text-indigo-800 dark:text-indigo-200 bg-white dark:bg-[#2a2a2a] hover:bg-indigo-50 dark:hover:bg-indigo-950/50 disabled:opacity-50"
                      >
                        {metaIntegrationUiBusy ? (
                          <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                        ) : (
                          <Link2 className="w-4 h-4 shrink-0" />
                        )}
                        Aplicar só vínculos
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleRemoveMetaIntegration()}
                        disabled={
                          metaIntegrationUiBusy ||
                          saving ||
                          !(adminMetaSelectedIntegrationId || config?.integration_id)
                        }
                        className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-red-300 dark:border-red-800 text-sm font-medium text-red-800 dark:text-red-200 bg-white dark:bg-[#2a2a2a] hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-50"
                      >
                        {metaIntegrationUiBusy ? (
                          <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                        ) : (
                          <Trash2 className="w-4 h-4 shrink-0" />
                        )}
                        Remover integração
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Base URL Meta</label>
                  <input
                    type="text"
                    value={form.base_url}
                    onChange={(e) => setForm((f) => ({ ...f, base_url: e.target.value }))}
                    placeholder="https://graph.facebook.com/v25.0"
                    className="w-full px-4 py-2 border border-gray-200 dark:border-[#404040] rounded-xl text-gray-800 dark:text-gray-100 bg-white dark:bg-[#2a2a2a] placeholder:text-gray-500 dark:placeholder:text-gray-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                    <Key className="w-4 h-4 inline mr-1" />
                    Access Token
                  </label>
                  {adminMetaDisplayTokenLast4 && !editingToken ? (
                    <div className="space-y-1">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:flex-wrap">
                        <input
                          type="text"
                          readOnly
                          value={`••••${adminMetaDisplayTokenLast4}`}
                          aria-label="Token salvo (máscara)"
                          className="w-full min-w-0 px-4 py-2 border border-gray-200 dark:border-[#404040] rounded-xl text-gray-800 dark:text-gray-100 bg-gray-50 dark:bg-[#1e1e1e] font-mono text-sm"
                        />
                        <button
                          type="button"
                          onClick={() => void handleRevealAccessToken()}
                          disabled={
                            !primaryBancaId ||
                            revealTokenLoading ||
                            (adminMetaCreateNewIntegration &&
                              !adminMetaReuseTokenFromIntegrationId.trim() &&
                              !config?.integration_id)
                          }
                          className="shrink-0 inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl border border-amber-200 bg-amber-50 text-sm font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
                        >
                          {revealTokenLoading ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Eye className="w-4 h-4" />
                          )}
                          Revelar token
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingToken(true);
                            setAccessTokenRevealed(false);
                            setRevealTokenError(null);
                            setForm((f) => ({ ...f, access_token: '' }));
                          }}
                          className="shrink-0 px-4 py-2 rounded-xl border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50"
                        >
                          Alterar token
                        </button>
                      </div>
                      {revealTokenError ? (
                        <p className="text-xs text-red-600">{revealTokenError}</p>
                      ) : null}
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <input
                        type={accessTokenRevealed ? 'text' : 'password'}
                        autoComplete="off"
                        value={form.access_token}
                        onChange={(e) => {
                          setForm((f) => ({ ...f, access_token: e.target.value }));
                          if (accessTokenRevealed) setAccessTokenRevealed(false);
                        }}
                        placeholder={
                          adminMetaCreateNewIntegration
                            ? 'Deixe em branco para reutilizar o token de outra integração desta banca'
                            : config?.configured && config?.token_last4
                              ? 'Novo token (ou deixe em branco ao salvar para manter o atual)'
                              : 'Token do System User'
                        }
                        className="w-full px-4 py-2 border border-gray-200 dark:border-[#404040] rounded-xl text-gray-800 dark:text-gray-100 bg-white dark:bg-[#2a2a2a] placeholder:text-gray-500 dark:placeholder:text-gray-500 font-mono text-sm"
                      />
                      {form.access_token ? (
                        <button
                          type="button"
                          onClick={() => setAccessTokenRevealed((v) => !v)}
                          className="text-xs font-medium text-amber-800 hover:text-amber-950"
                        >
                          {accessTokenRevealed ? 'Ocultar token (mascarar)' : 'Mostrar token'}
                        </button>
                      ) : null}
                    </div>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Ad Account ID(s)</label>
                  <input
                    type="text"
                    value={form.ad_account_id}
                    onChange={(e) => setForm((f) => ({ ...f, ad_account_id: e.target.value }))}
                    placeholder="act_123456789, act_987654321"
                    className="w-full px-4 py-2 border border-gray-200 dark:border-[#404040] rounded-xl text-gray-800 dark:text-gray-100 bg-white dark:bg-[#2a2a2a] placeholder:text-gray-500 dark:placeholder:text-gray-500"
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Para múltiplas contas, separe por vírgula: <span className="font-mono">act_111, act_222</span></p>
                  {parseAdAccountIdsField(form.ad_account_id).length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-2" aria-label="Contas de anúncio configuradas">
                      {parseAdAccountIdsField(form.ad_account_id).map((act, idx) => (
                        <span
                          key={`${act}-${idx}`}
                          className="inline-flex items-center gap-1 rounded-lg border border-gray-200 dark:border-[#404040] bg-gray-50 dark:bg-[#333] px-2 py-1 text-xs font-mono text-gray-800 dark:text-gray-100"
                        >
                          <span title={act}>{formatActShort(act)}</span>
                          <button
                            type="button"
                            aria-label={`Remover conta ${act}`}
                            onClick={() =>
                              setForm((f) => ({
                                ...f,
                                ad_account_id: adAccountIdsFieldWithoutIndex(f.ad_account_id, idx),
                              }))
                            }
                            className="rounded p-0.5 text-gray-500 hover:bg-red-100 hover:text-red-700 dark:hover:bg-red-900/40 dark:hover:text-red-300"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Pixel ID</label>
                  <input
                    type="text"
                    value={form.pixel_id}
                    onChange={(e) => setForm((f) => ({ ...f, pixel_id: e.target.value }))}
                    placeholder="1234567890"
                    className="w-full px-4 py-2 border border-gray-200 dark:border-[#404040] rounded-xl text-gray-800 dark:text-gray-100 bg-white dark:bg-[#2a2a2a] placeholder:text-gray-500 dark:placeholder:text-gray-500"
                  />
                </div>
                <div className="sm:col-span-2 lg:col-span-3">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                    <Hash className="w-4 h-4 inline mr-1" />
                    Campanha padrão (opcional)
                  </label>
                  <div className="flex gap-2">
                    <select
                      value={form.default_campaign_id}
                      onChange={(e) => setForm((f) => ({ ...f, default_campaign_id: e.target.value }))}
                      className="flex-1 px-4 py-2 border border-gray-200 dark:border-[#404040] rounded-xl bg-white dark:bg-[#2a2a2a] text-gray-800 dark:text-gray-100"
                    >
                      <option value="">Nenhuma</option>
                      {campaigns.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.campaign_kind === 'bolao' ? '[Bolão] ' : ''}
                          {c.name || c.id}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={handleLoadCampaigns}
                      disabled={loadingCampaigns || adminMetaCreateNewIntegration}
                      className="px-4 py-2 bg-gray-100 dark:bg-[#333] hover:bg-gray-200 dark:hover:bg-[#404040] rounded-xl font-medium text-gray-700 dark:text-gray-200 disabled:opacity-50 flex items-center gap-2"
                    >
                      {loadingCampaigns ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                      Carregar campanhas
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-4 py-2 bg-[#8CD955] hover:bg-[#7BC84A] text-white rounded-xl font-medium flex items-center gap-2 disabled:opacity-50"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Salvar configuração
                </button>
                <button
                  onClick={handleTestConnection}
                  disabled={testing}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium flex items-center gap-2 disabled:opacity-50"
                >
                  {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  Testar conexão
                </button>
                <button
                  onClick={handleSync}
                  disabled={syncing}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl font-medium flex items-center gap-2 disabled:opacity-50"
                >
                  {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  Sincronizar agora
                </button>
                <a
                  href="/gestor-trafego"
                  className="px-4 py-2 bg-gray-100 dark:bg-[#333] hover:bg-gray-200 dark:hover:bg-[#404040] text-gray-700 dark:text-gray-200 rounded-xl font-medium flex items-center gap-2"
                >
                  <ExternalLink className="w-4 h-4" />
                  Ver Gestor de Tráfego
                </a>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 border-t border-gray-200 dark:border-[#383838] pt-4">
                <div className="p-3 rounded-xl bg-gray-50 dark:bg-[#1e1e1e] border border-gray-200 dark:border-[#404040]">
                  <p className="text-[11px] font-semibold text-gray-500 uppercase">Token</p>
                  <p className="text-sm font-medium text-gray-800 mt-1">{config?.token_last4 ? `••••${config.token_last4}` : '-'}</p>
                </div>
                <div className="p-3 rounded-xl bg-gray-50 dark:bg-[#1e1e1e] border border-gray-200 dark:border-[#404040]">
                  <p className="text-[11px] font-semibold text-gray-500 uppercase">Pixel</p>
                  <p className="text-sm font-medium text-gray-800 mt-1 break-all">
                    {(form.pixel_id && form.pixel_id.trim()) || config?.pixel_id || '-'}
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-gray-50 dark:bg-[#1e1e1e] border border-gray-200 dark:border-[#404040]">
                  <p className="text-[11px] font-semibold text-gray-500 uppercase">Ad Account</p>
                  <p className="text-sm font-medium text-gray-800 mt-1 break-all">
                    {(form.ad_account_id && form.ad_account_id.trim()) || config?.ad_account_id || '-'}
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-gray-50 dark:bg-[#1e1e1e] border border-gray-200 dark:border-[#404040]">
                  <p className="text-[11px] font-semibold text-gray-500 uppercase">Base URL</p>
                  <p className="text-sm font-medium text-gray-800 mt-1 break-all">
                    {(form.base_url && form.base_url.trim()) || config?.base_url || '-'}
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-gray-50 dark:bg-[#1e1e1e] border border-gray-200 dark:border-[#404040]">
                  <p className="text-[11px] font-semibold text-gray-500 uppercase">Campanha padrão</p>
                  <p className="text-sm font-medium text-gray-800 mt-1 break-all">
                    {(form.default_campaign_id && form.default_campaign_id.trim()) || config?.default_campaign_id || '-'}
                  </p>
                </div>
              </div>

              {testResult && (
                <div
                  className={`p-4 rounded-xl flex items-start gap-3 ${
                    testResult.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'
                  }`}
                >
                  {testResult.success ? (
                    <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                  )}
                  <div>
                    {testResult.success ? (
                      <>
                        <p className="font-medium text-green-800">
                          {testResult.infoMessage ? 'Pronto' : 'Conexão OK'}
                        </p>
                        {testResult.infoMessage ? (
                          <p className="text-sm text-green-700 mt-0.5">{testResult.infoMessage}</p>
                        ) : null}
                        {testResult.me && <p className="text-sm text-green-700">Conta: {testResult.me.name || testResult.me.id}</p>}
                        {testResult.adAccounts && testResult.adAccounts.length > 0 && (
                          <p className="text-sm text-green-700 mt-1">
                            Contas de anúncio: {testResult.adAccounts.map((a: any) => a.name || a.id).join(', ')}
                          </p>
                        )}
                      </>
                    ) : (
                      <p className="text-red-800">{testResult.error}</p>
                    )}
                  </div>
                </div>
              )}

              {syncResult && (
                <div
                  className={`p-4 rounded-xl flex items-start gap-3 ${
                    syncResult.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'
                  }`}
                >
                  {syncResult.success ? (
                    <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                  )}
                  <div>
                    {syncResult.success ? (
                      <>
                        <p className="font-medium text-green-800">Sincronização concluída</p>
                        <p className="text-sm text-green-700">
                          Campanhas: {syncResult.campaignsCount ?? 0} | AdSets: {syncResult.adsetsCount ?? 0} | Insights: {syncResult.insightsCount ?? 0}
                        </p>
                      </>
                    ) : (
                      <p className="text-red-800">{syncResult.error}</p>
                    )}
                  </div>
                </div>
              )}

              <div className="border-t border-gray-200 dark:border-[#383838] pt-4">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2 flex items-center gap-2">
                  <Calendar className="w-4 h-4" />
                  Status
                </h3>
                <div className="grid gap-2 text-sm text-gray-600 dark:text-gray-400">
                  <p>Último sync: {formatDate(config?.last_sync_at ?? null)}</p>
                  {config?.last_sync_error && (
                    <p className="text-red-600">Último erro: {config.last_sync_error}</p>
                  )}
                  {config?.last_sync_date_preset && (
                    <p>Intervalo: {config.last_sync_date_preset}</p>
                  )}
                </div>
              </div>

              
            </div>
          ) : (
            <div className="p-8 text-center text-gray-500">Marque pelo menos uma banca para configurar a integração Meta.</div>
          )}
        </div>
      </div>

      {consultorModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-2xl bg-white dark:bg-[#252525] rounded-2xl border border-gray-200 dark:border-[#404040] shadow-xl">
            <div className="px-5 py-4 border-b border-gray-100 dark:border-[#383838] flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-gray-900 dark:text-gray-50">Atribuir consultores à campanha</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Selecione a campanha e os consultores responsáveis.</p>
              </div>
              <button
                type="button"
                onClick={() => setConsultorModalOpen(false)}
                className="px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-[#404040] text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#333]"
              >
                Fechar
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase text-gray-500 mb-1">Campanha</label>
                <select
                  value={consultorModalCampaignKey}
                  onChange={(e) => {
                    setConsultorModalCampaignKey(e.target.value);
                    setConsultorModalSearch('');
                  }}
                  className="w-full px-3 py-2 border border-gray-200 dark:border-[#404040] rounded-xl text-sm text-gray-800 dark:text-gray-100 bg-white dark:bg-[#2a2a2a]"
                >
                  {(allCampaignsRows || []).map((row: any) => {
                    const key = `${String(row.banca_id)}:${String(row.campaign_id)}`;
                    return (
                      <option key={key} value={key}>
                        {(row.name || row.campaign_id)} — {row.banca_name || row.banca_id}
                      </option>
                    );
                  })}
                </select>
              </div>

              {selectedConsultorModalRow ? (
                <>
                  <div className="grid sm:grid-cols-2 gap-3">
                    <div className="p-3 rounded-xl border border-gray-100 dark:border-[#383838] bg-gray-50 dark:bg-[#1e1e1e]">
                      <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase">Leads consultores</p>
                      <p className="text-xl font-bold text-gray-900 dark:text-gray-50 mt-1">
                        {(Number(selectedConsultorModalRow.consultor_total_leads) || 0).toLocaleString('pt-BR')}
                      </p>
                    </div>
                    <div className="p-3 rounded-xl border border-gray-100 dark:border-[#383838] bg-gray-50 dark:bg-[#1e1e1e]">
                      <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase">Depósito consultores</p>
                      <p className="text-xl font-bold text-gray-900 dark:text-gray-50 mt-1">
                        R$ {(Number(selectedConsultorModalRow.consultor_total_deposited) || 0).toFixed(2)}
                      </p>
                    </div>
                  </div>

                  {(() => {
                    const redirectLinked = (Array.isArray(selectedConsultorModalRow.assigned_consultors)
                      ? selectedConsultorModalRow.assigned_consultors
                      : []
                    )
                      .map((consultor: any) => ({
                        consultor,
                        groups: Array.isArray(consultor.redirect_groups) ? consultor.redirect_groups : [],
                      }))
                      .filter((item: any) => item.groups.length > 0);
                    if (redirectLinked.length === 0) return null;
                    return (
                      <div className="p-3 rounded-xl border border-emerald-100 dark:border-emerald-900/60 bg-emerald-50/60 dark:bg-emerald-950/20">
                        <p className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 uppercase">
                          Grupos de redirect vinculados à campanha
                        </p>
                        <div className="mt-2 space-y-2">
                          {redirectLinked.map(({ consultor, groups }: any) => (
                            <div key={consultor.id} className="text-xs text-gray-700 dark:text-gray-200">
                              <span className="font-semibold">{consultor.full_name || consultor.email || consultor.id}</span>
                              <span className="text-gray-500 dark:text-gray-400">: </span>
                              <span>
                                {groups
                                  .map((g: any) =>
                                    `${g.name || 'Grupo sem nome'}${g.project_name ? ` (${g.project_name})` : ''}`
                                  )
                                  .join(', ')}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}

                  <div>
                    <label className="block text-xs font-semibold uppercase text-gray-500 dark:text-gray-400 mb-1">Consultores da banca</label>
                    <input
                      type="search"
                      value={consultorModalSearch}
                      onChange={(e) => setConsultorModalSearch(e.target.value)}
                      placeholder="Buscar consultor por nome ou e-mail…"
                      className="w-full px-3 py-2 border border-gray-200 dark:border-[#404040] rounded-xl text-sm text-gray-800 dark:text-gray-100 bg-white dark:bg-[#2a2a2a] mb-2"
                    />
                    <div className="border border-gray-200 dark:border-[#404040] rounded-xl bg-white dark:bg-[#2a2a2a] max-h-56 overflow-y-auto divide-y divide-gray-100 dark:divide-[#383838]">
                      {consultorModalFilteredOptions.length === 0 ? (
                        <p className="px-3 py-3 text-xs text-gray-500">Nenhum consultor encontrado.</p>
                      ) : (
                        consultorModalFilteredOptions.map((consultor) => {
                          const checked = consultorModalSelectedIds.includes(String(consultor.id));
                          return (
                            <label key={consultor.id} className="flex items-start gap-2 px-3 py-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-[#333]">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  setCampaignConsultorDraft((prev) => {
                                    const current = new Set(prev[consultorModalCampaignKey] ?? consultorModalSelectedIds);
                                    if (e.target.checked) current.add(String(consultor.id));
                                    else current.delete(String(consultor.id));
                                    return { ...prev, [consultorModalCampaignKey]: Array.from(current) };
                                  });
                                }}
                                className="mt-0.5 rounded border-gray-300 text-[#8CD955] focus:ring-[#8CD955]"
                              />
                              <span className="min-w-0">
                                <span className="block text-sm text-gray-900 dark:text-gray-50">{consultor.full_name || 'Sem nome'}</span>
                                <span className="block text-xs text-gray-500 dark:text-gray-400 break-all">{consultor.email}</span>
                              </span>
                            </label>
                          );
                        })
                      )}
                    </div>
                    <p className="text-[11px] text-gray-500 mt-1">
                      Selecionados: <span className="font-semibold text-gray-700">{consultorModalSelectedIds.length}</span>
                    </p>
                  </div>
                </>
              ) : (
                <p className="text-sm text-gray-500">Nenhuma campanha disponível para atribuição.</p>
              )}
            </div>
            <div className="px-5 py-4 border-t border-gray-100 dark:border-[#383838] flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConsultorModalOpen(false)}
                className="px-4 py-2 rounded-xl border border-gray-200 dark:border-[#404040] text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#333]"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={!selectedConsultorModalRow || campaignConsultorSavingKey === consultorModalCampaignKey}
                onClick={async () => {
                  if (!selectedConsultorModalRow) return;
                  const ok = await handleSaveCampaignConsultors(selectedConsultorModalRow);
                  if (ok) setConsultorModalOpen(false);
                }}
                className="px-4 py-2 rounded-xl bg-[#8CD955] hover:bg-[#7BC84A] disabled:opacity-50 text-white text-sm font-medium"
              >
                {campaignConsultorSavingKey === consultorModalCampaignKey ? 'Salvando…' : 'Salvar atribuição'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Nova integração */}
      {newIntegrationOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="bg-white dark:bg-[#252525] rounded-2xl shadow-xl border border-gray-200 dark:border-[#404040] w-full max-w-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 dark:border-[#383838] flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-900 dark:text-gray-50">Criar nova integração Meta</h3>
              <button
                type="button"
                onClick={() => setNewIntegrationOpen(false)}
                className="px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-[#333] hover:bg-gray-200 dark:hover:bg-[#404040] text-sm text-gray-700 dark:text-gray-200"
              >
                Fechar
              </button>
            </div>
            <div className="p-5 space-y-4">
              {newIntegrationError ? (
                <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300">{newIntegrationError}</div>
              ) : null}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">Bancas desta integração</label>
                  <div className="max-h-44 overflow-auto border border-gray-200 dark:border-[#404040] rounded-xl p-3 bg-white dark:bg-[#2a2a2a] space-y-2">
                    {bancas.map((b) => {
                      const checked = newIntegrationForm.banca_ids.includes(b.id);
                      return (
                        <label key={b.id} className="flex items-start gap-2 text-sm text-gray-800 dark:text-gray-100">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              const next = e.target.checked
                                ? [...newIntegrationForm.banca_ids, b.id]
                                : newIntegrationForm.banca_ids.filter((x) => x !== b.id);
                              setNewIntegrationForm((f) => ({ ...f, banca_ids: next }));
                            }}
                            className="mt-1 rounded border-gray-300 text-[#8CD955] focus:ring-[#8CD955]"
                          />
                          <span className="min-w-0">
                            <span className="font-medium">{b.name || b.url}</span>
                            {b.url ? <span className="block text-xs text-gray-500 break-all">{b.url}</span> : null}
                          </span>
                        </label>
                      );
                    })}
                    {bancas.length === 0 ? (
                      <p className="text-sm text-gray-500">Nenhuma banca disponível.</p>
                    ) : null}
                  </div>
                  <p className="text-xs text-gray-500 mt-2">
                    Adiciona outra integração Meta para as bancas marcadas; as que já existiam continuam vinculadas (várias contas/tokens por banca).
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Base URL Meta</label>
                  <input
                    type="text"
                    value={newIntegrationForm.base_url}
                    onChange={(e) => setNewIntegrationForm((f) => ({ ...f, base_url: e.target.value }))}
                    className="w-full px-4 py-2 border border-gray-200 dark:border-[#404040] rounded-xl text-gray-800 dark:text-gray-100 bg-white dark:bg-[#2a2a2a]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Access Token</label>
                  <input
                    type="password"
                    value={newIntegrationForm.access_token}
                    onChange={(e) => setNewIntegrationForm((f) => ({ ...f, access_token: e.target.value }))}
                    placeholder="Token do System User"
                    className="w-full px-4 py-2 border border-gray-200 dark:border-[#404040] rounded-xl text-gray-800 dark:text-gray-100 bg-white dark:bg-[#2a2a2a] placeholder:text-gray-500 dark:placeholder:text-gray-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Ad Account ID(s)</label>
                  <input
                    type="text"
                    value={newIntegrationForm.ad_account_id}
                    onChange={(e) => setNewIntegrationForm((f) => ({ ...f, ad_account_id: e.target.value }))}
                    placeholder="act_123456789, act_987654321"
                    className="w-full px-4 py-2 border border-gray-200 dark:border-[#404040] rounded-xl text-gray-800 dark:text-gray-100 bg-white dark:bg-[#2a2a2a] placeholder:text-gray-500 dark:placeholder:text-gray-500"
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Para múltiplas contas, separe por vírgula: <span className="font-mono">act_111, act_222</span></p>
                  {parseAdAccountIdsField(newIntegrationForm.ad_account_id).length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-2" aria-label="Contas de anúncio configuradas">
                      {parseAdAccountIdsField(newIntegrationForm.ad_account_id).map((act, idx) => (
                        <span
                          key={`${act}-${idx}`}
                          className="inline-flex items-center gap-1 rounded-lg border border-gray-200 dark:border-[#404040] bg-gray-50 dark:bg-[#333] px-2 py-1 text-xs font-mono text-gray-800 dark:text-gray-100"
                        >
                          <span title={act}>{formatActShort(act)}</span>
                          <button
                            type="button"
                            aria-label={`Remover conta ${act}`}
                            onClick={() =>
                              setNewIntegrationForm((f) => ({
                                ...f,
                                ad_account_id: adAccountIdsFieldWithoutIndex(f.ad_account_id, idx),
                              }))
                            }
                            className="rounded p-0.5 text-gray-500 hover:bg-red-100 hover:text-red-700 dark:hover:bg-red-900/40 dark:hover:text-red-300"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Pixel ID</label>
                  <input
                    type="text"
                    value={newIntegrationForm.pixel_id}
                    onChange={(e) => setNewIntegrationForm((f) => ({ ...f, pixel_id: e.target.value }))}
                    placeholder="1234567890"
                    className="w-full px-4 py-2 border border-gray-200 dark:border-[#404040] rounded-xl text-gray-800 dark:text-gray-100 bg-white dark:bg-[#2a2a2a] placeholder:text-gray-500 dark:placeholder:text-gray-500"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Campanha padrão (opcional)</label>
                  <input
                    type="text"
                    value={newIntegrationForm.default_campaign_id}
                    onChange={(e) => setNewIntegrationForm((f) => ({ ...f, default_campaign_id: e.target.value }))}
                    placeholder="campaign_id"
                    className="w-full px-4 py-2 border border-gray-200 dark:border-[#404040] rounded-xl text-gray-800 dark:text-gray-100 bg-white dark:bg-[#2a2a2a] placeholder:text-gray-500 dark:placeholder:text-gray-500"
                  />
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setNewIntegrationOpen(false)}
                  className="px-4 py-2 rounded-xl border border-gray-200 dark:border-[#404040] text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-[#333]"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleCreateIntegration}
                  disabled={newIntegrationSaving}
                  className="px-4 py-2 rounded-xl bg-[#8CD955] hover:bg-[#7BC84A] text-white font-medium disabled:opacity-50"
                >
                  {newIntegrationSaving ? 'Salvando…' : 'Criar integração'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
