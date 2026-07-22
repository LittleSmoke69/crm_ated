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
  XCircle,
  Calendar,
  Eye,
  Briefcase,
  DollarSign,
  AlertCircle,
  Award,
  BarChart3,
  Trophy,
  Loader2,
  Kanban
} from 'lucide-react';
import Layout from '@/components/Layout';
import { useRequireAuth } from '@/utils/useRequireAuth';
import { buildGestorEffectiveHeaders } from '@/lib/utils/gestor-effective-headers';
import { Banner, Button, DateRangeFilter, Skeleton, StatCardSkeleton, CardSkeleton } from '@/components/ui';
import { DatePreset, DateRangeValue, getDateRange } from '@/lib/ui/date-range';

const DATE_PRESETS: DatePreset[] = ['daily', '7days', '15days', '30days', 'custom', 'all'];

interface GerenteDetail {
  gerente: {
    id: string;
    email: string;
    full_name: string | null;
    created_at: string;
  };
  campaigns: any[];
  consultorMetrics: Array<{
    id: string;
    email: string;
    name: string;
    campaignsCount: number;
    processed: number;
    failed: number;
    successRate: string;
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
  }>;
  gerenteTotalKpis?: {
    total_leads: number;
    total_deposited: number;
    total_bets: number;
    total_prizes: number;
    active_leads: number;
    conversion_rate: number;
    net_profit: number;
  };
}

export default function DetalheGerente() {
  const { checking, userId } = useRequireAuth();
  const params = useParams();
  const router = useTenantRouter();
  const gerenteId = params?.gerenteId as string;

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<GerenteDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMetrics, setLoadingMetrics] = useState(false);

  // Estados para Top 5 Consultores
  const [top5Consultants, setTop5Consultants] = useState<Array<{ name: string; value: number; email: string }>>([]);
  const [loadingTop5, setLoadingTop5] = useState(false);

  // Estado para controlar o loading do botão "Acessar CRM" por consultor
  const [accessingCrmConsultorId, setAccessingCrmConsultorId] = useState<string | null>(null);

  // Filtro de data
  const [dateRange, setDateRange] = useState<DateRangeValue>({ preset: 'daily' });

  useEffect(() => {
    if (!userId || !gerenteId) return;
    loadData();
  }, [userId, gerenteId, dateRange]);

  // Carrega Top 5 Consultores quando os dados do gerente mudam
  useEffect(() => {
    if (data?.consultorMetrics && data.consultorMetrics.length > 0) {
      loadTop5Consultants();
    }
  }, [data?.consultorMetrics, dateRange]);

  const loadData = async () => {
    try {
      // Na primeira carga, usa loading geral
      // Em mudanças de data, usa loading específico
      if (!data) {
        setLoading(true);
      } else {
        setLoadingMetrics(true);
      }
      setError(null);

      const range = getDateRange(dateRange);

      let url = `/api/gestor-trafego/gerentes/${gerenteId}`;
      const params = new URLSearchParams();
      if (range?.startDate) params.append('date_from', range.startDate);
      if (range?.endDate) params.append('date_to', range.endDate);
      if (params.toString()) {
        url += `?${params.toString()}`;
      }

      const headers: Record<string, string> = { 'X-User-Id': userId as string };
      const effectiveSelection = typeof window !== 'undefined' ? sessionStorage.getItem('gestor_effective_dono_id') : null;
      if (effectiveSelection) Object.assign(headers, buildGestorEffectiveHeaders(effectiveSelection));

      const response = await fetch(url, { headers });
      const result = await response.json();
      if (result.success) {
        setData(result.data);
      } else {
        setError(result.error || 'Não foi possível carregar os dados do gerente.');
      }
    } catch (error) {
      console.error('Erro ao carregar detalhes:', error);
      setError('Erro ao carregar detalhes. Verifique sua conexão e tente novamente.');
    } finally {
      setLoading(false);
      setLoadingMetrics(false);
    }
  };

  const loadTop5Consultants = async () => {
    if (!data?.consultorMetrics || data.consultorMetrics.length === 0) return;

    try {
      setLoadingTop5(true);
      const range = getDateRange(dateRange);

      // Busca top 5 via API route
      let url = `/api/gestor-trafego/gerentes/${gerenteId}/top5-consultants`;
      const params = new URLSearchParams();
      if (range?.startDate) params.append('date_from', range.startDate);
      if (range?.endDate) params.append('date_to', range.endDate);
      if (params.toString()) {
        url += `?${params.toString()}`;
      }

      const headers: Record<string, string> = { 'X-User-Id': userId as string };
      const effectiveSelection = typeof window !== 'undefined' ? sessionStorage.getItem('gestor_effective_dono_id') : null;
      if (effectiveSelection) Object.assign(headers, buildGestorEffectiveHeaders(effectiveSelection));

      const response = await fetch(url, { headers });

      if (response.ok) {
        const result = await response.json();
        if (result.success && result.data) {
          setTop5Consultants(result.data);
        }
      }
    } catch (error) {
      console.error('[Top5] Erro ao carregar top 5 consultores:', error);
    } finally {
      setLoadingTop5(false);
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
        <div className="w-full min-w-0 px-4 sm:px-6 lg:px-8 py-4 sm:py-6 space-y-6">
          <button
            onClick={() => router.back()}
            className="flex items-center gap-2 text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-white transition-colors w-fit"
          >
            <ArrowLeft className="w-4 h-4" />
            Voltar para lista
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
        <div className="w-full min-w-0 px-4 sm:px-6 lg:px-8 py-4 sm:py-6 space-y-6">
          <Skeleton className="h-5 w-32" />
          <CardSkeleton />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCardSkeleton />
                <StatCardSkeleton />
                <StatCardSkeleton />
                <StatCardSkeleton />
              </div>
              <CardSkeleton />
              <CardSkeleton />
            </div>
            <div className="space-y-6">
              <CardSkeleton />
              <CardSkeleton />
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  const { gerente, campaigns, consultorMetrics, gerenteTotalKpis } = data;

  return (
    <Layout onSignOut={handleSignOut}>
      <div className="w-full min-w-0 px-4 sm:px-6 lg:px-8 py-4 sm:py-6 space-y-6">
        {/* Breadcrumb & Header */}
        <div className="flex flex-col gap-4">
          <button
            onClick={() => router.back()}
            className="flex items-center gap-2 text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-white transition-colors w-fit"
          >
            <ArrowLeft className="w-4 h-4" />
            Voltar para lista
          </button>

          <div className="flex flex-col sm:flex-row sm:items-center gap-4 bg-white dark:bg-[#2a2a2a] p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-600">
            <div className="w-16 h-16 rounded-2xl bg-emerald-600 flex items-center justify-center text-white text-2xl font-bold shadow-lg shadow-emerald-100 dark:shadow-none">
              {(gerente.full_name || gerente.email)[0].toUpperCase()}
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-800 dark:text-white">{gerente.full_name || 'Gerente sem nome'}</h1>
              <div className="flex items-center gap-3 mt-1">
                <span className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
                  <Calendar className="w-4 h-4" />
                  Desde {new Date(gerente.created_at).toLocaleDateString('pt-BR')}
                </span>
                <span className="text-sm text-emerald-600 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/20 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider text-[10px]">Gerente</span>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column: Metrics & Consultors */}
          <div className="lg:col-span-2 space-y-6">
            {/* Resumo Geral do Gerente */}
            {gerenteTotalKpis && (
              <div className="relative bg-gradient-to-br from-emerald-500 to-emerald-600 dark:from-emerald-800 dark:to-emerald-900 p-6 rounded-2xl shadow-lg border border-emerald-400 dark:border-emerald-700">
                {loadingMetrics && (
                  <div className="absolute inset-0 bg-white/80 dark:bg-[#2a2a2a]/80 backdrop-blur-sm rounded-2xl z-10 flex items-center justify-center">
                    <Loader2 className="w-6 h-6 text-emerald-600 dark:text-emerald-400 animate-spin" />
                  </div>
                )}
                <div className="flex items-center gap-2 mb-6">
                  <Briefcase className="w-6 h-6 text-white" />
                  <h2 className="text-xl font-bold text-white">Resumo Geral - {gerente.full_name || 'Gerente'}</h2>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-white/10 backdrop-blur-sm p-4 rounded-xl border border-white/20">
                    <div className="flex items-center gap-2 mb-2">
                      <Users className="w-4 h-4 text-white" />
                      <p className="text-xs font-bold text-white/90 uppercase">Total de Leads</p>
                    </div>
                    <p className="text-2xl font-bold text-white">{gerenteTotalKpis.total_leads || 0}</p>
                  </div>

                  <div className="bg-white/10 backdrop-blur-sm p-4 rounded-xl border border-white/20">
                    <div className="flex items-center gap-2 mb-2">
                      <CheckCircle2 className="w-4 h-4 text-white" />
                      <p className="text-xs font-bold text-white/90 uppercase">Clientes Ativos</p>
                    </div>
                    <p className="text-2xl font-bold text-white">{gerenteTotalKpis.active_leads || 0}</p>
                  </div>

                  <div className="bg-white/10 backdrop-blur-sm p-4 rounded-xl border border-white/20">
                    <div className="flex items-center gap-2 mb-2">
                      <DollarSign className="w-4 h-4 text-white" />
                      <p className="text-xs font-bold text-white/90 uppercase">Total Depositado</p>
                    </div>
                    <p className="text-2xl font-bold text-white">
                      R$ {(gerenteTotalKpis.total_deposited || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                    </p>
                  </div>

                  <div className="bg-white/10 backdrop-blur-sm p-4 rounded-xl border border-white/20">
                    <div className="flex items-center gap-2 mb-2">
                      <Target className="w-4 h-4 text-white" />
                      <p className="text-xs font-bold text-white/90 uppercase">Total Apostado</p>
                    </div>
                    <p className="text-2xl font-bold text-white">
                      R$ {(gerenteTotalKpis.total_bets || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                    </p>
                  </div>

                  <div className="bg-white/10 backdrop-blur-sm p-4 rounded-xl border border-white/20">
                    <div className="flex items-center gap-2 mb-2">
                      <Award className="w-4 h-4 text-white" />
                      <p className="text-xs font-bold text-white/90 uppercase">Total Prêmios</p>
                    </div>
                    <p className="text-2xl font-bold text-white">
                      R$ {(gerenteTotalKpis.total_prizes || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                    </p>
                  </div>

                  <div className="bg-white/10 backdrop-blur-sm p-4 rounded-xl border border-white/20">
                    <div className="flex items-center gap-2 mb-2">
                      <TrendingUp className="w-4 h-4 text-white" />
                      <p className="text-xs font-bold text-white/90 uppercase">Lucro Líquido</p>
                    </div>
                    <p className="text-2xl font-bold text-white">
                      R$ {(gerenteTotalKpis.net_profit || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                    </p>
                  </div>

                  <div className="bg-white/10 backdrop-blur-sm p-4 rounded-xl border border-white/20">
                    <div className="flex items-center gap-2 mb-2">
                      <BarChart3 className="w-4 h-4 text-white" />
                      <p className="text-xs font-bold text-white/90 uppercase">Taxa de Conversão</p>
                    </div>
                    <p className="text-2xl font-bold text-white">
                      {(gerenteTotalKpis.conversion_rate || 0).toFixed(2)}%
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Consultors Grid */}
            <div className="relative bg-white dark:bg-[#2a2a2a] p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-600">
              {loadingMetrics && (
                <div className="absolute inset-0 bg-white/80 dark:bg-[#2a2a2a]/80 backdrop-blur-sm rounded-2xl z-10 flex items-center justify-center">
                  <Loader2 className="w-6 h-6 text-emerald-600 dark:text-emerald-400 animate-spin" />
                </div>
              )}
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                <h2 className="text-lg font-bold text-gray-800 dark:text-white flex items-center gap-2">
                  <Users className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                  Consultores da Equipe
                </h2>

                {/* Filtro de Data */}
                <DateRangeFilter
                  value={dateRange}
                  onChange={setDateRange}
                  presets={DATE_PRESETS}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {consultorMetrics.map(consultor => (
                  <div key={consultor.id} className="p-4 rounded-xl border border-gray-100 dark:border-gray-600 hover:border-emerald-200 dark:hover:border-emerald-700 transition-all bg-gray-50/30 dark:bg-[#333]/30">
                    <div className="flex items-center justify-between mb-4">
                      <p className="font-bold text-gray-800 dark:text-white truncate pr-2">{consultor.name}</p>
                    </div>

                    {/* KPIs Externos */}
                    {consultor.externalKpisError && (
                      <div className="mb-4 p-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-lg">
                        <div className="flex items-center gap-2 text-red-700 dark:text-red-300">
                          <AlertCircle className="w-4 h-4" />
                          <p className="text-xs font-medium">{consultor.externalKpisError}</p>
                        </div>
                      </div>
                    )}

                    {consultor.externalKpis && !consultor.externalKpisError && (
                      <div className="mb-4 p-3 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 rounded-lg space-y-2">
                        {/* Total de Leads */}
                        {consultor.externalKpis.total_leads !== undefined && (
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Users className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                              <p className="text-xs font-bold text-gray-600 dark:text-gray-300 uppercase">Total de Leads</p>
                            </div>
                            <p className="text-sm font-bold text-emerald-700 dark:text-emerald-300">
                              {consultor.externalKpis.total_leads || 0}
                            </p>
                          </div>
                        )}

                        {/* Clientes Ativos */}
                        {consultor.externalKpis.active_leads !== undefined && (
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                              <p className="text-xs font-bold text-gray-600 dark:text-gray-300 uppercase">Clientes Ativos</p>
                            </div>
                            <p className="text-sm font-bold text-emerald-700 dark:text-emerald-300">
                              {consultor.externalKpis.active_leads || 0}
                            </p>
                          </div>
                        )}

                        {/* Total Depositado */}
                        {consultor.externalKpis.total_deposited !== undefined && (
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <DollarSign className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                              <p className="text-xs font-bold text-gray-600 dark:text-gray-300 uppercase">Total Depositado</p>
                            </div>
                            <p className="text-sm font-bold text-emerald-700 dark:text-emerald-300">
                              R$ {(consultor.externalKpis.total_deposited || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </p>
                          </div>
                        )}

                        {/* Total Apostado */}
                        {consultor.externalKpis.total_bets !== undefined && (
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Target className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                              <p className="text-xs font-bold text-gray-600 dark:text-gray-300 uppercase">Total Apostado</p>
                            </div>
                            <p className="text-sm font-bold text-emerald-700 dark:text-emerald-300">
                              R$ {(consultor.externalKpis.total_bets || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </p>
                          </div>
                        )}

                        {/* Total Prêmios */}
                        {consultor.externalKpis.total_prizes !== undefined && (
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Award className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                              <p className="text-xs font-bold text-gray-600 dark:text-gray-300 uppercase">Total Prêmios</p>
                            </div>
                            <p className="text-sm font-bold text-emerald-700 dark:text-emerald-300">
                              R$ {(consultor.externalKpis.total_prizes || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </p>
                          </div>
                        )}

                        {/* Lucro Líquido */}
                        {consultor.externalKpis.net_profit !== undefined && (
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <TrendingUp className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                              <p className="text-xs font-bold text-gray-600 dark:text-gray-300 uppercase">Lucro Líquido</p>
                            </div>
                            <p className="text-sm font-bold text-emerald-700 dark:text-emerald-300">
                              R$ {(consultor.externalKpis.net_profit || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </p>
                          </div>
                        )}

                        {/* Taxa de Conversão */}
                        {consultor.externalKpis.conversion_rate !== undefined && (
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <BarChart3 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                              <p className="text-xs font-bold text-gray-600 dark:text-gray-300 uppercase">Taxa de Conversão</p>
                            </div>
                            <p className="text-sm font-bold text-emerald-700 dark:text-emerald-300">
                              {(consultor.externalKpis.conversion_rate || 0).toFixed(2)}%
                            </p>
                          </div>
                        )}
                      </div>
                    )}

                    <button
                      onClick={() => router.push(`/gestor-trafego/consultores/${consultor.id}`)}
                      className="w-full mt-4 py-2 bg-white dark:bg-[#2a2a2a] border border-gray-100 dark:border-gray-600 rounded-lg text-xs font-bold text-gray-500 dark:text-gray-400 hover:bg-emerald-600 hover:text-white hover:border-emerald-600 transition-all flex items-center justify-center gap-2"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      Métricas Detalhadas
                    </button>
                    <button
                      onClick={() => {
                        setAccessingCrmConsultorId(consultor.id);
                        router.push(`/crm/kanban?userId=${consultor.id}`);
                      }}
                      disabled={accessingCrmConsultorId === consultor.id}
                      className="w-full mt-2 py-2 bg-white dark:bg-[#2a2a2a] border border-gray-100 dark:border-gray-600 rounded-lg text-xs font-bold text-gray-500 dark:text-gray-400 hover:bg-purple-600 hover:text-white hover:border-purple-600 transition-all flex items-center justify-center gap-2 disabled:opacity-75 disabled:cursor-wait"
                    >
                      {accessingCrmConsultorId === consultor.id ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          Acessando...
                        </>
                      ) : (
                        <>
                          <Kanban className="w-3.5 h-3.5" />
                          Acessar CRM
                        </>
                      )}
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Campaigns Table */}
            <div className="bg-white dark:bg-[#2a2a2a] rounded-2xl shadow-sm border border-gray-100 dark:border-gray-600 overflow-hidden">
              <div className="p-6 border-b border-gray-100 dark:border-gray-600">
                <h2 className="text-lg font-bold text-gray-800 dark:text-white flex items-center gap-2">
                  <Target className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  Campanhas Iniciadas na Estrutura
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-gray-50/50 dark:bg-[#333]/50">
                      <th className="px-6 py-4 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase">Data</th>
                      <th className="px-6 py-4 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase">Grupo</th>
                      <th className="px-6 py-4 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase text-center">Status</th>
                      <th className="px-6 py-4 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase text-center">Progresso</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {campaigns.length === 0 ? (
                      <tr><td colSpan={4} className="px-6 py-10 text-center text-gray-500 dark:text-gray-400">Nenhuma campanha encontrada</td></tr>
                    ) : (
                      campaigns.map(camp => (
                        <tr key={camp.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                          <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300">
                            {new Date(camp.created_at).toLocaleDateString('pt-BR')}
                          </td>
                          <td className="px-6 py-4">
                            <p className="text-sm font-bold text-gray-800 dark:text-white">{camp.group_subject || 'Grupo Indefinido'}</p>
                            <p className="text-[10px] text-gray-400 dark:text-gray-500 truncate w-32">{camp.group_id}</p>
                          </td>
                          <td className="px-6 py-4 text-center">
                            <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase ${
                              camp.status === 'running' ? 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300' :
                              camp.status === 'completed' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300' :
                              'bg-gray-100 text-gray-700 dark:bg-gray-600 dark:text-gray-200'
                            }`}>
                              {camp.status}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex flex-col items-center">
                              <span className="text-xs font-bold text-gray-700 dark:text-gray-200 mb-1">
                                {camp.processed_contacts}/{camp.total_contacts}
                              </span>
                              <div className="w-full h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-blue-500"
                                  style={{ width: `${(camp.processed_contacts / (camp.total_contacts || 1)) * 100}%` }}
                                ></div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Right Column: Global Stats for this structure */}
          <div className="space-y-6">
            <div className="bg-emerald-600 dark:bg-emerald-800 text-white p-6 rounded-2xl shadow-lg shadow-emerald-100 dark:shadow-none">
              <h3 className="text-sm font-bold text-white/80 uppercase tracking-widest mb-4">Total da Estrutura</h3>
              <div className="space-y-6">
                <div>
                  <p className="text-3xl font-bold">{campaigns.length}</p>
                  <p className="text-xs text-white/60 font-medium">Campanhas Iniciadas</p>
                </div>
                <div>
                  <p className="text-3xl font-bold">
                    {campaigns.reduce((acc, c) => acc + (c.processed_contacts || 0), 0)}
                  </p>
                  <p className="text-xs text-white/60 font-medium">Contatos Processados</p>
                </div>
                <div>
                  <p className="text-3xl font-bold">
                    {(campaigns.reduce((acc, c) => acc + (c.processed_contacts || 0), 0) / (campaigns.reduce((acc, c) => acc + (c.total_contacts || 0), 0) || 1) * 100).toFixed(1)}%
                  </p>
                  <p className="text-xs text-white/60 font-medium">Eficiência de Entrega</p>
                </div>
              </div>
            </div>

            <div className="bg-white dark:bg-[#2a2a2a] p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-600">
              <h3 className="text-sm font-bold text-gray-800 dark:text-white uppercase tracking-widest mb-4 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-500 dark:text-emerald-400" />
                Resumo de Saúde
              </h3>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500 dark:text-gray-400">Campanhas OK</span>
                  <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">{campaigns.filter(c => c.status === 'completed').length}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500 dark:text-gray-400">Falhas Totais</span>
                  <span className="text-sm font-bold text-red-600 dark:text-red-400">{campaigns.reduce((acc, c) => acc + (c.failed_contacts || 0), 0)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500 dark:text-gray-400">Média Leads/Consultor</span>
                  <span className="text-sm font-bold text-gray-800 dark:text-white">
                    {(campaigns.reduce((acc, c) => acc + (c.total_contacts || 0), 0) / (consultorMetrics.length || 1)).toFixed(0)}
                  </span>
                </div>
              </div>
            </div>

            {/* Top 5 Consultores por Vendas */}
            <div className="relative bg-white dark:bg-[#2a2a2a] p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-600">
              {loadingTop5 && (
                <div className="absolute inset-0 bg-white/80 dark:bg-[#2a2a2a]/80 backdrop-blur-sm rounded-2xl z-10 flex items-center justify-center">
                  <Loader2 className="w-6 h-6 text-emerald-600 dark:text-emerald-400 animate-spin" />
                </div>
              )}
              <h3 className="text-sm font-bold text-gray-800 dark:text-white uppercase tracking-widest mb-4 flex items-center gap-2">
                <Trophy className="w-4 h-4 text-amber-500" />
                Top 5 Consultores por Vendas
              </h3>

              {top5Consultants && top5Consultants.length > 0 ? (
                <div className="space-y-3">
                  {top5Consultants.map((consultant, index) => {
                    const position = index + 1;
                    const getRankStyle = () => {
                      switch (position) {
                        case 1:
                          return {
                            rankBg: 'bg-gradient-to-br from-amber-400 to-amber-600',
                            rankText: 'text-white',
                            cardBg: 'bg-gradient-to-br from-amber-50 to-amber-100/50 dark:from-amber-500/15 dark:to-amber-500/5',
                            cardBorder: 'border-amber-200 dark:border-amber-500/30',
                            medal: '🥇',
                            shadow: 'shadow-md shadow-amber-200/50 dark:shadow-none'
                          };
                        case 2:
                          return {
                            rankBg: 'bg-gradient-to-br from-gray-300 to-gray-500',
                            rankText: 'text-white',
                            cardBg: 'bg-gradient-to-br from-gray-50 to-gray-100/50 dark:from-gray-500/15 dark:to-gray-500/5',
                            cardBorder: 'border-gray-200 dark:border-gray-600',
                            medal: '🥈',
                            shadow: 'shadow-sm shadow-gray-200/50 dark:shadow-none'
                          };
                        case 3:
                          return {
                            rankBg: 'bg-gradient-to-br from-orange-300 to-orange-500',
                            rankText: 'text-white',
                            cardBg: 'bg-gradient-to-br from-orange-50 to-orange-100/50 dark:from-orange-500/15 dark:to-orange-500/5',
                            cardBorder: 'border-orange-200 dark:border-orange-500/30',
                            medal: '🥉',
                            shadow: 'shadow-sm shadow-orange-200/50 dark:shadow-none'
                          };
                        default:
                          return {
                            rankBg: 'bg-gradient-to-br from-blue-400 to-blue-600',
                            rankText: 'text-white',
                            cardBg: 'bg-gradient-to-br from-blue-50 to-blue-100/50 dark:from-blue-500/15 dark:to-blue-500/5',
                            cardBorder: 'border-blue-200 dark:border-blue-500/30',
                            medal: null,
                            shadow: ''
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
                        key={consultant.email}
                        className={`relative ${style.cardBg} ${style.cardBorder} border-2 rounded-lg p-3 transition-all hover:scale-[1.02] ${style.shadow}`}
                      >
                        <div className="flex items-center gap-3">
                          {/* Posição/Ranking */}
                          <div className={`${style.rankBg} ${style.rankText} w-10 h-10 rounded-lg flex items-center justify-center font-bold text-sm shrink-0 shadow-md`}>
                            {style.medal ? (
                              <span className="text-lg">{style.medal}</span>
                            ) : (
                              <span>#{position}</span>
                            )}
                          </div>

                          {/* Avatar */}
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-xs text-white shadow-md ${
                            position === 1 ? 'bg-gradient-to-br from-amber-500 to-amber-700' :
                            position === 2 ? 'bg-gradient-to-br from-gray-400 to-gray-600' :
                            position === 3 ? 'bg-gradient-to-br from-orange-400 to-orange-600' :
                            'bg-gradient-to-br from-blue-500 to-blue-700'
                          }`}>
                            {initials}
                          </div>

                          {/* Nome e Valor */}
                          <div className="flex-1 min-w-0">
                            <h4 className="font-bold text-gray-800 dark:text-white text-sm truncate">
                              {consultant.name}
                            </h4>
                            <div className="mt-0.5">
                              <span className="text-base font-extrabold text-emerald-600 dark:text-emerald-400">
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
                            <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-white/80 dark:bg-[#2a2a2a]/80 backdrop-blur-sm border border-white/50 dark:border-gray-600">
                              <Trophy className={`w-3 h-3 ${
                                position === 1 ? 'text-amber-500' :
                                position === 2 ? 'text-gray-500 dark:text-gray-400' :
                                'text-orange-500'
                              }`} />
                              <span className="text-[10px] font-bold text-gray-700 dark:text-gray-200">
                                {position === 1 ? 'Campeão' : position === 2 ? 'Vice' : '3º'}
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Barra de Progresso Visual (comparado com o 1º lugar) */}
                        {position > 1 && top5Consultants[0] && (
                          <div className="mt-2 pt-2 border-t border-white/50 dark:border-gray-600">
                            <div className="flex items-center justify-between text-[10px] text-gray-600 dark:text-gray-300 mb-1">
                              <span>Progresso</span>
                              <span className="font-bold">
                                {((consultant.value / top5Consultants[0].value) * 100).toFixed(0)}%
                              </span>
                            </div>
                            <div className="w-full bg-white/60 dark:bg-gray-700 rounded-full h-1.5 overflow-hidden">
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
                <div className="flex flex-col items-center justify-center py-8 text-gray-500 dark:text-gray-400">
                  <Trophy className="w-12 h-12 text-gray-300 dark:text-gray-600 mb-3" />
                  <p className="text-sm font-medium">Nenhum consultor com vendas no período</p>
                </div>
              )}
            </div>
          </div>
        </div>

      </div>
    </Layout>
  );
}
