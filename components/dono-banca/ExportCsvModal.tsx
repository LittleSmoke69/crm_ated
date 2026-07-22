'use client';

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { X, Download, Loader2, XCircle, Users, CheckCircle2 } from 'lucide-react';
import FilterBar from '@/components/CRM/FilterBar';

/** Lead no formato da API crm-export (para distribuir nas colunas Kanban). */
interface ExportLead {
  id: string;
  name: string;
  last_name?: string;
  email?: string;
  phone?: string;
  status?: string;
  total_depositado?: number;
  total_apostado?: number;
  total_depositos_count?: number;
  balance?: number;
  available_withdraw?: number;
  last_deposit_at?: string | null;
  last_interaction?: string | null;
  has_interaction?: boolean;
}

const KANBAN_COLUMNS: { id: string; title: string; headerClass: string }[] = [
  { id: 'novo', title: '👥 Clientes cadastrados', headerClass: 'bg-gray-500/10' },
  { id: 'contactados', title: '📞 Contactados', headerClass: 'bg-blue-500/10' },
  { id: 'deposito_sem_aposta', title: '💰 Com Saldo', headerClass: 'bg-red-500/10' },
  { id: 'saque_disponivel', title: '💸 Saque Disp.', headerClass: 'bg-teal-500/10' },
  { id: 'deposito_1x', title: '💰 1º Depósito', headerClass: 'bg-emerald-500/10' },
  { id: 'deposito_2x', title: '🔥 2º Depósito', headerClass: 'bg-orange-500/10' },
  { id: 'deposito_3x', title: '💎 3X', headerClass: 'bg-indigo-500/10' },
  { id: 'deposito_5x', title: '⭐ 5X', headerClass: 'bg-amber-500/10' },
  { id: 'deposito_10x', title: '👑 10X+', headerClass: 'bg-rose-500/10' },
  { id: 'ativo', title: '✅ Ativo', headerClass: 'bg-purple-500/10' },
  { id: 'possivel_transferencia', title: '🔄 Poss. transferência', headerClass: 'bg-amber-500/10' },
];

function isLeadPast90Days(lead: ExportLead): boolean {
  if (!lead.last_deposit_at) return false;
  const lastDeposit = new Date(lead.last_deposit_at);
  const deadline = new Date(lastDeposit);
  deadline.setDate(deadline.getDate() + 90);
  return Date.now() >= deadline.getTime();
}

/** Distribui leads nas colunas (mesma lógica do CRM Kanban). */
function distributeLeadsToColumns(leads: ExportLead[]): Record<string, ExportLead[]> {
  const col: Record<string, ExportLead[]> = {
    novo: [], contactados: [], deposito_sem_aposta: [], saque_disponivel: [], deposito_1x: [],
    deposito_2x: [], deposito_3x: [], deposito_5x: [], deposito_10x: [], ativo: [], possivel_transferencia: [],
  };
  for (const l of leads) {
    const count = l.total_depositos_count ?? 0;
    const depositado = l.total_depositado ?? 0;
    const apostado = l.total_apostado ?? 0;
    const ok = depositado <= apostado;
    const availWithdraw = parseFloat(String(l.available_withdraw ?? 0)) || 0;
    if (count === 0 && l.status !== 'ativo' && !(l.has_interaction === true)) col.novo.push(l);
    if (l.has_interaction === true && count === 0) col.contactados.push(l);
    if (depositado > apostado || (l.balance ?? 0) > 0) col.deposito_sem_aposta.push(l);
    if (availWithdraw > 0) col.saque_disponivel.push(l);
    if (count === 1 && ok) col.deposito_1x.push(l);
    if (count === 2 && ok) col.deposito_2x.push(l);
    if (count >= 3 && count < 5 && ok) col.deposito_3x.push(l);
    if (count >= 5 && count < 10 && ok) col.deposito_5x.push(l);
    if (count >= 10 && ok) col.deposito_10x.push(l);
    if (l.status === 'ativo') col.ativo.push(l);
    if (isLeadPast90Days(l)) col.possivel_transferencia.push(l);
  }
  return col;
}

export interface BancaOption {
  id: string;
  name: string;
  url: string;
}

interface ExportCsvModalProps {
  open: boolean;
  onClose: () => void;
  userId: string;
  /** Lista de bancas (para resolver banca_id a partir do filtro). Se vazio, FilterBar carrega via API. */
  bancasFromParent?: BancaOption[];
  /** Banca pré-selecionada (id) quando o usuário não pode escolher (ex.: dono com uma banca). */
  defaultBancaId?: string | null;
  /** Se true, o filtro de banca no FilterBar permite escolher banca; senão usa defaultBancaId. */
  showBancaSelector?: boolean;
}

/** Converte o filtro de data do CRM (FilterBar) em from/to YYYY-MM-DD. */
function getDateRangeFromFilter(
  dateValue: string | undefined
): { dateFrom: string | null; dateTo: string | null } {
  if (!dateValue) return { dateFrom: null, dateTo: null };
  const nowSP = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const today = nowSP.toISOString().split('T')[0];

  if (dateValue === 'todos') return { dateFrom: null, dateTo: null };
  if (dateValue === 'diario') return { dateFrom: today, dateTo: today };
  if (dateValue === 'ontem') {
    const yesterday = new Date(nowSP);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    return { dateFrom: yesterdayStr, dateTo: yesterdayStr };
  }
  if (dateValue === '7dias') {
    const sevenDaysAgo = new Date(nowSP);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    return { dateFrom: sevenDaysAgo.toISOString().split('T')[0], dateTo: today };
  }
  if (dateValue === '15dias') {
    const fifteenDaysAgo = new Date(nowSP);
    fifteenDaysAgo.setDate(fifteenDaysAgo.getDate() - 14);
    return { dateFrom: fifteenDaysAgo.toISOString().split('T')[0], dateTo: today };
  }
  if (dateValue === '30dias') {
    const thirtyDaysAgo = new Date(nowSP);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29);
    return { dateFrom: thirtyDaysAgo.toISOString().split('T')[0], dateTo: today };
  }
  if (dateValue.startsWith('custom_')) {
    const parts = dateValue.split('_');
    if (parts.length === 3) return { dateFrom: parts[1], dateTo: parts[2] };
  }
  return { dateFrom: null, dateTo: null };
}

/** Monta query string para a API de export com os mesmos filtros do CRM. */
function buildExportParams(
  filters: Record<string, any>,
  searchTerm: string,
  bancaIds: string[],
  page: number
): URLSearchParams {
  const params = new URLSearchParams();
  // Múltiplas bancas: a API pode aceitar só uma por request; o cliente itera
  if (bancaIds.length > 0) params.set('banca_id', bancaIds[0]);
  params.set('page', String(page));

  const dateValue = filters.date && (typeof filters.date === 'object' ? filters.date.value : filters.date);
  const { dateFrom, dateTo } = getDateRangeFromFilter(dateValue);
  if (dateFrom) params.set('from', dateFrom);
  if (dateTo) params.set('to', dateTo);

  const affiliate = filters.affiliate && (typeof filters.affiliate === 'object' ? filters.affiliate.value : filters.affiliate);
  if (affiliate === 'yes' || affiliate === 'no') params.set('affiliate', affiliate);

  const stars = filters.stars && (typeof filters.stars === 'object' ? filters.stars.value : filters.stars);
  if (stars) params.set('stars', String(stars));

  const value = filters.value && (typeof filters.value === 'object' ? filters.value.value : filters.value);
  if (value !== undefined && value !== null) {
    if (typeof value === 'object' && value.type === 'custom') {
      params.set('value_type', 'custom');
      if (value.min != null) params.set('value_min', String(value.min));
      if (value.max != null) params.set('value_max', String(value.max));
    } else {
      params.set('value', String(value));
    }
  }

  const valueNextStar = filters.valueNextStar && (typeof filters.valueNextStar === 'object' ? filters.valueNextStar.value : filters.valueNextStar);
  if (valueNextStar !== undefined && valueNextStar !== null) {
    if (typeof valueNextStar === 'object' && valueNextStar.type === 'custom') {
      params.set('value_next_star_type', 'custom');
      if (valueNextStar.min != null) params.set('value_next_star_min', String(valueNextStar.min));
      if (valueNextStar.max != null) params.set('value_next_star_max', String(valueNextStar.max));
    } else {
      params.set('value_next_star', String(valueNextStar));
    }
  }

  const lastDepositDate = filters.lastDepositDate && (typeof filters.lastDepositDate === 'object' ? filters.lastDepositDate.value : filters.lastDepositDate);
  if (lastDepositDate) params.set('last_deposit_date', lastDepositDate);

  const temperature = filters.temperature && (typeof filters.temperature === 'object' ? filters.temperature.value : filters.temperature);
  if (temperature) params.set('temperature', temperature);

  const classification = filters.classification && (typeof filters.classification === 'object' ? filters.classification.value : filters.classification);
  if (classification) params.set('classification', classification);

  const tags = filters.tags && (typeof filters.tags === 'object' ? filters.tags.value : filters.tags);
  if (tags) params.set('tags', tags);

  const possivelTransferencia = filters.possivelTransferencia && (typeof filters.possivelTransferencia === 'object' ? filters.possivelTransferencia.value : filters.possivelTransferencia);
  if (possivelTransferencia === 'only') params.set('possivel_transferencia', '1');

  if (searchTerm.trim()) params.set('search', searchTerm.trim());
  return params;
}

function downloadCSVFromLeads(leads: any[]) {
  // Apenas dados dos clientes/leads (sem consultor nem gerente)
  const headers = [
    'Nome', 'Sobrenome', 'Telefone', 'E-mail',
    'Status', 'Temperatura', 'Total Depositado', 'Total Apostado', 'Qtd Depósitos',
    'Total Ganho', 'Total Saque', 'Saldo', 'Saque Disponível', 'Bônus', 'Estrelas (aposta)',
    'Afiliado', 'Nome Afiliado', 'Banca',
    'Cadastrado em', 'Último Depósito em', 'Valor Último Depósito',
    'Último Ganho em', 'Valor Último Ganho', 'Última Interação',
  ];
  const escape = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const fmt = (d: string | null | undefined) => (d ? new Date(d).toLocaleString('pt-BR') : '');
  const rows = leads.map((l) =>
    [
      l.name, l.last_name, l.phone, l.email,
      l.status, l.temperature,
      l.total_depositado, l.total_apostado, l.total_depositos_count, l.total_ganho,
      l.total_saque, l.balance, l.available_withdraw, l.bonus, l.aposta_estrelas,
      l.is_affiliate ? 'Sim' : 'Não', l.affiliate_name, l.banca_name,
      fmt(l.created_at), fmt(l.last_deposit_at), l.last_deposit_value,
      fmt(l.last_winner_at), l.last_winner_value, fmt(l.last_interaction),
    ]
      .map(escape)
      .join(',')
  );
  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `leads-banca-${new Date().toISOString().slice(0, 10)}.csv`;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 200);
}

export default function ExportCsvModal({
  open,
  onClose,
  userId,
  bancasFromParent = [],
  defaultBancaId,
  showBancaSelector = true,
}: ExportCsvModalProps) {
  const [filters, setFilters] = useState<Record<string, any>>(() => ({
    date: { value: 'todos', label: 'Todo o Período' },
  }));
  const [searchTerm, setSearchTerm] = useState('');
  const [exportLoading, setExportLoading] = useState(false);
  const [exportProgress, setExportProgress] = useState<{ page: number; totalLoaded: number; bancaIndex?: number; totalBancas?: number } | null>(null);
  const [bancasFromFilterBar, setBancasFromFilterBar] = useState<BancaOption[]>([]);
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [previewHasMore, setPreviewHasMore] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewLeads, setPreviewLeads] = useState<ExportLead[]>([]);
  const [exportAccumulated, setExportAccumulated] = useState<any[]>([]);
  const [hasUserSelectedBanca, setHasUserSelectedBanca] = useState(false);
  /** Quando true, modal vira barra flutuante e export continua em segundo plano */
  const [exportMinimized, setExportMinimized] = useState(false);
  const exportMinimizedRef = React.useRef(false);
  const prevOpenRef = React.useRef(false);
  const exportAbortRef = React.useRef(false);

  useEffect(() => {
    exportMinimizedRef.current = exportMinimized;
  }, [exportMinimized]);

  // Ao fechar o modal, limpa estado de minimizado e dados acumulados
  useEffect(() => {
    if (!open) {
      setExportMinimized(false);
      setExportAccumulated([]);
    }
  }, [open]);

  // Ao abrir o modal (com seletor de banca), não puxar dados até o usuário selecionar a banca
  useEffect(() => {
    if (open && !prevOpenRef.current && showBancaSelector) {
      setHasUserSelectedBanca(false);
    }
    prevOpenRef.current = open;
  }, [open, showBancaSelector]);

  const LEADS_PER_COLUMN_PREVIEW = 20;
  const kanbanColumns = useMemo(() => {
    if (!previewLeads.length) return [];
    const distributed = distributeLeadsToColumns(previewLeads);
    return KANBAN_COLUMNS.map(({ id, title, headerClass }) => ({
      id,
      title,
      headerClass,
      leads: (distributed[id] || []).slice(0, LEADS_PER_COLUMN_PREVIEW),
      total: (distributed[id] || []).length,
    }));
  }, [previewLeads]);

  const bancas = bancasFromParent.length > 0 ? bancasFromParent : bancasFromFilterBar;

  const handleFilterChange = useCallback((type: string, value: any) => {
    if (type === 'banca') setHasUserSelectedBanca(true);
    if (type === 'clear') {
      setFilters({ date: { value: 'todos', label: 'Todo o Período' } });
      return;
    }
    setFilters((prev) => {
      const next = { ...prev };
      if (value == null) {
        delete next[type];
      } else {
        next[type] = value;
      }
      return next;
    });
  }, []);

  const handleBancasLoaded = useCallback((list: { id: string; name: string; url: string }[]) => {
    setBancasFromFilterBar(list);
  }, []);

  const resolveBancaIds = useCallback((): string[] => {
    const bancaValue = filters.banca && (typeof filters.banca === 'object' ? filters.banca.value : filters.banca);
    if (bancaValue === 'all' || !bancaValue) {
      const ids = bancas.map((b) => b.id);
      if (ids.length > 0) return ids;
      if (defaultBancaId) return [defaultBancaId];
      return [];
    }
    const found = bancas.find((b) => b.url === bancaValue);
    if (found) return [found.id];
    if (defaultBancaId) return [defaultBancaId];
    return [];
  }, [filters.banca, bancas, defaultBancaId]);

  // Preview: só puxa dados depois que o usuário selecionar a banca no filtro (ou já tem banca única no caso de dono)
  const bancaIdsForPreview = resolveBancaIds();
  const shouldFetchPreview = open && bancaIdsForPreview.length > 0 && (!showBancaSelector || hasUserSelectedBanca);
  useEffect(() => {
    if (!open || !userId) {
      setPreviewCount(null);
      setPreviewHasMore(false);
      setPreviewLeads([]);
      return;
    }
    if (!shouldFetchPreview) {
      setPreviewCount(null);
      setPreviewHasMore(false);
      setPreviewLeads([]);
      return;
    }
    const t = setTimeout(async () => {
      setPreviewLoading(true);
      try {
        const params = buildExportParams(filters, searchTerm, bancaIdsForPreview, 1);
        params.set('banca_id', bancaIdsForPreview[0]);
        params.set('page', '1');
        const res = await fetch(`/api/dono-banca/crm-export?${params.toString()}`, {
          headers: { 'X-User-Id': userId },
        });
        if (!res.ok) {
          setPreviewCount(null);
          return;
        }
        const result = await res.json();
        const data = result?.data ?? [];
        const hasMore = result?.meta?.has_more === true;
        const list = Array.isArray(data) ? data : [];
        setPreviewCount(list.length);
        setPreviewHasMore(hasMore);
        setPreviewLeads(list);
      } catch {
        setPreviewCount(null);
        setPreviewHasMore(false);
        setPreviewLeads([]);
      } finally {
        setPreviewLoading(false);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [open, userId, shouldFetchPreview, bancaIdsForPreview.length, bancaIdsForPreview[0], filters, searchTerm]);

  const runExport = useCallback(async () => {
    const bancaIds = resolveBancaIds();
    if (bancaIds.length === 0) {
      return;
    }
    exportAbortRef.current = false;
    setExportLoading(true);
    setExportAccumulated([]);
    const accumulated: any[] = [];
    const totalBancas = bancaIds.length;

    for (let bancaIndex = 0; bancaIndex < bancaIds.length && !exportAbortRef.current; bancaIndex++) {
      const bancaId = bancaIds[bancaIndex];
      let page = 1;
      let hasMore = true;

      while (hasMore && !exportAbortRef.current) {
        const params = buildExportParams(filters, searchTerm, [bancaId], page);
        params.set('banca_id', bancaId);
        params.set('page', String(page));

        try {
          const res = await fetch(`/api/dono-banca/crm-export?${params.toString()}`, {
            headers: { 'X-User-Id': userId },
          });
          if (!res.ok || exportAbortRef.current) break;
          const result = await res.json();
          const newLeads: any[] = Array.isArray(result?.data) ? result.data : [];
          accumulated.push(...newLeads);
          setExportAccumulated([...accumulated]);
          if (!result?.success && newLeads.length === 0) break;
          hasMore = result?.meta?.has_more === true;
          setExportProgress({
            page,
            totalLoaded: accumulated.length,
            bancaIndex: bancaIndex + 1,
            totalBancas,
          });
          page++;
          if (hasMore) await new Promise((r) => setTimeout(r, 200));
        } catch {
          break;
        }
      }
    }

    setExportLoading(false);
    setExportProgress(null);
    if (exportAbortRef.current) {
      setExportAccumulated([]);
      return;
    }
    // Sempre gera e baixa o CSV com os dados carregados (organizados pelas colunas do cabeçalho)
    const dataToExport = accumulated.length > 0 ? accumulated : [];
    setExportAccumulated(dataToExport);
    // Se estiver minimizado, mantém dados na barra para "Baixar CSV"; senão baixa e fecha
    if (!exportMinimizedRef.current) {
      setExportAccumulated([]);
      setTimeout(() => {
        downloadCSVFromLeads(dataToExport);
        if (dataToExport.length > 0) onClose();
      }, 0);
    }
  }, [filters, searchTerm, resolveBancaIds, userId, onClose]);

  const handleCancelExport = useCallback(() => {
    exportAbortRef.current = true;
    setExportLoading(false);
    setExportProgress(null);
    setExportAccumulated([]);
  }, []);

  const handleDownloadLoadedNow = useCallback(() => {
    if (exportAccumulated.length > 0) {
      downloadCSVFromLeads(exportAccumulated);
    }
  }, [exportAccumulated]);

  if (!open) return null;

  const bancaIds = resolveBancaIds();
  const canExport = bancaIds.length > 0 && (!showBancaSelector || hasUserSelectedBanca);

  // Barra flutuante: export em segundo plano (modal minimizado)
  if (exportMinimized) {
    const totalLoaded = exportAccumulated.length;
    const isDone = !exportLoading && totalLoaded > 0;
    return (
      <div
        className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-4 sm:max-w-md z-50 flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg border border-gray-200 dark:border-[#404040] bg-white dark:bg-[#2a2a2a]"
        onClick={(e) => e.stopPropagation()}
      >
        {exportLoading ? (
          <>
            <Loader2 className="w-5 h-5 animate-spin text-[#E86A24] flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 dark:text-white">Processando dados para download...</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {exportProgress
                  ? `${exportProgress.totalLoaded.toLocaleString('pt-BR')} leads carregados`
                  : 'Preparando...'}
              </p>
            </div>
            <button
              type="button"
              onClick={handleCancelExport}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/20"
            >
              <XCircle className="w-4 h-4" />
              Cancelar
            </button>
          </>
        ) : isDone ? (
          <>
            <CheckCircle2 className="w-5 h-5 text-[#E86A24] flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 dark:text-white">CSV pronto para download</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">{totalLoaded.toLocaleString('pt-BR')} leads</p>
            </div>
            <button
              type="button"
              onClick={() => {
                downloadCSVFromLeads(exportAccumulated);
                setExportAccumulated([]);
                onClose();
              }}
              className="flex items-center gap-2 px-4 py-2 rounded-xl font-medium bg-[#E86A24] hover:bg-[#D95E1B] text-white"
            >
              <Download className="w-4 h-4" />
              Baixar CSV
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-[#404040]"
              aria-label="Fechar"
            >
              <X className="w-4 h-4" />
            </button>
          </>
        ) : (
          <>
            <p className="flex-1 text-sm text-gray-600 dark:text-gray-400">Exportação cancelada.</p>
            <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg text-sm font-medium border border-gray-300 dark:border-[#555] text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#404040]">
              Fechar
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/50" onClick={onClose}>
      <div
        className="bg-white dark:bg-[#2a2a2a] rounded-2xl shadow-xl border border-gray-200 dark:border-[#404040] w-full max-w-7xl min-h-[85vh] max-h-[95vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-[#404040]">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Download className="w-5 h-5 text-[#E86A24]" />
            Exportar leads em CSV
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-[#404040] hover:text-gray-700 dark:hover:text-gray-200"
            aria-label="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4 relative min-h-[200px]">
          {/* Overlay de carregamento (igual ao CRM quando carrega muitos dados) */}
          {previewLoading && (
            <div className="absolute inset-0 bg-white/60 dark:bg-[#1a1a1a]/80 backdrop-blur-[2px] rounded-xl z-20 flex items-center justify-center min-h-[240px]">
              <div className="flex flex-col items-center gap-3 text-[#E86A24]">
                <Loader2 className="w-8 h-8 animate-spin" />
                <span className="text-sm font-semibold">Contando clientes...</span>
                <span className="text-xs text-gray-500 dark:text-gray-400 font-normal">Aguarde, isso pode levar alguns segundos quando há muitos dados.</span>
              </div>
            </div>
          )}
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Use os mesmos filtros do CRM para escolher quais leads exportar (nome, e-mail, telefone, captador, depósitos, etc.).
            Os dados incluem todos os captadores e gerentes da banca.
          </p>
          <FilterBar
            onSearch={setSearchTerm}
            onFilterChange={handleFilterChange}
            initialDateFilter={filters.date}
            onBancasLoaded={showBancaSelector ? handleBancasLoaded : undefined}
            transferredFilter="no"
          />
          {!showBancaSelector && defaultBancaId && bancas.length === 0 && (
            <p className="text-sm text-amber-600 dark:text-amber-400">Carregando banca...</p>
          )}
          {/* Quantidade de clientes com os filtros atuais */}
          <div className="flex items-center gap-2 pt-2 border-t border-gray-100 dark:border-[#404040]">
            {showBancaSelector && !hasUserSelectedBanca ? (
              <p className="text-sm text-amber-600 dark:text-amber-400">
                Selecione uma banca no filtro acima para carregar os dados e exportar.
              </p>
            ) : previewCount !== null && !previewLoading ? (
              <>
                <Users className="w-4 h-4 text-[#E86A24]" />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
                  <span className="text-[#E86A24]">{previewCount.toLocaleString('pt-BR')}</span>
                  {previewHasMore ? '+' : ''} cliente{previewCount !== 1 ? 's' : ''} encontrado{previewCount !== 1 ? 's' : ''}
                </span>
              </>
            ) : null}
          </div>

          {/* Visualização Kanban (colunas como no CRM) */}
          {kanbanColumns.length > 0 && (
            <div className="pt-4 border-t border-gray-100 dark:border-[#404040]">
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
                Visualização por estágio (primeira página)
              </p>
              <div className="overflow-x-auto overflow-y-hidden pb-2 flex gap-3 min-h-[280px]" style={{ scrollbarGutter: 'stable' }}>
                {kanbanColumns.map((col) => (
                  <div
                    key={col.id}
                    className="flex-shrink-0 w-[220px] rounded-xl border border-gray-200 dark:border-[#404040] bg-gray-50/50 dark:bg-[#1e1e1e] flex flex-col overflow-hidden"
                  >
                    <div className={`px-3 py-2 border-b border-gray-200 dark:border-[#404040] ${col.headerClass}`}>
                      <p className="text-xs font-bold text-gray-700 dark:text-gray-200 truncate" title={col.title}>
                        {col.title}
                      </p>
                      <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">
                        {col.leads.length}{col.total > col.leads.length ? ` de ${col.total}` : ''}
                      </p>
                    </div>
                    <div className="flex-1 overflow-y-auto min-h-0 p-1.5 space-y-1 max-h-[220px]">
                      {col.leads.length === 0 ? (
                        <p className="text-[10px] text-gray-400 dark:text-gray-500 py-2 text-center">Nenhum</p>
                      ) : (
                        col.leads.map((lead) => {
                          const fullName = [lead.name, lead.last_name].filter(Boolean).join(' ').trim() || 'Sem nome';
                          return (
                          <div
                            key={String(lead.id)}
                            className="rounded-lg bg-white dark:bg-[#2a2a2a] border border-gray-100 dark:border-[#404040] p-2 text-left hover:border-[#E86A24]/40 transition-colors"
                          >
                            <p className="text-xs font-medium text-gray-900 dark:text-white truncate" title={fullName}>
                              {fullName}
                            </p>
                            <p className="text-[10px] text-gray-500 dark:text-gray-400 truncate" title={lead.email || ''}>
                              {lead.email || '—'}
                            </p>
                            {lead.phone ? (
                              <p className="text-[10px] text-gray-500 dark:text-gray-400 truncate">{lead.phone}</p>
                            ) : null}
                          </div>
                          );
                        })
                      )}
                      {col.total > col.leads.length ? (
                        <p className="text-[10px] text-gray-400 dark:text-gray-500 py-1 text-center">
                          +{col.total - col.leads.length} mais
                        </p>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-gray-200 dark:border-[#404040] flex items-center justify-between gap-4 flex-shrink-0 flex-wrap">
          {exportProgress && (
            <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
              <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
              <span className="font-medium text-[#E86A24]">Processando dados para download...</span>
              <span className="text-gray-500 dark:text-gray-500">
                {exportProgress.totalBancas && exportProgress.totalBancas > 1
                  ? `Banca ${exportProgress.bancaIndex}/${exportProgress.totalBancas} · `
                  : ''}
                {exportProgress.totalLoaded.toLocaleString('pt-BR')} leads · Página {exportProgress.page}
              </span>
            </div>
          )}
          <div className="flex gap-2 ml-auto flex-wrap">
            {exportLoading ? (
              <>
                <button
                  type="button"
                  onClick={() => setExportMinimized(true)}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium border border-gray-300 dark:border-[#555] text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#404040]"
                  title="Minimizar e continuar usando a página enquanto o CSV é gerado"
                >
                  Continuar em segundo plano
                </button>
                {exportAccumulated.length > 0 && (
                  <button
                    type="button"
                    onClick={handleDownloadLoadedNow}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium bg-[#E86A24] hover:bg-[#D95E1B] text-white"
                  >
                    <Download className="w-4 h-4" />
                    Baixar CSV com {exportAccumulated.length.toLocaleString('pt-BR')} leads já carregados
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleCancelExport}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium bg-red-500 hover:bg-red-600 text-white"
                >
                  <XCircle className="w-4 h-4" />
                  Cancelar
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2.5 rounded-xl font-medium border border-gray-300 dark:border-[#555] text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#404040]"
                >
                  Fechar
                </button>
                <button
                  type="button"
                  onClick={runExport}
                  disabled={!canExport}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium bg-[#E86A24] hover:bg-[#D95E1B] text-white disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Download className="w-4 h-4" />
                  Exportar CSV
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
