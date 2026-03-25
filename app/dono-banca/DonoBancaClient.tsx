'use client';

import React, { useState, useEffect, useRef } from 'react';
import { 
  UserPlus, 
  Users, 
  Briefcase, 
  Search, 
  Eye, 
  MoreVertical,
  ChevronRight,
  Shield,
  LayoutDashboard,
  BarChart3,
  TrendingUp,
  X,
  Plus,
  DollarSign,
  Award,
  Target,
  Calendar,
  ChevronDown,
  CheckCircle2,
  AlertCircle,
  ArrowUpRight,
  Wallet,
  Trophy,
  Loader2,
  Filter,
  Download
} from 'lucide-react';
import Layout from '@/components/Layout';
import { useRequireAuth } from '@/utils/useRequireAuth';
import FinancialMetricsBarChart from '@/components/Charts/FinancialMetricsBarChart';
import LeadsDistributionChart from '@/components/Charts/LeadsDistributionChart';
import ExportCsvModal from '@/components/dono-banca/ExportCsvModal';

interface ConsultorOutraBanca {
  id: string;
  email: string;
  full_name: string | null;
}

interface Gerente {
  id: string;
  email: string;
  full_name: string | null;
  consultoresEmOutrasBancas?: ConsultorOutraBanca[];
  metrics: {
    campaigns: number;
    contacts: number;
    processed: number;
    failed: number;
    consultorsCount: number;
    successRate: string;
    externalKpis?: {
      total_leads: number;
      total_deposited: number;
      total_bets: number;
      total_prizes: number;
      active_leads: number;
      net_profit: number;
      conversion_rate: number;
    };
  };
}

interface ExternalMetrics {
  total_leads: number;
  total_deposited: number;
  total_bets: number;
  total_prizes: number;
  total_withdrawals?: number;
  awarded_clients_count: number;
  active_leads: number;
  conversion_rate: number;
  ltv_avg: number;
  net_profit: number;
}

interface ChartData {
  engagement_distribution?: Record<string, number>;
  status_distribution?: Record<string, number>;
  top_consultants?: any[];
  consultant_profitability?: any[];
  temporal_evolution?: {
    dates: string[];
    deposits: number[];
    bets: number[];
    profits?: number[];
  };
  conversion_funnel?: {
    stages: string[];
    values: number[];
  };
  activity_by_weekday?: {
    weekdays: string[];
    values: number[];
  };
}

interface DonoBancaClientProps {
  initialData?: any;
  userId?: string;
  authError?: string;
  serverError?: string;
  userStatus?: string | null;
  isAdminOrSuperAdmin?: boolean;
  /** Cargo com status dono_banca, admin/super_admin ou permissão sidebar gestao_banca */
  canAccessDonoBanca?: boolean;
  /** Deve exibir seletor de banca (admin/super ou cargo custom com gestao_banca) */
  canSelectBanca?: boolean;
}

export default function DonoBancaHierarquia({ 
  initialData, 
  userId: serverUserId,
  authError,
  serverError,
  userStatus: serverUserStatus,
  isAdminOrSuperAdmin = false,
  canAccessDonoBanca = false,
  canSelectBanca = false
}: DonoBancaClientProps) {
  const { checking: authChecking, userId: clientUserId } = useRequireAuth();
  const userId = serverUserId || clientUserId;
  const checking = serverUserId ? false : authChecking;

  const showBancaSelector = isAdminOrSuperAdmin || canSelectBanca;
  
  const [loading, setLoading] = useState(false);
  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(
    authError ? false : !canAccessDonoBanca ? false : (initialData && !showBancaSelector ? true : null)
  );
  const [gerentes, setGerentes] = useState<Gerente[]>(initialData?.gerentes || []);
  const [externalMetrics, setExternalMetrics] = useState<ExternalMetrics | null>(initialData?.externalMetrics || null);
  const [externalMetricsError, setExternalMetricsError] = useState<string | null>(initialData?.externalMetricsError || null);
  const [bancaName, setBancaName] = useState<string | null>(initialData?.bancaInfo?.name || null);
  const [bancaId, setBancaId] = useState<string | null>(initialData?.bancaId || null);
  const [top5Consultants, setTop5Consultants] = useState<Array<{ name: string; value: number }>>(initialData?.top5Consultants || []);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Filtro de banca para super_admin/admin: lista de bancas e seleção
  const [bancas, setBancas] = useState<Array<{ id: string; name: string; url: string }>>([]);
  const [bancasLoading, setBancasLoading] = useState(false);
  const [selectedBancaId, setSelectedBancaId] = useState<string>('');
  const [showBancaFilter, setShowBancaFilter] = useState(false);
  const [bancaSearchTerm, setBancaSearchTerm] = useState('');
  
  // Estados de loading específicos para não travar toda a página
  const [loadingMetrics, setLoadingMetrics] = useState(false);
  
  // Filtro de data
  const [dateFilter, setDateFilter] = useState<'daily' | 'yesterday' | '7days' | '15days' | '30days' | 'custom' | 'all'>('daily');
  const [customStartDate, setCustomStartDate] = useState<string>('');
  const [customEndDate, setCustomEndDate] = useState<string>('');
  const [appliedStartDate, setAppliedStartDate] = useState<string>('');
  const [appliedEndDate, setAppliedEndDate] = useState<string>('');
  const [showDatePicker, setShowDatePicker] = useState(false);
  
  // Form state
  const [formData, setFormData] = useState({
    email: '',
    fullName: '',
    password: '',
    status: 'gerente' as 'gerente' | 'consultor',
    enroller: '' // Se for consultor, precisa escolher um gerente
  });
  const [formError, setFormError] = useState('');
  const [formSuccess, setFormSuccess] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [isFirstRender, setIsFirstRender] = useState(true);

  // ── Export CSV (modal com filtros do CRM) ───────────────────────────────────
  const [exportCsvModalOpen, setExportCsvModalOpen] = useState(false);

  // Carrega lista de bancas para super_admin/admin ou cargo com permissão sidebar gestao_banca
  useEffect(() => {
    if (!userId || !showBancaSelector) return;
    let cancelled = false;
    setBancasLoading(true);
    fetch('/api/crm/bancas', { headers: { 'X-User-Id': userId } })
      .then((res) => res.json())
      .then((result) => {
        if (!cancelled && result.success && Array.isArray(result.data)) {
          setBancas(result.data);
          if (result.data.length > 0 && !selectedBancaId) {
            setSelectedBancaId(result.data[0].id);
          }
        }
      })
      .finally(() => { if (!cancelled) setBancasLoading(false); });
    return () => { cancelled = true; };
  }, [userId, showBancaSelector]);

  useEffect(() => {
    if (!userId) return;
    
    // super_admin/admin ou cargo com gestao_banca: só busca quando tiver banca selecionada
    if (showBancaSelector) {
      if (!selectedBancaId) {
        setIsAuthorized(canAccessDonoBanca ? null : false);
        return;
      }
      setIsFirstRender(false);
      checkAuthorization();
      return;
    }
    
    // Se não tiver initialData, busca imediatamente ao montar com data de hoje
    if (!initialData && isFirstRender) {
      setIsFirstRender(false);
      checkAuthorization();
      return;
    }
    
    // Se tiver initialData e for primeira renderização, não busca novamente
    if (initialData && isFirstRender && dateFilter === 'daily') {
      setIsFirstRender(false);
      return;
    }
    
    // Após a primeira renderização, sempre busca quando mudar o filtro de data
    if (!isFirstRender) {
      if (dateFilter === 'custom') {
        if (appliedStartDate && appliedEndDate) checkAuthorization();
      } else {
        checkAuthorization();
      }
    }
  }, [userId, dateFilter, appliedStartDate, appliedEndDate, selectedBancaId, showBancaSelector]);

  // Período considerado "longo" para aviso de consulta em segundo plano
  const isLongPeriod = (): boolean => {
    if (dateFilter === '30days' || dateFilter === 'all') return true;
    if (dateFilter === 'custom' && appliedStartDate && appliedEndDate) {
      const from = new Date(appliedStartDate).getTime();
      const to = new Date(appliedEndDate).getTime();
      const days = Math.ceil((to - from) / (24 * 60 * 60 * 1000));
      return days > 15;
    }
    return false;
  };

  // Calcula as datas baseado no filtro selecionado
  const getDateRange = () => {
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    
    let dateFrom: string | null = null;
    let dateTo: string | null = null;
    
    switch (dateFilter) {
      case 'daily':
        // Hoje
        dateFrom = todayStr;
        dateTo = todayStr;
        break;
      case 'yesterday':
        // Ontem - pega o dia anterior completo
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split('T')[0];
        dateFrom = yesterdayStr;
        dateTo = yesterdayStr;
        break;
      case '7days':
        const sevenDaysAgo = new Date(now);
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6); // Inclui hoje, então -6 para ter 7 dias
        dateFrom = sevenDaysAgo.toISOString().split('T')[0];
        dateTo = todayStr;
        break;
      case '15days':
        const fifteenDaysAgo = new Date(now);
        fifteenDaysAgo.setDate(fifteenDaysAgo.getDate() - 14);
        dateFrom = fifteenDaysAgo.toISOString().split('T')[0];
        dateTo = todayStr;
        break;
      case '30days':
        const thirtyDaysAgo = new Date(now);
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29);
        dateFrom = thirtyDaysAgo.toISOString().split('T')[0];
        dateTo = todayStr;
        break;
      case 'custom':
        if (appliedStartDate && appliedEndDate) {
          dateFrom = appliedStartDate;
          dateTo = appliedEndDate;
        }
        break;
      case 'all':
        // Não envia parâmetros de data
        dateFrom = null;
        dateTo = null;
        break;
    }
    
    return { dateFrom, dateTo };
  };

  /** Mesmo padrão da gestão de consultores: lotes pequenos para não estourar timeout/edge na Netlify. */
  const BATCH_SIZE = 5;

  const checkAuthorization = async () => {
    if (!userId) return;

    try {
      setLoadingMetrics(true);
      setExternalMetricsError(null);

      const { dateFrom, dateTo } = getDateRange();
      const rankByEmail = new Map<string, { name: string; value: number }>();

      const buildUrl = (offset: number, limit: number) => {
        const params = new URLSearchParams();
        if (dateFrom) params.append('date_from', dateFrom);
        if (dateTo) params.append('date_to', dateTo);
        if (showBancaSelector && selectedBancaId) params.append('banca_id', selectedBancaId);
        params.set('limit', String(limit));
        params.set('offset', String(offset));
        return `/api/dono-banca/dashboard?${params.toString()}`;
      };

      let offset = 0;
      let hasMore = true;
      let isFirstBatch = true;

      while (hasMore) {
        const url = buildUrl(offset, BATCH_SIZE);
        const response = await fetch(url, {
          headers: { 'X-User-Id': userId as string }
        });
        const rawText = await response.text();
        let result: {
          success?: boolean;
          data?: Record<string, unknown>;
          error?: string;
          message?: string;
        };
        try {
          result = rawText.trim() ? (JSON.parse(rawText) as typeof result) : {};
        } catch {
          console.error('[Frontend] Resposta não-JSON do dashboard (timeout/edge):', rawText.slice(0, 160));
          if (isFirstBatch) {
            setIsAuthorized(false);
            setExternalMetricsError(
              'O servidor devolveu uma resposta inválida (muito provável timeout). Os dados foram divididos em lotes; tente atualizar ou reduzir o período.'
            );
          }
          break;
        }

        if (!response.ok || !result.success) {
          if (isFirstBatch) {
            console.error('[Frontend] Erro na autorização:', result.error || result.message);
            setIsAuthorized(false);
          }
          break;
        }

        const data = result.data;
        if (isFirstBatch) {
          setIsAuthorized(true);
          setGerentes((data?.gerentes as Gerente[]) || []);
          if (data?.externalMetrics) {
            setExternalMetrics(data.externalMetrics as ExternalMetrics);
            setExternalMetricsError(null);
          } else {
            setExternalMetrics(null);
            if (data?.externalMetricsError) setExternalMetricsError(data.externalMetricsError as string);
          }
          setBancaName((data?.bancaInfo as { name?: string } | undefined)?.name || null);
          setBancaId((data?.bancaId as string) || null);
          isFirstBatch = false;
        } else {
          setGerentes((prev) => [...prev, ...(((data?.gerentes as Gerente[]) || []) as Gerente[])]);
        }

        const contributors = (data?.consultantRankContributors ?? []) as Array<{ email: string; name: string; value: number }>;
        for (const row of contributors) {
          const em = row.email?.trim();
          if (!em) continue;
          const prevVal = rankByEmail.get(em)?.value ?? 0;
          rankByEmail.set(em, { name: row.name?.trim() || em, value: Math.max(prevVal, Number(row.value) || 0) });
        }
        let nextTop5 = Array.from(rankByEmail.values())
          .filter((c) => c.value > 0)
          .sort((a, b) => b.value - a.value)
          .slice(0, 5);
        if (nextTop5.length === 0 && Array.isArray(data?.top5Consultants)) {
          const t5 = data.top5Consultants as Array<{ name: string; value: number }>;
          if (t5.length > 0) nextTop5 = t5;
        }
        setTop5Consultants(nextTop5);

        hasMore = data?.hasMore === true;
        offset += BATCH_SIZE;
      }
    } catch (error) {
      console.error('[Frontend] Erro ao verificar autorização:', error);
      setIsAuthorized(false);
    } finally {
      setLoading(false);
      setLoadingMetrics(false);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setFormSuccess('');
    setIsSubmitting(true);

    try {
      const response = await fetch('/api/dono-banca/users/create', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-User-Id': userId as string
        },
        body: JSON.stringify(formData)
      });

      const result = await response.json();
      if (result.success) {
        setFormSuccess('Usuário cadastrado com sucesso!');
        setFormData({
          email: '',
          fullName: '',
          password: '',
          status: 'gerente',
          enroller: ''
        });
        checkAuthorization();
        setTimeout(() => setIsModalOpen(false), 2000);
      } else {
        setFormError(result.error || 'Erro ao cadastrar usuário');
      }
    } catch (error) {
      setFormError('Erro de conexão com o servidor');
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredGerentes = gerentes.filter(g => 
    g.email.toLowerCase().includes(searchTerm.toLowerCase()) || 
    (g.full_name?.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const handleSignOut = () => {
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('user_id');
      sessionStorage.removeItem('profile_id');
      window.localStorage.removeItem('profile_id');
      document.cookie = 'user_id=; Path=/; Max-Age=0; SameSite=Lax';
      window.location.href = '/login';
    }
  };

  // Fecha o seletor de data e banca ao clicar fora
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('.date-filter-container') && !target.closest('.banca-filter-container')) {
        setShowDatePicker(false);
        setShowBancaFilter(false);
      }
    };
    if (showDatePicker || showBancaFilter) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showDatePicker, showBancaFilter]);

  // Quem precisa escolher banca (admin/super ou cargo com gestao_banca) sem banca selecionada
  if (showBancaSelector && !selectedBancaId) {
    return (
      <Layout onSignOut={handleSignOut}>
        <div className="min-h-screen p-4 sm:p-6 space-y-6 max-w-7xl mx-auto bg-gray-50 dark:bg-[#1a1a1a]">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <h1 className="text-xl sm:text-2xl font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
              <Shield className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
              Gestão da Banca
            </h1>
          </div>
          <div className="bg-white dark:bg-[#2a2a2a] rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-6 sm:p-8 max-w-lg">
            <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-2">Selecione uma banca</h2>
            <p className="text-gray-500 dark:text-gray-400 text-sm mb-4">Escolha a banca para visualizar todos os dados (gerentes, consultores e métricas).</p>
            <div className="relative banca-filter-container">
              <button
                onClick={() => {
                  if (!showBancaFilter && bancas.length === 0 && !bancasLoading) {
                    fetch('/api/crm/bancas', { headers: { 'X-User-Id': userId as string } })
                      .then((r) => r.json())
                      .then((res) => res.success && Array.isArray(res.data) && setBancas(res.data));
                  }
                  setShowBancaFilter(!showBancaFilter);
                  setBancaSearchTerm('');
                }}
                disabled={bancasLoading}
                className="flex items-center gap-2 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 px-4 py-3 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-all shadow-sm disabled:opacity-80"
              >
                <Filter className="w-4 h-4 text-[#8CD955]" />
                {bancasLoading ? 'Carregando bancas...' : 'Selecione uma banca'}
                <ChevronDown className="w-4 h-4 ml-auto" />
              </button>
              {showBancaFilter && (
                <div className="absolute left-0 right-0 mt-2 bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-gray-600 rounded-xl shadow-lg z-50 max-h-[320px] overflow-hidden flex flex-col">
                  <div className="p-2 border-b border-gray-100 dark:border-gray-600">
                    <input
                      type="text"
                      placeholder="Pesquisar banca..."
                      value={bancaSearchTerm}
                      onChange={(e) => setBancaSearchTerm(e.target.value)}
                      className="w-full px-3 py-2 bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-500 dark:placeholder:text-gray-400"
                    />
                  </div>
                  <div className="overflow-y-auto p-2">
                    {bancas.filter((b) => b.name.toLowerCase().includes(bancaSearchTerm.toLowerCase())).map((banca) => (
                      <button
                        key={banca.id}
                        onClick={() => {
                          setSelectedBancaId(banca.id);
                          setShowBancaFilter(false);
                        }}
                        className="w-full text-left px-4 py-2.5 rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200"
                      >
                        {banca.name}
                      </button>
                    ))}
                    {bancas.length === 0 && !bancasLoading && (
                      <p className="px-4 py-6 text-sm text-gray-500 text-center">Nenhuma banca encontrada</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  // Se não tem permissão para a página (nem status fixo nem sidebar gestao_banca)
  if (!canAccessDonoBanca) {
    return (
      <Layout onSignOut={handleSignOut}>
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-[#1a1a1a] p-6">
          <div className="bg-white dark:bg-[#2a2a2a] rounded-2xl shadow-lg border border-red-200 dark:border-red-900/50 p-8 max-w-md w-full text-center">
            <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
              <Shield className="w-8 h-8 text-red-600 dark:text-red-400" />
            </div>
            <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-2">Acesso Negado</h2>
            <p className="text-gray-600 dark:text-gray-300 mb-6">
              {authError || serverError || 'Esta página é exclusiva para Donos de Banca. Você não tem permissão para acessar este conteúdo.'}
            </p>
            <button
              onClick={() => window.location.href = '/'}
              className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-3 rounded-xl font-bold transition-all"
            >
              Voltar ao Início
            </button>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout onSignOut={handleSignOut}>
      <div className="min-h-screen p-4 sm:p-6 space-y-4 sm:space-y-6 max-w-7xl mx-auto bg-gray-50 dark:bg-[#1a1a1a]">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
              <Shield className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
              Gestão da Banca
            </h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm sm:text-base">Gerencie sua hierarquia de Gerentes e Consultores</p>
          </div>
          
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setExportCsvModalOpen(true)}
              disabled={!userId}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold transition-all shadow-sm shrink-0 text-sm bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
              title="Exportar leads da banca em CSV (com filtros do CRM)"
            >
              <Download className="w-4 h-4" />
              Exportar CSV
            </button>

            {!isAdminOrSuperAdmin && (
              <button
                onClick={() => setIsModalOpen(true)}
                className="flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-xl font-bold transition-all shadow-md shadow-emerald-100 dark:shadow-none shrink-0"
              >
                <UserPlus className="w-5 h-5" />
                Cadastrar Usuário
              </button>
            )}
          </div>
        </div>

        {/* Modal Export CSV (filtros iguais ao CRM) */}
        <ExportCsvModal
          open={exportCsvModalOpen}
          onClose={() => setExportCsvModalOpen(false)}
          userId={userId as string}
          bancasFromParent={showBancaSelector ? bancas : []}
          defaultBancaId={showBancaSelector ? null : bancaId}
          showBancaSelector={showBancaSelector}
        />

        {/* KPIs da API Externa */}
        <div className="mb-4 sm:mb-6">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 sm:gap-4 mb-4 sm:mb-6">
            <h2 className="text-lg sm:text-xl font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2 shrink-0">
              <BarChart3 className="w-5 h-5 sm:w-6 sm:h-6 text-emerald-600 dark:text-emerald-400" />
              <span className="truncate">Métricas da Banca{bancaName ? ` - ${bancaName}` : ''}</span>
            </h2>
            
            <div className="flex items-center gap-2 flex-wrap min-w-0">
            {/* Filtro de Banca (super_admin/admin ou cargo com gestao_banca) */}
            {showBancaSelector && (
              <div className="relative banca-filter-container">
                <button
                  onClick={() => {
                    setShowBancaFilter(!showBancaFilter);
                    setShowDatePicker(false);
                  }}
                  className="flex items-center gap-2 bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-gray-600 px-3 sm:px-4 py-2 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors shadow-sm"
                >
                  <Filter className="w-4 h-4 text-[#8CD955]" />
                  <span className="truncate max-w-[140px] sm:max-w-none">{bancas.find((b) => b.id === selectedBancaId)?.name ?? 'Banca'}</span>
                  <ChevronDown className="w-4 h-4 shrink-0" />
                </button>
                {showBancaFilter && (
                  <div className="absolute right-0 mt-2 bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-gray-600 rounded-xl shadow-lg z-50 min-w-[220px] sm:min-w-[240px] max-h-[300px] overflow-y-auto p-2">
                    <input
                      type="text"
                      placeholder="Pesquisar banca..."
                      value={bancaSearchTerm}
                      onChange={(e) => setBancaSearchTerm(e.target.value)}
                      className="w-full px-3 py-2 mb-2 bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-500 dark:placeholder:text-gray-400"
                    />
                    {bancas.filter((b) => b.name.toLowerCase().includes(bancaSearchTerm.toLowerCase())).map((banca) => (
                      <button
                        key={banca.id}
                        onClick={() => {
                          setSelectedBancaId(banca.id);
                          setShowBancaFilter(false);
                        }}
                        className={`w-full text-left px-3 py-2 rounded-lg text-sm ${
                          selectedBancaId === banca.id ? 'bg-[#8CD95515] dark:bg-[#8CD95525] text-[#8CD955] font-medium' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                        }`}
                      >
                        {banca.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {/* Filtro de Data */}
            <div className="flex items-center gap-2 date-filter-container">
              <div className="relative">
                <button
                  onClick={() => setShowDatePicker(!showDatePicker)}
                  className="flex items-center gap-2 bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-gray-600 px-3 sm:px-4 py-2 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors shadow-sm"
                >
                  <Calendar className="w-4 h-4 text-[#8CD955]" />
                  <span>
                    {dateFilter === 'daily' && 'Hoje'}
                    {dateFilter === 'yesterday' && 'Ontem'}
                    {dateFilter === '7days' && 'Últimos 7 dias'}
                    {dateFilter === '15days' && 'Últimos 15 dias'}
                    {dateFilter === '30days' && 'Últimos 30 dias'}
                    {dateFilter === 'custom' && 'Personalizado'}
                    {dateFilter === 'all' && 'Todo o Período'}
                  </span>
                  <ChevronDown className="w-4 h-4" />
                </button>
                
                {showDatePicker && (
                  <div className="absolute right-0 mt-2 bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-gray-600 rounded-xl shadow-lg z-50 min-w-[200px]">
                    <div className="p-2">
                      <button
                        onClick={() => {
                          setDateFilter('daily');
                          setAppliedStartDate('');
                          setAppliedEndDate('');
                          setShowDatePicker(false);
                        }}
                        className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                          dateFilter === 'daily' ? 'bg-[#8CD95515] dark:bg-[#8CD95525] text-[#8CD955] font-medium' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                        }`}
                      >
                        Hoje
                      </button>
                      <button
                        onClick={() => {
                          setDateFilter('yesterday');
                          setAppliedStartDate('');
                          setAppliedEndDate('');
                          setShowDatePicker(false);
                        }}
                        className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                          dateFilter === 'yesterday' ? 'bg-[#8CD95515] dark:bg-[#8CD95525] text-[#8CD955] font-medium' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                        }`}
                      >
                        Ontem
                      </button>
                      <button
                        onClick={() => {
                          setDateFilter('7days');
                          setAppliedStartDate('');
                          setAppliedEndDate('');
                          setShowDatePicker(false);
                        }}
                        className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                          dateFilter === '7days' ? 'bg-[#8CD95515] dark:bg-[#8CD95525] text-[#8CD955] font-medium' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                        }`}
                      >
                        Últimos 7 dias
                      </button>
                      <button
                        onClick={() => {
                          setDateFilter('15days');
                          setAppliedStartDate('');
                          setAppliedEndDate('');
                          setShowDatePicker(false);
                        }}
                        className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                          dateFilter === '15days' ? 'bg-[#8CD95515] dark:bg-[#8CD95525] text-[#8CD955] font-medium' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                        }`}
                      >
                        Últimos 15 dias
                      </button>
                      <button
                        onClick={() => {
                          setDateFilter('30days');
                          setAppliedStartDate('');
                          setAppliedEndDate('');
                          setShowDatePicker(false);
                        }}
                        className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                          dateFilter === '30days' ? 'bg-[#8CD95515] dark:bg-[#8CD95525] text-[#8CD955] font-medium' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                        }`}
                      >
                        Últimos 30 dias
                      </button>
                      <button
                        onClick={() => {
                          setDateFilter('custom');
                          // Restaura as datas aplicadas nos campos de input se existirem
                          if (appliedStartDate) setCustomStartDate(appliedStartDate);
                          if (appliedEndDate) setCustomEndDate(appliedEndDate);
                        }}
                        className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                          dateFilter === 'custom' ? 'bg-[#8CD95515] dark:bg-[#8CD95525] text-[#8CD955] font-medium' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                        }`}
                      >
                        Personalizado
                      </button>
                      <button
                        onClick={() => {
                          setDateFilter('all');
                          setAppliedStartDate('');
                          setAppliedEndDate('');
                          setShowDatePicker(false);
                        }}
                        className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                          dateFilter === 'all' ? 'bg-[#8CD95515] dark:bg-[#8CD95525] text-[#8CD955] font-medium' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                        }`}
                      >
                        Todo o Período
                      </button>
                    </div>
                    
                    {dateFilter === 'custom' && (
                      <div className="p-3 border-t border-gray-200 dark:border-gray-600 space-y-3">
                        <div>
                          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Data Inicial</label>
                          <input
                            type="date"
                            value={customStartDate}
                            onChange={(e) => setCustomStartDate(e.target.value)}
                            max={customEndDate || new Date().toISOString().split('T')[0]}
                            className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955]"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Data Final</label>
                          <input
                            type="date"
                            value={customEndDate}
                            onChange={(e) => setCustomEndDate(e.target.value)}
                            min={customStartDate}
                            max={new Date().toISOString().split('T')[0]}
                            className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955]"
                          />
                        </div>
                        <button
                          onClick={() => {
                            if (customStartDate && customEndDate) {
                              setAppliedStartDate(customStartDate);
                              setAppliedEndDate(customEndDate);
                              setShowDatePicker(false);
                            }
                          }}
                          disabled={!customStartDate || !customEndDate}
                          className="w-full bg-[#8CD955] hover:bg-[#7BC84A] disabled:bg-gray-300 dark:disabled:bg-gray-600 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                        >
                          Aplicar
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
            </div>
          </div>
          
          {externalMetricsError && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 p-4 rounded-xl mb-4">
              <p className="font-medium">{externalMetricsError}</p>
            </div>
          )}

          {loadingMetrics && isLongPeriod() && (
            <div className="bg-amber-500/15 dark:bg-amber-600/20 border border-amber-400/40 dark:border-amber-500/50 text-amber-800 dark:text-amber-200 p-4 rounded-xl mb-4 flex items-center gap-3">
              <Loader2 className="w-5 h-5 shrink-0 animate-spin" />
              <p className="font-medium">Consulta em andamento. Os dados do período selecionado estão sendo carregados em segundo plano.</p>
            </div>
          )}
          
          <div>
            {loadingMetrics && !externalMetrics ? (
              <div className="bg-gradient-to-br from-[#A8E677] to-[#8CD955] dark:from-emerald-800 dark:to-emerald-900 p-4 sm:p-6 rounded-2xl shadow-lg border border-[#8CD955]/40 dark:border-emerald-700/50">
                <div className="flex items-center gap-2 mb-6">
                  <BarChart3 className="w-6 h-6 text-white" />
                  <h2 className="text-xl font-bold text-white">Resumo Geral - {bancaName || 'Banca'}</h2>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-3 gap-4">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => (
                    <div key={i} className="bg-white/10 backdrop-blur-sm p-4 rounded-xl border border-white/20">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-4 h-4 rounded bg-white/30 animate-pulse" />
                        <div className="h-3 w-20 bg-white/30 rounded animate-pulse" />
                      </div>
                      <div className="flex items-center justify-center h-8 mt-2">
                        <Loader2 className="w-6 h-6 text-white animate-spin" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : externalMetrics ? (
              <div className="bg-gradient-to-br from-[#A8E677] to-[#8CD955] dark:from-emerald-800 dark:to-emerald-900 p-4 sm:p-6 rounded-2xl shadow-lg border border-[#8CD955]/40 dark:border-emerald-700/50">
              <div className="flex items-center gap-2 mb-6">
                <BarChart3 className="w-6 h-6 text-white" />
                <h2 className="text-xl font-bold text-white">Resumo Geral - {bancaName || 'Banca'}</h2>
              </div>
              
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-3 gap-4">
                {/* Card: Total de Leads */}
                <div className="bg-white/10 backdrop-blur-sm p-4 rounded-xl border border-white/20">
                  <div className="flex items-center gap-2 mb-2">
                    <Users className="w-4 h-4 text-white" />
                    <p className="text-xs font-bold text-white/90 uppercase">Total de Leads</p>
                  </div>
                  <p className="text-2xl font-bold text-white">{loadingMetrics ? <Loader2 className="w-6 h-6 animate-spin inline" /> : (externalMetrics.total_leads || 0)}</p>
                </div>

                {/* Card: Total Depositado */}
                <div className="bg-white/10 backdrop-blur-sm p-4 rounded-xl border border-white/20">
                  <div className="flex items-center gap-2 mb-2">
                    <DollarSign className="w-4 h-4 text-white" />
                    <p className="text-xs font-bold text-white/90 uppercase">Total Depositado</p>
                  </div>
                  <p className="text-2xl font-bold text-white">
                    {loadingMetrics ? <Loader2 className="w-6 h-6 animate-spin inline" /> : `R$ ${(externalMetrics.total_deposited || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`}
                  </p>
                </div>

                {/* Card: Total Apostado */}
                <div className="bg-white/10 backdrop-blur-sm p-4 rounded-xl border border-white/20">
                  <div className="flex items-center gap-2 mb-2">
                    <Target className="w-4 h-4 text-white" />
                    <p className="text-xs font-bold text-white/90 uppercase">Total Apostado</p>
                  </div>
                  <p className="text-2xl font-bold text-white">
                    {loadingMetrics ? <Loader2 className="w-6 h-6 animate-spin inline" /> : `R$ ${(externalMetrics.total_bets || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`}
                  </p>
                </div>

                {/* Card: Total Premiado */}
                <div className="bg-white/10 backdrop-blur-sm p-4 rounded-xl border border-white/20">
                  <div className="flex items-center gap-2 mb-2">
                    <Award className="w-4 h-4 text-white" />
                    <p className="text-xs font-bold text-white/90 uppercase">Total Premiado</p>
                  </div>
                  <p className="text-2xl font-bold text-white">
                    {loadingMetrics ? <Loader2 className="w-6 h-6 animate-spin inline" /> : `R$ ${(externalMetrics.total_prizes || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`}
                  </p>
                </div>

                {/* Card: Leads Premiados */}
                <div className="bg-white/10 backdrop-blur-sm p-4 rounded-xl border border-white/20">
                  <div className="flex items-center gap-2 mb-2">
                    <Award className="w-4 h-4 text-white" />
                    <p className="text-xs font-bold text-white/90 uppercase">Leads Premiados</p>
                  </div>
                  <p className="text-2xl font-bold text-white">{loadingMetrics ? <Loader2 className="w-6 h-6 animate-spin inline" /> : (externalMetrics.awarded_clients_count || 0)}</p>
                </div>

                {/* Card: Clientes Ativos */}
                <div className="bg-white/10 backdrop-blur-sm p-4 rounded-xl border border-white/20">
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle2 className="w-4 h-4 text-white" />
                    <p className="text-xs font-bold text-white/90 uppercase">Clientes Ativos</p>
                  </div>
                  <p className="text-2xl font-bold text-white">{loadingMetrics ? <Loader2 className="w-6 h-6 animate-spin inline" /> : (externalMetrics.active_leads || 0)}</p>
                </div>

                {/* Card: Taxa de Conversão */}
                <div className="bg-white/10 backdrop-blur-sm p-4 rounded-xl border border-white/20">
                  <div className="flex items-center gap-2 mb-2">
                    <TrendingUp className="w-4 h-4 text-white" />
                    <p className="text-xs font-bold text-white/90 uppercase">Taxa de Conversão</p>
                  </div>
                  <p className="text-2xl font-bold text-white">
                    {loadingMetrics ? <Loader2 className="w-6 h-6 animate-spin inline" /> : `${(externalMetrics.conversion_rate || 0).toFixed(2)}%`}
                  </p>
                </div>

                {/* Card: Taxa de LTV */}
                <div className="bg-white/10 backdrop-blur-sm p-4 rounded-xl border border-white/20">
                  <div className="flex items-center gap-2 mb-2">
                    <TrendingUp className="w-4 h-4 text-white" />
                    <p className="text-xs font-bold text-white/90 uppercase">Taxa de LTV</p>
                  </div>
                  <p className="text-2xl font-bold text-white">
                    {loadingMetrics ? <Loader2 className="w-6 h-6 animate-spin inline" /> : `R$ ${(externalMetrics.ltv_avg || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                  </p>
                </div>

                {/* Card: Profit da Rede */}
                <div className="bg-white/10 backdrop-blur-sm p-4 rounded-xl border border-white/20">
                  <div className="flex items-center gap-2 mb-2">
                    <Wallet className="w-4 h-4 text-white" />
                    <p className="text-xs font-bold text-white/90 uppercase">Profit da Rede</p>
                  </div>
                  <p className="text-2xl font-bold text-white">
                    {loadingMetrics ? <Loader2 className="w-6 h-6 animate-spin inline" /> : `R$ ${(externalMetrics.net_profit || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`}
                  </p>
                </div>
              </div>
            </div>
            ) : (
              <div className="bg-gradient-to-br from-[#A8E677] to-[#8CD955] dark:from-emerald-800 dark:to-emerald-900 p-4 sm:p-6 rounded-2xl shadow-lg border border-[#8CD955]/40 dark:border-emerald-700/50">
                <div className="text-center py-8">
                  <AlertCircle className="w-12 h-12 text-white/80 mx-auto mb-4" />
                  <p className="text-white font-medium">Dados externos não encontrados</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Gráficos Detalhados do Resumo Geral */}
        {externalMetrics && (
          <div className="bg-white dark:bg-[#2a2a2a] p-4 sm:p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
              <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-4 sm:mb-6 flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-[#8CD955]" />
                Análise Detalhada do Resumo Geral
              </h2>
              
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
                <div className="bg-gray-50/50 dark:bg-gray-800/50 p-4 rounded-xl border border-gray-100 dark:border-gray-700">
                  <h3 className="text-sm font-bold text-gray-600 dark:text-gray-300 mb-4">Métricas Financeiras</h3>
                  <div className="h-56 sm:h-64">
                    <FinancialMetricsBarChart 
                      data={{
                        total_deposited: externalMetrics.total_deposited || 0,
                        total_bets: externalMetrics.total_bets || 0,
                        total_prizes: externalMetrics.total_prizes || 0,
                        net_profit: externalMetrics.net_profit || 0,
                      }}
                    />
                  </div>
                </div>
                <div className="bg-gray-50/50 dark:bg-gray-800/50 p-4 rounded-xl border border-gray-100 dark:border-gray-700">
                  <h3 className="text-sm font-bold text-gray-600 dark:text-gray-300 mb-4">Distribuição de Leads</h3>
                  <div className="h-56 sm:h-64">
                    <LeadsDistributionChart 
                      totalLeads={externalMetrics.total_leads || 0}
                      activeLeads={externalMetrics.active_leads || 0}
                    />
                  </div>
                </div>
              </div>
            </div>
        )}

        {/* Top 5 Consultores por Vendas - Design Visual */}
        <div className="bg-white dark:bg-[#2a2a2a] p-4 sm:p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
            <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-4 sm:mb-6 flex items-center gap-2">
              <Trophy className="w-5 h-5 text-amber-500 dark:text-amber-400" />
              Top 5 Consultores por Vendas
            </h2>
            
            {top5Consultants && top5Consultants.length > 0 ? (
              <div className="space-y-4">
                {top5Consultants.map((consultant, index) => {
                  const position = index + 1;
                  const getRankStyle = () => {
                    switch (position) {
                      case 1:
                        return {
                          rankBg: 'bg-gradient-to-br from-amber-400 to-amber-600',
                          rankText: 'text-white',
                          cardBg: 'bg-gradient-to-br from-amber-50 to-amber-100/50 dark:from-amber-900/30 dark:to-amber-800/20',
                          cardBorder: 'border-amber-200 dark:border-amber-700/50',
                          medal: '🥇',
                          shadow: 'shadow-lg shadow-amber-200/50 dark:shadow-none'
                        };
                      case 2:
                        return {
                          rankBg: 'bg-gradient-to-br from-gray-300 to-gray-500',
                          rankText: 'text-white',
                          cardBg: 'bg-gradient-to-br from-gray-50 to-gray-100/50 dark:from-gray-800/50 dark:to-gray-700/30',
                          cardBorder: 'border-gray-200 dark:border-gray-600',
                          medal: '🥈',
                          shadow: 'shadow-md shadow-gray-200/50 dark:shadow-none'
                        };
                      case 3:
                        return {
                          rankBg: 'bg-gradient-to-br from-orange-300 to-orange-500',
                          rankText: 'text-white',
                          cardBg: 'bg-gradient-to-br from-orange-50 to-orange-100/50 dark:from-orange-900/30 dark:to-orange-800/20',
                          cardBorder: 'border-orange-200 dark:border-orange-700/50',
                          medal: '🥉',
                          shadow: 'shadow-md shadow-orange-200/50 dark:shadow-none'
                        };
                      default:
                        return {
                          rankBg: 'bg-gradient-to-br from-blue-400 to-blue-600',
                          rankText: 'text-white',
                          cardBg: 'bg-gradient-to-br from-blue-50 to-blue-100/50 dark:from-blue-900/30 dark:to-blue-800/20',
                          cardBorder: 'border-blue-200 dark:border-blue-700/50',
                          medal: null,
                          shadow: 'shadow-sm dark:shadow-none'
                        };
                    }
                  };

                  const style = getRankStyle();
                  const initials = consultant.name
                    .split(' ')
                    .map(n => n[0])
                    .join('')
                    .toUpperCase()
                    .slice(0, 2);

                  return (
                    <div
                      key={index}
                      className={`relative ${style.cardBg} ${style.cardBorder} border-2 rounded-xl p-4 transition-all hover:scale-[1.02] ${style.shadow}`}
                    >
                      <div className="flex items-center gap-4">
                        {/* Posição/Ranking */}
                        <div className={`${style.rankBg} ${style.rankText} w-14 h-14 rounded-xl flex items-center justify-center font-bold text-lg shrink-0 shadow-md`}>
                          {style.medal ? (
                            <span className="text-2xl">{style.medal}</span>
                          ) : (
                            <span>#{position}</span>
                          )}
                        </div>

                        {/* Avatar */}
                        <div className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-sm text-white shadow-md ${
                          position === 1 ? 'bg-gradient-to-br from-amber-500 to-amber-700' :
                          position === 2 ? 'bg-gradient-to-br from-gray-400 to-gray-600' :
                          position === 3 ? 'bg-gradient-to-br from-orange-400 to-orange-600' :
                          'bg-gradient-to-br from-blue-500 to-blue-700'
                        }`}>
                          {initials}
                        </div>

                        {/* Nome e Valor */}
                        <div className="flex-1 min-w-0">
                          <h3 className="font-bold text-gray-800 dark:text-gray-100 text-base truncate">
                            {consultant.name}
                          </h3>
                          <div className="mt-1">
                            <span className="text-lg font-extrabold text-emerald-600">
                              {new Intl.NumberFormat('pt-BR', {
                                style: 'currency',
                                currency: 'BRL',
                                minimumFractionDigits: 0,
                                maximumFractionDigits: 0
                              }).format(consultant.value)}
                            </span>
                          </div>
                        </div>

                        {/* Badge de Destaque para Top 3 */}
                        {position <= 3 && (
                          <div className="flex items-center gap-1 px-3 py-1 rounded-full bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm border border-white/50 dark:border-gray-600">
                            <Trophy className={`w-4 h-4 ${
                              position === 1 ? 'text-amber-500' :
                              position === 2 ? 'text-gray-500 dark:text-gray-400' :
                              'text-orange-500'
                            }`} />
                            <span className="text-xs font-bold text-gray-700 dark:text-gray-200">
                              {position === 1 ? 'Campeão' : position === 2 ? 'Vice' : '3º Lugar'}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Barra de Progresso Visual (comparado com o 1º lugar) */}
                      {position > 1 && top5Consultants[0] && (
                        <div className="mt-3 pt-3 border-t border-white/50 dark:border-gray-600">
                          <div className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-400 mb-1">
                            <span>Progresso em relação ao 1º lugar</span>
                            <span className="font-bold">
                              {((consultant.value / top5Consultants[0].value) * 100).toFixed(0)}%
                            </span>
                          </div>
                          <div className="w-full bg-white/60 rounded-full h-2 overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${
                                position === 2 ? 'bg-gradient-to-r from-gray-400 to-gray-500' :
                                position === 3 ? 'bg-gradient-to-r from-orange-400 to-orange-500' :
                                'bg-gradient-to-r from-blue-400 to-blue-500'
                              }`}
                              style={{ width: `${(consultant.value / top5Consultants[0].value) * 100}%` }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-gray-500 dark:text-gray-400">
                <Trophy className="w-16 h-16 text-gray-300 dark:text-gray-600 mb-4" />
                <p className="text-base font-medium text-center px-4">Nenhum consultor com vendas no período selecionado</p>
                <p className="text-sm text-gray-400 dark:text-gray-500 mt-2">Altere o filtro de data para ver os resultados</p>
              </div>
            )}
          </div>
        </div>

        {/* Gerentes e Consultores */}
        <div className="relative">
          {loadingMetrics && (
            <div className="absolute inset-0 bg-white/85 dark:bg-[#1a1a1a]/90 backdrop-blur-sm rounded-2xl z-10 flex flex-col items-center justify-center gap-3 min-h-[280px]">
              <div className="animate-spin rounded-full h-10 w-10 border-2 border-[#8CD955] border-t-transparent" />
              <p className="text-sm font-bold text-gray-700 dark:text-gray-300">Carregando gerentes e consultores...</p>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
            <div className="bg-white dark:bg-[#2a2a2a] p-4 sm:p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-blue-50 dark:bg-blue-900/30 rounded-lg">
                  <Briefcase className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                </div>
                <span className="text-sm font-medium text-gray-500 dark:text-gray-400">Total de Gerentes</span>
              </div>
              <p className="text-2xl font-bold text-gray-800 dark:text-gray-100">{gerentes.length}</p>
            </div>
            <div className="bg-white dark:bg-[#2a2a2a] p-4 sm:p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-emerald-50 dark:bg-emerald-900/30 rounded-lg">
                  <TrendingUp className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                </div>
                <span className="text-sm font-medium text-gray-500 dark:text-gray-400">Taxa Conversão Média</span>
              </div>
              <p className="text-2xl font-bold text-gray-800 dark:text-gray-100">
                {(gerentes.reduce((acc, g) => acc + (g.metrics.externalKpis?.conversion_rate || parseFloat(g.metrics.successRate) || 0), 0) / (gerentes.length || 1)).toFixed(1)}%
              </p>
            </div>
            <div className="bg-white dark:bg-[#2a2a2a] p-4 sm:p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 sm:col-span-2 lg:col-span-1">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-purple-50 dark:bg-purple-900/30 rounded-lg">
                  <Users className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                </div>
                <span className="text-sm font-medium text-gray-500 dark:text-gray-400">Total de Leads</span>
              </div>
              <p className="text-2xl font-bold text-gray-800 dark:text-gray-100">
                {gerentes.reduce((acc, g) => acc + (g.metrics.externalKpis?.total_leads || g.metrics.contacts || 0), 0)}
              </p>
            </div>
          </div>

        {/* Search & List */}
        <div className="bg-white dark:bg-[#2a2a2a] rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden mt-4 sm:mt-6">
          <div className="p-3 sm:p-4 border-b border-gray-200 dark:border-gray-600 bg-gray-100 dark:bg-gray-800/50 flex items-center gap-3">
            <Search className="w-5 h-5 text-gray-500 dark:text-gray-400 shrink-0" />
            <input 
              type="text" 
              placeholder="Buscar por nome ou email..."
              className="bg-transparent border-none focus:ring-0 text-sm w-full text-gray-900 dark:text-gray-100 placeholder:text-gray-500 dark:placeholder:text-gray-400 min-w-0"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          {/* Versão Desktop */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[640px]">
              <thead>
                <tr className="bg-gray-50/50 dark:bg-gray-800/50">
                  <th className="px-4 sm:px-6 py-3 sm:py-4 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Gerente</th>
                  <th className="px-4 sm:px-6 py-3 sm:py-4 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider text-center">Consultores</th>
                  <th className="px-4 sm:px-6 py-3 sm:py-4 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider text-center">Leads</th>
                  <th className="px-4 sm:px-6 py-3 sm:py-4 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider text-center">Depositado</th>
                  <th className="px-4 sm:px-6 py-3 sm:py-4 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider text-center">Lucro</th>
                  <th className="px-4 sm:px-6 py-3 sm:py-4 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider text-center">Conversão</th>
                  <th className="px-4 sm:px-6 py-3 sm:py-4 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {filteredGerentes.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 sm:px-6 py-10 text-center text-gray-500 dark:text-gray-400 text-sm">
                      Nenhum gerente encontrado
                    </td>
                  </tr>
                ) : (
                  filteredGerentes.map((gerente) => (
                    <React.Fragment key={gerente.id}>
                    <tr className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors group">
                      <td className="px-4 sm:px-6 py-3 sm:py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center text-emerald-700 dark:text-emerald-300 font-bold shrink-0">
                            {(gerente.full_name || gerente.email)[0].toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="font-bold text-gray-800 dark:text-gray-100 truncate">{gerente.full_name || 'Sem nome'}</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{gerente.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 sm:px-6 py-3 sm:py-4 text-center">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-purple-100 dark:bg-purple-900/40 text-purple-800 dark:text-purple-300">
                          {gerente.metrics.consultorsCount}
                        </span>
                      </td>
                      <td className="px-4 sm:px-6 py-3 sm:py-4 text-center">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300">
                          {gerente.metrics.externalKpis?.total_leads || gerente.metrics.contacts || 0}
                        </span>
                      </td>
                      <td className="px-4 sm:px-6 py-3 sm:py-4 text-center text-gray-600 dark:text-gray-300 font-medium">
                        R$ {((gerente.metrics.externalKpis?.total_deposited || 0) / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}k
                      </td>
                      <td className="px-4 sm:px-6 py-3 sm:py-4 text-center">
                        <span className={`font-bold ${(gerente.metrics.externalKpis?.net_profit || 0) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                          R$ {((gerente.metrics.externalKpis?.net_profit || 0) / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}k
                        </span>
                      </td>
                      <td className="px-4 sm:px-6 py-3 sm:py-4 text-center">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-300">
                          {(gerente.metrics.externalKpis?.conversion_rate || parseFloat(gerente.metrics.successRate) || 0).toFixed(1)}%
                        </span>
                      </td>
                      <td className="px-4 sm:px-6 py-3 sm:py-4 text-right">
                        <a 
                          href={`/dono-banca/gerentes/${gerente.id}`}
                          className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 font-bold text-sm transition-colors"
                        >
                          <Eye className="w-4 h-4 shrink-0" />
                          Visualizar
                        </a>
                      </td>
                    </tr>
                    </React.Fragment>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Versão Mobile (Cards) */}
          <div className="md:hidden divide-y divide-gray-100 dark:divide-gray-700">
            {filteredGerentes.length === 0 ? (
              <div className="px-4 py-10 text-center text-gray-500 dark:text-gray-400 text-sm">
                Nenhum gerente encontrado
              </div>
            ) : (
              filteredGerentes.map((gerente) => (
                <div key={gerente.id} className="p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center text-emerald-700 dark:text-emerald-300 font-bold text-base shrink-0">
                        {(gerente.full_name || gerente.email)[0].toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="font-bold text-gray-800 dark:text-gray-100 text-sm truncate">{gerente.full_name || 'Sem nome'}</p>
                        <p className="text-[11px] text-gray-400 dark:text-gray-500 truncate">{gerente.email}</p>
                      </div>
                    </div>
                    <a 
                      href={`/dono-banca/gerentes/${gerente.id}`}
                      className="p-2 text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 rounded-xl shrink-0"
                    >
                      <Eye className="w-5 h-5" />
                    </a>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-gray-50 dark:bg-gray-800/50 p-3 rounded-xl border border-gray-100 dark:border-gray-700">
                      <p className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase">Consultores</p>
                      <p className="text-lg font-bold text-purple-600 dark:text-purple-400">{gerente.metrics.consultorsCount}</p>
                    </div>
                    <div className="bg-gray-50 dark:bg-gray-800/50 p-3 rounded-xl border border-gray-100 dark:border-gray-700">
                      <p className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase">Leads</p>
                      <p className="text-lg font-bold text-blue-600 dark:text-blue-400">{gerente.metrics.externalKpis?.total_leads || gerente.metrics.contacts || 0}</p>
                    </div>
                    <div className="bg-gray-50 dark:bg-gray-800/50 p-3 rounded-xl border border-gray-100 dark:border-gray-700">
                      <p className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase">Depositado</p>
                      <p className="text-lg font-bold text-gray-700 dark:text-gray-200">R$ {((gerente.metrics.externalKpis?.total_deposited || 0) / 1000).toFixed(1)}k</p>
                    </div>
                    <div className="bg-emerald-50/50 dark:bg-emerald-900/20 p-3 rounded-xl border border-emerald-100 dark:border-emerald-800">
                      <p className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">Lucro</p>
                      <p className={`text-lg font-bold ${(gerente.metrics.externalKpis?.net_profit || 0) >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                        R$ {((gerente.metrics.externalKpis?.net_profit || 0) / 1000).toFixed(1)}k
                      </p>
                    </div>
                    <div className="bg-emerald-50/50 dark:bg-emerald-900/20 p-3 rounded-xl border border-emerald-100 dark:border-emerald-800 col-span-2">
                      <p className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">Taxa de Conversão</p>
                      <p className="text-lg font-bold text-emerald-700 dark:text-emerald-300">
                        {(gerente.metrics.externalKpis?.conversion_rate || parseFloat(gerente.metrics.successRate) || 0).toFixed(1)}%
                      </p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Modal de Cadastro */}
        {isModalOpen && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-[#2a2a2a] rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in duration-200 border border-gray-200 dark:border-gray-700">
              <div className="p-6 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between bg-emerald-600 text-white">
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <UserPlus className="w-6 h-6" />
                  Cadastrar Novo Usuário
                </h2>
                <button onClick={() => setIsModalOpen(false)} className="hover:bg-white/20 p-1.5 rounded-xl transition-colors">
                  <X className="w-6 h-6" />
                </button>
              </div>
              
              <form onSubmit={handleCreateUser} className="p-6 space-y-4">
                {formError && (
                  <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-300 p-3 rounded-xl text-sm font-medium border border-red-100 dark:border-red-800 flex items-center gap-2">
                    <X className="w-4 h-4 shrink-0" /> {formError}
                  </div>
                )}
                {formSuccess && (
                  <div className="bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-300 p-3 rounded-xl text-sm font-medium border border-emerald-100 dark:border-emerald-800 flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 shrink-0" /> {formSuccess}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 uppercase mb-1.5 ml-1">Nome Completo</label>
                    <input 
                      type="text" 
                      required
                      placeholder="Ex: João Silva"
                      className="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-xl focus:ring-emerald-500 focus:border-emerald-500 transition-all p-3 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 font-medium"
                      value={formData.fullName}
                      onChange={e => setFormData({...formData, fullName: e.target.value})}
                    />
                  </div>
                  
                  <div className="col-span-2 md:col-span-1">
                    <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 uppercase mb-1.5 ml-1">E-mail</label>
                    <input 
                      type="email" 
                      required
                      placeholder="exemplo@email.com"
                      className="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-xl focus:ring-emerald-500 focus:border-emerald-500 transition-all p-3 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 font-medium"
                      value={formData.email}
                      onChange={e => setFormData({...formData, email: e.target.value})}
                    />
                  </div>

                  <div className="col-span-2 md:col-span-1">
                    <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 uppercase mb-1.5 ml-1">Senha Inicial</label>
                    <input 
                      type="password" 
                      required
                      placeholder="••••••••"
                      className="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-xl focus:ring-emerald-500 focus:border-emerald-500 transition-all p-3 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 font-medium"
                      value={formData.password}
                      onChange={e => setFormData({...formData, password: e.target.value})}
                    />
                  </div>

                  <div className="col-span-2">
                    <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 uppercase mb-1.5 ml-1">Tipo de Usuário</label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setFormData({...formData, status: 'gerente'})}
                        className={`p-3 rounded-xl border-2 text-sm font-bold transition-all ${
                          formData.status === 'gerente' 
                          ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300' 
                          : 'border-gray-100 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-400 dark:text-gray-500 hover:border-gray-200 dark:hover:border-gray-500'
                        }`}
                      >
                        Gerente
                      </button>
                      <button
                        type="button"
                        onClick={() => setFormData({...formData, status: 'consultor'})}
                        className={`p-3 rounded-xl border-2 text-sm font-bold transition-all ${
                          formData.status === 'consultor' 
                          ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300' 
                          : 'border-gray-100 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-400 dark:text-gray-500 hover:border-gray-200 dark:hover:border-gray-500'
                        }`}
                      >
                        Consultor
                      </button>
                    </div>
                  </div>

                  {formData.status === 'consultor' && (
                    <div className="col-span-2 animate-in slide-in-from-top-2 duration-200">
                      <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 uppercase mb-1.5 ml-1">Selecionar Gerente</label>
                      <select 
                        required
                        className="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-xl focus:ring-emerald-500 focus:border-emerald-500 transition-all p-3 text-sm text-gray-900 dark:text-gray-100 font-medium"
                        value={formData.enroller}
                        onChange={e => setFormData({...formData, enroller: e.target.value})}
                      >
                        <option value="" className="text-gray-500 dark:text-gray-400">Selecione o gerente responsável</option>
                        {gerentes.map(g => (
                          <option key={g.id} value={g.id} className="text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-800">{g.full_name || g.email}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                <div className="pt-4 flex flex-col-reverse sm:flex-row gap-3">
                  <button 
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="flex-1 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-200 font-bold py-3 rounded-xl transition-all"
                  >
                    Cancelar
                  </button>
                  <button 
                    type="submit"
                    disabled={isSubmitting}
                    className="flex-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-xl transition-all shadow-lg shadow-emerald-100 disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {isSubmitting ? (
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                    ) : (
                      <>
                        <Plus className="w-5 h-5" />
                        Criar Usuário
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
