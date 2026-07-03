'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRequireAuth } from '@/utils/useRequireAuth';
import Layout from '@/components/Layout';
import Pagination from '@/components/Admin/Pagination';
import {
  ClipboardList,
  RefreshCw,
  Loader2,
  Calendar,
  Database,
  FileText,
  Users,
  Hash,
  ArrowDownFromLine,
  ArrowUpToLine,
  Download,
  CloudDownload,
  Search,
} from 'lucide-react';

type ListMode = 'recent' | 'unique_phones' | 'groups_evasion';
type MainTab = 'resumo' | 'raw';

interface ExitRecord {
  id?: string;
  group_id: string;
  group_subject?: string | null;
  phone: string;
  action: string;
  event_type: string;
  author?: string | null;
  occurred_at: string;
  created_at?: string;
  banca_id?: string | null;
  evolution_instance_id?: string;
}

interface UniquePhoneRow {
  phone: string;
  exit_count: number;
  last_exit_at: string;
}

interface GroupEvasionRow {
  group_id: string;
  exit_count: number;
}

interface RawEventRow {
  id: string;
  received_at: string;
  env: string;
  event_type: string;
  instance_name: string | null;
  remote_jid: string | null;
  action: 'add' | 'remove' | null;
  group_id: string;
  group_subject?: string | null;
  phone: string;
  payload?: any;
}

export default function AdminAuditPage() {
  const { checking, userId } = useRequireAuth();
  const [mainTab, setMainTab] = useState<MainTab>('resumo');
  const [listMode, setListMode] = useState<ListMode>('recent');
  const [data, setData] = useState<ExitRecord[] | UniquePhoneRow[] | GroupEvasionRow[] | RawEventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [limit] = useState(25);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [env, setEnv] = useState<'prod' | 'test' | ''>('');
  const [actionFilter, setActionFilter] = useState<'add' | 'remove' | ''>('');
  const [groupNameFilter, setGroupNameFilter] = useState('');
  const [instanceFilter, setInstanceFilter] = useState('');
  const [instancesList, setInstancesList] = useState<string[]>([]);
  const [syncingNames, setSyncingNames] = useState(false);
  const [toSyncCount, setToSyncCount] = useState<number | null>(null);
  const [syncSuccessMsg, setSyncSuccessMsg] = useState<string | null>(null);

  const fetchResumo = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('list', listMode);
      params.set('page', String(page));
      params.set('limit', String(limit));
      if (dateFrom) params.set('date_from', dateFrom);
      if (dateTo) params.set('date_to', dateTo);
      if (groupNameFilter.trim()) params.set('group_name', groupNameFilter.trim());
      if (instanceFilter.trim()) params.set('instance_name', instanceFilter.trim());
      const res = await fetch(`/api/admin/audit/participant-exits?${params.toString()}`, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'Erro ao carregar auditoria');
        setData([]);
        return;
      }
      setData(json.data ?? []);
      const pag = json.pagination;
      if (pag) {
        setTotal(pag.total ?? 0);
        setTotalPages(pag.totalPages ?? 0);
      }
    } catch (e: any) {
      setError(e?.message || 'Erro ao carregar');
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [userId, listMode, page, limit, dateFrom, dateTo, groupNameFilter, instanceFilter]);

  const fetchRawEvents = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', String(limit));
      if (dateFrom) params.set('date_from', dateFrom);
      if (dateTo) params.set('date_to', dateTo);
      if (env) params.set('env', env);
      if (actionFilter) params.set('action', actionFilter);
      if (instanceFilter.trim()) params.set('instance_name', instanceFilter.trim());
      const res = await fetch(`/api/admin/audit/raw-events?${params.toString()}`, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'Erro ao carregar eventos');
        setData([]);
        return;
      }
      setData(json.data ?? []);
      const pag = json.pagination;
      if (pag) {
        setTotal(pag.total ?? 0);
        setTotalPages(pag.totalPages ?? 0);
      }
    } catch (e: any) {
      setError(e?.message || 'Erro ao carregar');
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [userId, page, limit, dateFrom, dateTo, env, actionFilter, instanceFilter]);

  const fetchData = useCallback(() => {
    if (mainTab === 'resumo') fetchResumo();
    else fetchRawEvents();
  }, [mainTab, fetchResumo, fetchRawEvents]);

  useEffect(() => {
    if (checking || !userId) return;
    if (mainTab === 'resumo') fetchResumo();
    else fetchRawEvents();
  }, [checking, userId, mainTab, page, listMode, dateFrom, dateTo, env, actionFilter, instanceFilter, fetchResumo, fetchRawEvents]);

  const fetchInstances = useCallback(async () => {
    if (!userId) return;
    try {
      const res = await fetch('/api/admin/audit/instances', { credentials: 'include', headers: { 'X-User-Id': userId } });
      const json = await res.json();
      if (res.ok && Array.isArray(json.data)) setInstancesList(json.data);
    } catch {
      setInstancesList([]);
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    fetchInstances();
  }, [userId, fetchInstances]);

  const loadToSyncCount = useCallback(async () => {
    if (!userId) return;
    try {
      const res = await fetch('/api/admin/audit/group-names/to-sync', { credentials: 'include', headers: { 'X-User-Id': userId } });
      const json = await res.json();
      if (res.ok && json.data?.totalPairs != null) setToSyncCount(json.data.totalPairs);
    } catch {
      setToSyncCount(null);
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    loadToSyncCount();
  }, [userId, loadToSyncCount]);

  const handleSyncNames = useCallback(async () => {
    if (!userId) return;
    setSyncingNames(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/audit/group-names/sync-background', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Erro ao iniciar sincronização');
      const msg = json.data?.message ?? 'Sincronização iniciada em segundo plano. O processo continuará automaticamente.';
      setError(null);
      setSyncSuccessMsg(msg);
      setTimeout(() => setSyncSuccessMsg(null), 6000);
      await loadToSyncCount();
      fetchData();
    } catch (e: any) {
      setError(e?.message || 'Erro ao iniciar sincronização');
    } finally {
      setSyncingNames(false);
    }
  }, [userId, loadToSyncCount, fetchData]);

  const handleExportCsv = useCallback(async () => {
    const params = new URLSearchParams();
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
    if (groupNameFilter.trim()) params.set('group_name', groupNameFilter.trim());
    if (instanceFilter.trim()) params.set('instance_name', instanceFilter.trim());
    params.set('limit', '5000');
    const res = await fetch(`/api/admin/audit/export-csv?${params.toString()}`, { credentials: 'include', headers: { 'X-User-Id': userId ?? '' } });
    if (!res.ok) {
      setError('Erro ao exportar CSV. Verifique os filtros e tente novamente.');
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `auditoria-saidas-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [dateFrom, dateTo, groupNameFilter, instanceFilter, userId]);

  if (checking) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[200px]">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
        </div>
      </Layout>
    );
  }

  const formatDate = (s: string) => (s ? new Date(s).toLocaleString('pt-BR') : '—');

  return (
    <Layout>
      <div className="p-4 md:p-6 lg:p-8 max-w-7xl mx-auto min-h-screen bg-[#1a1a1a] -m-4 sm:-m-6 lg:-m-8">
        {/* Header */}
        <header className="mb-8">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-100 flex items-center gap-2">
                <ClipboardList className="h-8 w-8 text-[#E86A24]" />
                Auditoria de saídas
              </h1>
              <p className="mt-1 text-sm text-gray-400">
                Eventos <code className="bg-[#2a2a2a] px-1 rounded text-gray-300">group-participants.update</code> — organize os que já estão no banco e acompanhe os novos.
              </p>
            </div>
          </div>
        </header>

        {/* Tabs: Resumo | Eventos brutos */}
        <div className="mb-6 border-b border-[#404040]">
          <nav className="flex gap-1" aria-label="Abas">
            <button
              type="button"
              onClick={() => { setMainTab('resumo'); setPage(1); setError(null); }}
              className={`px-4 py-3 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${
                mainTab === 'resumo'
                  ? 'border-[#E86A24] text-[#E86A24] bg-[#E86A24]/10'
                  : 'border-transparent text-gray-500 hover:text-gray-300 hover:bg-[#2a2a2a]'
              }`}
            >
              <span className="flex items-center gap-2">
                <Database className="h-4 w-4" />
                Resumo de saídas
              </span>
            </button>
            <button
              type="button"
              onClick={() => { setMainTab('raw'); setPage(1); setError(null); }}
              className={`px-4 py-3 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${
                mainTab === 'raw'
                  ? 'border-[#E86A24] text-[#E86A24] bg-[#E86A24]/10'
                  : 'border-transparent text-gray-500 hover:text-gray-300 hover:bg-[#2a2a2a]'
              }`}
            >
              <span className="flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Eventos brutos (group-participants.update)
              </span>
            </button>
          </nav>
        </div>

        {/* Buscar e salvar nomes dos grupos */}
        <div className="mb-6 rounded-xl border border-[#404040] bg-[#2a2a2a] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <CloudDownload className="h-5 w-5 text-[#E86A24]" />
              <span className="text-sm font-medium text-gray-200">Nomes dos grupos</span>
              {toSyncCount != null && toSyncCount > 0 && (
                <span className="text-xs text-gray-500">({toSyncCount} grupo(s) para sincronizar)</span>
              )}
            </div>
            <button
              type="button"
              onClick={handleSyncNames}
              disabled={syncingNames || (toSyncCount != null && toSyncCount === 0)}
              className="rounded-lg bg-[#E86A24] px-4 py-2 text-sm font-medium text-white hover:bg-[#D95E1B] disabled:opacity-50 flex items-center gap-2"
            >
              {syncingNames ? <Loader2 className="h-4 w-4 animate-spin" /> : <CloudDownload className="h-4 w-4" />}
              {syncingNames ? 'Buscando e salvando…' : 'Executar em segundo plano'}
            </button>
          </div>
          <p className="mt-2 text-xs text-gray-500">
            Usa o endpoint Evolution <code className="bg-[#1a1a1a] px-1 rounded text-gray-400">/group/findGroupInfos</code> para obter o nome de cada grupo e gravar na tabela <code className="bg-[#1a1a1a] px-1 rounded text-gray-400">audit_group_names</code>. O processo roda em segundo plano para evitar timeout.
          </p>
          {syncSuccessMsg && (
            <p className="mt-2 text-sm text-[#E86A24] font-medium">{syncSuccessMsg}</p>
          )}
        </div>

        {/* Filtros em card */}
        <div className="mb-6 rounded-xl border border-[#404040] bg-[#2a2a2a] p-4 shadow-sm">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <Calendar className="h-4 w-4 text-gray-500" />
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
                className="rounded-lg border border-[#404040] bg-[#1a1a1a] px-3 py-2 text-sm text-gray-200 focus:ring-2 focus:ring-[#E86A24] focus:border-[#E86A24]"
              />
              <span className="text-gray-500">até</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
                className="rounded-lg border border-[#404040] bg-[#1a1a1a] px-3 py-2 text-sm text-gray-200 focus:ring-2 focus:ring-[#E86A24] focus:border-[#E86A24]"
              />
            </div>
            <div className="flex items-center gap-1">
              <span className="text-xs font-medium text-gray-500 whitespace-nowrap">Instância:</span>
              <select
                value={instanceFilter}
                onChange={(e) => { setInstanceFilter(e.target.value); setPage(1); }}
                className="rounded-lg border border-[#404040] px-3 py-2 text-sm bg-[#1a1a1a] text-gray-200 focus:ring-2 focus:ring-[#E86A24] min-w-[160px]"
                title="Filtrar por instância WhatsApp (ex: GERALBANCAS, zapcontabo)"
              >
                <option value="">Todas as instâncias</option>
                {instancesList.map((inst) => (
                  <option key={inst} value={inst}>{inst}</option>
                ))}
              </select>
            </div>
            {mainTab === 'resumo' && (
              <>
                <div className="flex items-center gap-1">
                  <Search className="h-4 w-4 text-gray-500" />
                  <input
                    type="text"
                    placeholder="Nome do grupo"
                    value={groupNameFilter}
                    onChange={(e) => { setGroupNameFilter(e.target.value); setPage(1); }}
                    className="rounded-lg border border-[#404040] bg-[#1a1a1a] px-3 py-2 text-sm w-44 text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-[#E86A24]"
                  />
                </div>
                <select
                  value={listMode}
                  onChange={(e) => { setListMode(e.target.value as ListMode); setPage(1); }}
                  className="rounded-lg border border-[#404040] px-3 py-2 text-sm bg-[#1a1a1a] text-gray-200 focus:ring-2 focus:ring-[#E86A24]"
                >
                  <option value="recent">Saídas recentes</option>
                  <option value="unique_phones">Telefones únicos</option>
                  <option value="groups_evasion">Grupos com maior evasão</option>
                </select>
              </>
            )}
            {mainTab === 'raw' && (
              <>
                <select
                  value={env}
                  onChange={(e) => { setEnv(e.target.value as 'prod' | 'test' | ''); setPage(1); }}
                  className="rounded-lg border border-[#404040] px-3 py-2 text-sm bg-[#1a1a1a] text-gray-200 focus:ring-2 focus:ring-[#E86A24]"
                >
                  <option value="">Todos os ambientes</option>
                  <option value="prod">Produção</option>
                  <option value="test">Teste</option>
                </select>
                <select
                  value={actionFilter}
                  onChange={(e) => { setActionFilter(e.target.value as 'add' | 'remove' | ''); setPage(1); }}
                  className="rounded-lg border border-[#404040] px-3 py-2 text-sm bg-[#1a1a1a] text-gray-200 focus:ring-2 focus:ring-[#E86A24]"
                >
                  <option value="">Todas as ações</option>
                  <option value="remove">Saída / Remoção</option>
                  <option value="add">Entrada</option>
                </select>
              </>
            )}
            <button
              type="button"
              onClick={fetchData}
              disabled={loading}
              className="rounded-lg bg-[#E86A24] px-4 py-2 text-sm font-medium text-white hover:bg-[#D95E1B] disabled:opacity-50 flex items-center gap-2"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Atualizar
            </button>
            {mainTab === 'resumo' && (
              <button
                type="button"
                onClick={handleExportCsv}
                className="rounded-lg border border-[#404040] px-4 py-2 text-sm font-medium text-gray-300 hover:bg-[#404040] flex items-center gap-2"
              >
                <Download className="h-4 w-4" />
                Exportar CSV
              </button>
            )}
          </div>
        </div>

        {error && (
          <div className="mb-4 p-4 rounded-xl bg-red-900/30 border border-red-500/50 text-red-300 text-sm flex items-center gap-2">
            <span className="flex-shrink-0 w-8 h-8 rounded-full bg-red-900/50 flex items-center justify-center">!</span>
            {error}
          </div>
        )}

        {/* Tabela em card */}
        <div className="rounded-xl border border-[#404040] bg-[#2a2a2a] shadow-sm overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-10 w-10 animate-spin text-[#E86A24]" />
            </div>
          ) : mainTab === 'raw' ? (
            <>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-[#404040]">
                  <thead className="bg-[#1a1a1a]">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Data/Hora</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Ambiente</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Ação</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Instância</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Nome do grupo</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">ID do grupo</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Telefone</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#404040] bg-[#2a2a2a]">
                    {(data as RawEventRow[]).map((row) => (
                      <tr key={row.id} className="hover:bg-[#404040]/50">
                        <td className="px-4 py-3 text-sm text-gray-300 whitespace-nowrap">{formatDate(row.received_at)}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${row.env === 'prod' ? 'bg-blue-900/40 text-blue-300' : 'bg-amber-900/40 text-amber-300'}`}>
                            {row.env}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {row.action === 'remove' ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-red-900/40 text-red-300">
                              <ArrowDownFromLine className="h-3 w-3" /> Saída
                            </span>
                          ) : row.action === 'add' ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-green-900/40 text-green-300">
                              <ArrowUpToLine className="h-3 w-3" /> Entrada
                            </span>
                          ) : (
                            <span className="text-gray-400 text-xs">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-300 font-mono truncate max-w-[140px]" title={row.instance_name ?? ''}>{row.instance_name ?? '—'}</td>
                        <td className="px-4 py-3 text-sm text-gray-200 font-medium max-w-[180px] truncate" title={row.group_subject ?? ''}>{row.group_subject || '—'}</td>
                        <td className="px-4 py-3 text-sm text-gray-400 font-mono truncate max-w-[180px]" title={row.group_id}>{row.group_id || '—'}</td>
                        <td className="px-4 py-3 text-sm text-gray-200">{row.phone || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {data.length === 0 && !loading && (
                <div className="py-16 text-center">
                  <FileText className="mx-auto h-12 w-12 text-gray-500" />
                  <p className="mt-2 text-sm text-gray-400">Nenhum evento group-participants.update no período.</p>
                  <p className="mt-1 text-xs text-gray-500">Os eventos aparecem aqui quando o webhook recebe entradas/saídas de participantes.</p>
                </div>
              )}
            </>
          ) : listMode === 'recent' ? (
            <>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-[#404040]">
                  <thead className="bg-[#1a1a1a]">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Nome do grupo</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">ID do grupo</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Telefone</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Autor</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Data/Hora</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#404040] bg-[#2a2a2a]">
                    {(data as ExitRecord[]).map((row, i) => (
                      <tr key={row.id ?? i} className="hover:bg-[#404040]/50">
                        <td className="px-4 py-3 text-sm text-gray-200 font-medium max-w-[220px] truncate" title={row.group_subject ?? ''}>{row.group_subject || '—'}</td>
                        <td className="px-4 py-3 text-sm text-gray-400 font-mono truncate max-w-[180px]" title={row.group_id}>{row.group_id}</td>
                        <td className="px-4 py-3 text-sm text-gray-200">{row.phone}</td>
                        <td className="px-4 py-3 text-sm text-gray-400">{row.author ?? '—'}</td>
                        <td className="px-4 py-3 text-sm text-gray-400 whitespace-nowrap">{formatDate(row.occurred_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {data.length === 0 && !loading && (
                <div className="py-16 text-center">
                  <Users className="mx-auto h-12 w-12 text-gray-500" />
                  <p className="mt-2 text-sm text-gray-400">Nenhum registro de saída no período.</p>
                  <p className="mt-1 text-xs text-gray-400">Use a aba &quot;Eventos brutos&quot; para ver todos os eventos group-participants.update e organizar.</p>
                </div>
              )}
            </>
          ) : listMode === 'unique_phones' ? (
            <>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-[#404040]">
                  <thead className="bg-[#1a1a1a]">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Telefone</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Saídas</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Última saída</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#404040] bg-[#2a2a2a]">
                    {(data as UniquePhoneRow[]).map((row, i) => (
                      <tr key={row.phone + i} className="hover:bg-[#404040]/50">
                        <td className="px-4 py-3 text-sm text-gray-200 font-mono">{row.phone}</td>
                        <td className="px-4 py-3 text-sm text-gray-300">{row.exit_count}</td>
                        <td className="px-4 py-3 text-sm text-gray-400 whitespace-nowrap">{formatDate(row.last_exit_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {data.length === 0 && !loading && (
                <div className="py-16 text-center">
                  <Hash className="mx-auto h-12 w-12 text-gray-300" />
                  <p className="mt-2 text-sm text-gray-500">Nenhum telefone único no período.</p>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-[#404040]">
                  <thead className="bg-[#1a1a1a]">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Grupo</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Saídas</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#404040] bg-[#2a2a2a]">
                    {(data as GroupEvasionRow[]).map((row, i) => (
                      <tr key={row.group_id + i} className="hover:bg-[#404040]/50">
                        <td className="px-4 py-3 text-sm text-gray-300 font-mono truncate max-w-[320px]" title={row.group_id}>{row.group_id}</td>
                        <td className="px-4 py-3 text-sm text-gray-200 font-medium">{row.exit_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {data.length === 0 && !loading && (
                <div className="py-16 text-center">
                  <Users className="mx-auto h-12 w-12 text-gray-300" />
                  <p className="mt-2 text-sm text-gray-500">Nenhum grupo no período.</p>
                </div>
              )}
            </>
          )}

          {totalPages > 1 && (
            <div className="border-t border-[#404040] px-4 py-3 flex justify-center bg-[#1a1a1a]">
              <Pagination
                currentPage={page}
                totalPages={totalPages}
                onPageChange={setPage}
                itemsPerPage={limit}
                totalItems={total}
              />
            </div>
          )}
        </div>

        <p className="mt-4 text-xs text-gray-500">
          Resumo: tabela <code className="bg-[#2a2a2a] px-1 rounded text-gray-400">group_participant_exits</code> (apenas action: remove). Eventos brutos: <code className="bg-[#2a2a2a] px-1 rounded text-gray-400">evolution_webhook_events</code> com event_type group-participants.update. Acesso: admin e auditoria.
        </p>
      </div>
    </Layout>
  );
}
