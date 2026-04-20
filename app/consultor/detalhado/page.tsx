'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import Layout from '@/components/Layout';
import { useRequireAuth } from '@/utils/useRequireAuth';
import {
  ClipboardList,
  Users,
  Search,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Coins,
  Wallet,
  Target,
  Layers,
} from 'lucide-react';
import ConsultorFiltersBar, {
  type BancaOption,
  type ConsultorOption,
  type DateFilterKey,
} from '@/components/consultor/ConsultorFiltersBar';
import ExportCsvMenu from '@/components/consultor/ExportCsvMenu';
import {
  buildConsultorDetailRows,
  summarizeDetailRows,
  type ConsultorDetailKind,
  type ConsultorDetailRow,
} from '@/lib/utils/consultor-detail-rows';

interface BetsDepositsPayload {
  consultant_scope?: {
    type: 'single' | 'multi';
    count: number;
    consultants: Array<{ id: string; email: string; full_name: string | null; status?: string | null }>;
  };
  totals?: {
    total_apostas: string;
    total_depositos: string;
    total_comissao: string;
  };
  commission_by_type?: any[];
  history?: {
    bets_by_user?: { data?: any[] };
    deposits_by_user?: { data?: any[] };
  };
}

interface DashboardResponse {
  success: boolean;
  data?: {
    externalKpis?: any;
    betsDepositsData?: BetsDepositsPayload | null;
    adsSummary?: any;
  };
}

const KIND_LABEL: Record<ConsultorDetailKind, string> = {
  aposta: 'Aposta',
  deposito: 'Depósito',
  comissao: 'Comissão',
};

const KIND_STYLE: Record<ConsultorDetailKind, string> = {
  aposta: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/20',
  deposito: 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border border-blue-500/20',
  comissao: 'bg-purple-500/15 text-purple-700 dark:text-purple-300 border border-purple-500/20',
};

type SortKey =
  | 'consultant_name'
  | 'consultant_status'
  | 'kind'
  | 'user_name'
  | 'category'
  | 'date'
  | 'value'
  | 'count';

const PAGE_SIZE = 50;

function formatDateLocal(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatBr(value: number): string {
  return value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

export default function ConsultorDetalhadoPage() {
  const { checking, userId } = useRequireAuth();

  const [userStatus, setUserStatus] = useState<string | null>(null);
  const [bancas, setBancas] = useState<BancaOption[]>([]);
  const [selectedBanca, setSelectedBanca] = useState<string | null>(null);

  const [consultoresDaBanca, setConsultoresDaBanca] = useState<ConsultorOption[]>([]);
  const [consultoresLoading, setConsultoresLoading] = useState(false);
  const [selectedConsultorId, setSelectedConsultorId] = useState<string>('all');

  const [dateFilter, setDateFilter] = useState<DateFilterKey>('30days');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [appliedStartDate, setAppliedStartDate] = useState('');
  const [appliedEndDate, setAppliedEndDate] = useState('');

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<DashboardResponse['data'] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  // filtros locais da tabela
  const [kindFilter, setKindFilter] = useState<'all' | ConsultorDetailKind>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('value');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);

  const canFilterConsultorDesempenho = [
    'super_admin',
    'admin',
    'gerente',
    'gestor',
    'dono_banca',
  ].includes(userStatus || '');

  // Carrega escopo (perfil + bancas visíveis) em uma chamada
  useEffect(() => {
    if (!userId) return;
    (async () => {
      try {
        const res = await fetch('/api/consultor/meu-desempenho/scope', {
          headers: { 'X-User-Id': userId },
        }).then((r) => r.json());
        if (res?.success && res.data) {
          const list = Array.isArray(res.data.bancas) ? res.data.bancas : [];
          setBancas(list);
          if (res.data.userStatus) setUserStatus(res.data.userStatus);
          if (!selectedBanca && list.length === 1 && list[0]?.url) {
            setSelectedBanca(list[0].url);
          }
        }
      } catch (error) {
        console.error('[MeuDesempenho/Detalhado] Falha ao carregar escopo:', error);
      }
    })();
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!userId) {
      setConsultoresDaBanca([]);
      setSelectedConsultorId('all');
      return;
    }
    if (!selectedBanca) {
      setConsultoresDaBanca([]);
      setSelectedConsultorId('all');
      return;
    }
    setConsultoresLoading(true);
    fetch(`/api/consultor/meu-desempenho/scope?banca_url=${encodeURIComponent(selectedBanca)}`, {
      headers: { 'X-User-Id': userId },
    })
      .then((r) => r.json())
      .then((res) => {
        if (res?.success && res.data) {
          const profiles = Array.isArray(res.data.consultantProfiles)
            ? res.data.consultantProfiles
            : [];
          setConsultoresDaBanca(profiles);
          if (res.data.userStatus && res.data.userStatus !== userStatus) {
            setUserStatus(res.data.userStatus);
          }
        }
      })
      .finally(() => setConsultoresLoading(false));
  }, [userId, selectedBanca]); // eslint-disable-line react-hooks/exhaustive-deps

  // Calcula período aplicado
  useEffect(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let from: string | null = null;
    let to: string | null = null;
    switch (dateFilter) {
      case 'daily':
        from = formatDateLocal(today);
        to = formatDateLocal(today);
        break;
      case 'yesterday': {
        const d = new Date(today);
        d.setDate(d.getDate() - 1);
        from = formatDateLocal(d);
        to = formatDateLocal(d);
        break;
      }
      case '7days': {
        const d = new Date(today);
        d.setDate(d.getDate() - 6);
        from = formatDateLocal(d);
        to = formatDateLocal(today);
        break;
      }
      case '15days': {
        const d = new Date(today);
        d.setDate(d.getDate() - 14);
        from = formatDateLocal(d);
        to = formatDateLocal(today);
        break;
      }
      case '30days': {
        const d = new Date(today);
        d.setDate(d.getDate() - 29);
        from = formatDateLocal(d);
        to = formatDateLocal(today);
        break;
      }
      case 'custom':
        if (customStartDate && customEndDate) {
          from = customStartDate;
          to = customEndDate;
        }
        break;
      case 'all':
      default:
        from = null;
        to = null;
    }
    setAppliedStartDate(from || '');
    setAppliedEndDate(to || '');
  }, [dateFilter, customStartDate, customEndDate]);

  // Fetch dados do dashboard (endpoint único, skip_legacy=1 para performance)
  useEffect(() => {
    if (!userId) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const params = new URLSearchParams();
    if (appliedStartDate) params.set('date_from', appliedStartDate);
    if (appliedEndDate) params.set('date_to', appliedEndDate);
    if (selectedBanca) params.set('banca_url', selectedBanca);
    if (canFilterConsultorDesempenho && selectedConsultorId !== 'all') {
      params.set('consultor_id', selectedConsultorId);
    }
    params.set('skip_legacy', '1');

    setLoading(true);
    setError(null);

    fetch(`/api/consultor/dashboard?${params.toString()}`, {
      headers: { 'X-User-Id': userId },
      signal: controller.signal,
    })
      .then((r) => r.json() as Promise<DashboardResponse>)
      .then((res) => {
        if (res.success && res.data) {
          setData(res.data);
        } else {
          setData(null);
          setError('Não foi possível carregar os dados.');
        }
      })
      .catch((err: any) => {
        if (err?.name === 'AbortError') return;
        setError('Falha ao carregar dados.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [userId, selectedBanca, selectedConsultorId, appliedStartDate, appliedEndDate, canFilterConsultorDesempenho]);

  // Linhas planas
  const rows = useMemo(
    () => buildConsultorDetailRows(data?.betsDepositsData ?? null),
    [data?.betsDepositsData]
  );
  const summary = useMemo(() => summarizeDetailRows(rows), [rows]);

  // Aplica filtros locais
  const filteredRows = useMemo(() => {
    let out = rows;
    if (kindFilter !== 'all') out = out.filter((r) => r.kind === kindFilter);
    const term = searchTerm.trim().toLowerCase();
    if (term) {
      out = out.filter((r) =>
        [
          r.consultant_name,
          r.consultant_email,
          r.user_name,
          r.user_email,
          r.category,
          r.wallet ?? '',
        ]
          .join(' ')
          .toLowerCase()
          .includes(term)
      );
    }
    return out;
  }, [rows, kindFilter, searchTerm]);

  // Ordenação
  const sortedRows = useMemo(() => {
    const out = [...filteredRows];
    out.sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      const av = (a[sortKey] ?? '') as any;
      const bv = (b[sortKey] ?? '') as any;
      if (typeof av === 'number' && typeof bv === 'number') {
        return (av - bv) * dir;
      }
      return String(av).localeCompare(String(bv), 'pt-BR', { numeric: true }) * dir;
    });
    return out;
  }, [filteredRows, sortKey, sortDir]);

  // Paginação
  useEffect(() => {
    setPage(1);
  }, [kindFilter, searchTerm, sortKey, sortDir, appliedStartDate, appliedEndDate, selectedBanca, selectedConsultorId]);

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE));
  const pagedRows = useMemo(
    () => sortedRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [sortedRows, page]
  );

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const handleApplyCustomDate = () => {
    // custom aplica via useEffect assim que customStart/End mudam para dateFilter='custom'
    if (customStartDate && customEndDate) {
      setAppliedStartDate(customStartDate);
      setAppliedEndDate(customEndDate);
    }
  };

  const handleSignOut = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      window.location.href = '/login';
    } catch {
      window.location.href = '/login';
    }
  };

  const bancaName = selectedBanca ? bancas.find((b) => b.url === selectedBanca)?.name || null : null;
  const selectedConsultor = consultoresDaBanca.find((c) => c.id === selectedConsultorId);

  const scopeText =
    selectedConsultorId !== 'all' && selectedConsultor
      ? `Perfil selecionado: ${selectedConsultor.full_name || selectedConsultor.email}`
      : data?.betsDepositsData?.consultant_scope?.consultants
      ? userStatus === 'gerente'
        ? `Equipe (${data.betsDepositsData.consultant_scope.consultants.length})`
        : `Todos os perfis da banca (${data.betsDepositsData.consultant_scope.consultants.length})`
      : 'Seu desempenho';

  if (checking) return null;

  return (
    <Layout onSignOut={handleSignOut}>
      <div className="w-full space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-[#8CD95515] rounded-xl">
              <ClipboardList className="w-6 h-6 text-[#8CD955]" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-800 dark:text-white">Desempenho Detalhado</h1>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Todas as informações linha a linha, prontas para análise e exportação
              </p>
            </div>
          </div>

          <ConsultorFiltersBar
            bancas={bancas}
            selectedBanca={selectedBanca}
            onChangeBanca={setSelectedBanca}
            showConsultorFilter={canFilterConsultorDesempenho}
            consultores={consultoresDaBanca}
            consultoresLoading={consultoresLoading}
            selectedConsultorId={selectedConsultorId}
            onChangeConsultor={setSelectedConsultorId}
            dateFilter={dateFilter}
            onChangeDateFilter={setDateFilter}
            customStartDate={customStartDate}
            customEndDate={customEndDate}
            onChangeCustomStartDate={setCustomStartDate}
            onChangeCustomEndDate={setCustomEndDate}
            onApplyCustomDate={handleApplyCustomDate}
            rightSlot={
              <>
                <ExportCsvMenu
                  disabled={loading}
                  bancaName={bancaName}
                  bancaUrl={selectedBanca}
                  dateFrom={appliedStartDate || null}
                  dateTo={appliedEndDate || null}
                  scope={scopeText}
                  totals={data?.betsDepositsData?.totals || null}
                  externalKpis={data?.externalKpis || null}
                  adsSummary={data?.adsSummary || null}
                  commissionByType={data?.betsDepositsData?.commission_by_type || null}
                  betsByUser={data?.betsDepositsData?.history?.bets_by_user?.data || null}
                  depositsByUser={data?.betsDepositsData?.history?.deposits_by_user?.data || null}
                />
                <Link
                  href="/consultor"
                  className="flex items-center gap-2 bg-[#8CD955] hover:bg-[#7BC84A] text-white px-4 py-2.5 rounded-xl text-sm font-bold transition-all shadow-md shadow-[#8CD955]/20"
                >
                  <Users className="w-4 h-4" />
                  Visão Geral
                </Link>
              </>
            }
          />
        </div>

        {/* Cards de resumo / filtro de kind */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <button
            onClick={() => setKindFilter('all')}
            className={`text-left p-4 rounded-2xl border transition-all ${
              kindFilter === 'all'
                ? 'border-[#8CD955] bg-[#8CD95510] shadow-sm'
                : 'border-gray-200 dark:border-[#404040] bg-white dark:bg-[#2a2a2a] hover:bg-gray-50 dark:hover:bg-[#333]'
            }`}
          >
            <div className="flex items-center gap-2 text-xs font-bold uppercase text-gray-500 dark:text-gray-400 mb-2">
              <Layers className="w-3.5 h-3.5" /> Todas as linhas
            </div>
            <div className="text-2xl font-bold text-gray-900 dark:text-white">{summary.total.toLocaleString('pt-BR')}</div>
            <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
              {loading ? 'Atualizando...' : scopeText}
            </div>
          </button>

          <button
            onClick={() => setKindFilter('aposta')}
            className={`text-left p-4 rounded-2xl border transition-all ${
              kindFilter === 'aposta'
                ? 'border-amber-500 bg-amber-500/10 shadow-sm'
                : 'border-gray-200 dark:border-[#404040] bg-white dark:bg-[#2a2a2a] hover:bg-gray-50 dark:hover:bg-[#333]'
            }`}
          >
            <div className="flex items-center gap-2 text-xs font-bold uppercase text-amber-600 dark:text-amber-300 mb-2">
              <Target className="w-3.5 h-3.5" /> Apostas
            </div>
            <div className="text-2xl font-bold text-gray-900 dark:text-white">
              {summary.apostas.toLocaleString('pt-BR')}
            </div>
            <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
              R$ {formatBr(summary.valor_apostas)}
            </div>
          </button>

          <button
            onClick={() => setKindFilter('deposito')}
            className={`text-left p-4 rounded-2xl border transition-all ${
              kindFilter === 'deposito'
                ? 'border-blue-500 bg-blue-500/10 shadow-sm'
                : 'border-gray-200 dark:border-[#404040] bg-white dark:bg-[#2a2a2a] hover:bg-gray-50 dark:hover:bg-[#333]'
            }`}
          >
            <div className="flex items-center gap-2 text-xs font-bold uppercase text-blue-600 dark:text-blue-300 mb-2">
              <Wallet className="w-3.5 h-3.5" /> Depósitos
            </div>
            <div className="text-2xl font-bold text-gray-900 dark:text-white">
              {summary.depositos.toLocaleString('pt-BR')}
            </div>
            <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
              R$ {formatBr(summary.valor_depositos)}
            </div>
          </button>

          <button
            onClick={() => setKindFilter('comissao')}
            className={`text-left p-4 rounded-2xl border transition-all ${
              kindFilter === 'comissao'
                ? 'border-purple-500 bg-purple-500/10 shadow-sm'
                : 'border-gray-200 dark:border-[#404040] bg-white dark:bg-[#2a2a2a] hover:bg-gray-50 dark:hover:bg-[#333]'
            }`}
          >
            <div className="flex items-center gap-2 text-xs font-bold uppercase text-purple-600 dark:text-purple-300 mb-2">
              <Coins className="w-3.5 h-3.5" /> Comissões
            </div>
            <div className="text-2xl font-bold text-gray-900 dark:text-white">
              {summary.comissoes.toLocaleString('pt-BR')}
            </div>
            <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
              R$ {formatBr(summary.valor_comissoes)}
            </div>
          </button>
        </div>

        {/* Busca */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Buscar por consultor, usuário, email, categoria..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-2.5 bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-[#404040] rounded-xl text-sm text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-[#8CD955]/30 outline-none"
            />
          </div>
          <div className="text-sm text-gray-500 dark:text-gray-400">
            {sortedRows.length.toLocaleString('pt-BR')}{' '}
            {sortedRows.length === 1 ? 'linha' : 'linhas'}
            {searchTerm || kindFilter !== 'all' ? ' (filtradas)' : ''}
          </div>
        </div>

        {/* Tabela */}
        <div className="bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-[#404040] rounded-2xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-[#333] text-gray-600 dark:text-gray-300">
                <tr>
                  <SortableTh label="Consultor" sortKey="consultant_name" current={sortKey} dir={sortDir} onSort={handleSort} />
                  <SortableTh label="Cargo" sortKey="consultant_status" current={sortKey} dir={sortDir} onSort={handleSort} />
                  <SortableTh label="Tipo" sortKey="kind" current={sortKey} dir={sortDir} onSort={handleSort} />
                  <SortableTh label="Categoria" sortKey="category" current={sortKey} dir={sortDir} onSort={handleSort} />
                  <SortableTh label="Usuário" sortKey="user_name" current={sortKey} dir={sortDir} onSort={handleSort} />
                  <SortableTh label="Data" sortKey="date" current={sortKey} dir={sortDir} onSort={handleSort} />
                  <SortableTh label="Qtd" sortKey="count" current={sortKey} dir={sortDir} onSort={handleSort} align="right" />
                  <SortableTh label="Valor (R$)" sortKey="value" current={sortKey} dir={sortDir} onSort={handleSort} align="right" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-[#404040]">
                {loading && pagedRows.length === 0 && (
                  <TableSkeletonRows />
                )}
                {!loading && pagedRows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-gray-500 dark:text-gray-400">
                      {error ? error : 'Nenhuma linha para o filtro atual.'}
                    </td>
                  </tr>
                )}
                {pagedRows.map((row) => (
                  <tr key={row.id} className="hover:bg-gray-50 dark:hover:bg-[#2f2f2f] transition-colors">
                    <td className="px-4 py-3 text-gray-900 dark:text-gray-100 font-medium">
                      <div className="truncate max-w-[220px]" title={row.consultant_email}>
                        {row.consultant_name || row.consultant_email}
                      </div>
                      <div className="text-[11px] text-gray-500 dark:text-gray-400 truncate">{row.consultant_email}</div>
                    </td>
                    <td className="px-4 py-3 text-[11px] uppercase text-gray-500 dark:text-gray-400">
                      {row.consultant_status || 'consultor'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold ${KIND_STYLE[row.kind]}`}>
                        {KIND_LABEL[row.kind]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-700 dark:text-gray-300 capitalize">
                      {row.category}
                      {row.wallet ? <span className="ml-1 text-[10px] text-gray-500">({row.wallet})</span> : null}
                    </td>
                    <td className="px-4 py-3 text-gray-900 dark:text-gray-100">
                      <div className="truncate max-w-[200px]">{row.user_name || '—'}</div>
                      <div className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                        {row.user_email || (row.user_id ? `#${row.user_id}` : '')}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                      {formatDateTime(row.date)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-700 dark:text-gray-200">
                      {row.count != null ? row.count.toLocaleString('pt-BR') : '—'}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-bold text-gray-900 dark:text-white">
                      {formatBr(row.value)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Paginação */}
          {sortedRows.length > PAGE_SIZE && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 dark:border-[#404040] text-sm text-gray-600 dark:text-gray-300">
              <div>
                Mostrando {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, sortedRows.length)} de {sortedRows.length.toLocaleString('pt-BR')}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="p-2 rounded-lg border border-gray-200 dark:border-[#404040] hover:bg-gray-50 dark:hover:bg-[#333] disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-xs">
                  Página <strong>{page}</strong> de <strong>{totalPages}</strong>
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="p-2 rounded-lg border border-gray-200 dark:border-[#404040] hover:bg-gray-50 dark:hover:bg-[#333] disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}

interface SortableThProps {
  label: string;
  sortKey: SortKey;
  current: SortKey;
  dir: 'asc' | 'desc';
  onSort: (key: SortKey) => void;
  align?: 'left' | 'right';
}

function SortableTh({ label, sortKey, current, dir, onSort, align = 'left' }: SortableThProps) {
  const active = current === sortKey;
  return (
    <th
      onClick={() => onSort(sortKey)}
      className={`px-4 py-3 font-bold text-xs uppercase tracking-wide cursor-pointer select-none hover:bg-gray-100 dark:hover:bg-[#3a3a3a] transition-colors ${
        align === 'right' ? 'text-right' : 'text-left'
      }`}
    >
      <span className={`inline-flex items-center gap-1 ${active ? 'text-[#8CD955]' : ''}`}>
        {label}
        <ArrowUpDown className={`w-3 h-3 ${active ? 'opacity-100' : 'opacity-30'}`} />
        {active ? <span className="text-[10px]">{dir === 'asc' ? '↑' : '↓'}</span> : null}
      </span>
    </th>
  );
}

function TableSkeletonRows() {
  return (
    <>
      {Array.from({ length: 8 }).map((_, i) => (
        <tr key={i}>
          {Array.from({ length: 8 }).map((_, j) => (
            <td key={j} className="px-4 py-4">
              <div className="h-3 bg-gray-200 dark:bg-[#3a3a3a] rounded animate-pulse" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
