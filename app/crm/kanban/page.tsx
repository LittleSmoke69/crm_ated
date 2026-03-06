'use client';

import React, { useState, useEffect, useRef, useMemo, useCallback, Suspense } from 'react';
import Layout from '@/components/Layout';
import { useRequireAuth } from '@/utils/useRequireAuth';
import { Kanban as KanbanIcon, Plus, Users, Target, CheckCircle2, MessageSquare, AlertCircle, Eye, RefreshCw, X, Gift, Loader2, Search } from 'lucide-react';
import FilterBar from '@/components/CRM/FilterBar';
import KanbanColumn from '@/components/CRM/KanbanColumn';
import SortColumnModal from '@/components/CRM/SortColumnModal';
import { Lead, Column, ThermalStatus } from '@/components/CRM/types';
import { useSearchParams } from 'next/navigation';
import { useToast } from '@/hooks/useToast';
import ToastContainer from '@/components/Toast/ToastContainer';

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
      id: 'saque_disponivel', 
      title: '💸 Saque Disponível', 
      color: 'teal', 
      leads: leads.filter(l => (parseFloat(String(l.available_withdraw ?? 0)) || 0) > 0).slice(0, 100),
      totalLeads: leads.filter(l => (parseFloat(String(l.available_withdraw ?? 0)) || 0) > 0).length
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
  const { toasts, showToast, removeToast } = useToast();

  const [rawLeads, setRawLeads] = useState<Lead[]>([]); // Leads da API (banca+período) - filtros aplicados localmente
  const [loading, setLoading] = useState(false); // true apenas quando a requisição de leads estiver em andamento
  const [filterLoading, setFilterLoading] = useState(false); // Loading ao mudar banca/período
  const [backgroundLoading, setBackgroundLoading] = useState(false); // true quando o resto dos leads está carregando em segundo plano
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filters, setFilters] = useState<Record<string, any>>(() => {
    // Predefinido como todo o período: ao entrar no CRM já busca todas as bancas + todo o período
    return {
      date: {
        value: 'todos',
        label: 'Todo o Período'
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
  // Modal Enviar Giros (Roleta)
  const [showSpinModal, setShowSpinModal] = useState(false);
  const [spinSelectedLeadIds, setSpinSelectedLeadIds] = useState<Set<string>>(new Set());
  const [spinSearchTerm, setSpinSearchTerm] = useState('');
  const [spinQuantity, setSpinQuantity] = useState<number>(5);
  const [spinHistory, setSpinHistory] = useState<{ quantity: number; date: string }[]>([]);
  const [spinHistoryLoading, setSpinHistoryLoading] = useState(false);
  const [spinSending, setSpinSending] = useState(false);
  const [spinError, setSpinError] = useState<string | null>(null);

  const isInitialLoadRef = useRef<boolean>(true);
  /** Cancela o carregamento em background quando uma nova busca é iniciada (ex.: mudança de filtro). */
  const loadIdRef = useRef(0);

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

  /** Converte um lote da API para o formato Lead do Kanban. */
  const formatApiLeadsToLead = useCallback((leads: any[]): Lead[] => {
    return (leads || []).map(l => {
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
        available_withdraw: l.available_withdraw != null ? Math.round((parseFloat(String(l.available_withdraw)) || 0) * 100) / 100 : undefined,
        bonus: l.bonus ? parseFloat(l.bonus) : 0,
        convert: l.convert ? parseFloat(l.convert) : 0,
        total_afiliate: l.total_afiliate ? parseFloat(l.total_afiliate) : 0,
        aposta_estrelas: l.aposta_estrelas ? parseInt(l.aposta_estrelas.toString()) || 0 : 0,
        banca_id: l.banca_id,
        banca_name: l.banca_name,
        banca_url: l.banca_url,
        consultant_id: l.consultant_id != null ? Number(l.consultant_id) : undefined,
      };
    });
  }, []);

  const loadLeads = useCallback(async (isFilterChange = false) => {
    loadIdRef.current += 1;
    const thisLoadId = loadIdRef.current;

    const buildBaseUrl = () => {
      const url = new URL('/api/crm/leads', window.location.origin);
      if (targetUserId) url.searchParams.append('userId', targetUserId);
      const bancaValue = filters.banca ? (typeof filters.banca === 'object' ? filters.banca.value : filters.banca) : null;
      if (bancaValue && bancaValue !== 'all') {
        url.searchParams.append('banca_url', bancaValue);
      } else if (exclusiveBancasList.length > 0) {
        url.searchParams.append('banca_urls', exclusiveBancasList.map(b => b.url).join(','));
      }
      const dateValue = filters.date ? (typeof filters.date === 'object' ? filters.date.value : filters.date) : 'todos';
      const nowSP = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
      const today = nowSP.toISOString().split('T')[0];
      if (dateValue === 'todos') {
        // Todo o período: não envia from/to; a API retorna todos os leads
      } else if (dateValue === 'diario') {
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
      return url;
    };

    try {
      if (isFilterChange) {
        setFilterLoading(true);
      } else {
        setLoading(true);
      }
      setError(null);
      setBackgroundLoading(false);

      const baseUrl = buildBaseUrl();
      baseUrl.searchParams.append('only_responded', '1');

      const response = await fetch(baseUrl.toString(), {
        headers: { 'X-User-Id': userId as string }
      });
      const result = await response.json();

      if (thisLoadId !== loadIdRef.current) return;

      if (result.success) {
        const leads: any[] = result.data || [];
        const formattedLeads = formatApiLeadsToLead(leads);
        console.log('[Kanban] Primeira carga (já respondidos):', formattedLeads.length, 'leads');
        setRawLeads(formattedLeads);

        if (targetUserId && targetUserId !== userId) {
          const profileRes = await fetch(`/api/admin/users/${targetUserId}`, {
            headers: { 'X-User-Id': userId as string }
          });
          const profileResult = await profileRes.json();
          if (thisLoadId === loadIdRef.current && profileResult.success && profileResult.data?.user) {
            setConsultorInfo({
              name: profileResult.data.user.full_name || 'Consultor',
              email: profileResult.data.user.email
            });
          }
        } else {
          setConsultorInfo(null);
        }

        const next = result.meta?.next;
        if (next && typeof next.banca_index === 'number' && typeof next.page === 'number') {
          setBackgroundLoading(true);
          (async () => {
            let current: { banca_index: number; page: number } | null = { banca_index: next.banca_index, page: next.page };
            const headers = { 'X-User-Id': userId as string };
            while (current && thisLoadId === loadIdRef.current) {
              const chunkUrl = buildBaseUrl();
              chunkUrl.searchParams.set('banca_index', String(current.banca_index));
              chunkUrl.searchParams.set('page', String(current.page));
              try {
                const chunkRes = await fetch(chunkUrl.toString(), { headers });
                const chunkResult = await chunkRes.json();
                if (thisLoadId !== loadIdRef.current) break;
                if (chunkResult.success && Array.isArray(chunkResult.data)) {
                  const newLeads = formatApiLeadsToLead(chunkResult.data);
                  if (newLeads.length > 0) {
                    setRawLeads(prev => {
                      const byId = new Map(prev.map(l => [l.id, l]));
                      newLeads.forEach(l => byId.set(l.id, l));
                      return Array.from(byId.values());
                    });
                  }
                }
                current = chunkResult.meta?.next ?? null;
              } catch {
                if (thisLoadId === loadIdRef.current) current = null;
              }
            }
            if (thisLoadId === loadIdRef.current) {
              setBackgroundLoading(false);
              showToast('Todos os leads foram carregados.', 'success');
            }
          })();
        }
      } else {
        const errorMessage = result.error || 'Erro ao carregar leads';
        console.error('[Kanban] Erro ao carregar leads:', errorMessage, result);
        if (errorMessage.includes('404') || errorMessage.includes('No indicateds found') || errorMessage.includes('Nenhum lead')) {
          setError(null);
          setRawLeads([]);
        } else {
          setError(errorMessage);
        }
      }
    } catch (err) {
      console.error('[Kanban] Erro de conexão:', err);
      if (thisLoadId === loadIdRef.current) setError('Erro de conexão com o servidor');
    } finally {
      if (thisLoadId === loadIdRef.current) {
        setLoading(false);
        setFilterLoading(false);
      }
    }
  }, [userId, targetUserId, filters, exclusiveBancasList, formatApiLeadsToLead, showToast]);

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

  // Leads com banca (para listagem do modal)
  const spinEligibleLeads = useMemo(() => rawLeads.filter(l => l.banca_url), [rawLeads]);
  // Lista filtrada pela pesquisa (nome ou e-mail)
  const spinFilteredLeads = useMemo(() => {
    const term = spinSearchTerm.trim().toLowerCase();
    if (!term) return spinEligibleLeads;
    return spinEligibleLeads.filter(l =>
      (l.name || '').toLowerCase().includes(term) || (l.email || '').toLowerCase().includes(term)
    );
  }, [spinEligibleLeads, spinSearchTerm]);
  // Um único lead selecionado (para exibir histórico)
  const spinSelectedLead = useMemo(() => {
    if (spinSelectedLeadIds.size !== 1) return null;
    const id = Array.from(spinSelectedLeadIds)[0];
    return rawLeads.find(l => String(l.id) === String(id)) ?? null;
  }, [rawLeads, spinSelectedLeadIds]);

  /** Id do lead para APIs (mesmo critério do feedback): original_id ou sufixo numérico do id composto. */
  const getLeadIdForApi = useCallback((lead: Lead): string | number => {
    if (lead.original_id != null) return typeof lead.original_id === 'number' ? lead.original_id : String(lead.original_id);
    if (typeof lead.id === 'string' && lead.id.includes('-')) return lead.id.split('-').pop() ?? lead.id;
    return lead.id;
  }, []);

  // Carregar histórico de giros ao selecionar lead; resolver consultant_id se necessário
  const [resolvedConsultantId, setResolvedConsultantId] = useState<number | null>(null);
  useEffect(() => {
    if (!showSpinModal || !spinSelectedLead) {
      setSpinHistory([]);
      setResolvedConsultantId(null);
      return;
    }
    const lead = spinSelectedLead;
    const bancaUrl = lead.banca_url;
    if (!bancaUrl) {
      setSpinHistory([]);
      setSpinError('Lead sem banca definida.');
      return;
    }
    setSpinError(null);
    let consultantId = lead.consultant_id != null ? Number(lead.consultant_id) : null;

    const fetchHistory = async (cid: number) => {
      setSpinHistoryLoading(true);
      try {
        const url = new URL('/api/crm/spin-transfer-history', window.location.origin);
        url.searchParams.set('consultant_id', String(cid));
        url.searchParams.set('lead_id', String(getLeadIdForApi(lead)));
        url.searchParams.set('banca_url', bancaUrl);
        url.searchParams.set('per_page', '15');
        url.searchParams.set('page', '1');
        if (targetUserId) url.searchParams.set('userId', targetUserId);
        const res = await fetch(url.toString(), { headers: { 'X-User-Id': userId as string } });
        const data = await res.json();
        const list = Array.isArray(data?.data?.data) ? data.data.data : (Array.isArray(data?.data) ? data.data : []);
        if (data?.success && list.length >= 0) {
          setSpinHistory(list.map((h: any) => ({
            quantity: h.quantity ?? h.spins_count ?? 0,
            date: h.created_at ?? h.sent_at ?? h.date ?? '',
          })));
        } else {
          setSpinHistory([]);
        }
      } catch {
        setSpinHistory([]);
      } finally {
        setSpinHistoryLoading(false);
      }
    };

    if (consultantId != null) {
      setResolvedConsultantId(consultantId);
      fetchHistory(consultantId);
      return;
    }
    // Buscar consultant_id na API
    const resolveAndFetch = async () => {
      try {
        const url = new URL('/api/crm/consultant-external-id', window.location.origin);
        url.searchParams.set('userId', targetUserId || (userId as string));
        url.searchParams.set('banca_url', bancaUrl);
        const res = await fetch(url.toString(), { headers: { 'X-User-Id': userId as string } });
        const data = await res.json();
        if (data?.success && data?.data?.consultant_id != null) {
          const cid = Number(data.data.consultant_id);
          setResolvedConsultantId(cid);
          await fetchHistory(cid);
        } else {
          setSpinError('Não foi possível obter o id do consultor para esta banca.');
          setSpinHistory([]);
        }
      } catch {
        setSpinError('Erro ao obter id do consultor.');
        setSpinHistory([]);
      } finally {
        setSpinHistoryLoading(false);
      }
    };
    setSpinHistoryLoading(true);
    setResolvedConsultantId(null);
    setSpinHistory([]);
    resolveAndFetch();
  }, [showSpinModal, spinSelectedLeadIds.size, spinSelectedLead, targetUserId, userId]);

  const handleSendSpins = useCallback(async () => {
    const selectedLeads = spinEligibleLeads.filter(l => spinSelectedLeadIds.has(String(l.id)));
    if (selectedLeads.length === 0 || spinQuantity < 1) return;
    setSpinSending(true);
    setSpinError(null);
    const consultantIdByBanca = new Map<string, number>();
    const getConsultantId = async (lead: Lead): Promise<number | null> => {
      const bancaUrl = lead.banca_url;
      if (!bancaUrl) return null;
      if (lead.consultant_id != null) return Number(lead.consultant_id);
      const cached = consultantIdByBanca.get(bancaUrl);
      if (cached != null) return cached;
      try {
        const url = new URL('/api/crm/consultant-external-id', window.location.origin);
        url.searchParams.set('userId', targetUserId || (userId as string));
        url.searchParams.set('banca_url', bancaUrl);
        const res = await fetch(url.toString(), { headers: { 'X-User-Id': userId as string } });
        const data = await res.json();
        if (data?.success && data?.data?.consultant_id != null) {
          const cid = Number(data.data.consultant_id);
          consultantIdByBanca.set(bancaUrl, cid);
          return cid;
        }
      } catch {
        // ignore
      }
      return null;
    };
    const successfulLeads: Lead[] = [];
    let err = 0;
    for (const lead of selectedLeads) {
      const bancaUrl = lead.banca_url;
      if (!bancaUrl) {
        err++;
        continue;
      }
      const consultantId = await getConsultantId(lead);
      if (consultantId == null) {
        err++;
        continue;
      }
      try {
        const res = await fetch('/api/crm/send-spins-to-lead', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-User-Id': userId as string },
          body: JSON.stringify({
            consultant_id: consultantId,
            lead_id: getLeadIdForApi(lead),
            quantity: Number(spinQuantity),
            banca_url: bancaUrl,
            userId: targetUserId || userId,
          }),
        });
        const data = await res.json();
        if (data?.success) successfulLeads.push(lead);
        else err++;
      } catch {
        err++;
      }
    }
    const ok = successfulLeads.length;
    if (ok > 0) {
      showToast(
        err > 0
          ? `${spinQuantity} giro(s) enviados para ${ok} lead(s). ${err} falha(s).`
          : `${spinQuantity} giro(s) enviado(s) para ${ok} lead(s).`,
        'success'
      );
      if (selectedLeads.length === 1 && spinSelectedLead) {
        setSpinHistory(prev => [{ quantity: spinQuantity, date: new Date().toISOString() }, ...prev]);
      }
      // Aplicar etiqueta "Recebeu bonus de Giro" nos leads que receberam giros com sucesso
      try {
        const tagRes = await fetch('/api/crm/tags/ensure-giro-bonus', { headers: { 'X-User-Id': userId as string } });
        const tagData = await tagRes.json();
        if (tagData?.success && tagData?.data?.tagId) {
          const tagId = tagData.data.tagId;
          const targetUid = targetUserId || userId;
          for (const lead of successfulLeads) {
            try {
              await fetch('/api/crm/leads/tags', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-User-Id': userId as string },
                body: JSON.stringify({
                  leadId: String(lead.id),
                  tagId,
                  targetUserId: targetUid,
                }),
              });
            } catch {
              // ignora falha ao adicionar etiqueta por lead
            }
          }
        }
      } catch {
        // ignora se não conseguir obter/criar a etiqueta
      }
    }
    if (err > 0) {
      setSpinError(err === selectedLeads.length ? 'Falha ao enviar giros.' : `Falha para ${err} de ${selectedLeads.length} lead(s).`);
    }
    setSpinSending(false);
  }, [spinEligibleLeads, spinSelectedLeadIds, spinQuantity, spinSelectedLead, targetUserId, userId, showToast, getLeadIdForApi]);

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

    // Filtro de Tags (Com etiquetas / Sem etiquetas / etiqueta específica)
    if (filters.tags) {
      const tagValue = typeof filters.tags === 'object' ? filters.tags.value : filters.tags;
      if (tagValue === '__has_any') {
        formattedLeads = formattedLeads.filter(l => (l.tags || []).length > 0);
      } else if (tagValue === '__none') {
        formattedLeads = formattedLeads.filter(l => (l.tags || []).length === 0);
      } else if (tagValue) {
        formattedLeads = formattedLeads.filter(l =>
          (l.tags || []).some((t: { id: string }) => t.id === tagValue)
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
        const filtered = formattedLeads.filter(l => (parseFloat(String(l.available_withdraw ?? 0)) || 0) > 0);
        return { id: 'saque_disponivel', title: '💸 Saque Disponível', color: 'teal', leads: filtered, totalLeads: filtered.length };
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
      // Ao limpar, volta para o padrão da página (Todo o Período)
      setFilters({
        date: {
          value: 'todos',
          label: 'Todo o Período'
        }
      });
    } else if (type === 'date' && value === null) {
      // Se remover apenas o filtro de data, volta para o padrão
      setFilters(prev => ({
        ...prev,
        date: {
          value: 'todos',
          label: 'Todo o Período'
        }
      }));
    } else {
      setFilters(prev => ({ ...prev, [type]: value }));
    }
  };

  // Full-page spinner apenas durante checagem de auth; depois a página carrega com filtro de bancas em load até as bancas virem
  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-[#1a1a1a]">
        <div className="bg-white dark:bg-[#2a2a2a] rounded-xl shadow-lg p-6 border border-gray-200 dark:border-[#404040] text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#8CD955] mx-auto mb-4"></div>
          <p className="text-gray-700 dark:text-gray-200 font-medium">Carregando CRM...</p>
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
                <h1 className="text-xl md:text-2xl font-bold text-gray-800 dark:text-white leading-tight">
                  {consultorInfo ? `CRM: ${consultorInfo.name}` : 'Meu Pipeline'}
                </h1>
                <p className="text-[11px] md:text-sm text-gray-500 dark:text-gray-400 font-medium line-clamp-1">
                  {consultorInfo ? `Leads de ${consultorInfo.email}` : 'Gerencie seus leads e maximize conversões'}
                </p>
              </div>
            </div>
            {viewers.length > 0 && (
              <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/50 rounded-lg">
                <Eye className="w-4 h-4 text-amber-600 flex-shrink-0" />
                <p className="text-xs font-medium text-amber-800 dark:text-amber-200">
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
              <button
                onClick={() => setShowSpinModal(true)}
                disabled={loading || filterLoading}
                className="whitespace-nowrap flex items-center gap-2 bg-orange-500 hover:bg-orange-600 border border-orange-600 px-3 py-2 rounded-xl text-[11px] md:text-sm font-bold text-white shadow-sm flex-shrink-0 transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-orange-500 disabled:hover:border-orange-600"
                title={loading || filterLoading ? 'Aguarde o carregamento dos clientes' : 'Enviar giros (roleta) para leads'}
              >
                <Gift className="w-3.5 h-3.5" />
                <span>Enviar Giros <span className="hidden xs:inline">(Roleta)</span></span>
              </button>
            </div>
          </div>

          {/* Quick Metrics Header - Sempre mostra os cards; overlay quando leads estão carregando */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6 animate-in fade-in slide-in-from-top-2 duration-500 relative">
            {/* Overlay nas caixas de cima quando requisição de leads está em andamento (inicial ou ao mudar filtro) */}
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
              <p className="text-lg font-bold text-gray-800 dark:text-white">{metrics?.total_leads || 0}</p>
            </div>
            <div className="bg-white dark:bg-[#2a2a2a] p-3 rounded-xl border border-gray-100 dark:border-[#404040] shadow-sm">
              <p className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Total Depositado</p>
              <p className="text-lg font-bold text-[#8CD955]">{formatCurrency(metrics?.total_deposited || 0)}</p>
            </div>
            <div className="bg-white dark:bg-[#2a2a2a] p-3 rounded-xl border border-gray-100 dark:border-[#404040] shadow-sm">
              <p className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Clientes Ativos</p>
              <p className="text-lg font-bold text-purple-600 dark:text-purple-400">{metrics?.active_leads || 0}</p>
            </div>
            <div className="bg-white dark:bg-[#2a2a2a] p-3 rounded-xl border border-gray-100 dark:border-[#404040] shadow-sm">
              <p className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Conversão</p>
              <p className="text-lg font-bold text-blue-600 dark:text-blue-400">{(metrics?.conversion_rate || 0).toFixed(1)}%</p>
            </div>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-100 text-red-600 rounded-xl flex items-center gap-2 text-sm animate-in fade-in slide-in-from-top-1">
              <AlertCircle className="w-4 h-4" /> {error}
            </div>
          )}

          {backgroundLoading && (
            <div className="mb-4 py-3 px-4 bg-[#8CD955]/15 dark:bg-[#8CD955]/10 border-2 border-[#8CD955]/50 text-gray-800 dark:text-gray-200 rounded-xl flex items-center gap-3 text-sm font-medium animate-in fade-in shadow-sm">
              <RefreshCw className="w-5 h-5 animate-spin text-[#8CD955] flex-shrink-0" />
              <div>
                <p className="font-semibold">Carregando mais leads em segundo plano</p>
                <p className="text-xs text-gray-600 dark:text-gray-400 font-normal mt-0.5">Você já pode usar o quadro; novos leads aparecerão automaticamente.</p>
              </div>
            </div>
          )}

          {/* Mensagem quando não há leads para o dia atual */}
          {!loading && !filterLoading && !error && columns.every(col => col.leads.length === 0) && filters.date && (
            <div className="mb-4 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800/50 text-blue-700 dark:text-blue-200 rounded-xl flex items-center gap-3 text-sm animate-in fade-in slide-in-from-top-1">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <div>
                <p className="font-semibold">Nenhum cadastro encontrado</p>
                <p className="text-xs text-blue-600 dark:text-blue-300 mt-1">
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
              targetUserId={targetUserId || undefined}
              transferredFilter="no"
            />
          </div>
        </div>

        {/* Kanban Board Area */}
        <div className="flex-1 overflow-x-auto overflow-y-hidden pb-4 custom-scrollbar -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 snap-x snap-mandatory relative min-h-[500px]">
          {/* Overlay nas colunas quando requisição de leads está em andamento (inicial ou ao mudar filtro) */}
          {(loading || filterLoading) && (
            <div className="absolute inset-0 bg-white/50 dark:bg-[#1a1a1a]/80 backdrop-blur-[1px] rounded-xl z-20 flex items-center justify-center">
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

      {/* Modal Enviar Giros (Roleta) */}
      {showSpinModal && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => !spinSending && setShowSpinModal(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between rounded-t-2xl">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-amber-100 rounded-lg">
                  <Gift className="w-5 h-5 text-amber-600" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-gray-800">Enviar Giros (Roleta)</h2>
                  <p className="text-xs text-gray-500">Selecione o lead e a quantidade de giros</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => !spinSending && setShowSpinModal(false)}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Pesquisar lead</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    value={spinSearchTerm}
                    onChange={(e) => setSpinSearchTerm(e.target.value)}
                    placeholder="Nome ou e-mail..."
                    className="w-full pl-9 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-400/40"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider">Leads</label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setSpinSelectedLeadIds(new Set(spinFilteredLeads.map(l => String(l.id))))}
                      className="text-[10px] font-bold text-amber-600 hover:text-amber-700"
                    >
                      Selecionar todos
                    </button>
                    <span className="text-gray-300">|</span>
                    <button
                      type="button"
                      onClick={() => setSpinSelectedLeadIds(new Set())}
                      className="text-[10px] font-bold text-gray-500 hover:text-gray-700"
                    >
                      Desmarcar
                    </button>
                  </div>
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded-xl max-h-44 overflow-y-auto">
                  {spinFilteredLeads.length === 0 ? (
                    <p className="p-4 text-sm text-gray-500 text-center">Nenhum lead encontrado.</p>
                  ) : (
                    <ul className="divide-y divide-gray-100 py-1">
                      {spinFilteredLeads.map((lead) => {
                        const idStr = String(lead.id);
                        const checked = spinSelectedLeadIds.has(idStr);
                        return (
                          <li key={idStr}>
                            <label className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-100 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => {
                                  setSpinSelectedLeadIds(prev => {
                                    const next = new Set(prev);
                                    if (next.has(idStr)) next.delete(idStr);
                                    else next.add(idStr);
                                    return next;
                                  });
                                }}
                                className="w-4 h-4 rounded border-gray-300 text-amber-500 focus:ring-amber-400"
                              />
                              <span className="text-sm text-gray-800 truncate flex-1">
                                {lead.name || 'Sem nome'}
                                {lead.email ? (
                                  <span className="text-gray-500 font-normal"> — {lead.email}</span>
                                ) : null}
                              </span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
                {spinSelectedLeadIds.size > 0 && (
                  <p className="mt-1.5 text-xs text-gray-500">
                    {spinSelectedLeadIds.size} lead(s) selecionado(s)
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Quantidade de giros (por lead)</label>
                <input
                  type="number"
                  min={1}
                  value={spinQuantity}
                  onChange={(e) => setSpinQuantity(Math.max(1, parseInt(e.target.value, 10) || 1))}
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-amber-400/40"
                />
              </div>

              {spinError && (
                <div className="p-3 bg-red-50 border border-red-100 text-red-600 rounded-xl text-sm flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  {spinError}
                </div>
              )}

              {/* Mini histórico de giros (apenas quando um único lead está selecionado) */}
              {spinSelectedLeadIds.size === 1 && spinSelectedLead && (
                <div>
                  <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Histórico de giros enviados (lead selecionado)</h3>
                  <div className="bg-gray-50 border border-gray-100 rounded-xl overflow-hidden max-h-40 overflow-y-auto">
                    {spinHistoryLoading ? (
                      <div className="p-4 flex items-center justify-center gap-2 text-gray-500 text-sm">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Carregando...
                      </div>
                    ) : spinHistory.length === 0 ? (
                      <p className="p-4 text-sm text-gray-500 text-center">Nenhum giro enviado ainda para este lead.</p>
                    ) : (
                      <ul className="divide-y divide-gray-100">
                        {spinHistory.map((h, i) => (
                          <li key={i} className="px-4 py-2.5 flex items-center justify-between text-sm">
                            <span className="font-medium text-gray-800">{h.quantity} giro(s)</span>
                            <span className="text-gray-500">
                              {h.date ? new Date(h.date).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '-'}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 rounded-b-2xl flex gap-2">
              <button
                type="button"
                onClick={() => !spinSending && setShowSpinModal(false)}
                className="flex-1 py-3 bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold rounded-xl transition-colors"
              >
                Fechar
              </button>
              <button
                type="button"
                onClick={handleSendSpins}
                disabled={spinSending || spinSelectedLeadIds.size === 0 || spinQuantity < 1}
                className="flex-1 py-3 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-bold rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                {spinSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Gift className="w-4 h-4" />}
                {spinSending ? 'Enviando...' : `Enviar giros${spinSelectedLeadIds.size > 0 ? ` (${spinSelectedLeadIds.size})` : ''}`}
              </button>
            </div>
          </div>
        </div>
      )}

      <ToastContainer toasts={toasts} onClose={removeToast} />
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
