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
  ChevronDown,
  Star,
  Trophy,
  Loader2,
  Kanban
} from 'lucide-react';
import Layout from '@/components/Layout';
import { useRequireAuth } from '@/utils/useRequireAuth';
import StatusDistributionChart from '@/components/Charts/StatusDistributionChart';
import TemporalEvolutionChart from '@/components/Charts/TemporalEvolutionChart';
import ActivityByWeekdayChart from '@/components/Charts/ActivityByWeekdayChart';
import ConversionFunnelChart from '@/components/Charts/ConversionFunnelChart';
import BancaRankingChart from '@/components/Charts/BancaRankingChart';

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
  const [accessingCrm, setAccessingCrm] = useState(false);
  
  // Filtro de data
  const [dateFilter, setDateFilter] = useState<'daily' | '7days' | '15days' | '30days' | 'custom' | 'all'>('daily');
  const [customStartDate, setCustomStartDate] = useState<string>('');
  const [customEndDate, setCustomEndDate] = useState<string>('');
  const [appliedStartDate, setAppliedStartDate] = useState<string>('');
  const [appliedEndDate, setAppliedEndDate] = useState<string>('');
  const [showDatePicker, setShowDatePicker] = useState(false);

  // Calcula as datas baseado no filtro selecionado
  const getDateRange = () => {
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    
    let dateFrom: string | null = null;
    let dateTo: string | null = null;
    
    switch (dateFilter) {
      case 'daily':
        const todayStr = today.toISOString().split('T')[0];
        dateFrom = todayStr;
        dateTo = todayStr;
        break;
      case '7days':
        const sevenDaysAgo = new Date(today);
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
        dateFrom = sevenDaysAgo.toISOString().split('T')[0];
        dateTo = today.toISOString().split('T')[0];
        break;
      case '15days':
        const fifteenDaysAgo = new Date(today);
        fifteenDaysAgo.setDate(fifteenDaysAgo.getDate() - 14);
        dateFrom = fifteenDaysAgo.toISOString().split('T')[0];
        dateTo = today.toISOString().split('T')[0];
        break;
      case '30days':
        const thirtyDaysAgo = new Date(today);
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29);
        dateFrom = thirtyDaysAgo.toISOString().split('T')[0];
        dateTo = today.toISOString().split('T')[0];
        break;
      case 'custom':
        if (appliedStartDate && appliedEndDate) {
          dateFrom = appliedStartDate;
          dateTo = appliedEndDate;
        }
        break;
      case 'all':
        dateFrom = null;
        dateTo = null;
        break;
    }
    
    return { dateFrom, dateTo };
  };

  useEffect(() => {
    if (!userId || !consultorId) return;
    loadData();
  }, [userId, consultorId, dateFilter, appliedStartDate, appliedEndDate]);

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

  const loadData = async () => {
    try {
      setLoading(true);
      const { dateFrom, dateTo } = getDateRange();
      
      let url = `/api/dono-banca/consultores/${consultorId}`;
      const params = new URLSearchParams();
      if (dateFrom) params.append('date_from', dateFrom);
      if (dateTo) params.append('date_to', dateTo);
      if (params.toString()) {
        url += `?${params.toString()}`;
      }
      
      const response = await fetch(url, {
        headers: { 'X-User-Id': userId as string }
      });
      const result = await response.json();
      console.log('[Frontend Consultores] Response status:', response.status);
      console.log('[Frontend Consultores] Result success:', result.success);
      console.log('[Frontend Consultores] chartData recebido:', result.data?.chartData ? 'presente' : 'null');
      
      if (result.success) {
        if (result.data?.chartData) {
          console.log('[Frontend Consultores] Estrutura dos dados de gráficos:', {
            hasStatusDistribution: !!result.data.chartData.status_distribution,
            hasTemporalEvolution: !!result.data.chartData.temporal_evolution,
            hasActivityByWeekday: !!result.data.chartData.activity_by_weekday,
            hasConversionFunnel: !!result.data.chartData.conversion_funnel,
          });
        }
        setData(result.data);
      } else {
        console.error('[Frontend Consultores] Erro na resposta:', result.error);
        router.push('/dono-banca');
      }
    } catch (error) {
      console.error('Erro ao carregar detalhes:', error);
    } finally {
      setLoading(false);
    }
  };

  if (checking || loading || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500"></div>
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

  const { consultor, campaigns, leadsCount, metrics, externalKpis, externalKpisError, chartData } = data;

  return (
    <Layout onSignOut={handleSignOut}>
      <div className="p-6 space-y-6 max-w-7xl mx-auto">
        {/* Breadcrumb & Header */}
        <div className="flex flex-col gap-4">
          <button 
            onClick={() => router.back()}
            className="flex items-center gap-2 text-gray-500 hover:text-gray-800 transition-colors w-fit"
          >
            <ArrowLeft className="w-4 h-4" />
            Voltar
          </button>
          
          <div className="flex items-center justify-between gap-4 bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-2xl bg-purple-600 flex items-center justify-center text-white text-2xl font-bold shadow-lg shadow-purple-100">
                {(consultor.full_name || consultor.email)[0].toUpperCase()}
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-800">{consultor.full_name || 'Consultor sem nome'}</h1>
                <div className="flex items-center gap-3 mt-1">
                  <span className="text-sm text-gray-500 flex items-center gap-1.5">
                    <Calendar className="w-4 h-4" />
                    No sistema desde {new Date(consultor.created_at).toLocaleDateString('pt-BR')}
                  </span>
                  <span className="text-sm text-purple-600 bg-purple-50 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider text-[10px]">Consultor</span>
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
          <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5" />
              <p className="font-medium">{externalKpisError}</p>
            </div>
          </div>
        )}

        {externalKpis && !externalKpisError && (
          <div className="bg-gradient-to-br from-emerald-500 to-emerald-600 p-6 rounded-2xl shadow-lg border border-emerald-400">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
              <div className="flex items-center gap-2">
                <BarChart3 className="w-6 h-6 text-white" />
                <h2 className="text-xl font-bold text-white">Métricas CRM - {consultor.full_name || 'Consultor'}</h2>
              </div>
              
              {/* Filtro de Data */}
              <div className="flex items-center gap-2 date-filter-container">
                <div className="relative">
                  <button
                    onClick={() => setShowDatePicker(!showDatePicker)}
                    className="flex items-center gap-2 bg-white/20 backdrop-blur-sm border border-white/30 px-4 py-2 rounded-xl text-sm font-medium text-white hover:bg-white/30 transition-colors"
                  >
                    <Calendar className="w-4 h-4" />
                    <span>
                      {dateFilter === 'daily' && 'Diário'}
                      {dateFilter === '7days' && 'Últimos 7 dias'}
                      {dateFilter === '15days' && 'Últimos 15 dias'}
                      {dateFilter === '30days' && 'Últimos 30 dias'}
                      {dateFilter === 'custom' && 'Personalizado'}
                      {dateFilter === 'all' && 'Todo o Período'}
                    </span>
                    <ChevronDown className="w-4 h-4" />
                  </button>
                  
                  {showDatePicker && (
                    <div className="absolute right-0 mt-2 bg-white border border-gray-200 rounded-xl shadow-lg z-50 min-w-[200px]">
                      <div className="p-2">
                        <button
                          onClick={() => {
                            setDateFilter('daily');
                            setShowDatePicker(false);
                          }}
                          className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                            dateFilter === 'daily' ? 'bg-emerald-50 text-emerald-700 font-medium' : 'text-gray-700 hover:bg-gray-50'
                          }`}
                        >
                          Diário
                        </button>
                        <button
                          onClick={() => {
                            setDateFilter('7days');
                            setShowDatePicker(false);
                          }}
                          className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                            dateFilter === '7days' ? 'bg-emerald-50 text-emerald-700 font-medium' : 'text-gray-700 hover:bg-gray-50'
                          }`}
                        >
                          Últimos 7 dias
                        </button>
                        <button
                          onClick={() => {
                            setDateFilter('15days');
                            setShowDatePicker(false);
                          }}
                          className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                            dateFilter === '15days' ? 'bg-emerald-50 text-emerald-700 font-medium' : 'text-gray-700 hover:bg-gray-50'
                          }`}
                        >
                          Últimos 15 dias
                        </button>
                        <button
                          onClick={() => {
                            setDateFilter('30days');
                            setShowDatePicker(false);
                          }}
                          className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                            dateFilter === '30days' ? 'bg-emerald-50 text-emerald-700 font-medium' : 'text-gray-700 hover:bg-gray-50'
                          }`}
                        >
                          Últimos 30 dias
                        </button>
                        <button
                          onClick={() => {
                            setDateFilter('custom');
                          }}
                          className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                            dateFilter === 'custom' ? 'bg-emerald-50 text-emerald-700 font-medium' : 'text-gray-700 hover:bg-gray-50'
                          }`}
                        >
                          Personalizado
                        </button>
                        <button
                          onClick={() => {
                            setDateFilter('all');
                            setShowDatePicker(false);
                          }}
                          className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                            dateFilter === 'all' ? 'bg-emerald-50 text-emerald-700 font-medium' : 'text-gray-700 hover:bg-gray-50'
                          }`}
                        >
                          Todo o Período
                        </button>
                      </div>
                      
                      {dateFilter === 'custom' && (
                        <div className="p-3 border-t border-gray-200 space-y-3">
                          <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">Data Inicial</label>
                            <input
                              type="date"
                              value={customStartDate}
                              onChange={(e) => setCustomStartDate(e.target.value)}
                              max={customEndDate || new Date().toISOString().split('T')[0]}
                              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
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
                              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
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
                            className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
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
        <div className="relative bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
          {loading && (
            <div className="absolute inset-0 bg-white/80 backdrop-blur-sm rounded-2xl z-10 flex items-center justify-center">
              <Loader2 className="w-6 h-6 text-emerald-600 animate-spin" />
            </div>
          )}
          {chartData ? (
            <>
              <h2 className="text-lg font-bold text-gray-800 mb-6 flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-emerald-600" />
                Análises e Gráficos
                {chartData.total_indicateds !== undefined && (
                  <span className="text-sm font-normal text-gray-500 ml-2">
                    ({chartData.total_indicateds} indicados)
                  </span>
                )}
              </h2>
              
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Distribuição por Status */}
                {chartData.status_distribution && Object.keys(chartData.status_distribution).length > 0 && (
                  <div className="bg-gray-50/50 p-4 rounded-xl border border-gray-100">
                    <h3 className="text-sm font-bold text-gray-600 mb-4 flex items-center gap-2">
                      <Users className="w-4 h-4 text-purple-600" />
                      Status dos Clientes
                    </h3>
                    <div className="h-80">
                      <StatusDistributionChart data={chartData.status_distribution} />
                    </div>
                  </div>
                )}

                {/* Distribuição por Estrelas */}
                {chartData.stars_distribution_array && chartData.stars_distribution_array.length > 0 && (
                  <div className="bg-gray-50/50 p-4 rounded-xl border border-gray-100">
                    <h3 className="text-sm font-bold text-gray-600 mb-4 flex items-center gap-2">
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
                  <div className="bg-gray-50/50 p-4 rounded-xl border border-gray-100">
                    <h3 className="text-sm font-bold text-gray-600 mb-4 flex items-center gap-2">
                      <Target className="w-4 h-4 text-blue-600" />
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
                  <div className="bg-gray-50/50 p-4 rounded-xl border border-gray-100">
                    <h3 className="text-sm font-bold text-gray-600 mb-4 flex items-center gap-2">
                      <Award className="w-4 h-4 text-emerald-600" />
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
                  <div className="bg-gray-50/50 p-4 rounded-xl border border-gray-100">
                    <h3 className="text-sm font-bold text-gray-600 mb-4 flex items-center gap-2">
                      <DollarSign className="w-4 h-4 text-green-600" />
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
            <div className="flex flex-col items-center justify-center py-12 text-gray-500">
              <BarChart3 className="w-16 h-16 text-gray-300 mb-4" />
              <p className="text-base font-medium">Carregando dados do CRM...</p>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}

