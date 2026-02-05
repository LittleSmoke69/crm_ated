'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
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
  AlertCircle,
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
import FinancialMetricsBarChart from '@/components/Charts/FinancialMetricsBarChart';
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
  const router = useRouter();
  const consultorId = params?.consultorId as string;
  
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ConsultorDetail | null>(null);
  const [accessingCrm, setAccessingCrm] = useState(false);
  
  // Filtro de banca
  const [bancas, setBancas] = useState<Array<{ id: string; name: string; url: string }>>([]);
  const [selectedBanca, setSelectedBanca] = useState<string>('');
  const [showBancaFilter, setShowBancaFilter] = useState(false);
  const [bancaSearchTerm, setBancaSearchTerm] = useState<string>('');
  
  // Filtro de data
  const [dateFilter, setDateFilter] = useState<'daily' | 'yesterday' | '7days' | '15days' | '30days' | 'custom' | 'all'>('daily');
  const [customStartDate, setCustomStartDate] = useState<string>('');
  const [customEndDate, setCustomEndDate] = useState<string>('');
  const [appliedStartDate, setAppliedStartDate] = useState<string>('');
  const [appliedEndDate, setAppliedEndDate] = useState<string>('');
  const [showDatePicker, setShowDatePicker] = useState(false);

  // Calcula as datas baseado no filtro selecionado
  const getDateRange = () => {
    let dateFrom: string | null = null;
    let dateTo: string | null = null;
    
    switch (dateFilter) {
      case 'daily':
        const todayDate = new Date();
        todayDate.setHours(0, 0, 0, 0);
        const todayStr = todayDate.toISOString().split('T')[0];
        dateFrom = todayStr;
        dateTo = todayStr;
        break;
      case 'yesterday':
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        yesterday.setHours(0, 0, 0, 0);
        const yesterdayStr = yesterday.toISOString().split('T')[0];
        dateFrom = yesterdayStr;
        dateTo = yesterdayStr;
        break;
      case '7days':
        const today7 = new Date();
        today7.setHours(0, 0, 0, 0);
        const sevenDaysAgo = new Date(today7);
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
        dateFrom = sevenDaysAgo.toISOString().split('T')[0];
        dateTo = today7.toISOString().split('T')[0];
        break;
      case '15days':
        const today15 = new Date();
        today15.setHours(0, 0, 0, 0);
        const fifteenDaysAgo = new Date(today15);
        fifteenDaysAgo.setDate(fifteenDaysAgo.getDate() - 14);
        dateFrom = fifteenDaysAgo.toISOString().split('T')[0];
        dateTo = today15.toISOString().split('T')[0];
        break;
      case '30days':
        const today30 = new Date();
        today30.setHours(0, 0, 0, 0);
        const thirtyDaysAgo = new Date(today30);
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29);
        dateFrom = thirtyDaysAgo.toISOString().split('T')[0];
        dateTo = today30.toISOString().split('T')[0];
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

  // Carrega bancas e dados básicos do consultor ao montar o componente
  useEffect(() => {
    if (!userId) return;
    loadBancas();
    loadConsultorInfo();
  }, [userId, consultorId]);

  // Carrega dados do CRM quando banca e filtros mudarem
  useEffect(() => {
    if (!userId || !consultorId || !selectedBanca) return;
    loadData();
  }, [userId, consultorId, selectedBanca, dateFilter, appliedStartDate, appliedEndDate]);

  // Fecha os seletores ao clicar fora
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

  const loadBancas = async () => {
    try {
      const response = await fetch('/api/crm/bancas', {
        headers: { 'X-User-Id': userId as string }
      });
      const result = await response.json();
      
      if (result.success) {
        setBancas(result.data || []);
      }
    } catch (error) {
      console.error('Erro ao carregar bancas:', error);
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
    if (!selectedBanca) {
      return; // Não carrega dados do CRM se não houver banca selecionada
    }
    
    try {
      setLoading(true);
      const { dateFrom, dateTo } = getDateRange();
      
      let url = `/api/gerente/consultores/${consultorId}`;
      const params = new URLSearchParams();
      if (dateFrom) params.append('date_from', dateFrom);
      if (dateTo) params.append('date_to', dateTo);
      params.append('banca_url', selectedBanca);
      if (params.toString()) {
        url += `?${params.toString()}`;
      }
      
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
    } catch (error) {
      console.error('Erro ao carregar detalhes:', error);
    } finally {
      setLoading(false);
    }
  };

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#8CD955]"></div>
      </div>
    );
  }

  const handleSignOut = () => {
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('user_id');
      sessionStorage.removeItem('profile_id');
      window.localStorage.removeItem('profile_id');
      document.cookie = 'user_id=; Path=/; Max-Age=0; SameSite=Lax';
      window.location.href = '/login';
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
      <div className="p-6 space-y-6 max-w-7xl mx-auto">
        {/* Breadcrumb & Header */}
        <div className="flex flex-col gap-4">
          <button 
            onClick={() => router.push('/gerente')}
            className="flex items-center gap-2 text-gray-500 hover:text-gray-800 transition-colors w-fit"
          >
            <ArrowLeft className="w-4 h-4" />
            Voltar para Gerente
          </button>
          
          <div className="flex items-center justify-between gap-4 bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-2xl bg-[#8CD955] flex items-center justify-center text-white text-2xl font-bold shadow-lg shadow-[#8CD955]/20">
                {avatarInitial}
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-800">{consultor.full_name || 'Consultor sem nome'}</h1>
                <div className="flex items-center gap-3 mt-1">
                  {consultor.created_at && (
                    <span className="text-sm text-gray-500 flex items-center gap-1.5">
                      <Calendar className="w-4 h-4" />
                      No sistema desde {new Date(consultor.created_at).toLocaleDateString('pt-BR')}
                    </span>
                  )}
                  <span className="text-sm text-[#8CD955] bg-[#8CD95515] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider text-[10px]">Consultor</span>
                </div>
              </div>
            </div>
            
            <div className="flex items-center gap-4">
              {/* Filtros */}
              <div className="flex items-center gap-3">
                {/* Filtro de Banca */}
                <div className="relative banca-filter-container">
                  <button
                    onClick={async () => {
                      if (!showBancaFilter && bancas.length === 0) {
                        await loadBancas();
                      }
                      setShowBancaFilter(!showBancaFilter);
                      setShowDatePicker(false);
                      if (!showBancaFilter) {
                        setBancaSearchTerm('');
                      }
                    }}
                    className="flex items-center gap-2 bg-white border border-gray-200 px-4 py-2.5 rounded-xl text-sm font-bold text-gray-700 hover:bg-gray-50 transition-all shadow-sm"
                  >
                    <Filter className="w-4 h-4 text-[#8CD955]" />
                    {selectedBanca 
                      ? bancas.find(b => b.url === selectedBanca)?.name || 'Banca selecionada'
                      : 'Selecione uma Banca'}
                    <ChevronDown className="w-4 h-4" />
                  </button>
                  
                  {showBancaFilter && (
                    <div className="absolute right-0 mt-2 bg-white border border-gray-200 rounded-xl shadow-lg z-50 max-h-[400px] overflow-hidden flex flex-col min-w-[250px]">
                      <div className="p-3 border-b border-gray-100">
                        <div className="relative">
                          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                          <input
                            type="text"
                            placeholder="Pesquisar banca..."
                            value={bancaSearchTerm}
                            onChange={(e) => setBancaSearchTerm(e.target.value)}
                            className="w-full pl-10 pr-3 py-2 bg-gray-50 border-none rounded-lg text-sm text-[#8CD955] font-bold focus:ring-2 focus:ring-[#8CD955]/20 outline-none placeholder:text-gray-400"
                            autoFocus
                          />
                        </div>
                      </div>
                      
                      <div className="overflow-y-auto max-h-[320px] p-2">
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
                                className={`w-full text-left px-4 py-2.5 rounded-lg text-sm transition-colors hover:bg-gray-50 ${
                                  selectedBanca === banca.url ? 'bg-[#8CD95515] text-[#8CD955] font-bold' : 'text-gray-700'
                                }`}
                              >
                                {banca.name}
                              </button>
                            ))
                        ) : (
                          <div className="px-4 py-8 text-center text-sm text-gray-500">
                            Nenhuma banca encontrada
                          </div>
                        )}
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
                              className="w-full bg-[#8CD955] hover:bg-[#7BC84A] disabled:bg-gray-300 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                            >
                              Aplicar
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <button
                onClick={() => {
                  setAccessingCrm(true);
                  router.push(`/crm/kanban?userId=${consultor.id}`);
                }}
                disabled={accessingCrm}
                className="flex items-center gap-2 bg-[#8CD955] hover:bg-[#7BC84A] disabled:bg-[#8CD955]/50 disabled:cursor-wait text-white px-6 py-3 rounded-xl font-medium transition-colors shadow-sm"
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

        {/* Loading */}
        {loading && (
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#8CD955]"></div>
            </div>
          </div>
        )}

        {/* KPIs Externos - Métricas CRM */}
        <div className="bg-gradient-to-br from-[#A8E677] to-[#8CD955] p-6 rounded-2xl shadow-lg border border-[#8CD955]/40">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-6 h-6 text-white" />
              <h2 className="text-xl font-bold text-white">Métricas CRM</h2>
            </div>
          </div>
          
          {externalKpisError && (
            <div className={`${
              externalKpisError === 'NO_DATA' 
                ? 'bg-blue-500/20 backdrop-blur-sm border border-blue-300/50 text-blue-100' 
                : 'bg-red-500/20 backdrop-blur-sm border border-red-300/50 text-red-100'
            } p-4 rounded-xl mb-4`}>
              <div className="flex items-center gap-2">
                {externalKpisError === 'NO_DATA' ? (
                  <>
                    <Users className="w-5 h-5" />
                    <p className="font-medium">Não há dados de clientes para o filtro selecionado. Tente alterar a banca ou o período.</p>
                  </>
                ) : (
                  <>
                    <AlertCircle className="w-5 h-5" />
                    <p className="font-medium">{externalKpisError}</p>
                  </>
                )}
              </div>
            </div>
          )}

          {externalKpis && !externalKpisError ? (
            
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-9 gap-4">
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
                  <p className="text-xs font-bold text-white/90 uppercase">Leads Ativos</p>
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
                  <Trophy className="w-4 h-4 text-white" />
                  <p className="text-xs font-bold text-white/90 uppercase">Clientes Premiados</p>
                </div>
                <p className="text-2xl font-bold text-white">
                  {externalKpis.awarded_clients_count || 0}
                </p>
              </div>
              
              <div className="bg-white/10 backdrop-blur-sm p-4 rounded-xl border border-white/20">
                <div className="flex items-center gap-2 mb-2">
                  <Wallet className="w-4 h-4 text-white" />
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
              
              <div className="bg-white/10 backdrop-blur-sm p-4 rounded-xl border border-white/20">
                <div className="flex items-center gap-2 mb-2">
                  <TrendingUp className="w-4 h-4 text-white" />
                  <p className="text-xs font-bold text-white/90 uppercase">LTV Médio</p>
                </div>
                <p className="text-2xl font-bold text-white">
                  R$ {(externalKpis.ltv_avg || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-white/80">
              <BarChart3 className="w-16 h-16 text-white/50 mb-4" />
              <p className="text-base font-medium">Selecione uma banca e período para visualizar as métricas</p>
            </div>
          )}
        </div>

        {/* Análises e Gráficos */}
        <div className="relative bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
          <h2 className="text-lg font-bold text-gray-800 mb-6 flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-[#8CD955]" />
            Análises e Gráficos
            {chartData?.total_indicateds !== undefined && (
              <span className="text-sm font-normal text-gray-500 ml-2">
                ({chartData.total_indicateds} indicados)
              </span>
            )}
          </h2>
          
          {chartData ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Engajamento - Jogou 1x, 2x, 3x+ */}
              {chartData.engagement_distribution && Object.keys(chartData.engagement_distribution).length > 0 && (
                <div className="bg-gray-50/50 p-4 rounded-xl border border-gray-100">
                  <h3 className="text-sm font-bold text-gray-600 mb-4 flex items-center gap-2">
                    <Target className="w-4 h-4 text-[#8CD955]" />
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
                <div className="bg-gray-50/50 p-4 rounded-xl border border-gray-100">
                  <h3 className="text-sm font-bold text-gray-600 mb-4 flex items-center gap-2">
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
                <div className="bg-gray-50/50 p-4 rounded-xl border border-gray-100">
                  <h3 className="text-sm font-bold text-gray-600 mb-4 flex items-center gap-2">
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
                <div className="bg-gray-50/50 p-4 rounded-xl border border-gray-100">
                  <h3 className="text-sm font-bold text-gray-600 mb-4 flex items-center gap-2">
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
                <div className="bg-gray-50/50 p-4 rounded-xl border border-gray-100">
                  <h3 className="text-sm font-bold text-gray-600 mb-4 flex items-center gap-2">
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
                <div className="bg-gray-50/50 p-4 rounded-xl border border-gray-100">
                  <h3 className="text-sm font-bold text-gray-600 mb-4 flex items-center gap-2">
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
            <div className="flex flex-col items-center justify-center py-12 text-gray-500">
              <BarChart3 className="w-16 h-16 text-gray-300 mb-4" />
              <p className="text-base font-medium">Selecione uma banca e período para visualizar os gráficos</p>
            </div>
          )}
        </div>

      </div>
    </Layout>
  );
}

