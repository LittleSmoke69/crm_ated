'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useRequireAuth } from '@/utils/useRequireAuth';
import { useRouter } from 'next/navigation';
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
} from 'lucide-react';
import Funnel3DChart from '@/components/Charts/Funnel3DChart';

interface Banca {
  id: string;
  name: string;
  url: string;
}

interface MetaConfig {
  configured: boolean;
  integration_id?: string | null;
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

interface MetaOverviewRow {
  banca_id: string;
  banca_name: string;
  banca_url: string;
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

interface RedirectSummaryTotals {
  total_clicks: number;
  total_groups: number;
  active_groups: number;
  redirect_slugs: number;
  active_redirect_slugs: number;
  vsl_projects: number;
}

interface RedirectSummaryProjectRow {
  project_id: string;
  name: string;
  project_slug: string;
  redirect_slug: string | null;
  redirect_active: boolean | null;
  clicks: number;
  groups_total: number;
  groups_active: number;
}

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

export default function AdminMetaPage() {
  const { checking, userId } = useRequireAuth();
  const router = useRouter();
  const [bancas, setBancas] = useState<Banca[]>([]);
  /** Bancas vinculadas à integração em edição (multiseleção). */
  const [selectedBancaIds, setSelectedBancaIds] = useState<string[]>([]);
  /** Dropdown multiseleção — detalhes da integração */
  const [bancaPickerOpen, setBancaPickerOpen] = useState(false);
  const [bancaPickerSearch, setBancaPickerSearch] = useState('');
  const bancaPickerRef = useRef<HTMLDivElement | null>(null);
  const overviewFilterBancaRef = useRef<HTMLDivElement | null>(null);
  /** Evita re-disparar auto-sync da mesma combinação user+bancas no mesmo mount. */
  const autoSyncRunKeyRef = useRef<string>('');
  const [configLoadError, setConfigLoadError] = useState<string | null>(null);
  const [config, setConfig] = useState<MetaConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [autoSyncing, setAutoSyncing] = useState(false);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; me?: any; adAccounts?: any[]; error?: string } | null>(null);
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

  const [redirectSummary, setRedirectSummary] = useState<{
    totals: RedirectSummaryTotals;
    projects: RedirectSummaryProjectRow[];
  } | null>(null);
  const [loadingRedirectSummary, setLoadingRedirectSummary] = useState(false);
  const [redirectSummaryError, setRedirectSummaryError] = useState<string | null>(null);

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
    };
    campaigns: Array<Record<string, unknown>>;
    integrations: Array<Record<string, unknown>>;
  } | null>(null);
  const [loadingLiveAggregate, setLoadingLiveAggregate] = useState(false);
  const [liveAggregateError, setLiveAggregateError] = useState<string | null>(null);

  // Modal: criar nova integração
  const [newIntegrationOpen, setNewIntegrationOpen] = useState(false);
  const [newIntegrationSaving, setNewIntegrationSaving] = useState(false);
  const [newIntegrationError, setNewIntegrationError] = useState<string | null>(null);
  const [newIntegrationForm, setNewIntegrationForm] = useState({
    banca_ids: [] as string[],
    base_url: 'https://graph.facebook.com/v19.0',
    access_token: '',
    ad_account_id: '',
    pixel_id: '',
    default_campaign_id: '',
  });

  // Todas as campanhas (todas as integrações)
  const [allCampaignsRows, setAllCampaignsRows] = useState<any[]>([]);
  const [allCampaignsLoading, setAllCampaignsLoading] = useState(false);
  const [allCampaignsError, setAllCampaignsError] = useState<string | null>(null);
  const [allCampaignsSearch, setAllCampaignsSearch] = useState('');
  // Default em "true" para mostrar também campanhas PAUSED com métricas (comum em Meta).
  const [allCampaignsShowInactive, setAllCampaignsShowInactive] = useState(true);
  const [allCampaignsKindFilter, setAllCampaignsKindFilter] = useState<'all' | MetaCampaignKind>('all');
  const [allCampaignsPage, setAllCampaignsPage] = useState(1);
  const [campaignOwnerDraft, setCampaignOwnerDraft] = useState<Record<string, string>>({});
  const [campaignOwnerSavingKey, setCampaignOwnerSavingKey] = useState<string | null>(null);
  const [campaignKindSavingKey, setCampaignKindSavingKey] = useState<string | null>(null);
  const [campaignConsultorDraft, setCampaignConsultorDraft] = useState<Record<string, string[]>>({});
  const [campaignConsultorSavingKey, setCampaignConsultorSavingKey] = useState<string | null>(null);
  const [consultorsByBanca, setConsultorsByBanca] = useState<Record<string, Array<{ id: string; email: string; full_name: string | null }>>>({});
  const [consultorModalOpen, setConsultorModalOpen] = useState(false);
  const [consultorModalCampaignKey, setConsultorModalCampaignKey] = useState<string>('');
  const [consultorModalSearch, setConsultorModalSearch] = useState('');
  const ALL_CAMPAIGNS_PAGE_SIZE = 20;
  const SYNCED_DATA_PAGE_SIZE = 5;

  const [form, setForm] = useState({
    base_url: 'https://graph.facebook.com/v19.0',
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

  const loadConfig = useCallback(async (idsOverride?: string[]) => {
    const ids = (idsOverride?.length ? idsOverride : selectedBancaIds).map((x) => String(x).trim()).filter(Boolean);
    if (!ids.length || !userId) return;
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
        setConfig(data.data);
        setEditingToken(false);
        setAccessTokenRevealed(false);
        setRevealTokenError(null);
        const d = data.data;
        setForm((f) => ({
          ...f,
          base_url:
            d.base_url != null && String(d.base_url).trim() !== '' ? String(d.base_url) : f.base_url,
          ad_account_id: d.ad_account_id != null ? String(d.ad_account_id) : '',
          pixel_id: d.pixel_id != null ? String(d.pixel_id) : '',
          default_campaign_id: d.default_campaign_id != null ? String(d.default_campaign_id) : '',
          access_token: '',
        }));
      }
    } catch (err) {
      console.error(err);
      setConfig(null);
      setEditingToken(false);
      setAccessTokenRevealed(false);
      setRevealTokenError(null);
      setConfigLoadError('Erro de rede ao carregar integração');
      setTestResult({ success: false, error: 'Erro de rede ao carregar integração' });
    } finally {
      setLoading(false);
    }
  }, [selectedBancaIds, userId]);

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
          if (data.data.length > 0 && selectedBancaIds.length === 0) {
            setSelectedBancaIds([data.data[0].id]);
          }
        }
      } catch (err) {
        console.error(err);
      }
    };
    fetchBancas();
  }, [userId]);

  useEffect(() => {
    if (selectedBancaIds.length > 0) void loadConfig();
  }, [selectedBancaIds.join(','), loadConfig]);

  const configuredBancaMeta = useMemo(() => {
    const m = new Map<string, { configured: boolean; is_active: boolean }>();
    for (const r of overviewRows) {
      m.set(r.banca_id, { configured: r.configured, is_active: r.is_active });
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

  /** Para APIs que exigem um único banca_id: prefere uma banca já vinculada à integração carregada. */
  const primaryBancaId =
    overviewFilterBancaId ||
    (config?.configured && Array.isArray(config.banca_ids)
      ? selectedBancaIds.find((id) => config.banca_ids!.includes(id)) ?? selectedBancaIds[0] ?? ''
      : selectedBancaIds[0] ?? '');

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
        const d = data.data as { campaigns?: any[]; adsets?: any[]; insights?: any[] };
        const c0 = d.campaigns?.[0];
        const a0 = d.adsets?.[0];
        const i0 = d.insights?.[0];
        console.log('[admin/meta] dados sincronizados (campos por tabela)', {
          campaigns: { n: d.campaigns?.length ?? 0, fields: c0 ? Object.keys(c0) : [], sample: c0 },
          adsets: { n: d.adsets?.length ?? 0, fields: a0 ? Object.keys(a0) : [], sample: a0 },
          insights: { n: d.insights?.length ?? 0, fields: i0 ? Object.keys(i0) : [], sample: i0 },
        });
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
      if (overviewFilterBancaId) qs.set('banca_id', overviewFilterBancaId);
      const url = qs.toString() ? `/api/admin/meta/overview?${qs.toString()}` : '/api/admin/meta/overview';
      const res = await fetch(url, {
        headers: { 'X-User-Id': userId },
        cache: 'no-store',
      });
      const data = await res.json();
      if (data.success && Array.isArray(data.data?.rows)) {
        setOverviewRows(data.data.rows);
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
        setOverviewKindSummary({
          normal: { campaigns: 0, reach: 0, impressions: 0, clicks: 0, leads: 0, spend: 0, insights_rows: 0 },
          bolao: { campaigns: 0, reach: 0, impressions: 0, clicks: 0, leads: 0, spend: 0, insights_rows: 0 },
        });
        setOverviewError(data.error || 'Erro ao carregar visão geral das integrações.');
      }
    } catch (err: any) {
      setOverviewRows([]);
      setOverviewKindSummary({
        normal: { campaigns: 0, reach: 0, impressions: 0, clicks: 0, leads: 0, spend: 0, insights_rows: 0 },
        bolao: { campaigns: 0, reach: 0, impressions: 0, clicks: 0, leads: 0, spend: 0, insights_rows: 0 },
      });
      setOverviewError(err?.message || 'Erro ao carregar visão geral das integrações.');
    } finally {
      setLoadingOverview(false);
    }
  }, [userId, adminMetaInsightsDateRange.dateFrom, adminMetaInsightsDateRange.dateTo, overviewFilterBancaId]);

  const loadRedirectSummary = useCallback(async () => {
    if (!userId) return;
    setLoadingRedirectSummary(true);
    setRedirectSummaryError(null);
    try {
      const qs = new URLSearchParams();
      if (adminMetaInsightsDateRange.dateFrom) qs.set('date_from', adminMetaInsightsDateRange.dateFrom);
      if (adminMetaInsightsDateRange.dateTo) qs.set('date_to', adminMetaInsightsDateRange.dateTo);
      const url = qs.toString() ? `/api/admin/meta/redirect-summary?${qs.toString()}` : '/api/admin/meta/redirect-summary';
      const res = await fetch(url, {
        headers: { 'X-User-Id': userId },
        cache: 'no-store',
      });
      const data = await res.json();
      if (data.success && data.data?.totals && Array.isArray(data.data.projects)) {
        setRedirectSummary({ totals: data.data.totals, projects: data.data.projects });
      } else {
        setRedirectSummary(null);
        setRedirectSummaryError(data.error || 'Erro ao carregar resumo de redirects.');
      }
    } catch (err: any) {
      setRedirectSummary(null);
      setRedirectSummaryError(err?.message || 'Erro ao carregar resumo de redirects.');
    } finally {
      setLoadingRedirectSummary(false);
    }
  }, [userId, adminMetaInsightsDateRange.dateFrom, adminMetaInsightsDateRange.dateTo]);

  const loadLiveAggregate = useCallback(async () => {
    if (!userId) return;
    setLoadingLiveAggregate(true);
    setLiveAggregateError(null);
    try {
      const params = new URLSearchParams();
      if (adminMetaInsightsDateRange.dateFrom) params.set('date_from', adminMetaInsightsDateRange.dateFrom);
      if (adminMetaInsightsDateRange.dateTo) params.set('date_to', adminMetaInsightsDateRange.dateTo);
      if (overviewFilterBancaId) params.set('banca_id', overviewFilterBancaId);
      if (selectedBancaIds.length > 0) params.set('scope_banca_ids', selectedBancaIds.join(','));
      params.set('active_only', allCampaignsShowInactive ? '0' : '1');
      const res = await fetch(`/api/admin/meta/live-aggregate?${params.toString()}`, {
        headers: { 'X-User-Id': userId },
        cache: 'no-store',
      });
      const data = await res.json();
      if (data.success && data.data) {
        setLiveAggregate(data.data);
      } else {
        setLiveAggregate(null);
        setLiveAggregateError(data.error || 'Não foi possível carregar métricas em tempo real da Meta.');
      }
    } catch (err: unknown) {
      setLiveAggregate(null);
      setLiveAggregateError(err instanceof Error ? err.message : 'Erro ao carregar métricas em tempo real.');
    } finally {
      setLoadingLiveAggregate(false);
    }
  }, [
    userId,
    adminMetaInsightsDateRange.dateFrom,
    adminMetaInsightsDateRange.dateTo,
    overviewFilterBancaId,
    selectedBancaIds,
    allCampaignsShowInactive,
  ]);

  useEffect(() => {
    if (primaryBancaId) loadSyncedData();
    else setSyncedData(null);
  }, [primaryBancaId, loadSyncedData]);

  useEffect(() => {
    if (!userId) return;
    void loadOverview();
    void loadRedirectSummary();
    void loadLiveAggregate();
  }, [userId, loadOverview, loadRedirectSummary, loadLiveAggregate]);

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
    const contextBancaId =
      config?.configured && config.integration_id && Array.isArray(config.banca_ids)
        ? ids.find((id) => config.banca_ids!.includes(id)) ?? ids[0]
        : ids[0];
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

  const handleTestConnection = async () => {
    if (!userId || !primaryBancaId) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/admin/meta/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
        body: JSON.stringify({ banca_id: primaryBancaId }),
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
      const res = await fetch('/api/admin/meta/reveal-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
        body: JSON.stringify({ banca_id: primaryBancaId }),
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
      const res = await fetch(`/api/admin/meta/campaigns?banca_id=${encodeURIComponent(primaryBancaId)}`, {
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
    setAutoSyncing(true);
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
          loadRedirectSummary(),
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

  const autoSyncOnPageRefresh = useCallback(async () => {
    if (!userId) return;
    const ids = Array.from(new Set(selectedBancaIds.map((x) => String(x).trim()).filter(Boolean)));
    if (ids.length === 0) return;

    const runKey = `${userId}:${ids.slice().sort().join(',')}`;
    if (autoSyncRunKeyRef.current === runKey) return;
    autoSyncRunKeyRef.current = runKey;

    setSyncing(true);
    setSyncResult(null);
    try {
      const settled = await Promise.allSettled(
        ids.map(async (bancaId) => {
          const res = await fetch('/api/admin/meta/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
            body: JSON.stringify({ banca_id: bancaId, date_preset: 'last_30d' }),
            cache: 'no-store',
          });
          const data = await res.json();
          if (!(data.success && data.data?.success)) {
            throw new Error(data?.data?.error || data?.error || `Falha ao sincronizar banca ${bancaId}`);
          }
          return {
            campaignsCount: Number(data.data?.campaignsCount) || 0,
            adsetsCount: Number(data.data?.adsetsCount) || 0,
            insightsCount: Number(data.data?.insightsCount) || 0,
          };
        })
      );

      const ok = settled.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<{
        campaignsCount: number;
        adsetsCount: number;
        insightsCount: number;
      }>[];
      const fail = settled.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];

      const totals = ok.reduce(
        (acc, r) => {
          acc.campaignsCount += r.value.campaignsCount;
          acc.adsetsCount += r.value.adsetsCount;
          acc.insightsCount += r.value.insightsCount;
          return acc;
        },
        { campaignsCount: 0, adsetsCount: 0, insightsCount: 0 }
      );

      if (fail.length === 0) {
        setSyncResult({ success: true, ...totals });
      } else {
        const firstErr = fail[0]?.reason;
        setSyncResult({
          success: false,
          error: firstErr instanceof Error ? firstErr.message : 'Uma ou mais integrações falharam ao sincronizar.',
        });
      }
    } catch (err: any) {
      // Não sobrescreve feedback do sync manual; auto-sync falha de forma silenciosa para o usuário.
      console.warn('[admin/meta] autoSyncOnPageRefresh falhou:', err?.message || err);
    } finally {
      setAllCampaignsPage(1);
      void Promise.allSettled([
        loadConfig(selectedBancaIds),
        loadSyncedData(),
        loadOverview(),
        loadRedirectSummary(),
        loadLiveAggregate(),
      ]);
      setAutoSyncing(false);
    }
  }, [userId, selectedBancaIds, loadConfig, loadSyncedData, loadOverview, loadRedirectSummary, loadLiveAggregate]);

  useEffect(() => {
    if (!userId || selectedBancaIds.length === 0) return;
    void autoSyncOnPageRefresh();
  }, [userId, selectedBancaIds, autoSyncOnPageRefresh]);

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
        for (const row of data.data.rows as any[]) {
          const key = `${String(row.banca_id)}:${String(row.campaign_id)}`;
          nextDraft[key] = Array.isArray(row.assigned_consultors)
            ? row.assigned_consultors.map((c: any) => String(c.id)).filter(Boolean)
            : [];
        }
        setCampaignConsultorDraft(nextDraft);
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
    async (bancaId: string, campaignId: string, campaign_kind: MetaCampaignKind) => {
      if (!userId) return;
      const key = `${bancaId}:${campaignId}`;
      setCampaignKindSavingKey(key);
      setAllCampaignsError(null);
      try {
        const res = await fetch('/api/admin/meta/campaign-kind', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
          body: JSON.stringify({ banca_id: bancaId, campaign_id: campaignId, campaign_kind }),
        });
        const data = await res.json();
        if (!data.success) {
          setAllCampaignsError(data.error || 'Erro ao salvar tipo de campanha.');
          return;
        }
        await loadAllCampaigns();
        await loadOverview();
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
    [userId, loadAllCampaigns, loadOverview, loadSyncedData, primaryBancaId]
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
      setConsultorsByBanca(Object.fromEntries(entries));
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
      const res = await fetch('/api/admin/meta/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
        body: JSON.stringify({
          banca_ids: newIntegrationForm.banca_ids,
          base_url: newIntegrationForm.base_url,
          access_token: newIntegrationForm.access_token || undefined,
          ad_account_id: newIntegrationForm.ad_account_id,
          pixel_id: newIntegrationForm.pixel_id,
          default_campaign_id: newIntegrationForm.default_campaign_id || null,
          is_active: true,
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

  const cardOverviewRows = filteredOverviewRows;

  const overviewTotals = cardOverviewRows.reduce(
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
  const consultorTotalsFromCampaignRows = (allCampaignsRows ?? []).reduce(
    (acc, row: any) => {
      acc.leads += Number(row.consultor_total_leads) || 0;
      acc.deposited += Number(row.consultor_total_deposited) || 0;
      return acc;
    },
    { leads: 0, deposited: 0 }
  );
  /** Campanhas com dados de métricas para seção "Campanhas sincronizadas" (independe de status ACTIVE/PAUSED). */
  const metricSyncedCampaignRows = useMemo(
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
  const activeCampaignCardsTotals = useMemo(
    () =>
      metricSyncedCampaignRows.reduce(
        (acc, row: any) => {
          acc.campaigns += 1;
          acc.impressions += Number(row?.impressions) || 0;
          acc.clicks += Number(row?.clicks) || 0;
          acc.leads += Number(row?.leads) || 0;
          acc.spend += Number(row?.spend) || 0;
          return acc;
        },
        { campaigns: 0, impressions: 0, clicks: 0, leads: 0, spend: 0 }
      ),
    [metricSyncedCampaignRows]
  );

  const usingLiveMetaCards = Boolean(liveAggregate && !liveAggregateError);

  const displayCampaignCardsTotals = useMemo(() => {
    if (usingLiveMetaCards && liveAggregate) {
      const t = liveAggregate.totals;
      return {
        campaigns: t.campaigns_with_metrics,
        spend: t.spend,
        leads: t.leads,
        impressions: t.impressions,
        clicks: t.clicks,
        reach: t.reach,
        results: t.results,
      };
    }
    return {
      campaigns: activeCampaignCardsTotals.campaigns,
      spend: activeCampaignCardsTotals.spend,
      leads: activeCampaignCardsTotals.leads,
      impressions: activeCampaignCardsTotals.impressions,
      clicks: activeCampaignCardsTotals.clicks,
      reach: 0,
      results: 0,
    };
  }, [usingLiveMetaCards, liveAggregate, activeCampaignCardsTotals]);

  /** Linhas da tabela: prioriza métricas live (Graph) cruzadas com cadastro local para tipo/consultores. */
  const displayMetricCampaignRows = useMemo(() => {
    if (!usingLiveMetaCards || !liveAggregate) return metricSyncedCampaignRows;
    const liveList = (liveAggregate.campaigns ?? []) as Array<Record<string, unknown>>;
    return liveList.map((row) => {
      const bancaId = String(row.banca_id ?? '');
      const campaignId = String(row.campaign_id ?? '');
      const dbRow = (allCampaignsRows ?? []).find(
        (r: any) => String(r.banca_id) === bancaId && String(r.campaign_id) === campaignId
      );
      return {
        ...(dbRow || {}),
        id: dbRow?.id ?? campaignId,
        banca_id: bancaId,
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
        campaign_kind: (dbRow?.campaign_kind as MetaCampaignKind) || 'normal',
        reach: Number(row.reach) || 0,
        impressions: Number(row.impressions) || 0,
        clicks: Number(row.clicks) || 0,
        leads: Number(row.leads) || 0,
        spend: Number(row.spend) || 0,
        results_live: Number(row.results) || 0,
        assigned_consultors: dbRow?.assigned_consultors ?? [],
        consultor_total_leads: dbRow?.consultor_total_leads ?? 0,
        consultor_total_deposited: dbRow?.consultor_total_deposited ?? 0,
      };
    });
  }, [usingLiveMetaCards, liveAggregate, metricSyncedCampaignRows, allCampaignsRows]);

  const funnelMetaValues = useMemo(() => {
    if (usingLiveMetaCards && liveAggregate) {
      const t = liveAggregate.totals;
      return {
        impressions: t.impressions,
        reach: t.reach,
        clicks: t.clicks,
        leads: t.leads,
      };
    }
    return {
      impressions: overviewRows.reduce((sum, row) => sum + (Number(row.metrics.impressions) || 0), 0),
      reach: overviewRows.reduce((sum, row) => sum + (Number(row.metrics.reach) || 0), 0),
      clicks: overviewRows.reduce((sum, row) => sum + (Number(row.metrics.clicks) || 0), 0),
      leads: overviewTotals.totalLeads,
    };
  }, [usingLiveMetaCards, liveAggregate, overviewRows, overviewTotals.totalLeads]);

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

  useEffect(() => {
    const contributors = cardOverviewRows.map((row) => ({
      banca_id: row.banca_id,
      banca_name: row.banca_name,
      spend: Number(row.metrics.spend) || 0,
      leads: Number(row.metrics.leads) || 0,
      insights_rows: Number(row.metrics.insights_rows) || 0,
    }));
    console.log('[admin/meta page] SOMA cards visão geral (Total gasto / Total de leads)', {
      selected_banca_ids: overviewSelectedBancaIds,
      rows_considered: contributors.length,
      totals: {
        totalSpend: overviewTotals.totalSpend,
        totalLeads: overviewTotals.totalLeads,
      },
      contributors,
    });
  }, [cardOverviewRows, overviewSelectedBancaIds, overviewTotals.totalLeads, overviewTotals.totalSpend]);

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
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-6 h-6 text-[#8CD955]" />
          <h1 className="text-2xl font-bold text-gray-800">Integração Meta Ads</h1>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <p className="text-gray-600">
            Gestão geral das integrações Meta Ads por banca, com status, métricas e campanhas sincronizadas.
          </p>
          <div className="shrink-0 flex items-end gap-2 flex-wrap">
            <div>
              <label className="block text-[11px] font-semibold text-gray-500 uppercase mb-1">Período Meta</label>
              <select
                value={metaInsightsPeriod}
                onChange={(e) => {
                  setMetaInsightsPeriod(e.target.value as typeof metaInsightsPeriod);
                  setOverviewPage(1);
                }}
                className="px-3 py-2 border border-gray-200 rounded-xl text-sm text-gray-800 bg-white min-w-[170px]"
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
              <label className="block text-[11px] font-semibold text-gray-500 uppercase mb-1">Banca Meta</label>
              <div className="relative min-w-[220px]" ref={overviewFilterBancaRef}>
                <button
                  type="button"
                  onClick={() => setOverviewFilterBancaOpen((v) => !v)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm text-gray-800 bg-white flex items-center justify-between gap-2"
                >
                  <span className="truncate">
                    {overviewFilterBancaId
                      ? (bancas.find((b) => b.id === overviewFilterBancaId)?.name ||
                         bancas.find((b) => b.id === overviewFilterBancaId)?.url ||
                         overviewFilterBancaId)
                      : 'Todas as bancas'}
                  </span>
                  <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform ${overviewFilterBancaOpen ? 'rotate-180' : ''}`} />
                </button>
                {overviewFilterBancaOpen ? (
                  <div className="absolute z-30 left-0 right-0 mt-1 rounded-xl border border-gray-200 bg-white shadow-lg overflow-hidden">
                    <input
                      type="search"
                      value={overviewFilterBancaSearch}
                      onChange={(e) => setOverviewFilterBancaSearch(e.target.value)}
                      placeholder="Buscar banca..."
                      className="w-full px-3 py-2.5 text-sm border-b border-gray-100 text-gray-800 placeholder:text-gray-400 focus:outline-none"
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
                          overviewFilterBancaId === '' ? 'bg-[#F1FAE8] text-[#6AAE39]' : 'text-gray-700 hover:bg-gray-50'
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
                            overviewFilterBancaId === b.id ? 'bg-[#F1FAE8] text-[#6AAE39]' : 'text-gray-700 hover:bg-gray-50'
                          }`}
                        >
                          {b.name || b.url}
                        </button>
                      ))}
                      {bancasForMetaFilter.length === 0 ? (
                        <p className="px-2.5 py-2 text-xs text-gray-500">Nenhuma banca encontrada.</p>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
            {metaInsightsPeriod === 'custom' && (
              <>
                <div>
                  <label className="block text-[11px] font-semibold text-gray-500 uppercase mb-1">De</label>
                  <input
                    type="date"
                    value={metaInsightsCustomFrom}
                    onChange={(e) => {
                      setMetaInsightsCustomFrom(e.target.value);
                      setOverviewPage(1);
                    }}
                    className="px-3 py-2 border border-gray-200 rounded-xl text-sm text-gray-800 bg-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-gray-500 uppercase mb-1">Até</label>
                  <input
                    type="date"
                    value={metaInsightsCustomTo}
                    onChange={(e) => {
                      setMetaInsightsCustomTo(e.target.value);
                      setOverviewPage(1);
                    }}
                    className="px-3 py-2 border border-gray-200 rounded-xl text-sm text-gray-800 bg-white"
                  />
                </div>
              </>
            )}
            <button
              type="button"
              onClick={() => {
                setNewIntegrationError(null);
                setNewIntegrationForm((f) => ({
                  ...f,
                  banca_ids: [],
                  base_url: 'https://graph.facebook.com/v19.0',
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

        <div className="flex flex-wrap items-center gap-2 mb-1 text-xs text-gray-600">
          {loadingLiveAggregate ? (
            <span className="inline-flex items-center gap-1 text-[#8CD955]">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Atualizando métricas direto da Meta…
            </span>
          ) : usingLiveMetaCards ? (
            <span className="text-emerald-700 font-medium">
              Métricas em tempo real (API Meta) · período do filtro · soma de todas as integrações no escopo
            </span>
          ) : null}
          {liveAggregateError ? <span className="text-amber-700">Live indisponível — exibindo cache local: {liveAggregateError}</span> : null}
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-7">
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
            <p className="text-xs font-semibold text-gray-500 uppercase">Campanhas com dados (métricas)</p>
            <p className="text-2xl font-bold text-gray-800 mt-1">{displayCampaignCardsTotals.campaigns.toLocaleString('pt-BR')}</p>
          </div>
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
            <p className="text-xs font-semibold text-gray-500 uppercase">Gasto total</p>
            <p className="text-2xl font-bold text-gray-800 mt-1">R$ {displayCampaignCardsTotals.spend.toFixed(2)}</p>
          </div>
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
            <p className="text-xs font-semibold text-gray-500 uppercase">Leads (Meta, período)</p>
            <p className="text-2xl font-bold text-gray-800 mt-1">{displayCampaignCardsTotals.leads.toLocaleString('pt-BR')}</p>
          </div>
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
            <p className="text-xs font-semibold text-gray-500 uppercase">Resultados (ações Meta)</p>
            <p className="text-2xl font-bold text-gray-800 mt-1">{displayCampaignCardsTotals.results.toLocaleString('pt-BR')}</p>
          </div>
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
            <p className="text-xs font-semibold text-gray-500 uppercase">Impressões</p>
            <p className="text-2xl font-bold text-gray-800 mt-1">{displayCampaignCardsTotals.impressions.toLocaleString('pt-BR')}</p>
          </div>
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
            <p className="text-xs font-semibold text-gray-500 uppercase">Cliques</p>
            <p className="text-2xl font-bold text-gray-800 mt-1">{displayCampaignCardsTotals.clicks.toLocaleString('pt-BR')}</p>
          </div>
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
            <p className="text-xs font-semibold text-gray-500 uppercase">Leads (painel geral / cache)</p>
            <p className="text-2xl font-bold text-gray-800 mt-1">{overviewTotals.totalLeads.toLocaleString('pt-BR')}</p>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 md:p-5">
          <div className="flex items-center gap-2 mb-2">
            <BarChart3 className="w-5 h-5 text-[#8CD955]" />
            <h2 className="text-base font-semibold text-gray-800">Funil de campanhas + consultores</h2>
          </div>
          <p className="text-xs text-gray-500 mb-4">
            {usingLiveMetaCards
              ? 'Meta em tempo real (API) no período do filtro + consultores ainda do cadastro local.'
              : 'Meta por período selecionado + cadastrados/depósito dos consultores atribuídos nas campanhas listadas.'}
          </p>
          <div className="bg-gray-50 p-3 rounded-xl border border-gray-100 min-h-[320px]">
            <Funnel3DChart
              data={{
                stages: ['Impressões', 'Alcance', 'Cliques', 'Leads Meta', 'Cadastros consultores', 'Depósito consultores (R$)'],
                values: [
                  funnelMetaValues.impressions,
                  funnelMetaValues.reach,
                  funnelMetaValues.clicks,
                  funnelMetaValues.leads,
                  consultorTotalsFromCampaignRows.leads,
                  consultorTotalsFromCampaignRows.deposited,
                ],
              }}
              showPlaceholder={!overviewRows.length && !allCampaignsRows.length && !usingLiveMetaCards}
            />
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 md:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
            <div className="flex items-center gap-2">
              <Link2 className="w-5 h-5 text-[#8CD955]" />
              <div>
                <h2 className="text-base font-semibold text-gray-800">Redirects VSL (todos os projetos)</h2>
                <p className="text-sm text-gray-600">
                  Cliques registrados, slugs públicos e grupos de destino agregados no sistema.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void loadRedirectSummary()}
              disabled={loadingRedirectSummary}
              className="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-xl font-medium text-gray-700 disabled:opacity-50 flex items-center gap-2 text-sm"
            >
              {loadingRedirectSummary ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Atualizar redirects
            </button>
          </div>
          {redirectSummaryError && (
            <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">
              {redirectSummaryError}
            </div>
          )}
          {loadingRedirectSummary && !redirectSummary ? (
            <div className="flex items-center justify-center py-12 text-gray-500 gap-2">
              <Loader2 className="w-6 h-6 animate-spin text-[#8CD955]" />
              Carregando…
            </div>
          ) : redirectSummary ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-6">
                <div className="rounded-xl border border-gray-100 bg-gray-50/80 p-3">
                  <p className="text-[11px] font-semibold text-gray-500 uppercase">Total de cliques</p>
                  <p className="text-xl font-bold text-gray-800 mt-0.5">
                    {redirectSummary.totals.total_clicks.toLocaleString('pt-BR')}
                  </p>
                </div>
                <div className="rounded-xl border border-gray-100 bg-gray-50/80 p-3">
                  <p className="text-[11px] font-semibold text-gray-500 uppercase">Grupos</p>
                  <p className="text-xl font-bold text-gray-800 mt-0.5">
                    {redirectSummary.totals.total_groups.toLocaleString('pt-BR')}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {redirectSummary.totals.active_groups.toLocaleString('pt-BR')} ativos
                  </p>
                </div>
                <div className="rounded-xl border border-gray-100 bg-gray-50/80 p-3">
                  <p className="text-[11px] font-semibold text-gray-500 uppercase">Slugs redirect</p>
                  <p className="text-xl font-bold text-gray-800 mt-0.5">
                    {redirectSummary.totals.redirect_slugs.toLocaleString('pt-BR')}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {redirectSummary.totals.active_redirect_slugs.toLocaleString('pt-BR')} ativos
                  </p>
                </div>
                <div className="rounded-xl border border-gray-100 bg-gray-50/80 p-3">
                  <p className="text-[11px] font-semibold text-gray-500 uppercase">Projetos VSL</p>
                  <p className="text-xl font-bold text-gray-800 mt-0.5">
                    {redirectSummary.totals.vsl_projects.toLocaleString('pt-BR')}
                  </p>
                </div>
              </div>
              <div className="overflow-x-auto max-h-[min(420px,50vh)] overflow-y-auto rounded-xl border border-gray-100">
                <table className="w-full min-w-[720px] text-sm">
                  <thead className="sticky top-0 bg-gray-50 text-gray-700 z-10">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold">Projeto</th>
                      <th className="px-3 py-2 text-left font-semibold">Slug redirect</th>
                      <th className="px-3 py-2 text-right font-semibold">Cliques</th>
                      <th className="px-3 py-2 text-right font-semibold">Grupos</th>
                      <th className="px-3 py-2 text-right font-semibold">Grupos ativos</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {redirectSummary.projects
                      .filter(
                        (r) =>
                          r.redirect_slug ||
                          r.clicks > 0 ||
                          r.groups_total > 0
                      )
                      .map((r) => (
                        <tr key={r.project_id} className="hover:bg-gray-50/80">
                          <td className="px-3 py-2 text-gray-800">
                            <span className="font-medium">{r.name}</span>
                            <span className="block text-xs text-gray-500">{r.project_slug}</span>
                          </td>
                          <td className="px-3 py-2 text-gray-700">
                            {r.redirect_slug ? (
                              <>
                                <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">{r.redirect_slug}</code>
                                {r.redirect_active === false && (
                                  <span className="ml-1 text-xs text-amber-600">inativo</span>
                                )}
                              </>
                            ) : (
                              <span className="text-gray-400">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{r.clicks.toLocaleString('pt-BR')}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{r.groups_total.toLocaleString('pt-BR')}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{r.groups_active.toLocaleString('pt-BR')}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
                {redirectSummary.projects.filter(
                  (r) => r.redirect_slug || r.clicks > 0 || r.groups_total > 0
                ).length === 0 && (
                  <p className="p-6 text-center text-gray-500 text-sm">
                    Nenhum projeto com redirect ou cliques ainda.
                  </p>
                )}
              </div>
            </>
          ) : null}
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-gray-100 bg-gray-50/50 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-gray-800">Visão geral de todas as bancas</h2>
              <p className="text-sm text-gray-600">Acompanhe integração e métricas Meta por banca.</p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <input
                value={overviewSearch}
                onChange={(e) => { setOverviewSearch(e.target.value); setOverviewPage(1); }}
                placeholder="Buscar banca por nome ou URL"
                className="px-3 py-2 border border-gray-200 rounded-xl text-sm text-gray-800 placeholder:text-gray-500 bg-white"
              />
              <button
                type="button"
                onClick={() => {
                  void loadOverview();
                  void loadRedirectSummary();
                }}
                disabled={loadingOverview}
                className="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-xl font-medium text-gray-700 disabled:opacity-50 flex items-center gap-2"
              >
                {loadingOverview ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                Atualizar
              </button>
            </div>
          </div>
          {overviewError && (
            <div className="mx-4 mt-4 p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">
              {overviewError}
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-sm">
              <thead className="bg-gray-50 text-gray-700">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold">Banca</th>
                  <th className="px-4 py-3 text-left font-semibold">Integração</th>
                  <th className="px-4 py-3 text-left font-semibold">Detalhes da integração</th>
                  <th className="px-4 py-3 text-left font-semibold">Último sync</th>
                  <th className="px-4 py-3 text-left font-semibold">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {pagedOverviewRows.map((row) => (
                    <tr key={row.banca_id} className="align-top hover:bg-gray-50/60">
                      <td className="px-4 py-3">
                        <p className="font-semibold text-gray-800">{row.banca_name}</p>
                        <p className="text-xs text-gray-500 break-all">{row.banca_url}</p>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${
                            row.configured
                              ? row.is_active
                                ? 'bg-emerald-100 text-emerald-700'
                                : 'bg-amber-100 text-amber-700'
                              : 'bg-gray-100 text-gray-600'
                          }`}
                        >
                          {row.configured ? (row.is_active ? 'Configurada e ativa' : 'Configurada (inativa)') : 'Sem integração'}
                        </span>
                        {row.last_sync_error ? (
                          <p className="text-xs text-red-600 mt-1 max-w-[220px]">{row.last_sync_error}</p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-700">
                        <p>Base URL: {row.base_url || '-'}</p>
                        <p>Ad Account: {row.ad_account_id || '-'}</p>
                        <p>Pixel: {row.pixel_id || '-'}</p>
                        <p>Token: {row.token_last4 ? `••••${row.token_last4}` : '-'}</p>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600">
                        <p>{formatDate(row.last_sync_at)}</p>
                        {row.last_sync_date_preset ? <p className="text-gray-500 mt-0.5">{row.last_sync_date_preset}</p> : null}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedBancaIds([row.banca_id]);
                            setSyncedData(null);
                            setTimeout(() => {
                              document.getElementById('dados-sincronizados-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                            }, 0);
                          }}
                          className="px-3 py-1.5 rounded-lg bg-[#8CD955] hover:bg-[#7BC84A] text-white text-xs font-medium"
                        >
                          Ver dados
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {/* Paginação */}
          {filteredOverviewRows.length > 0 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 bg-gray-50/40">
              <p className="text-xs text-gray-500">
                Exibindo{' '}
                <span className="font-semibold text-gray-700">
                  {(overviewPageSafe - 1) * OVERVIEW_PAGE_SIZE + 1}
                </span>{' '}
                a{' '}
                <span className="font-semibold text-gray-700">
                  {Math.min(overviewPageSafe * OVERVIEW_PAGE_SIZE, filteredOverviewRows.length)}
                </span>{' '}
                de{' '}
                <span className="font-semibold text-gray-700">{filteredOverviewRows.length}</span> bancas
              </p>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setOverviewPage(1)}
                  disabled={overviewPageSafe <= 1}
                  className="px-2 py-1.5 rounded-lg border border-gray-200 text-xs text-gray-600 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  «
                </button>
                <button
                  type="button"
                  onClick={() => setOverviewPage((p) => Math.max(1, p - 1))}
                  disabled={overviewPageSafe <= 1}
                  className="px-2.5 py-1.5 rounded-lg border border-gray-200 text-xs text-gray-600 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
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
                      <span key={`ellipsis-${idx}`} className="px-1.5 text-xs text-gray-400">…</span>
                    ) : (
                      <button
                        key={item}
                        type="button"
                        onClick={() => setOverviewPage(item as number)}
                        className={`px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                          overviewPageSafe === item
                            ? 'bg-[#8CD955] border-[#8CD955] text-white'
                            : 'border-gray-200 text-gray-600 hover:bg-gray-100'
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
                  className="px-2.5 py-1.5 rounded-lg border border-gray-200 text-xs text-gray-600 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Próximo ›
                </button>
                <button
                  type="button"
                  onClick={() => setOverviewPage(overviewTotalPages)}
                  disabled={overviewPageSafe >= overviewTotalPages}
                  className="px-2 py-1.5 rounded-lg border border-gray-200 text-xs text-gray-600 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  »
                </button>
              </div>
            </div>
          )}
          {!loadingOverview && overviewRows.length === 0 && !overviewError && (
            <div className="p-6 text-sm text-center text-gray-500">
              Nenhuma banca encontrada para exibir no painel geral.
            </div>
          )}
        </div>

        <div id="dados-sincronizados-section" className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 md:p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-semibold text-gray-800">Campanhas sincronizadas</h3>
              <p className="text-xs text-gray-500 mt-1">
                Tabela cruzada com Graph (live) + CRM. Período: {adminMetaInsightsDateRange.label}.
                {usingLiveMetaCards ? ' Métricas de alcance/impressões/leads/gasto vêm da Meta; tipo e consultores do banco.' : null}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  const first = (displayMetricCampaignRows || [])[0];
                  if (first) {
                    setConsultorModalCampaignKey(`${String(first.banca_id)}:${String(first.campaign_id)}`);
                  }
                  setConsultorModalOpen(true);
                }}
                disabled={displayMetricCampaignRows.length === 0}
                className="text-sm text-blue-700 hover:text-blue-800 font-medium flex items-center gap-1 disabled:opacity-40"
              >
                <Users className="w-4 h-4" />
                Atribuir consultores
              </button>
              <button
                type="button"
                onClick={() => void loadLiveAggregate()}
                disabled={loadingLiveAggregate || !userId}
                className="text-sm text-emerald-700 hover:text-emerald-800 font-medium flex items-center gap-1 disabled:opacity-50"
              >
                {loadingLiveAggregate ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                Meta live
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

          {syncedData ? (
            <>
              {loadingData ? (
                <div className="py-8 flex justify-center">
                  <Loader2 className="w-6 h-6 animate-spin text-[#8CD955]" />
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="border border-gray-200 rounded-xl overflow-hidden">
                    <button
                      onClick={() => setExpandedTab(expandedTab === 'campaigns' ? null : 'campaigns')}
                      className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition"
                    >
                      <span className="flex items-center gap-2 font-medium text-gray-800">
                        <Target className="w-4 h-4 text-[#8CD955]" />
                        Campanhas com dados ({displayMetricCampaignRows.length})
                      </span>
                      {expandedTab === 'campaigns' ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                    </button>
                    {expandedTab === 'campaigns' && (
                      <div className="overflow-x-auto max-h-80 overflow-y-auto">
                        <table className="w-full text-sm text-left min-w-[2220px]">
                          <thead className="bg-gray-100 text-gray-700 sticky top-0">
                            <tr>
                              <th className="px-4 py-2">Início</th>
                              <th className="px-4 py-2">Banca</th>
                              <th className="px-4 py-2">Nome</th>
                              <th className="px-4 py-2">Campaign ID</th>
                              <th className="px-4 py-2">Tipo</th>
                              <th className="px-4 py-2 text-right">Reach</th>
                              <th className="px-4 py-2 text-right">Impressões</th>
                              <th className="px-4 py-2 text-right">Cliques</th>
                              <th className="px-4 py-2 text-right">Leads</th>
                              <th className="px-4 py-2 text-right">Resultados</th>
                              <th className="px-4 py-2 text-right">Gasto</th>
                              <th className="px-4 py-2 text-right">Leads consultores</th>
                              <th className="px-4 py-2 text-right">Depósito consultores</th>
                              <th className="px-4 py-2">Status</th>
                              <th className="px-4 py-2">Objetivo</th>
                              <th className="px-4 py-2 text-right">Orçamento diário</th>
                              <th className="px-4 py-2 text-right">Orçamento total</th>
                              <th className="px-4 py-2">Fim</th>
                              <th className="px-4 py-2">Atualizado</th>
                              <th className="px-4 py-2">Atribuir banca</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {displayMetricCampaignRows.map((c: any) => {
                              const m = {
                                reach: Number(c.reach) || 0,
                                impressions: Number(c.impressions) || 0,
                                clicks: Number(c.clicks) || 0,
                                leads: Number(c.leads) || 0,
                                spend: Number(c.spend) || 0,
                                results: Number(c.results_live) || 0,
                              };
                              const ownerKey = `${String(c.banca_id)}:${String(c.campaign_id)}`;
                              const ownerTarget = campaignOwnerDraft[ownerKey] ?? String(c.banca_id);
                              return (
                                <tr key={c.id ?? c.campaign_id} className="hover:bg-gray-50">
                                  <td className="px-4 py-2 text-gray-700">{c.start_time ? formatDate(c.start_time) : '-'}</td>
                                  <td className="px-4 py-2 text-xs text-gray-600">
                                    <p className="font-medium text-gray-800">{c.banca_name || c.banca_id}</p>
                                    {c.banca_url ? <p className="text-[11px] text-gray-500 break-all">{c.banca_url}</p> : null}
                                  </td>
                                  <td className="px-4 py-2 font-medium text-gray-800">{c.name || c.campaign_id}</td>
                                  <td className="px-4 py-2 text-xs font-mono text-gray-700">{c.campaign_id || '-'}</td>
                                  <td className="px-4 py-2 align-top">
                                    {c.banca_id ? (
                                      <select
                                        value={(c.campaign_kind as MetaCampaignKind) || 'normal'}
                                        disabled={campaignKindSavingKey === `${String(c.banca_id)}:${String(c.campaign_id)}`}
                                        onChange={(e) => {
                                          const v = e.target.value as MetaCampaignKind;
                                          void handleSaveCampaignKind(String(c.banca_id), String(c.campaign_id), v);
                                        }}
                                        className="px-2 py-1 rounded-lg border border-gray-200 text-xs text-gray-800 bg-white max-w-[140px] disabled:opacity-50"
                                      >
                                        <option value="normal">Normal</option>
                                        <option value="bolao">Bolão</option>
                                      </select>
                                    ) : (
                                      <span className="text-xs text-gray-500">—</span>
                                    )}
                                  </td>
                                  <td className="px-4 py-2 text-right text-gray-700 tabular-nums">{m.reach.toLocaleString('pt-BR')}</td>
                                  <td className="px-4 py-2 text-right text-gray-700 tabular-nums">{m.impressions.toLocaleString('pt-BR')}</td>
                                  <td className="px-4 py-2 text-right text-gray-700 tabular-nums">{m.clicks.toLocaleString('pt-BR')}</td>
                                  <td className="px-4 py-2 text-right text-gray-700 tabular-nums">{m.leads.toLocaleString('pt-BR')}</td>
                                  <td className="px-4 py-2 text-right text-gray-700 tabular-nums">{m.results.toLocaleString('pt-BR')}</td>
                                  <td className="px-4 py-2 text-right text-gray-700 tabular-nums">R$ {m.spend.toFixed(2)}</td>
                                  <td className="px-4 py-2 text-right text-gray-700 tabular-nums">{(Number(c.consultor_total_leads) || 0).toLocaleString('pt-BR')}</td>
                                  <td className="px-4 py-2 text-right text-gray-700 tabular-nums">R$ {(Number(c.consultor_total_deposited) || 0).toFixed(2)}</td>
                                  <td className="px-4 py-2 text-gray-700">{c.effective_status || c.status || '-'}</td>
                                  <td className="px-4 py-2 text-gray-700">{c.objective || '-'}</td>
                                  <td className="px-4 py-2 text-right text-gray-700">{c.daily_budget != null ? `R$ ${Number(c.daily_budget).toFixed(2)}` : '-'}</td>
                                  <td className="px-4 py-2 text-right text-gray-700">{c.lifetime_budget != null ? `R$ ${Number(c.lifetime_budget).toFixed(2)}` : '-'}</td>
                                  <td className="px-4 py-2 text-gray-700">{c.stop_time ? formatDate(c.stop_time) : '-'}</td>
                                  <td className="px-4 py-2 text-xs text-gray-600">{c.updated_at ? formatDate(c.updated_at) : '-'}</td>
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
                                          className="px-2 py-1 rounded-lg border border-gray-200 text-xs text-gray-700 bg-white max-w-[220px]"
                                        >
                                          {bancas.map((b) => (
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
                                          className="px-3 py-1.5 rounded-lg border border-[#8CD955] text-[#6AAE39] hover:bg-[#F1FAE8] text-xs font-medium disabled:opacity-50"
                                        >
                                          {campaignOwnerSavingKey === ownerKey ? 'Salvando…' : 'Vincular banca'}
                                        </button>
                                      </div>
                                    ) : (
                                      <span className="text-xs text-gray-500">—</span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                        {(displayMetricCampaignRows?.length ?? 0) === 0 && (
                          <p className="px-4 py-6 text-center text-gray-500">
                            {usingLiveMetaCards
                              ? 'Nenhuma campanha com métrica no período (Meta live) para o filtro atual.'
                              : 'Nenhuma campanha sincronizada.'}
                          </p>
                        )}
                        {!usingLiveMetaCards && (allCampaignsRows?.length ?? 0) > 0 && (
                          <div className="px-4 py-3 border-t border-gray-100 bg-gray-50/40 flex items-center justify-between">
                            <p className="text-xs text-gray-500">Página {allCampaignsPage}</p>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => setAllCampaignsPage((p) => Math.max(1, p - 1))}
                                disabled={allCampaignsPage <= 1}
                                className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                              >
                                ‹ Anterior
                              </button>
                              <button
                                type="button"
                                onClick={() => setAllCampaignsPage((p) => p + 1)}
                                className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                              >
                                Próximo ›
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="border border-gray-200 rounded-xl overflow-hidden">
                    <button
                      onClick={() => setExpandedTab(expandedTab === 'adsets' ? null : 'adsets')}
                      className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition"
                    >
                      <span className="flex items-center gap-2 font-medium text-gray-800">
                        <Layers className="w-4 h-4 text-blue-600" />
                        AdSets ({syncedData.adsets?.length ?? 0})
                      </span>
                      {expandedTab === 'adsets' ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                    </button>
                    {expandedTab === 'adsets' && (
                      <div className="overflow-x-auto max-h-80 overflow-y-auto">
                        <table className="w-full text-sm text-left min-w-[700px]">
                          <thead className="bg-gray-100 text-gray-700 sticky top-0">
                            <tr>
                              <th className="px-4 py-2">Banca</th>
                              <th className="px-4 py-2">Nome</th>
                              <th className="px-4 py-2">Status</th>
                              <th className="px-4 py-2">Campanha ID</th>
                              <th className="px-4 py-2">Orçamento diário</th>
                              <th className="px-4 py-2">Otimização</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {pagedSyncedAdsetRows.map((a: any) => (
                              <tr key={a.id} className="hover:bg-gray-50">
                                <td className="px-4 py-2 text-xs text-gray-600">{selectedBancaName}</td>
                                <td className="px-4 py-2 font-medium text-gray-800">{a.name || a.adset_id}</td>
                                <td className="px-4 py-2 text-gray-700">{a.effective_status || a.status || '-'}</td>
                                <td className="px-4 py-2 text-xs text-gray-700">{a.campaign_id || '-'}</td>
                                <td className="px-4 py-2 text-gray-700">{a.daily_budget != null ? `R$ ${Number(a.daily_budget).toFixed(2)}` : '-'}</td>
                                <td className="px-4 py-2 text-gray-700">{a.optimization_goal || '-'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {(syncedData.adsets?.length ?? 0) === 0 && (
                          <p className="px-4 py-6 text-center text-gray-500">Nenhum adset sincronizado.</p>
                        )}
                        {(syncedData.adsets?.length ?? 0) > 0 && (
                          <div className="px-4 py-3 border-t border-gray-100 bg-gray-50/40 flex items-center justify-between">
                            <p className="text-xs text-gray-500">Página {syncedAdsetPage} de {syncedAdsetTotalPages}</p>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  setSyncedDataPage((prev) => ({ ...prev, adsets: Math.max(1, prev.adsets - 1) }))
                                }
                                disabled={syncedAdsetPage <= 1}
                                className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs text-gray-700 hover:bg-gray-100 disabled:opacity-50"
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
                                className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                              >
                                Próximo ›
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="border border-gray-200 rounded-xl overflow-hidden">
                    <button
                      onClick={() => setExpandedTab(expandedTab === 'insights' ? null : 'insights')}
                      className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition"
                    >
                      <span className="flex items-center gap-2 font-medium text-gray-800">
                        <TrendingUp className="w-4 h-4 text-purple-600" />
                        Insights diários ({syncedData.insights?.length ?? 0})
                      </span>
                      {expandedTab === 'insights' ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                    </button>
                    {expandedTab === 'insights' && (
                      <div className="overflow-x-auto max-h-96 overflow-y-auto">
                        <table className="w-full text-sm text-left min-w-[1080px]">
                          <thead className="bg-gray-100 text-gray-700 sticky top-0">
                            <tr>
                              <th className="px-4 py-2">Banca</th>
                              <th className="px-4 py-2">Data</th>
                              <th className="px-4 py-2">Campanha</th>
                              <th className="px-4 py-2"><Eye className="w-4 h-4 inline" /> Alcance</th>
                              <th className="px-4 py-2"><MousePointer className="w-4 h-4 inline" /> Impressões</th>
                              <th className="px-4 py-2">Cliques</th>
                              <th className="px-4 py-2"><DollarSign className="w-4 h-4 inline" /> Gasto</th>
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
                          <tbody className="divide-y divide-gray-100">
                            {pagedSyncedInsightRows.map((i: any) => {
                              const cpa = formatCostPerActionTypeCell(
                                i.raw_cost_per_action_type ?? i.cost_per_action_type
                              );
                              return (
                                <tr key={i.id} className="hover:bg-gray-50">
                                  <td className="px-4 py-2 text-xs text-gray-600">{selectedBancaName}</td>
                                  <td className="px-4 py-2 text-gray-700">{i.date}</td>
                                  <td className="px-4 py-2 font-medium text-gray-800">{i.campaign_name || i.campaign_id}</td>
                                  <td className="px-4 py-2 text-gray-700">{(i.reach ?? 0).toLocaleString('pt-BR')}</td>
                                  <td className="px-4 py-2 text-gray-700">{(i.impressions ?? 0).toLocaleString('pt-BR')}</td>
                                  <td className="px-4 py-2 text-gray-700">{(i.clicks ?? 0).toLocaleString('pt-BR')}</td>
                                  <td className="px-4 py-2 text-gray-700">R$ {(Number(i.spend ?? 0)).toFixed(2)}</td>
                                  <td className="px-4 py-2 text-gray-700">{(i.leads ?? 0).toLocaleString('pt-BR')}</td>
                                  <td className="px-4 py-2 text-gray-700">{i.cpm != null ? Number(i.cpm).toFixed(2) : '-'}</td>
                                  <td className="px-4 py-2 text-gray-700">{i.cpc != null ? Number(i.cpc).toFixed(2) : '-'}</td>
                                  <td className="px-4 py-2 text-gray-700">{i.ctr != null ? Number(i.ctr).toFixed(2) : '-'}</td>
                                  <td
                                    className="px-4 py-2 text-xs text-gray-700 max-w-[280px] truncate align-top"
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
                          <p className="px-4 py-6 text-center text-gray-500">Nenhum insight sincronizado. Execute a sincronização.</p>
                        )}
                        {(syncedData.insights?.length ?? 0) > 0 && (
                          <div className="px-4 py-3 border-t border-gray-100 bg-gray-50/40 flex items-center justify-between">
                            <p className="text-xs text-gray-500">Página {syncedInsightPage} de {syncedInsightTotalPages}</p>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  setSyncedDataPage((prev) => ({ ...prev, insights: Math.max(1, prev.insights - 1) }))
                                }
                                disabled={syncedInsightPage <= 1}
                                className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs text-gray-700 hover:bg-gray-100 disabled:opacity-50"
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
                                className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                              >
                                Próximo ›
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          ) : (
            <p className="py-4 text-sm text-gray-500">Selecione uma banca em &quot;Visão geral&quot; e clique em &quot;Ver dados&quot; para carregar.</p>
          )}
        </div>

        <div id="meta-config-section" className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-gray-100 bg-gray-50/50">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              <Building2 className="w-4 h-4 inline mr-2" />
              Bancas desta integração
            </label>
            <div className="relative max-w-xl" ref={bancaPickerRef}>
              <button
                type="button"
                aria-expanded={bancaPickerOpen}
                aria-haspopup="listbox"
                onClick={() => setBancaPickerOpen((o) => !o)}
                className="w-full flex items-center justify-between gap-3 px-4 py-3 border border-gray-200 rounded-xl bg-white text-left text-sm text-gray-800 hover:border-gray-300 transition-colors"
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
                  className="absolute z-30 left-0 right-0 mt-1 rounded-xl border border-gray-200 bg-white shadow-lg flex flex-col max-h-72 overflow-hidden"
                  role="listbox"
                  aria-multiselectable="true"
                >
                  <input
                    type="search"
                    value={bancaPickerSearch}
                    onChange={(e) => setBancaPickerSearch(e.target.value)}
                    placeholder="Buscar banca…"
                    className="w-full px-3 py-2.5 text-sm border-b border-gray-100 text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#8CD955]/30"
                    autoComplete="off"
                  />
                  <div className="overflow-y-auto p-2 space-y-0.5">
                    {bancasForPicker.map((b) => {
                      const checked = selectedBancaIds.includes(b.id);
                      const meta = configuredBancaMeta.get(b.id);
                      return (
                        <label
                          key={b.id}
                          className="flex items-start gap-2 text-sm text-gray-800 cursor-pointer rounded-lg px-2 py-2 hover:bg-gray-50"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              const next = e.target.checked
                                ? [...selectedBancaIds, b.id]
                                : selectedBancaIds.filter((x) => x !== b.id);
                              setSelectedBancaIds(next);
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
            <p className="text-xs text-gray-500 mt-2 max-w-xl">
              Selecione no dropdown uma ou mais bancas para a mesma integração Meta (dados de{' '}
              <code className="text-[11px] bg-gray-100 px-1 rounded">meta_integration_configs</code>
              ). Se marcar alguma banca que já possui vínculo, os campos abaixo são preenchidos com essa configuração (desde que todas as selecionadas compartilhem a mesma integração). Ao salvar, os vínculos em{' '}
              <code className="text-[11px] bg-gray-100 px-1 rounded">meta_integration_bancas</code> refletem o conjunto escolhido.
            </p>
            {configLoadError ? (
              <div className="mt-3 max-w-xl p-3 rounded-xl bg-amber-50 border border-amber-200 text-sm text-amber-900">
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
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Base URL Meta</label>
                  <input
                    type="text"
                    value={form.base_url}
                    onChange={(e) => setForm((f) => ({ ...f, base_url: e.target.value }))}
                    placeholder="https://graph.facebook.com/v19.0"
                    className="w-full px-4 py-2 border border-gray-200 rounded-xl text-gray-800 placeholder:text-gray-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    <Key className="w-4 h-4 inline mr-1" />
                    Access Token
                  </label>
                  {config?.token_last4 && !editingToken ? (
                    <div className="space-y-1">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:flex-wrap">
                        <input
                          type="text"
                          readOnly
                          value={`••••${config.token_last4}`}
                          aria-label="Token salvo (máscara)"
                          className="w-full min-w-0 px-4 py-2 border border-gray-200 rounded-xl text-gray-800 bg-gray-50 font-mono text-sm"
                        />
                        <button
                          type="button"
                          onClick={() => void handleRevealAccessToken()}
                          disabled={!primaryBancaId || revealTokenLoading}
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
                          config?.configured && config?.token_last4
                            ? 'Novo token (ou deixe em branco ao salvar para manter o atual)'
                            : 'Token do System User'
                        }
                        className="w-full px-4 py-2 border border-gray-200 rounded-xl text-gray-800 placeholder:text-gray-500 font-mono text-sm"
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
                  <label className="block text-sm font-medium text-gray-700 mb-1">Ad Account ID (act_xxx)</label>
                  <input
                    type="text"
                    value={form.ad_account_id}
                    onChange={(e) => setForm((f) => ({ ...f, ad_account_id: e.target.value }))}
                    placeholder="act_123456789"
                    className="w-full px-4 py-2 border border-gray-200 rounded-xl text-gray-800 placeholder:text-gray-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Pixel ID</label>
                  <input
                    type="text"
                    value={form.pixel_id}
                    onChange={(e) => setForm((f) => ({ ...f, pixel_id: e.target.value }))}
                    placeholder="1234567890"
                    className="w-full px-4 py-2 border border-gray-200 rounded-xl text-gray-800 placeholder:text-gray-500"
                  />
                </div>
                <div className="sm:col-span-2 lg:col-span-3">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    <Hash className="w-4 h-4 inline mr-1" />
                    Campanha padrão (opcional)
                  </label>
                  <div className="flex gap-2">
                    <select
                      value={form.default_campaign_id}
                      onChange={(e) => setForm((f) => ({ ...f, default_campaign_id: e.target.value }))}
                      className="flex-1 px-4 py-2 border border-gray-200 rounded-xl bg-white text-gray-800"
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
                      disabled={loadingCampaigns}
                      className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-xl font-medium text-gray-700 disabled:opacity-50 flex items-center gap-2"
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
                  className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-medium flex items-center gap-2"
                >
                  <ExternalLink className="w-4 h-4" />
                  Ver Gestor de Tráfego
                </a>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 border-t border-gray-200 pt-4">
                <div className="p-3 rounded-xl bg-gray-50 border border-gray-200">
                  <p className="text-[11px] font-semibold text-gray-500 uppercase">Token</p>
                  <p className="text-sm font-medium text-gray-800 mt-1">{config?.token_last4 ? `••••${config.token_last4}` : '-'}</p>
                </div>
                <div className="p-3 rounded-xl bg-gray-50 border border-gray-200">
                  <p className="text-[11px] font-semibold text-gray-500 uppercase">Pixel</p>
                  <p className="text-sm font-medium text-gray-800 mt-1 break-all">
                    {(form.pixel_id && form.pixel_id.trim()) || config?.pixel_id || '-'}
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-gray-50 border border-gray-200">
                  <p className="text-[11px] font-semibold text-gray-500 uppercase">Ad Account</p>
                  <p className="text-sm font-medium text-gray-800 mt-1 break-all">
                    {(form.ad_account_id && form.ad_account_id.trim()) || config?.ad_account_id || '-'}
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-gray-50 border border-gray-200">
                  <p className="text-[11px] font-semibold text-gray-500 uppercase">Base URL</p>
                  <p className="text-sm font-medium text-gray-800 mt-1 break-all">
                    {(form.base_url && form.base_url.trim()) || config?.base_url || '-'}
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-gray-50 border border-gray-200">
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
                        <p className="font-medium text-green-800">Conexão OK</p>
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

              <div className="border-t border-gray-200 pt-4">
                <h3 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                  <Calendar className="w-4 h-4" />
                  Status
                </h3>
                <div className="grid gap-2 text-sm text-gray-600">
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
          <div className="w-full max-w-2xl bg-white rounded-2xl border border-gray-200 shadow-xl">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-gray-800">Atribuir consultores à campanha</h3>
                <p className="text-xs text-gray-500 mt-0.5">Selecione a campanha e os consultores responsáveis.</p>
              </div>
              <button
                type="button"
                onClick={() => setConsultorModalOpen(false)}
                className="px-2.5 py-1.5 rounded-lg border border-gray-200 text-xs text-gray-600 hover:bg-gray-50"
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
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm text-gray-800 bg-white"
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
                    <div className="p-3 rounded-xl border border-gray-100 bg-gray-50">
                      <p className="text-[11px] font-semibold text-gray-500 uppercase">Leads consultores</p>
                      <p className="text-xl font-bold text-gray-800 mt-1">
                        {(Number(selectedConsultorModalRow.consultor_total_leads) || 0).toLocaleString('pt-BR')}
                      </p>
                    </div>
                    <div className="p-3 rounded-xl border border-gray-100 bg-gray-50">
                      <p className="text-[11px] font-semibold text-gray-500 uppercase">Depósito consultores</p>
                      <p className="text-xl font-bold text-gray-800 mt-1">
                        R$ {(Number(selectedConsultorModalRow.consultor_total_deposited) || 0).toFixed(2)}
                      </p>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold uppercase text-gray-500 mb-1">Consultores da banca</label>
                    <input
                      type="search"
                      value={consultorModalSearch}
                      onChange={(e) => setConsultorModalSearch(e.target.value)}
                      placeholder="Buscar consultor por nome ou e-mail…"
                      className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm text-gray-800 bg-white mb-2"
                    />
                    <div className="border border-gray-200 rounded-xl bg-white max-h-56 overflow-y-auto divide-y divide-gray-100">
                      {consultorModalFilteredOptions.length === 0 ? (
                        <p className="px-3 py-3 text-xs text-gray-500">Nenhum consultor encontrado.</p>
                      ) : (
                        consultorModalFilteredOptions.map((consultor) => {
                          const checked = consultorModalSelectedIds.includes(String(consultor.id));
                          return (
                            <label key={consultor.id} className="flex items-start gap-2 px-3 py-2 cursor-pointer hover:bg-gray-50">
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
                                <span className="block text-sm text-gray-800">{consultor.full_name || 'Sem nome'}</span>
                                <span className="block text-xs text-gray-500 break-all">{consultor.email}</span>
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
            <div className="px-5 py-4 border-t border-gray-100 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConsultorModalOpen(false)}
                className="px-4 py-2 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50"
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
          <div className="bg-white rounded-2xl shadow-xl border border-gray-200 w-full max-w-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-800">Criar nova integração Meta</h3>
              <button
                type="button"
                onClick={() => setNewIntegrationOpen(false)}
                className="px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-sm text-gray-700"
              >
                Fechar
              </button>
            </div>
            <div className="p-5 space-y-4">
              {newIntegrationError ? (
                <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">{newIntegrationError}</div>
              ) : null}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-2">Bancas desta integração</label>
                  <div className="max-h-44 overflow-auto border border-gray-200 rounded-xl p-3 bg-white space-y-2">
                    {bancas.map((b) => {
                      const checked = newIntegrationForm.banca_ids.includes(b.id);
                      return (
                        <label key={b.id} className="flex items-start gap-2 text-sm text-gray-800">
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
                  <p className="text-xs text-gray-500 mt-2">A mesma configuração será aplicada para todas as bancas marcadas.</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Base URL Meta</label>
                  <input
                    type="text"
                    value={newIntegrationForm.base_url}
                    onChange={(e) => setNewIntegrationForm((f) => ({ ...f, base_url: e.target.value }))}
                    className="w-full px-4 py-2 border border-gray-200 rounded-xl text-gray-800"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Access Token</label>
                  <input
                    type="password"
                    value={newIntegrationForm.access_token}
                    onChange={(e) => setNewIntegrationForm((f) => ({ ...f, access_token: e.target.value }))}
                    placeholder="Token do System User"
                    className="w-full px-4 py-2 border border-gray-200 rounded-xl text-gray-800 placeholder:text-gray-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Ad Account ID (act_xxx)</label>
                  <input
                    type="text"
                    value={newIntegrationForm.ad_account_id}
                    onChange={(e) => setNewIntegrationForm((f) => ({ ...f, ad_account_id: e.target.value }))}
                    placeholder="act_123456789"
                    className="w-full px-4 py-2 border border-gray-200 rounded-xl text-gray-800 placeholder:text-gray-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Pixel ID</label>
                  <input
                    type="text"
                    value={newIntegrationForm.pixel_id}
                    onChange={(e) => setNewIntegrationForm((f) => ({ ...f, pixel_id: e.target.value }))}
                    placeholder="1234567890"
                    className="w-full px-4 py-2 border border-gray-200 rounded-xl text-gray-800 placeholder:text-gray-500"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Campanha padrão (opcional)</label>
                  <input
                    type="text"
                    value={newIntegrationForm.default_campaign_id}
                    onChange={(e) => setNewIntegrationForm((f) => ({ ...f, default_campaign_id: e.target.value }))}
                    placeholder="campaign_id"
                    className="w-full px-4 py-2 border border-gray-200 rounded-xl text-gray-800 placeholder:text-gray-500"
                  />
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setNewIntegrationOpen(false)}
                  className="px-4 py-2 rounded-xl border border-gray-200 text-gray-700 hover:bg-gray-50"
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
