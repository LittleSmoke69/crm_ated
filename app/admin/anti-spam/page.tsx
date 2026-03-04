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
import VerifyGroupsOverlay from '@/components/anti-spam/VerifyGroupsOverlay';

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

interface JoinEventRow {
  id: string;
  received_at: string;
  group_id: string;
  group_subject: string | null;
  phone: string;
}

interface BancaOption {
  id: string;
  name: string;
  url: string;
}

export default function AdminAntiSpamPage() {
  const { checking, userId } = useRequireAuth();
  const [bancas, setBancas] = useState<BancaOption[]>([]);
  const [bancaId, setBancaId] = useState('');
  const [selectedConfigId, setSelectedConfigId] = useState<string>('');
  const [configs, setConfigs] = useState<AntiSpamConfigRow[]>([]);
  const [instances, setInstances] = useState<EvolutionInstance[]>([]);
  const [blacklist, setBlacklist] = useState<BlacklistRow[]>([]);
  const [actions, setActions] = useState<ActionRow[]>([]);
  const [actionsPage, setActionsPage] = useState(1);
  const [actionsTotal, setActionsTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [joinEvents, setJoinEvents] = useState<JoinEventRow[]>([]);
  const [eventsPage, setEventsPage] = useState(1);
  const [eventsTotal, setEventsTotal] = useState(0);
  const EVENTS_PAGE_SIZE = 10;
  const [blacklistPage, setBlacklistPage] = useState(1);
  const [blacklistTotal, setBlacklistTotal] = useState(0);
  const BLACKLIST_PAGE_SIZE = 10;
  const [activeTab, setActiveTab] = useState<'config' | 'groups' | 'blacklist' | 'events' | 'logs'>('config');
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [savedGroups, setSavedGroups] = useState<{ group_id: string; group_subject: string; instance_name?: string }[]>([]);
  const [protectedGroupIds, setProtectedGroupIds] = useState<Set<string>>(new Set());
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [fetchingGroups, setFetchingGroups] = useState(false);
  const [togglingGroupId, setTogglingGroupId] = useState<string | null>(null);
  const [verifyingGroups, setVerifyingGroups] = useState(false);
  const [verifyGroupsResult, setVerifyGroupsResult] = useState<{
    report: { phone_e164: string; groups_count: number; group_jids: string[] }[];
    removals: { phone_e164: string; group_jid: string; success: boolean; error?: string }[];
    groupErrors?: { groupJid: string; error: string }[];
    summary: { totalInGroups: number; totalRemovals: number; success: number; failed: number };
  } | null>(null);

  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4000);
  };

  const loadBancas = useCallback(async () => {
    if (!userId) return;
    try {
      const res = await fetch('/api/admin/anti-spam/bancas', { headers: { 'X-User-Id': userId } });
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        setBancas(json.data);
        if (!bancaId && json.data.length > 0) {
          setBancaId(json.data[0].id);
        }
      }
    } catch (e) {
      console.error(e);
      showToast('error', 'Erro ao carregar bancas');
    }
  }, [userId]);

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
      setSelectedConfigId('');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/anti-spam/config?banca_id=${encodeURIComponent(bancaId)}`, {
        headers: { 'X-User-Id': userId },
      });
      const json = await res.json();
      if (json.success) {
        const list = Array.isArray(json.data) ? json.data : [];
        setConfigs(list);
        if (list.length > 0 && !list.some((c: AntiSpamConfigRow) => c.id === selectedConfigId)) {
          setSelectedConfigId(list[0].id);
        } else if (list.length === 0) {
          setSelectedConfigId('');
        }
      } else {
        setConfigs([]);
        setSelectedConfigId('');
      }
    } catch (e) {
      setConfigs([]);
      setSelectedConfigId('');
      showToast('error', 'Erro ao carregar configurações');
    } finally {
      setLoading(false);
    }
  }, [userId, bancaId]);

  const loadBlacklist = useCallback(async () => {
    if (!userId || !selectedConfigId) return;
    const configId = selectedConfigId;
    try {
      const res = await fetch(
        `/api/admin/anti-spam/blacklist?config_id=${configId}&page=${blacklistPage}&limit=${BLACKLIST_PAGE_SIZE}`,
        { headers: { 'X-User-Id': userId } }
      );
      const json = await res.json();
      if (json.success) {
        setBlacklist(Array.isArray(json.data) ? json.data : []);
        setBlacklistTotal(json.pagination?.total ?? 0);
      }
    } catch (e) {
      setBlacklist([]);
    }
  }, [userId, selectedConfigId, blacklistPage]);

  const loadJoinEvents = useCallback(async () => {
    if (!userId || !selectedConfigId) return;
    const configId = selectedConfigId;
    try {
      const res = await fetch(
        `/api/admin/anti-spam/events?config_id=${configId}&page=${eventsPage}&limit=${EVENTS_PAGE_SIZE}`,
        { headers: { 'X-User-Id': userId } }
      );
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        setJoinEvents(json.data);
        setEventsTotal(json.pagination?.total ?? 0);
      }
    } catch {
      setJoinEvents([]);
    }
  }, [userId, selectedConfigId, eventsPage]);

  const loadActions = useCallback(async () => {
    if (!userId) return;
    const configId = selectedConfigId || '';
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
  }, [userId, selectedConfigId, actionsPage]);

  const loadSavedGroups = useCallback(
    async (instanceName: string) => {
      if (!userId || !instanceName) return;
      try {
        const res = await fetch(`/api/groups?instanceName=${encodeURIComponent(instanceName)}`, {
          headers: { 'X-User-Id': userId },
        });
        const json = await res.json();
        if (json.success && Array.isArray(json.data)) {
          setSavedGroups(
            json.data.map((g: { group_id: string; group_subject?: string }) => ({
              group_id: g.group_id,
              group_subject: g.group_subject || g.group_id,
              instance_name: instanceName,
            }))
          );
        } else {
          setSavedGroups([]);
        }
      } catch (e) {
        setSavedGroups([]);
      }
    },
    [userId]
  );

  const loadSavedGroupsAll = useCallback(async () => {
    if (!userId) return;
    try {
      const res = await fetch('/api/groups?allInstances=1', { headers: { 'X-User-Id': userId } });
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        setSavedGroups(
          json.data.map((g: { group_id: string; group_subject?: string; instance_name?: string }) => ({
            group_id: g.group_id,
            group_subject: g.group_subject || g.group_id,
            instance_name: g.instance_name ?? '',
          }))
        );
      } else {
        setSavedGroups([]);
      }
    } catch (e) {
      setSavedGroups([]);
    }
  }, [userId]);

  const loadProtectedGroups = useCallback(
    async (configId: string) => {
      if (!userId || !configId) return;
      try {
        const res = await fetch(`/api/admin/anti-spam/groups?config_id=${encodeURIComponent(configId)}`, {
          headers: { 'X-User-Id': userId },
        });
        const json = await res.json();
        if (json.success && Array.isArray(json.data)) {
          setProtectedGroupIds(new Set(json.data.map((g: { group_jid: string }) => g.group_jid)));
        } else {
          setProtectedGroupIds(new Set());
        }
      } catch (e) {
        setProtectedGroupIds(new Set());
      }
    },
    [userId]
  );

  const loadGroupsTabData = useCallback(async () => {
    const config = configs.find((c) => c.id === selectedConfigId);
    if (!config || !userId) return;
    setLoadingGroups(true);
    try {
      await Promise.all([loadSavedGroupsAll(), loadProtectedGroups(config.id)]);
    } finally {
      setLoadingGroups(false);
    }
  }, [userId, selectedConfigId, configs, loadSavedGroupsAll, loadProtectedGroups]);

  const fetchGroupsFromInstance = useCallback(async () => {
    const config = configs.find((c) => c.id === selectedConfigId);
    if (!config || !userId) return;
    const instanceName = instances.find((i) => i.id === config.master_instance_id)?.instance_name;
    if (!instanceName) {
      showToast('error', 'Instância da configuração não encontrada.');
      return;
    }
    setFetchingGroups(true);
    try {
      const res = await fetch('/api/groups/fetch', {
        method: 'POST',
        headers: { 'X-User-Id': userId, 'Content-Type': 'application/json' },
        body: JSON.stringify({ instanceName }),
      });
      const json = await res.json();
      if (json.success && Array.isArray(json.data) && json.data.length > 0) {
        const syncRes = await fetch('/api/groups/sync', {
          method: 'POST',
          headers: { 'X-User-Id': userId, 'Content-Type': 'application/json' },
          body: JSON.stringify({ instanceName, groups: json.data }),
        });
        const syncJson = await syncRes.json();
        if (syncJson.success) {
          showToast('success', 'Grupos buscados e salvos. Na próxima vez serão carregados do banco.');
        } else {
          showToast('success', 'Grupos buscados (falha ao salvar no banco).');
        }
        await loadSavedGroupsAll();
      } else if (json.success) {
        showToast('success', 'Nenhum grupo encontrado na instância.');
        await loadSavedGroupsAll();
      } else {
        showToast('error', json.error || 'Erro ao buscar grupos');
      }
    } catch (e: any) {
      showToast('error', e?.message || 'Erro ao buscar grupos');
    } finally {
      setFetchingGroups(false);
    }
  }, [userId, selectedConfigId, configs, instances, loadSavedGroupsAll]);

  const toggleGroupProtected = useCallback(
    async (groupId: string, groupName: string, isCurrentlyProtected: boolean) => {
      if (!userId || !selectedConfigId) return;
      setTogglingGroupId(groupId);
      try {
        if (isCurrentlyProtected) {
          const res = await fetch(
            `/api/admin/anti-spam/groups?config_id=${encodeURIComponent(selectedConfigId)}&group_jid=${encodeURIComponent(groupId)}`,
            { method: 'DELETE', headers: { 'X-User-Id': userId } }
          );
          const json = await res.json();
          if (json.success) {
            setProtectedGroupIds((prev) => {
              const next = new Set(prev);
              next.delete(groupId);
              return next;
            });
          } else {
            showToast('error', json.error || 'Erro ao remover');
          }
        } else {
          const res = await fetch('/api/admin/anti-spam/groups', {
            method: 'POST',
            headers: { 'X-User-Id': userId, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              config_id: selectedConfigId,
              group_jid: groupId,
              group_name: groupName || groupId,
            }),
          });
          const json = await res.json();
          if (json.success) {
            setProtectedGroupIds((prev) => new Set(prev).add(groupId));
          } else {
            showToast('error', json.error || 'Erro ao adicionar');
          }
        }
      } catch (e: any) {
        showToast('error', e?.message || 'Erro');
      } finally {
        setTogglingGroupId(null);
      }
    },
    [userId, selectedConfigId]
  );

  useEffect(() => {
    loadBancas();
  }, [loadBancas]);

  useEffect(() => {
    loadInstances();
  }, [loadInstances]);

  useEffect(() => {
    loadConfigs();
  }, [loadConfigs]);

  useEffect(() => {
    if (activeTab === 'blacklist') loadBlacklist();
    if (activeTab === 'events') loadJoinEvents();
    if (activeTab === 'logs') loadActions();
    if (activeTab === 'groups') loadGroupsTabData();
  }, [activeTab, loadBlacklist, loadJoinEvents, loadActions, loadGroupsTabData]);

  useEffect(() => {
    setEventsPage(1);
    setBlacklistPage(1);
  }, [selectedConfigId]);

  // Carrega grupos salvos (todas as instâncias) para o dropdown "Grupo para denúncias" e para a aba Grupos protegidos
  useEffect(() => {
    if (userId) loadSavedGroupsAll();
  }, [userId, loadSavedGroupsAll]);

  const handleSaveConfig = async (payload: Partial<AntiSpamConfigRow>) => {
    if (!userId) return;
    const banca = bancaId || payload.banca_id;
    if (!banca) {
      showToast('error', 'Selecione uma banca primeiro.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/admin/anti-spam/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
        body: JSON.stringify({ ...payload, banca_id: banca }),
      });
      const json = await res.json();
      if (json.success) {
        showToast('success', json.message || 'Salvo');
        await loadConfigs();
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
    if (!userId || !selectedConfigId) return;
    try {
      const res = await fetch('/api/admin/anti-spam/blacklist/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
        body: JSON.stringify({ config_id: selectedConfigId, phone_e164: phone, reason: 'manual' }),
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

  const handleRemoveFromBlacklist = async (configId: string, phoneE164: string) => {
    if (!userId) return;
    try {
      const res = await fetch('/api/admin/anti-spam/blacklist/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
        body: JSON.stringify({ config_id: configId, phone_e164: phoneE164 }),
      });
      const json = await res.json();
      if (json.success) {
        showToast('success', 'Número removido da lista negra');
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

  const handleVerifyGroups = useCallback(async () => {
    if (!userId || !selectedConfigId) return;
    setVerifyingGroups(true);
    setVerifyGroupsResult(null);
    try {
      const res = await fetch('/api/admin/anti-spam/verify-groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
        body: JSON.stringify({ config_id: selectedConfigId }),
      });
      const json = await res.json();
      if (json.success && json.data) {
        setVerifyGroupsResult(json.data);
        const s = json.data.summary;
        if (s.totalRemovals > 0) {
          showToast(
            s.failed === 0 ? 'success' : 'error',
            `Verificação concluída: ${s.success} remoção(ões) com sucesso${s.failed > 0 ? `, ${s.failed} falha(s)` : ''}.`
          );
        } else if (json.data.report?.length > 0) {
          showToast('success', `Encontrados ${json.data.report.length} número(s) da blacklist em grupos. Remoções executadas.`);
        } else {
          showToast('success', json.data.message || 'Nenhum número da blacklist encontrado nos grupos monitorados.');
        }
        loadActions();
      } else {
        showToast('error', json.error || 'Erro ao verificar grupos');
      }
    } catch (e: any) {
      showToast('error', e?.message || 'Erro ao verificar grupos');
    } finally {
      setVerifyingGroups(false);
    }
  }, [userId, selectedConfigId, loadActions]);

  if (checking) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[40vh]">
          <Loader2 className="w-8 h-8 animate-spin text-gray-500" />
        </div>
      </Layout>
    );
  }

  const config = configs.find((c) => c.id === selectedConfigId) ?? configs[0] ?? null;
  const totalPages = Math.ceil(actionsTotal / 25);

  const inputClass =
    'mt-1 block w-full rounded-lg border border-gray-300 dark:border-[#555] bg-white dark:bg-[#333] px-3 py-2 text-sm text-gray-800 dark:text-gray-200 placeholder:text-gray-500 dark:placeholder-gray-400 focus:border-[#8CD955] focus:ring-2 focus:ring-[#8CD955]/20 [color-scheme:light] dark:[color-scheme:dark]';
  const inputClassInline =
    'rounded-lg border border-gray-300 dark:border-[#555] bg-white dark:bg-[#333] px-3 py-2 text-sm text-gray-800 dark:text-gray-200 placeholder:text-gray-500 dark:placeholder-gray-400 focus:border-[#8CD955] focus:ring-2 focus:ring-[#8CD955]/20 [color-scheme:light] dark:[color-scheme:dark]';

  return (
    <Layout>
      <div className="p-4 md:p-6 lg:p-8 max-w-5xl mx-auto">
        {verifyingGroups && (
          <div className="sticky top-0 z-20 -mx-4 -mt-4 px-4 pt-4 pb-2 md:-mx-6 md:-mt-6 md:px-6 md:pt-6 lg:-mx-8 lg:-mt-8 lg:px-8 lg:pt-8 mb-4 flex items-center justify-center gap-2 rounded-b-lg bg-[#8CD955]/15 dark:bg-[#8CD955]/20 border-b-2 border-[#8CD955]/50 shadow-sm">
            <Loader2 className="h-5 w-5 animate-spin text-[#8CD955]" />
            <span className="text-sm font-medium text-gray-800 dark:text-gray-200">Verificação de grupos em andamento em segundo plano</span>
          </div>
        )}
        <header className="mb-8">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                <Shield className="h-8 w-8 text-[#8CD955]" />
                Anti-Spam
              </h1>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Proteja seus grupos: bloqueie números indesejados e remova automaticamente quem está na lista negra.
              </p>
            </div>
          </div>
        </header>

        {toast && (
          <div
            className={`mb-6 p-4 rounded-xl flex items-center gap-2 shadow-sm ${
              toast.type === 'success'
                ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-800 dark:text-emerald-200 border border-emerald-200 dark:border-emerald-700'
                : 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200 border border-red-200 dark:border-red-700'
            }`}
          >
            {toast.type === 'success' ? <CheckCircle2 className="w-5 h-5 shrink-0" /> : <AlertCircle className="w-5 h-5 shrink-0" />}
            <span className="text-sm font-medium">{toast.message}</span>
          </div>
        )}

        <div className="mb-6 rounded-xl border border-gray-200 dark:border-[#404040] bg-white dark:bg-[#2a2a2a] p-4 shadow-sm">
          <div className="flex flex-wrap items-end gap-4">
            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Banca</span>
              <select
                value={bancaId}
                onChange={(e) => {
                  setBancaId(e.target.value);
                  setSelectedConfigId('');
                }}
                className={`${inputClassInline} w-64 md:w-72 min-w-[200px]`}
              >
                <option value="">Selecione a banca</option>
                {bancas.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name || b.url || b.id}
                  </option>
                ))}
              </select>
            </label>
            {configs.length > 1 && (
              <label className="flex flex-col gap-1">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Configuração anti-spam</span>
                <select
                  value={selectedConfigId}
                  onChange={(e) => setSelectedConfigId(e.target.value)}
                  className={`${inputClassInline} w-56 min-w-[180px]`}
                >
                  {configs.map((c, idx) => (
                    <option key={c.id} value={c.id}>
                      Configuração {idx + 1} {c.is_enabled ? '(ativa)' : '(inativa)'}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button
              type="button"
              onClick={loadConfigs}
              className="rounded-lg border border-gray-300 dark:border-[#555] bg-white dark:bg-[#333] px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-[#404040] inline-flex items-center gap-2 transition"
            >
              <RefreshCw className="w-4 h-4" /> Atualizar
            </button>
          </div>
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            São listadas apenas as bancas em que você tem conta (mesmo critério do CRM).
          </p>
        </div>

        <div className="mb-6 border-b border-gray-200 dark:border-[#404040]">
          <nav className="flex gap-1 flex-wrap" aria-label="Abas">
            {(['config', 'groups', 'blacklist', 'events', 'logs'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-3 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${
                  activeTab === tab
                    ? 'border-[#8CD955] text-[#8CD955] bg-[#8CD955]/10 dark:bg-[#8CD955]/15'
                    : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#333]'
                }`}
              >
                {tab === 'config' && 'Configuração'}
                {tab === 'groups' && 'Grupos protegidos'}
                {tab === 'blacklist' && 'Lista negra'}
                {tab === 'events' && 'Quem entrou'}
                {tab === 'logs' && 'Números removidos'}
              </button>
            ))}
          </nav>
        </div>

        {activeTab === 'config' && (
          <div className="rounded-xl border border-gray-200 dark:border-[#404040] bg-white dark:bg-[#2a2a2a] p-6 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Configuração</h2>
              <button
                type="button"
                onClick={handleTestRun}
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-lg bg-[#8CD955] px-4 py-2 text-sm font-medium text-white hover:bg-[#7BC84A] disabled:opacity-50 shrink-0 transition"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Activity className="w-4 h-4" />}
                Executar teste
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <label className="block">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Proteção ativa</span>
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
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Instância que recebe eventos e remove</span>
                <select
                  value={config?.master_instance_id ?? ''}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (!value) return;
                    if (config) {
                      handleSaveConfig({ ...config, master_instance_id: value });
                    } else {
                      handleSaveConfig({
                        banca_id: bancaId,
                        master_instance_id: value,
                        is_enabled: false,
                        denuncia_group_jid: '',
                        scan_mode: 'all_groups',
                        watcher_instance_id: null,
                      });
                    }
                  }}
                  disabled={saving}
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
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Instância auxiliar (opcional)</span>
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
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Grupo para denúncias</span>
                  {config?.master_instance_id && (
                    <button
                      type="button"
                      onClick={fetchGroupsFromInstance}
                      disabled={fetchingGroups}
                      className="inline-flex items-center gap-1 rounded border border-gray-300 dark:border-[#555] bg-white dark:bg-[#333] px-2 py-1 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-[#404040] transition disabled:opacity-50"
                    >
                      {fetchingGroups ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                      Buscar grupos da instância
                    </button>
                  )}
                </div>
                <select
                  value={config?.denuncia_group_jid ?? ''}
                  onChange={(e) => config && handleSaveConfig({ ...config, denuncia_group_jid: e.target.value })}
                  className={inputClass}
                  disabled={!config?.master_instance_id}
                >
                  <option value="">Nenhum</option>
                  {(config?.master_instance_id
                    ? savedGroups.filter(
                        (g) => g.instance_name === instances.find((i) => i.id === config.master_instance_id)?.instance_name
                      )
                    : savedGroups
                  ).map((g) => (
                    <option key={g.group_id} value={g.group_id}>
                      {g.group_subject || g.group_id}
                    </option>
                  ))}
                </select>
                {config?.master_instance_id && savedGroups.length === 0 && !loadingGroups && !fetchingGroups && (
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    Nenhum grupo salvo ainda. Clique em &quot;Buscar grupos da instância&quot; acima para carregar os grupos da instância selecionada.
                  </p>
                )}
              </label>
              <label className="block md:col-span-2">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Quais grupos proteger</span>
                <select
                  value={config?.scan_mode ?? 'all_groups'}
                  onChange={(e) =>
                    config && handleSaveConfig({ ...config, scan_mode: e.target.value as 'all_groups' | 'selected_groups' })
                  }
                  className={inputClass}
                >
                  <option value="all_groups">Todos os grupos</option>
                  <option value="selected_groups">Apenas grupos que eu escolher</option>
                </select>
              </label>
            </div>
            {bancaId.trim() && (
              <div className="mt-6 pt-4 border-t border-gray-100 dark:border-[#404040]">
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
                  className="inline-flex items-center gap-2 rounded-lg bg-[#8CD955] px-4 py-2 text-sm font-medium text-white hover:bg-[#7BC84A] disabled:opacity-50 transition"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  {configs.length > 0 ? 'Nova configuração para esta banca' : 'Criar configuração'}
                </button>
              </div>
            )}
          </div>
        )}

        {activeTab === 'groups' && (
          <div className="rounded-xl border border-gray-200 dark:border-[#404040] bg-white dark:bg-[#2a2a2a] p-6 shadow-sm">
            {verifyingGroups && <VerifyGroupsOverlay isActive={verifyingGroups} />}
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">Grupos protegidos</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              Se você escolheu &quot;Apenas grupos que eu escolher&quot;, marque abaixo os grupos que deseja proteger.
              Os grupos listados são os que você já tem salvos. Use o botão para atualizar a lista a partir da instância.
            </p>
            {!selectedConfigId ? (
              <p className="text-sm text-amber-600 dark:text-amber-400">Selecione uma banca acima. Se houver mais de uma configuração, escolha também qual usar.</p>
            ) : !config?.master_instance_id ? (
              <p className="text-sm text-amber-600 dark:text-amber-400">
                Selecione na aba <strong>Configuração</strong> o campo &quot;Instância que recebe eventos e remove&quot;, salve e volte aqui para listar os grupos.
              </p>
            ) : !instances.find((i) => i.id === config.master_instance_id) ? (
              <p className="text-sm text-amber-600 dark:text-amber-400">A instância desta configuração não está na lista. Atualize a página ou verifique o acesso às instâncias.</p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2 mb-4">
                  <button
                    type="button"
                    onClick={fetchGroupsFromInstance}
                    disabled={fetchingGroups || loadingGroups}
                    className="inline-flex items-center gap-2 rounded-lg border border-gray-300 dark:border-[#555] bg-white dark:bg-[#333] px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-[#404040] disabled:opacity-50 transition"
                  >
                    {fetchingGroups ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                    Buscar grupos da instância
                  </button>
                  <button
                    type="button"
                    onClick={handleVerifyGroups}
                    disabled={verifyingGroups || loadingGroups}
                    className="inline-flex items-center gap-2 rounded-lg bg-[#8CD955] px-4 py-2 text-sm font-medium text-white hover:bg-[#7BC84A] disabled:opacity-50 transition"
                  >
                    {verifyingGroups ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
                    Verificar grupos
                  </button>
                  {loadingGroups && (
                    <span className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-1">
                      <Loader2 className="w-4 h-4 animate-spin" /> Carregando…
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
                  Verificar grupos: consulta os participantes de cada grupo monitorado, identifica números da blacklist e remove (um por request). Exige ao menos um grupo protegido.
                </p>
                {verifyGroupsResult && (
                  <div className="mb-6 rounded-xl border border-gray-200 dark:border-[#404040] bg-gray-50 dark:bg-[#333] p-4 space-y-4">
                    <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Resultado da verificação</h3>
                    <div className="flex flex-wrap gap-4 text-sm">
                      <span className="text-gray-600 dark:text-gray-300">
                        Encontrados em grupos: <strong>{verifyGroupsResult.summary.totalInGroups}</strong>
                      </span>
                      <span className="text-gray-600 dark:text-gray-300">
                        Remoções: <strong className="text-emerald-600 dark:text-emerald-400">{verifyGroupsResult.summary.success} sucesso</strong>
                        {verifyGroupsResult.summary.failed > 0 && (
                          <>, <strong className="text-red-600 dark:text-red-400">{verifyGroupsResult.summary.failed} falha(s)</strong></>
                        )}
                      </span>
                    </div>
                    {verifyGroupsResult.groupErrors && verifyGroupsResult.groupErrors.length > 0 && (
                      <div className="text-sm">
                        <span className="font-medium text-amber-700 dark:text-amber-400">Erros ao consultar grupos:</span>
                        <ul className="mt-1 list-disc list-inside text-amber-700 dark:text-amber-300">
                          {verifyGroupsResult.groupErrors.map((e, i) => (
                            <li key={i}>{e.groupJid}: {e.error}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {verifyGroupsResult.report.length > 0 && (
                      <div>
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Por número (em quantos grupos foi encontrado):</span>
                        <ul className="mt-2 space-y-1 text-sm text-gray-600 dark:text-gray-400">
                          {verifyGroupsResult.report.map((r, i) => (
                            <li key={i}>
                              <strong>{r.phone_e164}</strong> — em <strong>{r.groups_count}</strong> grupo(s)
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {verifyGroupsResult.removals.length > 0 && (
                      <div>
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Remoções (sucesso / falha):</span>
                        <ul className="mt-2 space-y-1 text-sm max-h-48 overflow-y-auto">
                          {verifyGroupsResult.removals.map((m, i) => (
                            <li key={i} className="flex items-center gap-2">
                              {m.success ? (
                                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-500" />
                              ) : (
                                <span title={m.error}><XCircle className="w-4 h-4 shrink-0 text-red-500" /></span>
                              )}
                              <span className="text-gray-700 dark:text-gray-300">{m.phone_e164}</span>
                              <span className="text-gray-500 dark:text-gray-400 truncate max-w-[200px]" title={m.group_jid}>{m.group_jid}</span>
                              {!m.success && m.error && (
                                <span className="text-red-600 dark:text-red-400 text-xs" title={m.error}>{m.error}</span>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
                {savedGroups.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Nenhum grupo salvo ainda. Use &quot;Buscar grupos da instância&quot; para carregar os grupos da instância da configuração.
                  </p>
                ) : (
                  <ul className="space-y-2 max-h-[360px] overflow-y-auto rounded-lg border border-gray-200 dark:border-[#404040] p-3">
                    {savedGroups.map((g) => {
                      const isProtected = protectedGroupIds.has(g.group_id);
                      const busy = togglingGroupId === g.group_id;
                      return (
                        <li
                          key={g.group_id}
                          className="flex items-center gap-3 py-2 px-2 rounded-lg hover:bg-gray-50 dark:hover:bg-[#333]"
                        >
                          <button
                            type="button"
                            onClick={() => toggleGroupProtected(g.group_id, g.group_subject, isProtected)}
                            disabled={busy}
                            className="flex items-center gap-2 text-left min-w-0 flex-1"
                          >
                            {busy ? (
                              <Loader2 className="w-4 h-4 animate-spin shrink-0 text-[#8CD955]" />
                            ) : (
                              <span
                                className={`shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center ${
                                  isProtected
                                    ? 'bg-[#8CD955] border-[#8CD955] text-white'
                                    : 'border-gray-400 dark:border-gray-500'
                                }`}
                              >
                                {isProtected && <CheckCircle2 className="w-3 h-3" />}
                              </span>
                            )}
                            <span className="text-sm text-gray-800 dark:text-gray-200 truncate" title={g.group_subject}>
                              {g.group_subject || g.group_id}
                            </span>
                            {g.instance_name && (
                              <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">({g.instance_name})</span>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </>
            )}
          </div>
        )}

        {activeTab === 'events' && (
          <div className="rounded-xl border border-gray-200 dark:border-[#404040] bg-white dark:bg-[#2a2a2a] p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">Quem entrou nos grupos</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">
              Números que entraram recentemente nos grupos. Clique em &quot;Bloquear&quot; para adicionar à lista negra e removê-los automaticamente.
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">
              Os eventos vêm do webhook do Zaploto de produção.
            </p>
            <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-[#404040]">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-[#404040] bg-gray-50 dark:bg-[#333] text-left">
                    <th className="py-3 px-3 font-medium text-gray-700 dark:text-gray-300">Data/hora</th>
                    <th className="py-3 px-3 font-medium text-gray-700 dark:text-gray-300">Grupo</th>
                    <th className="py-3 px-3 font-medium text-gray-700 dark:text-gray-300">Número</th>
                    <th className="py-3 px-3 font-medium text-gray-700 dark:text-gray-300">Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {joinEvents.map((r, idx) => (
                    <tr key={`${r.id}-${r.phone}-${idx}`} className="border-b border-gray-100 dark:border-[#404040] hover:bg-gray-50/50 dark:hover:bg-[#333]/50">
                      <td className="py-3 px-3 text-gray-600 dark:text-gray-400">{new Date(r.received_at).toLocaleString('pt-BR')}</td>
                      <td className="py-3 px-3 text-gray-800 dark:text-gray-200 truncate max-w-[180px]" title={r.group_id}>
                        {r.group_subject || r.group_id || '—'}
                      </td>
                      <td className="py-3 px-3 text-gray-800 dark:text-gray-200 font-medium">{r.phone}</td>
                      <td className="py-3 px-3">
                        <button
                          type="button"
                          onClick={() => handleAddBlacklist(r.phone)}
                          className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium bg-[#8CD955] text-white hover:bg-[#7BC84A] transition"
                        >
                          <Plus className="w-3 h-3" /> Bloquear
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {joinEvents.length === 0 && !loading && <p className="text-gray-500 dark:text-gray-400 py-8 text-center text-sm">Nenhuma entrada recente.</p>}
            </div>
            {eventsTotal > 0 && (() => {
              const totalPages = Math.ceil(eventsTotal / EVENTS_PAGE_SIZE) || 1;
              const pages: (number | 'ellipsis')[] =
                totalPages <= 7
                  ? Array.from({ length: totalPages }, (_, i) => i + 1)
                  : (() => {
                      const nums = [...new Set([1, eventsPage, totalPages])].sort((a, b) => a - b);
                      const out: (number | 'ellipsis')[] = [];
                      nums.forEach((n, i) => {
                        if (i > 0 && n - (nums[i - 1] as number) > 1) out.push('ellipsis');
                        out.push(n);
                      });
                      return out;
                    })();
              return (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-gray-600 dark:text-gray-400">
                  <span>
                    Mostrando {(eventsPage - 1) * EVENTS_PAGE_SIZE + 1}–{Math.min(eventsPage * EVENTS_PAGE_SIZE, eventsTotal)} de {eventsTotal}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setEventsPage((p) => Math.max(1, p - 1))}
                      disabled={eventsPage <= 1}
                      className="rounded-lg border border-gray-300 dark:border-[#555] bg-white dark:bg-[#333] px-3 py-1.5 font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-[#404040] disabled:opacity-50 disabled:pointer-events-none"
                    >
                      Anterior
                    </button>
                    {pages.map((p, i) =>
                      p === 'ellipsis' ? (
                        <span key={`e-${i}`} className="px-1 text-gray-400">…</span>
                      ) : (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setEventsPage(p)}
                          className={`min-w-[2rem] rounded-lg border px-2 py-1.5 text-sm font-medium transition ${
                            eventsPage === p
                              ? 'border-[#8CD955] bg-[#8CD955] text-white'
                              : 'border-gray-300 dark:border-[#555] bg-white dark:bg-[#333] text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-[#404040]'
                          }`}
                        >
                          {p}
                        </button>
                      )
                    )}
                    <button
                      type="button"
                      onClick={() => setEventsPage((p) => p + 1)}
                      disabled={eventsPage * EVENTS_PAGE_SIZE >= eventsTotal}
                      className="rounded-lg border border-gray-300 dark:border-[#555] bg-white dark:bg-[#333] px-3 py-1.5 font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-[#404040] disabled:opacity-50 disabled:pointer-events-none"
                    >
                      Próxima
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {activeTab === 'blacklist' && (
          <div className="rounded-xl border border-gray-200 dark:border-[#404040] bg-white dark:bg-[#2a2a2a] p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">Lista negra (global)</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              Números na lista global são removidos automaticamente ao entrar nos grupos da banca. Apenas super_admin, admin e auditoria têm acesso.
            </p>
            <div className="flex flex-wrap gap-2 mb-4">
              <input
                type="text"
                id="new-phone"
                placeholder="Número com DDD (ex: 31999887766)"
                className={`${inputClassInline} flex-1 min-w-[200px] max-w-xs`}
              />
              <button
                type="button"
                onClick={() => {
                  const el = document.getElementById('new-phone') as HTMLInputElement;
                  if (el?.value.trim()) handleAddBlacklist(el.value.trim());
                }}
                className="inline-flex items-center gap-2 rounded-lg bg-[#8CD955] px-4 py-2 text-sm font-medium text-white hover:bg-[#7BC84A] transition"
              >
                <Plus className="w-4 h-4" /> Adicionar
              </button>
            </div>
            <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-[#404040]">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-[#404040] bg-gray-50 dark:bg-[#333] text-left">
                    <th className="py-3 px-3 font-medium text-gray-700 dark:text-gray-300">Número</th>
                    <th className="py-3 px-3 font-medium text-gray-700 dark:text-gray-300">Motivo</th>
                    <th className="py-3 px-3 font-medium text-gray-700 dark:text-gray-300">Status</th>
                    <th className="py-3 px-3 font-medium text-gray-700 dark:text-gray-300">Última vez</th>
                    <th className="py-3 px-3 font-medium text-gray-700 dark:text-gray-300">Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {blacklist.map((r) => (
                    <tr key={r.id} className="border-b border-gray-100 dark:border-[#404040] hover:bg-gray-50/50 dark:hover:bg-[#333]/50">
                      <td className="py-3 px-3 text-gray-800 dark:text-gray-200">{r.phone_e164}</td>
                      <td className="py-3 px-3 text-gray-700 dark:text-gray-300">{r.reason}</td>
                      <td className="py-3 px-3 text-gray-700 dark:text-gray-300">{r.status}</td>
                      <td className="py-3 px-3 text-gray-500 dark:text-gray-400">{new Date(r.last_seen_at).toLocaleString('pt-BR')}</td>
                      <td className="py-3 px-3">
                        <button
                          type="button"
                          onClick={() => selectedConfigId && handleRemoveFromBlacklist(selectedConfigId, r.phone_e164)}
                          className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium border border-red-300 dark:border-red-600 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 transition"
                        >
                          <Trash2 className="w-3 h-3" /> Remover
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {blacklist.length === 0 && <p className="text-gray-500 dark:text-gray-400 py-8 text-center text-sm">Nenhum número na lista negra.</p>}
            </div>
            {blacklistTotal > 0 && (() => {
              const totalPages = Math.ceil(blacklistTotal / BLACKLIST_PAGE_SIZE) || 1;
              const pages: (number | 'ellipsis')[] =
                totalPages <= 7
                  ? Array.from({ length: totalPages }, (_, i) => i + 1)
                  : (() => {
                      const nums = [...new Set([1, blacklistPage, totalPages])].sort((a, b) => a - b);
                      const out: (number | 'ellipsis')[] = [];
                      nums.forEach((n, i) => {
                        if (i > 0 && n - (nums[i - 1] as number) > 1) out.push('ellipsis');
                        out.push(n);
                      });
                      return out;
                    })();
              return (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-gray-600 dark:text-gray-400">
                  <span>
                    Mostrando {(blacklistPage - 1) * BLACKLIST_PAGE_SIZE + 1}–{Math.min(blacklistPage * BLACKLIST_PAGE_SIZE, blacklistTotal)} de {blacklistTotal}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setBlacklistPage((p) => Math.max(1, p - 1))}
                      disabled={blacklistPage <= 1}
                      className="rounded-lg border border-gray-300 dark:border-[#555] bg-white dark:bg-[#333] px-3 py-1.5 font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-[#404040] disabled:opacity-50 disabled:pointer-events-none"
                    >
                      Anterior
                    </button>
                    {pages.map((p, i) =>
                      p === 'ellipsis' ? (
                        <span key={`e-${i}`} className="px-1 text-gray-400">…</span>
                      ) : (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setBlacklistPage(p)}
                          className={`min-w-[2rem] rounded-lg border px-2 py-1.5 text-sm font-medium transition ${
                            blacklistPage === p
                              ? 'border-[#8CD955] bg-[#8CD955] text-white'
                              : 'border-gray-300 dark:border-[#555] bg-white dark:bg-[#333] text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-[#404040]'
                          }`}
                        >
                          {p}
                        </button>
                      )
                    )}
                    <button
                      type="button"
                      onClick={() => setBlacklistPage((p) => p + 1)}
                      disabled={blacklistPage * BLACKLIST_PAGE_SIZE >= blacklistTotal}
                      className="rounded-lg border border-gray-300 dark:border-[#555] bg-white dark:bg-[#333] px-3 py-1.5 font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-[#404040] disabled:opacity-50 disabled:pointer-events-none"
                    >
                      Próxima
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {activeTab === 'logs' && (
          <div className="rounded-xl border border-gray-200 dark:border-[#404040] bg-white dark:bg-[#2a2a2a] p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">Números removidos e ações</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              Histórico de remoções e bloqueios. Mostra quem foi removido, de qual grupo e o resultado.
            </p>
            <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-[#404040]">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-[#404040] bg-gray-50 dark:bg-[#333] text-left">
                    <th className="py-3 px-3 font-medium text-gray-700 dark:text-gray-300">Data</th>
                    <th className="py-3 px-3 font-medium text-gray-700 dark:text-gray-300">Ação</th>
                    <th className="py-3 px-3 font-medium text-gray-700 dark:text-gray-300">Resultado</th>
                    <th className="py-3 px-3 font-medium text-gray-700 dark:text-gray-300">Grupo</th>
                    <th className="py-3 px-3 font-medium text-gray-700 dark:text-gray-300">Número</th>
                    <th className="py-3 px-3 font-medium text-gray-700 dark:text-gray-300">Erro</th>
                  </tr>
                </thead>
                <tbody>
                  {actions.map((r) => (
                    <tr key={r.id} className="border-b border-gray-100 dark:border-[#404040] hover:bg-gray-50/50 dark:hover:bg-[#333]/50">
                      <td className="py-3 px-3 text-gray-600 dark:text-gray-400">{new Date(r.created_at).toLocaleString('pt-BR')}</td>
                      <td className="py-3 px-3 text-gray-800 dark:text-gray-200">{r.action === 'remove_from_group' ? 'Remoção do grupo' : r.action === 'add_to_blacklist' ? 'Adicionado à lista negra' : r.action}</td>
                      <td className="py-3 px-3">
                        {r.result === 'success' && <CheckCircle2 className="w-4 h-4 text-[#8CD955] inline" />}
                        {r.result === 'fail' && <XCircle className="w-4 h-4 text-red-500 inline" />}
                        {r.result === 'skipped' && <span className="text-gray-500 dark:text-gray-400">ignorado</span>}
                        <span className="text-gray-700 dark:text-gray-300 ml-1">{r.result === 'success' ? 'Sucesso' : r.result === 'fail' ? 'Falha' : r.result}</span>
                      </td>
                      <td className="py-3 px-3 text-gray-700 dark:text-gray-300 truncate max-w-[140px]" title={r.group_jid ?? ''}>{r.group_jid ?? '—'}</td>
                      <td className="py-3 px-3 text-gray-700 dark:text-gray-300 font-medium">{r.phone_e164 ?? '—'}</td>
                      <td className={`py-3 px-3 max-w-[200px] truncate ${r.error_message ? 'text-red-500 dark:text-red-400' : 'text-gray-500 dark:text-gray-400'}`} title={r.error_message ?? ''}>
                        {r.error_message ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {actions.length === 0 && !loading && <p className="text-gray-500 dark:text-gray-400 py-8 text-center text-sm">Nenhuma ação registrada ainda.</p>}
            </div>
            {totalPages > 1 && (
              <div className="mt-4 flex items-center justify-between border-t border-gray-100 dark:border-[#404040] pt-4">
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  Página {actionsPage} de {totalPages}
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setActionsPage((p) => Math.max(1, p - 1))}
                    disabled={actionsPage <= 1}
                    className="rounded-lg border border-gray-300 dark:border-[#555] bg-white dark:bg-[#333] px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-[#404040] disabled:opacity-50 transition"
                  >
                    Anterior
                  </button>
                  <button
                    type="button"
                    onClick={() => setActionsPage((p) => p + 1)}
                    disabled={actionsPage >= totalPages}
                    className="rounded-lg border border-gray-300 dark:border-[#555] bg-white dark:bg-[#333] px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-[#404040] disabled:opacity-50 transition"
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
