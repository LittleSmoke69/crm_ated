'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRequireAuth } from '@/utils/useRequireAuth';
import Layout from '@/components/Layout';
import {
  Shield,
  Loader2,
  RefreshCw,
  Plus,
  Trash2,
  Save,
  Users,
  List,
  Activity,
  Settings,
  Upload,
  CheckCircle2,
  XCircle,
  AlertCircle,
} from 'lucide-react';

interface AntiSpamConfigRow {
  id: string;
  banca_id: string;
  is_enabled: boolean;
  master_instance_id: string;
  watcher_instance_id: string | null;
  denuncia_group_jid: string;
  scan_mode: 'all_groups' | 'selected_groups';
  created_at: string;
}

interface EvolutionInstance {
  id: string;
  instance_name: string;
  status?: string;
}

interface BlacklistRow {
  id: string;
  config_id: string;
  phone_e164: string;
  wa_jid: string | null;
  reason: string;
  status: string;
  last_seen_at: string;
}

interface ActionRow {
  id: string;
  config_id: string;
  event_id: string;
  group_jid: string | null;
  phone_e164: string | null;
  action: string;
  result: string;
  error_message: string | null;
  created_at: string;
}

export default function AdminAntiSpamPage() {
  const { checking, userId } = useRequireAuth();
  const [bancaId, setBancaId] = useState('');
  const [configs, setConfigs] = useState<AntiSpamConfigRow[]>([]);
  const [instances, setInstances] = useState<EvolutionInstance[]>([]);
  const [blacklist, setBlacklist] = useState<BlacklistRow[]>([]);
  const [actions, setActions] = useState<ActionRow[]>([]);
  const [actionsPage, setActionsPage] = useState(1);
  const [actionsTotal, setActionsTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'config' | 'groups' | 'blacklist' | 'logs'>('config');
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4000);
  };

  const loadInstances = useCallback(async () => {
    if (!userId) return;
    try {
      const res = await fetch('/api/admin/evolution/instances', {
        headers: { 'X-User-Id': userId },
      });
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        setInstances(json.data.map((i: any) => ({ id: i.id, instance_name: i.instance_name, status: i.status })));
      }
    } catch (e) {
      console.error(e);
      showToast('error', 'Erro ao carregar instâncias');
    }
  }, [userId]);

  const loadConfigs = useCallback(async () => {
    if (!userId || !bancaId.trim()) {
      setConfigs([]);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/anti-spam/config?banca_id=${encodeURIComponent(bancaId)}`, {
        headers: { 'X-User-Id': userId },
      });
      const json = await res.json();
      if (json.success) {
        setConfigs(Array.isArray(json.data) ? json.data : []);
      } else {
        setConfigs([]);
      }
    } catch (e) {
      setConfigs([]);
      showToast('error', 'Erro ao carregar config');
    } finally {
      setLoading(false);
    }
  }, [userId, bancaId]);

  const loadBlacklist = useCallback(async () => {
    if (!userId || !configs.length) return;
    const configId = configs[0].id;
    try {
      const res = await fetch(`/api/admin/anti-spam/blacklist?config_id=${configId}`, {
        headers: { 'X-User-Id': userId },
      });
      const json = await res.json();
      if (json.success) setBlacklist(Array.isArray(json.data) ? json.data : []);
    } catch (e) {
      setBlacklist([]);
    }
  }, [userId, configs]);

  const loadActions = useCallback(async () => {
    if (!userId) return;
    const configId = configs.length ? configs[0].id : '';
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(actionsPage));
      params.set('limit', '25');
      if (configId) params.set('config_id', configId);
      const res = await fetch(`/api/admin/anti-spam/actions?${params}`, {
        headers: { 'X-User-Id': userId },
      });
      const json = await res.json();
      if (json.success) {
        setActions(Array.isArray(json.data) ? json.data : []);
        setActionsTotal(json.pagination?.total ?? 0);
      }
    } catch (e) {
      setActions([]);
    } finally {
      setLoading(false);
    }
  }, [userId, configs, actionsPage]);

  useEffect(() => {
    loadInstances();
  }, [loadInstances]);

  useEffect(() => {
    loadConfigs();
  }, [loadConfigs]);

  useEffect(() => {
    if (activeTab === 'blacklist') loadBlacklist();
    if (activeTab === 'logs') loadActions();
  }, [activeTab, loadBlacklist, loadActions]);

  const handleSaveConfig = async (payload: Partial<AntiSpamConfigRow>) => {
    if (!userId) return;
    setSaving(true);
    try {
      const res = await fetch('/api/admin/anti-spam/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
        body: JSON.stringify({ ...payload, banca_id: bancaId || payload.banca_id }),
      });
      const json = await res.json();
      if (json.success) {
        showToast('success', json.message || 'Salvo');
        loadConfigs();
      } else {
        showToast('error', json.error || 'Erro ao salvar');
      }
    } catch (e: any) {
      showToast('error', e?.message || 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  const handleAddBlacklist = async (phone: string) => {
    if (!userId || !configs[0]) return;
    try {
      const res = await fetch('/api/admin/anti-spam/blacklist/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
        body: JSON.stringify({ config_id: configs[0].id, phone_e164: phone, reason: 'manual' }),
      });
      const json = await res.json();
      if (json.success) {
        showToast('success', 'Número adicionado');
        loadBlacklist();
      } else {
        showToast('error', json.error || 'Erro');
      }
    } catch (e: any) {
      showToast('error', e?.message || 'Erro');
    }
  };

  const handleTestRun = async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const res = await fetch('/api/admin/anti-spam/test-run', {
        method: 'POST',
        headers: { 'X-User-Id': userId },
      });
      const json = await res.json();
      if (json.success) showToast('success', 'Ciclo executado');
      else showToast('error', json.error || 'Erro');
    } catch (e: any) {
      showToast('error', e?.message || 'Erro');
    } finally {
      setLoading(false);
    }
  };

  if (checking) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[40vh]">
          <Loader2 className="w-8 h-8 animate-spin text-gray-500" />
        </div>
      </Layout>
    );
  }

  const config = configs[0] ?? null;
  const totalPages = Math.ceil(actionsTotal / 25);

  const inputClass =
    'mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 placeholder:text-gray-500 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20';
  const inputClassInline =
    'rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 placeholder:text-gray-500 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20';

  return (
    <Layout>
      <div className="p-4 md:p-6 lg:p-8 max-w-5xl mx-auto">
        <header className="mb-8">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                <Shield className="h-8 w-8 text-indigo-600" />
                Anti-Spam
              </h1>
              <p className="mt-1 text-sm text-gray-500">
                Configuração em tempo real: blacklist, grupo de denúncia e remoção automática em grupos.
              </p>
            </div>
          </div>
        </header>

        {toast && (
          <div
            className={`mb-6 p-4 rounded-xl flex items-center gap-2 shadow-sm ${
              toast.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-800 border border-red-200'
            }`}
          >
            {toast.type === 'success' ? <CheckCircle2 className="w-5 h-5 shrink-0" /> : <AlertCircle className="w-5 h-5 shrink-0" />}
            <span className="text-sm font-medium">{toast.message}</span>
          </div>
        )}

        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium text-gray-700">Banca ID</span>
              <input
                type="text"
                value={bancaId}
                onChange={(e) => setBancaId(e.target.value)}
                placeholder="UUID da banca"
                className={`${inputClassInline} w-64 md:w-72`}
              />
            </label>
            <button
              type="button"
              onClick={loadConfigs}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 inline-flex items-center gap-2"
            >
              <RefreshCw className="w-4 h-4" /> Carregar
            </button>
          </div>
        </div>

        <div className="mb-6 border-b border-gray-200">
          <nav className="flex gap-1" aria-label="Abas">
            {(['config', 'groups', 'blacklist', 'logs'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-3 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${
                  activeTab === tab
                    ? 'border-indigo-600 text-indigo-700 bg-indigo-50/50'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                }`}
              >
                {tab === 'config' && 'Config'}
                {tab === 'groups' && 'Grupos'}
                {tab === 'blacklist' && 'Blacklist'}
                {tab === 'logs' && 'Logs / Ações'}
              </button>
            ))}
          </nav>
        </div>

        {activeTab === 'config' && (
          <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
              <h2 className="text-lg font-semibold text-gray-900">Configuração</h2>
              <button
                type="button"
                onClick={handleTestRun}
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 shrink-0"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Activity className="w-4 h-4" />}
                Testar ciclo
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Ativo</span>
                <select
                  value={config?.is_enabled ? '1' : '0'}
                  onChange={(e) => config && handleSaveConfig({ ...config, is_enabled: e.target.value === '1' })}
                  className={inputClass}
                >
                  <option value="1">Sim</option>
                  <option value="0">Não</option>
                </select>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Instância Mestre</span>
                <select
                  value={config?.master_instance_id ?? ''}
                  onChange={(e) => config && handleSaveConfig({ ...config, master_instance_id: e.target.value })}
                  className={inputClass}
                >
                  <option value="">Selecione</option>
                  {instances.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.instance_name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Instância Watcher (opcional)</span>
                <select
                  value={config?.watcher_instance_id ?? ''}
                  onChange={(e) =>
                    config && handleSaveConfig({ ...config, watcher_instance_id: e.target.value || null })
                  }
                  className={inputClass}
                >
                  <option value="">Nenhuma</option>
                  {instances.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.instance_name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Grupo de Denúncia (JID)</span>
                <input
                  type="text"
                  value={config?.denuncia_group_jid ?? ''}
                  onChange={(e) => config && handleSaveConfig({ ...config, denuncia_group_jid: e.target.value })}
                  placeholder="120363...@g.us"
                  className={inputClass}
                />
              </label>
              <label className="block md:col-span-2">
                <span className="text-sm font-medium text-gray-700">Modo de varredura</span>
                <select
                  value={config?.scan_mode ?? 'all_groups'}
                  onChange={(e) =>
                    config && handleSaveConfig({ ...config, scan_mode: e.target.value as 'all_groups' | 'selected_groups' })
                  }
                  className={inputClass}
                >
                  <option value="all_groups">Todos os grupos</option>
                  <option value="selected_groups">Grupos selecionados</option>
                </select>
              </label>
            </div>
            {!config && bancaId.trim() && (
              <div className="mt-6 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() =>
                    handleSaveConfig({
                      banca_id: bancaId,
                      is_enabled: true,
                      master_instance_id: instances[0]?.id ?? '',
                      denuncia_group_jid: '',
                      scan_mode: 'all_groups',
                    })
                  }
                  disabled={saving || !instances.length}
                  className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  Criar config
                </button>
              </div>
            )}
          </div>
        )}

        {activeTab === 'groups' && (
          <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Grupos monitorados</h2>
            <p className="text-sm text-gray-500 mb-4">
              Quando &quot;Modo de varredura&quot; = Grupos selecionados, use esta lista. Botão &quot;Importar grupos da
              instância&quot; busca grupos da instância watcher ou mestre.
            </p>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              <Upload className="w-4 h-4" /> Importar grupos da instância
            </button>
          </div>
        )}

        {activeTab === 'blacklist' && (
          <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Blacklist</h2>
            <div className="flex flex-wrap gap-2 mb-4">
              <input
                type="text"
                id="new-phone"
                placeholder="Número (ex: 31999887766)"
                className={`${inputClassInline} flex-1 min-w-[200px] max-w-xs`}
              />
              <button
                type="button"
                onClick={() => {
                  const el = document.getElementById('new-phone') as HTMLInputElement;
                  if (el?.value.trim()) handleAddBlacklist(el.value.trim());
                }}
                className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
              >
                <Plus className="w-4 h-4" /> Adicionar
              </button>
            </div>
            <div className="overflow-x-auto rounded-lg border border-gray-200">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50 text-left">
                    <th className="py-3 px-3 font-medium text-gray-700">Número</th>
                    <th className="py-3 px-3 font-medium text-gray-700">Motivo</th>
                    <th className="py-3 px-3 font-medium text-gray-700">Status</th>
                    <th className="py-3 px-3 font-medium text-gray-700">Última vez</th>
                  </tr>
                </thead>
                <tbody>
                  {blacklist.map((r) => (
                    <tr key={r.id} className="border-b border-gray-100 hover:bg-gray-50/50">
                      <td className="py-3 px-3 text-gray-800">{r.phone_e164}</td>
                      <td className="py-3 px-3 text-gray-700">{r.reason}</td>
                      <td className="py-3 px-3 text-gray-700">{r.status}</td>
                      <td className="py-3 px-3 text-gray-500">{new Date(r.last_seen_at).toLocaleString('pt-BR')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {blacklist.length === 0 && <p className="text-gray-500 py-8 text-center text-sm">Nenhum número na blacklist.</p>}
            </div>
          </div>
        )}

        {activeTab === 'logs' && (
          <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Logs / Ações</h2>
            <div className="overflow-x-auto rounded-lg border border-gray-200">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50 text-left">
                    <th className="py-3 px-3 font-medium text-gray-700">Data</th>
                    <th className="py-3 px-3 font-medium text-gray-700">Ação</th>
                    <th className="py-3 px-3 font-medium text-gray-700">Resultado</th>
                    <th className="py-3 px-3 font-medium text-gray-700">Grupo</th>
                    <th className="py-3 px-3 font-medium text-gray-700">Número</th>
                    <th className="py-3 px-3 font-medium text-gray-700">Erro</th>
                  </tr>
                </thead>
                <tbody>
                  {actions.map((r) => (
                    <tr key={r.id} className="border-b border-gray-100 hover:bg-gray-50/50">
                      <td className="py-3 px-3 text-gray-600">{new Date(r.created_at).toLocaleString('pt-BR')}</td>
                      <td className="py-3 px-3 text-gray-800">{r.action}</td>
                      <td className="py-3 px-3">
                        {r.result === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-600 inline" />}
                        {r.result === 'fail' && <XCircle className="w-4 h-4 text-red-600 inline" />}
                        {r.result === 'skipped' && <span className="text-gray-500">skipped</span>}
                        <span className="text-gray-700 ml-1">{r.result}</span>
                      </td>
                      <td className="py-3 px-3 text-gray-700 truncate max-w-[140px]" title={r.group_jid ?? ''}>{r.group_jid ?? '—'}</td>
                      <td className="py-3 px-3 text-gray-700">{r.phone_e164 ?? '—'}</td>
                      <td className={`py-3 px-3 max-w-[200px] truncate ${r.error_message ? 'text-red-600' : 'text-gray-500'}`} title={r.error_message ?? ''}>
                        {r.error_message ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div className="mt-4 flex items-center justify-between border-t border-gray-100 pt-4">
                <span className="text-sm text-gray-600">
                  Página {actionsPage} de {totalPages}
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setActionsPage((p) => Math.max(1, p - 1))}
                    disabled={actionsPage <= 1}
                    className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    Anterior
                  </button>
                  <button
                    type="button"
                    onClick={() => setActionsPage((p) => p + 1)}
                    disabled={actionsPage >= totalPages}
                    className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    Próxima
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}
