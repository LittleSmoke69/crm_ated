'use client';

import React, { useState, useEffect, useRef, useMemo, useCallback, Suspense, startTransition } from 'react';
import { useSearchParams } from 'next/navigation';
import Layout from '@/components/Layout';
import { useRequireAuth } from '@/utils/useRequireAuth';
import { useToast } from '@/hooks/useToast';
import ToastContainer from '@/components/Toast/ToastContainer';
import { ArrowRightLeft, AlertCircle, Eye, RefreshCw, X, MessageSquare } from 'lucide-react';
import FilterBar from '@/components/CRM/FilterBar';
import KanbanColumn from '@/components/CRM/KanbanColumn';
import SortColumnModal from '@/components/CRM/SortColumnModal';
import { Lead, Column, ThermalStatus } from '@/components/CRM/types';

type SortField =
  | 'created_at'
  | 'last_deposit_at'
  | 'total_ganho'
  | 'total_afiliate'
  | 'total_depositado'
  | 'total_apostado'
  | 'total_depositos_count'
  | 'name'
  | 'last_interaction'
  | 'stars'
  | 'interactions';
type SortDirection = 'asc' | 'desc';

const STAR_LEVELS = [
  { level: 1, min: 100, max: 299 },
  { level: 2, min: 300, max: 699 },
  { level: 3, min: 700, max: 1199 },
  { level: 4, min: 1200, max: 4999 },
  { level: 5, min: 2500, max: 14999 },
  { level: 6, min: 15000, max: 29999 },
  { level: 7, min: 30000, max: 50000 },
] as const;

function getMissingForNextStar(apostaEstrelas: number): number | null {
  const value = Math.max(0, apostaEstrelas ?? 0);
  const current = [...STAR_LEVELS].reverse().find((r) => value >= r.min && value <= r.max);
  if (!current) {
    if (value < STAR_LEVELS[0].min) return STAR_LEVELS[0].min - value;
    return null;
  }
  const currentIdx = STAR_LEVELS.findIndex((r) => r.level === current.level);
  const next = currentIdx < STAR_LEVELS.length - 1 ? STAR_LEVELS[currentIdx + 1] : null;
  return next ? Math.max(0, next.min - value) : null;
}

const TransferidoContent = () => {
  const { checking, userId } = useRequireAuth();
  const searchParams = useSearchParams();
  const targetUserId = searchParams.get('userId') || undefined;
  const [rawLeads, setRawLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filters, setFilters] = useState<Record<string, any>>(() => ({
    date: { value: 'todos', label: 'Todo o Período' },
  }));
  const [filterLoading, setFilterLoading] = useState(false);
  const [exclusiveBancasList, setExclusiveBancasList] = useState<{ id: string; name: string; url: string }[]>([]);
  const [bancasReady, setBancasReady] = useState(false);
  const [sortModalOpen, setSortModalOpen] = useState(false);
  const [sortingColumnId, setSortingColumnId] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [columnSorts, setColumnSorts] = useState<Record<string, { field: SortField; direction: SortDirection }>>({});
  const [leadsPerColumn, setLeadsPerColumn] = useState<Record<string, number>>({});
  const [showStatusModal, setShowStatusModal] = useState(false);
  /** Carregamento em segundo plano do restante dos leads (após o primeiro lote de 500). */
  const [loadingFullInBackground, setLoadingFullInBackground] = useState(false);
  /** Progresso do carregamento em lotes: totais carregados, banca e lote atuais. */
  const [loadingProgress, setLoadingProgress] = useState<{
    totalLoaded: number;
    currentBanca: number;
    currentPage: number;
    totalBancas: number | null;
  } | null>(null);
  /** True do início ao fim do ciclo de lotes; bloco de comunicação fica visível até terminar todos os lotes. */
  const [batchLoadInProgress, setBatchLoadInProgress] = useState(false);
  /** Sinaliza que o carregamento terminou; usado para esconder o banner só após os leads aparecerem na página. */
  const [batchLoadFinished, setBatchLoadFinished] = useState(false);
  const { showToast, toasts, removeToast } = useToast();

  const isInitialLoadRef = useRef(true);
  /** Cancela o carregamento em background quando uma nova busca é iniciada (evita duplicação e commits obsoletos). */
  const loadIdRef = useRef(0);
  const fullRequestAbortRef = useRef<AbortController | null>(null);
  /** Ref da lista de bancas para não re-executar loadLeads quando as bancas terminam de carregar (evita 2ª request). */
  const exclusiveBancasListRef = useRef<{ id: string; name: string; url: string }[]>([]);
  /** Throttle: última vez que setLoadingProgress foi chamado (evita re-renders excessivos em segundo plano). */
  const lastProgressUpdateRef = useRef(0);
  const PROGRESS_THROTTLE_MS = 200;
  const bancaKey = filters.banca ? (typeof filters.banca === 'object' ? filters.banca.value : filters.banca) : null;
  const dateKey = filters.date ? (typeof filters.date === 'object' ? filters.date.value : filters.date) : null;

  useEffect(() => {
    exclusiveBancasListRef.current = exclusiveBancasList;
  }, [exclusiveBancasList]);

  // Só libera o banner verde após todos os leads aparecerem na página (commit + paint)
  useEffect(() => {
    if (!batchLoadFinished) return;
    setBatchLoadFinished(false);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setBatchLoadInProgress(false));
    });
  }, [batchLoadFinished]);

  const loadLeads = useCallback(async (isFilterChange = false) => {
    if (!userId) return;
    fullRequestAbortRef.current?.abort();
    loadIdRef.current += 1;
    const thisLoadId = loadIdRef.current;
    lastProgressUpdateRef.current = 0;
    setLoadingFullInBackground(false);
    if (isFilterChange) {
      setFilterLoading(true);
    } else {
      setLoading(true);
    }
    setError(null);
    setBatchLoadInProgress(true);
    setBatchLoadFinished(false);
    setLoadingProgress({ totalLoaded: 0, currentBanca: 1, currentPage: 1, totalBancas: null });
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    try {
      const baseUrl = new URL('/api/crm/transferred-leads', window.location.origin);
      if (targetUserId) {
        baseUrl.searchParams.append('userId', targetUserId);
      }
      const listBancas = exclusiveBancasListRef.current;
      const bancaValue = filters.banca ? (typeof filters.banca === 'object' ? filters.banca.value : filters.banca) : null;
      if (bancaValue && bancaValue !== 'all') {
        baseUrl.searchParams.append('banca_url', bancaValue);
        console.log('[Transferido] loadLeads | banca selecionada:', bancaValue);
      } else if (listBancas.length > 0) {
        baseUrl.searchParams.append('banca_urls', listBancas.map((b) => b.url).join(','));
        console.log('[Transferido] loadLeads | Todas as Bancas, urls:', listBancas.length);
      } else {
        console.log('[Transferido] loadLeads | Sem lista de bancas ainda - API usará bancas do servidor (getBancasVisiveis)');
      }

      const dateValue = filters.date ? (typeof filters.date === 'object' ? filters.date.value : filters.date) : 'diario';
      const nowSP = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
      const today = nowSP.toISOString().split('T')[0];

      if (dateValue === 'diario') {
        baseUrl.searchParams.append('from', today);
        baseUrl.searchParams.append('to', today);
      } else if (dateValue === 'ontem') {
        const yesterday = new Date(nowSP);
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split('T')[0];
        baseUrl.searchParams.append('from', yesterdayStr);
        baseUrl.searchParams.append('to', yesterdayStr);
      } else if (dateValue === '7dias') {
        const sevenDaysAgo = new Date(nowSP);
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
        baseUrl.searchParams.append('from', sevenDaysAgo.toISOString().split('T')[0]);
        baseUrl.searchParams.append('to', today);
      } else if (dateValue === '15dias') {
        const fifteenDaysAgo = new Date(nowSP);
        fifteenDaysAgo.setDate(fifteenDaysAgo.getDate() - 14);
        baseUrl.searchParams.append('from', fifteenDaysAgo.toISOString().split('T')[0]);
        baseUrl.searchParams.append('to', today);
      } else if (dateValue === '30dias') {
        const thirtyDaysAgo = new Date(nowSP);
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29);
        baseUrl.searchParams.append('from', thirtyDaysAgo.toISOString().split('T')[0]);
        baseUrl.searchParams.append('to', today);
      } else if (dateValue?.startsWith?.('custom_')) {
        const parts = dateValue.split('_');
        if (parts.length === 3) {
          baseUrl.searchParams.append('from', parts[1]);
          baseUrl.searchParams.append('to', parts[2]);
        }
      }

      baseUrl.searchParams.set('full', '1');
      baseUrl.searchParams.set('per_page', '500');
      const headers = { 'X-User-Id': userId };
      fullRequestAbortRef.current = new AbortController();
      const signal = fullRequestAbortRef.current.signal;
      /** Timeout de 2 min por lote para evitar tela travada se a API demorar demais. */
      const timeoutMs = 120_000;
      timeoutId = setTimeout(() => fullRequestAbortRef.current?.abort(), timeoutMs);

      const formatLead = (l: any): Lead => {
        const fullName = `${l.name || ''} ${(l.last_name && l.last_name !== 'null' ? l.last_name : '')}`.trim() || 'Sem nome';
        return {
          id: l.id,
          name: fullName,
          phone: l.phone || '',
          email: l.email || '',
          status: (l.status as Lead['status']) || 'novo',
          thermalStatus: (l.temperature as ThermalStatus) || 'cold',
          tags: l.tags || [],
          createdAt: l.created_at,
          total_depositado: l.total_depositado,
          total_apostado: l.total_apostado,
          total_ganho: l.total_ganho,
          total_depositos_count: l.total_depositos_count,
          stars: l.stars,
          is_affiliate: l.is_affiliate,
          affiliate_name: l.affiliate_name,
          temperature: l.temperature,
          has_interaction: l.has_interaction,
          last_deposit_at: l.last_deposit_at,
          last_deposit_value: l.last_deposit_value,
          created_at: l.created_at,
          last_interaction: l.last_interaction,
          last_winner_value: l.last_winner_value,
          last_winner_at: l.last_winner_at,
          last_withdraw_at: l.last_withdraw_at,
          last_withdraw_value: l.last_withdraw_value,
          total_saque: l.total_saque,
          balance: l.balance,
          bonus: l.bonus,
          convert: l.convert,
          total_afiliate: l.total_afiliate,
          aposta_estrelas: l.aposta_estrelas,
          banca_id: l.banca_id,
          banca_name: l.banca_name,
          banca_url: l.banca_url,
          original_id: l.original_id,
          tag_de_redistribuicao: l.tag_de_redistribuicao ?? null,
          transferred: l.transferred ?? false,
          transferred_at: l.transferred_at ?? null,
          original_consultant_id: l.original_consultant_id ?? null,
          original_consultant_name: l.original_consultant_name ?? null,
          original_consultant_email: l.original_consultant_email ?? null,
          vinculado: l.vinculado ?? false,
          interactions: 0,
          lastInteractionAt: l.last_interaction || l.created_at,
          isFavorite: false,
          alertStatus: 'idle',
        };
      };

      const BATCH_SIZE = 500;
      const accumulated = new Map<string, Lead>();
      let totalBancas: number | null = 1;
      let totalLoaded = 0;

      for (let bancaIndex = 0; !signal.aborted; ) {
        let page = 1;
        let hasMorePagesInBanca = true;
        while (hasMorePagesInBanca && !signal.aborted) {
          const batchUrl = new URL(baseUrl.toString());
          batchUrl.searchParams.set('banca_index', String(bancaIndex));
          batchUrl.searchParams.set('page', String(page));
          const now = Date.now();
          if (now - lastProgressUpdateRef.current >= PROGRESS_THROTTLE_MS || totalLoaded === 0) {
            lastProgressUpdateRef.current = now;
            setLoadingProgress({
              totalLoaded,
              currentBanca: bancaIndex + 1,
              currentPage: page,
              totalBancas: totalBancas ?? null,
            });
          }
          console.log('[Transferido] loadLeads | lote banca', bancaIndex + 1, 'página', page, '|', totalLoaded, 'leads acumulados');
          let res: Response;
          try {
            res = await fetch(batchUrl.toString(), { headers, signal });
          } catch (err: any) {
            if (timeoutId != null) {
              clearTimeout(timeoutId);
              timeoutId = null;
            }
            if (err?.name === 'AbortError') {
              setLoading(false);
              setFilterLoading(false);
              break;
            }
            if (thisLoadId !== loadIdRef.current) break;
            console.error('[Transferido] loadLeads | Erro de rede banca', bancaIndex, 'page', page, err);
            setError('Erro de conexão com o servidor');
            setLoading(false);
            setFilterLoading(false);
            break;
          }
          if (thisLoadId !== loadIdRef.current) break;
          let result: { success?: boolean; data?: unknown[]; error?: string; meta?: { has_more_pages_in_banca?: boolean; total_bancas?: number } };
          try {
            result = await res.json();
          } catch (parseErr) {
            if (timeoutId != null) {
              clearTimeout(timeoutId);
              timeoutId = null;
            }
            console.error('[Transferido] loadLeads | Resposta não é JSON válido', parseErr);
            setError('Resposta inválida do servidor. Tente novamente.');
            setLoading(false);
            setFilterLoading(false);
            break;
          }
          if (signal.aborted) break;
          if (thisLoadId !== loadIdRef.current) break;
          if (!result.success) {
            if (timeoutId != null) {
              clearTimeout(timeoutId);
              timeoutId = null;
            }
            setError(result.error || 'Erro ao carregar leads transferidos');
            setLoading(false);
            setFilterLoading(false);
            break;
          }
          const leads: any[] = Array.isArray(result.data) ? result.data : [];
          const meta = result.meta ?? {};
          const metaTotal = meta.total_bancas ?? result.meta?.totalBancas;
          if (typeof metaTotal === 'number' && metaTotal > 0) totalBancas = metaTotal;
          hasMorePagesInBanca = !!meta.has_more_pages_in_banca;
          const chunkFormatted = leads.map(formatLead);
          chunkFormatted.forEach((l) => accumulated.set(String(l.id), l));
          totalLoaded += chunkFormatted.length;
          if (Date.now() - lastProgressUpdateRef.current >= PROGRESS_THROTTLE_MS) {
            lastProgressUpdateRef.current = Date.now();
            setLoadingProgress((prev) => prev ? { ...prev, totalLoaded } : null);
          }
          if (thisLoadId !== loadIdRef.current) break;
          // Só libera o loading quando o front for preenchido com alguma resposta (mesmo ciclo de atualização)
          const hasData = accumulated.size > 0;
          startTransition(() => {
            if (thisLoadId !== loadIdRef.current) return;
            setRawLeads(Array.from(accumulated.values()));
            if (hasData) {
              setLoading(false);
              setFilterLoading(false);
            }
          });
          if (hasData && (bancaIndex > 0 || page > 1)) {
            setLoadingFullInBackground(true);
          }
          if (!hasMorePagesInBanca) break;
          page++;
        }
        if (signal.aborted) break;
        const totalB = totalBancas ?? 1;
        if (bancaIndex >= totalB - 1) break;
        bancaIndex++;
      }

      if (timeoutId != null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      if (thisLoadId !== loadIdRef.current) return;
      setLoading(false);
      setFilterLoading(false);
      setLoadingFullInBackground(false);
      setLoadingProgress(null);
      fullRequestAbortRef.current = null;
      if (accumulated.size > 0 && !signal.aborted) {
        showToast(`Lista completa carregada: ${accumulated.size} leads.`, 'success');
      }
      // Atualiza a lista final e sinaliza fim no mesmo commit; o banner só sai no useEffect após os leads aparecerem
      startTransition(() => {
        if (thisLoadId !== loadIdRef.current) return;
        setRawLeads(Array.from(accumulated.values()));
        setBatchLoadFinished(true);
      });
    } catch (err) {
      if (timeoutId != null) clearTimeout(timeoutId);
      if (thisLoadId !== loadIdRef.current) return;
      console.error('[Transferido] loadLeads | Erro:', err);
      setError('Erro de conexão com o servidor');
      setLoading(false);
      setFilterLoading(false);
      setLoadingProgress(null);
      setBatchLoadInProgress(false);
    }
  }, [userId, targetUserId, filters.banca, filters.date]);

  // Espera as bancas do usuário carregarem (FilterBar → onBancasLoaded) antes de buscar os leads.
  // loadLeads não está nas deps: usa exclusiveBancasListRef e evita dupla execução (ex.: Strict Mode).
  useEffect(() => {
    if (!userId || !bancasReady) return;
    const isInitialLoad = isInitialLoadRef.current;
    if (isInitialLoad) isInitialLoadRef.current = false;
    loadLeads(!isInitialLoad);
  }, [userId, bancasReady, bancaKey, dateKey]);

  const handleBancasLoaded = useCallback((bancas: { id: string; name: string; url: string }[]) => {
    console.log('[Transferido] handleBancasLoaded | bancas:', bancas.length, bancas.map((b) => b.name ?? b.id));
    setExclusiveBancasList(bancas);
    setBancasReady(true);
  }, []);

  const handleFilterChange = (type: string, value: any) => {
    setLeadsPerColumn({});
    if (type === 'clear') {
      setFilters({ date: { value: 'todos', label: 'Todo o Período' } });
    } else if (type === 'date' && value === null) {
      setFilters((prev) => ({ ...prev, date: { value: 'all', label: 'Todos' } }));
    } else {
      setFilters((prev) => ({ ...prev, [type]: value }));
    }
  };

  const applySortToLeads = (leads: Lead[], columnId: string, overrideConfig?: { field: SortField; direction: SortDirection }): Lead[] => {
    const sortConfig = overrideConfig || columnSorts[columnId];
    if (!sortConfig) return leads;
    const sorted = [...leads].sort((a, b) => {
      let valA: number | string;
      let valB: number | string;
      let isStringSort = false;
      switch (sortConfig.field) {
        case 'created_at':
          valA = new Date(a.created_at || a.createdAt || 0).getTime();
          valB = new Date(b.created_at || b.createdAt || 0).getTime();
          break;
        case 'last_deposit_at':
          valA = a.last_deposit_at ? new Date(a.last_deposit_at).getTime() : 0;
          valB = b.last_deposit_at ? new Date(b.last_deposit_at).getTime() : 0;
          break;
        case 'last_interaction':
          valA = (a.last_interaction || a.lastInteractionAt) ? new Date(a.last_interaction || a.lastInteractionAt).getTime() : 0;
          valB = (b.last_interaction || b.lastInteractionAt) ? new Date(b.last_interaction || b.lastInteractionAt).getTime() : 0;
          break;
        case 'total_ganho': valA = a.total_ganho || 0; valB = b.total_ganho || 0; break;
        case 'total_depositado': valA = a.total_depositado || 0; valB = b.total_depositado || 0; break;
        case 'total_apostado': valA = a.total_apostado || 0; valB = b.total_apostado || 0; break;
        case 'total_depositos_count': valA = a.total_depositos_count || 0; valB = b.total_depositos_count || 0; break;
        case 'stars': valA = a.stars ?? a.aposta_estrelas ?? 0; valB = b.stars ?? b.aposta_estrelas ?? 0; break;
        case 'interactions': valA = a.interactions ?? 0; valB = b.interactions ?? 0; break;
        case 'total_afiliate': valA = a.total_afiliate ?? 0; valB = b.total_afiliate ?? 0; break;
        case 'name': valA = (a.name || '').toLowerCase().trim(); valB = (b.name || '').toLowerCase().trim(); isStringSort = true; break;
        default: return 0;
      }
      if (isStringSort) {
        const cmp = String(valA).localeCompare(String(valB));
        return sortConfig.direction === 'asc' ? cmp : -cmp;
      }
      const numA = Number(valA);
      const numB = Number(valB);
      return sortConfig.direction === 'asc' ? numA - numB : numB - numA;
    });
    return sorted;
  };

  const { columns, metrics: derivedMetrics } = useMemo(() => {
    let formattedLeads: Lead[] = [...rawLeads];

    // Banca e período são filtrados na API (igual ao Kanban)

    // Filtro de Afiliado
    if (filters.affiliate) {
      const v = typeof filters.affiliate === 'object' ? filters.affiliate.value : filters.affiliate;
      if (v === 'yes') formattedLeads = formattedLeads.filter((l) => l.is_affiliate === true);
      else if (v === 'no') formattedLeads = formattedLeads.filter((l) => !l.is_affiliate);
    }

    // Filtro de Score/Estrelas
    if (filters.stars) {
      const v = typeof filters.stars === 'object' ? filters.stars.value : filters.stars;
      formattedLeads = formattedLeads.filter((l) => (l.stars ?? 0) === parseInt(v));
    }

    // Filtro de Valor
    if (filters.value) {
      const v = typeof filters.value === 'object' ? filters.value.value : filters.value;
      formattedLeads = formattedLeads.filter((l) => {
        const val = l.total_depositado || 0;
        if (typeof v === 'object' && v?.type === 'custom') {
          const min = v.min != null ? parseFloat(v.min) : null;
          const max = v.max != null ? parseFloat(v.max) : null;
          if (min != null && max != null) return val >= min && val <= max;
          if (min != null) return val >= min;
          if (max != null) return val <= max;
          return true;
        }
        if (v === 'none') return val === 0;
        if (v === 'low') return val > 0 && val < 10;
        if (v === 'medium') return val >= 10 && val < 100;
        if (v === 'high') return val >= 100 && val < 500;
        if (v === 'high_premium') return val >= 500 && val < 1000;
        if (v === 'ultra') return val >= 1000;
        return true;
      });
    }

    // Filtro de Valor para próxima estrela
    if (filters.valueNextStar) {
      const v = typeof filters.valueNextStar === 'object' ? filters.valueNextStar.value : filters.valueNextStar;
      formattedLeads = formattedLeads.filter((l) => {
        const missing = getMissingForNextStar(l.aposta_estrelas ?? 0);
        if (v === 'none') return missing === null;
        if (missing === null) return false;
        if (typeof v === 'object' && v?.type === 'custom') {
          const min = v.min != null ? parseFloat(String(v.min)) : null;
          const max = v.max != null ? parseFloat(String(v.max)) : null;
          if (min != null && max != null) return missing >= min && missing <= max;
          if (min != null) return missing >= min;
          if (max != null) return missing <= max;
          return true;
        }
        if (v === 'low') return missing > 0 && missing < 50;
        if (v === 'medium') return missing >= 50 && missing < 200;
        if (v === 'high') return missing >= 200 && missing < 500;
        if (v === 'ultra') return missing >= 500;
        return true;
      });
    }

    // Filtro de Data do Último Depósito
    if (filters.lastDepositDate) {
      const daysFilter = typeof filters.lastDepositDate === 'object' ? filters.lastDepositDate.value : filters.lastDepositDate;
      if (daysFilter) {
        const now = new Date();
        now.setHours(23, 59, 59, 999);
        let startDate: Date;
        let endDate: Date;
        if (daysFilter === 'hoje') {
          const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          startDate = new Date(today);
          startDate.setHours(0, 0, 0, 0);
          endDate = new Date(today);
          endDate.setHours(23, 59, 59, 999);
        } else {
          const days = parseInt(daysFilter);
          if (days === 1) {
            startDate = new Date(now);
            startDate.setDate(now.getDate() - 1);
            startDate.setHours(0, 0, 0, 0);
            endDate = new Date(now);
            endDate.setDate(now.getDate() - 1);
            endDate.setHours(23, 59, 59, 999);
          } else if (days === 2) {
            startDate = new Date(now);
            startDate.setDate(now.getDate() - 5);
            startDate.setHours(0, 0, 0, 0);
            endDate = new Date(now);
            endDate.setDate(now.getDate() - 2);
            endDate.setHours(23, 59, 59, 999);
          } else if (days === 5) {
            startDate = new Date(now);
            startDate.setDate(now.getDate() - 10);
            startDate.setHours(0, 0, 0, 0);
            endDate = new Date(now);
            endDate.setDate(now.getDate() - 5);
            endDate.setHours(23, 59, 59, 999);
          } else if (days === 10) {
            startDate = new Date(now);
            startDate.setDate(now.getDate() - 15);
            startDate.setHours(0, 0, 0, 0);
            endDate = new Date(now);
            endDate.setDate(now.getDate() - 10);
            endDate.setHours(23, 59, 59, 999);
          } else if (days === 15) {
            startDate = new Date(now);
            startDate.setDate(now.getDate() - 30);
            startDate.setHours(0, 0, 0, 0);
            endDate = new Date(now);
            endDate.setDate(now.getDate() - 15);
            endDate.setHours(23, 59, 59, 999);
          } else if (days === 30) {
            startDate = new Date(0);
            endDate = new Date(now);
            endDate.setDate(now.getDate() - 30);
            endDate.setHours(23, 59, 59, 999);
          } else {
            startDate = new Date(0);
            endDate = new Date(now);
          }
        }
        formattedLeads = formattedLeads.filter((l) => {
          if (!l.last_deposit_at) return false;
          const depositDate = new Date(l.last_deposit_at);
          if (daysFilter === 'hoje') {
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const deposit = new Date(depositDate.getFullYear(), depositDate.getMonth(), depositDate.getDate());
            return today.getTime() === deposit.getTime();
          }
          return depositDate >= startDate && depositDate <= endDate;
        });
      }
    }

    // Filtro de Temperatura
    if (filters.temperature) {
      const v = typeof filters.temperature === 'object' ? filters.temperature.value : filters.temperature;
      if (v) {
        formattedLeads = formattedLeads.filter((l) => (l.temperature || '').toLowerCase() === v.toLowerCase());
      }
    }

    // Filtro de Classificação
    if (filters.classification) {
      const v = typeof filters.classification === 'object' ? filters.classification.value : filters.classification;
      if (v) {
        formattedLeads = formattedLeads.filter((l) => {
          const isHighValue = (l.total_depositado || 0) >= 100;
          const isVIP = (l.total_depositos_count || 0) >= 3;
          const isOpportunity = (l.total_depositos_count || 0) === 2;
          const isAlert = l.status === 'deposito_sem_aposta' || l.status === 'deposito_sem_jogo';
          if (v === 'high_value') return isHighValue;
          if (v === 'vip') return isVIP;
          if (v === 'oportunidade') return isOpportunity;
          if (v === 'alerta') return isAlert;
          return false;
        });
      }
    }

    // Filtro de Tags (Com etiquetas / Sem etiquetas / etiqueta específica)
    if (filters.tags) {
      const tagValue = typeof filters.tags === 'object' ? filters.tags.value : filters.tags;
      if (tagValue === '__has_any') {
        formattedLeads = formattedLeads.filter((l) => (l.tags || []).length > 0);
      } else if (tagValue === '__none') {
        formattedLeads = formattedLeads.filter((l) => (l.tags || []).length === 0);
      } else if (tagValue) {
        formattedLeads = formattedLeads.filter((l) => (l.tags || []).some((t: { id: string }) => t.id === tagValue));
      }
    }

    // Filtro de Busca
    if (searchTerm) {
      const s = searchTerm.toLowerCase();
      formattedLeads = formattedLeads.filter(
        (l) =>
          l.name.toLowerCase().includes(s) ||
          (l.email?.toLowerCase().includes(s)) ||
          (l.phone?.includes(searchTerm))
      );
    }

    formattedLeads.sort((a, b) => (b.total_ganho || 0) - (a.total_ganho || 0));

    const totalLeads = formattedLeads.length;
    const totalDeposited = formattedLeads.reduce((sum, l) => sum + (l.total_depositado || 0), 0);
    const activeLeads = formattedLeads.filter((l) => l.status === 'ativo' || (l.total_depositos_count || 0) >= 2).length;
    const conversionRate = totalLeads > 0 ? (activeLeads / totalLeads) * 100 : 0;

    // Uma única passagem para distribuir leads nas colunas (evita 9+ .filter() sobre a lista)
    const colLeads: Record<string, Lead[]> = {
      novo: [], contactados: [], deposito_sem_aposta: [], deposito_1x: [], deposito_2x: [],
      deposito_3x: [], deposito_5x: [], deposito_10x: [], ativo: [],
    };
    for (const l of formattedLeads) {
      const count = l.total_depositos_count || 0;
      const depositado = l.total_depositado || 0;
      const apostado = l.total_apostado || 0;
      const ok = depositado <= apostado;
      if (count === 0 && l.status !== 'ativo' && !(l.has_interaction === true)) colLeads.novo.push(l);
      if (l.has_interaction === true && count === 0) colLeads.contactados.push(l);
      if (depositado > apostado || (l.balance ?? 0) > 0) colLeads.deposito_sem_aposta.push(l);
      if (count === 1 && ok) colLeads.deposito_1x.push(l);
      if (count === 2 && ok) colLeads.deposito_2x.push(l);
      if (count >= 3 && count < 5 && ok) colLeads.deposito_3x.push(l);
      if (count >= 5 && count < 10 && ok) colLeads.deposito_5x.push(l);
      if (count >= 10 && ok) colLeads.deposito_10x.push(l);
      if (l.status === 'ativo') colLeads.ativo.push(l);
    }
    const baseColumns: Column[] = [
      { id: 'novo', title: '👥 Clientes cadastrados', color: 'gray', leads: colLeads.novo, totalLeads: colLeads.novo.length },
      { id: 'contactados', title: '📞 Clientes Contactados', color: 'blue', leads: colLeads.contactados, totalLeads: colLeads.contactados.length },
      { id: 'deposito_sem_aposta', title: '💰 Com Saldo Disponível', color: 'red', leads: colLeads.deposito_sem_aposta, totalLeads: colLeads.deposito_sem_aposta.length },
      { id: 'deposito_1x', title: '💰 1º Depósito', color: 'emerald', leads: colLeads.deposito_1x, totalLeads: colLeads.deposito_1x.length },
      { id: 'deposito_2x', title: '🔥 2º Depósito', color: 'orange', leads: colLeads.deposito_2x, totalLeads: colLeads.deposito_2x.length },
      { id: 'deposito_3x', title: '💎 DEPOSITOU 3X', color: 'indigo', leads: colLeads.deposito_3x, totalLeads: colLeads.deposito_3x.length },
      { id: 'deposito_5x', title: '⭐ DEPOSITOU 5X', color: 'amber', leads: colLeads.deposito_5x, totalLeads: colLeads.deposito_5x.length },
      { id: 'deposito_10x', title: '👑 DEPOSITOU 10X+', color: 'rose', leads: colLeads.deposito_10x, totalLeads: colLeads.deposito_10x.length },
      { id: 'ativo', title: '✅ CLIENTE ATIVO', color: 'purple', leads: colLeads.ativo, totalLeads: colLeads.ativo.length },
    ];

    const sortedColumns = baseColumns.map((col) => {
      const sortedLeads = applySortToLeads(col.leads, col.id);
      const currentLimit = leadsPerColumn[col.id] ?? 100;
      return {
        ...col,
        leads: sortedLeads.slice(0, currentLimit),
        totalLeads: col.totalLeads ?? sortedLeads.length,
      };
    });

    return {
      columns: sortedColumns,
      metrics: { total_leads: totalLeads, total_deposited: totalDeposited, active_leads: activeLeads, conversion_rate: conversionRate },
    };
  }, [rawLeads, filters, searchTerm, leadsPerColumn, columnSorts]);

  const metrics = loading && rawLeads.length === 0 ? null : derivedMetrics;

  const onDragStart = (e: React.DragEvent, leadId: string | number) => {
    e.dataTransfer.setData('leadId', leadId.toString());
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
  };
  const handleStarsChange = (leadId: string | number, newStars: number) => {
    setRawLeads((prev) => prev.map((l) => (l.id === leadId ? { ...l, stars: newStars } : l)));
  };
  const handleTagAdded = (leadId: string | number, addedTag: { id: string; label: string; color: string }) => {
    setRawLeads((prev) =>
      prev.map((l) => (l.id === leadId ? { ...l, tags: [...(l.tags || []), addedTag] } : l))
    );
  };
  const handleTagRemoved = (leadId: string | number, tagId: string) => {
    setRawLeads((prev) =>
      prev.map((l) => (l.id === leadId ? { ...l, tags: (l.tags || []).filter((t) => t.id !== tagId) } : l))
    );
  };
  const handleOpenSortModal = (columnId: string) => {
    const currentSort = columnSorts[columnId];
    setSortingColumnId(columnId);
    setSortField(currentSort?.field || null);
    setSortDirection(currentSort?.direction || 'asc');
    setSortModalOpen(true);
  };
  const handleApplySort = () => {
    if (sortingColumnId && sortField) {
      setColumnSorts((prev) => ({ ...prev, [sortingColumnId]: { field: sortField, direction: sortDirection } }));
    }
    setSortModalOpen(false);
  };
  const handleCloseSortModal = () => {
    setSortModalOpen(false);
    setSortingColumnId(null);
    setSortField(null);
    setSortDirection('asc');
  };
  const handleLoadMore = (columnId: string) => {
    setLeadsPerColumn((prev) => ({ ...prev, [columnId]: (prev[columnId] || 100) + 100 }));
  };

  const formatCurrency = (val: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

  /** Carregamento inicial: bancas ou leads ainda sem nenhum dado na tela. */
  const isInitialLoading = !bancasReady || ((loading || filterLoading) && rawLeads.length === 0);
  /** Mensagem do overlay: diferenciar "bancas" vs "leads". */
  const loadingMessage = !bancasReady
    ? 'Carregando bancas e preparando a lista...'
    : 'Carregando leads transferidos...';

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-[#1a1a1a]">
        <div className="bg-white dark:bg-[#2a2a2a] rounded-xl shadow-lg p-6 border border-gray-200 dark:border-[#404040] text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#8CD955] mx-auto mb-4" />
          <p className="text-gray-700 dark:text-gray-200 font-medium">Carregando...</p>
        </div>
      </div>
    );
  }

  return (
    <Layout>
      <div className="min-h-[calc(100vh-30px)] lg:min-h-[calc(100vh-255px)] flex flex-col overflow-y-auto overflow-x-hidden max-w-full relative">
        <div className="flex-none pb-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-emerald-100 rounded-xl">
                <ArrowRightLeft className="w-5 h-5 md:w-6 md:h-6 text-[#8CD955]" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-xl md:text-2xl font-bold text-gray-800 dark:text-white">Leads Transferidos</h1>
                  {isInitialLoading && (
                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[#8CD955]/20 text-[#8CD955] text-xs font-semibold">
                      <RefreshCw className="w-3.5 h-3.5 animate-spin flex-shrink-0" />
                      Carregando...
                    </span>
                  )}
                  {(loading || filterLoading || loadingFullInBackground) && rawLeads.length > 0 && !isInitialLoading && (
                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-600 dark:text-amber-400 text-xs font-medium">
                      <RefreshCw className="w-3.5 h-3.5 animate-spin flex-shrink-0" />
                      Atualizando...
                    </span>
                  )}
                </div>
                <p className="text-[11px] md:text-sm text-gray-500 dark:text-gray-400">CRM dos leads que foram transferidos para você</p>
              </div>
            </div>
            <button
              onClick={() => setShowStatusModal(true)}
              className="whitespace-nowrap flex items-center gap-2 bg-[#8CD955] text-white px-3 py-2 rounded-xl text-[11px] md:text-sm font-bold hover:bg-[#7BC84A] transition-all shadow-md flex-shrink-0"
            >
              <Eye className="w-3.5 h-3.5" />
              Informações de Status
            </button>
          </div>

          {/* Quick Metrics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6 animate-in fade-in slide-in-from-top-2 duration-500 relative">
            <div className="bg-white dark:bg-[#2a2a2a] p-3 rounded-xl border border-gray-100 dark:border-[#404040] shadow-sm">
              <p className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Total Leads</p>
              <p className="text-lg font-bold text-gray-800 dark:text-white">{metrics?.total_leads ?? 0}</p>
            </div>
            <div className="bg-white dark:bg-[#2a2a2a] p-3 rounded-xl border border-gray-100 dark:border-[#404040] shadow-sm">
              <p className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Total Depositado</p>
              <p className="text-lg font-bold text-[#8CD955]">{formatCurrency(metrics?.total_deposited ?? 0)}</p>
            </div>
            <div className="bg-white dark:bg-[#2a2a2a] p-3 rounded-xl border border-gray-100 dark:border-[#404040] shadow-sm">
              <p className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Clientes Ativos</p>
              <p className="text-lg font-bold text-purple-600 dark:text-purple-400">{metrics?.active_leads ?? 0}</p>
            </div>
            <div className="bg-white dark:bg-[#2a2a2a] p-3 rounded-xl border border-gray-100 dark:border-[#404040] shadow-sm">
              <p className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Conversão</p>
              <p className="text-lg font-bold text-blue-600 dark:text-blue-400">{(metrics?.conversion_rate ?? 0).toFixed(1)}%</p>
            </div>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-100 text-red-600 rounded-xl flex items-center gap-2 text-sm animate-in fade-in slide-in-from-top-1">
              <AlertCircle className="w-4 h-4" /> {error}
            </div>
          )}

          {/* Bloco: mantém o usuário informado até terminar todos os lotes; mostra total de leads já carregados */}
          {batchLoadInProgress && (
            <div className="mb-4 py-4 px-4 bg-[#8CD955]/15 dark:bg-[#8CD955]/10 border-2 border-[#8CD955]/50 text-gray-800 dark:text-gray-200 rounded-xl flex items-center gap-3 text-sm font-medium animate-in fade-in shadow-sm">
              <RefreshCw className="w-6 h-6 animate-spin text-[#8CD955] flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">
                  {rawLeads.length === 0
                    ? 'Carregando leads...'
                    : loadingProgress && loadingProgress.totalLoaded > 0
                      ? `Carregando leads — ${loadingProgress.totalLoaded.toLocaleString('pt-BR')} já carregados`
                      : 'Carregando mais lotes de leads.'}
                </p>
                {loadingProgress && (loadingFullInBackground || loading || filterLoading) && (
                  <p className="text-xs text-gray-600 dark:text-gray-400 font-normal mt-1">
                    <span className="font-medium text-[#8CD955]">{loadingProgress.totalLoaded.toLocaleString('pt-BR')} leads</span> no quadro
                    {loadingProgress.totalBancas != null && loadingProgress.totalBancas > 0 && (
                      <> · Banca {loadingProgress.currentBanca} de {loadingProgress.totalBancas}</>
                    )}
                    {loadingProgress.currentPage > 1 && (
                      <> · Página {loadingProgress.currentPage}</>
                    )}
                  </p>
                )}
                {loadingFullInBackground && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Você já pode usar o quadro; novos leads aparecerão automaticamente.</p>
                )}
              </div>
            </div>
          )}

          {userId && !bancasReady && (
            <div className="mb-4 p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 text-amber-800 dark:text-amber-200 rounded-xl flex items-center gap-3 text-sm animate-in fade-in slide-in-from-top-1">
              <RefreshCw className="w-5 h-5 flex-shrink-0 animate-spin" />
              <div>
                <p className="font-semibold">Carregando bancas do usuário</p>
                <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">A busca de leads será feita assim que as bancas estiverem disponíveis.</p>
              </div>
            </div>
          )}
          {!loading && !filterLoading && !error && rawLeads.length === 0 && !loadingFullInBackground && bancasReady && (
            <div className="mb-4 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800/50 text-blue-700 dark:text-blue-200 rounded-xl flex items-center gap-3 text-sm animate-in fade-in slide-in-from-top-1">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <div>
                <p className="font-semibold">Nenhum lead transferido</p>
                <p className="text-xs text-blue-600 dark:text-blue-300 mt-1">Leads transferidos para você aparecerão aqui.</p>
              </div>
            </div>
          )}

          <div className="relative z-30">
            <FilterBar
              onSearch={(term) => setSearchTerm(term)}
              onFilterChange={handleFilterChange}
              initialDateFilter={filters.date}
              onBancasLoaded={handleBancasLoaded}
              targetUserId={targetUserId}
              transferredFilter="yes"
            />
          </div>
        </div>

        <div className="flex-1 overflow-x-auto overflow-y-auto pb-4 custom-scrollbar -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 snap-x snap-mandatory relative min-h-[400px]">
          {/* Indicador quando já há leads e ainda está carregando mais lotes em segundo plano */}
          {(loading || filterLoading || loadingFullInBackground) && rawLeads.length > 0 && (
            <div className="absolute top-2 right-2 z-20 flex items-center gap-2 px-3 py-1.5 bg-[#8CD955]/20 dark:bg-[#8CD955]/15 border border-[#8CD955]/40 rounded-lg text-xs font-medium text-gray-700 dark:text-gray-200">
              <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#8CD955]" />
              <span>{loadingProgress?.totalLoaded?.toLocaleString('pt-BR') ?? 0} leads carregados</span>
            </div>
          )}
          <div className="flex gap-4 md:gap-6 items-stretch h-full min-h-[500px]">
            {columns.map((column) => (
                <div key={column.id} className="w-[calc(100vw-3.5rem)] sm:w-96 h-full min-h-[500px] flex-shrink-0 snap-center">
                  <KanbanColumn
                    id={column.id}
                    title={column.title}
                    count={column.leads.length}
                    leads={column.leads}
                    color={column.color}
                    onStarsChange={handleStarsChange}
                    onDragStart={onDragStart}
                    onDrop={onDrop}
                    targetUserId={userId || undefined}
                    onTagAdded={handleTagAdded}
                    onTagRemoved={handleTagRemoved}
                    onRefresh={() => loadLeads(true)}
                    selectedBancaUrl={filters.banca ? (typeof filters.banca === 'object' ? filters.banca.value : filters.banca) : undefined}
                    onOpenSortModal={handleOpenSortModal}
                    totalLeads={column.totalLeads}
                    onLoadMore={handleLoadMore}
                    isLoadingMore={false}
                    compactCards
                    transferDeadlineDays={10}
                    maxListHeight="700px"
                  />
                </div>
            ))}
            <div className="w-6 md:w-2 flex-shrink-0 snap-center" />
          </div>
        </div>

        {/* Overlay unificado: enquanto bancas ou primeiros leads carregam, usuário vê claramente que está carregando */}
        {isInitialLoading && (
          <div className="absolute inset-0 z-40 flex items-center justify-center bg-white/85 dark:bg-[#1a1a1a]/92 backdrop-blur-sm rounded-2xl">
            <div className="flex flex-col items-center gap-4 px-6 py-8 max-w-sm text-center">
              <div className="p-4 rounded-full bg-[#8CD955]/20">
                <RefreshCw className="w-10 h-10 text-[#8CD955] animate-spin" />
              </div>
              <div>
                <p className="font-bold text-gray-800 dark:text-white text-lg">{loadingMessage}</p>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Aguarde enquanto buscamos as informações.</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {sortingColumnId && (
        <SortColumnModal
          isOpen={sortModalOpen}
          onClose={handleCloseSortModal}
          columnTitle={columns.find((c) => c.id === sortingColumnId)?.title || ''}
          sortField={sortField}
          sortDirection={sortDirection}
          onSortChange={(field, direction) => {
            setSortField(field);
            setSortDirection(direction);
          }}
          onApply={handleApplySort}
        />
      )}

      {showStatusModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowStatusModal(false)}>
          <div className="bg-white dark:bg-[#2a2a2a] rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto border border-gray-200 dark:border-[#404040]" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 bg-white dark:bg-[#2a2a2a] border-b border-gray-200 dark:border-[#404040] px-6 py-4 flex items-center justify-between rounded-t-2xl">
              <div>
                <h2 className="text-xl font-bold text-gray-800 dark:text-white">Status de Temperatura dos Leads</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">Entenda cada classificação de lead no sistema</p>
              </div>
              <button onClick={() => setShowStatusModal(false)} className="p-2 hover:bg-gray-100 dark:hover:bg-[#404040] rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6">
              <p className="text-gray-600 dark:text-gray-300">
                Os leads são classificados por temperatura (frio, ativo, quente, esfriando) e por estágio no funil (novo, contactado, depósitos, ativo).
                Use os filtros para segmentar sua base.
              </p>
            </div>
            <div className="sticky bottom-0 bg-gray-50 dark:bg-[#333] border-t border-gray-200 dark:border-[#404040] px-6 py-4 rounded-b-2xl">
              <button onClick={() => setShowStatusModal(false)} className="w-full py-3 bg-[#8CD955] hover:bg-[#7BC84A] text-white font-bold rounded-xl">
                Entendi
              </button>
            </div>
          </div>
        </div>
      )}
      <ToastContainer toasts={toasts} onClose={removeToast} />
    </Layout>
  );
};

export default function TransferidoPage() {
  return (
    <Suspense fallback={<div>Carregando...</div>}>
      <TransferidoContent />
    </Suspense>
  );
}
