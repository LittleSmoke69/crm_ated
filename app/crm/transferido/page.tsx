'use client';

import React, { useState, useEffect, useRef, useMemo, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Layout from '@/components/Layout';
import { useRequireAuth } from '@/utils/useRequireAuth';
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
  const [filters, setFilters] = useState<Record<string, any>>(() => {
    const today = new Date().toISOString().split('T')[0];
    return { date: { value: 'diario', label: 'Diário' } };
  });
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

  const isInitialLoadRef = useRef(true);
  const bancaKey = filters.banca ? (typeof filters.banca === 'object' ? filters.banca.value : filters.banca) : null;
  const dateKey = filters.date ? (typeof filters.date === 'object' ? filters.date.value : filters.date) : null;

  const loadLeads = useCallback(async (isFilterChange = false) => {
    if (!userId) return;
    if (isFilterChange) {
      setFilterLoading(true);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const url = new URL('/api/crm/transferred-leads', window.location.origin);
      if (targetUserId) {
        url.searchParams.append('userId', targetUserId);
      }
      const bancaValue = filters.banca ? (typeof filters.banca === 'object' ? filters.banca.value : filters.banca) : null;
      if (bancaValue && bancaValue !== 'all') {
        url.searchParams.append('banca_url', bancaValue);
        console.log('[Transferido] loadLeads | banca selecionada:', bancaValue);
      } else if (exclusiveBancasList.length > 0) {
        url.searchParams.append('banca_urls', exclusiveBancasList.map((b) => b.url).join(','));
        console.log('[Transferido] loadLeads | Todas as Bancas, urls:', exclusiveBancasList.length);
      } else {
        console.warn('[Transferido] loadLeads | exclusiveBancasList vazio - API usará bancas do log de transferência');
      }

      const dateValue = filters.date ? (typeof filters.date === 'object' ? filters.date.value : filters.date) : 'diario';
      const nowSP = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
      const today = nowSP.toISOString().split('T')[0];

      if (dateValue === 'diario') {
        url.searchParams.append('from', today);
        url.searchParams.append('to', today);
      } else if (dateValue === 'ontem') {
        const yesterday = new Date(nowSP);
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split('T')[0];
        url.searchParams.append('from', yesterdayStr);
        url.searchParams.append('to', yesterdayStr);
      } else if (dateValue === '7dias') {
        const sevenDaysAgo = new Date(nowSP);
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
        url.searchParams.append('from', sevenDaysAgo.toISOString().split('T')[0]);
        url.searchParams.append('to', today);
      } else if (dateValue === '15dias') {
        const fifteenDaysAgo = new Date(nowSP);
        fifteenDaysAgo.setDate(fifteenDaysAgo.getDate() - 14);
        url.searchParams.append('from', fifteenDaysAgo.toISOString().split('T')[0]);
        url.searchParams.append('to', today);
      } else if (dateValue === '30dias') {
        const thirtyDaysAgo = new Date(nowSP);
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29);
        url.searchParams.append('from', thirtyDaysAgo.toISOString().split('T')[0]);
        url.searchParams.append('to', today);
      } else if (dateValue?.startsWith?.('custom_')) {
        const parts = dateValue.split('_');
        if (parts.length === 3) {
          url.searchParams.append('from', parts[1]);
          url.searchParams.append('to', parts[2]);
        }
      }

      console.log('[Transferido] loadLeads | URL:', url.toString());
      const res = await fetch(url.toString(), { headers: { 'X-User-Id': userId } });
      const result = await res.json();
      console.log('[Transferido] loadLeads | res.ok:', res.ok, 'result.success:', result.success, 'data length:', result.data?.length ?? 0, 'error:', result.error);
      if (result.success) {
        const leads: any[] = result.data || [];
        const formatted: Lead[] = leads.map((l: any) => {
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
            interactions: 0,
            lastInteractionAt: l.last_interaction || l.created_at,
            isFavorite: false,
            alertStatus: 'idle',
          };
        });
        console.log('[Transferido] loadLeads | formatted:', formatted.length, 'amostra:', formatted.slice(0, 2).map((l) => ({ id: l.id, name: l.name, status: l.status, total_depositos_count: l.total_depositos_count, has_interaction: l.has_interaction })));
        setRawLeads(formatted);
      } else {
        setError(result.error || 'Erro ao carregar leads transferidos');
      }
    } catch (err) {
      console.error('[Transferido] loadLeads | Erro:', err);
      setError('Erro de conexão com o servidor');
    } finally {
      setLoading(false);
      setFilterLoading(false);
    }
  }, [userId, targetUserId, filters.banca, filters.date, exclusiveBancasList]);

  useEffect(() => {
    console.log('[Transferido] useEffect load | userId:', !!userId, 'bancasReady:', bancasReady, 'bancaKey:', bancaKey, 'dateKey:', dateKey);
    if (!userId) return;
    if (!bancasReady) return;
    const isInitialLoad = isInitialLoadRef.current;
    if (isInitialLoad) isInitialLoadRef.current = false;
    loadLeads(!isInitialLoad);
  }, [userId, bancaKey, dateKey, bancasReady, loadLeads]);

  const handleBancasLoaded = useCallback((bancas: { id: string; name: string; url: string }[]) => {
    console.log('[Transferido] handleBancasLoaded | bancas:', bancas.length, bancas.map((b) => b.name ?? b.id));
    setExclusiveBancasList(bancas);
    setBancasReady(true);
  }, []);

  const handleFilterChange = (type: string, value: any) => {
    setLeadsPerColumn({});
    if (type === 'clear') {
      setFilters({ date: { value: 'diario', label: 'Diário' } });
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
    console.log('[Transferido] useMemo | rawLeads:', rawLeads.length, 'início formattedLeads:', formattedLeads.length);

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

    const baseColumns: Column[] = [
      {
        id: 'novo',
        title: '👥 Clientes cadastrados',
        color: 'gray',
        leads: formattedLeads.filter((l) => (l.total_depositos_count || 0) === 0 && l.status !== 'ativo' && !(l.has_interaction === true)),
        totalLeads: formattedLeads.filter((l) => (l.total_depositos_count || 0) === 0 && l.status !== 'ativo' && !(l.has_interaction === true)).length,
      },
      {
        id: 'contactados',
        title: '📞 Clientes Contactados',
        color: 'blue',
        leads: formattedLeads.filter((l) => l.has_interaction === true && (l.total_depositos_count || 0) === 0),
        totalLeads: formattedLeads.filter((l) => l.has_interaction === true && (l.total_depositos_count || 0) === 0).length,
      },
      {
        id: 'deposito_sem_aposta',
        title: '💰 Com Saldo Disponível',
        color: 'red',
        leads: formattedLeads.filter((l) => (l.total_depositado || 0) > (l.total_apostado || 0) || (l.balance ?? 0) > 0),
        totalLeads: formattedLeads.filter((l) => (l.total_depositado || 0) > (l.total_apostado || 0) || (l.balance ?? 0) > 0).length,
      },
      {
        id: 'deposito_1x',
        title: '💰 1º Depósito',
        color: 'emerald',
        leads: formattedLeads.filter((l) => (l.total_depositos_count || 0) === 1 && (l.total_depositado || 0) <= (l.total_apostado || 0)),
        totalLeads: formattedLeads.filter((l) => (l.total_depositos_count || 0) === 1 && (l.total_depositado || 0) <= (l.total_apostado || 0)).length,
      },
      {
        id: 'deposito_2x',
        title: '🔥 2º Depósito',
        color: 'orange',
        leads: formattedLeads.filter((l) => (l.total_depositos_count || 0) === 2 && (l.total_depositado || 0) <= (l.total_apostado || 0)),
        totalLeads: formattedLeads.filter((l) => (l.total_depositos_count || 0) === 2 && (l.total_depositado || 0) <= (l.total_apostado || 0)).length,
      },
      {
        id: 'deposito_3x',
        title: '💎 DEPOSITOU 3X',
        color: 'indigo',
        leads: formattedLeads.filter((l) => {
          const c = l.total_depositos_count || 0;
          return c >= 3 && c < 5 && (l.total_depositado || 0) <= (l.total_apostado || 0);
        }),
        totalLeads: formattedLeads.filter((l) => {
          const c = l.total_depositos_count || 0;
          return c >= 3 && c < 5 && (l.total_depositado || 0) <= (l.total_apostado || 0);
        }).length,
      },
      {
        id: 'deposito_5x',
        title: '⭐ DEPOSITOU 5X',
        color: 'amber',
        leads: formattedLeads.filter((l) => {
          const c = l.total_depositos_count || 0;
          return c >= 5 && c < 10 && (l.total_depositado || 0) <= (l.total_apostado || 0);
        }),
        totalLeads: formattedLeads.filter((l) => {
          const c = l.total_depositos_count || 0;
          return c >= 5 && c < 10 && (l.total_depositado || 0) <= (l.total_apostado || 0);
        }).length,
      },
      {
        id: 'deposito_10x',
        title: '👑 DEPOSITOU 10X+',
        color: 'rose',
        leads: formattedLeads.filter((l) => (l.total_depositos_count || 0) >= 10 && (l.total_depositado || 0) <= (l.total_apostado || 0)),
        totalLeads: formattedLeads.filter((l) => (l.total_depositos_count || 0) >= 10 && (l.total_depositado || 0) <= (l.total_apostado || 0)).length,
      },
      {
        id: 'ativo',
        title: '✅ CLIENTE ATIVO',
        color: 'purple',
        leads: formattedLeads.filter((l) => l.status === 'ativo'),
        totalLeads: formattedLeads.filter((l) => l.status === 'ativo').length,
      },
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

    const colSummary = sortedColumns.map((c) => `${c.id}:${c.leads.length}`).join(', ');
    console.log('[Transferido] useMemo | formattedLeads após filtros:', formattedLeads.length, '| colunas:', colSummary);

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
      <div className="min-h-[calc(100vh-30px)] lg:min-h-[calc(100vh-255px)] flex flex-col overflow-y-auto overflow-x-hidden max-w-full">
        <div className="flex-none pb-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-emerald-100 rounded-xl">
                <ArrowRightLeft className="w-5 h-5 md:w-6 md:h-6 text-[#8CD955]" />
              </div>
              <div>
                <h1 className="text-xl md:text-2xl font-bold text-gray-800 dark:text-white">Leads Transferidos</h1>
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

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6 relative">
            {(loading || filterLoading) && (
              <div className="absolute inset-0 bg-white/60 dark:bg-[#1a1a1a]/80 backdrop-blur-[2px] rounded-xl z-10 flex items-center justify-center">
                <div className="flex items-center gap-2 text-[#8CD955]">
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span className="text-xs font-semibold">Carregando...</span>
                </div>
              </div>
            )}
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
            <div className="mb-4 p-3 bg-red-50 border border-red-100 text-red-600 rounded-xl flex items-center gap-2 text-sm">
              <AlertCircle className="w-4 h-4" /> {error}
            </div>
          )}

          {!loading && !filterLoading && !error && rawLeads.length === 0 && (
            <div className="mb-4 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800/50 text-blue-700 dark:text-blue-200 rounded-xl flex items-center gap-3 text-sm">
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
            />
          </div>
        </div>

        <div className="flex-1 overflow-x-auto overflow-y-auto pb-4 custom-scrollbar -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 snap-x snap-mandatory relative min-h-[400px]">
          {(loading || filterLoading) && (
            <div className="absolute inset-0 bg-white/50 dark:bg-[#1a1a1a]/80 backdrop-blur-[1px] rounded-xl z-20 flex items-center justify-center">
              <div className="flex flex-col items-center gap-2 text-[#8CD955]">
                <RefreshCw className="w-5 h-5 animate-spin" />
                <span className="text-xs font-semibold">Carregando leads...</span>
              </div>
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
