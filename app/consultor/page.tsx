'use client';

import React, { useEffect, useState } from 'react';
import Layout from '@/components/Layout';
import { useRequireAuth } from '@/utils/useRequireAuth';
import { 
  LayoutDashboard, 
  TrendingUp, 
  Users, 
  Target, 
  CheckCircle2, 
  DollarSign, 
  Award, 
  BarChart3, 
  Calendar, 
  ChevronDown, 
  AlertCircle,
  Briefcase,
  Rocket,
  Filter,
  Search,
  ArrowUpRight,
  Wallet
} from 'lucide-react';
import Link from 'next/link';
import StatusDistributionChart from '@/components/Charts/StatusDistributionChart';
import ActivityByWeekdayChart from '@/components/Charts/ActivityByWeekdayChart';
import ConversionFunnelChart from '@/components/Charts/ConversionFunnelChart';
import TopPerformersChart from '@/components/Charts/TopPerformersChart';
import StarsDistributionChart from '@/components/Charts/StarsDistributionChart';

interface ExternalKpis {
  total_leads: number;
  total_deposited: number;
  total_bets: number;
  total_prizes: number;
  total_withdrawals?: number;
  active_leads: number;
  conversion_rate: number;
  net_profit: number;
  clientes_premiados?: number;
  ltv_medio?: number;
}

interface ChartData {
  engagement_distribution?: Record<string, number>;
  status_distribution?: Record<string, number>;
  conversion_funnel?: {
    stages: string[];
    values: number[];
  };
  activity_by_weekday?: {
    weekdays: string[];
    values: number[];
  };
  top_ganhadores?: Array<{ name: string; phone?: string; value: number }>;
  top_depositantes?: Array<{ name: string; phone?: string; value: number }>;
  stars_distribution?: Record<string, number>;
  clientes_afiliados?: number;
}

interface DashboardData {
  externalKpis?: ExternalKpis | null;
  externalKpisError?: string | null;
  chartData?: ChartData | null;
}

export default function ConsultorPage() {
  const { checking, userId } = useRequireAuth();
  const [initialLoading, setInitialLoading] = useState(true);
  const [dataLoading, setDataLoading] = useState(false);
  const [data, setData] = useState<DashboardData | null>(null);
  
  // Filtro de busca por
  const [searchBy, setSearchBy] = useState<'created_at' | 'last_deposit_at'>('created_at');
  const [showSearchByFilter, setShowSearchByFilter] = useState(false);

  // Filtro de banca
  const [bancas, setBancas] = useState<any[]>([]);
  const [selectedBanca, setSelectedBanca] = useState<string | null>(null);
  const [showBancaFilter, setShowBancaFilter] = useState(false);
  const [bancaSearchTerm, setBancaSearchTerm] = useState('');

  // Filtro de data
  const [dateFilter, setDateFilter] = useState<'daily' | 'yesterday' | '7days' | '15days' | '30days' | 'custom' | 'all'>('daily');
  const [customStartDate, setCustomStartDate] = useState<string>('');
  const [customEndDate, setCustomEndDate] = useState<string>('');
  const [appliedStartDate, setAppliedStartDate] = useState<string>('');
  const [appliedEndDate, setAppliedEndDate] = useState<string>('');
  const [showDatePicker, setShowDatePicker] = useState(false);

  // Função auxiliar para formatar data no formato YYYY-MM-DD usando fuso horário local
  const formatDateLocal = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // Calcula as datas baseado no filtro selecionado
  const getDateRange = () => {
    // Usa a data atual no fuso horário local
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    let dateFrom: string | null = null;
    let dateTo: string | null = null;
    
    switch (dateFilter) {
      case 'daily':
        // Hoje
        dateFrom = formatDateLocal(today);
        dateTo = formatDateLocal(today);
        break;
      case 'yesterday':
        // Ontem (hoje - 1 dia)
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        dateFrom = formatDateLocal(yesterday);
        dateTo = formatDateLocal(yesterday);
        break;
      case '7days':
        // Últimos 7 dias (hoje até 7 dias atrás)
        const sevenDaysAgo = new Date(today);
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6); // -6 porque inclui hoje (total 7 dias)
        dateFrom = formatDateLocal(sevenDaysAgo);
        dateTo = formatDateLocal(today);
        break;
      case '15days':
        // Últimos 15 dias (hoje até 15 dias atrás)
        const fifteenDaysAgo = new Date(today);
        fifteenDaysAgo.setDate(fifteenDaysAgo.getDate() - 14); // -14 porque inclui hoje (total 15 dias)
        dateFrom = formatDateLocal(fifteenDaysAgo);
        dateTo = formatDateLocal(today);
        break;
      case '30days':
        // Últimos 30 dias (hoje até 30 dias atrás)
        const thirtyDaysAgo = new Date(today);
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29); // -29 porque inclui hoje (total 30 dias)
        dateFrom = formatDateLocal(thirtyDaysAgo);
        dateTo = formatDateLocal(today);
        break;
      case 'custom':
        // Personalizado: usa as datas aplicadas pelo usuário
        if (appliedStartDate && appliedEndDate) {
          dateFrom = appliedStartDate;
          dateTo = appliedEndDate;
        }
        break;
      case 'all':
        // Todo o período: não envia filtro de data
        dateFrom = null;
        dateTo = null;
        break;
    }
    
    return { dateFrom, dateTo };
  };

  useEffect(() => {
    if (!userId) return;
    loadBancas();
    // Não carrega dados automaticamente - só quando filtro for aplicado
    setInitialLoading(false);
  }, [userId]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('.date-filter-container')) {
        setShowDatePicker(false);
      }
      if (!target.closest('.banca-filter-container')) {
        setShowBancaFilter(false);
      }
    };
    
    if (showDatePicker || showBancaFilter || showSearchByFilter) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showDatePicker, showBancaFilter, showSearchByFilter]);

  const loadBancas = async () => {
    try {
      const response = await fetch('/api/crm/bancas', {
        headers: {
          'X-User-Id': userId as string,
        },
      });
      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          setBancas(result.data || []);
        }
      }
    } catch (error) {
      console.error('Erro ao carregar bancas:', error);
    }
  };

  const loadDashboard = async () => {
    // Só carrega se houver banca selecionada
    if (!selectedBanca) {
      setData(null);
      return;
    }

    try {
      setDataLoading(true);
      
      const { dateFrom, dateTo } = getDateRange();
      
      let url = '/api/consultor/dashboard';
      const params = new URLSearchParams();
      if (dateFrom) params.append('date_from', dateFrom);
      if (dateTo) params.append('date_to', dateTo);
      if (selectedBanca) params.append('banca_url', selectedBanca);
      params.append('search_by', searchBy); // Adiciona o filtro de busca por
      if (params.toString()) {
        url += `?${params.toString()}`;
      }

      const response = await fetch(url, {
        headers: {
          'X-User-Id': userId as string,
        },
      });

      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          setData(result.data);
        }
      }
    } catch (error) {
      console.error('Erro ao carregar dashboard:', error);
    } finally {
      setDataLoading(false);
    }
  };

  // Carrega dados quando filtros mudarem (mas só se banca estiver selecionada)
  useEffect(() => {
    if (!userId || initialLoading) return;
    // Só carrega se houver banca selecionada
    if (selectedBanca) {
      loadDashboard();
    } else {
      // Limpa dados se não houver banca selecionada
      setData(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFilter, appliedStartDate, appliedEndDate, selectedBanca, searchBy]);

  const handleSignOut = () => {
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('user_id');
      sessionStorage.removeItem('profile_id');
      window.localStorage.removeItem('profile_id');
      document.cookie = 'user_id=; Path=/; Max-Age=0; SameSite=Lax';
      window.location.href = '/login';
    }
  };

  if (checking || initialLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#8CD955]"></div>
      </div>
    );
  }

  const { externalKpis, externalKpisError, chartData } = data || {};

  return (
    <Layout onSignOut={handleSignOut}>
      <div className="w-full space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-[#8CD95515] rounded-xl">
              <LayoutDashboard className="w-6 h-6 text-[#8CD955]" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-800">Meu Desempenho</h1>
              <p className="text-sm text-gray-500">Acompanhe suas métricas e resultados pessoais</p>
            </div>
          </div>

          <div className="flex gap-2 flex-wrap">
            {/* Filtro de Buscar Por */}
            <div className="relative search-by-filter-container">
              <button
                onClick={() => setShowSearchByFilter(!showSearchByFilter)}
                className="flex items-center gap-2 bg-white border border-gray-200 px-4 py-2.5 rounded-xl text-sm font-bold text-gray-700 hover:bg-gray-50 transition-all shadow-sm"
              >
                <Search className="w-4 h-4 text-[#8CD955]" />
                <span>
                  {searchBy === 'created_at' ? 'Data de cadastro' : 'Último depósito'}
                </span>
                <ChevronDown className={`w-4 h-4 transition-transform ${showSearchByFilter ? 'rotate-180' : ''}`} />
              </button>

              {showSearchByFilter && (
                <div className="absolute left-0 mt-2 w-56 bg-white border border-gray-100 rounded-2xl shadow-xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                  <div className="p-2">
                    <button
                      onClick={() => {
                        setSearchBy('created_at');
                        setShowSearchByFilter(false);
                      }}
                      className={`w-full text-left px-3 py-2.5 rounded-xl text-sm transition-all mb-1 ${
                        searchBy === 'created_at' ? 'bg-[#8CD95510] text-[#8CD955] font-bold' : 'text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      Data de cadastro
                    </button>
                    <button
                      onClick={() => {
                        setSearchBy('last_deposit_at');
                        setShowSearchByFilter(false);
                      }}
                      className={`w-full text-left px-3 py-2.5 rounded-xl text-sm transition-all ${
                        searchBy === 'last_deposit_at' ? 'bg-[#8CD95510] text-[#8CD955] font-bold' : 'text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      Último depósito
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Filtro de Banca */}
            <div className="relative banca-filter-container">
              <button
                onClick={() => setShowBancaFilter(!showBancaFilter)}
                className="flex items-center gap-2 bg-white border border-gray-200 px-4 py-2.5 rounded-xl text-sm font-bold text-gray-700 hover:bg-gray-50 transition-all shadow-sm"
              >
                <Filter className="w-4 h-4 text-[#8CD955]" />
                <span className="truncate max-w-[150px]">
                  {selectedBanca ? bancas.find(b => b.url === selectedBanca)?.name || 'Banca Selecionada' : 'Todas as Bancas'}
                </span>
                <ChevronDown className={`w-4 h-4 transition-transform ${showBancaFilter ? 'rotate-180' : ''}`} />
              </button>

              {showBancaFilter && (
                <div className="absolute right-0 mt-2 w-72 bg-white border border-gray-100 rounded-2xl shadow-xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                  <div className="p-3 border-b border-gray-100">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input
                        type="text"
                        placeholder="Buscar banca..."
                        value={bancaSearchTerm}
                        onChange={(e) => setBancaSearchTerm(e.target.value)}
                        className="w-full pl-9 pr-3 py-2 bg-gray-50 border-none rounded-lg text-sm text-[#8CD955] font-bold focus:ring-2 focus:ring-[#8CD955]/20 placeholder:text-gray-400 outline-none"
                      />
                    </div>
                  </div>
                  <div className="max-h-64 overflow-y-auto p-2">
                    <button
                      onClick={() => {
                        setSelectedBanca(null);
                        setShowBancaFilter(false);
                      }}
                      className={`w-full text-left px-3 py-2.5 rounded-xl text-sm transition-all mb-1 ${
                        !selectedBanca ? 'bg-[#8CD95510] text-[#8CD955] font-bold' : 'text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      Todas as Bancas
                    </button>
                    {bancas
                      .filter(b => (b.name || '').toLowerCase().includes(bancaSearchTerm.toLowerCase()))
                      .map((banca) => (
                        <button
                          key={banca.id}
                          onClick={() => {
                            setSelectedBanca(banca.url);
                            setShowBancaFilter(false);
                          }}
                          className={`w-full text-left px-3 py-2.5 rounded-xl text-sm transition-all mb-1 ${
                            selectedBanca === banca.url ? 'bg-[#8CD95510] text-[#8CD955] font-bold' : 'text-gray-600 hover:bg-gray-50'
                          }`}
                        >
                          <div className="font-bold">{banca.name}</div>
                        </button>
                      ))}
                  </div>
                </div>
              )}
            </div>

            {/* Filtro de Data */}
            <div className="relative date-filter-container">
              <button
                onClick={() => setShowDatePicker(!showDatePicker)}
                className="flex items-center gap-2 bg-white border border-gray-200 px-4 py-2.5 rounded-xl text-sm font-bold text-gray-700 hover:bg-gray-50 transition-all shadow-sm"
              >
                <Calendar className="w-4 h-4 text-[#8CD955]" />
                {dateFilter === 'daily' && 'Diário'}
                {dateFilter === 'yesterday' && 'Ontem'}
                {dateFilter === '7days' && 'Últimos 7 dias'}
                {dateFilter === '15days' && 'Últimos 15 dias'}
                {dateFilter === '30days' && 'Últimos 30 dias'}
                {dateFilter === 'custom' && 'Personalizado'}
                {dateFilter === 'all' && 'Todo o Período'}
                <ChevronDown className="w-4 h-4" />
              </button>
              
              {showDatePicker && (
                <div className="absolute right-0 mt-2 bg-white border border-gray-200 rounded-xl shadow-lg z-50 min-w-[200px]">
                  <div className="p-2">
                    {['daily', 'yesterday', '7days', '15days', '30days', 'custom', 'all'].map((filter) => (
                      <button
                        key={filter}
                        onClick={() => {
                          if (filter !== 'custom') {
                            setDateFilter(filter as any);
                            setShowDatePicker(false);
                          } else {
                            setDateFilter('custom');
                          }
                        }}
                        className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                          dateFilter === filter ? 'bg-[#8CD95515] text-[#8CD955] font-medium' : 'text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        {filter === 'daily' && 'Diário'}
                        {filter === 'yesterday' && 'Ontem'}
                        {filter === '7days' && 'Últimos 7 dias'}
                        {filter === '15days' && 'Últimos 15 dias'}
                        {filter === '30days' && 'Últimos 30 dias'}
                        {filter === 'custom' && 'Personalizado'}
                        {filter === 'all' && 'Todo o Período'}
                      </button>
                    ))}
                    
                    {dateFilter === 'custom' && (
                      <div className="p-3 border-t border-gray-200 space-y-3 mt-2">
                        <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1">Data Inicial</label>
                          <input
                            type="date"
                            value={customStartDate}
                            onChange={(e) => setCustomStartDate(e.target.value)}
                            max={customEndDate || new Date().toISOString().split('T')[0]}
                            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955]"
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
                            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955]"
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
                          className="w-full bg-[#8CD955] hover:bg-[#7BC84A] text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                        >
                          Aplicar
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <Link
              href="/crm/kanban"
              className="flex items-center gap-2 bg-[#8CD955] hover:bg-[#7BC84A] text-white px-4 py-2.5 rounded-xl text-sm font-bold transition-all shadow-md shadow-[#8CD955]/20"
            >
              <Users className="w-4 h-4" />
              Meu CRM
            </Link>
          </div>
        </div>

        {/* Resumo de Performance */}
        <div className="relative">
          {dataLoading && (
            <div className="absolute inset-0 bg-white/80 backdrop-blur-sm rounded-2xl z-10 flex items-center justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#8CD955]"></div>
            </div>
          )}
          
          {(() => {
            if (externalKpisError) {
              return (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 text-center">
                  <AlertCircle className="w-12 h-12 text-amber-500 mx-auto mb-4" />
                  <p className="text-amber-700 font-medium">{externalKpisError}</p>
                </div>
              );
            }
            
            if (externalKpis) {
              return (
                <div className="bg-gradient-to-br from-[#A8E677] to-[#8CD955] p-6 rounded-2xl shadow-lg border border-[#8CD955]/40 text-white">
                  <div className="flex items-center gap-2 mb-6">
                    <TrendingUp className="w-6 h-6 text-white" />
                    <h2 className="text-xl font-bold">Resumo de Resultados</h2>
                  </div>
                  
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-4 gap-4">
                    {/* 1. Total Leads */}
                    <div className="bg-white/10 backdrop-blur-sm p-4 rounded-xl border border-white/20">
                      <div className="flex items-center gap-2 mb-1">
                        <Users className="w-4 h-4 text-white/80" />
                        <p className="text-[10px] font-bold text-white/80 uppercase">Total Leads</p>
                      </div>
                      <p className="text-2xl font-bold">{externalKpis.total_leads || 0}</p>
                    </div>
                    
                    {/* 2. Leads Ativos */}
                    <div className="bg-white/10 backdrop-blur-sm p-4 rounded-xl border border-white/20">
                      <div className="flex items-center gap-2 mb-1">
                        <CheckCircle2 className="w-4 h-4 text-white/80" />
                        <p className="text-[10px] font-bold text-white/80 uppercase">Leads Ativos</p>
                      </div>
                      <p className="text-2xl font-bold">{externalKpis.active_leads || 0}</p>
                    </div>
                    
                    {/* 3. Leads Inativos */}
                    <div className="bg-white/10 backdrop-blur-sm p-4 rounded-xl border border-white/20">
                      <div className="flex items-center gap-2 mb-1">
                        <AlertCircle className="w-4 h-4 text-white/80" />
                        <p className="text-[10px] font-bold text-white/80 uppercase">Leads Inativos</p>
                      </div>
                      <p className="text-2xl font-bold">{(externalKpis.total_leads || 0) - (externalKpis.active_leads || 0)}</p>
                    </div>
                    
                    {/* 4. Taxa de Conversão */}
                    <div className="bg-white/10 backdrop-blur-sm p-4 rounded-xl border border-white/20">
                      <p className="text-[10px] font-bold text-white/80 uppercase mb-1">Taxa de Conversão</p>
                      <p className="text-2xl font-bold">{externalKpis.conversion_rate.toFixed(2)}%</p>
                    </div>
                    
                    {/* 5. Clientes Afiliados */}
                    <div className="bg-white/10 backdrop-blur-sm p-4 rounded-xl border border-white/20">
                      <p className="text-[10px] font-bold text-white/80 uppercase mb-1">Clientes Afiliados</p>
                      <p className="text-2xl font-bold">{chartData?.clientes_afiliados || 0}</p>
                    </div>
                    
                    {/* 6. Total Depositado */}
                    <div className="bg-white/10 backdrop-blur-sm p-4 rounded-xl border border-white/20">
                      <p className="text-[10px] font-bold text-white/80 uppercase mb-1">Total Depositado</p>
                      <p className="text-2xl font-bold">R$ {externalKpis.total_deposited.toLocaleString('pt-BR')}</p>
                    </div>
                    
                    {/* 7. Total Apostado */}
                    <div className="bg-white/10 backdrop-blur-sm p-4 rounded-xl border border-white/20">
                      <div className="flex items-center gap-2 mb-1">
                        <Target className="w-4 h-4 text-white/80" />
                        <p className="text-[10px] font-bold text-white/80 uppercase">Total Apostado</p>
                      </div>
                      <p className="text-2xl font-bold">R$ {externalKpis.total_bets.toLocaleString('pt-BR')}</p>
                    </div>
                    
                    {/* 8. Total Premiado */}
                    <div className="bg-white/10 backdrop-blur-sm p-4 rounded-xl border border-white/20">
                      <div className="flex items-center gap-2 mb-1">
                        <Award className="w-4 h-4 text-white/80" />
                        <p className="text-[10px] font-bold text-white/80 uppercase">Total Premiado</p>
                      </div>
                      <p className="text-2xl font-bold">R$ {externalKpis.total_prizes.toLocaleString('pt-BR')}</p>
                    </div>
                    
                    {/* 9. Clientes Premiados */}
                    <div className="bg-white/10 backdrop-blur-sm p-4 rounded-xl border border-white/20">
                      <div className="flex items-center gap-2 mb-1">
                        <Award className="w-4 h-4 text-white/80" />
                        <p className="text-[10px] font-bold text-white/80 uppercase">Clientes Premiados</p>
                      </div>
                      <p className="text-2xl font-bold">{externalKpis.clientes_premiados || 0}</p>
                    </div>
                  </div>
                </div>
              );
            }
            
            if (!initialLoading && !dataLoading && !selectedBanca) {
              return (
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center">
                  <Filter className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                  <p className="text-gray-600 font-medium mb-2">Selecione uma banca para visualizar os dados</p>
                  <p className="text-sm text-gray-500">Use o filtro acima para escolher uma banca e aplicar os filtros de período</p>
                </div>
              );
            }
            
            if (!initialLoading && !dataLoading && selectedBanca) {
              return (
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center">
                  <AlertCircle className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                  <p className="text-gray-600 font-medium">Dados de performance não encontrados</p>
                </div>
              );
            }
            
            return null;
          })()}
        </div>

        {/* Gráficos */}
        <div className="relative">
          {dataLoading && (
            <div className="absolute inset-0 bg-white/80 backdrop-blur-sm rounded-2xl z-10 flex items-center justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#8CD955]"></div>
            </div>
          )}
          
          {(() => {
            if (chartData) {
              return (
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                  <h2 className="text-lg font-bold text-gray-800 mb-6 flex items-center gap-2">
                    <BarChart3 className="w-5 h-5 text-[#8CD955]" />
                    Análises e Gráficos
                  </h2>
                  
                  <div className="space-y-6">
                    {/* Primeira linha: Top Ganhadores e Top Depositantes */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      {chartData.top_ganhadores && chartData.top_ganhadores.length > 0 && (
                        <div className="bg-gray-50/50 p-4 rounded-xl border border-gray-100">
                          <TopPerformersChart 
                            data={chartData.top_ganhadores}
                            title="Top Ganhadores"
                            color="#22c55e"
                            valueLabel="Ganhos"
                          />
                        </div>
                      )}

                      {chartData.top_depositantes && chartData.top_depositantes.length > 0 && (
                        <div className="bg-gray-50/50 p-4 rounded-xl border border-gray-100">
                          <TopPerformersChart 
                            data={chartData.top_depositantes}
                            title="Top Depositantes"
                            color="#3b82f6"
                            valueLabel="Depósitos"
                          />
                        </div>
                      )}
                    </div>

                    {/* Segunda linha: Gráficos de distribuição */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-2 gap-6">
                      {/* Engajamento e Recorrência */}
                      {chartData.engagement_distribution && (
                        <div className="bg-gray-50/50 p-4 rounded-xl border border-gray-100">
                          <h3 className="text-sm font-bold text-gray-600 mb-4">Engajamento e Recorrência</h3>
                          <div className="h-64">
                            <StatusDistributionChart 
                              data={chartData.engagement_distribution} 
                              colors={['#f59e0b', '#86efac', '#22c55e', '#3b82f6', '#8b5cf6']}
                            />
                          </div>
                        </div>
                      )}

                      {/* Clientes Estrelas */}
                      {chartData.stars_distribution && (
                        <div className="bg-gray-50/50 p-4 rounded-xl border border-gray-100">
                          <h3 className="text-sm font-bold text-gray-600 mb-4">Clientes Estrelas</h3>
                          <div className="h-64">
                            <StarsDistributionChart data={chartData.stars_distribution} />
                          </div>
                        </div>
                      )}

                      {/* Distribuição por Status */}
                      {chartData.status_distribution && (
                        <div className="bg-gray-50/50 p-4 rounded-xl border border-gray-100">
                          <h3 className="text-sm font-bold text-gray-600 mb-4">Distribuição por Status</h3>
                          <div className="h-64">
                            <StatusDistributionChart 
                              data={chartData.status_distribution} 
                              colors={['#10b981', '#ef4444']} 
                            />
                          </div>
                        </div>
                      )}

                      {/* Atividade por Dia da Semana */}
                      {chartData.activity_by_weekday && (
                        <div className="bg-gray-50/50 p-4 rounded-xl border border-gray-100">
                          <h3 className="text-sm font-bold text-gray-600 mb-4">Atividade por Dia da Semana</h3>
                          <div className="h-64">
                            <ActivityByWeekdayChart data={chartData.activity_by_weekday} />
                          </div>
                        </div>
                      )}

                      {/* Funil de Conversão */}
                      {chartData.conversion_funnel && (
                        <div className="bg-gray-50/50 p-4 rounded-xl border border-gray-100">
                          <h3 className="text-sm font-bold text-gray-600 mb-4">Funil de Conversão</h3>
                          <div className="h-64">
                            <ConversionFunnelChart data={chartData.conversion_funnel} />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            }
            
            if (!initialLoading && !dataLoading && !selectedBanca) {
              return (
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                  <div className="text-center py-8">
                    <Filter className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                    <p className="text-gray-600 font-medium">Selecione uma banca para visualizar os gráficos</p>
                  </div>
                </div>
              );
            }
            
            if (!initialLoading && !dataLoading && selectedBanca) {
              return (
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                  <div className="text-center py-8">
                    <AlertCircle className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                    <p className="text-gray-600 font-medium">Dados não encontrados</p>
                  </div>
                </div>
              );
            }
            
            return null;
          })()}
        </div>
      </div>
    </Layout>
  );
}
