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
} from 'lucide-react';

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

interface CampaignOption {
  id: string;
  name?: string;
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
  const [configLoadError, setConfigLoadError] = useState<string | null>(null);
  const [config, setConfig] = useState<MetaConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; me?: any; adAccounts?: any[]; error?: string } | null>(null);
  const [syncResult, setSyncResult] = useState<{ success: boolean; campaignsCount?: number; adsetsCount?: number; insightsCount?: number; error?: string } | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignOption[]>([]);
  const [syncedData, setSyncedData] = useState<{ campaigns: any[]; adsets: any[]; insights: any[] } | null>(null);
  const [loadingData, setLoadingData] = useState(false);
  const [expandedTab, setExpandedTab] = useState<'campaigns' | 'adsets' | 'insights' | null>('campaigns');
  const [overviewRows, setOverviewRows] = useState<MetaOverviewRow[]>([]);
  const [loadingOverview, setLoadingOverview] = useState(false);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [overviewSearch, setOverviewSearch] = useState('');
  /** filtro do dropdown de bancas para os cards da visão geral */
  const [overviewFilterBancaId, setOverviewFilterBancaId] = useState<string>('');
  /** IDs das bancas selecionadas para filtrar os cards de visão geral */
  const [overviewSelectedBancaIds, setOverviewSelectedBancaIds] = useState<string[]>([]);
  const [overviewPage, setOverviewPage] = useState(1);

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
  const [allCampaignsShowInactive, setAllCampaignsShowInactive] = useState(false);
  const [allCampaignsPage, setAllCampaignsPage] = useState(1);
  const ALL_CAMPAIGNS_PAGE_SIZE = 20;

  const [form, setForm] = useState({
    base_url: 'https://graph.facebook.com/v19.0',
    access_token: '',
    ad_account_id: '',
    pixel_id: '',
    default_campaign_id: '',
  });
  /** Quando já existe token salvo, mostra máscara no campo até o usuário clicar em «Alterar token». */
  const [editingToken, setEditingToken] = useState(false);

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

  /** Para APIs que exigem um único banca_id: prefere uma banca já vinculada à integração carregada. */
  const primaryBancaId =
    config?.configured && Array.isArray(config.banca_ids)
      ? selectedBancaIds.find((id) => config.banca_ids!.includes(id)) ?? selectedBancaIds[0] ?? ''
      : selectedBancaIds[0] ?? '';

  const loadSyncedData = useCallback(async () => {
    if (!primaryBancaId || !userId) return;
    setLoadingData(true);
    try {
      const res = await fetch(`/api/admin/meta/data?banca_id=${encodeURIComponent(primaryBancaId)}`, {
        headers: { 'X-User-Id': userId },
      });
      const data = await res.json();
      if (data.success && data.data) {
        setSyncedData(data.data);
      } else {
        setSyncedData(null);
      }
    } catch {
      setSyncedData(null);
    } finally {
      setLoadingData(false);
    }
  }, [primaryBancaId, userId]);

  const loadOverview = useCallback(async () => {
    if (!userId) return;
    setLoadingOverview(true);
    setOverviewError(null);
    try {
      const res = await fetch('/api/admin/meta/overview', {
        headers: { 'X-User-Id': userId },
      });
      const data = await res.json();
      if (data.success && Array.isArray(data.data?.rows)) {
        setOverviewRows(data.data.rows);
      } else {
        setOverviewRows([]);
        setOverviewError(data.error || 'Erro ao carregar visão geral das integrações.');
      }
    } catch (err: any) {
      setOverviewRows([]);
      setOverviewError(err?.message || 'Erro ao carregar visão geral das integrações.');
    } finally {
      setLoadingOverview(false);
    }
  }, [userId]);

  useEffect(() => {
    if (primaryBancaId && config) loadSyncedData();
    else setSyncedData(null);
  }, [primaryBancaId, config?.last_sync_at, loadSyncedData]);

  useEffect(() => {
    if (!userId) return;
    void loadOverview();
  }, [userId, loadOverview]);

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
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch('/api/admin/meta/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
        body: JSON.stringify({ banca_id: primaryBancaId, date_preset: 'last_30d' }),
      });
      const data = await res.json();
      if (data.success && data.data) {
        setSyncResult(data.data);
        await loadConfig(selectedBancaIds);
        await loadSyncedData();
        await loadOverview();
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
      const res = await fetch(`/api/admin/meta/campaigns-all?${params.toString()}`, {
        headers: { 'X-User-Id': userId },
      });
      const data = await res.json();
      if (data.success && data.data?.rows) {
        setAllCampaignsRows(data.data.rows);
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
  }, [userId, allCampaignsPage, allCampaignsSearch, allCampaignsShowInactive]);

  useEffect(() => {
    if (!userId) return;
    void loadAllCampaigns();
  }, [userId, loadAllCampaigns]);

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
    selectedBancaIds.length === 0
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

  const overviewSelectedSet = new Set(overviewSelectedBancaIds);
  const cardOverviewRows =
    overviewSelectedBancaIds.length > 0
      ? overviewRows.filter((row) => overviewSelectedSet.has(row.banca_id))
      : filteredOverviewRows;

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
        <p className="text-gray-600">
          Gestão geral das integrações Meta Ads por banca, com status, métricas e campanhas sincronizadas.
        </p>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="grid gap-4 md:grid-cols-3 flex-1 min-w-[280px]">
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
            <p className="text-xs font-semibold text-gray-500 uppercase">Total gasto (visão geral)</p>
            <p className="text-2xl font-bold text-gray-800 mt-1">R$ {overviewTotals.totalSpend.toFixed(2)}</p>
            <p className="text-xs text-gray-500 mt-1">Somatório das bancas filtradas na tabela abaixo.</p>
          </div>
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
            <p className="text-xs font-semibold text-gray-500 uppercase">Total de leads</p>
            <p className="text-2xl font-bold text-gray-800 mt-1">{overviewTotals.totalLeads.toLocaleString('pt-BR')}</p>
            <p className="text-xs text-gray-500 mt-1">Leads da Meta no mesmo recorte exibido.</p>
          </div>
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
            <p className="text-xs font-semibold text-gray-500 uppercase">Bancas exibidas</p>
            <p className="text-2xl font-bold text-gray-800 mt-1">{cardOverviewRows.length.toLocaleString('pt-BR')}</p>
            <p className="text-xs text-gray-500 mt-1">{overviewSelectedBancaIds.length > 0 ? 'Somente as bancas selecionadas' : 'Com ou sem integração configurada'}</p>
          </div>
          </div>
          <div className="shrink-0">
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

        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-gray-100 bg-gray-50/50 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-gray-800">Visão geral de todas as bancas</h2>
              <p className="text-sm text-gray-600">Acompanhe integração e métricas Meta por banca.</p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <div>
                <label className="block text-[11px] font-semibold text-gray-500 uppercase mb-1">Filtro dos cards</label>
                <select
                  value={overviewFilterBancaId}
                  onChange={(e) => {
                    setOverviewFilterBancaId(e.target.value);
                    setOverviewPage(1);
                  }}
                  className="px-3 py-2 border border-gray-200 rounded-xl text-sm text-gray-800 bg-white"
                >
                  <option value="">Todas as bancas</option>
                  {bancas.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name || b.url}
                    </option>
                  ))}
                </select>
              </div>
              <input
                value={overviewSearch}
                onChange={(e) => { setOverviewSearch(e.target.value); setOverviewPage(1); }}
                placeholder="Buscar banca por nome ou URL"
                className="px-3 py-2 border border-gray-200 rounded-xl text-sm text-gray-800 placeholder:text-gray-500 bg-white"
              />
              <button
                type="button"
                onClick={() => loadOverview()}
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
                            setOverviewFilterBancaId(row.banca_id);
                            setTestResult(null);
                            setSyncResult(null);
                            setSyncedData(null);
                            setConfigLoadError(null);
                            setSelectedBancaIds([row.banca_id]);
                            void loadConfig([row.banca_id]);
                            setTimeout(() => {
                              document.getElementById('meta-config-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                            }, 0);
                          }}
                          className="px-3 py-1.5 rounded-lg bg-[#8CD955] hover:bg-[#7BC84A] text-white text-xs font-medium"
                        >
                          Gerenciar
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
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <input
                        type="text"
                        readOnly
                        value={`••••${config.token_last4}`}
                        aria-label="Token salvo (máscara)"
                        className="w-full px-4 py-2 border border-gray-200 rounded-xl text-gray-800 bg-gray-50 font-mono text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setEditingToken(true);
                          setForm((f) => ({ ...f, access_token: '' }));
                        }}
                        className="shrink-0 px-4 py-2 rounded-xl border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50"
                      >
                        Alterar token
                      </button>
                    </div>
                  ) : (
                    <input
                      type="password"
                      autoComplete="off"
                      value={form.access_token}
                      onChange={(e) => setForm((f) => ({ ...f, access_token: e.target.value }))}
                      placeholder={
                        config?.configured && config?.token_last4
                          ? 'Novo token (ou deixe em branco ao salvar para manter o atual)'
                          : 'Token do System User'
                      }
                      className="w-full px-4 py-2 border border-gray-200 rounded-xl text-gray-800 placeholder:text-gray-500"
                    />
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

              {/* Dados Sincronizados */}
              <div className="border-t border-gray-200 pt-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-base font-semibold text-gray-800">Dados Sincronizados</h3>
                  <button
                    onClick={() => loadSyncedData()}
                    disabled={loadingData}
                    className="text-sm text-[#8CD955] hover:text-[#7BC84A] font-medium flex items-center gap-1 disabled:opacity-50"
                  >
                    {loadingData ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                    Atualizar
                  </button>
                </div>

                {/* Todas as integrações: Campanhas */}
                <div className="mb-6 rounded-2xl border border-gray-200 overflow-hidden">
                  <div className="px-4 py-3 bg-gray-50/70 border-b border-gray-100 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-gray-800">Campanhas sincronizadas (todas as bancas)</p>
                      <p className="text-xs text-gray-500">Lista global de `meta_campaigns` para gestão completa.</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                        <input
                          type="checkbox"
                          checked={allCampaignsShowInactive}
                          onChange={(e) => {
                            setAllCampaignsShowInactive(e.target.checked);
                            setAllCampaignsPage(1);
                          }}
                          className="rounded border-gray-300 text-[#8CD955] focus:ring-[#8CD955]"
                        />
                        Mostrar inativas
                      </label>
                      <input
                        value={allCampaignsSearch}
                        onChange={(e) => { setAllCampaignsSearch(e.target.value); setAllCampaignsPage(1); }}
                        placeholder="Buscar campanha (nome)"
                        className="px-3 py-2 border border-gray-200 rounded-xl text-sm text-gray-800 placeholder:text-gray-500 bg-white"
                      />
                      <button
                        type="button"
                        onClick={() => loadAllCampaigns()}
                        disabled={allCampaignsLoading}
                        className="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-xl font-medium text-gray-700 disabled:opacity-50 flex items-center gap-2"
                      >
                        {allCampaignsLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                        Atualizar
                      </button>
                    </div>
                  </div>
                  {allCampaignsError ? (
                    <div className="p-4 text-sm text-red-700 bg-red-50 border-t border-red-200">{allCampaignsError}</div>
                  ) : null}
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[900px]">
                      <thead className="bg-white text-gray-700">
                        <tr className="border-b border-gray-100">
                          <th className="px-4 py-2 text-left font-semibold">Banca</th>
                          <th className="px-4 py-2 text-left font-semibold">Campanha</th>
                          <th className="px-4 py-2 text-left font-semibold">Status</th>
                          <th className="px-4 py-2 text-left font-semibold">Objetivo</th>
                          <th className="px-4 py-2 text-right font-semibold">Orçamento diário</th>
                          <th className="px-4 py-2 text-right font-semibold">Orçamento total</th>
                          <th className="px-4 py-2 text-left font-semibold">Atualizado</th>
                          <th className="px-4 py-2 text-left font-semibold">Ações</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {(allCampaignsRows ?? []).map((row: any) => (
                          <tr key={`${row.banca_id}:${row.campaign_id}`} className="hover:bg-gray-50/60">
                            <td className="px-4 py-2">
                              <p className="font-medium text-gray-800">{row.banca_name}</p>
                              {row.banca_url ? <p className="text-xs text-gray-500 break-all">{row.banca_url}</p> : null}
                            </td>
                            <td className="px-4 py-2">
                              <p className="font-medium text-gray-800">{row.name || row.campaign_id}</p>
                              <p className="text-xs text-gray-500 font-mono break-all">{row.campaign_id}</p>
                            </td>
                            <td className="px-4 py-2 text-gray-700">{row.effective_status || row.status || '-'}</td>
                            <td className="px-4 py-2 text-gray-700">{row.objective || '-'}</td>
                            <td className="px-4 py-2 text-right text-gray-700">{row.daily_budget != null ? `R$ ${Number(row.daily_budget).toFixed(2)}` : '-'}</td>
                            <td className="px-4 py-2 text-right text-gray-700">{row.lifetime_budget != null ? `R$ ${Number(row.lifetime_budget).toFixed(2)}` : '-'}</td>
                            <td className="px-4 py-2 text-xs text-gray-600">{formatDate(row.updated_at)}</td>
                            <td className="px-4 py-2">
                              <button
                                type="button"
                                onClick={() => {
                                  setOverviewFilterBancaId(row.banca_id);
                                  setTestResult(null);
                                  setSyncResult(null);
                                  setSyncedData(null);
                                  setConfigLoadError(null);
                                  setSelectedBancaIds([row.banca_id]);
                                  void loadConfig([row.banca_id]);
                                  setTimeout(() => {
                                    document.getElementById('meta-config-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                  }, 0);
                                }}
                                className="px-3 py-1.5 rounded-lg bg-[#8CD955] hover:bg-[#7BC84A] text-white text-xs font-medium"
                              >
                                Gerenciar banca
                              </button>
                            </td>
                          </tr>
                        ))}
                        {(allCampaignsRows?.length ?? 0) === 0 && !allCampaignsLoading && (
                          <tr>
                            <td colSpan={8} className="px-4 py-6 text-center text-gray-500">
                              Nenhuma campanha sincronizada encontrada.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <div className="px-4 py-3 border-t border-gray-100 bg-gray-50/40 flex items-center justify-between">
                    <p className="text-xs text-gray-500">Página {allCampaignsPage}</p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setAllCampaignsPage((p) => Math.max(1, p - 1))}
                        className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs text-gray-700 hover:bg-gray-100"
                      >
                        ‹ Anterior
                      </button>
                      <button
                        type="button"
                        onClick={() => setAllCampaignsPage((p) => p + 1)}
                        className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs text-gray-700 hover:bg-gray-100"
                      >
                        Próximo ›
                      </button>
                      <button
                        type="button"
                        onClick={() => loadAllCampaigns()}
                        className="px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-xs text-gray-700"
                      >
                        Recarregar
                      </button>
                    </div>
                  </div>
                </div>

                {loadingData ? (
                  <div className="py-8 flex justify-center">
                    <Loader2 className="w-6 h-6 animate-spin text-[#8CD955]" />
                  </div>
                ) : syncedData ? (
                  <div className="space-y-4">
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                      <div className="p-3 rounded-xl border border-gray-200 bg-gray-50">
                        <p className="text-[11px] uppercase font-semibold text-gray-500">Banca</p>
                        <p className="text-sm font-semibold text-gray-800 mt-1">{selectedBancaName}</p>
                      </div>
                      <div className="p-3 rounded-xl border border-gray-200 bg-gray-50">
                        <p className="text-[11px] uppercase font-semibold text-gray-500">Campanhas / AdSets</p>
                        <p className="text-sm font-semibold text-gray-800 mt-1">
                          {(syncedData.campaigns?.length ?? 0).toLocaleString('pt-BR')} / {(syncedData.adsets?.length ?? 0).toLocaleString('pt-BR')}
                        </p>
                      </div>
                      <div className="p-3 rounded-xl border border-gray-200 bg-gray-50">
                        <p className="text-[11px] uppercase font-semibold text-gray-500">Reach / Impressões</p>
                        <p className="text-sm font-semibold text-gray-800 mt-1">
                          {syncedTotals.reach.toLocaleString('pt-BR')} / {syncedTotals.impressions.toLocaleString('pt-BR')}
                        </p>
                      </div>
                      <div className="p-3 rounded-xl border border-gray-200 bg-gray-50">
                        <p className="text-[11px] uppercase font-semibold text-gray-500">Cliques / Leads</p>
                        <p className="text-sm font-semibold text-gray-800 mt-1">
                          {syncedTotals.clicks.toLocaleString('pt-BR')} / {syncedTotals.leads.toLocaleString('pt-BR')}
                        </p>
                      </div>
                      <div className="p-3 rounded-xl border border-gray-200 bg-gray-50">
                        <p className="text-[11px] uppercase font-semibold text-gray-500">Gasto total</p>
                        <p className="text-sm font-semibold text-gray-800 mt-1">R$ {syncedTotals.spend.toFixed(2)}</p>
                      </div>
                    </div>
                    {/* Campanhas */}
                    <div className="border border-gray-200 rounded-xl overflow-hidden">
                      <button
                        onClick={() => setExpandedTab(expandedTab === 'campaigns' ? null : 'campaigns')}
                        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition"
                      >
                        <span className="flex items-center gap-2 font-medium text-gray-800">
                          <Target className="w-4 h-4 text-[#8CD955]" />
                          Campanhas ({syncedData.campaigns?.length ?? 0})
                        </span>
                        {expandedTab === 'campaigns' ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                      </button>
                      {expandedTab === 'campaigns' && (
                        <div className="overflow-x-auto max-h-80 overflow-y-auto">
                          <table className="w-full text-sm text-left min-w-[720px]">
                            <thead className="bg-gray-100 text-gray-700 sticky top-0">
                              <tr>
                                <th className="px-4 py-2">Banca</th>
                                <th className="px-4 py-2">Nome</th>
                                <th className="px-4 py-2">Status</th>
                                <th className="px-4 py-2">Objetivo</th>
                                <th className="px-4 py-2">Orçamento diário</th>
                                <th className="px-4 py-2">Orçamento total</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {(syncedData.campaigns ?? []).map((c: any) => (
                                <tr key={c.id} className="hover:bg-gray-50">
                                  <td className="px-4 py-2 text-xs text-gray-600">{selectedBancaName}</td>
                                  <td className="px-4 py-2 font-medium text-gray-800">{c.name || c.campaign_id}</td>
                                  <td className="px-4 py-2 text-gray-700">{c.effective_status || c.status || '-'}</td>
                                  <td className="px-4 py-2 text-gray-700">{c.objective || '-'}</td>
                                  <td className="px-4 py-2 text-gray-700">{c.daily_budget != null ? `R$ ${Number(c.daily_budget).toFixed(2)}` : '-'}</td>
                                  <td className="px-4 py-2 text-gray-700">{c.lifetime_budget != null ? `R$ ${Number(c.lifetime_budget).toFixed(2)}` : '-'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {(syncedData.campaigns?.length ?? 0) === 0 && (
                            <p className="px-4 py-6 text-center text-gray-500">Nenhuma campanha sincronizada.</p>
                          )}
                        </div>
                      )}
                    </div>

                    {/* AdSets */}
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
                              {(syncedData.adsets ?? []).map((a: any) => (
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
                        </div>
                      )}
                    </div>

                    {/* Insights */}
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
                          <table className="w-full text-sm text-left min-w-[860px]">
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
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {(syncedData.insights ?? []).map((i: any) => (
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
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {(syncedData.insights?.length ?? 0) === 0 && (
                            <p className="px-4 py-6 text-center text-gray-500">Nenhum insight sincronizado. Execute a sincronização.</p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="py-6 text-center text-gray-500">Nenhum dado sincronizado. Configure e clique em &quot;Sincronizar agora&quot;.</p>
                )}
              </div>
            </div>
          ) : (
            <div className="p-8 text-center text-gray-500">Marque pelo menos uma banca para configurar a integração Meta.</div>
          )}
        </div>
      </div>

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
