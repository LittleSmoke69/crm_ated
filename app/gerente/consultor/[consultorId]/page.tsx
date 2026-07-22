'use client';

import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useTenantRouter, withTenantSlug } from '@/lib/utils/tenant-href';
import { 
  ArrowLeft, 
  Target, 
  Users, 
  TrendingUp, 
  CheckCircle2, 
  Calendar,
  DollarSign,
  Award,
  BarChart3,
  ChevronDown,
  Trophy,
  Loader2,
  Kanban,
  Wallet,
  Filter,
  Search,
  Star
} from 'lucide-react';
import Layout from '@/components/Layout';
import { useRequireAuth } from '@/utils/useRequireAuth';
import StatusDistributionChart from '@/components/Charts/StatusDistributionChart';
import BancaRankingChart from '@/components/Charts/BancaRankingChart';
import { DateRangeFilter, KpiHero, Banner } from '@/components/ui';
import { getDateRange as resolveDateRange, type DateRangeValue } from '@/lib/ui/date-range';

interface ConsultorDetail {
  consultor: {
    id: string;
    email: string;
    full_name: string | null;
    created_at: string;
    enroller: string;
  };
  campaigns: any[];
  leadsCount: number;
  metrics: {
    processed: number;
    failed: number;
    successRate: string;
  };
  externalKpis?: {
    total_leads: number;
    total_deposited: number;
    total_bets: number;
    total_prizes: number;
    awarded_clients_count: number;
    active_leads: number;
    conversion_rate: number;
    ltv_avg: number;
    net_profit: number;
  } | null;
  externalKpisError?: string | null;
  chartData?: {
    engagement_distribution?: Record<string, number>;
    status_distribution?: Record<string, number>;
    stars_distribution?: Record<string, number>;
    stars_distribution_array?: Array<{ name: string; value: number }>;
    top_bettors?: Array<{ name: string; value: number }>;
    top_winners?: Array<{ name: string; value: number }>;
    top_depositors?: Array<{ name: string; value: number }>;
    total_indicateds?: number;
  };
}

export default function DetalheConsultor() {
  const { checking, userId } = useRequireAuth();
  const params = useParams();
  const router = useTenantRouter();
  const consultorId = params?.consultorId as string;
  
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ConsultorDetail | null>(null);
  const [accessingCrm, setAccessingCrm] = useState(false);
  
  // Filtro de banca (apenas as que este consultor tem acesso, conforme API externa)
  const [bancas, setBancas] = useState<Array<{ id: string; name: string; url: string }>>([]);
  const [bancasLoading, setBancasLoading] = useState(false);
  const [selectedBanca, setSelectedBanca] = useState<string>('');
  const [showBancaFilter, setShowBancaFilter] = useState(false);
  const [bancaSearchTerm, setBancaSearchTerm] = useState<string>('');
  
  // Filtro de data (inicial: todo o período) — resolvido via lib/ui/date-range
  const [dateRange, setDateRange] = useState<DateRangeValue>({ preset: 'all' });

  // Calcula as datas baseado no filtro selecionado
  const getDateRange = () => {
    const range = resolveDateRange(dateRange);
    return { dateFrom: range?.startDate ?? null, dateTo: range?.endDate ?? null };
  };

  // Carrega bancas e dados básicos do consultor ao montar o componente
  useEffect(() => {
    if (!userId) return;
    loadBancas();
    loadConsultorInfo();
  }, [userId, consultorId]);

  // Carrega dados do CRM quando banca e filtros mudarem (bancas na deps para "todas" recarregar ao ter lista)
  useEffect(() => {
    if (!userId || !consultorId || !selectedBanca) return;
    if (selectedBanca === 'all' && bancas.length === 0) return;
    loadData();
  }, [userId, consultorId, selectedBanca, dateRange, bancas.length]);

  // Fecha o seletor de banca ao clicar fora
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('.banca-filter-container')) {
        setShowBancaFilter(false);
      }
    };

    if (showBancaFilter) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showBancaFilter]);

  const loadBancas = async () => {
    if (!consultorId) return;
    setBancasLoading(true);
    try {
      const response = await fetch(`/api/gerente/consultores/${consultorId}/bancas`, {
        headers: { 'X-User-Id': userId as string }
      });
      const result = await response.json();
      if (result.success) {
        const list = result.data || [];
        setBancas(list);
        if (list.length > 0 && !selectedBanca) {
          setSelectedBanca('all');
        }
      }
    } catch (error) {
      console.error('Erro ao carregar bancas:', error);
    } finally {
      setBancasLoading(false);
    }
  };

  const loadConsultorInfo = async () => {
    try {
      const response = await fetch(`/api/gerente/consultores/${consultorId}`, {
        headers: { 'X-User-Id': userId as string }
      });
      const result = await response.json();
      
      if (result.success) {
        // Atualiza apenas os dados do consultor, mantendo os dados do CRM se existirem
        setData(prev => {
          const baseData: ConsultorDetail = {
            consultor: result.data.consultor,
            campaigns: prev?.campaigns || [],
            leadsCount: prev?.leadsCount || 0,
            metrics: prev?.metrics || { processed: 0, failed: 0, successRate: '0.00' },
            externalKpis: prev?.externalKpis || null,
            externalKpisError: prev?.externalKpisError || null,
            chartData: prev?.chartData,
          };
          return baseData;
        });
      }
    } catch (error) {
      console.error('Erro ao carregar informações do consultor:', error);
    }
  };

  const loadData = async () => {
    if (!selectedBanca) return;

    try {
      setLoading(true);
      const { dateFrom, dateTo } = getDateRange();

      if (selectedBanca === 'all') {
        if (bancas.length === 0) {
          setLoading(false);
          return;
        }
        const params = new URLSearchParams();
        if (dateFrom) params.append('date_from', dateFrom);
        if (dateTo) params.append('date_to', dateTo);
        const queryString = params.toString();

        const results = await Promise.all(
          bancas.map(async (banca) => {
            const url = `/api/gerente/consultores/${consultorId}?banca_url=${encodeURIComponent(banca.url)}${queryString ? `&${queryString}` : ''}`;
            const res = await fetch(url, { headers: { 'X-User-Id': userId as string } });
            const json = await res.json();
            return json.success ? json.data : null;
          })
        );

        const validResults = results.filter(Boolean);
        if (validResults.length === 0) {
          setData(prev => prev ? { ...prev, externalKpis: null, externalKpisError: 'NO_DATA', chartData: undefined } : null);
          setLoading(false);
          return;
        }

        const first = validResults[0];
        let aggregatedKpis: ConsultorDetail['externalKpis'] = null;
        const chartParts: Array<NonNullable<ConsultorDetail['chartData']>> = [];

        for (let i = 0; i < validResults.length; i++) {
          const d = validResults[i];
          if (d.externalKpis) {
            if (!aggregatedKpis) {
              aggregatedKpis = { ...d.externalKpis };
            } else {
              aggregatedKpis.total_leads = (aggregatedKpis.total_leads || 0) + (d.externalKpis?.total_leads || 0);
              aggregatedKpis.total_deposited = (aggregatedKpis.total_deposited || 0) + (d.externalKpis?.total_deposited || 0);
              aggregatedKpis.total_bets = (aggregatedKpis.total_bets || 0) + (d.externalKpis?.total_bets || 0);
              aggregatedKpis.total_prizes = (aggregatedKpis.total_prizes || 0) + (d.externalKpis?.total_prizes || 0);
              aggregatedKpis.active_leads = (aggregatedKpis.active_leads || 0) + (d.externalKpis?.active_leads || 0);
              aggregatedKpis.net_profit = (aggregatedKpis.net_profit || 0) + (d.externalKpis?.net_profit || 0);
              aggregatedKpis.awarded_clients_count = (aggregatedKpis.awarded_clients_count || 0) + (d.externalKpis?.awarded_clients_count || 0);
            }
          }
          if (d.chartData) chartParts.push(d.chartData);
        }

        if (aggregatedKpis) {
          const totalLeads = aggregatedKpis.total_leads || 0;
          aggregatedKpis.conversion_rate = totalLeads > 0 ? ((aggregatedKpis.active_leads || 0) / totalLeads) * 100 : 0;
          aggregatedKpis.ltv_avg = totalLeads > 0 ? (aggregatedKpis.total_deposited || 0) / totalLeads : 0;
        }

        const engagementAgg: Record<string, number> = {};
        const statusAgg: Record<string, number> = {};
        const starsAgg: Record<string, number> = {};
        const allBettors: Array<{ name: string; value: number }> = [];
        const allWinners: Array<{ name: string; value: number }> = [];
        const allDepositors: Array<{ name: string; value: number }> = [];
        let totalIndicateds = 0;

        for (const chart of chartParts) {
          if (chart.engagement_distribution) {
            for (const [k, v] of Object.entries(chart.engagement_distribution)) {
              engagementAgg[k] = (engagementAgg[k] || 0) + v;
            }
          }
          if (chart.status_distribution) {
            for (const [k, v] of Object.entries(chart.status_distribution)) {
              statusAgg[k] = (statusAgg[k] || 0) + v;
            }
          }
          if (chart.stars_distribution) {
            for (const [k, v] of Object.entries(chart.stars_distribution)) {
              starsAgg[k] = (starsAgg[k] || 0) + v;
            }
          }
          if (chart.top_bettors) allBettors.push(...chart.top_bettors);
          if (chart.top_winners) allWinners.push(...chart.top_winners);
          if (chart.top_depositors) allDepositors.push(...chart.top_depositors);
          if (chart.total_indicateds !== undefined) totalIndicateds += chart.total_indicateds;
        }

        const starsArray = Object.entries(starsAgg)
          .map(([key, value]) => {
            const starsNum = parseInt(key.replace(/[^0-9]/g, '')) || 0;
            return { name: key, value: value as number, starsNum };
          })
          .sort((a, b) => a.starsNum - b.starsNum)
          .map(item => ({ name: item.name, value: item.value }));

        const mergedChartData: ConsultorDetail['chartData'] = {
          engagement_distribution: Object.keys(engagementAgg).length ? engagementAgg : undefined,
          status_distribution: Object.keys(statusAgg).length ? statusAgg : undefined,
          stars_distribution: Object.keys(starsAgg).length ? starsAgg : undefined,
          stars_distribution_array: starsArray.length ? starsArray : undefined,
          top_bettors: allBettors.sort((a, b) => b.value - a.value).slice(0, 10),
          top_winners: allWinners.sort((a, b) => b.value - a.value).slice(0, 10),
          top_depositors: allDepositors.sort((a, b) => b.value - a.value).slice(0, 10),
          total_indicateds: totalIndicateds || undefined,
        };

        setData(prev => ({
          ...prev,
          ...first,
          consultor: first.consultor || prev?.consultor,
          externalKpis: aggregatedKpis ?? prev?.externalKpis ?? null,
          externalKpisError: null,
          chartData: mergedChartData,
        }));
      } else {
        let url = `/api/gerente/consultores/${consultorId}`;
        const params = new URLSearchParams();
        if (dateFrom) params.append('date_from', dateFrom);
        if (dateTo) params.append('date_to', dateTo);
        params.append('banca_url', selectedBanca);
        if (params.toString()) url += `?${params.toString()}`;

        const response = await fetch(url, {
          headers: { 'X-User-Id': userId as string }
        });
        const result = await response.json();

        if (result.success) {
          setData(prev => ({
            ...prev,
            ...result.data,
          }));
        } else {
          console.error('[Frontend Consultor Detail] Erro na resposta:', result.error);
        }
      }
    } catch (error) {
      console.error('Erro ao carregar detalhes:', error);
    } finally {
      setLoading(false);
    }
  };

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-[#1a1a1a]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#E86A24]"></div>
      </div>
    );
  }

  const handleSignOut = () => {
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('user_id');
      sessionStorage.removeItem('profile_id');
      window.localStorage.removeItem('profile_id');
      document.cookie = 'user_id=; Path=/; Max-Age=0; SameSite=Lax';
      window.location.href = withTenantSlug('/login');
    }
  };

  const consultor = data?.consultor || { id: '', email: '', full_name: '', created_at: '', enroller: '' };
  
  // Garante que temos pelo menos um valor para o avatar
  const avatarInitial = (consultor.full_name || consultor.email || 'C')[0]?.toUpperCase() || 'C';
  const externalKpis = data?.externalKpis || null;
  const externalKpisError = data?.externalKpisError || null;
  const chartData = data?.chartData || null;

  return (
    <Layout onSignOut={handleSignOut}>
      <div className="space-y-6 max-w-7xl mx-auto">
        {/* Breadcrumb & Header */}
        <div className="flex flex-col gap-4">
          <button
            onClick={() => router.push('/gerente')}
            className="flex items-center gap-2 text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors w-fit"
          >
            <ArrowLeft className="w-4 h-4" />
            Voltar para painel
          </button>

          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white dark:bg-[#2a2a2a] p-4 sm:p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-600">
            <div className="flex items-center gap-4 min-w-0">
              <div className="w-16 h-16 rounded-2xl bg-[#E86A24] flex items-center justify-center text-white text-2xl font-bold shadow-lg shadow-[#E86A24]/20 shrink-0">
                {avatarInitial}
              </div>
              <div className="min-w-0">
                <h1 className="text-xl sm:text-2xl font-bold text-gray-800 dark:text-white truncate">{consultor.full_name || 'Consultor sem nome'}</h1>
                <div className="flex items-center gap-3 mt-1 flex-wrap">
                  {consultor.created_at && (
                    <span className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
                      <Calendar className="w-4 h-4" />
                      No sistema desde {new Date(consultor.created_at).toLocaleDateString('pt-BR')}
                    </span>
                  )}
                  <span className="text-sm text-[#E86A24] bg-[#E86A2415] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider text-[10px]">Captador</span>
                </div>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-3 lg:gap-4">
              {/* Filtros */}
              <div className="flex flex-wrap items-center gap-3">
                {/* Filtro de Banca */}
                <div className="relative banca-filter-container">
                  <button
                    onClick={async () => {
                      if (!showBancaFilter && bancas.length === 0 && !bancasLoading) {
                        await loadBancas();
                      }
                      setShowBancaFilter(!showBancaFilter);
                      if (!showBancaFilter) {
                        setBancaSearchTerm('');
                      }
                    }}
                    disabled={bancasLoading}
                    className="flex items-center gap-2 min-h-[44px] bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-gray-600 px-4 py-2.5 rounded-xl text-sm font-bold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-all shadow-sm disabled:opacity-70 disabled:cursor-wait"
                  >
                    {bancasLoading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin text-[#E86A24]" />
                        Verificando bancas do consultor...
                      </>
                    ) : (
                      <>
                        <Filter className="w-4 h-4 text-[#E86A24]" />
                        {selectedBanca === 'all'
                          ? 'Todas as bancas'
                          : selectedBanca
                            ? bancas.find(b => b.url === selectedBanca)?.name || 'Banca selecionada'
                            : 'Selecione uma Banca'}
                        <ChevronDown className="w-4 h-4" />
                      </>
                    )}
                  </button>
                  
                  {showBancaFilter && (
                    <div className="absolute right-0 mt-2 bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-gray-600 rounded-xl shadow-lg z-50 max-h-[400px] overflow-hidden flex flex-col min-w-[250px]">
                      {bancasLoading ? (
                        <div className="p-6 flex items-center justify-center gap-2 text-gray-500 dark:text-gray-400">
                          <Loader2 className="w-5 h-5 animate-spin" />
                          <span className="text-sm">Verificando acesso do captador nas bancas...</span>
                        </div>
                      ) : (
                      <>
                      <div className="p-3 border-b border-gray-100 dark:border-gray-700">
                        <div className="relative">
                          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-500 dark:text-gray-400" />
                          <input
                            type="text"
                            placeholder="Pesquisar banca..."
                            value={bancaSearchTerm}
                            onChange={(e) => setBancaSearchTerm(e.target.value)}
                            className="w-full pl-10 pr-3 py-2 bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 font-bold focus:ring-2 focus:ring-[#E86A24]/30 outline-none placeholder:text-gray-500 dark:placeholder:text-gray-400"
                            autoFocus
                          />
                        </div>
                      </div>
                      
                      <div className="overflow-y-auto max-h-[320px] p-2">
                        <button
                          onClick={() => {
                            setSelectedBanca('all');
                            setShowBancaFilter(false);
                            setBancaSearchTerm('');
                          }}
                          className={`w-full text-left px-4 py-2.5 rounded-lg text-sm transition-colors hover:bg-gray-50 dark:hover:bg-gray-700 ${
                            selectedBanca === 'all' ? 'bg-[#E86A2415] dark:bg-[#E86A2425] text-[#E86A24] font-bold' : 'text-gray-700 dark:text-gray-300'
                          }`}
                        >
                          Todas as bancas
                        </button>
                        {bancas
                          .filter((banca) => 
                            banca.name.toLowerCase().includes(bancaSearchTerm.toLowerCase())
                          )
                          .length > 0 ? (
                          bancas
                            .filter((banca) => 
                              banca.name.toLowerCase().includes(bancaSearchTerm.toLowerCase())
                            )
                            .map((banca) => (
                              <button
                                key={banca.id}
                                onClick={() => {
                                  setSelectedBanca(banca.url);
                                  setShowBancaFilter(false);
                                  setBancaSearchTerm('');
                                }}
                                className={`w-full text-left px-4 py-2.5 rounded-lg text-sm transition-colors hover:bg-gray-50 dark:hover:bg-gray-700 ${
                                  selectedBanca === banca.url ? 'bg-[#E86A2415] dark:bg-[#E86A2425] text-[#E86A24] font-bold' : 'text-gray-700 dark:text-gray-300'
                                }`}
                              >
                                {banca.name}
                              </button>
                            ))
                        ) : (
                          <div className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
                            {bancas.length === 0
                              ? 'Este consultor não tem acesso a nenhuma das suas bancas.'
                              : 'Nenhuma banca encontrada'}
                          </div>
                        )}
                      </div>
                      </>
                      )}
                    </div>
                  )}
                </div>

                {/* Filtro de Data */}
                <DateRangeFilter value={dateRange} onChange={setDateRange} />
              </div>

              <button
                onClick={() => {
                  setAccessingCrm(true);
                  router.push(`/crm/kanban?userId=${consultor.id}`);
                }}
                disabled={accessingCrm}
                className="flex items-center gap-2 bg-[#E86A24] hover:bg-[#D95E1B] disabled:bg-[#E86A24]/50 disabled:cursor-wait text-white px-6 py-3 rounded-xl font-medium transition-colors shadow-sm"
              >
                {accessingCrm ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Acessando...
                  </>
                ) : (
                  <>
                    <Kanban className="w-5 h-5" />
                    Acessar CRM
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Erro real de API (NO_DATA é tratado como estado vazio do hero) */}
        {externalKpisError && externalKpisError !== 'NO_DATA' && (
          <Banner variant="error" title="Erro ao carregar métricas">
            {externalKpisError}
          </Banner>
        )}

        {/* KPIs Externos - Métricas CRM */}
        <KpiHero
          title={
            <span className="flex items-center gap-2">
              <BarChart3 className="w-6 h-6" />
              Métricas CRM
            </span>
          }
          columns={9}
          loading={loading}
          emptyMessage={
            externalKpisError === 'NO_DATA'
              ? 'Não há dados de clientes para o filtro selecionado. Tente alterar a banca ou o período.'
              : 'Selecione uma banca e período para visualizar as métricas'
          }
          items={
            externalKpis && !externalKpisError
              ? [
                  { icon: <Users className="w-4 h-4" />, label: 'Total de Leads', value: externalKpis.total_leads || 0 },
                  { icon: <CheckCircle2 className="w-4 h-4" />, label: 'Clientes Ativos', value: externalKpis.active_leads || 0 },
                  { icon: <DollarSign className="w-4 h-4" />, label: 'Total Depositado', value: `R$ ${(externalKpis.total_deposited || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}` },
                  { icon: <Target className="w-4 h-4" />, label: 'Total Apostado', value: `R$ ${(externalKpis.total_bets || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}` },
                  { icon: <Award className="w-4 h-4" />, label: 'Total Prêmios', value: `R$ ${(externalKpis.total_prizes || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}` },
                  { icon: <Trophy className="w-4 h-4" />, label: 'Clientes Premiados', value: externalKpis.awarded_clients_count || 0 },
                  { icon: <Wallet className="w-4 h-4" />, label: 'Lucro Líquido', value: `R$ ${(externalKpis.net_profit || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}` },
                  { icon: <BarChart3 className="w-4 h-4" />, label: 'Taxa de Conversão', value: `${(externalKpis.conversion_rate || 0).toFixed(2)}%` },
                  { icon: <TrendingUp className="w-4 h-4" />, label: 'LTV Médio', value: `R$ ${(externalKpis.ltv_avg || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` },
                ]
              : []
          }
        />

        {/* Análises e Gráficos */}
        <div className="relative bg-white dark:bg-[#2a2a2a] p-4 sm:p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-600">
          <h2 className="text-lg font-bold text-gray-800 dark:text-white mb-6 flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-[#E86A24]" />
            Análises e Gráficos
            {chartData?.total_indicateds !== undefined && (
              <span className="text-sm font-normal text-gray-500 dark:text-gray-400 ml-2">
                ({chartData.total_indicateds} indicados)
              </span>
            )}
          </h2>
          
          {chartData ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Engajamento - Jogou 1x, 2x, 3x+ */}
              {chartData.engagement_distribution && Object.keys(chartData.engagement_distribution).length > 0 && (
                <div className="bg-gray-50/50 dark:bg-[#333]/50 p-4 rounded-xl border border-gray-100 dark:border-gray-700">
                  <h3 className="text-sm font-bold text-gray-600 dark:text-gray-300 mb-4 flex items-center gap-2">
                    <Target className="w-4 h-4 text-[#E86A24]" />
                    Engajamento dos Clientes
                  </h3>
                  <div className="h-80">
                    <StatusDistributionChart 
                      data={chartData.engagement_distribution} 
                      colors={['#ef4444', '#f59e0b', '#3b82f6', '#10b981']} 
                    />
                  </div>
                </div>
              )}

              {/* Distribuição por Status */}
              {chartData.status_distribution && Object.keys(chartData.status_distribution).length > 0 && (
                <div className="bg-gray-50/50 dark:bg-[#333]/50 p-4 rounded-xl border border-gray-100 dark:border-gray-700">
                  <h3 className="text-sm font-bold text-gray-600 dark:text-gray-300 mb-4 flex items-center gap-2">
                    <Users className="w-4 h-4 text-purple-600" />
                    Status dos Clientes
                  </h3>
                  <div className="h-80">
                    <StatusDistributionChart 
                      data={chartData.status_distribution} 
                      colors={['#10b981', '#ef4444', '#f59e0b', '#3b82f6']} 
                    />
                  </div>
                </div>
              )}

              {/* Distribuição por Estrelas */}
              {chartData.stars_distribution_array && chartData.stars_distribution_array.length > 0 && (
                <div className="bg-gray-50/50 dark:bg-[#333]/50 p-4 rounded-xl border border-gray-100 dark:border-gray-700">
                  <h3 className="text-sm font-bold text-gray-600 dark:text-gray-300 mb-4 flex items-center gap-2">
                    <Star className="w-4 h-4 text-amber-500" />
                    Distribuição por Estrelas
                  </h3>
                  <div className="h-80">
                    <BancaRankingChart 
                      data={chartData.stars_distribution_array}
                      prefix=""
                      color="#f59e0b"
                    />
                  </div>
                </div>
              )}

              {/* Top Maiores Ganhadores */}
              {chartData.top_winners && chartData.top_winners.length > 0 && (
                <div className="bg-gray-50/50 dark:bg-[#333]/50 p-4 rounded-xl border border-gray-100 dark:border-gray-700">
                  <h3 className="text-sm font-bold text-gray-600 dark:text-gray-300 mb-4 flex items-center gap-2">
                    <Award className="w-4 h-4 text-emerald-600" />
                    Top 10 Maiores Ganhadores
                  </h3>
                  <div className="h-80">
                    <BancaRankingChart 
                      data={chartData.top_winners}
                      prefix="R$ "
                      color="#10b981"
                    />
                  </div>
                </div>
              )}

              {/* Top Maiores Depositantes */}
              {chartData.top_depositors && chartData.top_depositors.length > 0 && (
                <div className="bg-gray-50/50 dark:bg-[#333]/50 p-4 rounded-xl border border-gray-100 dark:border-gray-700">
                  <h3 className="text-sm font-bold text-gray-600 dark:text-gray-300 mb-4 flex items-center gap-2">
                    <DollarSign className="w-4 h-4 text-green-600" />
                    Top 10 Maiores Depositantes
                  </h3>
                  <div className="h-80">
                    <BancaRankingChart 
                      data={chartData.top_depositors}
                      prefix="R$ "
                      color="#22c55e"
                    />
                  </div>
                </div>
              )}

              {/* Top Maiores Apostadores */}
              {chartData.top_bettors && chartData.top_bettors.length > 0 && (
                <div className="bg-gray-50/50 dark:bg-[#333]/50 p-4 rounded-xl border border-gray-100 dark:border-gray-700">
                  <h3 className="text-sm font-bold text-gray-600 dark:text-gray-300 mb-4 flex items-center gap-2">
                    <Target className="w-4 h-4 text-blue-600" />
                    Top 10 Maiores Apostadores
                  </h3>
                  <div className="h-80">
                    <BancaRankingChart 
                      data={chartData.top_bettors}
                      prefix="R$ "
                      color="#3b82f6"
                    />
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-gray-500 dark:text-gray-400">
              <BarChart3 className="w-16 h-16 text-gray-300 dark:text-gray-600 mb-4" />
              <p className="text-base font-medium">Selecione uma banca e período para visualizar os gráficos</p>
            </div>
          )}
        </div>

      </div>
    </Layout>
  );
}

