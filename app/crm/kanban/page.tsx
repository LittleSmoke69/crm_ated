'use client';

import React, { useState, useEffect, useRef, useMemo, useCallback, Suspense } from 'react';
import Layout from '@/components/Layout';
import { useRequireAuth } from '@/utils/useRequireAuth';
import { Kanban as KanbanIcon, Plus, Users, Target, CheckCircle2, MessageSquare, AlertCircle, Eye, RefreshCw, X } from 'lucide-react';
import FilterBar from '@/components/CRM/FilterBar';
import KanbanColumn from '@/components/CRM/KanbanColumn';
import SortColumnModal from '@/components/CRM/SortColumnModal';
import { Lead, Column, ThermalStatus } from '@/components/CRM/types';
import { useSearchParams } from 'next/navigation';

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

/** Níveis estrela (aposta mínima/máxima para o nível) - deve bater com LeadCard */
const STAR_LEVELS = [
  { level: 1, min: 100, max: 299 },
  { level: 2, min: 300, max: 699 },
  { level: 3, min: 700, max: 1199 },
  { level: 4, min: 1200, max: 4999 },
  { level: 5, min: 2500, max: 14999 },
  { level: 6, min: 15000, max: 29999 },
  { level: 7, min: 30000, max: 50000 },
] as const;

/** Retorna o valor (em R$) que falta para a próxima estrela, ou null se já está no nível máximo. */
function getMissingForNextStar(apostaEstrelas: number): number | null {
  const value = Math.max(0, apostaEstrelas ?? 0);
  const current = [...STAR_LEVELS].reverse().find((r) => value >= r.min && value <= r.max);
  if (!current) {
    if (value < STAR_LEVELS[0].min) {
      return STAR_LEVELS[0].min - value;
    }
    return null; // já no nível máximo
  }
  const currentIdx = STAR_LEVELS.findIndex((r) => r.level === current.level);
  const next = currentIdx < STAR_LEVELS.length - 1 ? STAR_LEVELS[currentIdx + 1] : null;
  return next ? Math.max(0, next.min - value) : null;
}

// Função para criar colunas padrão vazias
const getDefaultColumns = (leads: Lead[] = []): Column[] => {
  return [
    { 
      id: 'novo', 
      title: '👥 Clientes cadastrados', 
      color: 'gray', 
      leads: leads.filter(l => 
        (l.total_depositos_count || 0) === 0 && 
        l.status !== 'ativo' && 
        !(l.has_interaction === true)
      ).slice(0, 100), // Limita a 100 leads
      totalLeads: leads.filter(l => 
        (l.total_depositos_count || 0) === 0 && 
        l.status !== 'ativo' && 
        !(l.has_interaction === true)
      ).length
    },
    { 
      id: 'contactados', 
      title: '📞 Clientes Contactados', 
      color: 'blue', 
      leads: leads
        .filter(l => 
          l.has_interaction === true && 
          (l.total_depositos_count || 0) === 0
        )
        .sort((a, b) => {
          const timeA = a.lastInteractionAt ? new Date(a.lastInteractionAt).getTime() : 
                        a.last_interaction ? new Date(a.last_interaction).getTime() : 0;
          const timeB = b.lastInteractionAt ? new Date(b.lastInteractionAt).getTime() : 
                        b.last_interaction ? new Date(b.last_interaction).getTime() : 0;
          return timeA - timeB;
        })
        .slice(0, 100), // Limita a 100 leads
      totalLeads: leads.filter(l => 
        l.has_interaction === true && 
        (l.total_depositos_count || 0) === 0
      ).length
    },
    { 
      id: 'deposito_sem_aposta', 
      title: '💰 Com Saldo Disponível', 
      color: 'red', 
      leads: leads.filter(l => 
        (l.total_depositado || 0) > (l.total_apostado || 0) || (l.balance ?? 0) > 0
      ).slice(0, 100), // Limita a 100 leads
      totalLeads: leads.filter(l => 
        (l.total_depositado || 0) > (l.total_apostado || 0) || (l.balance ?? 0) > 0
      ).length
    },
    { 
      id: 'deposito_1x', 
      title: '💰 1º Depósito', 
      color: 'emerald', 
      leads: leads.filter(l => 
        (l.total_depositos_count || 0) === 1 && 
        (l.total_depositado || 0) <= (l.total_apostado || 0)
      ).slice(0, 100), // Limita a 100 leads
      totalLeads: leads.filter(l => 
        (l.total_depositos_count || 0) === 1 && 
        (l.total_depositado || 0) <= (l.total_apostado || 0)
      ).length
    },
    { 
      id: 'deposito_2x', 
      title: '🔥 2º Depósito', 
      color: 'orange', 
      leads: leads.filter(l => 
        (l.total_depositos_count || 0) === 2 && 
        (l.total_depositado || 0) <= (l.total_apostado || 0)
      ).slice(0, 100), // Limita a 100 leads
      totalLeads: leads.filter(l => 
        (l.total_depositos_count || 0) === 2 && 
        (l.total_depositado || 0) <= (l.total_apostado || 0)
      ).length
    },
    { 
      id: 'deposito_3x', 
      title: '💎 DEPOSITOU 3X', 
      color: 'indigo', 
      leads: leads.filter(l => {
        const count = l.total_depositos_count || 0;
        return count >= 3 && count < 5 && 
               (l.total_depositado || 0) <= (l.total_apostado || 0);
      }).slice(0, 100), // Limita a 100 leads
      totalLeads: leads.filter(l => {
        const count = l.total_depositos_count || 0;
        return count >= 3 && count < 5 && 
               (l.total_depositado || 0) <= (l.total_apostado || 0);
      }).length
    },
    { 
      id: 'deposito_5x', 
      title: '⭐ DEPOSITOU 5X', 
      color: 'amber', 
      leads: leads.filter(l => {
        const count = l.total_depositos_count || 0;
        return count >= 5 && count < 10 && 
               (l.total_depositado || 0) <= (l.total_apostado || 0);
      }).slice(0, 100), // Limita a 100 leads
      totalLeads: leads.filter(l => {
        const count = l.total_depositos_count || 0;
        return count >= 5 && count < 10 && 
               (l.total_depositado || 0) <= (l.total_apostado || 0);
      }).length
    },
    { 
      id: 'deposito_10x', 
      title: '👑 DEPOSITOU 10X+', 
      color: 'rose', 
      leads: leads.filter(l => {
        const count = l.total_depositos_count || 0;
        return count >= 10 && 
               (l.total_depositado || 0) <= (l.total_apostado || 0);
      }).slice(0, 100), // Limita a 100 leads
      totalLeads: leads.filter(l => {
        const count = l.total_depositos_count || 0;
        return count >= 10 && 
               (l.total_depositado || 0) <= (l.total_apostado || 0);
      }).length
    },
    { 
      id: 'ativo', 
      title: '✅ CLIENTE ATIVO', 
      color: 'purple', 
      leads: leads.filter(l => 
        l.status === 'ativo'
      ).slice(0, 100), // Limita a 100 leads
      totalLeads: leads.filter(l => 
        l.status === 'ativo'
      ).length
    }
  ];
};

const KanbanContent = () => {
  const { checking, userId } = useRequireAuth();
  const searchParams = useSearchParams();
  const targetUserId = searchParams.get('userId');
  
  const [rawLeads, setRawLeads] = useState<Lead[]>([]); // Leads da API (banca+período) - filtros aplicados localmente
  const [loading, setLoading] = useState(false); // true apenas quando a requisição de leads estiver em andamento
  const [filterLoading, setFilterLoading] = useState(false); // Loading ao mudar banca/período
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filters, setFilters] = useState<Record<string, any>>(() => {
    // Predefinido como diário (dia atual)
    const today = new Date().toISOString().split('T')[0];
    return {
      date: {
        value: 'diario',
        label: 'Diário'
      }
    };
  });
  const [consultorInfo, setConsultorInfo] = useState<{ name: string; email: string } | null>(null);

  // Quem está visualizando o CRM do consultor (para exibir aviso quando gerente acessa)
  const [viewers, setViewers] = useState<{ id: string; name: string }[]>([]);

  // Estados para o modal de ordenação
  const [sortModalOpen, setSortModalOpen] = useState(false);
  const [sortingColumnId, setSortingColumnId] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [columnSorts, setColumnSorts] = useState<Record<string, { field: SortField; direction: SortDirection }>>({});
  
  // Estado para controlar quantos leads estão sendo exibidos por coluna
  const [leadsPerColumn, setLeadsPerColumn] = useState<Record<string, number>>({});
  
  // Estado para controlar o modal informativo de status
  const [showStatusModal, setShowStatusModal] = useState(false);

  const isInitialLoadRef = useRef<boolean>(true);

  // CRM Bancas precisa carregar por completo antes de carregar Leads (dropdown de bancas define o contexto)
  const [bancasReady, setBancasReady] = useState(false);
  /** Listagem exclusiva de bancas do dropdown; em "Todas as Bancas" a API de leads usa só essas URLs. */
  const [exclusiveBancasList, setExclusiveBancasList] = useState<{ id: string; name: string; url: string }[]>([]);

  // API chamada APENAS quando banca ou período mudam; demais filtros são aplicados localmente
  const bancaKey = filters.banca ? (typeof filters.banca === 'object' ? filters.banca.value : filters.banca) : null;
  const dateKey = filters.date ? (typeof filters.date === 'object' ? filters.date.value : filters.date) : null;

  useEffect(() => {
    if (!userId) return;
    if (!bancasReady) return;

    const isInitialLoad = isInitialLoadRef.current;
    if (isInitialLoad) {
      isInitialLoadRef.current = false;
    }

    loadLeads(!isInitialLoad);
  }, [userId, targetUserId, bancaKey, dateKey, bancasReady]);

  // Gerente visualizando CRM do consultor: registra sessão, heartbeat e cleanup ao sair
  const isViewingConsultorCrm = !!targetUserId && targetUserId !== userId;
  useEffect(() => {
    if (!userId || !isViewingConsultorCrm || !targetUserId) return;

    const registerSession = async () => {
      try {
        const res = await fetch('/api/crm/view-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
          body: JSON.stringify({ consultantId: targetUserId }),
        });
        if (!res.ok) console.warn('[Kanban] Falha ao registrar visualização');
      } catch (e) {
        console.warn('[Kanban] Erro ao registrar visualização:', e);
      }
    };

    registerSession();
    const heartbeat = setInterval(registerSession, 30000); // a cada 30s

    return () => {
      clearInterval(heartbeat);
      fetch(`/api/crm/view-session?consultant_id=${targetUserId}`, {
        method: 'DELETE',
        headers: { 'X-User-Id': userId },
        keepalive: true,
      }).catch(() => {});
    };
  }, [userId, targetUserId, isViewingConsultorCrm]);

  // Consultor vendo próprio CRM: polling para ver se gerente está visualizando
  const isConsultorViewingOwn = !targetUserId || targetUserId === userId;
  useEffect(() => {
    if (!userId || !isConsultorViewingOwn) {
      setViewers([]);
      return;
    }

    const fetchViewers = async () => {
      try {
        const res = await fetch(`/api/crm/view-session?consultant_id=${userId}`, {
          headers: { 'X-User-Id': userId },
        });
        const data = await res.json();
        if (data?.success && Array.isArray(data.data?.viewers)) {
          setViewers(data.data.viewers);
        }
      } catch {
        setViewers([]);
      }
    };

    fetchViewers();
    const interval = setInterval(fetchViewers, 30000); // a cada 30s
    return () => clearInterval(interval);
  }, [userId, isConsultorViewingOwn]);

  // Métricas são calculadas localmente baseadas nos leads filtrados
  // Não precisa mais da função loadMetrics da API

  const loadLeads = useCallback(async (isFilterChange = false) => {
    try {
      if (isFilterChange) {
        setFilterLoading(true);
      } else {
        setLoading(true);
      }
      setError(null);

      // API recebe APENAS banca e período; demais filtros são aplicados localmente
      const url = new URL('/api/crm/leads', window.location.origin);
      if (targetUserId) url.searchParams.append('userId', targetUserId);

      // Banca: uma específica ou "Todas as Bancas" (nesse caso enviamos só as URLs da listagem exclusiva)
      const bancaValue = filters.banca ? (typeof filters.banca === 'object' ? filters.banca.value : filters.banca) : null;
      if (bancaValue && bancaValue !== 'all') {
        url.searchParams.append('banca_url', bancaValue);
      } else if (exclusiveBancasList.length > 0) {
        url.searchParams.append('banca_urls', exclusiveBancasList.map(b => b.url).join(','));
      }

      // Período (date)
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
      } else if (dateValue?.startsWith('custom_')) {
        const parts = dateValue.split('_');
        if (parts.length === 3) {
          url.searchParams.append('from', parts[1]);
          url.searchParams.append('to', parts[2]);
        }
      }

      const response = await fetch(url.toString(), {
        headers: { 'X-User-Id': userId as string }
      });
      
      const result = await response.json();
      
      if (result.success) {
        const leads: any[] = result.data || [];
        console.log('[Kanban] Leads recebidos da API (banca+período):', leads.length);

        const formattedLeads: Lead[] = leads.map(l => {
          const firstName = l.name || '';
          const lastName = (l.last_name && l.last_name !== 'null') ? l.last_name : '';
          const fullName = `${firstName} ${lastName}`.trim() || 'Sem nome';

          return {
            id: l.id,
            name: fullName,
            phone: l.phone || '',
            email: l.email || '',
            status: l.status || 'novo',
            createdAt: l.created_at,
            thermalStatus: (l.temperature as ThermalStatus) || 'cold',
            tags: l.tags || [],
            interactions: 0,
            lastInteractionAt: l.last_interaction || l.created_at,
            isFavorite: false,
            alertStatus: 'idle',
            total_depositado: Math.round((parseFloat(l.total_depositado) || 0) * 100) / 100,
            total_apostado: Math.round((parseFloat(l.total_apostado) || 0) * 100) / 100,
            total_ganho: parseFloat(l.total_ganho) || 0,
            total_depositos_count: parseInt(l.total_depositos_count) || 0,
            stars: l.user_level ? parseInt(l.user_level) : (l.stars ? parseInt(l.stars) : 0),
            is_affiliate: !!l.affiliate_name || l.is_affiliate === true || l.affiliate === 'yes' || l.affiliate_filter === 'yes',
            affiliate_name: l.affiliate_name,
            temperature: l.temperature,
            has_interaction: l.has_interaction === true || l.has_interaction === 'true' || l.has_interaction === 1,
            last_deposit_at: l.last_deposit_at || null,
            last_deposit_value: l.last_deposit_value || null,
            created_at: l.created_at,
            last_winner_value: l.last_winner_value ? parseFloat(l.last_winner_value) : undefined,
            last_winner_at: l.last_winner_at || null,
            last_withdraw_at: l.last_withdraw_at || null,
            last_withdraw_value: l.last_withdraw_value ? parseFloat(l.last_withdraw_value) : undefined,
            total_saque: l.total_saque ? parseFloat(l.total_saque) : undefined,
            balance: l.balance ? parseFloat(l.balance) : 0,
            bonus: l.bonus ? parseFloat(l.bonus) : 0,
            convert: l.convert ? parseFloat(l.convert) : 0,
            total_afiliate: l.total_afiliate ? parseFloat(l.total_afiliate) : 0,
            aposta_estrelas: l.aposta_estrelas ? parseInt(l.aposta_estrelas.toString()) || 0 : 0,
            banca_id: l.banca_id,
            banca_name: l.banca_name,
            banca_url: l.banca_url
          };
        });

        setRawLeads(formattedLeads);

        // Se estiver vendo o CRM de outro usuário, busca o nome dele
        if (targetUserId && targetUserId !== userId) {
          const profileRes = await fetch(`/api/admin/users/${targetUserId}`, {
            headers: { 'X-User-Id': userId as string }
          });
          const profileResult = await profileRes.json();
          if (profileResult.success && profileResult.data?.user) {
            setConsultorInfo({
              name: profileResult.data.user.full_name || 'Consultor',
              email: profileResult.data.user.email
            });
          }
        } else {
          setConsultorInfo(null);
        }
      } else {
        const errorMessage = result.error || 'Erro ao carregar leads';
        console.error('[Kanban] Erro ao carregar leads:', errorMessage, result);
        
        // Se o erro for 404 ou "No indicateds found", não é um erro real, apenas não há dados
        if (errorMessage.includes('404') || errorMessage.includes('No indicateds found') || errorMessage.includes('Nenhum lead')) {
          setError(null);
          setRawLeads([]);
        } else {
          setError(errorMessage);
        }
      }
    } catch (err) {
      console.error('[Kanban] Erro de conexão:', err);
      setError('Erro de conexão com o servidor');
    } finally {
      setLoading(false);
      setFilterLoading(false);
    }
  }, [userId, targetUserId, filters, exclusiveBancasList]);

  const handleBancasLoaded = useCallback((bancas: { id: string; name: string; url: string }[]) => {
    setExclusiveBancasList(bancas);
    setBancasReady(true);
  }, []);

  const handleSignOut = () => {
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('user_id');
      sessionStorage.removeItem('profile_id');
      window.localStorage.removeItem('profile_id');
      document.cookie = 'user_id=; Path=/; Max-Age=0; SameSite=Lax';
      window.location.href = '/login';
    }
  };

  const handleSearch = (term: string) => {
    setSearchTerm(term);
  };

  const handleRefresh = () => {
    loadLeads();
  };

  // Função para abrir o modal de ordenação
  const handleOpenSortModal = (columnId: string) => {
    const currentSort = columnSorts[columnId];
    setSortingColumnId(columnId);
    setSortField(currentSort?.field || null);
    setSortDirection(currentSort?.direction || 'asc');
    setSortModalOpen(true);
  };

  // Função para aplicar a ordenação (useMemo recalcula colunas quando columnSorts muda)
  const handleApplySort = () => {
    if (sortingColumnId && sortField) {
      setColumnSorts(prev => ({
        ...prev,
        [sortingColumnId]: { field: sortField, direction: sortDirection }
      }));
    }
    setSortModalOpen(false);
  };

  // Função para fechar o modal
  const handleCloseSortModal = () => {
    setSortModalOpen(false);
    setSortingColumnId(null);
    setSortField(null);
    setSortDirection('asc');
  };

  // Função para carregar mais leads em uma coluna (apenas atualiza limite local, sem API)
  const handleLoadMore = (columnId: string) => {
    setLeadsPerColumn(prev => ({
      ...prev,
      [columnId]: (prev[columnId] || 100) + 100
    }));
  };

  // Função para aplicar ordenação em uma lista de leads
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
          valA = (a.last_interaction || a.lastInteractionAt)
            ? new Date(a.last_interaction || a.lastInteractionAt).getTime()
            : 0;
          valB = (b.last_interaction || b.lastInteractionAt)
            ? new Date(b.last_interaction || b.lastInteractionAt).getTime()
            : 0;
          break;
        case 'total_ganho':
          valA = a.total_ganho || 0;
          valB = b.total_ganho || 0;
          break;
        case 'total_depositado':
          valA = a.total_depositado || 0;
          valB = b.total_depositado || 0;
          break;
        case 'total_apostado':
          valA = a.total_apostado || 0;
          valB = b.total_apostado || 0;
          break;
        case 'total_depositos_count':
          valA = a.total_depositos_count || 0;
          valB = b.total_depositos_count || 0;
          break;
        case 'stars':
          valA = a.stars ?? a.aposta_estrelas ?? 0;
          valB = b.stars ?? b.aposta_estrelas ?? 0;
          break;
        case 'interactions':
          valA = a.interactions ?? 0;
          valB = b.interactions ?? 0;
          break;
        case 'name':
          valA = (a.name || '').toLowerCase().trim();
          valB = (b.name || '').toLowerCase().trim();
          isStringSort = true;
          break;
        case 'total_afiliate':
          valA = a.total_afiliate ?? 0;
          valB = b.total_afiliate ?? 0;
          break;
        default:
          return 0;
      }

      if (isStringSort) {
        const cmp = String(valA).localeCompare(String(valB));
        return sortConfig.direction === 'asc' ? cmp : -cmp;
      }

      const numA = Number(valA);
      const numB = Number(valB);
      if (sortConfig.direction === 'asc') {
        return numA - numB;
      }
      return numB - numA;
    });

    return sorted;
  };

  // Aplica filtros locais e monta colunas/métricas (sem chamar API)
  const { columns, metrics: derivedMetrics } = useMemo(() => {
    let formattedLeads: Lead[] = [...rawLeads];

    // Filtro de Afiliado
    if (filters.affiliate) {
      const affiliateValue = typeof filters.affiliate === 'object' ? filters.affiliate.value : filters.affiliate;
      if (affiliateValue === 'yes') {
        formattedLeads = formattedLeads.filter(l => l.is_affiliate === true);
      } else if (affiliateValue === 'no') {
        formattedLeads = formattedLeads.filter(l => !l.is_affiliate);
      }
    }

    // Filtro de Score/Estrelas
    if (filters.stars) {
      const starsValue = typeof filters.stars === 'object' ? filters.stars.value : filters.stars;
      formattedLeads = formattedLeads.filter(l => l.stars === parseInt(starsValue));
    }

    // Filtro de Valor
    if (filters.value) {
      const valueFilter = typeof filters.value === 'object' ? filters.value.value : filters.value;
      formattedLeads = formattedLeads.filter(l => {
        const val = l.total_depositado || 0;
        if (typeof valueFilter === 'object' && valueFilter.type === 'custom') {
          const min = valueFilter.min !== null && valueFilter.min !== undefined ? parseFloat(valueFilter.min) : null;
          const max = valueFilter.max !== null && valueFilter.max !== undefined ? parseFloat(valueFilter.max) : null;
          if (min !== null && max !== null) return val >= min && val <= max;
          if (min !== null) return val >= min;
          if (max !== null) return val <= max;
          return true;
        }
        if (valueFilter === 'none') return val === 0;
        if (valueFilter === 'low') return val > 0 && val < 10;
        if (valueFilter === 'medium') return val >= 10 && val < 100;
        if (valueFilter === 'high') return val >= 100 && val < 500;
        if (valueFilter === 'high_premium') return val >= 500 && val < 1000;
        if (valueFilter === 'ultra') return val >= 1000;
        return true;
      });
    }

    // Filtro de Valor para próxima estrela
    if (filters.valueNextStar) {
      const nextStarFilter = typeof filters.valueNextStar === 'object' ? filters.valueNextStar.value : filters.valueNextStar;
      formattedLeads = formattedLeads.filter(l => {
        const missing = getMissingForNextStar(l.aposta_estrelas ?? 0);
        if (nextStarFilter === 'none') return missing === null;
        if (missing === null) return false;
        if (typeof nextStarFilter === 'object' && nextStarFilter.type === 'custom') {
          const min = nextStarFilter.min != null ? parseFloat(String(nextStarFilter.min)) : null;
          const max = nextStarFilter.max != null ? parseFloat(String(nextStarFilter.max)) : null;
          if (min !== null && max !== null) return missing >= min && missing <= max;
          if (min !== null) return missing >= min;
          if (max !== null) return missing <= max;
          return true;
        }
        if (nextStarFilter === 'low') return missing > 0 && missing < 50;
        if (nextStarFilter === 'medium') return missing >= 50 && missing < 200;
        if (nextStarFilter === 'high') return missing >= 200 && missing < 500;
        if (nextStarFilter === 'ultra') return missing >= 500;
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
        formattedLeads = formattedLeads.filter(l => {
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
      const tempFilter = typeof filters.temperature === 'object' ? filters.temperature.value : filters.temperature;
      if (tempFilter) {
        formattedLeads = formattedLeads.filter(l =>
          (l.temperature || '').toLowerCase() === tempFilter.toLowerCase()
        );
      }
    }

    // Filtro de Classificação
    if (filters.classification) {
      const classFilter = typeof filters.classification === 'object' ? filters.classification.value : filters.classification;
      if (classFilter) {
        formattedLeads = formattedLeads.filter(l => {
          const isHighValue = (l.total_depositado || 0) >= 100;
          const isVIP = (l.total_depositos_count || 0) >= 3;
          const isOpportunity = (l.total_depositos_count || 0) === 2;
          const isAlert = l.status === 'deposito_sem_aposta' || l.status === 'deposito_sem_jogo';
          if (classFilter === 'high_value') return isHighValue;
          if (classFilter === 'vip') return isVIP;
          if (classFilter === 'oportunidade') return isOpportunity;
          if (classFilter === 'alerta') return isAlert;
          return false;
        });
      }
    }

    // Filtro de Tags
    if (filters.tags) {
      const tagId = typeof filters.tags === 'object' ? filters.tags.value : filters.tags;
      if (tagId) {
        formattedLeads = formattedLeads.filter(l =>
          (l.tags || []).some((t: { id: string }) => t.id === tagId)
        );
      }
    }

    // Filtro de Busca
    if (searchTerm) {
      const searchLower = searchTerm.toLowerCase();
      formattedLeads = formattedLeads.filter(l =>
        l.name.toLowerCase().includes(searchLower) ||
        l.email.toLowerCase().includes(searchLower) ||
        l.phone.includes(searchTerm)
      );
    }

    formattedLeads.sort((a, b) => (b.total_ganho || 0) - (a.total_ganho || 0));

    const totalLeads = formattedLeads.length;
    const totalDeposited = formattedLeads.reduce((sum, l) => sum + (l.total_depositado || 0), 0);
    const activeLeads = formattedLeads.filter(l =>
      l.status === 'ativo' || (l.total_depositos_count || 0) >= 2
    ).length;
    const conversionRate = totalLeads > 0 ? (activeLeads / totalLeads) * 100 : 0;

    // Colunas com totalLeads = total que se encaixa no filtro; leads exibidos limitados a 100 (ou leadsPerColumn)
    const baseColumns: Column[] = [
      (() => {
        const filtered = formattedLeads.filter(l => (l.total_depositos_count || 0) === 0 && l.status !== 'ativo' && !(l.has_interaction === true));
        return { id: 'novo', title: '👥 Clientes cadastrados', color: 'gray', leads: filtered, totalLeads: filtered.length };
      })(),
      (() => {
        const filtered = formattedLeads.filter(l => l.has_interaction === true && (l.total_depositos_count || 0) === 0).sort((a, b) => { const tA = a.lastInteractionAt ? new Date(a.lastInteractionAt).getTime() : (a.last_interaction ? new Date(a.last_interaction).getTime() : 0); const tB = b.lastInteractionAt ? new Date(b.lastInteractionAt).getTime() : (b.last_interaction ? new Date(b.last_interaction).getTime() : 0); return tA - tB; });
        return { id: 'contactados', title: '📞 Clientes Contactados', color: 'blue', leads: filtered, totalLeads: filtered.length };
      })(),
      (() => {
        const filtered = formattedLeads.filter(l => (l.total_depositado || 0) > (l.total_apostado || 0) || (l.balance ?? 0) > 0);
        return { id: 'deposito_sem_aposta', title: '💰 Com Saldo Disponível', color: 'red', leads: filtered, totalLeads: filtered.length };
      })(),
      (() => {
        const filtered = formattedLeads.filter(l => (l.total_depositos_count || 0) === 1 && (l.total_depositado || 0) <= (l.total_apostado || 0));
        return { id: 'deposito_1x', title: '💰 1º Depósito', color: 'emerald', leads: filtered, totalLeads: filtered.length };
      })(),
      (() => {
        const filtered = formattedLeads.filter(l => (l.total_depositos_count || 0) === 2 && (l.total_depositado || 0) <= (l.total_apostado || 0));
        return { id: 'deposito_2x', title: '🔥 2º Depósito', color: 'orange', leads: filtered, totalLeads: filtered.length };
      })(),
      (() => {
        const filtered = formattedLeads.filter(l => { const c = l.total_depositos_count || 0; return c >= 3 && c < 5 && (l.total_depositado || 0) <= (l.total_apostado || 0); });
        return { id: 'deposito_3x', title: '💎 DEPOSITOU 3X', color: 'indigo', leads: filtered, totalLeads: filtered.length };
      })(),
      (() => {
        const filtered = formattedLeads.filter(l => { const c = l.total_depositos_count || 0; return c >= 5 && c < 10 && (l.total_depositado || 0) <= (l.total_apostado || 0); });
        return { id: 'deposito_5x', title: '⭐ DEPOSITOU 5X', color: 'amber', leads: filtered, totalLeads: filtered.length };
      })(),
      (() => {
        const filtered = formattedLeads.filter(l => (l.total_depositos_count || 0) >= 10 && (l.total_depositado || 0) <= (l.total_apostado || 0));
        return { id: 'deposito_10x', title: '👑 DEPOSITOU 10X+', color: 'rose', leads: filtered, totalLeads: filtered.length };
      })(),
      (() => {
        const filtered = formattedLeads.filter(l => l.status === 'ativo');
        return { id: 'ativo', title: '✅ CLIENTE ATIVO', color: 'purple', leads: filtered, totalLeads: filtered.length };
      })()
    ];

    // Aplica ordenação e limita leads exibidos (padrão 100); contador mostra exibidos/total (ex: 100/700)
    const sortedColumns = baseColumns.map(col => {
      const sortedLeads = applySortToLeads(col.leads, col.id);
      const currentLimit = leadsPerColumn[col.id] ?? 100;
      return {
        ...col,
        leads: sortedLeads.slice(0, currentLimit),
        totalLeads: col.totalLeads ?? sortedLeads.length
      };
    });

    return {
      columns: sortedColumns,
      metrics: {
        total_leads: totalLeads,
        total_deposited: totalDeposited,
        active_leads: activeLeads,
        conversion_rate: conversionRate
      }
    };
  }, [rawLeads, filters, searchTerm, leadsPerColumn, columnSorts]);

  // Usa métricas derivadas (ou null durante loading inicial)
  const metrics = loading && rawLeads.length === 0 ? null : derivedMetrics;

  const onDragStart = (e: React.DragEvent, leadId: string | number) => {
    e.dataTransfer.setData('leadId', leadId.toString());
  };

  const handleStarsChange = (leadId: string | number, newStars: number) => {
    setRawLeads(prev =>
      prev.map(l => (l.id === leadId ? { ...l, stars: newStars } : l))
    );
    console.log(`Lead ${leadId} atualizado para ${newStars} estrelas`);
  };

  const handleTagAdded = (leadId: string | number, addedTag: { id: string; label: string; color: string }) => {
    setRawLeads(prev =>
      prev.map(l => (l.id === leadId ? { ...l, tags: [...(l.tags || []), addedTag] } : l))
    );
  };

  const handleTagRemoved = (leadId: string | number, tagId: string) => {
    setRawLeads(prev =>
      prev.map(l => (l.id === leadId ? { ...l, tags: (l.tags || []).filter(t => t.id !== tagId) } : l))
    );
  };

  const onDrop = (e: React.DragEvent, newStatus: string) => {
    e.preventDefault();
    const leadId = e.dataTransfer.getData('leadId');
    setRawLeads(prev =>
      prev.map(l =>
        l.id.toString() === leadId ? { ...l, status: newStatus as Lead['status'] } : l
      )
    );
    console.log(`Lead ${leadId} movido para ${newStatus}`);
  };

  const handleFilterChange = (type: string, value: any) => {
    // Reseta o limite de leads por coluna quando muda qualquer filtro
    setLeadsPerColumn({});
    
    if (type === 'clear') {
      // Ao limpar, mantém o filtro de data padrão (Diário)
      const today = new Date().toISOString().split('T')[0];
      setFilters({
        date: {
          value: 'diario',
          label: 'Diário'
        }
      });
    } else if (type === 'date' && value === null) {
      // Se remover apenas o filtro de data, volta para o padrão
      setFilters(prev => ({
        ...prev,
        date: {
          value: 'diario',
          label: 'Diário'
        }
      }));
    } else {
      setFilters(prev => ({ ...prev, [type]: value }));
    }
  };

  // Full-page spinner apenas durante checagem de auth; depois a página carrega com filtro de bancas em load até as bancas virem
  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white rounded-xl shadow-lg p-6 border border-gray-200 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#8CD955] mx-auto mb-4"></div>
          <p className="text-gray-700 font-medium">Carregando CRM...</p>
        </div>
      </div>
    );
  }

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
  };

  return (
    <Layout onSignOut={handleSignOut}>
      <div className="h-[calc(100vh-30px)] lg:h-[calc(100vh--255px)] flex flex-col overflow-scroll lg:overflow-hidden max-w-full">
        {/* Header Section */}
        <div className="flex-none pb-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
            <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-emerald-100 rounded-xl hidden xs:block">
                <KanbanIcon className="w-5 h-5 md:w-6 md:h-6 text-[#8CD955]" />
              </div>
              <div>
                <h1 className="text-xl md:text-2xl font-bold text-gray-800 leading-tight">
                  {consultorInfo ? `CRM: ${consultorInfo.name}` : 'Meu Pipeline'}
                </h1>
                <p className="text-[11px] md:text-sm text-gray-500 font-medium line-clamp-1">
                  {consultorInfo ? `Leads de ${consultorInfo.email}` : 'Gerencie seus leads e maximize conversões'}
                </p>
              </div>
            </div>
            {viewers.length > 0 && (
              <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg">
                <Eye className="w-4 h-4 text-amber-600 flex-shrink-0" />
                <p className="text-xs font-medium text-amber-800">
                  {viewers.length === 1
                    ? `${viewers[0].name} está visualizando seu CRM`
                    : `${viewers.map(v => v.name).join(', ')} estão visualizando seu CRM`}
                </p>
              </div>
            )}
          </div>
            
            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1 md:pb-0">
              {consultorInfo && (
                <button
                  onClick={() => setShowStatusModal(true)}
                  className="whitespace-nowrap px-2.5 py-1.5 bg-amber-50 border border-amber-100 text-amber-700 rounded-lg text-[10px] font-bold flex items-center gap-1.5 flex-shrink-0 hover:bg-amber-100 transition-colors cursor-pointer"
                >
                  <Eye className="w-3 h-3" />
                  <span className="hidden xs:inline">Visualização</span>
                </button>
              )}
              <button 
                onClick={() => setShowStatusModal(true)}
                className="whitespace-nowrap flex items-center gap-2 bg-[#8CD955] text-white px-3 py-2 rounded-xl text-[11px] md:text-sm font-bold hover:bg-[#7BC84A] transition-all shadow-md shadow-gray-100 flex-shrink-0"
                title="Ver informações sobre status de temperatura dos leads"
              >
                <Eye className="w-3.5 h-3.5" />
                <span>Informações <span className="hidden xs:inline">de Status</span></span>
              </button>
            </div>
          </div>

          {/* Quick Metrics Header - Sempre mostra os cards; overlay quando leads estão carregando */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6 animate-in fade-in slide-in-from-top-2 duration-500 relative">
            {/* Overlay nas caixas de cima quando requisição de leads está em andamento (inicial ou ao mudar filtro) */}
            {(loading || filterLoading) && (
              <div className="absolute inset-0 bg-white/60 backdrop-blur-[2px] rounded-xl z-10 flex items-center justify-center">
                <div className="flex items-center gap-2 text-[#8CD955]">
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span className="text-xs font-semibold">Carregando...</span>
                </div>
              </div>
            )}
            <div className="bg-white p-3 rounded-xl border border-gray-100 shadow-sm">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Total Leads</p>
              <p className="text-lg font-bold text-gray-800">{metrics?.total_leads || 0}</p>
            </div>
            <div className="bg-white p-3 rounded-xl border border-gray-100 shadow-sm">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Total Depositado</p>
              <p className="text-lg font-bold text-[#8CD955]">{formatCurrency(metrics?.total_deposited || 0)}</p>
            </div>
            <div className="bg-white p-3 rounded-xl border border-gray-100 shadow-sm">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Clientes Ativos</p>
              <p className="text-lg font-bold text-purple-600">{metrics?.active_leads || 0}</p>
            </div>
            <div className="bg-white p-3 rounded-xl border border-gray-100 shadow-sm">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Conversão</p>
              <p className="text-lg font-bold text-blue-600">{(metrics?.conversion_rate || 0).toFixed(1)}%</p>
            </div>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-100 text-red-600 rounded-xl flex items-center gap-2 text-sm animate-in fade-in slide-in-from-top-1">
              <AlertCircle className="w-4 h-4" /> {error}
            </div>
          )}

          {/* Mensagem quando não há leads para o dia atual */}
          {!loading && !filterLoading && !error && columns.every(col => col.leads.length === 0) && filters.date && (
            <div className="mb-4 p-4 bg-blue-50 border border-blue-100 text-blue-700 rounded-xl flex items-center gap-3 text-sm animate-in fade-in slide-in-from-top-1">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <div>
                <p className="font-semibold">Nenhum cadastro encontrado</p>
                <p className="text-xs text-blue-600 mt-1">
                  {filters.date.value === 'diario' 
                    ? 'Não há leads cadastrados hoje (data de São Paulo).'
                    : 'Não há leads cadastrados no período selecionado.'}
                </p>
              </div>
            </div>
          )}

          {/* Filters - Container com z-index alto e sem overflow-x para não cortar dropdowns */}
          <div className="relative z-30">
            <FilterBar
              onSearch={handleSearch}
              onFilterChange={handleFilterChange}
              initialDateFilter={filters.date}
              onBancasLoaded={handleBancasLoaded}
            />
          </div>
        </div>

        {/* Kanban Board Area */}
        <div className="flex-1 overflow-x-auto overflow-y-hidden pb-4 custom-scrollbar -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 snap-x snap-mandatory relative min-h-[500px]">
          {/* Overlay nas colunas quando requisição de leads está em andamento (inicial ou ao mudar filtro) */}
          {(loading || filterLoading) && (
            <div className="absolute inset-0 bg-white/50 backdrop-blur-[1px] rounded-xl z-20 flex items-center justify-center">
              <div className="flex flex-col items-center gap-2 text-[#8CD955]">
                <RefreshCw className="w-5 h-5 animate-spin" />
                <span className="text-xs font-semibold">Carregando leads...</span>
              </div>
            </div>
          )}
          <div className="flex gap-4 md:gap-6 items-stretch h-full min-h-[500px]">
            {columns.map(column => (
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
                  targetUserId={targetUserId || undefined}
                  onTagAdded={handleTagAdded}
                  onTagRemoved={handleTagRemoved}
                  onRefresh={() => loadLeads(false)}
                  selectedBancaUrl={filters.banca ? (typeof filters.banca === 'object' ? filters.banca.value : filters.banca) : undefined}
                  onOpenSortModal={handleOpenSortModal}
                  totalLeads={column.totalLeads}
                  onLoadMore={handleLoadMore}
                  isLoadingMore={false}
                />
              </div>
            ))}
            {/* Espaçador final maior no mobile para dar respiro */}
            <div className="w-6 md:w-2 flex-shrink-0 snap-center" />
          </div>
        </div>
      </div>

      <button className="lg:hidden fixed bottom-20 right-6 w-12 h-12 bg-[#8CD955] text-white rounded-full shadow-2xl flex items-center justify-center z-50 animate-bounce-subtle">
        <MessageSquare className="w-5 h-5 fill-current" />
      </button>

      {/* Modal de Ordenação */}
      {sortingColumnId && (
        <SortColumnModal
          isOpen={sortModalOpen}
          onClose={handleCloseSortModal}
          columnTitle={columns.find(c => c.id === sortingColumnId)?.title || ''}
          sortField={sortField}
          sortDirection={sortDirection}
          onSortChange={(field, direction) => {
            setSortField(field);
            setSortDirection(direction);
          }}
          onApply={handleApplySort}
        />
      )}

      {/* Modal Informativo de Status de Leads */}
      {showStatusModal && (
          <div 
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setShowStatusModal(false)}
          >
            <div 
              className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header do Modal */}
              <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between rounded-t-2xl">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-amber-100 rounded-lg">
                    <Eye className="w-5 h-5 text-amber-600" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-gray-800">Status de Temperatura dos Leads</h2>
                    <p className="text-sm text-gray-500">Entenda cada classificação de lead no sistema</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowStatusModal(false)}
                  className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5 text-gray-500" />
                </button>
              </div>

              {/* Conteúdo do Modal */}
              <div className="p-6 space-y-4">
                {/* Cold */}
                <div className="bg-blue-50 border-2 border-blue-200 rounded-xl p-5 hover:shadow-md transition-shadow">
                  <div className="flex items-start gap-4">
                    <div className="p-3 bg-blue-100 rounded-lg shrink-0">
                      <span className="text-2xl">🧊</span>
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <h3 className="text-lg font-bold text-blue-800">Frio (Cold)</h3>
                        <span className="px-2 py-0.5 bg-blue-200 text-blue-800 text-xs font-bold rounded">cold</span>
                      </div>
                      <p className="text-gray-700 leading-relaxed">
                        Lead cadastrado há <strong>30 dias ou menos</strong> e que <strong>nunca realizou um depósito</strong>. 
                        Este é um lead novo que ainda não demonstrou interesse financeiro no produto ou serviço.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Very Cold */}
                <div className="bg-indigo-50 border-2 border-indigo-200 rounded-xl p-5 hover:shadow-md transition-shadow">
                  <div className="flex items-start gap-4">
                    <div className="p-3 bg-indigo-100 rounded-lg shrink-0">
                      <span className="text-2xl">❄️</span>
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <h3 className="text-lg font-bold text-indigo-800">Muito Frio (Very Cold)</h3>
                        <span className="px-2 py-0.5 bg-indigo-200 text-indigo-800 text-xs font-bold rounded">very_cold</span>
                      </div>
                      <p className="text-gray-700 leading-relaxed">
                        Lead cadastrado há <strong>mais de 30 dias</strong> e que <strong>nunca realizou um depósito</strong>. 
                        Este lead está há bastante tempo no sistema sem demonstrar interesse em investir, 
                        necessitando de uma abordagem mais direcionada para reativá-lo.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Active */}
                <div className="bg-green-50 border-2 border-green-200 rounded-xl p-5 hover:shadow-md transition-shadow">
                  <div className="flex items-start gap-4">
                    <div className="p-3 bg-green-100 rounded-lg shrink-0">
                      <span className="text-2xl">🔥</span>
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <h3 className="text-lg font-bold text-green-800">Ativo (Active)</h3>
                        <span className="px-2 py-0.5 bg-green-200 text-green-800 text-xs font-bold rounded">active</span>
                      </div>
                      <p className="text-gray-700 leading-relaxed">
                        Lead que <strong>já realizou depósitos</strong>, possui <strong>menos de 3 depósitos</strong> no total, 
                        e o <strong>último depósito foi há 30 dias ou menos</strong>. Este lead demonstra interesse ativo 
                        e está engajado recentemente com o produto.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Hot */}
                <div className="bg-red-50 border-2 border-red-200 rounded-xl p-5 hover:shadow-md transition-shadow">
                  <div className="flex items-start gap-4">
                    <div className="p-3 bg-red-100 rounded-lg shrink-0">
                      <span className="text-2xl">🌶️</span>
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <h3 className="text-lg font-bold text-red-800">Quente (Hot)</h3>
                        <span className="px-2 py-0.5 bg-red-200 text-red-800 text-xs font-bold rounded">hot</span>
                      </div>
                      <p className="text-gray-700 leading-relaxed">
                        Lead que possui <strong>3 ou mais depósitos</strong> realizados. Este é um lead de alto valor 
                        que demonstrou comprometimento consistente com o produto, sendo considerado um cliente 
                        recorrente e valioso.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Cooling */}
                <div className="bg-orange-50 border-2 border-orange-200 rounded-xl p-5 hover:shadow-md transition-shadow">
                  <div className="flex items-start gap-4">
                    <div className="p-3 bg-orange-100 rounded-lg shrink-0">
                      <span className="text-2xl">🌡️</span>
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <h3 className="text-lg font-bold text-orange-800">Esfriando (Cooling)</h3>
                        <span className="px-2 py-0.5 bg-orange-200 text-orange-800 text-xs font-bold rounded">cooling</span>
                      </div>
                      <p className="text-gray-700 leading-relaxed">
                        Lead que <strong>já realizou depósitos</strong>, mas o <strong>último depósito foi há mais de 30 dias</strong>. 
                        Este lead estava ativo anteriormente, mas está perdendo engajamento. Requer atenção para 
                        reativar o interesse e evitar que se torne inativo.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Divisor */}
                <div className="my-6 border-t border-gray-200"></div>

                {/* Seção de Classificações de Leads */}
                <div className="mb-4">
                  <h3 className="text-lg font-bold text-gray-800 mb-4">Classificações Visuais dos Leads</h3>
                  <p className="text-sm text-gray-600 mb-4">
                    Os leads também são classificados visualmente no sistema com cores e ícones especiais:
                  </p>
                </div>

                {/* Alto Valor */}
                <div className="bg-amber-50 border-2 border-amber-200 rounded-xl p-5 hover:shadow-md transition-shadow">
                  <div className="flex items-start gap-4">
                    <div className="p-3 bg-amber-100 rounded-lg shrink-0">
                      <span className="text-2xl">💰</span>
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <h3 className="text-lg font-bold text-amber-800">Alto Valor (High Value)</h3>
                        <span className="px-2 py-0.5 bg-amber-200 text-amber-800 text-xs font-bold rounded">Borda Amarela</span>
                      </div>
                      <p className="text-gray-700 leading-relaxed">
                        Lead que possui <strong>total depositado de R$ 100 ou mais</strong>. Este lead demonstra 
                        capacidade financeira significativa e é considerado um cliente de alto valor para o negócio.
                      </p>
                    </div>
                  </div>
                </div>

                {/* VIP */}
                <div className="bg-indigo-50 border-2 border-indigo-200 rounded-xl p-5 hover:shadow-md transition-shadow">
                  <div className="flex items-start gap-4">
                    <div className="p-3 bg-indigo-100 rounded-lg shrink-0">
                      <span className="text-2xl">💎</span>
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <h3 className="text-lg font-bold text-indigo-800">VIP</h3>
                        <span className="px-2 py-0.5 bg-indigo-200 text-indigo-800 text-xs font-bold rounded">Borda Roxa</span>
                      </div>
                      <p className="text-gray-700 leading-relaxed">
                        Lead que possui <strong>3 ou mais depósitos</strong> realizados. Este é um cliente recorrente 
                        e fiel, demonstrando alto engajamento e valor para o negócio. Recebe tratamento especial no sistema.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Oportunidade */}
                <div className="bg-orange-50 border-2 border-orange-200 rounded-xl p-5 hover:shadow-md transition-shadow">
                  <div className="flex items-start gap-4">
                    <div className="p-3 bg-orange-100 rounded-lg shrink-0">
                      <span className="text-2xl">🎯</span>
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <h3 className="text-lg font-bold text-orange-800">Oportunidade</h3>
                        <span className="px-2 py-0.5 bg-orange-200 text-orange-800 text-xs font-bold rounded">Borda Laranja</span>
                      </div>
                      <p className="text-gray-700 leading-relaxed">
                        Lead que possui <strong>exatamente 2 depósitos</strong> realizados. Este lead está em um momento 
                        crucial de conversão, mostrando interesse crescente. Requer atenção especial para convertê-lo em 
                        um cliente recorrente (VIP).
                      </p>
                    </div>
                  </div>
                </div>

                {/* Alerta */}
                <div className="bg-red-50 border-2 border-red-200 rounded-xl p-5 hover:shadow-md transition-shadow">
                  <div className="flex items-start gap-4">
                    <div className="p-3 bg-red-100 rounded-lg shrink-0">
                      <span className="text-2xl">⚠️</span>
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <h3 className="text-lg font-bold text-red-800">Alerta</h3>
                        <span className="px-2 py-0.5 bg-red-200 text-red-800 text-xs font-bold rounded">Borda Vermelha</span>
                      </div>
                      <p className="text-gray-700 leading-relaxed">
                        Lead com status <strong>"Depósito sem aposta"</strong> ou <strong>"Depósito sem jogo"</strong>. 
                        Este lead depositou dinheiro mas não utilizou o valor para apostar ou jogar. Requer ação imediata 
                        para reativar o engajamento e evitar churn.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Footer do Modal */}
              <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 rounded-b-2xl">
                <button
                  onClick={() => setShowStatusModal(false)}
                  className="w-full py-3 bg-[#8CD955] hover:bg-[#7BC84A] text-white font-bold rounded-xl transition-colors shadow-md"
                >
                  Entendi
                </button>
              </div>
            </div>
          </div>
        )}
    </Layout>
  );
};

const KanbanPage = () => {
  return (
    <Suspense fallback={<div>Carregando...</div>}>
      <KanbanContent />
    </Suspense>
  );
};

export default KanbanPage;
