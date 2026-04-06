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
  ChevronUp,
  CheckCircle2,
  AlertCircle,
  ArrowUpRight,
  Wallet,
  Trophy,
  Megaphone,
  MousePointer,
  RefreshCw,
  Save,
  Key,
  Hash,
  ExternalLink,
  Loader2,
  Building2
} from 'lucide-react';
import Layout from '@/components/Layout';
import { useRequireAuth } from '@/utils/useRequireAuth';
import FinancialMetricsBarChart from '@/components/Charts/FinancialMetricsBarChart';
import LeadsDistributionChart from '@/components/Charts/LeadsDistributionChart';
import Funnel3DChart from '@/components/Charts/Funnel3DChart';

/** Evita que respostas antigas sobrescrevam estado após novo filtro/requisição. */
function useDashboardFetchGeneration() {
  const ref = useRef(0);
  const next = () => {
    ref.current += 1;
    return ref.current;
  };
  const isCurrent = (id: number) => id === ref.current;
  return { next, isCurrent };
}

function MetaMetricSkeleton() {
  return (
    <div className="h-8 w-20 rounded-md bg-gray-200/90 dark:bg-gray-600/80 animate-pulse" aria-hidden />
  );
}

function ResumoMetricSkeleton() {
  return <div className="h-9 w-24 rounded-md bg-white/25 animate-pulse" aria-hidden />;
}

type GestorMetaIntegrationRow = {
  integration_id: string;
  base_url: string;
  token_last4: string | null;
  ad_account_id: string | null;
  pixel_id: string | null;
  default_campaign_id: string | null;
};

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
  total_depositos_count?: number;
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

type UserStatusGestor = 'gestor' | 'gerente' | 'admin' | 'super_admin' | null;

interface DonoOption {
  id: string;
  email: string;
  full_name: string | null;
  banca_name: string | null;
  banca_id?: string | null;
}

interface BancaGestorOption {
  banca_id: string;
  banca_name: string;
  url: string | null;
  dono_id: string | null;
}

export default function GestorTrafegoClient({ 
  initialData, 
  userId: serverUserId,
  userStatus: serverUserStatus,
  authError,
  serverError,
  canSelectDono = false
}: { 
  initialData?: any, 
  userId?: string,
  userStatus?: UserStatusGestor | null,
  authError?: string,
  serverError?: string,
  canSelectDono?: boolean
}) {
  const { checking: authChecking, userId: clientUserId } = useRequireAuth();

  function formatMetaSpend(amount: number, currency?: string): string {
    const symbol = currency === 'USD' ? '$ ' : currency === 'EUR' ? '€ ' : 'R$ ';
    return `${symbol}${amount.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  const userId = serverUserId || clientUserId;
  const checking = serverUserId ? false : authChecking;
  const isAdminOrSuperAdmin = serverUserStatus === 'admin' || serverUserStatus === 'super_admin';
  const showDonoSelector = isAdminOrSuperAdmin || canSelectDono;
  /** Mesma UX de seletor por banca que o gestor (lista /api/gestor-trafego/bancas). */
  const usesBancaSelectorAsGestor = serverUserStatus === 'gestor' || serverUserStatus === 'gerente';
  const isGerenteViewer = serverUserStatus === 'gerente';
  
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(authError ? false : (initialData ? true : null));
  const [gerentes, setGerentes] = useState<Gerente[]>(initialData?.gerentes || []);
  const [externalMetrics, setExternalMetrics] = useState<ExternalMetrics | null>(initialData?.externalMetrics || null);
  const [externalMetricsError, setExternalMetricsError] = useState<string | null>(initialData?.externalMetricsError || null);
  const [metaFunnel, setMetaFunnel] = useState<{
    reach: number;
    impressions: number;
    clicks: number;
    leads: number;
    spend: number;
    currency?: string;
  } | null>(initialData?.metaFunnel || null);
  const [bancaName, setBancaName] = useState<string | null>(initialData?.bancaInfo?.name || null);
  const [bancaId, setBancaId] = useState<string | null>(initialData?.bancaId || null);
  const [syncingMeta, setSyncingMeta] = useState(false);
  const [metaActiveOnly, setMetaActiveOnly] = useState(true);
  const [showMetaConfig, setShowMetaConfig] = useState(false);
  const [metaConfigForm, setMetaConfigForm] = useState({
    base_url: 'https://graph.facebook.com/v23.0',
    access_token: '',
    ad_account_id: '',
    pixel_id: '',
    default_campaign_id: '',
  });
  const [metaConfigLoaded, setMetaConfigLoaded] = useState(false);
  const [metaIntegrationsList, setMetaIntegrationsList] = useState<GestorMetaIntegrationRow[]>([]);
  const [metaSelectedIntegrationId, setMetaSelectedIntegrationId] = useState('');
  const [metaCreateNewIntegration, setMetaCreateNewIntegration] = useState(false);
  const [metaConfigSaving, setMetaConfigSaving] = useState(false);
  const [metaConfigTesting, setMetaConfigTesting] = useState(false);
  const [metaCampaignsList, setMetaCampaignsList] = useState<Array<{ id: string; name?: string }>>([]);
  const [metaCampaignsLoading, setMetaCampaignsLoading] = useState(false);
  const [metaTestResult, setMetaTestResult] = useState<{ success: boolean; me?: any; adAccounts?: any[]; error?: string } | null>(null);
  const [metaCampaignsData, setMetaCampaignsData] = useState<Array<{
    campaign_id: string;
    campaign_name: string;
    adsets: string[];
    reach: number;
    impressions: number;
    clicks: number;
    spend: number;
    leads: number;
    results?: number;
    cost_per_result?: number | null;
    assigned_consultors?: Array<{
      id: string;
      email: string;
      full_name: string | null;
      total_leads: number;
      total_deposited: number;
    }>;
    consultor_total_leads?: number;
    consultor_total_deposited?: number;
  }>>(initialData?.metaCampaignsData || []);
  /** graph = Meta Graph API ao vivo; supabase = fallback quando live falha */
  const [metaMetricsSource, setMetaMetricsSource] = useState<'graph' | 'supabase' | null>(null);
  const [metaMetricsLiveError, setMetaMetricsLiveError] = useState<string | null>(null);
  const [metaCampaignConsultorDraft, setMetaCampaignConsultorDraft] = useState<Record<string, string[]>>({});
  const [metaCampaignConsultorSavingKey, setMetaCampaignConsultorSavingKey] = useState<string | null>(null);
  const [metaConsultorOptions, setMetaConsultorOptions] = useState<Array<{ id: string; email: string; full_name: string | null }>>([]);
  // Modal de atribuição de consultores
  const [consultorModalOpen, setConsultorModalOpen] = useState(false);
  const [consultorModalCampaignKey, setConsultorModalCampaignKey] = useState<string>('');
  const [consultorModalSearch, setConsultorModalSearch] = useState('');
  const [top5Consultants, setTop5Consultants] = useState<Array<{ name: string; value: number }>>(initialData?.top5Consultants || []);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Admin/Super Admin: seletor de dono da banca | Gestor: seletor de banca (atribuídas a ele)
  const [donos, setDonos] = useState<DonoOption[]>([]);
  const [bancasGestor, setBancasGestor] = useState<BancaGestorOption[]>([]);
  const [selectedDonoId, setSelectedDonoId] = useState<string>(() => {
    if (typeof window === 'undefined') {
      if (initialData?.bancaId) return `banca:${initialData.bancaId}`;
      return '';
    }
    const stored = window.sessionStorage?.getItem('gestor_effective_dono_id');
    if (stored) return stored;
    if (initialData?.bancaId) return `banca:${initialData.bancaId}`;
    return '';
  });
  // Configuração Meta (gestor pode adicionar na própria tela; vinculada à banca)
  const effectiveBancaId = bancaId ?? (selectedDonoId?.startsWith('banca:') ? selectedDonoId.slice(6) : null);
  const [loadingDonos, setLoadingDonos] = useState(false);
  
  // Estados de loading independentes por seção — cada promise limpa o seu
  const [loadingBanca, setLoadingBanca] = useState(false);       // gerentes, top5, gráficos
  const [loadingMeta, setLoadingMeta] = useState(false);         // Meta Ads, Funil Meta
  const [loadingExtMetrics, setLoadingExtMetrics] = useState(false); // Resumo Geral (dashboard-metrics)
  const dashboardFetchGen = useDashboardFetchGeneration();
  
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

  // Gestor: carrega bancas às quais está atribuído. Admin/Super Admin: carrega lista de donos.
  useEffect(() => {
    if (!userId || !showDonoSelector || authError) return;
    if (usesBancaSelectorAsGestor) {
      if (bancasGestor.length > 0) return;
      setLoadingDonos(true);
      fetch('/api/gestor-trafego/bancas', { headers: { 'X-User-Id': userId }, credentials: 'include' })
        .then((r) => r.json())
        .then((res) => {
          if (res.success && Array.isArray(res.data)) {
            setBancasGestor(res.data);
            // Auto-seleciona a primeira banca para carregar dados imediatamente (sem precisar do dono)
            if (res.data.length > 0 && !selectedDonoId) {
              const first = res.data[0];
              const value = `banca:${first.banca_id}`;
              setSelectedDonoId(value);
              if (typeof window !== 'undefined') {
                window.sessionStorage?.setItem('gestor_effective_dono_id', value);
              }
            }
          } else {
            setBancasGestor([]);
          }
        })
        .finally(() => setLoadingDonos(false));
    } else {
      if (initialData) return;
      if (donos.length > 0) return;
      setLoadingDonos(true);
      fetch('/api/gestor-trafego/donos', { headers: { 'X-User-Id': userId } })
        .then((r) => r.json())
        .then((res) => {
          if (res.success && Array.isArray(res.data)) setDonos(res.data);
        })
        .finally(() => setLoadingDonos(false));
    }
  }, [userId, showDonoSelector, authError, initialData, serverUserStatus, usesBancaSelectorAsGestor, bancasGestor.length, donos.length]);

  useEffect(() => {
    if (!userId) return;
    
    // Quem usa seletor de dono: não chama dashboard sem dono selecionado
    if (showDonoSelector && !initialData && !selectedDonoId) {
      return;
    }
    
    // Se não tiver initialData, busca imediatamente ao montar com data de hoje (ou com dono selecionado)
    if (!initialData && isFirstRender) {
      setIsFirstRender(false);
      if (showDonoSelector && !selectedDonoId) return;
      checkAuthorization();
      return;
    }
    
    // Se tiver initialData e for primeira renderização, não busca novamente (dados já vêm do servidor)
    if (initialData && isFirstRender) {
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
  }, [userId, dateFilter, appliedStartDate, appliedEndDate, showDonoSelector, selectedDonoId, metaActiveOnly]);

  // Retorna YYYY-MM-DD no fuso local (evita UTC que atrasa/adianta o dia no Brasil)
  const toLocalDateString = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  // Calcula as datas baseado no filtro selecionado
  const getDateRange = () => {
    const now = new Date();
    const todayStr = toLocalDateString(now);

    let dateFrom: string | null = null;
    let dateTo: string | null = null;

    switch (dateFilter) {
      case 'daily':
        // Hoje (data local)
        dateFrom = todayStr;
        dateTo = todayStr;
        break;
      case 'yesterday':
        // Ontem (data local)
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = toLocalDateString(yesterday);
        dateFrom = yesterdayStr;
        dateTo = yesterdayStr;
        break;
      case '7days':
        const sevenDaysAgo = new Date(now);
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
        dateFrom = toLocalDateString(sevenDaysAgo);
        dateTo = todayStr;
        break;
      case '15days':
        const fifteenDaysAgo = new Date(now);
        fifteenDaysAgo.setDate(fifteenDaysAgo.getDate() - 14);
        dateFrom = toLocalDateString(fifteenDaysAgo);
        dateTo = todayStr;
        break;
      case '30days':
        const thirtyDaysAgo = new Date(now);
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29);
        dateFrom = toLocalDateString(thirtyDaysAgo);
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

  /** Rótulo do período para exibir nos dados da Meta e no funil (ex: "Hoje (08/02/2026)", "08/02 a 14/02/2026"). */
  const getPeriodLabel = (): string => {
    const { dateFrom, dateTo } = getDateRange();
    if (!dateFrom || !dateTo) return 'Todo o período';
    const fmt = (s: string) => {
      const [y, m, d] = s.split('-');
      return `${d}/${m}/${y}`;
    };
    if (dateFrom === dateTo) {
      if (dateFilter === 'daily') return `Hoje (${fmt(dateFrom)})`;
      if (dateFilter === 'yesterday') return `Ontem (${fmt(dateFrom)})`;
      return fmt(dateFrom);
    }
    return `${fmt(dateFrom)} a ${fmt(dateTo)}`;
  };

  /**
   * Meta sempre consulta meta_insights_daily com intervalo explícito (granularidade diária).
   * Quando o filtro global é "todo período" ou ainda não há datas, usa janela de 30 dias (alinhada ao sync).
   */
  const getMetaInsightsQueryRange = (): { dateFrom: string; dateTo: string } => {
    const { dateFrom, dateTo } = getDateRange();
    if (dateFrom && dateTo) return { dateFrom, dateTo };
    const now = new Date();
    const todayStr = toLocalDateString(now);
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29);
    return { dateFrom: toLocalDateString(thirtyDaysAgo), dateTo: todayStr };
  };

  const getMetaPeriodLabel = (): string => {
    const crm = getDateRange();
    const { dateFrom, dateTo } = getMetaInsightsQueryRange();
    const fmt = (s: string) => {
      const [y, m, d] = s.split('-');
      return `${d}/${m}/${y}`;
    };
    if (dateFrom === dateTo) {
      if (dateFilter === 'daily') return `Hoje (${fmt(dateFrom)})`;
      if (dateFilter === 'yesterday') return `Ontem (${fmt(dateFrom)})`;
      return fmt(dateFrom);
    }
    const crmOpen = !crm.dateFrom || !crm.dateTo;
    if (crmOpen) {
      return `${fmt(dateFrom)} a ${fmt(dateTo)} (Meta: últimos 30 dias; CRM pode estar em “todo o período”)`;
    }
    return `${fmt(dateFrom)} a ${fmt(dateTo)}`;
  };

  const checkAuthorization = async () => {
    if (!userId) return;

    const { dateFrom, dateTo } = getDateRange();
    const metaRange = getMetaInsightsQueryRange();

    const baseParams = new URLSearchParams();
    if (dateFrom) baseParams.append('date_from', dateFrom);
    if (dateTo) baseParams.append('date_to', dateTo);
    baseParams.append('meta_active_only', metaActiveOnly ? '1' : '0');

    const headers: Record<string, string> = { 'X-User-Id': userId as string };
    if (showDonoSelector && selectedDonoId) {
      if (selectedDonoId.startsWith('dono:')) {
        headers['X-Effective-Dono-Id'] = selectedDonoId.slice(5);
      } else if (selectedDonoId.startsWith('banca:')) {
        headers['X-Effective-Banca-Id'] = selectedDonoId.slice(6);
      } else {
        headers['X-Effective-Dono-Id'] = selectedDonoId;
      }
    }

    const requestId = dashboardFetchGen.next();

    setLoadingBanca(true);
    setLoadingMeta(true);
    setLoadingExtMetrics(true);
    setExternalMetricsError(null);

    // --- Chamada 1: Meta Ads (Graph API + fallback Supabase) ---
    const metaParams = new URLSearchParams();
    metaParams.append('meta_active_only', metaActiveOnly ? '1' : '0');
    metaParams.set('date_from', metaRange.dateFrom);
    metaParams.set('date_to', metaRange.dateTo);
    metaParams.set('only_meta', '1');
    const metaUrl = `/api/gestor-trafego/dashboard?${metaParams.toString()}`;

    // --- Chamada 2: externalMetrics do CRM (rápida — uma chamada dashboard-metrics) ---
    const extMetricsParams = new URLSearchParams(baseParams);
    extMetricsParams.set('only_external_metrics', '1');
    const extMetricsUrl = `/api/gestor-trafego/dashboard?${extMetricsParams.toString()}`;

    // --- Chamada 3: gerentes/top5 (lenta — fetchIndicatedsByConsultants) ---
    const bancaUrl = `/api/gestor-trafego/dashboard?${baseParams.toString()}`;

    // Dispara as três em paralelo. Cada uma limpa seu próprio loading ao resolver.
    const metaPromise = fetch(metaUrl, { headers, credentials: 'include' })
      .then((r) => r.json())
      .then((result) => {
        if (!dashboardFetchGen.isCurrent(requestId)) return;
        if (result?.success && result?.data) {
          setMetaFunnel(result.data.metaFunnel || null);
          setMetaCampaignsData(result.data.metaCampaignsData || []);
          setMetaMetricsSource(result.data.metaLiveSource ?? null);
          setMetaMetricsLiveError(result.data.metaLiveError ?? null);
          if (result.data.bancaId) setBancaId(result.data.bancaId);
          if (result.data.bancaInfo?.name) setBancaName(result.data.bancaInfo.name);
        } else {
          setMetaMetricsSource(null);
          setMetaMetricsLiveError(null);
        }
      })
      .catch((err) => console.warn('[Frontend] Erro ao buscar Meta:', err))
      .finally(() => {
        if (dashboardFetchGen.isCurrent(requestId)) setLoadingMeta(false);
      });

    const extMetricsPromise = fetch(extMetricsUrl, { headers, credentials: 'include' })
      .then((r) => r.json())
      .then((result) => {
        if (!dashboardFetchGen.isCurrent(requestId)) return;
        if (result?.success && result?.data) {
          if (result.data.bancaId) setBancaId(result.data.bancaId);
          if (result.data.bancaInfo?.name) setBancaName(result.data.bancaInfo.name);
          const em = result.data.externalMetrics;
          if (em != null && typeof em === 'object') {
            setExternalMetrics(em as ExternalMetrics);
            setExternalMetricsError(null);
          }
        }
      })
      .catch((err) => console.warn('[Frontend] Erro ao buscar externalMetrics:', err))
      .finally(() => {
        if (dashboardFetchGen.isCurrent(requestId)) setLoadingExtMetrics(false);
      });

    const bancaPromise = fetch(bancaUrl, { headers, credentials: 'include' })
      .then(async (r) => {
        const status = r.status;
        const result = await r.json().catch(() => null);
        return { status, result };
      })
      .then(({ status, result }) => {
        if (!dashboardFetchGen.isCurrent(requestId)) return;
        if (result?.success && result?.data) {
          setApiError(null);
          setIsAuthorized(true);
          if (showDonoSelector && selectedDonoId && typeof window !== 'undefined') {
            sessionStorage.setItem('gestor_effective_dono_id', selectedDonoId);
          }
          setGerentes(result.data.gerentes || []);
          setTop5Consultants(result.data.top5Consultants || []);
          // Fallback: métricas da chamada completa se a rota only_external_metrics falhou ou veio vazia
          const em = result.data.externalMetrics;
          if (em != null && typeof em === 'object') {
            setExternalMetrics((prev) => prev ?? (em as ExternalMetrics));
            setExternalMetricsError(null);
          } else if (result.data.externalMetricsError) {
            setExternalMetricsError((prev) => prev ?? result.data.externalMetricsError);
          }
          if (result.data.bancaId) setBancaId(result.data.bancaId);
          if (result.data.bancaInfo?.name) setBancaName(result.data.bancaInfo.name);
        } else {
          const errMsg = result?.error || result?.message || (typeof result?.data === 'string' ? result.data : null);
          setApiError(errMsg || null);
          const normalizedErr = String(errMsg || '').toLowerCase();
          const isAuthError =
            status === 401 ||
            status === 403 ||
            normalizedErr.includes('acesso negado') ||
            normalizedErr.includes('não autenticado') ||
            normalizedErr.includes('usuario inválido') ||
            normalizedErr.includes('usuário inválido');
          // Só mostra tela "Acesso Negado" quando for realmente erro de autorização.
          setIsAuthorized(isAuthError ? false : true);
        }
      })
      .catch((err) => {
        if (!dashboardFetchGen.isCurrent(requestId)) return;
        console.error('[Frontend] Erro ao buscar dados da banca:', err);
        setApiError('Erro ao carregar dados da banca. Tente novamente.');
        // Erro de rede/servidor não deve virar "Acesso Negado".
        setIsAuthorized(true);
      })
      .finally(() => {
        if (dashboardFetchGen.isCurrent(requestId)) setLoadingBanca(false);
      });

    try {
      await Promise.allSettled([metaPromise, extMetricsPromise, bancaPromise]);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setFormSuccess('');
    setIsSubmitting(true);

    try {
      const response = await fetch('/api/gestor-trafego/users/create', {
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

  const handleSyncMetaAds = async () => {
    const id = effectiveBancaId;
    if (!id) return;
    setSyncingMeta(true);
    try {
      const res = await fetch('/api/gestor-trafego/meta/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId as string },
        body: JSON.stringify({ banca_id: id, date_preset: 'last_30d' }),
        credentials: 'include',
      });
      const result = await res.json();
      if (result.success && result.data?.success) {
        await checkAuthorization();
      } else {
        const msg = result.data?.error || result.error || 'Erro ao sincronizar.';
        setExternalMetricsError(msg);
        setTimeout(() => setExternalMetricsError(null), 5000);
      }
    } catch (e: any) {
      setExternalMetricsError(e?.message || 'Erro ao sincronizar.');
      setTimeout(() => setExternalMetricsError(null), 5000);
    } finally {
      setSyncingMeta(false);
    }
  };

  // Carrega config Meta quando a banca selecionada muda
  useEffect(() => {
    if (!effectiveBancaId || !userId) {
      setMetaConfigLoaded(false);
      setMetaIntegrationsList([]);
      setMetaSelectedIntegrationId('');
      setMetaCreateNewIntegration(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/gestor-trafego/meta/config?banca_id=${effectiveBancaId}`, {
          headers: { 'X-User-Id': userId },
        });
        const data = await res.json();
        if (cancelled) return;
        if (data.success && data.data) {
          const d = data.data;
          const integs: GestorMetaIntegrationRow[] = Array.isArray(d.integrations) ? d.integrations : [];
          setMetaIntegrationsList(integs);
          setMetaCreateNewIntegration(false);
          const storageKey = `gestor_meta_integration:${effectiveBancaId}`;
          let stored = '';
          try {
            stored = typeof window !== 'undefined' ? window.sessionStorage.getItem(storageKey) || '' : '';
          } catch {
            /* ignore */
          }
          const pickId =
            stored && integs.some((i) => i.integration_id === stored)
              ? stored
              : d.integration_id
                ? String(d.integration_id)
                : integs[0]?.integration_id || '';
          setMetaSelectedIntegrationId(pickId);
          const row = integs.find((i) => i.integration_id === pickId);
          setMetaConfigForm((f) => ({
            ...f,
            base_url: (row?.base_url || d.base_url) || f.base_url,
            ad_account_id: row?.ad_account_id != null ? String(row.ad_account_id) : d.ad_account_id || '',
            pixel_id: row?.pixel_id != null ? String(row.pixel_id) : d.pixel_id || '',
            default_campaign_id:
              row?.default_campaign_id != null
                ? String(row.default_campaign_id)
                : d.default_campaign_id || '',
            access_token: '',
          }));
        }
        setMetaConfigLoaded(true);
      } catch {
        if (!cancelled) setMetaConfigLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [effectiveBancaId, userId]);

  const handleSaveMetaConfig = async () => {
    if (!effectiveBancaId || !userId) return;
    setMetaConfigSaving(true);
    setMetaTestResult(null);
    try {
      const res = await fetch('/api/gestor-trafego/meta/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
        body: JSON.stringify({
          banca_id: effectiveBancaId,
          base_url: metaConfigForm.base_url,
          access_token: metaConfigForm.access_token || undefined,
          ad_account_id: metaConfigForm.ad_account_id,
          pixel_id: metaConfigForm.pixel_id,
          default_campaign_id: metaConfigForm.default_campaign_id || null,
          is_active: true,
          ...(isAdminOrSuperAdmin && metaCreateNewIntegration
            ? { create_new_integration: true }
            : {
                integration_id:
                  metaSelectedIntegrationId ||
                  (metaIntegrationsList[0]?.integration_id
                    ? String(metaIntegrationsList[0].integration_id)
                    : undefined),
              }),
        }),
      });
      const data = await res.json();
      if (data.success) {
        setMetaConfigForm((f) => ({ ...f, access_token: '' }));
        setMetaCreateNewIntegration(false);
        try {
          const r2 = await fetch(`/api/gestor-trafego/meta/config?banca_id=${effectiveBancaId}`, {
            headers: { 'X-User-Id': userId },
          });
          const j2 = await r2.json();
          if (j2.success && j2.data) {
            const d = j2.data;
            const integs: GestorMetaIntegrationRow[] = Array.isArray(d.integrations) ? d.integrations : [];
            setMetaIntegrationsList(integs);
            const newId =
              data.data?.integration_id != null
                ? String(data.data.integration_id)
                : d.integration_id
                  ? String(d.integration_id)
                  : integs[0]?.integration_id || '';
            if (newId) {
              setMetaSelectedIntegrationId(newId);
              try {
                window.sessionStorage.setItem(`gestor_meta_integration:${effectiveBancaId}`, newId);
              } catch {
                /* ignore */
              }
            }
            const row = integs.find((i) => i.integration_id === newId);
            setMetaConfigForm((f) => ({
              ...f,
              base_url: (row?.base_url || d.base_url) || f.base_url,
              ad_account_id: row?.ad_account_id != null ? String(row.ad_account_id) : d.ad_account_id || '',
              pixel_id: row?.pixel_id != null ? String(row.pixel_id) : d.pixel_id || '',
              default_campaign_id:
                row?.default_campaign_id != null
                  ? String(row.default_campaign_id)
                  : d.default_campaign_id || '',
              access_token: '',
            }));
          }
        } catch {
          /* mantém estado atual */
        }
      } else {
        setMetaTestResult({ success: false, error: data.error || 'Erro ao salvar' });
      }
    } catch (err: any) {
      setMetaTestResult({ success: false, error: err?.message || 'Erro ao salvar' });
    } finally {
      setMetaConfigSaving(false);
    }
  };

  const handleTestMetaConnection = async () => {
    if (!effectiveBancaId || !userId) return;
    setMetaConfigTesting(true);
    setMetaTestResult(null);
    try {
      const integ =
        !metaCreateNewIntegration &&
        (metaSelectedIntegrationId ||
          (metaIntegrationsList[0]?.integration_id ? String(metaIntegrationsList[0].integration_id) : ''));
      const res = await fetch('/api/gestor-trafego/meta/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
        body: JSON.stringify({
          banca_id: effectiveBancaId,
          ...(integ ? { integration_id: integ } : {}),
        }),
      });
      const data = await res.json();
      if (data.success && data.data) {
        setMetaTestResult(data.data.success ? { success: true, me: data.data.me, adAccounts: data.data.adAccounts } : { success: false, error: data.data.error });
      } else {
        setMetaTestResult({ success: false, error: data.error || 'Erro ao testar' });
      }
    } catch (err: any) {
      setMetaTestResult({ success: false, error: err?.message || 'Erro ao testar' });
    } finally {
      setMetaConfigTesting(false);
    }
  };

  const handleLoadMetaCampaigns = async () => {
    if (!effectiveBancaId || !userId) return;
    setMetaCampaignsLoading(true);
    try {
      const integ =
        !metaCreateNewIntegration &&
        (metaSelectedIntegrationId ||
          (metaIntegrationsList[0]?.integration_id ? String(metaIntegrationsList[0].integration_id) : ''));
      const q = new URLSearchParams({ banca_id: effectiveBancaId });
      if (integ) q.set('integration_id', integ);
      const res = await fetch(`/api/gestor-trafego/meta/campaigns?${q.toString()}`, {
        headers: { 'X-User-Id': userId },
      });
      const data = await res.json();
      if (data.success && Array.isArray(data.data?.campaigns)) {
        setMetaCampaignsList(data.data.campaigns);
      } else {
        setMetaCampaignsList([]);
      }
    } catch {
      setMetaCampaignsList([]);
    } finally {
      setMetaCampaignsLoading(false);
    }
  };

  const handleSaveMetaCampaignConsultors = async (campaignId: string) => {
    if (!effectiveBancaId || !userId) return;
    const key = `${effectiveBancaId}:${campaignId}`;
    const consultorIds = metaCampaignConsultorDraft[key] || [];
    setMetaCampaignConsultorSavingKey(key);
    try {
      const res = await fetch('/api/gestor-trafego/meta/campaign-consultors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
        body: JSON.stringify({
          banca_id: effectiveBancaId,
          campaign_id: campaignId,
          consultor_ids: consultorIds,
        }),
      });
      const data = await res.json();
      if (data.success) await checkAuthorization();
    } catch (err) {
      console.error('[GestorTrafego] erro ao salvar consultores da campanha:', err);
    } finally {
      setMetaCampaignConsultorSavingKey(null);
    }
  };

  const handleSignOut = () => {
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('user_id');
      sessionStorage.removeItem('profile_id');
      window.localStorage.removeItem('profile_id');
      document.cookie = 'user_id=; Path=/; Max-Age=0; SameSite=Lax';
      window.location.href = '/login';
    }
  };

  // Fecha o seletor de data ao clicar fora
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('.date-filter-container')) {
        setShowDatePicker(false);
      }
    };
    
    if (showDatePicker) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showDatePicker]);

  useEffect(() => {
    const nextDraft: Record<string, string[]> = {};
    for (const row of metaCampaignsData || []) {
      const key = `${effectiveBancaId || ''}:${row.campaign_id}`;
      nextDraft[key] = Array.isArray(row.assigned_consultors)
        ? row.assigned_consultors.map((c) => String(c.id)).filter(Boolean)
        : [];
    }
    setMetaCampaignConsultorDraft(nextDraft);
  }, [metaCampaignsData, effectiveBancaId]);

  useEffect(() => {
    if (!effectiveBancaId || !userId) return;
    void (async () => {
      try {
        const res = await fetch(`/api/gestor-trafego/meta/campaign-consultors?banca_id=${encodeURIComponent(effectiveBancaId)}`, {
          headers: { 'X-User-Id': userId },
        });
        const data = await res.json();
        if (data.success) {
          setMetaConsultorOptions(data.data?.consultors || []);
        } else {
          setMetaConsultorOptions([]);
        }
      } catch {
        setMetaConsultorOptions([]);
      }
    })();
  }, [effectiveBancaId, userId]);

  // Acesso negado (gestor sem vínculo ou usuário não permitido) — admin/super_admin sempre veem o dashboard
  if (isAuthorized === false) {
    return (
      <Layout onSignOut={handleSignOut}>
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-[#1a1a1a] p-6">
          <div className="bg-white dark:bg-[#2a2a2a] rounded-2xl shadow-lg border border-red-200 dark:border-red-900/50 p-8 max-w-md w-full text-center">
            <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
              <Shield className="w-8 h-8 text-red-600 dark:text-red-400" />
            </div>
            <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-2">Acesso Negado</h2>
            <p className="text-gray-600 dark:text-gray-300 mb-6">
              {authError || serverError || apiError || 'Esta página é exclusiva para Gestores de Tráfego. Você não tem permissão para acessar este conteúdo.'}
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
      <div className="p-6 space-y-6 max-w-7xl mx-auto bg-gray-50 dark:bg-[#1a1a1a] min-h-screen">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
              <Shield className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
              Gestão de Tráfego
            </h1>
            <p className="text-gray-500 dark:text-gray-400">
              {isGerenteViewer
                ? 'Métricas e funil Meta apenas das bancas às quais você está vinculado no perfil.'
                : 'Painel do Gestor de Tráfego — mesma hierarquia e métricas da banca'}
            </p>
          </div>
          
          {!isGerenteViewer && (
          <button 
            onClick={() => setIsModalOpen(true)}
            className="flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-xl font-bold transition-all shadow-md shadow-emerald-100"
          >
            <UserPlus className="w-5 h-5" />
            Cadastrar Usuário
          </button>
          )}
        </div>

        {/* KPIs da API Externa */}
        <div className="mb-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
            <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
              <BarChart3 className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
              Métricas da Banca {bancaName ? `- ${bancaName}` : showDonoSelector && !selectedDonoId ? '(selecione uma banca)' : ''}
            </h2>
            
            {/* Filtro de período + banca: gerente = data à esquerda, banca ao lado; demais = banca antes da data */}
            <div className="flex flex-wrap items-center gap-2 date-filter-container">
              {showDonoSelector && (
                <div
                  className={`flex items-center gap-2 ${isGerenteViewer ? 'order-2' : 'order-1'}`}
                >
                  <span
                    className={`text-sm font-medium text-gray-600 dark:text-gray-400 ${
                      isGerenteViewer ? 'inline' : 'hidden sm:inline'
                    }`}
                  >
                    {!usesBancaSelectorAsGestor
                      ? 'Dono da Banca'
                      : isGerenteViewer
                        ? 'Suas bancas'
                        : 'Banca'}
                  </span>
                  {loadingDonos ? (
                    <div className="flex items-center gap-2 bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-gray-600 px-4 py-2 rounded-xl text-sm text-gray-500 dark:text-gray-400">
                      <div className="animate-spin rounded-full h-4 w-4 border-2 border-[#8CD955] border-t-transparent" />
                      Carregando...
                    </div>
                  ) : (
                    <select
                      value={selectedDonoId}
                      onChange={(e) => {
                        setSelectedDonoId(e.target.value);
                        if (e.target.value) {
                          setIsAuthorized(null);
                          setLoadingExtMetrics(true);
                          setMetaFunnel(null);
                          setMetaCampaignsData([]);
                          setBancaId(null);
                          setBancaName(null);
                        } else {
                          setGerentes([]);
                          setExternalMetrics(null);
                          setTop5Consultants([]);
                          setMetaFunnel(null);
                          setMetaCampaignsData([]);
                          setBancaId(null);
                          setBancaName(null);
                        }
                      }}
                      className="bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-gray-600 px-4 py-2 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors shadow-sm min-w-[180px]"
                    >
                      <option value="">
                        {usesBancaSelectorAsGestor
                          ? (bancasGestor.length === 0 ? 'Nenhuma banca atribuída' : 'Selecione uma banca')
                          : 'Selecione um dono de banca'}
                      </option>
                      {usesBancaSelectorAsGestor
                        ? bancasGestor.map((b) => (
                            <option
                              key={b.banca_id}
                              value={`banca:${b.banca_id}`}
                            >
                              {b.banca_name}
                            </option>
                          ))
                        : donos.map((d) => (
                            <option
                              key={d.id}
                              value={d.banca_id ? `banca:${d.banca_id}` : `dono:${d.id}`}
                            >
                              {d.banca_name || d.full_name || d.email}
                            </option>
                          ))}
                    </select>
                  )}
                </div>
              )}
              <div className={`relative ${isGerenteViewer ? 'order-1' : 'order-2'}`}>
                <button
                  type="button"
                  onClick={() => setShowDatePicker(!showDatePicker)}
                  className="flex items-center gap-2 bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-gray-600 px-4 py-2 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors shadow-sm"
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
                          <label className="block text-xs font-medium text-gray-500 mb-1">Data Inicial</label>
                          <input
                            type="date"
                            value={customStartDate}
                            onChange={(e) => setCustomStartDate(e.target.value)}
                            max={customEndDate || new Date().toISOString().split('T')[0]}
                            className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955]"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1">Data Final</label>
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
                          className="w-full bg-[#8CD955] hover:bg-[#7BC84A] disabled:bg-gray-300 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
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
          
          {externalMetricsError && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 p-4 rounded-xl mb-4">
              <p className="font-medium">{externalMetricsError}</p>
            </div>
          )}

          {/* Card Métricas Meta Ads (Campanhas) - acima do Resumo Geral */}
          <div className="relative mb-6">
            <div className="bg-white dark:bg-[#2a2a2a] p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
                <div className="flex items-center gap-2">
                  <div className="p-2 bg-blue-50 dark:bg-blue-900/30 rounded-xl">
                    <Megaphone className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">Métricas Meta Ads (Campanhas)</h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Impressões, alcance, cliques, gasto, leads e custo por resultado —{' '}
                      <span className="font-medium text-gray-700 dark:text-gray-300">granularidade diária</span> via{' '}
                      <span className="font-medium text-gray-700 dark:text-gray-300">Meta Graph API</span>. Período:{' '}
                      <span className="font-medium text-gray-700 dark:text-gray-300">{getMetaPeriodLabel()}</span>
                    </p>
                    {!loadingMeta && metaMetricsSource === 'graph' && (
                      <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">Fonte: Graph API (tempo real)</p>
                    )}
                    {!loadingMeta && metaMetricsSource === 'supabase' && (
                      <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                        Live Meta indisponível{metaMetricsLiveError ? ` (${metaMetricsLiveError})` : ''}. Exibindo dados do último sync no banco.
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <select
                    value={metaActiveOnly ? 'active' : 'all'}
                    onChange={(e) => setMetaActiveOnly(e.target.value === 'active')}
                    className="px-4 py-2 border border-gray-200 dark:border-gray-600 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                  >
                    <option value="active">Apenas ativas</option>
                    <option value="all">Todas</option>
                  </select>
                  <button
                    onClick={handleSyncMetaAds}
                    disabled={syncingMeta || !effectiveBancaId}
                    className="flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-xl font-medium text-sm transition-colors"
                  >
                    <RefreshCw className={`w-4 h-4 ${syncingMeta ? 'animate-spin' : ''}`} />
                    {syncingMeta ? 'Sincronizando...' : 'Atualizar campanhas'}
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
                <div className="bg-gray-50/80 dark:bg-gray-800/60 p-4 rounded-xl border border-gray-100 dark:border-gray-600">
                  <div className="flex items-center gap-2 mb-2">
                    <Eye className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                    <p className="text-xs font-bold text-gray-600 dark:text-gray-400 uppercase">Impressões</p>
                  </div>
                  <p className="text-xl font-bold text-gray-800 dark:text-gray-100 min-h-[2rem] flex items-center">
                    {loadingMeta ? <MetaMetricSkeleton /> : (metaFunnel?.impressions ?? 0).toLocaleString('pt-BR')}
                  </p>
                </div>
                <div className="bg-gray-50/80 dark:bg-gray-800/60 p-4 rounded-xl border border-gray-100 dark:border-gray-600">
                  <div className="flex items-center gap-2 mb-2">
                    <Users className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                    <p className="text-xs font-bold text-gray-600 dark:text-gray-400 uppercase">Alcance</p>
                  </div>
                  <p className="text-xl font-bold text-gray-800 dark:text-gray-100 min-h-[2rem] flex items-center">
                    {loadingMeta ? <MetaMetricSkeleton /> : (metaFunnel?.reach ?? 0).toLocaleString('pt-BR')}
                  </p>
                </div>
                <div className="bg-gray-50/80 dark:bg-gray-800/60 p-4 rounded-xl border border-gray-100 dark:border-gray-600">
                  <div className="flex items-center gap-2 mb-2">
                    <MousePointer className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                    <p className="text-xs font-bold text-gray-600 dark:text-gray-400 uppercase">Cliques</p>
                  </div>
                  <p className="text-xl font-bold text-gray-800 dark:text-gray-100 min-h-[2rem] flex items-center">
                    {loadingMeta ? <MetaMetricSkeleton /> : (metaFunnel?.clicks ?? 0).toLocaleString('pt-BR')}
                  </p>
                </div>
                <div className="bg-gray-50/80 dark:bg-gray-800/60 p-4 rounded-xl border border-gray-100 dark:border-gray-600">
                  <div className="flex items-center gap-2 mb-2">
                    <DollarSign className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                    <p className="text-xs font-bold text-gray-600 dark:text-gray-400 uppercase">Gasto</p>
                  </div>
                  <p className="text-xl font-bold text-gray-800 dark:text-gray-100 min-h-[2rem] flex items-center">
                    {loadingMeta ? <MetaMetricSkeleton /> : formatMetaSpend(metaFunnel?.spend ?? 0, metaFunnel?.currency)}
                  </p>
                </div>
                <div className="bg-gray-50/80 dark:bg-gray-800/60 p-4 rounded-xl border border-gray-100 dark:border-gray-600">
                  <div className="flex items-center gap-2 mb-2">
                    <UserPlus className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                    <p className="text-xs font-bold text-gray-600 dark:text-gray-400 uppercase">Leads (Meta)</p>
                  </div>
                  <p className="text-xl font-bold text-gray-800 dark:text-gray-100 min-h-[2rem] flex items-center">
                    {loadingMeta ? <MetaMetricSkeleton /> : (metaFunnel?.leads ?? 0).toLocaleString('pt-BR')}
                  </p>
                </div>
              </div>
              {!loadingMeta && !metaFunnel && metaCampaignsData.length > 0 && (
                <p className="text-xs text-amber-800 dark:text-amber-200 mt-3 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-3 py-2.5 leading-relaxed">
                  <strong>Sem agregado de funil para este período:</strong> a lista de campanhas veio do banco/sync, mas não há insights agregados em{' '}
                  <code className="text-[10px] bg-amber-100/80 dark:bg-amber-900/50 px-1 rounded">meta_insights_daily</code> para{' '}
                  <strong>{getMetaPeriodLabel()}</strong>. Com Graph API ativa, recarregue a página; se persistir, use <strong>Atualizar campanhas</strong>.
                </p>
              )}
              {!loadingMeta && !metaFunnel && metaCampaignsData.length === 0 && (
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-3">
                  Configure a integração Meta na seção &quot;Configurar integração Meta&quot; abaixo ou em Admin → Meta Ads. Depois sincronize para ver as métricas.
                </p>
              )}
              {loadingMeta && (
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-4 flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                  Carregando tabela de campanhas…
                </p>
              )}
              {/* Tabela de campanhas */}
              {!loadingMeta && metaCampaignsData.length > 0 && (
                <div className="mt-6 overflow-x-auto">
                  <table className="w-full text-left border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 dark:border-gray-600 bg-gray-50/80 dark:bg-gray-800/60">
                        <th className="px-4 py-3 font-bold text-gray-600 dark:text-gray-400 uppercase">Campanha</th>
                        <th className="px-4 py-3 font-bold text-gray-600 dark:text-gray-400 uppercase">AdSets</th>
                        <th className="px-4 py-3 font-bold text-gray-600 dark:text-gray-400 uppercase text-right">Impressões</th>
                        <th className="px-4 py-3 font-bold text-gray-600 dark:text-gray-400 uppercase text-right">Alcance</th>
                        <th className="px-4 py-3 font-bold text-gray-600 dark:text-gray-400 uppercase text-right">Cliques</th>
                        <th className="px-4 py-3 font-bold text-gray-600 dark:text-gray-400 uppercase text-right">Gasto</th>
                        <th className="px-4 py-3 font-bold text-gray-600 dark:text-gray-400 uppercase text-right">Leads</th>
                        <th className="px-4 py-3 font-bold text-gray-600 dark:text-gray-400 uppercase text-right">Custo por resultado</th>
                        <th className="px-4 py-3 font-bold text-gray-600 dark:text-gray-400 uppercase text-right">Leads consultores</th>
                        <th className="px-4 py-3 font-bold text-gray-600 dark:text-gray-400 uppercase text-right">Depósito consultores</th>
                        <th className="px-4 py-3 font-bold text-gray-600 dark:text-gray-400 uppercase">Atribuir consultores</th>
                      </tr>
                    </thead>
                    <tbody>
                      {metaCampaignsData.map((row, idx) => (
                        <tr key={row.campaign_id || idx} className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50/50 dark:hover:bg-gray-700/50 text-gray-800 dark:text-gray-200">
                          <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{row.campaign_name || row.campaign_id}</td>
                          <td className="px-4 py-3 text-gray-800 dark:text-gray-200">{row.adsets?.join(', ') || '-'}</td>
                          <td className="px-4 py-3 text-right text-gray-800 dark:text-gray-200">{row.impressions.toLocaleString('pt-BR')}</td>
                          <td className="px-4 py-3 text-right text-gray-800 dark:text-gray-200">{row.reach.toLocaleString('pt-BR')}</td>
                          <td className="px-4 py-3 text-right text-gray-800 dark:text-gray-200">{row.clicks.toLocaleString('pt-BR')}</td>
                          <td className="px-4 py-3 text-right text-gray-800 dark:text-gray-200">{formatMetaSpend(row.spend, metaFunnel?.currency)}</td>
                          <td className="px-4 py-3 text-right text-gray-800 dark:text-gray-200">{row.leads.toLocaleString('pt-BR')}</td>
                          <td className="px-4 py-3 text-right text-gray-800 dark:text-gray-200">
                            {row.cost_per_result != null
                              ? formatMetaSpend(row.cost_per_result, metaFunnel?.currency)
                              : '—'}
                          </td>
                          <td className="px-4 py-3 text-right text-gray-800 dark:text-gray-200">
                            {(Number(row.consultor_total_leads) || 0).toLocaleString('pt-BR')}
                          </td>
                          <td className="px-4 py-3 text-right text-gray-800 dark:text-gray-200">
                            {formatMetaSpend(Number(row.consultor_total_deposited) || 0, metaFunnel?.currency)}
                          </td>
                          <td className="px-4 py-3">
                            {(() => {
                              const key = `${effectiveBancaId || ''}:${row.campaign_id}`;
                              const selected = metaCampaignConsultorDraft[key] || [];
                              const assignedNames = selected.map((id) => {
                                const c = metaConsultorOptions.find((o) => o.id === id);
                                return c?.full_name || c?.email || id;
                              });
                              return (
                                <div className="flex flex-col gap-1 min-w-[160px]">
                                  {assignedNames.length > 0 ? (
                                    <div className="flex flex-wrap gap-1 mb-1">
                                      {assignedNames.map((name, i) => (
                                        <span key={i} className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">
                                          {name}
                                        </span>
                                      ))}
                                    </div>
                                  ) : (
                                    <span className="text-xs text-gray-400 italic mb-1">Nenhum consultor</span>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setConsultorModalCampaignKey(key);
                                      setConsultorModalSearch('');
                                      setConsultorModalOpen(true);
                                    }}
                                    className="px-2 py-1 rounded-lg border border-emerald-200 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300 text-xs hover:bg-emerald-50 dark:hover:bg-emerald-900/20 w-fit"
                                  >
                                    Atribuir consultores
                                  </button>
                                </div>
                              );
                            })()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
          
          <div className="relative">
            {/* Resumo Geral: skeleton nos valores enquanto carrega (evita confundir com zero real) */}
            <div className="bg-gradient-to-br from-[#A8E677] to-[#8CD955] p-6 rounded-2xl shadow-lg border border-[#8CD955]/40">
              <div className="flex items-center gap-2 mb-6">
                <BarChart3 className="w-6 h-6 text-white" />
                <h2 className="text-xl font-bold text-white">Resumo Geral - {bancaName || 'Banca'}</h2>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-3 gap-4">
                <div className="bg-white/10 backdrop-blur-sm p-4 rounded-xl border border-white/20">
                  <div className="flex items-center gap-2 mb-2">
                    <Users className="w-4 h-4 text-white" />
                    <p className="text-xs font-bold text-white/90 uppercase">Total de Leads</p>
                  </div>
                  <p className="text-2xl font-bold text-white min-h-[2.25rem] flex items-center">
                    {loadingExtMetrics ? <ResumoMetricSkeleton /> : (externalMetrics?.total_leads ?? 0)}
                  </p>
                </div>
                <div className="bg-white/10 backdrop-blur-sm p-4 rounded-xl border border-white/20">
                  <div className="flex items-center gap-2 mb-2">
                    <DollarSign className="w-4 h-4 text-white" />
                    <p className="text-xs font-bold text-white/90 uppercase">Total Depositado</p>
                  </div>
                  <p className="text-2xl font-bold text-white min-h-[2.25rem] flex items-center">
                    {loadingExtMetrics ? (
                      <ResumoMetricSkeleton />
                    ) : (
                      `R$ ${(externalMetrics?.total_deposited ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
                    )}
                  </p>
                </div>
                <div className="bg-white/10 backdrop-blur-sm p-4 rounded-xl border border-white/20">
                  <div className="flex items-center gap-2 mb-2">
                    <Target className="w-4 h-4 text-white" />
                    <p className="text-xs font-bold text-white/90 uppercase">Total Apostado</p>
                  </div>
                  <p className="text-2xl font-bold text-white min-h-[2.25rem] flex items-center">
                    {loadingExtMetrics ? (
                      <ResumoMetricSkeleton />
                    ) : (
                      `R$ ${(externalMetrics?.total_bets ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
                    )}
                  </p>
                </div>
                <div className="bg-white/10 backdrop-blur-sm p-4 rounded-xl border border-white/20">
                  <div className="flex items-center gap-2 mb-2">
                    <Award className="w-4 h-4 text-white" />
                    <p className="text-xs font-bold text-white/90 uppercase">Total Premiado</p>
                  </div>
                  <p className="text-2xl font-bold text-white min-h-[2.25rem] flex items-center">
                    {loadingExtMetrics ? (
                      <ResumoMetricSkeleton />
                    ) : (
                      `R$ ${(externalMetrics?.total_prizes ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
                    )}
                  </p>
                </div>
                <div className="bg-white/10 backdrop-blur-sm p-4 rounded-xl border border-white/20">
                  <div className="flex items-center gap-2 mb-2">
                    <Award className="w-4 h-4 text-white" />
                    <p className="text-xs font-bold text-white/90 uppercase">Leads Premiados</p>
                  </div>
                  <p className="text-2xl font-bold text-white min-h-[2.25rem] flex items-center">
                    {loadingExtMetrics ? <ResumoMetricSkeleton /> : (externalMetrics?.awarded_clients_count ?? 0)}
                  </p>
                </div>
                <div className="bg-white/10 backdrop-blur-sm p-4 rounded-xl border border-white/20">
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle2 className="w-4 h-4 text-white" />
                    <p className="text-xs font-bold text-white/90 uppercase">Clientes Ativos</p>
                  </div>
                  <p className="text-2xl font-bold text-white min-h-[2.25rem] flex items-center">
                    {loadingExtMetrics ? <ResumoMetricSkeleton /> : (externalMetrics?.active_leads ?? 0)}
                  </p>
                </div>
                <div className="bg-white/10 backdrop-blur-sm p-4 rounded-xl border border-white/20">
                  <div className="flex items-center gap-2 mb-2">
                    <TrendingUp className="w-4 h-4 text-white" />
                    <p className="text-xs font-bold text-white/90 uppercase">Taxa de Conversão</p>
                  </div>
                  <p className="text-2xl font-bold text-white min-h-[2.25rem] flex items-center">
                    {loadingExtMetrics ? <ResumoMetricSkeleton /> : `${(externalMetrics?.conversion_rate ?? 0).toFixed(2)}%`}
                  </p>
                </div>
                <div className="bg-white/10 backdrop-blur-sm p-4 rounded-xl border border-white/20">
                  <div className="flex items-center gap-2 mb-2">
                    <TrendingUp className="w-4 h-4 text-white" />
                    <p className="text-xs font-bold text-white/90 uppercase">Taxa de LTV</p>
                  </div>
                  <p className="text-2xl font-bold text-white min-h-[2.25rem] flex items-center">
                    {loadingExtMetrics ? (
                      <ResumoMetricSkeleton />
                    ) : (
                      `R$ ${(externalMetrics?.ltv_avg ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                    )}
                  </p>
                </div>
                <div className="bg-white/10 backdrop-blur-sm p-4 rounded-xl border border-white/20">
                  <div className="flex items-center gap-2 mb-2">
                    <Wallet className="w-4 h-4 text-white" />
                    <p className="text-xs font-bold text-white/90 uppercase">Profit da Rede</p>
                  </div>
                  <p className="text-2xl font-bold text-white min-h-[2.25rem] flex items-center">
                    {loadingExtMetrics ? (
                      <ResumoMetricSkeleton />
                    ) : (
                      `R$ ${(externalMetrics?.net_profit ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
                    )}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Configurar integração Meta (vinculada à banca) - gestor pode adicionar aqui; admin vê em Admin → Meta */}
        {effectiveBancaId && (
          <div className="bg-white dark:bg-[#2a2a2a] p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
            <button
              type="button"
              onClick={() => setShowMetaConfig(!showMetaConfig)}
              className="w-full flex items-center justify-between gap-2 text-left"
            >
              <div className="flex items-center gap-2">
                <div className="p-2 bg-indigo-50 dark:bg-indigo-900/40 rounded-xl">
                  <Key className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                    Configurar integração Meta — {bancaName || (bancasGestor.find((b) => b.banca_id === effectiveBancaId)?.banca_name) || 'Banca selecionada'}
                  </h2>
                  <p className="text-sm text-gray-700 dark:text-gray-300">
                    Vinculado à banca escolhida no filtro acima. Use o seletor &quot;Banca&quot; no topo da página para trocar de banca e configurar outra. As informações aparecem na tela Admin → Meta Ads.
                  </p>
                </div>
              </div>
              {showMetaConfig ? <ChevronUp className="w-5 h-5 text-gray-600 dark:text-gray-400" /> : <ChevronDown className="w-5 h-5 text-gray-600 dark:text-gray-400" />}
            </button>
            {showMetaConfig && (
              <div className="mt-6 pt-6 border-t border-gray-100 dark:border-gray-700 space-y-4">
                <div className="flex items-center gap-2 px-3 py-2 bg-indigo-50 dark:bg-indigo-900/30 rounded-xl border border-indigo-100 dark:border-indigo-800">
                  <Building2 className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                  <span className="text-sm font-medium text-gray-800 dark:text-gray-200">
                    Banca atual: <strong>{bancaName || (bancasGestor.find((b) => b.banca_id === effectiveBancaId)?.banca_name) || 'Selecionada no filtro'}</strong>
                  </span>
                </div>
                {metaIntegrationsList.length > 0 ? (
                  <div className="rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50/60 dark:bg-indigo-950/30 p-4">
                    <label className="block text-sm font-medium text-gray-800 dark:text-gray-200 mb-1">
                      Conta de anúncio (integração)
                    </label>
                    <select
                      value={metaCreateNewIntegration ? '__new__' : metaSelectedIntegrationId || metaIntegrationsList[0]?.integration_id || ''}
                      onChange={(e) => {
                        const v = e.target.value;
                        const sk = `gestor_meta_integration:${effectiveBancaId}`;
                        if (v === '__new__') {
                          if (!isAdminOrSuperAdmin) return;
                          setMetaCreateNewIntegration(true);
                          setMetaSelectedIntegrationId('');
                          try {
                            window.sessionStorage.removeItem(sk);
                          } catch {
                            /* ignore */
                          }
                          setMetaConfigForm((f) => ({
                            ...f,
                            ad_account_id: '',
                            pixel_id: '',
                            default_campaign_id: '',
                            access_token: '',
                          }));
                          return;
                        }
                        setMetaCreateNewIntegration(false);
                        setMetaSelectedIntegrationId(v);
                        try {
                          window.sessionStorage.setItem(sk, v);
                        } catch {
                          /* ignore */
                        }
                        const row = metaIntegrationsList.find((i) => i.integration_id === v);
                        if (row) {
                          setMetaConfigForm((f) => ({
                            ...f,
                            base_url: row.base_url || f.base_url,
                            ad_account_id: row.ad_account_id || '',
                            pixel_id: row.pixel_id || '',
                            default_campaign_id: row.default_campaign_id || '',
                            access_token: '',
                          }));
                        }
                      }}
                      className="w-full max-w-xl px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-xl text-sm text-gray-800 dark:text-gray-100 bg-white dark:bg-gray-800"
                    >
                      {metaIntegrationsList.map((i) => (
                        <option key={i.integration_id} value={i.integration_id}>
                          {(i.ad_account_id && String(i.ad_account_id).trim()) || 'Sem act_'}{' '}
                          {i.token_last4 ? `· ${i.token_last4}` : ''}
                        </option>
                      ))}
                      {isAdminOrSuperAdmin ? (
                        <option value="__new__">+ Nova integração (outra conta/token)</option>
                      ) : null}
                    </select>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                      Métricas e sincronização agregam todas as integrações desta banca. Aqui você edita uma conta por vez.
                    </p>
                  </div>
                ) : null}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-800 dark:text-gray-200 mb-1">Base URL Meta</label>
                    <input
                      type="text"
                      value={metaConfigForm.base_url}
                      onChange={(e) => setMetaConfigForm((f) => ({ ...f, base_url: e.target.value }))}
                      placeholder="https://graph.facebook.com/v23.0"
                      disabled={!isAdminOrSuperAdmin}
                      readOnly={!isAdminOrSuperAdmin}
                      className={`w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-xl text-sm text-gray-800 dark:text-gray-100 placeholder:text-gray-500 dark:placeholder:text-gray-400 focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] ${!isAdminOrSuperAdmin ? 'bg-gray-100 dark:bg-gray-700 cursor-not-allowed' : 'bg-white dark:bg-gray-800'}`}
                    />
                    {!isAdminOrSuperAdmin && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Somente administrador pode alterar URL e token.</p>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-800 dark:text-gray-200 mb-1">Access Token {isAdminOrSuperAdmin ? '(deixe em branco para manter)' : ''}</label>
                    <input
                      type="password"
                      value={isAdminOrSuperAdmin ? metaConfigForm.access_token : ''}
                      onChange={(e) => setMetaConfigForm((f) => ({ ...f, access_token: e.target.value }))}
                      placeholder={isAdminOrSuperAdmin ? '••••••••' : 'Somente administrador pode alterar'}
                      disabled={!isAdminOrSuperAdmin}
                      readOnly={!isAdminOrSuperAdmin}
                      className={`w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-xl text-sm text-gray-800 dark:text-gray-100 placeholder:text-gray-500 dark:placeholder:text-gray-400 focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] ${!isAdminOrSuperAdmin ? 'bg-gray-100 dark:bg-gray-700 cursor-not-allowed' : 'bg-white dark:bg-gray-800'}`}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-800 dark:text-gray-200 mb-1">Ad Account ID (act_xxx)</label>
                    <input
                      type="text"
                      value={metaConfigForm.ad_account_id}
                      onChange={(e) => setMetaConfigForm((f) => ({ ...f, ad_account_id: e.target.value }))}
                      placeholder="300392276267865"
                      className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-xl text-sm text-gray-800 dark:text-gray-100 placeholder:text-gray-500 dark:placeholder:text-gray-400 focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] bg-white dark:bg-gray-800"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-800 dark:text-gray-200 mb-1">Pixel ID</label>
                    <input
                      type="text"
                      value={metaConfigForm.pixel_id}
                      onChange={(e) => setMetaConfigForm((f) => ({ ...f, pixel_id: e.target.value }))}
                      placeholder="767101702304319"
                      className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-xl text-sm text-gray-800 dark:text-gray-100 placeholder:text-gray-500 dark:placeholder:text-gray-400 focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] bg-white dark:bg-gray-800"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <div className="min-w-[200px] flex-1">
                    <label className="block text-sm font-medium text-gray-800 dark:text-gray-200 mb-1">Campanha padrão (opcional)</label>
                    <div className="flex gap-2">
                      <select
                        value={metaConfigForm.default_campaign_id}
                        onChange={(e) => setMetaConfigForm((f) => ({ ...f, default_campaign_id: e.target.value }))}
                        className="flex-1 px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-xl text-sm text-gray-800 dark:text-gray-100 focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] bg-white dark:bg-gray-800"
                      >
                        <option value="">Nenhuma</option>
                        {metaCampaignsList.map((c: { id: string; name?: string; campaign_kind?: string }) => (
                          <option key={c.id} value={c.id}>
                            {c.campaign_kind === 'bolao' ? '[Bolão] ' : ''}
                            {c.name || c.id}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={handleLoadMetaCampaigns}
                        disabled={metaCampaignsLoading || metaCreateNewIntegration}
                        className="px-4 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 rounded-xl text-sm font-medium disabled:opacity-50 flex items-center gap-1"
                      >
                        {metaCampaignsLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                        Carregar campanhas
                      </button>
                    </div>
                  </div>
                </div>
                {metaTestResult && (
                  <div className={`p-3 rounded-xl text-sm ${metaTestResult.success ? 'bg-green-50 dark:bg-green-900/30 text-green-800 dark:text-green-200 border border-green-200 dark:border-green-800' : 'bg-red-50 dark:bg-red-900/30 text-red-800 dark:text-red-200 border border-red-200 dark:border-red-800'}`}>
                    {metaTestResult.success ? (
                      <>Conexão OK. {metaTestResult.me?.name && `Logado como ${metaTestResult.me.name}.`} {metaTestResult.adAccounts?.length ? `Contas: ${metaTestResult.adAccounts.map((a: any) => a.name || a.id).join(', ')}` : ''}</>
                    ) : (
                      <>{metaTestResult.error}</>
                    )}
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-2 pt-2">
                  <button
                    type="button"
                    onClick={handleSaveMetaConfig}
                    disabled={metaConfigSaving}
                    className="flex items-center gap-2 px-4 py-2.5 bg-[#8CD955] hover:bg-[#7BC84A] disabled:opacity-50 text-white rounded-xl font-medium text-sm"
                  >
                    {metaConfigSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    Salvar configuração
                  </button>
                  <button
                    type="button"
                    onClick={handleTestMetaConnection}
                    disabled={metaConfigTesting}
                    className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl font-medium text-sm"
                  >
                    {metaConfigTesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                    Testar conexão
                  </button>
                  <button
                    type="button"
                    onClick={handleSyncMetaAds}
                    disabled={syncingMeta}
                    className="flex items-center gap-2 px-4 py-2.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white rounded-xl font-medium text-sm"
                  >
                    <RefreshCw className={`w-4 h-4 ${syncingMeta ? 'animate-spin' : ''}`} />
                    {syncingMeta ? 'Sincronizando...' : 'Sincronizar agora'}
                  </button>
                  {isAdminOrSuperAdmin && (
                    <a
                      href="/admin/meta"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 px-4 py-2.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-xl font-medium text-sm"
                    >
                      <ExternalLink className="w-4 h-4" />
                      Ver na tela Admin Meta
                    </a>
                  )}
                  <a
                    href="/admin/vsl"
                    className="flex items-center gap-2 px-4 py-2.5 bg-teal-100 dark:bg-teal-900/40 hover:bg-teal-200 dark:hover:bg-teal-800/60 text-teal-800 dark:text-teal-200 rounded-xl font-medium text-sm"
                  >
                    <ExternalLink className="w-4 h-4" />
                    VSL &amp; Redirect
                  </a>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Gráficos Detalhados do Resumo Geral - sempre visível */}
        <div className="relative">
          {(loadingBanca || loadingExtMetrics) && (
            <div className="absolute inset-0 bg-white/80 dark:bg-black/60 backdrop-blur-sm rounded-2xl z-10 flex flex-col items-center justify-center gap-2">
              <Loader2 className="h-8 w-8 text-[#8CD955] animate-spin" />
              <span className="text-sm font-medium text-gray-600 dark:text-gray-300">Carregando gráficos…</span>
            </div>
          )}
          <div className="bg-white dark:bg-[#2a2a2a] p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
            <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-6 flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-[#8CD955]" />
              Análise Detalhada do Resumo Geral
            </h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-gray-50/50 dark:bg-gray-800/50 p-4 rounded-xl border border-gray-100 dark:border-gray-700">
                <h3 className="text-sm font-bold text-gray-600 dark:text-gray-400 mb-4">Métricas Financeiras</h3>
                <div className="h-64">
                  <FinancialMetricsBarChart 
                    data={{
                      total_deposited: externalMetrics?.total_deposited ?? 0,
                      total_bets: externalMetrics?.total_bets ?? 0,
                      total_prizes: externalMetrics?.total_prizes ?? 0,
                      net_profit: externalMetrics?.net_profit ?? 0,
                    }}
                  />
                </div>
              </div>
              <div className="bg-gray-50/50 dark:bg-gray-800/50 p-4 rounded-xl border border-gray-100 dark:border-gray-700">
                <h3 className="text-sm font-bold text-gray-600 dark:text-gray-400 mb-4">Distribuição de Leads</h3>
                <div className="h-64">
                  <LeadsDistributionChart 
                    totalLeads={externalMetrics?.total_leads ?? 0}
                    activeLeads={externalMetrics?.active_leads ?? 0}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Funil Facebook (Meta) + Loteria - unificado */}
        <div className="relative bg-white dark:bg-[#2a2a2a] p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
          {(loadingMeta || loadingExtMetrics) && (
            <div className="absolute inset-0 bg-white/80 dark:bg-black/60 backdrop-blur-sm rounded-2xl z-10 flex flex-col items-center justify-center gap-3">
              <Loader2 className="h-10 w-10 text-[#8CD955] animate-spin" />
              <p className="text-sm font-medium text-gray-600 dark:text-gray-300">Carregando dados do funil…</p>
            </div>
          )}
          <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-2 flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-[#8CD955]" />
            Funil Facebook (Meta) + Loteria
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
            Meta (insights diários): <span className="font-medium text-gray-700 dark:text-gray-300">{getMetaPeriodLabel()}</span>
            {' · '}
            Loteria / CRM: <span className="font-medium text-gray-700 dark:text-gray-300">{getPeriodLabel()}</span>
          </p>
          <div className="bg-gray-50/50 dark:bg-gray-800/50 p-4 rounded-xl border border-gray-100 dark:border-gray-700 min-h-[340px]">
            <Funnel3DChart
              data={{
                stages: ['Impressões', 'Alcance', 'Cliques', 'Leads', 'Cadastros', 'Depósitos', 'Ativos'],
                values: [
                  metaFunnel?.impressions ?? 0,
                  metaFunnel?.reach ?? 0,
                  metaFunnel?.clicks ?? 0,
                  metaFunnel?.leads ?? 0,
                  externalMetrics?.total_leads ?? 0,
                  externalMetrics?.total_depositos_count ?? externalMetrics?.awarded_clients_count ?? 0,
                  externalMetrics?.active_leads ?? 0,
                ],
              }}
              showPlaceholder={loadingMeta || loadingExtMetrics || (!metaFunnel && !externalMetrics)}
            />
          </div>
          {metaFunnel && metaFunnel.spend > 0 && (
            <p className="text-xs text-gray-500 mt-2">
              Gasto Meta (período): {formatMetaSpend(metaFunnel.spend, metaFunnel.currency)}
            </p>
          )}
          {!metaFunnel && !externalMetricsError && (
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">
              Configure a integração Meta na seção &quot;Configurar integração Meta (esta banca)&quot; ou em Admin → Meta Ads.
            </p>
          )}
        </div>

        {/* Top 5 Consultores por Vendas - Design Visual */}
        <div className="relative">
          {loadingBanca && (
            <div className="absolute inset-0 bg-white/80 dark:bg-black/60 backdrop-blur-sm rounded-2xl z-10 flex flex-col items-center justify-center gap-2">
              <Loader2 className="h-8 w-8 text-[#8CD955] animate-spin" />
              <span className="text-sm font-medium text-gray-600 dark:text-gray-300">Carregando ranking…</span>
            </div>
          )}
          <div className="bg-white dark:bg-[#2a2a2a] p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
            <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-6 flex items-center gap-2">
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
                          cardBg: 'bg-gradient-to-br from-amber-50 to-amber-100/50',
                          cardBorder: 'border-amber-200',
                          medal: '🥇',
                          shadow: 'shadow-lg shadow-amber-200/50'
                        };
                      case 2:
                        return {
                          rankBg: 'bg-gradient-to-br from-gray-300 to-gray-500',
                          rankText: 'text-white',
                          cardBg: 'bg-gradient-to-br from-gray-50 to-gray-100/50',
                          cardBorder: 'border-gray-200',
                          medal: '🥈',
                          shadow: 'shadow-md shadow-gray-200/50'
                        };
                      case 3:
                        return {
                          rankBg: 'bg-gradient-to-br from-orange-300 to-orange-500',
                          rankText: 'text-white',
                          cardBg: 'bg-gradient-to-br from-orange-50 to-orange-100/50',
                          cardBorder: 'border-orange-200',
                          medal: '🥉',
                          shadow: 'shadow-md shadow-orange-200/50'
                        };
                      default:
                        return {
                          rankBg: 'bg-gradient-to-br from-blue-400 to-blue-600',
                          rankText: 'text-white',
                          cardBg: 'bg-gradient-to-br from-blue-50 to-blue-100/50',
                          cardBorder: 'border-blue-200',
                          medal: null,
                          shadow: 'shadow-sm'
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
                          <div className="flex items-center gap-1 px-3 py-1 rounded-full bg-white/80 dark:bg-gray-700/80 backdrop-blur-sm border border-white/50 dark:border-gray-600">
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
                <p className="text-base font-medium">Nenhum consultor com vendas no período selecionado</p>
                <p className="text-sm text-gray-400 dark:text-gray-500 mt-2">Altere o filtro de data para ver os resultados</p>
              </div>
            )}
          </div>
        </div>

        {/* Stats Summary Internos */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white dark:bg-[#2a2a2a] p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-blue-50 dark:bg-blue-900/40 rounded-lg">
                <Briefcase className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              </div>
              <span className="text-sm font-medium text-gray-500 dark:text-gray-400">Total de Gerentes</span>
            </div>
            <p className="text-2xl font-bold text-gray-800 dark:text-gray-100 min-h-[2rem] flex items-center">
              {loadingBanca ? <MetaMetricSkeleton /> : gerentes.length}
            </p>
          </div>
          
          <div className="bg-white dark:bg-[#2a2a2a] p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-emerald-50 dark:bg-emerald-900/40 rounded-lg">
                <TrendingUp className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <span className="text-sm font-medium text-gray-500 dark:text-gray-400">Taxa Conversão Média</span>
            </div>
            <p className="text-2xl font-bold text-gray-800 dark:text-gray-100 min-h-[2rem] flex items-center">
              {loadingBanca ? (
                <MetaMetricSkeleton />
              ) : (
                `${(gerentes.reduce((acc, g) => acc + (g.metrics.externalKpis?.conversion_rate || parseFloat(g.metrics.successRate) || 0), 0) / (gerentes.length || 1)).toFixed(1)}%`
              )}
            </p>
          </div>

          <div className="bg-white dark:bg-[#2a2a2a] p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-purple-50 dark:bg-purple-900/40 rounded-lg">
                <Users className="w-5 h-5 text-purple-600 dark:text-purple-400" />
              </div>
              <span className="text-sm font-medium text-gray-500 dark:text-gray-400">Total de Leads</span>
            </div>
            <p className="text-2xl font-bold text-gray-800 dark:text-gray-100 min-h-[2rem] flex items-center">
              {loadingBanca ? (
                <MetaMetricSkeleton />
              ) : (
                gerentes.reduce((acc, g) => acc + (g.metrics.externalKpis?.total_leads || g.metrics.contacts || 0), 0)
              )}
            </p>
          </div>
        </div>

        {/* Search & List */}
        <div className="bg-white dark:bg-[#2a2a2a] rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
          <div className="p-4 border-b border-gray-200 dark:border-gray-600 bg-gray-100 dark:bg-gray-800 flex items-center gap-3">
            <Search className="w-5 h-5 text-gray-500 dark:text-gray-400" />
            <input 
              type="text" 
              placeholder="Buscar por nome ou email..."
              className="bg-transparent border-none focus:ring-0 text-sm w-full text-gray-900 dark:text-gray-100 placeholder:text-gray-500 dark:placeholder:text-gray-400"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          {/* Versão Desktop */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50/50 dark:bg-gray-800/60">
                  <th className="px-6 py-4 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Gerente</th>
                  <th className="px-6 py-4 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider text-center">Consultores</th>
                  <th className="px-6 py-4 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider text-center">Leads</th>
                  <th className="px-6 py-4 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider text-center">Depositado</th>
                  <th className="px-6 py-4 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider text-center">Lucro</th>
                  <th className="px-6 py-4 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider text-center">Conversão</th>
                  <th className="px-6 py-4 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {filteredGerentes.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-10 text-center text-gray-500 dark:text-gray-400 text-sm">
                      Nenhum gerente encontrado
                    </td>
                  </tr>
                ) : (
                  filteredGerentes.map((gerente) => (
                    <React.Fragment key={gerente.id}>
                    <tr className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors group">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-900/50 flex items-center justify-center text-emerald-700 dark:text-emerald-300 font-bold">
                            {(gerente.full_name || gerente.email)[0].toUpperCase()}
                          </div>
                          <div>
                            <p className="font-bold text-gray-800 dark:text-gray-100">{gerente.full_name || 'Sem nome'}</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400">{gerente.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-purple-100 dark:bg-purple-900/50 text-purple-800 dark:text-purple-200">
                          {gerente.metrics.consultorsCount}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-200">
                          {gerente.metrics.externalKpis?.total_leads || gerente.metrics.contacts || 0}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-center text-gray-600 dark:text-gray-300 font-medium">
                        R$ {((gerente.metrics.externalKpis?.total_deposited || 0) / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}k
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span className={`font-bold ${(gerente.metrics.externalKpis?.net_profit || 0) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                          R$ {((gerente.metrics.externalKpis?.net_profit || 0) / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}k
                        </span>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-200">
                          {(gerente.metrics.externalKpis?.conversion_rate || parseFloat(gerente.metrics.successRate) || 0).toFixed(1)}%
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <a 
                          href={`/gestor-trafego/gerentes/${gerente.id}`}
                          className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 font-bold text-sm transition-colors"
                        >
                          <Eye className="w-4 h-4" />
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
          <div className="md:hidden divide-y divide-gray-100">
            {filteredGerentes.length === 0 ? (
              <div className="px-6 py-10 text-center text-gray-500 text-sm">
                Nenhum gerente encontrado
              </div>
            ) : (
              filteredGerentes.map((gerente) => (
                <div key={gerente.id} className="p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700 font-bold text-base">
                        {(gerente.full_name || gerente.email)[0].toUpperCase()}
                      </div>
                      <div>
                        <p className="font-bold text-gray-800 text-sm">{gerente.full_name || 'Sem nome'}</p>
                        <p className="text-[11px] text-gray-400">{gerente.email}</p>
                      </div>
                    </div>
                    <a 
                      href={`/gestor-trafego/gerentes/${gerente.id}`}
                      className="p-2 text-emerald-600 bg-emerald-50 rounded-xl"
                    >
                      <Eye className="w-5 h-5" />
                    </a>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-gray-50 p-3 rounded-xl border border-gray-100">
                      <p className="text-[10px] font-bold text-gray-400 uppercase">Consultores</p>
                      <p className="text-lg font-bold text-purple-600">{gerente.metrics.consultorsCount}</p>
                    </div>
                    <div className="bg-gray-50 p-3 rounded-xl border border-gray-100">
                      <p className="text-[10px] font-bold text-gray-400 uppercase">Leads</p>
                      <p className="text-lg font-bold text-blue-600">{gerente.metrics.externalKpis?.total_leads || gerente.metrics.contacts || 0}</p>
                    </div>
                    <div className="bg-gray-50 p-3 rounded-xl border border-gray-100">
                      <p className="text-[10px] font-bold text-gray-400 uppercase">Depositado</p>
                      <p className="text-lg font-bold text-gray-700">R$ {((gerente.metrics.externalKpis?.total_deposited || 0) / 1000).toFixed(1)}k</p>
                    </div>
                    <div className="bg-emerald-50/50 p-3 rounded-xl border border-emerald-100">
                      <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider">Lucro</p>
                      <p className={`text-lg font-bold ${(gerente.metrics.externalKpis?.net_profit || 0) >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                        R$ {((gerente.metrics.externalKpis?.net_profit || 0) / 1000).toFixed(1)}k
                      </p>
                    </div>
                    <div className="bg-emerald-50/50 p-3 rounded-xl border border-emerald-100 col-span-2">
                      <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider">Taxa de Conversão</p>
                      <p className="text-lg font-bold text-emerald-700">
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
                  <div className="bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-300 p-3 rounded-xl text-sm font-medium border border-red-100 dark:border-red-800 flex items-center gap-2">
                    <X className="w-4 h-4" /> {formError}
                  </div>
                )}
                {formSuccess && (
                  <div className="bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-300 p-3 rounded-xl text-sm font-medium border border-emerald-100 dark:border-emerald-800 flex items-center gap-2">
                    <TrendingUp className="w-4 h-4" /> {formSuccess}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
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
                          ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300' 
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
                          ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300' 
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
                          <option key={g.id} value={g.id} className="text-gray-900 dark:text-gray-100">{g.full_name || g.email}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                <div className="pt-4 flex gap-3">
                  <button 
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="flex-1 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 font-bold py-3 rounded-xl transition-all"
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
      {/* Modal: Atribuir consultores a campanha */}
      {consultorModalOpen && (() => {
        const campaignId = consultorModalCampaignKey.split(':').slice(1).join(':');
        const campaignRow = (metaCampaignsData || []).find((r) => r.campaign_id === campaignId);
        const selectedIds = metaCampaignConsultorDraft[consultorModalCampaignKey] || [];
        const filtered = metaConsultorOptions.filter((c) => {
          const term = consultorModalSearch.trim().toLowerCase();
          if (!term) return true;
          return (c.full_name || '').toLowerCase().includes(term) || c.email.toLowerCase().includes(term);
        });
        const isSaving = metaCampaignConsultorSavingKey === consultorModalCampaignKey;

        return (
          <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
            <div className="w-full max-w-lg bg-white dark:bg-[#252525] rounded-2xl border border-gray-200 dark:border-[#404040] shadow-xl flex flex-col max-h-[90vh]">
              <div className="px-5 py-4 border-b border-gray-100 dark:border-[#383838] flex items-center justify-between shrink-0">
                <div>
                  <h3 className="text-base font-semibold text-gray-900 dark:text-gray-50">Atribuir consultores</h3>
                  {campaignRow && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate max-w-xs">
                      {campaignRow.campaign_name || campaignId}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setConsultorModalOpen(false)}
                  className="px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-[#404040] text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#333]"
                >
                  Fechar
                </button>
              </div>

              {campaignRow && (
                <div className="px-5 pt-4 grid grid-cols-2 gap-3 shrink-0">
                  <div className="p-3 rounded-xl border border-gray-100 dark:border-[#383838] bg-gray-50 dark:bg-[#1e1e1e]">
                    <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase">Leads consultores</p>
                    <p className="text-xl font-bold text-gray-900 dark:text-gray-50 mt-1">
                      {(Number(campaignRow.consultor_total_leads) || 0).toLocaleString('pt-BR')}
                    </p>
                  </div>
                  <div className="p-3 rounded-xl border border-gray-100 dark:border-[#383838] bg-gray-50 dark:bg-[#1e1e1e]">
                    <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase">Depósito consultores</p>
                    <p className="text-xl font-bold text-gray-900 dark:text-gray-50 mt-1">
                      {(Number(campaignRow.consultor_total_deposited) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                    </p>
                  </div>
                </div>
              )}

              <div className="px-5 pt-4 shrink-0">
                <input
                  type="search"
                  value={consultorModalSearch}
                  onChange={(e) => setConsultorModalSearch(e.target.value)}
                  placeholder="Buscar consultor por nome ou e-mail…"
                  className="w-full px-3 py-2 border border-gray-200 dark:border-[#404040] rounded-xl text-sm text-gray-800 dark:text-gray-100 bg-white dark:bg-[#2a2a2a]"
                />
              </div>

              <div className="px-5 pt-2 pb-2 overflow-y-auto flex-1">
                <div className="border border-gray-200 dark:border-[#404040] rounded-xl bg-white dark:bg-[#2a2a2a] divide-y divide-gray-100 dark:divide-[#383838]">
                  {filtered.length === 0 ? (
                    <p className="px-3 py-3 text-xs text-gray-500">Nenhum consultor encontrado.</p>
                  ) : (
                    filtered.map((consultor) => {
                      const checked = selectedIds.includes(consultor.id);
                      return (
                        <label key={consultor.id} className="flex items-start gap-2 px-3 py-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-[#333]">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              setMetaCampaignConsultorDraft((prev) => {
                                const current = new Set(prev[consultorModalCampaignKey] ?? selectedIds);
                                if (e.target.checked) current.add(consultor.id);
                                else current.delete(consultor.id);
                                return { ...prev, [consultorModalCampaignKey]: Array.from(current) };
                              });
                            }}
                            className="mt-0.5 rounded border-gray-300 text-emerald-500 focus:ring-emerald-500"
                          />
                          <span className="min-w-0">
                            <span className="block text-sm text-gray-900 dark:text-gray-50">{consultor.full_name || 'Sem nome'}</span>
                            <span className="block text-xs text-gray-500 dark:text-gray-400 break-all">{consultor.email}</span>
                          </span>
                        </label>
                      );
                    })
                  )}
                </div>
                <p className="text-[11px] text-gray-500 mt-1">Selecionados: <span className="font-semibold text-gray-700 dark:text-gray-300">{selectedIds.length}</span></p>
              </div>

              <div className="px-5 py-4 border-t border-gray-100 dark:border-[#383838] flex justify-end gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setConsultorModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-gray-200 dark:border-[#404040] text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#333]"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={async () => {
                    await handleSaveMetaCampaignConsultors(campaignId);
                    setConsultorModalOpen(false);
                  }}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium disabled:opacity-50"
                >
                  {isSaving ? 'Salvando…' : 'Salvar'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      </div>
    </Layout>
  );
}
