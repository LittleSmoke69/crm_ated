'use client';

import React, { useState, useEffect, useCallback } from 'react';
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

export default function AdminMetaPage() {
  const { checking, userId } = useRequireAuth();
  const router = useRouter();
  const [bancas, setBancas] = useState<Banca[]>([]);
  const [selectedBancaId, setSelectedBancaId] = useState<string>('');
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

  const [form, setForm] = useState({
    base_url: 'https://graph.facebook.com/v19.0',
    access_token: '',
    ad_account_id: '',
    pixel_id: '',
    default_campaign_id: '',
  });

  const loadConfig = useCallback(async () => {
    if (!selectedBancaId || !userId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/meta/config?banca_id=${selectedBancaId}`, {
        headers: { 'X-User-Id': userId },
      });
      const data = await res.json();
      if (data.success && data.data) {
        setConfig(data.data);
        setForm((f) => ({
          ...f,
          base_url: data.data.base_url || f.base_url,
          ad_account_id: data.data.ad_account_id || '',
          pixel_id: data.data.pixel_id || '',
          default_campaign_id: data.data.default_campaign_id || '',
          access_token: '', // Nunca preencher token
        }));
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [selectedBancaId, userId]);

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
          if (data.data.length > 0 && !selectedBancaId) {
            setSelectedBancaId(data.data[0].id);
          }
        }
      } catch (err) {
        console.error(err);
      }
    };
    fetchBancas();
  }, [userId]);

  useEffect(() => {
    if (selectedBancaId) loadConfig();
  }, [selectedBancaId, loadConfig]);

  const loadSyncedData = useCallback(async () => {
    if (!selectedBancaId || !userId) return;
    setLoadingData(true);
    try {
      const res = await fetch(`/api/admin/meta/data?banca_id=${selectedBancaId}`, {
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
  }, [selectedBancaId, userId]);

  useEffect(() => {
    if (selectedBancaId && config) loadSyncedData();
    else setSyncedData(null);
  }, [selectedBancaId, config?.last_sync_at, loadSyncedData]);

  const handleSave = async () => {
    if (!userId || !selectedBancaId) return;
    setSaving(true);
    setTestResult(null);
    setSyncResult(null);
    try {
      const res = await fetch('/api/admin/meta/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
        body: JSON.stringify({
          banca_id: selectedBancaId,
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
        await loadConfig();
        setForm((f) => ({ ...f, access_token: '' }));
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
    if (!userId || !selectedBancaId) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/admin/meta/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
        body: JSON.stringify({ banca_id: selectedBancaId }),
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
    if (!userId || !selectedBancaId) return;
    setLoadingCampaigns(true);
    setCampaigns([]);
    try {
      const res = await fetch(`/api/admin/meta/campaigns?banca_id=${selectedBancaId}`, {
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
    if (!userId || !selectedBancaId) return;
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch('/api/admin/meta/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
        body: JSON.stringify({ banca_id: selectedBancaId, date_preset: 'last_30d' }),
      });
      const data = await res.json();
      if (data.success && data.data) {
        setSyncResult(data.data);
        await loadConfig();
        await loadSyncedData();
      } else {
        setSyncResult({ success: false, error: data.error || 'Erro ao sincronizar' });
      }
    } catch (err: any) {
      setSyncResult({ success: false, error: err?.message || 'Erro ao sincronizar' });
    } finally {
      setSyncing(false);
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
          Configure o token e credenciais da Meta (Facebook/Instagram Ads) para alimentar o funil do Gestor de Tráfego.
        </p>

        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-gray-100 bg-gray-50/50">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              <Building2 className="w-4 h-4 inline mr-2" />
              Banca
            </label>
            <select
              value={selectedBancaId}
              onChange={(e) => {
                setSelectedBancaId(e.target.value);
                setTestResult(null);
                setSyncResult(null);
                setSyncedData(null);
              }}
              className="w-full max-w-xl px-4 py-2 border border-gray-200 rounded-xl text-gray-800 bg-white placeholder:text-gray-500"
            >
              <option value="">Selecione uma banca</option>
              {bancas.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name || b.url}
                </option>
              ))}
            </select>
          </div>

          {loading && selectedBancaId ? (
            <div className="p-8 flex justify-center">
              <Loader2 className="w-8 h-8 animate-spin text-[#8CD955]" />
            </div>
          ) : selectedBancaId ? (
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
                  <input
                    type="password"
                    value={form.access_token}
                    onChange={(e) => setForm((f) => ({ ...f, access_token: e.target.value }))}
                    placeholder={config?.token_last4 ? `••••${config.token_last4} (deixe em branco para manter)` : 'Token do System User'}
                    className="w-full px-4 py-2 border border-gray-200 rounded-xl text-gray-800 placeholder:text-gray-500"
                  />
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

                {loadingData ? (
                  <div className="py-8 flex justify-center">
                    <Loader2 className="w-6 h-6 animate-spin text-[#8CD955]" />
                  </div>
                ) : syncedData ? (
                  <div className="space-y-4">
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
                          <table className="w-full text-sm text-left min-w-[600px]">
                            <thead className="bg-gray-100 text-gray-700 sticky top-0">
                              <tr>
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
                          <table className="w-full text-sm text-left min-w-[600px]">
                            <thead className="bg-gray-100 text-gray-700 sticky top-0">
                              <tr>
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
                          <table className="w-full text-sm text-left min-w-[800px]">
                            <thead className="bg-gray-100 text-gray-700 sticky top-0">
                              <tr>
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
          ) : !selectedBancaId ? (
            <div className="p-8 text-center text-gray-500">Selecione uma banca para configurar a integração Meta.</div>
          ) : null}
        </div>
      </div>
    </Layout>
  );
}
