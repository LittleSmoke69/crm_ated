'use client';

import React, { useState, useRef, useEffect } from 'react';
import { 
  Star, 
  MoreVertical, 
  Clock, 
  Tag as TagIcon,
  Phone,
  Mail,
  Flame,
  Snowflake,
  History,
  AlertCircle,
  Target,
  Plus,
  X as XIcon,
  MessageSquare,
  Eye,
  Loader2,
  CheckCircle2,
  Edit2,
  Trash2,
  User,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  RefreshCw
} from 'lucide-react';
import { Lead } from './types';
import AddTagModal from './AddTagModal';
import RemoveTagModal from './RemoveTagModal';
import ContactFeedbackModal from './ContactFeedbackModal';
import { getTemperatureLabel, getTemperatureEmoji } from '@/lib/utils/temperature';

/** Níveis Estrela: min_wagered e max_wagered (aposta mínima/máxima para o nível) */
const STAR_LEVELS = [
  { level: 1, min: 100, max: 299 },
  { level: 2, min: 300, max: 699 },
  { level: 3, min: 700, max: 1199 },
  { level: 4, min: 1200, max: 4999 },
  { level: 5, min: 2500, max: 14999 },
  { level: 6, min: 15000, max: 29999 },
  { level: 7, min: 30000, max: 50000 },
] as const;

function getStarLevelInfo(wagered: number): {
  currentLevel: number;
  currentMin: number;
  currentMax: number;
  nextLevel: number | null;
  nextMin: number | null;
  progressPct: number;
  missingForNext: number | null;
} {
  const value = Math.max(0, wagered);
  const current = [...STAR_LEVELS].reverse().find((r) => value >= r.min && value <= r.max);
  if (!current) {
    if (value < STAR_LEVELS[0].min) {
      const next = STAR_LEVELS[0];
      const progressPct = (value / next.min) * 100;
      return {
        currentLevel: 0,
        currentMin: 0,
        currentMax: next.min,
        nextLevel: next.level,
        nextMin: next.min,
        progressPct: Math.min(100, progressPct),
        missingForNext: next.min - value,
      };
    }
    const last = STAR_LEVELS[STAR_LEVELS.length - 1];
    return {
      currentLevel: last.level,
      currentMin: last.min,
      currentMax: last.max,
      nextLevel: null,
      nextMin: null,
      progressPct: 100,
      missingForNext: null,
    };
  }
  const currentIdx = STAR_LEVELS.findIndex((r) => r.level === current.level);
  const next = currentIdx < STAR_LEVELS.length - 1 ? STAR_LEVELS[currentIdx + 1] : null;
  const range = current.max - current.min;
  const progressInLevel = range > 0 ? (value - current.min) / range : 1;
  const progressPct = Math.min(100, Math.max(0, progressInLevel * 100));
  const missingForNext = next ? Math.max(0, next.min - value) : null;
  return {
    currentLevel: current.level,
    currentMin: current.min,
    currentMax: current.max,
    nextLevel: next?.level ?? null,
    nextMin: next?.min ?? null,
    progressPct,
    missingForNext,
  };
}

interface LeadCardProps {
  lead: Lead;
  onFavorite?: (id: string | number) => void;
  onViewHistory?: (id: string | number) => void;
  onStarsChange?: (id: string | number, stars: number) => void;
  onDragStart: (e: React.DragEvent, id: string | number) => void;
  targetUserId?: string;
  /** Chamado ao adicionar etiqueta; recebe leadId e a tag. Atualize o estado local para evitar refetch. */
  onTagAdded?: (leadId: string | number, addedTag: { id: string; label: string; color: string }) => void;
  /** Chamado ao remover etiqueta; recebe leadId e tagId. Atualize o estado local para evitar refetch. */
  onTagRemoved?: (leadId: string | number, tagId: string) => void;
  /** Chamado quando feedback é salvo/removido; opcional refetch dos leads. */
  onRefresh?: () => void;
  selectedBancaUrl?: string;
  columnId?: string;
  /** Layout compacto (igual ao CRM principal / Clientes cadastrados) para não deixar a tela grande */
  compact?: boolean;
  /** Prazo em dias para leads transferidos (ex.: 10 na página Transferido, 90 no CRM principal) */
  transferDeadlineDays?: number;
}

const LeadCard: React.FC<LeadCardProps> = ({ 
  lead, 
  onFavorite, 
  onViewHistory,
  onStarsChange,
  onDragStart,
  targetUserId,
  onTagAdded,
  onTagRemoved,
  onRefresh,
  selectedBancaUrl,
  columnId,
  compact = false,
  transferDeadlineDays = 90,
}) => {
  const [showAddTagModal, setShowAddTagModal] = useState(false);
  const [showRemoveTagModal, setShowRemoveTagModal] = useState(false);
  const [showContactFeedbackModal, setShowContactFeedbackModal] = useState(false);
  const [showFeedbackViewModal, setShowFeedbackViewModal] = useState(false);
  const [showAllFeedbacksModal, setShowAllFeedbacksModal] = useState(false);
  const [editingFeedback, setEditingFeedback] = useState<any | null>(null);
  const [viewingSingleFeedback, setViewingSingleFeedback] = useState<any | null>(null);
  const [allFeedbacks, setAllFeedbacks] = useState<any[]>([]);
  const [loadingAllFeedbacks, setLoadingAllFeedbacks] = useState(false);
  const [hasFeedback, setHasFeedback] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [loadingFeedback, setLoadingFeedback] = useState(false);
  const [deletingFeedbackId, setDeletingFeedbackId] = useState<string | null>(null);
  const [showMenu, setShowMenu] = useState(false);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [leadDetails, setLeadDetails] = useState<Lead | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  /** Tick para contagem regressiva em tempo real do prazo de leads transferidos (1s para contador h/m/s) */
  const [nowTick, setNowTick] = useState(0);
  useEffect(() => {
    if (!lead.transferred || !lead.transferred_at) return;
    const id = setInterval(() => setNowTick((t) => t + 1), 1000); // atualiza a cada 1 segundo
    return () => clearInterval(id);
  }, [lead.transferred, lead.transferred_at]);

  /** Retorna tempo até o próximo dia (quando daysLeft diminui) e formata como "Xh Ym Zs" */
  const getCountdownToNextDay = (transferredAt: Date): string => {
    const now = new Date();
    const msPerDay = 1000 * 60 * 60 * 24;
    const diffDays = Math.floor((now.getTime() - transferredAt.getTime()) / msPerDay);
    const nextBoundary = transferredAt.getTime() + (diffDays + 1) * msPerDay;
    let remaining = Math.max(0, Math.floor((nextBoundary - now.getTime()) / 1000));
    const h = Math.floor(remaining / 3600);
    const m = Math.floor((remaining % 3600) / 60);
    const s = remaining % 60;
    return `${h}h ${m}m ${s}s`;
  };

  // Estados para os históricos
  const [depositsHistory, setDepositsHistory] = useState<any[]>([]);
  const [withdrawsHistory, setWithdrawsHistory] = useState<any[]>([]);
  const [betsHistory, setBetsHistory] = useState<any[]>([]);
  const [loadingDeposits, setLoadingDeposits] = useState(false);
  const [loadingWithdraws, setLoadingWithdraws] = useState(false);
  const [loadingBets, setLoadingBets] = useState(false);
  
  // Estados para controlar visualização (mostrar apenas 5 inicialmente)
  const [showAllDeposits, setShowAllDeposits] = useState(false);
  const [showAllWithdraws, setShowAllWithdraws] = useState(false);
  const [showAllBets, setShowAllBets] = useState(false);
  const [loadingMoreDeposits, setLoadingMoreDeposits] = useState(false);
  const [loadingMoreWithdraws, setLoadingMoreWithdraws] = useState(false);
  const [loadingMoreBets, setLoadingMoreBets] = useState(false);
  
  // Estados para armazenar todos os dados (para paginação)
  const [allDepositsData, setAllDepositsData] = useState<any[]>([]);
  const [allWithdrawsData, setAllWithdrawsData] = useState<any[]>([]);
  const [allBetsData, setAllBetsData] = useState<any[]>([]);
  const [depositsPagination, setDepositsPagination] = useState<any>(null);
  const [withdrawsPagination, setWithdrawsPagination] = useState<any>(null);
  const [betsPagination, setBetsPagination] = useState<any>(null);

  // Obtém o userId do consultor
  const [consultorUserId, setConsultorUserId] = useState<string | null>(null);
  
  // Estados para feedback de cópia
  const [copiedName, setCopiedName] = useState(false);
  const [copiedEmail, setCopiedEmail] = useState(false);
  const [copiedPhone, setCopiedPhone] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const userId = sessionStorage.getItem('user_id') || 
                     sessionStorage.getItem('profile_id') || 
                     localStorage.getItem('profile_id');
      setConsultorUserId(userId);
    }
  }, []);

  /** URL da banca para histórico: prioriza a banca em que o lead está cadastrado (cadastro na banca). */
  const bancaUrlForHistory = lead.banca_url?.trim() || selectedBancaUrl?.trim() || undefined;

  // Função para buscar histórico de depósitos
  const loadDepositsHistory = async (page: number = 1, loadAll: boolean = false) => {
    const leadIdUsed = lead.original_id != null ? String(lead.original_id) : (typeof lead.id === 'string' && lead.id.includes('-') ? (lead.id.split('-').pop() ?? String(lead.id)) : String(lead.id));
    if (!consultorUserId || !leadIdUsed) {
      console.log('[LeadCard Histórico] Depósitos: não carregou — consultorUserId ou leadId ausente', { consultorUserId: !!consultorUserId, leadId: lead.id, original_id: lead.original_id });
      return;
    }

    if (page === 1) {
      setLoadingDeposits(true);
    } else {
      setLoadingMoreDeposits(true);
    }

    const url = new URL(`/api/crm/leads/${leadIdUsed}/deposits`, window.location.origin);
    if (bancaUrlForHistory) {
      url.searchParams.append('banca_url', bancaUrlForHistory);
    }
    url.searchParams.append('page', page.toString());
    url.searchParams.append('per_page', '15');
    console.log('[LeadCard Histórico] Depósitos: carregando', { leadIdUsado: leadIdUsed, lead_id: lead.id, original_id: lead.original_id, page, banca_url: bancaUrlForHistory || '(default)' });

    try {
      const response = await fetch(url.toString(), {
        headers: { 'X-User-Id': consultorUserId },
      });
      if (response.ok) {
        const data = await response.json();
        if (data.data && data.data.history) {
          const newHistory = Array.isArray(data.data.history) ? data.data.history : [];
          console.log('[LeadCard Histórico] Depósitos: ok', { page, totalItens: newHistory.length, pagination: data.data.pagination });
          if (page === 1) {
            setAllDepositsData(newHistory);
            setDepositsHistory(newHistory.slice(0, 5)); // Mostra apenas 5 inicialmente
            setDepositsPagination(data.data.pagination);
          } else {
            setAllDepositsData(prev => [...prev, ...newHistory]);
            if (loadAll) {
              setDepositsHistory(prev => [...prev, ...newHistory]);
            }
            setDepositsPagination(data.data.pagination);
          }
        } else {
          if (page === 1) {
            setDepositsHistory([]);
            setAllDepositsData([]);
          }
          console.log('[LeadCard Histórico] Depósitos: resposta ok mas sem data.data.history', { page });
        }
      } else {
        console.warn('[LeadCard Histórico] Depósitos: resposta não ok', { status: response.status, statusText: response.statusText, page });
        if (page === 1) {
          setDepositsHistory([]);
          setAllDepositsData([]);
        }
      }
    } catch (error) {
      console.error('[LeadCard Histórico] Depósitos: erro ao buscar histórico', error);
      if (page === 1) {
        setDepositsHistory([]);
        setAllDepositsData([]);
      }
    } finally {
      setLoadingDeposits(false);
      setLoadingMoreDeposits(false);
    }
  };

  // Função para carregar todos os depósitos
  const loadAllDeposits = async () => {
    if (showAllDeposits) {
      setShowAllDeposits(false);
      setDepositsHistory(allDepositsData.slice(0, 5));
      return;
    }

    setShowAllDeposits(true);
    setDepositsHistory(allDepositsData);

    // Se ainda há mais páginas, carrega todas
    if (depositsPagination && depositsPagination.current_page < depositsPagination.last_page) {
      let currentPage = depositsPagination.current_page + 1;
      while (currentPage <= depositsPagination.last_page) {
        await loadDepositsHistory(currentPage, true);
        currentPage++;
      }
    }
  };

  // Função para buscar histórico de saques
  const loadWithdrawsHistory = async (page: number = 1, loadAll: boolean = false) => {
    const leadIdUsed = lead.original_id != null ? String(lead.original_id) : (typeof lead.id === 'string' && lead.id.includes('-') ? (lead.id.split('-').pop() ?? String(lead.id)) : String(lead.id));
    if (!consultorUserId || !leadIdUsed) {
      console.log('[LeadCard Histórico] Saques: não carregou — consultorUserId ou leadId ausente', { consultorUserId: !!consultorUserId, leadId: lead.id, original_id: lead.original_id });
      return;
    }

    if (page === 1) {
      setLoadingWithdraws(true);
    } else {
      setLoadingMoreWithdraws(true);
    }

    const url = new URL(`/api/crm/leads/${leadIdUsed}/withdraws`, window.location.origin);
    if (bancaUrlForHistory) {
      url.searchParams.append('banca_url', bancaUrlForHistory);
    }
    url.searchParams.append('page', page.toString());
    url.searchParams.append('per_page', '15');
    console.log('[LeadCard Histórico] Saques: carregando', { leadIdUsado: leadIdUsed, lead_id: lead.id, original_id: lead.original_id, page, banca_url: bancaUrlForHistory || '(default)' });

    try {
      const response = await fetch(url.toString(), {
        headers: { 'X-User-Id': consultorUserId },
      });
      if (response.ok) {
        const data = await response.json();
        if (data.data && data.data.history) {
          const newHistory = Array.isArray(data.data.history) ? data.data.history : [];
          console.log('[LeadCard Histórico] Saques: ok', { page, totalItens: newHistory.length, pagination: data.data.pagination });
          if (page === 1) {
            setAllWithdrawsData(newHistory);
            setWithdrawsHistory(newHistory.slice(0, 5)); // Mostra apenas 5 inicialmente
            setWithdrawsPagination(data.data.pagination);
          } else {
            setAllWithdrawsData(prev => [...prev, ...newHistory]);
            if (loadAll) {
              setWithdrawsHistory(prev => [...prev, ...newHistory]);
            }
            setWithdrawsPagination(data.data.pagination);
          }
        } else {
          if (page === 1) {
            setWithdrawsHistory([]);
            setAllWithdrawsData([]);
          }
          console.log('[LeadCard Histórico] Saques: resposta ok mas sem data.data.history', { page });
        }
      } else {
        console.warn('[LeadCard Histórico] Saques: resposta não ok', { status: response.status, statusText: response.statusText, page });
        if (page === 1) {
          setWithdrawsHistory([]);
          setAllWithdrawsData([]);
        }
      }
    } catch (error) {
      console.error('[LeadCard Histórico] Saques: erro ao buscar histórico', error);
      if (page === 1) {
        setWithdrawsHistory([]);
        setAllWithdrawsData([]);
      }
    } finally {
      setLoadingWithdraws(false);
      setLoadingMoreWithdraws(false);
    }
  };

  // Função para carregar todos os saques
  const loadAllWithdraws = async () => {
    if (showAllWithdraws) {
      setShowAllWithdraws(false);
      setWithdrawsHistory(allWithdrawsData.slice(0, 5));
      return;
    }

    setShowAllWithdraws(true);
    setWithdrawsHistory(allWithdrawsData);

    // Se ainda há mais páginas, carrega todas
    if (withdrawsPagination && withdrawsPagination.current_page < withdrawsPagination.last_page) {
      let currentPage = withdrawsPagination.current_page + 1;
      while (currentPage <= withdrawsPagination.last_page) {
        await loadWithdrawsHistory(currentPage, true);
        currentPage++;
      }
    }
  };

  // Função para buscar histórico de apostas
  const loadBetsHistory = async (page: number = 1, loadAll: boolean = false) => {
    const leadIdUsed = lead.original_id != null ? String(lead.original_id) : (typeof lead.id === 'string' && lead.id.includes('-') ? (lead.id.split('-').pop() ?? String(lead.id)) : String(lead.id));
    if (!consultorUserId || !leadIdUsed) {
      console.log('[LeadCard Histórico] Apostas: não carregou — consultorUserId ou leadId ausente', { consultorUserId: !!consultorUserId, leadId: lead.id, original_id: lead.original_id });
      return;
    }

    if (page === 1) {
      setLoadingBets(true);
    } else {
      setLoadingMoreBets(true);
    }

    const url = new URL(`/api/crm/leads/${leadIdUsed}/bets`, window.location.origin);
    if (bancaUrlForHistory) {
      url.searchParams.append('banca_url', bancaUrlForHistory);
    }
    url.searchParams.append('page', page.toString());
    url.searchParams.append('per_page', '15');
    console.log('[LeadCard Histórico] Apostas: carregando', { leadIdUsado: leadIdUsed, lead_id: lead.id, original_id: lead.original_id, page, banca_url: bancaUrlForHistory || '(default)' });

    try {
      const response = await fetch(url.toString(), {
        headers: { 'X-User-Id': consultorUserId },
      });
      if (response.ok) {
        const data = await response.json();
        const raw = data.data || {};
        const lotteryRaw = Array.isArray(raw.history) ? raw.history : [];
        const lotteryHistory = lotteryRaw.map((b: any) => ({
          ...b,
          type: b.type || b.game_type || 'lottery',
          game_type: b.game_type || b.type || 'lottery',
        }));
        const bichaoRaw = Array.isArray(raw.bichao_history) ? raw.bichao_history : [];
        const bichaoHistory = bichaoRaw.map((b: any) => ({
          ...b,
          type: 'bichao',
          game_type: 'bichao',
          premio: b.premio_a_receber != null ? b.premio_a_receber : null,
        }));
        const merged = [...lotteryHistory, ...bichaoHistory].sort((a, b) => {
          const dateA = new Date(a.date || a.created_at || 0).getTime();
          const dateB = new Date(b.date || b.created_at || 0).getTime();
          return dateB - dateA;
        });

        const pagination = raw.pagination || {};
        const bichaoPagination = raw.bichao_pagination || {};
        const combinedPagination = {
          ...pagination,
          last_page: Math.max(pagination.last_page || 1, bichaoPagination.last_page || 1),
          total: (pagination.total || 0) + (bichaoPagination.total || 0),
        };

        console.log('[LeadCard Histórico] Apostas: ok', { page, totalItens: merged.length, pagination: combinedPagination });
        if (page === 1) {
          setAllBetsData(merged);
          setBetsHistory(merged.slice(0, 5));
          setBetsPagination(combinedPagination);
        } else {
          setAllBetsData(prev => [...prev, ...merged]);
          if (loadAll) {
            setBetsHistory(prev => [...prev, ...merged]);
          }
          setBetsPagination(combinedPagination);
        }
      } else {
        console.warn('[LeadCard Histórico] Apostas: resposta não ok', { status: response.status, statusText: response.statusText, page });
        if (page === 1) {
          setBetsHistory([]);
          setAllBetsData([]);
        }
      }
    } catch (error) {
      console.error('[LeadCard Histórico] Apostas: erro ao buscar histórico', error);
      if (page === 1) {
        setBetsHistory([]);
        setAllBetsData([]);
      }
    } finally {
      setLoadingBets(false);
      setLoadingMoreBets(false);
    }
  };

  // Função para carregar todas as apostas
  const loadAllBets = async () => {
    if (showAllBets) {
      setShowAllBets(false);
      setBetsHistory(allBetsData.slice(0, 5));
      return;
    }

    setShowAllBets(true);
    setBetsHistory(allBetsData);

    // Se ainda há mais páginas, carrega todas
    if (betsPagination && betsPagination.current_page < betsPagination.last_page) {
      let currentPage = betsPagination.current_page + 1;
      while (currentPage <= betsPagination.last_page) {
        await loadBetsHistory(currentPage, true);
        currentPage++;
      }
    }
  };

  // Função para carregar todos os históricos
  const loadAllHistories = async () => {
    const leadIdUsed = lead.original_id != null ? String(lead.original_id) : (typeof lead.id === 'string' && lead.id.includes('-') ? (lead.id.split('-').pop() ?? String(lead.id)) : String(lead.id));
    console.log('[LeadCard Histórico] Carregando todos os históricos (detalhe do lead)', {
      lead_id: lead.id,
      original_id: lead.original_id,
      leadIdUsado: leadIdUsed,
      leadName: lead.name,
      banca_url: bancaUrlForHistory || '(default)',
      banca_do_lead: lead.banca_url || '(não informada)',
    });
    await Promise.all([
      loadDepositsHistory(),
      loadWithdrawsHistory(),
      loadBetsHistory()
    ]);
    console.log('[LeadCard Histórico] Finalizado carregamento dos três históricos');
  };

  /** ID numérico do lead para APIs de feedback (crm_feedback.lead_user_id). Evita composite "bancaId-28660". */
  const leadNumericIdForFeedback =
    lead.original_id != null
      ? String(lead.original_id)
      : typeof lead.id === 'string' && lead.id.includes('-')
        ? (lead.id.split('-').pop() ?? String(lead.id))
        : String(lead.id);

  // Função para buscar feedback quando o botão for clicado
  const loadFeedback = async () => {
    if (!consultorUserId || !lead.id) return;

    setLoadingFeedback(true);
    try {
      const url = new URL('/api/crm/leads/feedback', window.location.origin);
      url.searchParams.append('user_id', leadNumericIdForFeedback);
      if (selectedBancaUrl) {
        url.searchParams.append('banca_url', selectedBancaUrl);
      }
      if (targetUserId) {
        url.searchParams.append('target_user_id', targetUserId);
      }

      const response = await fetch(url.toString(), {
        headers: { 'X-User-Id': consultorUserId }
      });
      const result = await response.json();
      
      if (result.success && result.data && result.data.length > 0) {
        setHasFeedback(true);
        // Pega o feedback mais recente
        const latestFeedback = result.data.sort((a: any, b: any) => 
          new Date(b.created_at || b.createdAt || 0).getTime() - 
          new Date(a.created_at || a.createdAt || 0).getTime()
        )[0];
        setFeedback(latestFeedback.feedback || latestFeedback.message || null);
      } else {
        setHasFeedback(false);
        setFeedback(null);
      }
    } catch (err) {
      console.error('[LeadCard] Erro ao buscar feedback:', err);
      setHasFeedback(false);
      setFeedback(null);
    } finally {
      setLoadingFeedback(false);
    }
  };

  // Função para buscar todos os feedbacks
  const loadAllFeedbacks = async () => {
    if (!consultorUserId || !lead.id) return;

    setLoadingAllFeedbacks(true);
    try {
      const url = new URL('/api/crm/leads/feedback', window.location.origin);
      url.searchParams.append('user_id', leadNumericIdForFeedback);
      if (selectedBancaUrl) {
        url.searchParams.append('banca_url', selectedBancaUrl);
      }
      if (targetUserId) {
        url.searchParams.append('target_user_id', targetUserId);
      }

      const response = await fetch(url.toString(), {
        headers: { 'X-User-Id': consultorUserId }
      });
      const result = await response.json();
      
      if (result.success && result.data) {
        setAllFeedbacks(Array.isArray(result.data) ? result.data : []);
      } else {
        setAllFeedbacks([]);
      }
    } catch (err) {
      console.error('[LeadCard] Erro ao buscar todos os feedbacks:', err);
      setAllFeedbacks([]);
    } finally {
      setLoadingAllFeedbacks(false);
    }
  };

  // Função para excluir um feedback
  const handleDeleteFeedback = async (feedbackId: string) => {
    if (!consultorUserId || !confirm('Tem certeza que deseja excluir este feedback?')) return;

    setDeletingFeedbackId(feedbackId);
    try {
      const response = await fetch(`/api/crm/leads/feedback?id=${feedbackId}`, {
        method: 'DELETE',
        headers: { 'X-User-Id': consultorUserId }
      });
      const result = await response.json();
      
      if (result.success) {
        // Remove da lista local
        setAllFeedbacks(prev => prev.filter(fb => fb.id !== feedbackId));
        onRefresh?.();
      } else {
        alert(result.error || 'Erro ao excluir feedback');
      }
    } catch (err) {
      console.error('[LeadCard] Erro ao excluir feedback:', err);
      alert('Erro ao excluir feedback');
    } finally {
      setDeletingFeedbackId(null);
    }
  };

  // Verifica se o lead tem status de contato
  const isContacted = lead.status === 'contato';
  
  // Verifica se está na coluna "Clientes cadastrados" (novo)
  const isInNovoColumn = columnId === 'novo';
  
  // Verifica se o lead foi contactado (has_interaction = true)
  const hasInteraction = lead.has_interaction === true;

  // Fecha o menu ao clicar fora
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false);
      }
    };

    if (showMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showMenu]);

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .filter(n => n)
      .map(n => n[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();
  };

  // Função para copiar nome
  const copyName = async () => {
    const fullName = `${lead.name} ${lead.last_name || ''}`.trim();
    if (!fullName) return;
    
    try {
      await navigator.clipboard.writeText(fullName);
      setCopiedName(true);
      setTimeout(() => setCopiedName(false), 2000);
    } catch (error) {
      console.error('Erro ao copiar nome:', error);
    }
  };

  // Função para copiar email
  const copyEmail = async () => {
    if (!lead.email) return;
    
    try {
      await navigator.clipboard.writeText(lead.email);
      setCopiedEmail(true);
      setTimeout(() => setCopiedEmail(false), 2000);
    } catch (error) {
      console.error('Erro ao copiar email:', error);
    }
  };

  // Função para copiar telefone
  const copyPhone = async () => {
    if (!lead.phone) return;
    
    try {
      // Copia o número limpo (apenas dígitos)
      const phoneNumber = lead.phone.replace(/\D/g, '');
      await navigator.clipboard.writeText(phoneNumber);
      setCopiedPhone(true);
      setTimeout(() => setCopiedPhone(false), 2000);
    } catch (error) {
      console.error('Erro ao copiar telefone:', error);
    }
  };

  const getTimeAgo = (date: string) => {
    if (!date) return '-';
    try {
      const now = new Date();
      const past = new Date(date);
      const diffInMs = now.getTime() - past.getTime();
      const diffInHours = Math.floor(diffInMs / (1000 * 60 * 60));
      
      if (diffInHours < 1) return 'Agora';
      if (diffInHours < 24) return `${diffInHours}h`;
      return `${Math.floor(diffInHours / 24)}d`;
    } catch {
      return '-';
    }
  };

  // Formata data de cadastro no formato Dia/Mês/Ano
  const formatCreatedDate = (date: string | undefined): string => {
    if (!date) return '-';
    try {
      const dateObj = new Date(date);
      const day = String(dateObj.getDate()).padStart(2, '0');
      const month = String(dateObj.getMonth() + 1).padStart(2, '0');
      const year = dateObj.getFullYear();
      return `${day}/${month}/${year}`;
    } catch {
      return '-';
    }
  };

  // Formata data e hora completa no formato Dia/Mês/Ano HH:MM
  const formatDateTime = (date: string | undefined): string => {
    if (!date) return '-';
    try {
      const dateObj = new Date(date);
      const day = String(dateObj.getDate()).padStart(2, '0');
      const month = String(dateObj.getMonth() + 1).padStart(2, '0');
      const year = dateObj.getFullYear();
      const hours = String(dateObj.getHours()).padStart(2, '0');
      const minutes = String(dateObj.getMinutes()).padStart(2, '0');
      return `${day}/${month}/${year} ${hours}:${minutes}`;
    } catch {
      return '-';
    }
  };

  // Formata telefone no formato (XX) X XXXX-XXXX
  const formatPhone = (phone: string | undefined): string => {
    if (!phone) return '';
    const digits = phone.replace(/\D/g, '');
    
    // Remove o 55 do início se existir (código do país)
    let cleanDigits = digits.startsWith('55') ? digits.slice(2) : digits;
    
    // Se tem 11 dígitos (DDD + número celular com 9)
    if (cleanDigits.length === 11) {
      const ddd = cleanDigits.slice(0, 2);
      const number = cleanDigits.slice(2);
      // Formato: (XX) X XXXX-XXXX
      return `(${ddd}) ${number[0]} ${number.slice(1, 5)}-${number.slice(5)}`;
    }
    
    // Se tem 10 dígitos (DDD + número)
    if (cleanDigits.length === 10) {
      const ddd = cleanDigits.slice(0, 2);
      const number = cleanDigits.slice(2);
      // Formato: (XX) X XXXX-XXXX (assume que é celular começando com 9)
      if (number[0] === '9') {
        return `(${ddd}) ${number[0]} ${number.slice(1, 5)}-${number.slice(5)}`;
      } else {
        // Fixo: (XX) XXXX-XXXX
        return `(${ddd}) ${number.slice(0, 4)}-${number.slice(4)}`;
      }
    }
    
    // Se não conseguir formatar, retorna o original
    return phone;
  };

  // Formata último depósito no formato relativo: Último depósito foi Hoje, 1 dia, 1 Mês, 1 ano
  const formatLastDeposit = (date: string | undefined, defaultMessage: string = 'Nunca depositou'): string => {
    if (!date) return defaultMessage;
    try {
      const now = new Date();
      const depositDate = new Date(date);
      
      // Reseta horas para comparar apenas datas
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const deposit = new Date(depositDate.getFullYear(), depositDate.getMonth(), depositDate.getDate());
      
      const diffInMs = today.getTime() - deposit.getTime();
      const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));
      
      let timeText = '';
      if (diffInDays === 0) {
        timeText = 'Hoje';
      } else if (diffInDays === 1) {
        timeText = '1 dia';
      } else if (diffInDays < 30) {
        timeText = `${diffInDays} dias`;
      } else {
        const diffInMonths = Math.floor(diffInDays / 30);
        if (diffInMonths === 1) {
          timeText = '1 Mês';
        } else if (diffInMonths < 12) {
          timeText = `${diffInMonths} Meses`;
        } else {
          const diffInYears = Math.floor(diffInDays / 365);
          if (diffInYears === 1) {
            timeText = '1 ano';
          } else {
            timeText = `${diffInYears} anos`;
          }
        }
      }
      
      return `Último depósito foi ${timeText}`;
    } catch {
      return '-';
    }
  };

  // Formata data relativa genérica (para saques, vitórias, etc)
  const formatRelativeDate = (date: string | undefined, defaultMessage: string = 'Nunca'): string => {
    if (!date) return defaultMessage;
    try {
      const now = new Date();
      const eventDate = new Date(date);
      
      // Reseta horas para comparar apenas datas
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const event = new Date(eventDate.getFullYear(), eventDate.getMonth(), eventDate.getDate());
      
      const diffInMs = today.getTime() - event.getTime();
      const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));
      
      let timeText = '';
      if (diffInDays === 0) {
        timeText = 'Hoje';
      } else if (diffInDays === 1) {
        timeText = 'há 1 dia';
      } else if (diffInDays < 30) {
        timeText = `há ${diffInDays} dias`;
      } else {
        const diffInMonths = Math.floor(diffInDays / 30);
        if (diffInMonths === 1) {
          timeText = 'há 1 mês';
        } else if (diffInMonths < 12) {
          timeText = `há ${diffInMonths} meses`;
        } else {
          const diffInYears = Math.floor(diffInDays / 365);
          if (diffInYears === 1) {
            timeText = 'há 1 ano';
          } else {
            timeText = `há ${diffInYears} anos`;
          }
        }
      }
      
      return timeText;
    } catch {
      return '-';
    }
  };

  // Formata valor monetário no formato R$ xx,xx
  const formatCurrency = (value: number | null | undefined): string => {
    if (value === null || value === undefined || isNaN(value)) return 'R$ 0,00';
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value);
  };

  const isHighValue = (lead.total_depositado || 0) >= 100;
  const isVIP = (lead.total_depositos_count || 0) >= 3;
  const isOpportunity = (lead.total_depositos_count || 0) === 2;
  const isAlert = lead.status === 'deposito_sem_aposta' || lead.status === 'deposito_sem_jogo';

  const getCardStyle = () => {
    if (isAlert) return 'border-red-200 bg-red-50/40 shadow-red-50';
    if (isVIP) return 'border-indigo-200 bg-indigo-50/40 shadow-indigo-50 ring-1 ring-indigo-100';
    if (isHighValue) return 'border-amber-200 bg-amber-50/40 shadow-amber-50';
    if (isOpportunity) return 'border-orange-200 bg-orange-50/40 shadow-orange-50';
    return 'border-gray-200 bg-gray-100 shadow-sm';
  };

  // Layout compacto: cabeçalho → métricas → nível estrela → tags → telefone → rodapé (data, último depósito/cronômetro, Chamar)
  const compactCard = (() => {
    const temperature = lead.temperature || 'cold';
    const tempLabel = getTemperatureLabel(temperature);
    const tempEmoji = getTemperatureEmoji(temperature);
    const wagered = Number((lead as any).aposta_estrelas) ?? 0;
    const starInfo = getStarLevelInfo(wagered);
    const levelLabel = starInfo.currentLevel === 0 ? 'Iniciante' : `${starInfo.currentLevel} ${starInfo.currentLevel === 1 ? 'Estrela' : 'Estrelas'}`;
    const lastDepositText = lead.last_deposit_at ? formatRelativeDate(lead.last_deposit_at, 'Nunca') : 'Nunca depositou';
    const createdDateFormatted = formatCreatedDate(lead.created_at || lead.createdAt);
    return (
      <div
        draggable
        onDragStart={(e) => onDragStart(e, lead.id)}
        className={`rounded-2xl border-2 p-4 hover:shadow-xl transition-all cursor-grab active:cursor-grabbing group mb-4 bg-white ${getCardStyle()}`}
      >
        {/* 1. Cabeçalho: Avatar, Nome, Estrelas, Direto/Afiliado, Eye, Menu */}
        <div className="flex items-start gap-3 mb-4">
          <div className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm shrink-0 border-2 border-white shadow-sm" style={{ color: '#166534', backgroundColor: '#dcfce7' }}>
            {getInitials(lead.name)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-gray-900 truncate leading-tight" title={lead.name}>{lead.name}</p>
            <div className="flex items-center gap-1.5 mt-1">
              {[...Array(5)].map((_, i) => (
                <button key={i} type="button" onClick={(e) => { e.stopPropagation(); onStarsChange?.(lead.id, i + 1); }} className="focus:outline-none">
                  <Star className="w-3.5 h-3.5" fill={i < (lead.stars || 0) ? '#fbbf24' : 'none'} stroke={i < (lead.stars || 0) ? '#fbbf24' : '#e5e7eb'} strokeWidth={2} />
                </button>
              ))}
              <span className="text-[10px] font-black uppercase text-gray-400 ml-1">{lead.is_affiliate ? 'Afiliado' : 'Direto'}</span>
            </div>
          </div>
          <div className="flex items-center gap-0.5 shrink-0">
            <button type="button" onClick={(e) => { e.stopPropagation(); setLeadDetails(lead); setShowDetailsModal(true); loadAllHistories(); }} className="p-1.5 text-gray-400 hover:text-[#8CD955] hover:bg-[#8CD955]/10 rounded-lg" title="Ver detalhes">
              <Eye className="w-4 h-4" />
            </button>
            <div className="relative">
              <button type="button" onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu); }} className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-lg">
                <MoreVertical className="w-4 h-4" />
              </button>
              {showMenu && (
                <div className="absolute right-0 top-full mt-1 w-40 bg-white rounded-xl shadow-xl border border-gray-100 py-1.5 z-50">
                  <button onClick={() => { setShowAddTagModal(true); setShowMenu(false); }} className="w-full text-left px-3 py-1.5 text-xs text-gray-600 hover:bg-[#8CD955]/10 flex items-center gap-2 font-bold">
                    <TagIcon className="w-3.5 h-3.5" /> Adicionar Etiqueta
                  </button>
                  {lead.tags && lead.tags.length > 0 && (
                    <button onClick={() => { setShowRemoveTagModal(true); setShowMenu(false); }} className="w-full text-left px-3 py-1.5 text-xs text-gray-600 hover:bg-red-50 hover:text-red-600 flex items-center gap-2 font-bold">
                      <XIcon className="w-3.5 h-3.5" /> Remover Etiqueta
                    </button>
                  )}
                  {hasInteraction && (
                    <button onClick={async () => { setShowMenu(false); setShowAllFeedbacksModal(true); await loadAllFeedbacks(); }} className="w-full text-left px-3 py-1.5 text-xs text-gray-600 hover:bg-blue-50 flex items-center gap-2 font-bold">
                      <MessageSquare className="w-3.5 h-3.5" /> Ver Feedbacks
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 2. Métricas: Depósitos (com Nx), Apostas, Ganhos */}
        <div className="grid grid-cols-3 gap-2 mb-3">
          <div className="bg-gray-50 rounded-xl p-2.5 border border-gray-100 min-w-0 relative">
            <p className="text-[9px] text-gray-500 uppercase font-black tracking-tight mb-0.5">Depósitos</p>
            {lead.total_depositos_count !== undefined && (
              <span className="absolute top-1.5 right-1.5 bg-[#8CD955] text-white text-[8px] font-black px-1.5 py-0.5 rounded-md">
                {lead.total_depositos_count}x
              </span>
            )}
            <p className="text-xs font-black text-gray-800 truncate">{formatCurrency(lead.total_depositado)}</p>
          </div>
          <div className="bg-gray-50 rounded-xl p-2.5 border border-gray-100 min-w-0">
            <p className="text-[9px] text-gray-500 uppercase font-black tracking-tight mb-0.5">Apostas</p>
            <p className="text-xs font-black text-gray-800 truncate">{formatCurrency(lead.total_apostado)}</p>
          </div>
          <div className="bg-[#8CD955]/15 rounded-xl p-2.5 border border-[#8CD955]/30 min-w-0">
            <p className="text-[9px] text-[#166534] uppercase font-black tracking-tight mb-0.5">Ganhos</p>
            <p className="text-xs font-black text-[#166534] truncate">{formatCurrency(lead.total_ganho)}</p>
          </div>
        </div>

        {/* 3. Barra Nível Estrela: Nível • Falta R$ + barra de progresso + Próximo */}
        {(lead as any).aposta_estrelas !== undefined && (lead as any).aposta_estrelas !== null && (
          <div className="mb-3 rounded-xl px-3 py-2.5 overflow-hidden" style={{ backgroundColor: '#8CD955' }}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <Star className="w-4 h-4 shrink-0" fill="#ffffff" stroke="#ffffff" strokeWidth={1.5} />
                <span className="text-xs font-black text-white truncate">Nível Estrela • {levelLabel}</span>
              </div>
              {starInfo.nextLevel !== null && starInfo.missingForNext !== null && (
                <span className="text-[10px] font-bold text-white shrink-0">Falta {formatCurrency(starInfo.missingForNext)}</span>
              )}
            </div>
            {/* Barrinha de progresso: preenchido branco = progresso; resto = verde mais claro */}
            <div className="h-2 rounded-full overflow-hidden mt-2" style={{ backgroundColor: 'rgba(255, 255, 255, 0.35)' }}>
              <div
                className="h-full rounded-full transition-all duration-500 ease-out"
                style={{ width: `${Math.min(100, Math.max(0, starInfo.progressPct))}%`, backgroundColor: '#ffffff' }}
              />
            </div>
            {starInfo.nextLevel !== null && (
              <p className="text-[10px] font-semibold text-white/95 mt-1.5 truncate">
                Próximo: {starInfo.nextLevel} {starInfo.nextLevel === 1 ? 'Estrela' : 'Estrelas'} ({formatCurrency(starInfo.nextMin || 0)})
              </p>
            )}
          </div>
        )}

        {/* 4. Tags: Temperatura (FRIO etc) + Contactado + Etiquetas do lead */}
        <div className="flex flex-wrap items-center gap-1.5 mb-3">
          {(() => {
            const isCold = temperature === 'cold' || temperature === 'very_cold' || temperature === 'cooling';
            const tempIcon = isCold ? <Snowflake className="w-3 h-3" /> : <Flame className="w-3 h-3" />;
            const tempColors = temperature === 'hot' ? 'text-red-700 bg-red-100 border-red-200/50' : temperature === 'active' ? 'text-orange-700 bg-orange-100 border-orange-200/50' : temperature === 'cooling' ? 'text-purple-700 bg-purple-100 border-purple-200/50' : 'text-blue-700 bg-blue-100 border-blue-200/50';
            return (
              <span className={`flex items-center gap-1.5 text-[10px] font-black px-2.5 py-1 rounded-full uppercase tracking-tight border ${tempColors}`}>
                {tempIcon}
                {tempLabel}
              </span>
            );
          })()}
          {lead.has_interaction === true && (
            <span className="flex items-center gap-1.5 text-[10px] font-black text-green-700 bg-green-100 px-2.5 py-1 rounded-full uppercase tracking-tight border border-green-200/50">
              <CheckCircle2 className="w-3 h-3" />
              Contactado
            </span>
          )}
          {lead.tags && lead.tags.length > 0 && lead.tags.map((tag) => (
            <span
              key={tag.id}
              className="flex items-center gap-1.5 text-[10px] font-black px-2.5 py-1 rounded-full uppercase tracking-tight border"
              style={{
                backgroundColor: `${tag.color}20`,
                color: tag.color,
                borderColor: `${tag.color}50`
              }}
            >
              <TagIcon className="w-3 h-3" />
              {tag.label}
            </span>
          ))}
        </div>

        {/* 5. Telefone: borda tracejada, ícone verde, número, copiar */}
        <div className="flex items-center gap-2 text-sm font-bold bg-gray-50 border-2 border-dashed border-gray-200 px-3 py-2.5 rounded-xl mb-3 hover:bg-[#8CD955]/5 hover:border-[#8CD955]/40 transition-all group/phone">
          <Phone className="w-4 h-4 text-[#8CD955] shrink-0" />
          <span className="flex-1 truncate text-gray-800">{formatPhone(lead.phone)}</span>
          {lead.phone && (
            <button type="button" onClick={(e) => { e.stopPropagation(); copyPhone(); }} className="p-1.5 rounded-lg hover:bg-[#8CD955]/20 text-gray-500 hover:text-[#8CD955]" title="Copiar">
              <Copy className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* 6. Rodapé: Data | Último depósito ou Cronômetro (transferido) | Botão Chamar */}
        <div className="flex items-center justify-between gap-3 pt-2 border-t border-gray-100">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-[10px] text-gray-500 font-bold">
              <Clock className="w-3.5 h-3.5 shrink-0 text-gray-400" />
              <span>{createdDateFormatted}</span>
            </div>
            {lead.transferred && lead.transferred_at ? (
              <div className="flex items-center gap-1.5 text-[10px] font-bold mt-0.5 flex-wrap" title={`Prazo para conversão: ${transferDeadlineDays} dias. Contador em tempo real até o próximo dia.`}>
                <RefreshCw className="w-3.5 h-3.5 shrink-0 text-gray-400" />
                {(() => {
                  const transferredAt = new Date(lead.transferred_at);
                  const now = new Date();
                  const diffDays = Math.floor((now.getTime() - transferredAt.getTime()) / (1000 * 60 * 60 * 24));
                  const daysLeft = Math.max(0, transferDeadlineDays - diffDays);
                  const expired = diffDays >= transferDeadlineDays;
                  const countdown = !expired ? getCountdownToNextDay(transferredAt) : '';
                  return (
                    <>
                      <span className="text-gray-500">Prazo {transferDeadlineDays}d:</span>
                      {expired ? <span className="text-red-600">Expirado</span> : (
                        <>
                          <span className="text-red-600">{daysLeft} dia(s)</span>
                          {countdown && <span className="text-gray-500 tabular-nums">{countdown}</span>}
                        </>
                      )}
                    </>
                  );
                })()}
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-[10px] text-gray-500 font-medium mt-0.5">
                <RefreshCw className="w-3.5 h-3.5 shrink-0 text-gray-400" />
                <span>Último depósito: {lastDepositText}</span>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setShowContactFeedbackModal(true);
              setTimeout(() => { window.open(`https://wa.me/55${(lead.phone || '').replace(/\D/g, '')}`, '_blank'); }, 100);
            }}
            className="flex items-center justify-center gap-2 bg-[#8CD955] hover:bg-[#7BC84A] text-white py-2.5 px-4 rounded-xl text-xs font-black transition-all shadow-md shrink-0"
          >
            <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg>
            Chamar
          </button>
        </div>
      </div>
    );
  })();

  return (
    <React.Fragment>
      {compact ? compactCard : (
    <div 
      draggable
      onDragStart={(e) => onDragStart(e, lead.id)}
      className={`rounded-2xl border-2 p-5 hover:shadow-2xl transition-all cursor-grab active:cursor-grabbing group mb-6 ${getCardStyle()}`}
    >
      {/* Header: Avatar, Name, Stars */}
      <div className="flex items-start justify-between mb-4 gap-2">
        <div className="flex items-center gap-4 min-w-0">
          <div 
            className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-base shrink-0 shadow-sm border-2 border-white ${
              isVIP ? 'bg-indigo-600 text-white' : 
              isHighValue ? 'bg-amber-500 text-white' : 
              'bg-gray-200'
            }`}
            style={!isVIP && !isHighValue ? { color: '#8CD955', backgroundColor: '#8CD95520' } : {}}
          >
            {getInitials(lead.name)}
          </div>
          <div className="min-w-0 flex-1">
            <h4 className="font-extrabold text-gray-900 text-base leading-tight truncate pr-1 flex items-center gap-1" title={lead.name}>
              <span className="truncate">{lead.name}</span>
              {isVIP && <span className="text-indigo-600 shrink-0">💎</span>}
            </h4>
            <div className="flex flex-wrap items-center gap-2 mt-1.5 min-w-0">
              <div className="flex shrink-0">
                {[...Array(10)].map((_, i) => (
                  <button
                    key={i}
                    onClick={(e) => {
                      e.stopPropagation();
                      onStarsChange?.(lead.id, i + 1);
                    }}
                    className="focus:outline-none transition-transform active:scale-125"
                  >
                    <Star 
                      className="w-2.5 h-2.5"
                      fill={i < (lead.stars || 0) ? "#fbbf24" : "none"}
                      stroke={i < (lead.stars || 0) ? "#fbbf24" : "#e5e7eb"}
                      strokeWidth={2}
                    />
                  </button>
                ))}
              </div>
              <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md shrink-0 ${
                lead.is_affiliate ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-400'
              }`}>
                {lead.is_affiliate ? 'Afiliado' : 'Direto'}
              </span>
            </div>
            {lead.is_affiliate && lead.affiliate_name && (
              <div className="flex items-center gap-1.5 mt-1">
                <span className="text-[9px] text-gray-400 font-bold uppercase">Indicado por:</span>
                <span className="text-[10px] text-amber-600 font-black truncate max-w-[150px]" title={lead.affiliate_name}>
                  {lead.affiliate_name}
                </span>
              </div>
            )}
            {/* Timer para leads transferidos: contagem regressiva em tempo real (10d em Transferido, 90d no CRM principal) */}
            {lead.transferred && lead.transferred_at && (() => {
              const transferredAt = new Date(lead.transferred_at);
              const now = new Date();
              const diffMs = now.getTime() - transferredAt.getTime();
              const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
              const daysLeft = Math.max(0, transferDeadlineDays - diffDays);
              const expired = diffDays >= transferDeadlineDays;
              const label = `${transferDeadlineDays}d`;
              const countdown = !expired ? getCountdownToNextDay(transferredAt) : '';
              return (
                <div className="mt-1.5 flex items-center gap-1.5 text-gray-600" title={`Prazo para conversão: ${transferDeadlineDays} dias a partir da transferência. Contador em tempo real até o próximo dia. Após isso o lead pode ser repassado.`}>
                  <Clock className="w-3.5 h-3.5 flex-shrink-0" />
                  <span className="text-[10px] font-bold flex flex-wrap items-center gap-1.5">
                    Prazo {label}: {expired ? <span className="text-red-600">Expirado</span> : (
                      <>
                        <span className="text-red-600">{daysLeft} dia(s) restante(s)</span>
                        {countdown && <span className="text-gray-500 tabular-nums">{countdown}</span>}
                      </>
                    )}
                  </span>
                </div>
              );
            })()}
          </div>
        </div>
        
        <div className="flex items-center gap-1 shrink-0">
          {isAlert && <span className="p-1 animate-pulse" title="Alerta!"><AlertCircle className="w-6 h-6 text-red-500" /></span>}
          <button 
            onClick={async (e) => {
              e.stopPropagation();
              setShowAllDeposits(false);
              setShowAllWithdraws(false);
              setShowAllBets(false);
              setLeadDetails(lead);
              setShowDetailsModal(true);
              loadAllHistories();
            }}
            className="p-1.5 text-gray-400 hover:text-[#8CD955] hover:bg-[#8CD955]/10 rounded-lg transition-colors"
            title="Ver detalhes do lead"
          >
            <Eye className="w-5 h-5" />
          </button>
          <div 
            ref={menuRef}
            className="relative"
          >
            <button 
              onClick={() => setShowMenu(!showMenu)}
              className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <MoreVertical className="w-5 h-5" />
            </button>
            {showMenu && (
              <div className="absolute right-0 top-full mt-1 w-44 bg-white rounded-2xl shadow-2xl border border-gray-100 py-2 z-50">
                <button 
                  onClick={() => {
                    setShowAddTagModal(true);
                    setShowMenu(false);
                  }} 
                  className="w-full text-left px-4 py-2 text-sm text-gray-600 hover:bg-[#8CD955]/10 hover:text-[#8CD955] flex items-center gap-3 font-bold transition-colors"
                >
                  <TagIcon className="w-4 h-4" /> Adicionar Etiqueta
                </button>
                {lead.tags && lead.tags.length > 0 && (
                  <button 
                    onClick={() => {
                      setShowRemoveTagModal(true);
                      setShowMenu(false);
                    }} 
                    className="w-full text-left px-4 py-2 text-sm text-gray-600 hover:bg-red-50 hover:text-red-600 flex items-center gap-3 font-bold transition-colors border-t border-gray-100 mt-1 pt-2"
                  >
                    <XIcon className="w-4 h-4" /> Remover Etiqueta
                  </button>
                )}
                {/* Opção para ver todos os feedbacks - apenas se has_interaction = true */}
                {hasInteraction && (
                  <button 
                    onClick={async () => {
                      setShowMenu(false);
                      setShowAllFeedbacksModal(true);
                      await loadAllFeedbacks();
                    }} 
                    className="w-full text-left px-4 py-2 text-sm text-gray-600 hover:bg-blue-50 hover:text-blue-600 flex items-center gap-3 font-bold transition-colors border-t border-gray-100 mt-1 pt-2"
                  >
                    <MessageSquare className="w-4 h-4" /> Ver Todos os Feedbacks
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Stats Section - Depósitos, Apostas, Ganhos */}
      <div className="grid grid-cols-3 gap-2 mb-5">
        <div className="bg-gray-50/50 rounded-xl p-2.5 border border-gray-100 shadow-inner relative min-w-0">
          <p className="text-[9px] text-gray-400 uppercase font-black tracking-tighter mb-1 truncate">Depósitos</p>
          <p className="text-sm font-black text-gray-800 truncate">{formatCurrency(lead.total_depositado)}</p>
          {lead.total_depositos_count !== undefined && (
            <div className="absolute top-1 right-1 bg-[#8CD955]/20 text-[#8CD955] text-[8px] font-black px-1 py-0.5 rounded-sm border border-[#8CD955]/30" title="Quantidade de depósitos">
              {lead.total_depositos_count}x
            </div>
          )}
        </div>
        <div className="bg-gray-50/50 rounded-xl p-2.5 border border-gray-100 shadow-inner min-w-0">
          <p className="text-[9px] text-gray-400 uppercase font-black tracking-tighter mb-1 truncate">Apostas</p>
          <p className="text-sm font-black text-gray-800 truncate">{formatCurrency(lead.total_apostado)}</p>
        </div>
        <div className="bg-[#8CD955]/10 rounded-xl p-2.5 border border-[#8CD955]/30 shadow-inner min-w-0">
          <p className="text-[9px] text-[#8CD955] uppercase font-black tracking-tighter mb-1 truncate">Ganhos</p>
          <p className="text-sm font-black text-[#8CD955] truncate">{formatCurrency(lead.total_ganho)}</p>
        </div>
      </div>

      {/* Nível Estrela - barra de progresso e valor que falta (aposta estrela) */}
      {(lead as any).aposta_estrelas !== undefined && (lead as any).aposta_estrelas !== null && (() => {
        const wagered = Number((lead as any).aposta_estrelas) || 0;
        const info = getStarLevelInfo(wagered);
        const isMaxLevel = info.nextLevel === null;
        const levelLabel = info.currentLevel === 0
          ? 'Iniciante'
          : `${info.currentLevel} ${info.currentLevel === 1 ? 'Estrela' : 'Estrelas'}`;
        return (
          <div className="mb-5 rounded-xl p-3 border overflow-hidden" style={{ backgroundColor: '#8CD955', borderColor: 'rgba(140, 217, 85, 0.6)' }}>
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <Star className="w-4 h-4 shrink-0" fill="#ffffff" stroke="#ffffff" strokeWidth={1.5} />
                <span className="text-xs font-black truncate" style={{ color: '#ffffff' }}>Nível Estrela · {levelLabel}</span>
              </div>
              {!isMaxLevel && info.missingForNext !== null && (
                <span className="text-[10px] font-bold shrink-0" style={{ color: '#ffffff' }} title="Valor que falta para o próximo nível">
                  Falta {formatCurrency(info.missingForNext)}
                </span>
              )}
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'rgba(255, 255, 255, 0.35)' }}>
              <div
                className="h-full rounded-full transition-all duration-500 ease-out"
                style={{ width: `${info.progressPct}%`, backgroundColor: '#ffffff' }}
              />
            </div>
            {!isMaxLevel && info.nextLevel !== null && (
              <p className="text-[10px] font-semibold mt-1.5 truncate" style={{ color: '#ffffff' }}>
                Próximo: {info.nextLevel} {info.nextLevel === 1 ? 'Estrela' : 'Estrelas'} ({formatCurrency(info.nextMin || 0)})
              </p>
            )}
            {isMaxLevel && (
              <p className="text-[10px] font-semibold mt-1.5" style={{ color: '#ffffff' }}>Nível máximo alcançado</p>
            )}
          </div>
        );
      })()}

      {/* Tags & Temperature */}
      <div className="flex flex-wrap items-center gap-2.5 mb-5">
        {(() => {
          const temperature = lead.temperature || 'cold';
          const emoji = getTemperatureEmoji(temperature);
          const label = getTemperatureLabel(temperature);
          
          // Define cores e estilos baseados na temperatura
          const temperatureStyles: Record<string, { text: string; bg: string; border: string; icon?: React.ReactNode }> = {
            cold: {
              text: 'text-blue-700',
              bg: 'bg-blue-100',
              border: 'border-blue-200/50',
              icon: <Snowflake className="w-3.5 h-3.5" />
            },
            very_cold: {
              text: 'text-cyan-700',
              bg: 'bg-cyan-100',
              border: 'border-cyan-200/50',
              icon: <Snowflake className="w-3.5 h-3.5" />
            },
            active: {
              text: 'text-orange-700',
              bg: 'bg-orange-100',
              border: 'border-orange-200/50',
              icon: <Flame className="w-3.5 h-3.5" />
            },
            hot: {
              text: 'text-red-700',
              bg: 'bg-red-100',
              border: 'border-red-200/50',
              icon: <Flame className="w-3.5 h-3.5" />
            },
            cooling: {
              text: 'text-purple-700',
              bg: 'bg-purple-100',
              border: 'border-purple-200/50',
              icon: <Snowflake className="w-3.5 h-3.5" />
            }
          };
          
          const style = temperatureStyles[temperature] || temperatureStyles.cold;
          
          return (
            <span className={`flex items-center gap-2 text-[10px] font-black ${style.text} ${style.bg} px-3 py-1.5 rounded-full uppercase tracking-tight shadow-sm border ${style.border}`}>
              <span className="text-xs">{emoji}</span>
              {label}
            </span>
          );
        })()}
        
        {/* Badge Contactado - para todos com has_interaction = true */}
        {lead.has_interaction === true && (
          <span className="flex items-center gap-2 text-[10px] font-black text-green-700 bg-green-100 px-3 py-1.5 rounded-full uppercase tracking-tight shadow-sm border border-green-200/50">
            <CheckCircle2 className="w-3.5 h-3.5" /> Contactado
          </span>
        )}
        
        {isHighValue && (
          <span className="text-[10px] font-black text-amber-700 bg-amber-100 px-3 py-1.5 rounded-full uppercase tracking-tight flex items-center gap-2 shadow-sm border border-amber-200/50">
            <Target className="w-3.5 h-3.5" /> VIP High
          </span>
        )}

        {/* Tags do Lead */}
        {lead.tags && lead.tags.length > 0 && lead.tags.map((tag) => (
          <span
            key={tag.id}
            className="flex items-center gap-2 text-[10px] font-black px-3 py-1.5 rounded-full uppercase tracking-tight shadow-sm border"
            style={{
              backgroundColor: `${tag.color}20`,
              color: tag.color,
              borderColor: `${tag.color}50`
            }}
          >
            <TagIcon className="w-3 h-3" />
            {tag.label}
          </span>
        ))}

        {/* Status de Contato */}
        {isContacted && (
          <span className="flex items-center gap-2 text-[10px] font-black text-blue-700 bg-blue-100 px-3 py-1.5 rounded-full uppercase tracking-tight shadow-sm border border-blue-200/50">
            <MessageSquare className="w-3.5 h-3.5" /> Contacto
          </span>
        )}
      </div>

      {/* Contact Info - Campo de Telefone Estilizado */}
      <div className="mb-6">
        <div className="flex items-center gap-3 text-sm text-gray-700 font-bold bg-gray-50 border-2 border-dashed border-gray-200 px-4 py-3 rounded-2xl hover:bg-[#8CD955]/10 hover:border-[#8CD955] transition-all group/phone">
          <Phone className="w-4 h-4 text-[#8CD955] group-hover/phone:scale-110 transition-transform shrink-0" /> 
          <span className="flex-1">{formatPhone(lead.phone)}</span>
          {lead.phone && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                copyPhone();
              }}
              className="p-1.5 text-gray-400 hover:text-[#8CD955] hover:bg-[#8CD955]/10 rounded-lg transition-all shrink-0 inline-flex items-center"
              title="Copiar número"
            >
              {copiedPhone ? (
                <Check className="w-4 h-4 text-[#8CD955]" />
              ) : (
                <Copy className="w-4 h-4" />
              )}
            </button>
          )}
        </div>
      </div>

      {/* Footer: Date and Action */}
      <div className="flex items-center justify-between pt-4 border-t-2 border-gray-50">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5 text-[10px] text-gray-500 font-bold" title="Data de cadastro">
            <Clock className="w-3.5 h-3.5 text-gray-400" /> 
            <span>{formatCreatedDate(lead.created_at || lead.createdAt)}</span>
          </div>
          {lead.last_deposit_at ? (
            <>
              <div className="flex items-center gap-1.5 text-[10px] text-gray-500 font-bold" title="Último depósito">
                <History className="w-3.5 h-3.5 text-gray-400" /> 
                <span>{formatLastDeposit(lead.last_deposit_at)}</span>
              </div>
              {lead.last_deposit_value !== null && lead.last_deposit_value !== undefined && (
                <div className="flex items-center gap-1.5 text-[10px] text-gray-500 font-bold" title="Último valor depositado">
                  <Target className="w-3.5 h-3.5 text-gray-400" /> 
                  <span>Último valor depositado: {formatCurrency(lead.last_deposit_value)}</span>
                </div>
              )}
            </>
          ) : (
            <div className="flex items-center gap-1.5 text-[10px] text-gray-400 font-medium italic">
              <History className="w-3.5 h-3.5" /> 
              <span>Último depósito: Nunca depositou</span>
            </div>
          )}
        </div>
        
        <div className="flex items-center gap-2">
          {/* Botão para ver feedback (apenas se status for contato) */}
          {isContacted && (
            <button
              onClick={async () => {
                // Busca o feedback quando o botão for clicado
                await loadFeedback();
                setShowFeedbackViewModal(true);
              }}
              disabled={loadingFeedback}
              className="flex items-center gap-2 bg-blue-500 hover:bg-blue-600 text-white px-4 py-2.5 rounded-2xl text-xs font-black transition-all shadow-lg shadow-blue-500/20 active:scale-95 hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Ver feedback do contato"
            >
              {loadingFeedback ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Carregando...
                </>
              ) : (
                <>
                  <Eye className="w-4 h-4" />
                  Feedback
                </>
              )}
            </button>
          )}
          
          {/* Botão Chamar - abre modal em todos os blocos */}
          <button
            onClick={() => {
              setShowContactFeedbackModal(true);
              // Abre WhatsApp em nova aba após um pequeno delay
              setTimeout(() => {
                window.open(`https://wa.me/55${lead.phone.replace(/\D/g, '')}`, '_blank');
              }, 100);
            }}
            className="flex items-center gap-2 bg-[#8CD955] hover:bg-[#7BC84A] text-white px-5 py-2.5 rounded-2xl text-xs font-black transition-all shadow-lg shadow-[#8CD955]/20 active:scale-95 hover:-translate-y-0.5"
          >
            <svg 
              className="w-4.5 h-4.5 fill-current" 
              viewBox="0 0 24 24" 
              xmlns="http://www.w3.org/2000/svg"
            >
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/>
            </svg>
            Chamar
          </button>
        </div>
      </div>
    </div>
      ) }
      {/* Add Tag Modal */}
      <AddTagModal
        isOpen={showAddTagModal}
        onClose={() => setShowAddTagModal(false)}
        leadId={lead.id}
        currentTags={lead.tags || []}
        targetUserId={targetUserId}
        onTagAdded={(addedTag) => {
          onTagAdded?.(lead.id, addedTag);
          setShowAddTagModal(false);
        }}
      />

      {/* Remove Tag Modal */}
      <RemoveTagModal
        isOpen={showRemoveTagModal}
        onClose={() => setShowRemoveTagModal(false)}
        leadId={lead.id}
        currentTags={lead.tags || []}
        targetUserId={targetUserId}
        onTagRemoved={(tagId) => {
          onTagRemoved?.(lead.id, tagId);
        }}
      />

      {/* Contact Feedback Modal */}
      {consultorUserId && (
        <ContactFeedbackModal
          isOpen={showContactFeedbackModal}
          onClose={() => {
            setShowContactFeedbackModal(false);
            setEditingFeedback(null);
          }}
          leadId={lead.id}
          leadName={lead.name}
          userId={consultorUserId}
          leadOriginalId={lead.original_id}
          bancaUrl={selectedBancaUrl}
          bancaId={lead.banca_id}
          bancaName={lead.banca_name}
          targetUserId={targetUserId}
          initialFeedback={editingFeedback?.feedback || ''}
          feedbackId={editingFeedback?.id}
          onFeedbackSaved={() => {
            onRefresh?.();
            if (showAllFeedbacksModal) {
              loadAllFeedbacks();
            }
          }}
        />
      )}

      {/* View Feedback Modal */}
      {showFeedbackViewModal && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowFeedbackViewModal(false);
              setViewingSingleFeedback(null);
            }
          }}
        >
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md z-10 animate-in fade-in zoom-in duration-200">
            <div className="flex items-center justify-between p-6 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-100 rounded-lg">
                  <MessageSquare className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-gray-800">Detalhes do Feedback</h2>
                  <p className="text-sm text-gray-500 mt-0.5">Cliente: {lead.name}</p>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowFeedbackViewModal(false);
                  setViewingSingleFeedback(null);
                }}
                className="p-2 hover:bg-gray-100 rounded-lg transition text-gray-500 hover:text-gray-700"
                aria-label="Fechar"
              >
                <XIcon className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6">
              {(viewingSingleFeedback?.feedback || viewingSingleFeedback?.message || feedback) ? (
                <>
                  <div className="mb-4">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-black text-gray-500 uppercase">Por:</span>
                      <span className="text-sm font-bold text-gray-800">
                        {viewingSingleFeedback?.consultant?.full_name || viewingSingleFeedback?.consultant_name || 'Consultor'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Clock className="w-3.5 h-3.5 text-gray-400" />
                      <span className="text-xs text-gray-500 font-semibold">
                        {viewingSingleFeedback?.created_at ? new Date(viewingSingleFeedback.created_at).toLocaleString('pt-BR') : 'Data não disponível'}
                      </span>
                    </div>
                  </div>
                  <div className="bg-gray-50 border-2 border-gray-200 rounded-xl p-4 text-sm text-gray-700 whitespace-pre-wrap">
                    {viewingSingleFeedback?.feedback || viewingSingleFeedback?.message || feedback}
                  </div>
                </>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  <MessageSquare className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                  <p className="font-semibold">Nenhum feedback encontrado</p>
                </div>
              )}
            </div>
            <div className="flex items-center justify-end p-6 border-t border-gray-100">
              <button
                onClick={() => {
                  setShowFeedbackViewModal(false);
                  setViewingSingleFeedback(null);
                }}
                className="px-6 py-2 bg-[#8CD955] hover:bg-[#7BC84A] text-white text-sm font-bold rounded-xl transition-all shadow-md shadow-[#8CD955]/20"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* All Feedbacks Modal */}
      {showAllFeedbacksModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowAllFeedbacksModal(false);
            }
          }}
        >
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] z-10 animate-in fade-in zoom-in duration-200 flex flex-col">
            <div className="flex items-center justify-between p-6 border-b border-gray-100 flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-green-100 rounded-lg">
                  <MessageSquare className="w-5 h-5 text-green-600" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-gray-800">Todos os Feedbacks</h2>
                  <p className="text-sm text-gray-500 mt-0.5">Cliente: {lead.name}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setEditingFeedback(null);
                    setShowContactFeedbackModal(true);
                  }}
                  className="flex items-center gap-2 bg-[#8CD955] hover:bg-[#7BC84A] text-white px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-md shadow-[#8CD955]/20"
                >
                  <Plus className="w-4 h-4" />
                  Novo
                </button>
                <button
                  onClick={() => setShowAllFeedbacksModal(false)}
                  className="p-2 hover:bg-gray-100 rounded-lg transition text-gray-500 hover:text-gray-700"
                  aria-label="Fechar"
                >
                  <XIcon className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
              {loadingAllFeedbacks ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin text-[#8CD955]" />
                  <span className="ml-3 text-gray-600 font-semibold">Carregando feedbacks...</span>
                </div>
              ) : allFeedbacks.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <MessageSquare className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                  <p className="font-semibold">Nenhum feedback encontrado</p>
                  <p className="text-sm mt-1">Ainda não há feedbacks registrados para este cliente.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {allFeedbacks.map((fb: any, index: number) => {
                    const feedbackDate = fb.created_at || fb.createdAt;
                    const formattedDate = feedbackDate 
                      ? new Date(feedbackDate).toLocaleString('pt-BR', {
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })
                      : 'Data não disponível';
                    
                    const consultantName = fb.consultant?.full_name || fb.consultant_name || 'Consultor';
                    const consultantEmail = fb.consultant?.email || fb.consultant_email || '';
                    const isOwnFeedback = fb.consultant_user_id === consultorUserId;

                    return (
                      <div key={fb.id || index} className="bg-gray-50 border-2 border-gray-200 rounded-xl p-4 hover:border-[#8CD955]/50 transition-colors">
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-xs font-black text-gray-500 uppercase">Por:</span>
                              <span className="text-sm font-bold text-gray-800">{consultantName}</span>
                              {consultantEmail && (
                                <span className="text-xs text-gray-500">({consultantEmail})</span>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <Clock className="w-3.5 h-3.5 text-gray-400" />
                              <span className="text-xs text-gray-500 font-semibold">{formattedDate}</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => {
                                setViewingSingleFeedback(fb);
                                setShowFeedbackViewModal(true);
                              }}
                              className="p-1.5 text-gray-400 hover:text-[#8CD955] hover:bg-white rounded-lg transition-all"
                              title="Visualizar feedback"
                            >
                              <Eye className="w-4 h-4" />
                            </button>
                            {isOwnFeedback && fb.id && (
                              <>
                                <button
                                  onClick={() => {
                                    setEditingFeedback(fb);
                                    setShowContactFeedbackModal(true);
                                  }}
                                  className="p-1.5 text-gray-400 hover:text-amber-500 hover:bg-white rounded-lg transition-all"
                                  title="Editar feedback"
                                >
                                  <Edit2 className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => handleDeleteFeedback(fb.id)}
                                  disabled={deletingFeedbackId === fb.id}
                                  className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-white rounded-lg transition-all disabled:opacity-50"
                                  title="Excluir feedback"
                                >
                                  {deletingFeedbackId === fb.id ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                  ) : (
                                    <Trash2 className="w-4 h-4" />
                                  )}
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                        <div className="mt-3 pt-3 border-t border-gray-200">
                          <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed line-clamp-3">
                            {fb.feedback || fb.message || 'Feedback não disponível'}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="flex items-center justify-end p-6 border-t border-gray-100 flex-shrink-0">
              <button
                onClick={() => setShowAllFeedbacksModal(false)}
                className="px-6 py-2 bg-[#8CD955] hover:bg-[#7BC84A] text-white text-sm font-bold rounded-xl transition-all shadow-md shadow-[#8CD955]/20"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Detalhes do Lead */}
      {showDetailsModal && (
        <div 
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-2 sm:p-4"
          onClick={() => {
            setShowDetailsModal(false);
            setLeadDetails(null);
            // Reseta os estados de visualização
            setShowAllDeposits(false);
            setShowAllWithdraws(false);
            setShowAllBets(false);
          }}
        >
          <div 
            className="bg-white rounded-xl sm:rounded-2xl shadow-2xl w-full max-w-3xl max-h-[95vh] sm:max-h-[90vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header do Modal */}
            <div className="sticky top-0 bg-white border-b border-gray-200 px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between z-10">
              <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
                <div 
                  className={`w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center font-bold text-base sm:text-lg shrink-0 shadow-sm border-2 border-white ${
                    isVIP ? 'bg-indigo-600 text-white' : 
                    isHighValue ? 'bg-amber-500 text-white' : 
                    'bg-gray-200'
                  }`}
                  style={!isVIP && !isHighValue ? { color: '#8CD955', backgroundColor: '#8CD95520' } : {}}
                >
                  {getInitials(lead.name)}
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="text-lg sm:text-xl font-bold text-gray-800 flex items-center gap-2 truncate">
                    <span className="truncate">{lead.name}</span>
                    {isVIP && <span className="text-indigo-600 shrink-0">💎</span>}
                  </h2>
                  <p className="text-xs sm:text-sm text-gray-500 truncate">Detalhes completos do lead</p>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowDetailsModal(false);
                  setLeadDetails(null);
                  // Reseta os estados de visualização
                  setShowAllDeposits(false);
                  setShowAllWithdraws(false);
                  setShowAllBets(false);
                }}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors shrink-0 ml-2"
              >
                <XIcon className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            {/* Conteúdo do Modal */}
            <div className="overflow-y-auto flex-1 px-4 sm:px-6 py-4 sm:py-6 space-y-4 sm:space-y-6">
              {/* Informações Básicas */}
              <div className="bg-gray-50 rounded-lg sm:rounded-xl p-4 sm:p-5">
                <h3 className="text-base sm:text-lg font-bold text-gray-800 mb-3 sm:mb-4 flex items-center gap-2">
                  <User className="w-4 h-4 sm:w-5 sm:h-5 text-[#8CD955] shrink-0" />
                  <span>Informações Básicas</span>
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                  <div className="sm:col-span-2">
                    <p className="text-xs font-bold text-gray-500 uppercase mb-1">Nome Completo</p>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-gray-800 break-words">{lead.name} {lead.last_name || ''}</span>
                      <button
                        onClick={copyName}
                        className="p-1.5 text-gray-400 hover:text-[#8CD955] hover:bg-[#8CD955]/10 rounded-lg transition-all shrink-0 inline-flex items-center"
                        title="Copiar nome"
                      >
                        {copiedName ? (
                          <Check className="w-4 h-4 text-[#8CD955]" />
                        ) : (
                          <Copy className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-gray-500 uppercase mb-1">Email</p>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-gray-800 break-all">{lead.email || '-'}</span>
                      {lead.email && (
                        <button
                          onClick={copyEmail}
                          className="p-1.5 text-gray-400 hover:text-[#8CD955] hover:bg-[#8CD955]/10 rounded-lg transition-all shrink-0 inline-flex items-center"
                          title="Copiar email"
                        >
                          {copiedEmail ? (
                            <Check className="w-4 h-4 text-[#8CD955]" />
                          ) : (
                            <Copy className="w-4 h-4" />
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-gray-500 uppercase mb-1">Telefone</p>
                    <p className="text-sm font-semibold text-gray-800 break-words">{formatPhone(lead.phone) || '-'}</p>
                  </div>
                  {(lead as any).whatsapp && (
                    <div>
                      <p className="text-xs font-bold text-gray-500 uppercase mb-1">WhatsApp</p>
                      <p className="text-sm font-semibold text-gray-800 break-words">{formatPhone((lead as any).whatsapp)}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-xs font-bold text-gray-500 uppercase mb-1">Data de Cadastro</p>
                    <p className="text-sm font-semibold text-gray-800">{formatCreatedDate(lead.created_at)}</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-gray-500 uppercase mb-1">Status</p>
                    <p className="text-sm font-semibold text-gray-800 capitalize">{lead.status || '-'}</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-gray-500 uppercase mb-1">Temperatura</p>
                    <p className="text-sm font-semibold text-gray-800">
                      {lead.temperature ? `${getTemperatureEmoji(lead.temperature)} ${getTemperatureLabel(lead.temperature)}` : '-'}
                    </p>
                  </div>
                  {lead.banca_name && (
                    <div className="sm:col-span-2">
                      <p className="text-xs font-bold text-gray-500 uppercase mb-1">Cadastrado na banca</p>
                      <p className="text-sm font-semibold text-gray-800">{lead.banca_name}</p>
                    </div>
                  )}
                  {(lead as any).user_level && (
                    <div>
                      <p className="text-xs font-bold text-gray-500 uppercase mb-1">Nível do Usuário</p>
                      <p className="text-sm font-semibold text-gray-800">{(lead as any).user_level || '-'}</p>
                    </div>
                  )}
                  {lead.origin && (
                    <div className="sm:col-span-2">
                      <p className="text-xs font-bold text-gray-500 uppercase mb-1">Origem</p>
                      <p className="text-sm font-semibold text-gray-800 break-words">{lead.origin}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Informações Financeiras - fluxo: Entrada → Apostas → Resultados → Bônus/Outros */}
              <div className="bg-green-50 rounded-lg sm:rounded-xl p-4 sm:p-5">
                <h3 className="text-base sm:text-lg font-bold text-gray-800 mb-3 sm:mb-4 flex items-center gap-2">
                  <Target className="w-4 h-4 sm:w-5 sm:h-5 text-[#8CD955] shrink-0" />
                  <span>Informações Financeiras</span>
                </h3>
                {(() => {
                  const L = leadDetails || lead;
                  const hasLoteriaBichao = (L as any).total_apostado_loteria != null || (L as any).total_apostado_bichao != null;
                  return (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                      {/* Entrada */}
                      <div className="bg-white rounded-lg p-3 sm:p-4 border border-gray-200">
                        <p className="text-xs font-bold text-gray-500 uppercase mb-1">Total Depositado</p>
                        <p className="text-base sm:text-lg font-bold text-gray-800">{formatCurrency(L.total_depositado || 0)}</p>
                      </div>
                      <div className="bg-white rounded-lg p-3 sm:p-4 border border-gray-200">
                        <p className="text-xs font-bold text-gray-500 uppercase mb-1">Qtd. Depósitos</p>
                        <p className="text-base sm:text-lg font-bold text-gray-800">{L.total_depositos_count ?? 0}</p>
                      </div>
                      <div className="bg-white rounded-lg p-3 sm:p-4 border-2 border-gray-200">
                        <p className="text-xs font-bold text-gray-500 uppercase mb-2">Último Depósito</p>
                        <p className="text-xs sm:text-sm font-semibold text-gray-700 mb-1">
                          Data: <span className="text-gray-900">{L.last_deposit_at ? formatRelativeDate(L.last_deposit_at, 'Nunca') : 'Nunca'}</span>
                        </p>
                        <p className="text-base sm:text-lg font-bold text-gray-800">
                          Valor: {L.last_deposit_value != null ? formatCurrency(L.last_deposit_value) : 'R$ 0,00'}
                        </p>
                      </div>
                      {/* Apostas */}
                      <div className="bg-white rounded-lg p-3 sm:p-4 border border-gray-200">
                        <p className="text-xs font-bold text-gray-500 uppercase mb-1">Total Apostado</p>
                        <p className="text-base sm:text-lg font-bold text-gray-800">{formatCurrency(L.total_apostado || 0)}</p>
                      </div>
                      {hasLoteriaBichao && (
                        <>
                          <div className="bg-white rounded-lg p-3 sm:p-4 border border-gray-200">
                            <p className="text-xs font-bold text-gray-500 uppercase mb-1">Apostado Loteria</p>
                            <p className="text-base sm:text-lg font-bold text-gray-800">{formatCurrency((L as any).total_apostado_loteria ?? 0)}</p>
                          </div>
                          <div className="bg-white rounded-lg p-3 sm:p-4 border border-gray-200">
                            <p className="text-xs font-bold text-gray-500 uppercase mb-1">Apostado Bichão</p>
                            <p className="text-base sm:text-lg font-bold text-gray-800">{formatCurrency((L as any).total_apostado_bichao ?? 0)}</p>
                          </div>
                        </>
                      )}
                      {/* Resultados */}
                      <div className="bg-white rounded-lg p-3 sm:p-4 border border-[#8CD955]/30">
                        <p className="text-xs font-bold text-gray-500 uppercase mb-1">Total Ganho</p>
                        <p className="text-base sm:text-lg font-bold text-[#8CD955]">{formatCurrency(L.total_ganho || 0)}</p>
                      </div>
                      <div className="bg-white rounded-lg p-3 sm:p-4 border border-gray-200">
                        <p className="text-xs font-bold text-gray-500 uppercase mb-1">Total Saque</p>
                        <p className="text-base sm:text-lg font-bold text-gray-800">{formatCurrency(L.total_saque ?? 0)}</p>
                      </div>
                      <div className="bg-white rounded-lg p-3 sm:p-4 border border-gray-200">
                        <p className="text-xs font-bold text-gray-500 uppercase mb-1">Saldo Banca</p>
                        <p className="text-base sm:text-lg font-bold text-gray-800">{formatCurrency(L.balance ?? 0)}</p>
                      </div>
                      <div className="bg-white rounded-lg p-3 sm:p-4 border border-gray-200">
                        <p className="text-xs font-bold text-gray-500 uppercase mb-1">Disponível para Saque</p>
                        <p className="text-base sm:text-lg font-bold text-gray-800">{formatCurrency((L as any).available_withdraw ?? 0)}</p>
                      </div>
                      {/* Bônus e outros */}
                      <div className="bg-white rounded-lg p-3 sm:p-4 border border-gray-200">
                        <p className="text-xs font-bold text-gray-500 uppercase mb-1">Bonus Ganho</p>
                        <p className="text-base sm:text-lg font-bold text-gray-800">{formatCurrency(L.bonus ?? 0)}</p>
                      </div>
                      <div className="bg-white rounded-lg p-3 sm:p-4 border border-gray-200">
                        <p className="text-xs font-bold text-gray-500 uppercase mb-1">Valor Convertido</p>
                        <p className="text-base sm:text-lg font-bold text-gray-800">{formatCurrency(L.convert ?? 0)}</p>
                      </div>
                      <div className="bg-white rounded-lg p-3 sm:p-4 border border-gray-200">
                        <p className="text-xs font-bold text-gray-500 uppercase mb-1">Total Afiliados</p>
                        <p className="text-base sm:text-lg font-bold text-gray-800" title="Quantidade de pessoas que se cadastraram pelo link deste cliente">{L.total_afiliate ?? 0}</p>
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* Classificações - Nível Estrela, valor no programa, tipo de cliente, avaliação */}
              <div className="rounded-lg sm:rounded-xl p-4 sm:p-5 border border-gray-200 bg-gradient-to-b from-gray-50 to-white">
                <h3 className="text-base sm:text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                  <Star className="w-4 h-4 sm:w-5 sm:h-5 text-[#8CD955] shrink-0" />
                  <span>Classificações</span>
                </h3>

                {/* Bloco principal: Nível Estrela (programa) + valor acumulado */}
                {((leadDetails || lead) as any).aposta_estrelas !== undefined && ((leadDetails || lead) as any).aposta_estrelas !== null ? (() => {
                  const wagered = Number(((leadDetails || lead) as any).aposta_estrelas) || 0;
                  const info = getStarLevelInfo(wagered);
                  const isMaxLevel = info.nextLevel === null;
                  const levelLabel = info.currentLevel === 0
                    ? 'Iniciante'
                    : `${info.currentLevel} ${info.currentLevel === 1 ? 'Estrela' : 'Estrelas'}`;
                  return (
                    <div className="rounded-xl p-4 sm:p-5 mb-4 overflow-hidden" style={{ backgroundColor: '#8CD955', border: '1px solid rgba(140, 217, 85, 0.6)' }}>
                      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                        <div className="flex items-center gap-2">
                          <Star className="w-6 h-6 shrink-0" fill="#ffffff" stroke="#ffffff" strokeWidth={1.5} />
                          <span className="text-lg sm:text-xl font-black" style={{ color: '#ffffff' }}>{levelLabel}</span>
                        </div>
                        {!isMaxLevel && info.missingForNext !== null && (
                          <span className="text-sm font-bold" style={{ color: '#ffffff' }}>
                            Falta {formatCurrency(info.missingForNext)}
                          </span>
                        )}
                      </div>
                      <div className="mb-3">
                        <p className="text-[10px] uppercase font-bold tracking-wider opacity-90 mb-0.5" style={{ color: '#ffffff' }}>Valor no programa (apostado)</p>
                        <p className="text-2xl sm:text-3xl font-black tabular-nums" style={{ color: '#ffffff' }}>{formatCurrency(wagered)}</p>
                      </div>
                      <div className="h-3 rounded-full overflow-hidden mb-2" style={{ backgroundColor: 'rgba(255, 255, 255, 0.35)' }}>
                        <div
                          className="h-full rounded-full transition-all duration-500 ease-out"
                          style={{ width: `${info.progressPct}%`, backgroundColor: '#ffffff' }}
                        />
                      </div>
                      {!isMaxLevel && info.nextLevel !== null ? (
                        <p className="text-xs font-semibold opacity-95" style={{ color: '#ffffff' }}>
                          Próximo: {info.nextLevel} {info.nextLevel === 1 ? 'Estrela' : 'Estrelas'} — meta {formatCurrency(info.nextMin || 0)}
                        </p>
                      ) : (
                        <p className="text-xs font-semibold opacity-95" style={{ color: '#ffffff' }}>Nível máximo</p>
                      )}
                    </div>
                  );
                })() : (
                  <div className="rounded-xl p-4 sm:p-5 mb-4 bg-gray-100 border border-gray-200">
                    <p className="text-sm font-semibold text-gray-500">Sem dados de nível estrela (aposta no programa)</p>
                  </div>
                )}

                {/* Tipo de cliente - uma linha de badges */}
                <div className="mb-4">
                  <p className="text-[10px] uppercase font-bold text-gray-500 tracking-wider mb-2">Tipo de cliente</p>
                  <div className="flex flex-wrap gap-2">
                    {isVIP && (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-100 text-indigo-800 text-sm font-bold rounded-lg border border-indigo-200/60">💎 VIP</span>
                    )}
                    {isHighValue && (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-100 text-amber-800 text-sm font-bold rounded-lg border border-amber-200/60">💰 Alto Valor</span>
                    )}
                    {isOpportunity && (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-orange-100 text-orange-800 text-sm font-bold rounded-lg border border-orange-200/60">🎯 Oportunidade</span>
                    )}
                    {isAlert && (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-100 text-red-800 text-sm font-bold rounded-lg border border-red-200/60">⚠️ Alerta</span>
                    )}
                    {lead.is_affiliate ? (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-100 text-amber-800 text-sm font-bold rounded-lg border border-amber-200/60">Afiliado</span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-200 text-gray-700 text-sm font-bold rounded-lg border border-gray-300/60">Direto</span>
                    )}
                  </div>
                </div>

                {lead.affiliate_name && (
                  <div className="mt-4 pt-4 border-t border-gray-200">
                    <p className="text-[10px] uppercase font-bold text-gray-500 tracking-wider mb-1">Indicado por</p>
                    <p className="text-sm font-semibold text-amber-700 break-words">{lead.affiliate_name}</p>
                  </div>
                )}
              </div>

              {/* Saques e Vitórias - dados do lead já vêm do card (sem nova busca na API) */}
              <div className="bg-yellow-50 rounded-lg sm:rounded-xl p-4 sm:p-5">
                  <h3 className="text-base sm:text-lg font-bold text-gray-800 mb-3 sm:mb-4 flex items-center gap-2">
                    <Target className="w-4 h-4 sm:w-5 sm:h-5 text-[#8CD955] shrink-0" />
                    <span>Saques e Vitórias</span>
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                    {(leadDetails || lead).total_saque !== undefined && (
                      <div className="bg-white rounded-lg p-3 sm:p-4 border border-gray-200">
                        <p className="text-xs font-bold text-gray-500 uppercase mb-1">Total Sacado</p>
                        <p className="text-base sm:text-lg font-bold text-gray-800">{formatCurrency((leadDetails || lead).total_saque || 0)}</p>
                      </div>
                    )}
                    {/* Último Saque - Data e Valor juntos */}
                    <div className="bg-white rounded-lg p-3 sm:p-4 border-2 border-gray-200">
                      <p className="text-xs font-bold text-gray-500 uppercase mb-2">Último Saque</p>
                      <p className="text-xs sm:text-sm font-semibold text-gray-700 mb-1">
                        Data: <span className="text-gray-900">
                          {(leadDetails || lead).last_withdraw_at 
                            ? formatRelativeDate((leadDetails || lead).last_withdraw_at!, 'Nunca sacou')
                            : 'Nunca sacou'}
                        </span>
                      </p>
                      <p className="text-base sm:text-lg font-bold text-gray-800">
                        Valor: {(leadDetails || lead).last_withdraw_value 
                          ? formatCurrency((leadDetails || lead).last_withdraw_value!)
                          : 'R$ 0,00'}
                      </p>
                    </div>
                    {/* Último Ganho - Data e Valor */}
                    <div className="bg-white rounded-lg p-3 sm:p-4 border-2 border-[#8CD955]/30">
                      <p className="text-xs font-bold text-gray-500 uppercase mb-2">Último Ganho</p>
                      <p className="text-xs sm:text-sm font-semibold text-gray-700 mb-1">
                        Data: <span className="text-gray-900">
                          {(leadDetails || lead).last_winner_at
                            ? formatRelativeDate((leadDetails || lead).last_winner_at!, 'Nunca')
                            : 'Nunca'}
                        </span>
                      </p>
                      <p className="text-base sm:text-lg font-bold text-[#8CD955]">
                        Valor: {(leadDetails || lead).last_winner_value
                          ? formatCurrency((leadDetails || lead).last_winner_value!)
                          : 'R$ 0,00'}
                      </p>
                    </div>
                  </div>
                </div>

              {/* Informações do Consultor */}
              {((lead as any).consultant_name || (lead as any).consultant_email) && (
                <div className="bg-indigo-50 rounded-lg sm:rounded-xl p-4 sm:p-5">
                  <h3 className="text-base sm:text-lg font-bold text-gray-800 mb-3 sm:mb-4 flex items-center gap-2">
                    <User className="w-4 h-4 sm:w-5 sm:h-5 text-[#8CD955] shrink-0" />
                    <span>Consultor Responsável</span>
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                    {(lead as any).consultant_name && (
                      <div className="bg-white rounded-lg p-3 sm:p-4 border border-gray-200">
                        <p className="text-xs font-bold text-gray-500 uppercase mb-1">Nome do Consultor</p>
                        <p className="text-sm font-semibold text-gray-800 break-words">{(lead as any).consultant_name}</p>
                      </div>
                    )}
                    {(lead as any).consultant_email && (
                      <div className="bg-white rounded-lg p-3 sm:p-4 border border-gray-200">
                        <p className="text-xs font-bold text-gray-500 uppercase mb-1">Email do Consultor</p>
                        <p className="text-sm font-semibold text-gray-800 break-all">{(lead as any).consultant_email}</p>
                      </div>
                    )}
                    {(lead as any).consultant_id && (
                      <div className="bg-white rounded-lg p-3 sm:p-4 border border-gray-200 sm:col-span-2">
                        <p className="text-xs font-bold text-gray-500 uppercase mb-1">ID do Consultor</p>
                        <p className="text-sm font-semibold text-gray-800">#{(lead as any).consultant_id}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Interações e Histórico */}
              <div className="bg-purple-50 rounded-lg sm:rounded-xl p-4 sm:p-5">
                <h3 className="text-base sm:text-lg font-bold text-gray-800 mb-3 sm:mb-4 flex items-center gap-2">
                  <History className="w-4 h-4 sm:w-5 sm:h-5 text-[#8CD955] shrink-0" />
                  <span>Histórico e Interações</span>
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                  <div className="bg-white rounded-lg p-3 sm:p-4 border border-gray-200">
                    <p className="text-xs font-bold text-gray-500 uppercase mb-1">Última Interação</p>
                    <p className="text-sm font-semibold text-gray-800">
                      {lead.last_interaction || lead.lastInteractionAt 
                        ? formatCreatedDate(lead.last_interaction || lead.lastInteractionAt) 
                        : 'Nunca'}
                    </p>
                  </div>
                  <div className="bg-white rounded-lg p-3 sm:p-4 border border-gray-200">
                    <p className="text-xs font-bold text-gray-500 uppercase mb-1">Tem Interação</p>
                    <p className="text-sm font-semibold text-gray-800">
                      {lead.has_interaction ? '✅ Sim' : '❌ Não'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Histórico de Depósitos */}
              <div className="bg-green-50 rounded-lg sm:rounded-xl p-4 sm:p-5">
                <h3 className="text-base sm:text-lg font-bold text-gray-800 mb-3 sm:mb-4 flex items-center gap-2">
                  <History className="w-4 h-4 sm:w-5 sm:h-5 text-[#8CD955] shrink-0" />
                  <span>Histórico de Depósitos</span>
                </h3>
                {loadingDeposits ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-5 h-5 animate-spin text-[#8CD955]" />
                    <span className="ml-2 text-sm text-gray-600">Carregando...</span>
                  </div>
                ) : depositsHistory.length === 0 ? (
                  <p className="text-sm text-gray-500 text-center py-4">Nenhum depósito encontrado</p>
                ) : (
                  <>
                    <div className="overflow-x-auto -mx-4 sm:mx-0">
                      <div className="inline-block min-w-full align-middle">
                        <table className="min-w-full divide-y divide-gray-200">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-3 py-2 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">ID</th>
                              <th className="px-3 py-2 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Valor</th>
                              <th className="px-3 py-2 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Status</th>
                              <th className="px-3 py-2 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Data</th>
                              <th className="px-3 py-2 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Referência</th>
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-gray-100">
                            {depositsHistory.map((deposit: any) => (
                              <tr key={deposit.id} className="hover:bg-gray-50 transition-colors">
                                <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-800">#{deposit.id}</td>
                                <td className="px-3 py-2 whitespace-nowrap text-sm font-bold text-gray-800">{formatCurrency(deposit.value)}</td>
                                <td className="px-3 py-2 whitespace-nowrap">
                                  <span className={`px-2 py-1 rounded-lg text-xs font-bold ${
                                    deposit.status_code === '1' || deposit.status_code === 1
                                      ? 'bg-green-100 text-green-700'
                                      : 'bg-yellow-100 text-yellow-700'
                                  }`}>
                                    {deposit.status}
                                  </span>
                                </td>
                                <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-600">{formatDateTime(deposit.date || deposit.created_at)}</td>
                                <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-600 font-mono text-xs break-all">{deposit.reference || '-'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                    {allDepositsData.length > 5 && (
                      <div className="mt-4 flex justify-center">
                        <button
                          onClick={loadAllDeposits}
                          disabled={loadingMoreDeposits}
                          className="flex items-center gap-2 px-4 py-2 bg-[#8CD955] hover:bg-[#7BC84A] text-white text-sm font-bold rounded-lg transition-all shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {loadingMoreDeposits ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin" />
                              <span>Carregando...</span>
                            </>
                          ) : showAllDeposits ? (
                            <>
                              <ChevronUp className="w-4 h-4" />
                              <span>Ver menos</span>
                            </>
                          ) : (
                            <>
                              <ChevronDown className="w-4 h-4" />
                              <span>Ver mais ({allDepositsData.length} {allDepositsData.length === 1 ? 'depósito' : 'depósitos'})</span>
                            </>
                          )}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Histórico de Saques */}
              <div className="bg-blue-50 rounded-lg sm:rounded-xl p-4 sm:p-5">
                <h3 className="text-base sm:text-lg font-bold text-gray-800 mb-3 sm:mb-4 flex items-center gap-2">
                  <History className="w-4 h-4 sm:w-5 sm:h-5 text-[#8CD955] shrink-0" />
                  <span>Histórico de Saques</span>
                </h3>
                {loadingWithdraws ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-5 h-5 animate-spin text-[#8CD955]" />
                    <span className="ml-2 text-sm text-gray-600">Carregando...</span>
                  </div>
                ) : withdrawsHistory.length === 0 ? (
                  <p className="text-sm text-gray-500 text-center py-4">Nenhum saque encontrado</p>
                ) : (
                  <>
                    <div className="overflow-x-auto -mx-4 sm:mx-0">
                      <div className="inline-block min-w-full align-middle">
                        <table className="min-w-full divide-y divide-gray-200">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-3 py-2 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">ID</th>
                              <th className="px-3 py-2 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Valor</th>
                              <th className="px-3 py-2 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Status</th>
                              <th className="px-3 py-2 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Data</th>
                              <th className="px-3 py-2 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Tipo</th>
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-gray-100">
                            {withdrawsHistory.map((withdraw: any) => (
                              <tr key={withdraw.id} className="hover:bg-gray-50 transition-colors">
                                <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-800">#{withdraw.id}</td>
                                <td className="px-3 py-2 whitespace-nowrap text-sm font-bold text-gray-800">{formatCurrency(withdraw.value)}</td>
                                <td className="px-3 py-2 whitespace-nowrap">
                                  <span className={`px-2 py-1 rounded-lg text-xs font-bold ${
                                    withdraw.status_code === 1 || withdraw.status_code === '1'
                                      ? 'bg-green-100 text-green-700'
                                      : 'bg-yellow-100 text-yellow-700'
                                  }`}>
                                    {withdraw.status}
                                  </span>
                                </td>
                                <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-600">{formatDateTime(withdraw.date || withdraw.created_at)}</td>
                                <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-600">{withdraw.type || '-'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                    {allWithdrawsData.length > 5 && (
                      <div className="mt-4 flex justify-center">
                        <button
                          onClick={loadAllWithdraws}
                          disabled={loadingMoreWithdraws}
                          className="flex items-center gap-2 px-4 py-2 bg-[#8CD955] hover:bg-[#7BC84A] text-white text-sm font-bold rounded-lg transition-all shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {loadingMoreWithdraws ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin" />
                              <span>Carregando...</span>
                            </>
                          ) : showAllWithdraws ? (
                            <>
                              <ChevronUp className="w-4 h-4" />
                              <span>Ver menos</span>
                            </>
                          ) : (
                            <>
                              <ChevronDown className="w-4 h-4" />
                              <span>Ver mais ({allWithdrawsData.length} {allWithdrawsData.length === 1 ? 'saque' : 'saques'})</span>
                            </>
                          )}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Histórico de Apostas */}
              <div className="bg-purple-50 rounded-lg sm:rounded-xl p-4 sm:p-5">
                <h3 className="text-base sm:text-lg font-bold text-gray-800 mb-3 sm:mb-4 flex items-center gap-2">
                  <History className="w-4 h-4 sm:w-5 sm:h-5 text-[#8CD955] shrink-0" />
                  <span>Histórico de Apostas</span>
                </h3>
                {loadingBets ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-5 h-5 animate-spin text-[#8CD955]" />
                    <span className="ml-2 text-sm text-gray-600">Carregando...</span>
                  </div>
                ) : betsHistory.length === 0 ? (
                  <p className="text-sm text-gray-500 text-center py-4">Nenhuma aposta encontrada</p>
                ) : (
                  <>
                    <div className="overflow-x-auto -mx-4 sm:mx-0">
                      <div className="inline-block min-w-full align-middle">
                        <table className="min-w-full divide-y divide-gray-200">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-3 py-2 text-left text-xs font-bold text-gray-700 uppercase tracking-wider whitespace-nowrap">Jogo</th>
                              <th className="px-3 py-2 text-left text-xs font-bold text-gray-700 uppercase tracking-wider whitespace-nowrap">ID</th>
                              <th className="px-3 py-2 text-left text-xs font-bold text-gray-700 uppercase tracking-wider whitespace-nowrap">Valor</th>
                              <th className="px-3 py-2 text-left text-xs font-bold text-gray-700 uppercase tracking-wider whitespace-nowrap">Prêmio</th>
                              <th className="px-3 py-2 text-left text-xs font-bold text-gray-700 uppercase tracking-wider whitespace-nowrap">Status</th>
                              <th className="px-3 py-2 text-left text-xs font-bold text-gray-700 uppercase tracking-wider whitespace-nowrap">Tipo / Detalhe</th>
                              <th className="px-3 py-2 text-left text-xs font-bold text-gray-700 uppercase tracking-wider whitespace-nowrap">Data</th>
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-gray-100">
                            {betsHistory.map((bet: any) => {
                              const betType = bet.type || bet.game_type;
                              const isBichao = betType === 'bichao';
                              const rowKey = `${betType || 'lottery'}-${bet.id}`;
                              let statusLabel = 'Pendente';
                              let statusCls = 'bg-yellow-100 text-yellow-700';
                              if (isBichao) {
                                statusLabel = bet.is_winner === true || bet.is_winner === 'true' ? 'Premiado' : 'Perdeu';
                                statusCls = statusLabel === 'Premiado' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700';
                              } else {
                                const isWinner = bet.is_winner === true || bet.is_winner === 'true';
                                const isChecked = bet.checked === true || bet.checked === 'true';
                                const competitionDate = bet.competition_date ? new Date(bet.competition_date) : null;
                                const now = new Date();
                                const drawDone =
                                  !!bet.winning_ticket_drawed_at ||
                                  (competitionDate && competitionDate.getTime() <= now.getTime()) ||
                                  isChecked;
                                if (isWinner) {
                                  statusLabel = 'Premiado';
                                  statusCls = 'bg-green-100 text-green-700';
                                } else if (drawDone) {
                                  statusLabel = 'Perdeu';
                                  statusCls = 'bg-red-100 text-red-700';
                                }
                              }
                              const tipoDetalhe = isBichao
                                ? [bet.modalidade, bet.horario, bet.banca].filter(Boolean).join(' · ') || '-'
                                : (bet.type_game || '-');
                              const premioVal = bet.premio != null ? bet.premio : (isBichao ? bet.premio_a_receber : null);
                              return (
                                <tr key={rowKey} className="hover:bg-gray-50 transition-colors">
                                  <td className="px-3 py-2 whitespace-nowrap">
                                    <span className={`px-2 py-0.5 rounded text-xs font-bold ${isBichao ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800'}`}>
                                      {isBichao ? 'Bichão' : 'Loteria'}
                                    </span>
                                  </td>
                                  <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-800">#{bet.id}</td>
                                  <td className="px-3 py-2 whitespace-nowrap text-sm font-bold text-gray-800">{formatCurrency(bet.value)}</td>
                                  <td className="px-3 py-2 whitespace-nowrap text-sm font-bold text-[#8CD955]">{premioVal != null ? formatCurrency(premioVal) : '-'}</td>
                                  <td className="px-3 py-2 whitespace-nowrap">
                                    <span className={`px-2 py-1 rounded-lg text-xs font-bold ${statusCls}`}>{statusLabel}</span>
                                  </td>
                                  <td className="px-3 py-2 text-sm text-gray-600 max-w-[180px] truncate" title={tipoDetalhe}>{tipoDetalhe}</td>
                                  <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-600">{formatDateTime(bet.date || bet.created_at)}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                    {allBetsData.length > 5 && (
                      <div className="mt-4 flex justify-center">
                        <button
                          onClick={loadAllBets}
                          disabled={loadingMoreBets}
                          className="flex items-center gap-2 px-4 py-2 bg-[#8CD955] hover:bg-[#7BC84A] text-white text-sm font-bold rounded-lg transition-all shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {loadingMoreBets ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin" />
                              <span>Carregando...</span>
                            </>
                          ) : showAllBets ? (
                            <>
                              <ChevronUp className="w-4 h-4" />
                              <span>Ver menos</span>
                            </>
                          ) : (
                            <>
                              <ChevronDown className="w-4 h-4" />
                              <span>Ver mais ({allBetsData.length} {allBetsData.length === 1 ? 'aposta' : 'apostas'})</span>
                            </>
                          )}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Etiquetas */}
              {lead.tags && lead.tags.length > 0 && (
                <div className="bg-pink-50 rounded-lg sm:rounded-xl p-4 sm:p-5">
                  <h3 className="text-base sm:text-lg font-bold text-gray-800 mb-3 sm:mb-4 flex items-center gap-2">
                    <TagIcon className="w-4 h-4 sm:w-5 sm:h-5 text-[#8CD955] shrink-0" />
                    <span>Etiquetas</span>
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {lead.tags.map((tag) => (
                      <span
                        key={tag.id}
                        className="px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 sm:gap-2"
                        style={{ 
                          backgroundColor: `${tag.color}20`,
                          color: tag.color,
                          border: `1px solid ${tag.color}40`
                        }}
                      >
                        <div 
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: tag.color }}
                        />
                        <span className="break-words">{tag.label}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Footer do Modal */}
            <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-4 sm:px-6 py-3 sm:py-4">
              <button
                onClick={() => {
                  setShowDetailsModal(false);
                  setLeadDetails(null);
                  // Reseta os estados de visualização
                  setShowAllDeposits(false);
                  setShowAllWithdraws(false);
                  setShowAllBets(false);
                }}
                className="w-full py-2.5 sm:py-3 bg-[#8CD955] hover:bg-[#7BC84A] text-white text-sm sm:text-base font-bold rounded-lg sm:rounded-xl transition-colors shadow-md"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </React.Fragment>
  );
};

export default LeadCard;
