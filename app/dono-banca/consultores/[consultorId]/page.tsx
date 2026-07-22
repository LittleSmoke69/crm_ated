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
  Shield,
  Phone,
  DollarSign,
  Award,
  BarChart3,
  AlertCircle,
  Star,
  Trophy,
  Loader2,
  Kanban
} from 'lucide-react';
import Layout from '@/components/Layout';
import { useRequireAuth } from '@/utils/useRequireAuth';
import { Banner, Button, DateRangeFilter, Skeleton, StatCardSkeleton, CardSkeleton } from '@/components/ui';
import { DatePreset, DateRangeValue, getDateRange } from '@/lib/ui/date-range';
import StatusDistributionChart from '@/components/Charts/StatusDistributionChart';
import TemporalEvolutionChart from '@/components/Charts/TemporalEvolutionChart';
import ActivityByWeekdayChart from '@/components/Charts/ActivityByWeekdayChart';
import ConversionFunnelChart from '@/components/Charts/ConversionFunnelChart';
import BancaRankingChart from '@/components/Charts/BancaRankingChart';

const DATE_PRESETS: DatePreset[] = ['daily', '7days', '15days', '30days', 'custom', 'all'];

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
    active_leads: number;
    conversion_rate: number;
    net_profit: number;
  } | null;
  externalKpisError?: string | null;
  chartData?: {
    status_distribution?: Record<string, number>;
    stars_distribution?: Record<string, number>;
    stars_distribution_array?: Array<{ name: string; value: number }>;
    top_bettors?: Array<{ name: string; value: number }>;
    top_winners?: Array<{ name: string; value: number }>;
    top_depositors?: Array<{ name: string; value: number }>;
    total_indicateds?: number;
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
  };
}

export default function DetalheConsultor() {
  const { checking, userId } = useRequireAuth();
  const params = useParams();
  const router = useTenantRouter();
  const consultorId = params?.consultorId as string;

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<ConsultorDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accessingCrm, setAccessingCrm] = useState(false);

  // Filtro de data
  const [dateRange, setDateRange] = useState<DateRangeValue>({ preset: 'daily' });

  useEffect(() => {
    if (!userId || !consultorId) return;
    loadData();
  }, [userId, consultorId, dateRange]);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const range = getDateRange(dateRange);

      let url = `/api/dono-banca/consultores/${consultorId}`;
      const params = new URLSearchParams();
      if (range?.startDate) params.append('date_from', range.startDate);
      if (range?.endDate) params.append('date_to', range.endDate);
      if (params.toString()) {
        url += `?${params.toString()}`;
      }

      const response = await fetch(url, {
        headers: { 'X-User-Id': userId as string }
      });
      const result = await response.json();

      if (result.success) {
        setData(result.data);
      } else {
        setError(result.error || 'Não foi possível carregar os dados do consultor.');
      }
    } catch (error) {
      console.error('Erro ao carregar detalhes:', error);
      setError('Erro ao carregar detalhes. Verifique sua conexão e tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = () => {
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('user_id');
      sessionStorage.removeItem('profile_id');
      window.localStorage.removeItem('profile_id');
      document.cookie = 'user_id=; Path=/; Max-Age=0; SameSite=Lax';
      window.location.href = withTenantSlug('/login');
    }
  };

  if (error) {
    return (
      <Layout onSignOut={handleSignOut}>
        <div className="w-full min-w-0 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 space-y-6">
          <button
            onClick={() => router.back()}
            className="flex items-center gap-2 text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-white transition-colors w-fit"
          >
            <ArrowLeft className="w-4 h-4" />
            Voltar
          </button>
          <Banner
            variant="error"
            title="Erro ao carregar dados"
            action={
              <Button size="sm" variant="secondary" onClick={loadData}>
                Tentar novamente
              </Button>
            }
          >
            {error}
          </Banner>
        </div>
      </Layout>
    );
  }

  if (checking || !data) {
    return (
      <Layout onSignOut={handleSignOut}>
        <div className="w-full min-w-0 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 space-y-6">
          <Skeleton className="h-5 w-24" />
          <CardSkeleton />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <CardSkeleton />
            <CardSkeleton />
          </div>
        </div>
      </Layout>
    );
  }

  const { consultor, campaigns, leadsCount, metrics, externalKpis, externalKpisError, chartData } = data;

  return (
    <Layout onSignOut={handleSignOut}>
      <div className="w-full min-w-0 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 space-y-6">
        {/* Breadcrumb & Header */}
        <div className="flex flex-col gap-4">
          <button
            onClick={() => router.back()}
            className="flex items-center gap-2 text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-white transition-colors w-fit"
          >
            <ArrowLeft className="w-4 h-4" />
            Voltar
          </button>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-[#2a2a2a] p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-600">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-2xl bg-purple-600 flex items-center justify-center text-white text-2xl font-bold shadow-lg shadow-purple-100 dark:shadow-none">
                {(consultor.full_name || consultor.email)[0].toUpperCase()}
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-800 dark:text-white">{consultor.full_name || 'Consultor sem nome'}</h1>
                <div className="flex items-center gap-3 mt-1">
                  <span className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
                    <Calendar className="w-4 h-4" />
                    No sistema desde {new Date(consultor.created_at).toLocaleDateString('pt-BR')}
                  </span>
                  <span className="text-sm text-purple-600 dark:text-purple-300 bg-purple-50 dark:bg-purple-500/20 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider text-[10px]">Consultor</span>
                </div>
              </div>
            </div>
            <button
              onClick={() => {
                setAccessingCrm(true);
                router.push(`/crm/kanban?userId=${consultor.id}`);
              }}
              disabled={accessingCrm}
              className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-400 disabled:cursor-wait text-white px-6 py-3 rounded-xl font-medium transition-colors shadow-sm"
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

        {/* KPIs Externos - Resumo Geral */}
        {externalKpisError && (
          <Banner variant="error">{externalKpisError}</Banner>
        )}

        {externalKpis && !externalKpisError && (
          <div className="bg-gradient-to-br from-emerald-500 to-emerald-600 dark:from-emerald-800 dark:to-emerald-900 p-6 rounded-2xl shadow-lg border border-emerald-400 dark:border-emerald-700">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
              <div className="flex items-center gap-2">
                <BarChart3 className="w-6 h-6 text-white" />
                <h2 className="text-xl font-bold text-white">Métricas CRM - {consultor.full_name || 'Consultor'}</h2>
              </div>

              {/* Filtro de Data */}
              <DateRangeFilter
                value={dateRange}
                onChange={setDateRange}
                presets={DATE_PRESETS}
              />
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-white/10 backdrop-blur-sm p-4 rounded-xl border border-white/20">
                <div className="flex items-center gap-2 mb-2">
                  <Users className="w-4 h-4 text-white" />
                  <p className="text-xs font-bold text-white/90 uppercase">Total de Leads</p>
                </div>
                <p className="text-2xl font-bold text-white">{externalKpis.total_leads || 0}</p>
              </div>

              <div className="bg-white/10 backdrop-blur-sm p-4 rounded-xl border border-white/20">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle2 className="w-4 h-4 text-white" />
                  <p className="text-xs font-bold text-white/90 uppercase">Clientes Ativos</p>
                </div>
                <p className="text-2xl font-bold text-white">{externalKpis.active_leads || 0}</p>
              </div>

              <div className="bg-white/10 backdrop-blur-sm p-4 rounded-xl border border-white/20">
                <div className="flex items-center gap-2 mb-2">
                  <DollarSign className="w-4 h-4 text-white" />
                  <p className="text-xs font-bold text-white/90 uppercase">Total Depositado</p>
                </div>
                <p className="text-2xl font-bold text-white">
                  R$ {(externalKpis.total_deposited || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                </p>
              </div>

              <div className="bg-white/10 backdrop-blur-sm p-4 rounded-xl border border-white/20">
                <div className="flex items-center gap-2 mb-2">
                  <Target className="w-4 h-4 text-white" />
                  <p className="text-xs font-bold text-white/90 uppercase">Total Apostado</p>
                </div>
                <p className="text-2xl font-bold text-white">
                  R$ {(externalKpis.total_bets || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                </p>
              </div>

              <div className="bg-white/10 backdrop-blur-sm p-4 rounded-xl border border-white/20">
                <div className="flex items-center gap-2 mb-2">
                  <Award className="w-4 h-4 text-white" />
                  <p className="text-xs font-bold text-white/90 uppercase">Total Prêmios</p>
                </div>
                <p className="text-2xl font-bold text-white">
                  R$ {(externalKpis.total_prizes || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                </p>
              </div>

              <div className="bg-white/10 backdrop-blur-sm p-4 rounded-xl border border-white/20">
                <div className="flex items-center gap-2 mb-2">
                  <TrendingUp className="w-4 h-4 text-white" />
                  <p className="text-xs font-bold text-white/90 uppercase">Lucro Líquido</p>
                </div>
                <p className="text-2xl font-bold text-white">
                  R$ {(externalKpis.net_profit || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                </p>
              </div>

              <div className="bg-white/10 backdrop-blur-sm p-4 rounded-xl border border-white/20">
                <div className="flex items-center gap-2 mb-2">
                  <BarChart3 className="w-4 h-4 text-white" />
                  <p className="text-xs font-bold text-white/90 uppercase">Taxa de Conversão</p>
                </div>
                <p className="text-2xl font-bold text-white">
                  {(externalKpis.conversion_rate || 0).toFixed(2)}%
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Análises e Gráficos - Dados do CRM */}
        <div className="relative bg-white dark:bg-[#2a2a2a] p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-600">
          {loading && (
            <div className="absolute inset-0 bg-white/80 dark:bg-[#2a2a2a]/80 backdrop-blur-sm rounded-2xl z-10 flex items-center justify-center">
              <Loader2 className="w-6 h-6 text-emerald-600 dark:text-emerald-400 animate-spin" />
            </div>
          )}
          {chartData ? (
            <>
              <h2 className="text-lg font-bold text-gray-800 dark:text-white mb-6 flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                Análises e Gráficos
                {chartData.total_indicateds !== undefined && (
                  <span className="text-sm font-normal text-gray-500 dark:text-gray-400 ml-2">
                    ({chartData.total_indicateds} indicados)
                  </span>
                )}
              </h2>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Distribuição por Status */}
                {chartData.status_distribution && Object.keys(chartData.status_distribution).length > 0 && (
                  <div className="bg-gray-50/50 dark:bg-[#333]/50 p-4 rounded-xl border border-gray-100 dark:border-gray-600">
                    <h3 className="text-sm font-bold text-gray-600 dark:text-gray-300 mb-4 flex items-center gap-2">
                      <Users className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                      Status dos Clientes
                    </h3>
                    <div className="h-80">
                      <StatusDistributionChart data={chartData.status_distribution} />
                    </div>
                  </div>
                )}

                {/* Distribuição por Estrelas */}
                {chartData.stars_distribution_array && chartData.stars_distribution_array.length > 0 && (
                  <div className="bg-gray-50/50 dark:bg-[#333]/50 p-4 rounded-xl border border-gray-100 dark:border-gray-600">
                    <h3 className="text-sm font-bold text-gray-600 dark:text-gray-300 mb-4 flex items-center gap-2">
                      <Star className="w-4 h-4 text-amber-500" />
                      Distribuição por Estrelas
                    </h3>
                    <div className="h-80">
                      <BancaRankingChart
                        data={chartData.stars_distribution_array}
                        prefix=""
                      />
                    </div>
                  </div>
                )}

                {/* Top Maiores Apostadores */}
                {chartData.top_bettors && chartData.top_bettors.length > 0 && (
                  <div className="bg-gray-50/50 dark:bg-[#333]/50 p-4 rounded-xl border border-gray-100 dark:border-gray-600">
                    <h3 className="text-sm font-bold text-gray-600 dark:text-gray-300 mb-4 flex items-center gap-2">
                      <Target className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                      Top 10 Maiores Apostadores
                    </h3>
                    <div className="h-80">
                      <BancaRankingChart
                        data={chartData.top_bettors}
                        prefix="R$ "
                      />
                    </div>
                  </div>
                )}

                {/* Top Maiores Ganhadores */}
                {chartData.top_winners && chartData.top_winners.length > 0 && (
                  <div className="bg-gray-50/50 dark:bg-[#333]/50 p-4 rounded-xl border border-gray-100 dark:border-gray-600">
                    <h3 className="text-sm font-bold text-gray-600 dark:text-gray-300 mb-4 flex items-center gap-2">
                      <Award className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                      Top 10 Maiores Ganhadores
                    </h3>
                    <div className="h-80">
                      <BancaRankingChart
                        data={chartData.top_winners}
                        prefix="R$ "
                      />
                    </div>
                  </div>
                )}

                {/* Top Maiores Depositantes */}
                {chartData.top_depositors && chartData.top_depositors.length > 0 && (
                  <div className="bg-gray-50/50 dark:bg-[#333]/50 p-4 rounded-xl border border-gray-100 dark:border-gray-600">
                    <h3 className="text-sm font-bold text-gray-600 dark:text-gray-300 mb-4 flex items-center gap-2">
                      <DollarSign className="w-4 h-4 text-green-600 dark:text-green-400" />
                      Top 10 Maiores Depositantes
                    </h3>
                    <div className="h-80">
                      <BancaRankingChart
                        data={chartData.top_depositors}
                        prefix="R$ "
                      />
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-gray-500 dark:text-gray-400">
              <BarChart3 className="w-16 h-16 text-gray-300 dark:text-gray-600 mb-4" />
              <p className="text-base font-medium">Carregando dados do CRM...</p>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
