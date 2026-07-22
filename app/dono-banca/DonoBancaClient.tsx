'use client';

import React, { useState, useEffect, useRef } from 'react';
import { withTenantSlug } from '@/lib/utils/tenant-href';
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
  Download,
  ExternalLink,
  Megaphone
} from 'lucide-react';
import Layout from '@/components/Layout';
import BancaAnalysisGrid from '@/components/Banca/BancaAnalysisGrid';
import { useRequireAuth } from '@/utils/useRequireAuth';
import FinancialMetricsBarChart from '@/components/Charts/FinancialMetricsBarChart';
import LeadsDistributionChart from '@/components/Charts/LeadsDistributionChart';
import ExportCsvModal from '@/components/dono-banca/ExportCsvModal';

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

/** Métricas recorrentes da banca (todas as recargas/transações no período) — extract-totals. */
interface ExtractTotals {
  recarga_pix: number;
  recarga_manual: number;
  total_recargas: number;
  total_bonus: number;
  bonus_afiliado: number;
  bonus_estrelas: number;
  apostas_loterias: number;
  apostas_jogo_do_bicho: number;
  premios_loterias: number;
  premios_jb: number;
  venda_combo_total: number;
  venda_bolao_total: number;
  solicitacao_saque: number;
  total_saque_disponivel: number;
  total_balance: number;
  total_transacts: number;
}

/** Jogador do cohort-real-players (LTV recorrente). */
interface CohortPlayer {
  id: number;
  name: string | null;
  email: string | null;
  phone: string | null;
  registered_at: string | null;
  consultant_id: number | null;
  consultant_name: string | null;
  consultant_email: string | null;
  deposited_in_window: number;
  deposits_count_in_window: number;
  ltv_in_window: number;
  ltv_count_in_window: number;
  deposit_bucket: string | null;
  last_deposit_at: string | null;
  last_deposit_value: number | null;
}

interface CohortTotals {
  cohort_size: number;
  total_deposited_in_window: number;
  total_deposits_count_in_window: number;
  players_that_deposited: number;
  total_ltv_in_window: number;
  players_with_ltv: number;
  ltv_avg: number;
  deposit_buckets: { dep_1x: number; dep_2x: number; dep_3x: number; dep_4x_plus: number };
}

/** Agregado de LTV recorrente por consultor. */
interface CohortConsultantAgg {
  consultant_email: string;
  consultant_name: string;
  ltv: number;
  deposited: number;
  deposits_count: number;
  players: number;
  players_that_deposited: number;
}

function fmtBRL2(v: number | null | undefined): string {
  return `R$ ${(Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

/** Card de uma métrica com botão "!" que abre uma explicação simples. */
function MetricInfoCard({
  label,
  value,
  explanation,
  tone = 'emerald',
}: {
  label: string;
  value: string;
  explanation: string;
  tone?: 'emerald' | 'gray';
}) {
  const [open, setOpen] = useState(false);
  const bg = tone === 'emerald' ? 'bg-emerald-50 dark:bg-emerald-900/20' : 'bg-gray-50 dark:bg-gray-800/60';
  const labelColor = tone === 'emerald' ? 'text-emerald-700 dark:text-emerald-400' : 'text-gray-500 dark:text-gray-400';
  return (
    <div className={`relative rounded-xl ${bg} px-3 py-2`}>
      <div className="flex items-start justify-between gap-1">
        <p className={`text-[10px] uppercase tracking-wide font-bold ${labelColor}`}>{label}</p>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="shrink-0 w-4 h-4 rounded-full bg-white/80 dark:bg-gray-700 border border-gray-300 dark:border-gray-500 text-[10px] font-bold text-gray-600 dark:text-gray-200 flex items-center justify-center leading-none hover:bg-white dark:hover:bg-gray-600"
          title="O que é isso?"
          aria-label={`O que é ${label}?`}
        >
          !
        </button>
      </div>
      <p className="text-lg font-bold text-gray-900 dark:text-gray-100 tabular-nums">{value}</p>
      {open && (
        <div className="mt-1.5 text-[11px] leading-snug text-gray-600 dark:text-gray-200 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-2 shadow-sm">
          {explanation}
        </div>
      )}
    </div>
  );
}

/** Card de LTV recorrente por consultor + botão para ver clientes. */
function CohortLtvCard({
  consultants,
  totals,
  loading,
  error,
  hasBanca,
  onViewClients,
}: {
  consultants: CohortConsultantAgg[];
  totals: CohortTotals | null;
  loading: boolean;
  error: string | null;
  hasBanca: boolean;
  onViewClients: (consultantEmail: string) => void;
}) {
  if (!hasBanca) return null;
  return (
    <div className="bg-white dark:bg-[#2a2a2a] p-4 sm:p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
          LTV Recorrente por Consultor
        </h2>
        {loading ? <Loader2 className="w-5 h-5 animate-spin text-emerald-500" /> : null}
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
        LTV gerado e depósitos dos jogadores adquiridos no período (cohort de jogadores reais).
      </p>

      {!loading && totals ? (
        <>
          {/* Resumo da safra — um card por campo, com botão "!" de explicação */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-4">
            <MetricInfoCard
              label="Jogadores da safra"
              value={String(totals.cohort_size)}
              explanation="Quantos jogadores reais entraram no período. É a base usada para calcular o LTV médio."
            />
            <MetricInfoCard
              label="LTV médio por jogador"
              value={fmtBRL2(totals.ltv_avg)}
              explanation="Em média, quanto cada jogador da safra gerou de recorrência. É o LTV total dividido pelo número de jogadores."
            />
            <MetricInfoCard
              label="LTV (recorrência)"
              value={fmtBRL2(totals.total_ltv_in_window)}
              explanation="Quanto os jogadores depositaram ALÉM do primeiro depósito. Mostra o quanto eles voltam a depositar."
            />
            <MetricInfoCard
              label="Geraram recorrência"
              value={String(totals.players_with_ltv)}
              explanation="Quantos jogadores depositaram mais de uma vez, ou seja, voltaram a depositar."
            />
            <MetricInfoCard
              label="Total depositado"
              value={fmtBRL2(totals.total_deposited_in_window)}
              explanation="Soma de TODOS os depósitos no período, incluindo o primeiro depósito de cada jogador."
            />
            <MetricInfoCard
              label="Nº de depósitos"
              value={String(totals.total_deposits_count_in_window)}
              explanation="Quantidade total de depósitos feitos no período (contando todos os depósitos)."
            />
            <MetricInfoCard
              label="Depositaram ao menos 1x"
              value={String(totals.players_that_deposited)}
              explanation="Quantos jogadores fizeram pelo menos um depósito no período."
            />
          </div>

          {/* Distribuição de depósitos (cumulativa) — um card por faixa */}
          <div className="rounded-xl border border-gray-100 dark:border-gray-700 p-3 mb-4">
            <p className="text-xs font-bold text-gray-700 dark:text-gray-200 mb-2">Quantos depositaram N vezes ou mais</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <MetricInfoCard
                tone="gray"
                label="Depositaram 1x ou +"
                value={String(totals.deposit_buckets.dep_1x)}
                explanation="Jogadores que depositaram pelo menos 1 vez no período."
              />
              <MetricInfoCard
                tone="gray"
                label="Depositaram 2x ou +"
                value={String(totals.deposit_buckets.dep_2x)}
                explanation="Jogadores que depositaram 2 vezes ou mais. Já estão contados também na faixa de 1x ou +."
              />
              <MetricInfoCard
                tone="gray"
                label="Depositaram 3x ou +"
                value={String(totals.deposit_buckets.dep_3x)}
                explanation="Jogadores que depositaram 3 vezes ou mais. Já estão contados nas faixas de 1x e 2x ou +."
              />
              <MetricInfoCard
                tone="gray"
                label="Depositaram 4x ou +"
                value={String(totals.deposit_buckets.dep_4x_plus)}
                explanation="Jogadores que depositaram 4 vezes ou mais. Já estão contados nas faixas anteriores."
              />
            </div>
            <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-2">
              Faixas cumulativas (cada uma inclui as seguintes): 1x ou + ≥ 2x ou + ≥ 3x ou + ≥ 4x ou +.
            </p>
          </div>
        </>
      ) : null}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 py-10 justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-emerald-500" /> Carregando LTV por consultor…
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400 py-3">
          <AlertCircle className="w-4 h-4 shrink-0" /> {error}
        </div>
      ) : consultants.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400 py-6 text-center">Nenhum jogador no período.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 dark:text-gray-400 uppercase border-b border-gray-100 dark:border-gray-700">
                <th className="px-3 py-2 font-bold">Consultor</th>
                <th className="px-3 py-2 font-bold text-right">LTV Gerado</th>
                <th className="px-3 py-2 font-bold text-right">Total Depositado</th>
                <th className="px-3 py-2 font-bold text-right">Depósitos</th>
                <th className="px-3 py-2 font-bold text-right">Jogadores</th>
                <th className="px-3 py-2 font-bold text-center">Ações</th>
              </tr>
            </thead>
            <tbody>
              {consultants.map((c) => (
                <tr key={c.consultant_email || c.consultant_name} className="border-b border-gray-50 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/40">
                  <td className="px-3 py-2.5 text-gray-800 dark:text-gray-100 font-medium">{c.consultant_name}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-emerald-700 dark:text-emerald-400">{fmtBRL2(c.ltv)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-gray-800 dark:text-gray-100">{fmtBRL2(c.deposited)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-gray-600 dark:text-gray-300">{c.deposits_count}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-gray-600 dark:text-gray-300">{c.players_that_deposited}/{c.players}</td>
                  <td className="px-3 py-2.5 text-center">
                    <button
                      onClick={() => onViewClients(c.consultant_email || c.consultant_name)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-emerald-600 hover:bg-emerald-700 text-white"
                    >
                      <Users className="w-3.5 h-3.5" /> Ver clientes
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
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
  const normalizedUserStatus = String(serverUserStatus ?? '').trim().toLowerCase();
  const canShowGestorTrafegoButton =
    isAdminOrSuperAdmin ||
    normalizedUserStatus === 'admin' ||
    normalizedUserStatus === 'super_admin';
  
  const [loading, setLoading] = useState(false);
  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(
    authError ? false : !canAccessDonoBanca ? false : (initialData && !showBancaSelector ? true : null)
  );
  const [gerentes, setGerentes] = useState<Gerente[]>(initialData?.gerentes || []);
  const [externalMetrics, setExternalMetrics] = useState<ExternalMetrics | null>(initialData?.externalMetrics || null);
  const [extractTotals, setExtractTotals] = useState<ExtractTotals | null>((initialData as { extractTotals?: ExtractTotals } | undefined)?.extractTotals || null);
  const [externalMetricsError, setExternalMetricsError] = useState<string | null>(initialData?.externalMetricsError || null);
  // LTV recorrente por consultor (cohort-real-players)
  const [cohortData, setCohortData] = useState<CohortPlayer[]>([]);
  const [cohortTotals, setCohortTotals] = useState<CohortTotals | null>(null);
  const [cohortLoading, setCohortLoading] = useState(false);
  const [cohortError, setCohortError] = useState<string | null>(null);
  const [cohortModalConsultor, setCohortModalConsultor] = useState<string | null>(null);
  const [bancaName, setBancaName] = useState<string | null>(initialData?.bancaInfo?.name || null);
  const [bancaId, setBancaId] = useState<string | null>(initialData?.bancaId || null);
  const [hasConsultoresComCampanha, setHasConsultoresComCampanha] = useState(false);
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

  const dashboardFetchGen = useDashboardFetchGeneration();
  const fetchAbortRef = useRef<AbortController | null>(null);
  const lastLoadedBancaRef = useRef<string | null>(null);

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
          // Não auto-seleciona: aguarda o usuário escolher a banca antes de puxar resultados.
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

  useEffect(() => {
    return () => {
      fetchAbortRef.current?.abort();
    };
  }, []);

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

  // O cohort (LTV recorrente por consultor) é buscado dentro de checkAuthorization,
  // com prioridade na fila do CRM (ver loadCohort).

  // Agrega o cohort por consultor (LTV gerado, total depositado, nº de jogadores).
  const cohortByConsultant: CohortConsultantAgg[] = React.useMemo(() => {
    const map = new Map<string, CohortConsultantAgg>();
    for (const p of cohortData) {
      const key = (p.consultant_email || p.consultant_name || `id:${p.consultant_id ?? '—'}`).toLowerCase();
      const cur = map.get(key) || {
        consultant_email: p.consultant_email || '',
        consultant_name: p.consultant_name || p.consultant_email || 'Consultor',
        ltv: 0,
        deposited: 0,
        deposits_count: 0,
        players: 0,
        players_that_deposited: 0,
      };
      cur.ltv += Number(p.ltv_in_window) || 0;
      cur.deposited += Number(p.deposited_in_window) || 0;
      cur.deposits_count += Number(p.deposits_count_in_window) || 0;
      cur.players += 1;
      if ((Number(p.deposited_in_window) || 0) > 0) cur.players_that_deposited += 1;
      map.set(key, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.ltv - a.ltv || b.deposited - a.deposited);
  }, [cohortData]);

  /** Lotes de gerentes por request — equilíbrio entre round-trips e timeout do edge. */
  const BATCH_SIZE = 8;

  const parseDashboardResponse = async (response: Response) => {
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
      return { ok: false as const, result: null, parseError: rawText.slice(0, 160) };
    }
    return { ok: response.ok && Boolean(result.success), result };
  };

  const checkAuthorization = async () => {
    if (!userId) return;

    fetchAbortRef.current?.abort();
    const abortController = new AbortController();
    fetchAbortRef.current = abortController;
    const signal = abortController.signal;

    const requestId = dashboardFetchGen.next();
    const bancaKey = showBancaSelector ? selectedBancaId : 'own';
    const bancaChanged = lastLoadedBancaRef.current !== null && lastLoadedBancaRef.current !== bancaKey;

    const { dateFrom, dateTo } = getDateRange();
    /** Congela filtros no início — evita misturar banca/período se o estado mudar durante o loop. */
    const bancaIdAtRequest = showBancaSelector ? selectedBancaId : null;
    const headers = { 'X-User-Id': userId as string };

    const buildRequestUrl = (
      opts: { offset?: number; limit?: number; onlyExternalMetrics?: boolean; skipExternalMetrics?: boolean } = {}
    ) => {
      const params = new URLSearchParams();
      if (dateFrom) params.append('date_from', dateFrom);
      if (dateTo) params.append('date_to', dateTo);
      if (bancaIdAtRequest) params.append('banca_id', bancaIdAtRequest);
      if (opts.onlyExternalMetrics) {
        params.set('only_external_metrics', '1');
      } else {
        params.set('limit', String(opts.limit ?? BATCH_SIZE));
        params.set('offset', String(opts.offset ?? 0));
        if (opts.skipExternalMetrics) params.set('skip_external_metrics', '1');
      }
      return `/api/dono-banca/dashboard?${params.toString()}`;
    };

    setLoadingMetrics(true);
    setExternalMetricsError(null);
    setGerentes([]);
    setTop5Consultants([]);
    setHasConsultoresComCampanha(false);
    if (bancaChanged || lastLoadedBancaRef.current === null) {
      setExternalMetrics(null);
      setExtractTotals(null);
      setCohortData([]);
      setCohortTotals(null);
      setBancaName(null);
      setBancaId(null);
    }

    const rankByEmail = new Map<string, { name: string; value: number }>();

    const loadExternalMetrics = async () => {
      try {
        const response = await fetch(buildRequestUrl({ onlyExternalMetrics: true }), {
          headers,
          signal,
        });
        if (!dashboardFetchGen.isCurrent(requestId)) return;
        if (response.status === 499) return;
        const parsed = await parseDashboardResponse(response);
        if (!parsed.ok || !parsed.result?.data) return;

        const data = parsed.result.data;
        if (data.bancaId) setBancaId(data.bancaId as string);
        if ((data.bancaInfo as { name?: string } | undefined)?.name) {
          setBancaName((data.bancaInfo as { name: string }).name);
        }
        const em = data.externalMetrics;
        if (em != null && typeof em === 'object') {
          setExternalMetrics(em as ExternalMetrics);
          setExternalMetricsError(null);
          setIsAuthorized(true);
        }
        const et = (data as { extractTotals?: unknown }).extractTotals;
        setExtractTotals(et != null && typeof et === 'object' ? (et as ExtractTotals) : null);
        if (typeof data.hasConsultoresComCampanha === 'boolean') {
          setHasConsultoresComCampanha(data.hasConsultoresComCampanha);
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') return;
        console.warn('[DonoBanca] Erro ao buscar métricas externas:', err);
      }
    };

    const loadGerentesBatches = async () => {
      let offset = 0;
      let hasMore = true;
      let isFirstBatch = true;

      while (hasMore) {
        if (!dashboardFetchGen.isCurrent(requestId)) return;

        try {
          const url = buildRequestUrl({
            offset,
            limit: BATCH_SIZE,
            skipExternalMetrics: true,
          });
          const response = await fetch(url, { headers, signal });
          if (!dashboardFetchGen.isCurrent(requestId)) return;
          if (response.status === 499) return;

          const parsed = await parseDashboardResponse(response);
          if (parsed.parseError) {
            console.error('[Frontend] Resposta não-JSON do dashboard (timeout/edge):', parsed.parseError);
            if (isFirstBatch) {
              setIsAuthorized(false);
              setExternalMetricsError(
                'O servidor devolveu uma resposta inválida (muito provável timeout). Os dados foram divididos em lotes; tente atualizar ou reduzir o período.'
              );
            }
            break;
          }

          const { ok, result } = parsed;
          if (!ok || !result?.data) {
            if (isFirstBatch) {
              console.error('[Frontend] Erro na autorização:', result?.error || result?.message);
              setIsAuthorized(false);
            }
            break;
          }

          const data = result.data;
          if (isFirstBatch) {
            setIsAuthorized(true);
            setGerentes((data.gerentes as Gerente[]) || []);
            if (data.bancaId) setBancaId(data.bancaId as string);
            if ((data.bancaInfo as { name?: string } | undefined)?.name) {
              setBancaName((data.bancaInfo as { name: string }).name);
            }
            if (typeof data.hasConsultoresComCampanha === 'boolean') {
              setHasConsultoresComCampanha(data.hasConsultoresComCampanha);
            }
            isFirstBatch = false;
          } else {
            setGerentes((prev) => [...prev, ...(((data.gerentes as Gerente[]) || []) as Gerente[])]);
          }

          const contributors = (data.consultantRankContributors ?? []) as Array<{ email: string; name: string; value: number }>;
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
          if (nextTop5.length === 0 && Array.isArray(data.top5Consultants)) {
            const t5 = data.top5Consultants as Array<{ name: string; value: number }>;
            if (t5.length > 0) nextTop5 = t5;
          }
          if (dashboardFetchGen.isCurrent(requestId)) {
            setTop5Consultants(nextTop5);
          }

          hasMore = data.hasMore === true;
          offset += BATCH_SIZE;
        } catch (err: unknown) {
          if (err instanceof Error && err.name === 'AbortError') return;
          throw err;
        }
      }
    };

    // LTV recorrente por consultor (cohort) — disparado PRIMEIRO para ter prioridade
    // na fila de saída ao CRM (entra no portão de throttle antes dos demais).
    const loadCohort = async () => {
      setCohortLoading(true);
      setCohortError(null);
      try {
        const params = new URLSearchParams();
        if (dateFrom) params.set('date_from', dateFrom);
        if (dateTo) params.set('date_to', dateTo);
        if (bancaIdAtRequest) params.set('banca_id', bancaIdAtRequest);
        const res = await fetch(`/api/dono-banca/cohort-real-players?${params.toString()}`, { headers, signal });
        if (!dashboardFetchGen.isCurrent(requestId)) return;
        const json = await res.json();
        if (json?.success && json.data) {
          setCohortData(Array.isArray(json.data.data) ? json.data.data : []);
          setCohortTotals(json.data.totals ?? null);
        } else {
          setCohortData([]);
          setCohortTotals(null);
          setCohortError(json?.error || 'Não foi possível carregar o LTV por consultor.');
        }
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        setCohortError('Não foi possível carregar o LTV por consultor.');
      } finally {
        if (dashboardFetchGen.isCurrent(requestId)) setCohortLoading(false);
      }
    };

    try {
      // Ordem de prioridade na fila do CRM:
      //   1) cohort (LTV Recorrente por Consultor)
      //   2) dashboard-metrics (Resumo Geral - Primeiro Depósito) + 3) extract-totals (Métricas Recorrentes)
      //   4) get-indicateds-by-consultant (tabela de gerentes) — POR ÚLTIMO.
      const cohortPromise = loadCohort(); // entra no portão de throttle antes dos demais
      await loadExternalMetrics();
      await loadGerentesBatches();
      await cohortPromise;
      if (!dashboardFetchGen.isCurrent(requestId)) return;
      if (dashboardFetchGen.isCurrent(requestId)) {
        lastLoadedBancaRef.current = bancaKey;
      }
    } catch (error) {
      if (dashboardFetchGen.isCurrent(requestId)) {
        console.error('[Frontend] Erro ao verificar autorização:', error);
        setIsAuthorized(false);
      }
    } finally {
      if (dashboardFetchGen.isCurrent(requestId)) {
        setLoading(false);
        setLoadingMetrics(false);
      }
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

  const effectiveBancaIdForTrafego = showBancaSelector ? selectedBancaId : bancaId;
  const gestorTrafegoHref =
    effectiveBancaIdForTrafego
      ? withTenantSlug(`/gestor-trafego?banca_id=${encodeURIComponent(effectiveBancaIdForTrafego)}`)
      : withTenantSlug('/gestor-trafego');

  const handleOpenGestorTrafego = () => {
    if (effectiveBancaIdForTrafego && typeof window !== 'undefined') {
      window.sessionStorage.setItem('gestor_effective_dono_id', `banca:${effectiveBancaIdForTrafego}`);
    }
    window.location.href = gestorTrafegoHref;
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
      window.location.href = withTenantSlug('/login');
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
                <Filter className="w-4 h-4 text-[#E86A24]" />
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
              onClick={() => (window.location.href = withTenantSlug('/'))}
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
      {/* Modal: clientes (jogadores) do consultor selecionado */}
      {cohortModalConsultor !== null && (() => {
        const key = cohortModalConsultor.toLowerCase();
        const clients = cohortData
          .filter((p) => (p.consultant_email || p.consultant_name || '').toLowerCase() === key)
          // Quem depositou fica no topo (maior depósito primeiro), depois por LTV.
          .sort(
            (a, b) =>
              (Number(b.deposited_in_window) || 0) - (Number(a.deposited_in_window) || 0) ||
              (Number(b.ltv_in_window) || 0) - (Number(a.ltv_in_window) || 0)
          );
        const consultorNome = clients[0]?.consultant_name || cohortModalConsultor;
        return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setCohortModalConsultor(null)}>
            <div className="bg-white dark:bg-[#2a2a2a] rounded-2xl shadow-xl max-w-[90rem] w-full max-h-[88vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between gap-3 p-4 border-b border-gray-100 dark:border-gray-700">
                <div>
                  <h3 className="text-base font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                    <Users className="w-5 h-5 text-emerald-600 dark:text-emerald-400" /> Clientes de {consultorNome}
                  </h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{clients.length} jogador(es) no período</p>
                </div>
                <button onClick={() => setCohortModalConsultor(null)} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="overflow-auto p-2">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-white dark:bg-[#2a2a2a]">
                    <tr className="text-left text-[11px] text-gray-500 dark:text-gray-400 uppercase border-b border-gray-100 dark:border-gray-700">
                      <th className="px-3 py-2 font-bold">Cliente</th>
                      <th className="px-3 py-2 font-bold">Email</th>
                      <th className="px-3 py-2 font-bold">Cadastro</th>
                      <th className="px-3 py-2 font-bold text-right">Depositado</th>
                      <th className="px-3 py-2 font-bold text-right">Nº Dep.</th>
                      <th className="px-3 py-2 font-bold text-right">LTV</th>
                      <th className="px-3 py-2 font-bold text-center">Bucket</th>
                      <th className="px-3 py-2 font-bold">Último Dep.</th>
                      <th className="px-3 py-2 font-bold text-right">Vlr. Últ.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {clients.map((p) => (
                      <tr key={p.id} className="border-b border-gray-50 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/40">
                        <td className="px-3 py-2 text-gray-800 dark:text-gray-100">
                          {p.name || '—'}
                          {p.phone ? <span className="block text-[11px] text-gray-400">{p.phone}</span> : null}
                        </td>
                        <td className="px-3 py-2 text-gray-600 dark:text-gray-300 break-all">{p.email || '—'}</td>
                        <td className="px-3 py-2 text-gray-500 dark:text-gray-400 whitespace-nowrap">{p.registered_at?.slice(0, 10) || '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-800 dark:text-gray-100">{fmtBRL2(p.deposited_in_window)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-600 dark:text-gray-300">{p.deposits_count_in_window}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold text-emerald-700 dark:text-emerald-400">{fmtBRL2(p.ltv_in_window)}</td>
                        <td className="px-3 py-2 text-center">
                          <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200">{p.deposit_bucket || '0x'}</span>
                        </td>
                        <td className="px-3 py-2 text-gray-500 dark:text-gray-400 whitespace-nowrap">{p.last_deposit_at?.slice(0, 16).replace('T', ' ') || '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-600 dark:text-gray-300">{p.last_deposit_value != null ? fmtBRL2(p.last_deposit_value) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        );
      })()}

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
            {canShowGestorTrafegoButton && hasConsultoresComCampanha && effectiveBancaIdForTrafego && (
              <button
                type="button"
                onClick={handleOpenGestorTrafego}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold transition-all shadow-sm shrink-0 text-sm bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
                title="Abrir Gestão de Tráfego desta banca"
              >
                <Megaphone className="w-4 h-4" />
                Gestão de Tráfego
                <ExternalLink className="w-3.5 h-3.5 opacity-80" />
              </button>
            )}

            <button
              onClick={() => setExportCsvModalOpen(true)}
              disabled={!userId}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold transition-all shadow-sm shrink-0 text-sm bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Exportar leads da banca em CSV (com filtros do CRM)"
            >
              <Download className="w-4 h-4" />
              Exportar CSV
            </button>

            {!isAdminOrSuperAdmin && (
              <button
                onClick={() => setIsModalOpen(true)}
                className="flex items-center justify-center gap-2 bg-[#E86A24] hover:bg-[#D95E1B] text-white px-4 py-2.5 rounded-xl font-bold transition-all shadow-md shadow-orange-100 dark:shadow-none shrink-0"
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
                  <Filter className="w-4 h-4 text-[#E86A24]" />
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
                          selectedBancaId === banca.id ? 'bg-[#E86A2415] dark:bg-[#E86A2425] text-[#E86A24] font-medium' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
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
                  <Calendar className="w-4 h-4 text-[#E86A24]" />
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
                          dateFilter === 'daily' ? 'bg-[#E86A2415] dark:bg-[#E86A2425] text-[#E86A24] font-medium' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
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
                          dateFilter === 'yesterday' ? 'bg-[#E86A2415] dark:bg-[#E86A2425] text-[#E86A24] font-medium' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
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
                          dateFilter === '7days' ? 'bg-[#E86A2415] dark:bg-[#E86A2425] text-[#E86A24] font-medium' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
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
                          dateFilter === '15days' ? 'bg-[#E86A2415] dark:bg-[#E86A2425] text-[#E86A24] font-medium' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
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
                          dateFilter === '30days' ? 'bg-[#E86A2415] dark:bg-[#E86A2425] text-[#E86A24] font-medium' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
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
                          dateFilter === 'custom' ? 'bg-[#E86A2415] dark:bg-[#E86A2425] text-[#E86A24] font-medium' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
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
                          dateFilter === 'all' ? 'bg-[#E86A2415] dark:bg-[#E86A2425] text-[#E86A24] font-medium' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
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
                            className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-[#E86A24] focus:border-[#E86A24]"
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
                            className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-[#E86A24] focus:border-[#E86A24]"
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
                          className="w-full bg-[#E86A24] hover:bg-[#D95E1B] disabled:bg-gray-300 dark:disabled:bg-gray-600 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
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
              <div className="bg-gradient-to-br from-[#EF9057] to-[#E86A24] dark:from-emerald-800 dark:to-emerald-900 p-4 sm:p-6 rounded-2xl shadow-lg border border-[#E86A24]/40 dark:border-emerald-700/50">
                <div className="flex items-center gap-2 mb-6">
                  <BarChart3 className="w-6 h-6 text-white" />
                  <h2 className="text-xl font-bold text-white">Resumo Geral - {bancaName || 'Banca'} (Primeiro Depósito)</h2>
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
              <div className="bg-gradient-to-br from-[#EF9057] to-[#E86A24] dark:from-emerald-800 dark:to-emerald-900 p-4 sm:p-6 rounded-2xl shadow-lg border border-[#E86A24]/40 dark:border-emerald-700/50">
              <div className="flex items-center gap-2 mb-6">
                <BarChart3 className="w-6 h-6 text-white" />
                <h2 className="text-xl font-bold text-white">Resumo Geral - {bancaName || 'Banca'} (Primeiro Depósito)</h2>
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
                    {loadingMetrics ? <Loader2 className="w-6 h-6 animate-spin inline" /> : `R$ ${(externalMetrics.total_deposited || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                  </p>
                </div>

                {/* Card: Total Apostado */}
                <div className="bg-white/10 backdrop-blur-sm p-4 rounded-xl border border-white/20">
                  <div className="flex items-center gap-2 mb-2">
                    <Target className="w-4 h-4 text-white" />
                    <p className="text-xs font-bold text-white/90 uppercase">Total Apostado</p>
                  </div>
                  <p className="text-2xl font-bold text-white">
                    {loadingMetrics ? <Loader2 className="w-6 h-6 animate-spin inline" /> : `R$ ${(externalMetrics.total_bets || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                  </p>
                </div>

                {/* Card: Total Premiado */}
                <div className="bg-white/10 backdrop-blur-sm p-4 rounded-xl border border-white/20">
                  <div className="flex items-center gap-2 mb-2">
                    <Award className="w-4 h-4 text-white" />
                    <p className="text-xs font-bold text-white/90 uppercase">Total Premiado</p>
                  </div>
                  <p className="text-2xl font-bold text-white">
                    {loadingMetrics ? <Loader2 className="w-6 h-6 animate-spin inline" /> : `R$ ${(externalMetrics.total_prizes || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
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
                    {loadingMetrics ? <Loader2 className="w-6 h-6 animate-spin inline" /> : `R$ ${(externalMetrics.net_profit || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                  </p>
                </div>
              </div>
            </div>
            ) : (
              <div className="bg-gradient-to-br from-[#EF9057] to-[#E86A24] dark:from-emerald-800 dark:to-emerald-900 p-4 sm:p-6 rounded-2xl shadow-lg border border-[#E86A24]/40 dark:border-emerald-700/50">
                <div className="text-center py-8">
                  <AlertCircle className="w-12 h-12 text-white/80 mx-auto mb-4" />
                  <p className="text-white font-medium">Dados externos não encontrados</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Métricas Recorrentes da Banca (extract-totals) — todas as recargas/transações no período */}
        {(externalMetrics || extractTotals || loadingMetrics) && (
          <div className="bg-gradient-to-br from-indigo-500 to-blue-600 dark:from-indigo-800 dark:to-blue-900 p-4 sm:p-6 rounded-2xl shadow-lg border border-indigo-400/40 dark:border-indigo-700/50">
            <div className="flex items-center gap-2 mb-1">
              <BarChart3 className="w-6 h-6 text-white" />
              <h2 className="text-xl font-bold text-white">Métricas Recorrentes - {bancaName || 'Banca'}</h2>
            </div>
            <p className="text-xs text-white/80 mb-6">Todas as recargas e transações da banca no período (não apenas primeiro depósito).</p>
            {!extractTotals && !loadingMetrics ? (
              <p className="text-sm text-white/80 py-4">Não foi possível carregar as métricas recorrentes para este período. Tente atualizar.</p>
            ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {([
                { label: 'Total de Recargas', value: extractTotals?.total_recargas, icon: DollarSign },
                { label: 'Recarga PIX', value: extractTotals?.recarga_pix, icon: DollarSign },
                { label: 'Recarga Manual', value: extractTotals?.recarga_manual, icon: DollarSign },
                { label: 'Total de Bônus', value: extractTotals?.total_bonus, icon: Award },
                { label: 'Bônus Afiliado', value: extractTotals?.bonus_afiliado, icon: Award },
                { label: 'Bônus Estrelas', value: extractTotals?.bonus_estrelas, icon: Award },
                { label: 'Apostas Loterias', value: extractTotals?.apostas_loterias, icon: Target },
                { label: 'Apostas Jogo do Bicho', value: extractTotals?.apostas_jogo_do_bicho, icon: Target },
                { label: 'Prêmios Loterias', value: extractTotals?.premios_loterias, icon: Award },
                { label: 'Prêmios JB', value: extractTotals?.premios_jb, icon: Award },
                { label: 'Venda Combo', value: extractTotals?.venda_combo_total, icon: Target },
                { label: 'Saque Solicitado', value: extractTotals?.solicitacao_saque, icon: Wallet },
                { label: 'Saque Disponível', value: extractTotals?.total_saque_disponivel, icon: Wallet },
                { label: 'Saldo Total', value: extractTotals?.total_balance, icon: Wallet },
                { label: 'Total Transações', value: extractTotals?.total_transacts, icon: TrendingUp },
              ] as const).map(({ label, value, icon: Icon }) => (
                <div key={label} className="bg-white/10 backdrop-blur-sm p-4 rounded-xl border border-white/20">
                  <div className="flex items-center gap-2 mb-2">
                    <Icon className="w-4 h-4 text-white" />
                    <p className="text-xs font-bold text-white/90 uppercase">{label}</p>
                  </div>
                  <p className="text-2xl font-bold text-white">
                    {loadingMetrics
                      ? <Loader2 className="w-6 h-6 animate-spin inline" />
                      : `R$ ${(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                  </p>
                </div>
              ))}
            </div>
            )}
          </div>
        )}

        {/* Análise da Banca — admin/super: todas; dono: própria banca (escopo no servidor) */}
        <BancaAnalysisGrid
          userId={userId ?? null}
          dateFrom={getDateRange().dateFrom}
          dateTo={getDateRange().dateTo}
        />

        {/* LTV Recorrente por Consultor (cohort-real-players) */}
        <CohortLtvCard
          consultants={cohortByConsultant}
          totals={cohortTotals}
          loading={cohortLoading}
          error={cohortError}
          hasBanca={Boolean(showBancaSelector ? selectedBancaId : bancaId)}
          onViewClients={(consultorEmail) => setCohortModalConsultor(consultorEmail)}
        />

        {/* Gráficos Detalhados do Resumo Geral */}
        {externalMetrics && (
          <div className="bg-white dark:bg-[#2a2a2a] p-4 sm:p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
              <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-4 sm:mb-6 flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-[#E86A24]" />
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
              <div className="animate-spin rounded-full h-10 w-10 border-2 border-[#E86A24] border-t-transparent" />
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
                          href={withTenantSlug(`/dono-banca/gerentes/${gerente.id}`)}
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
                    className="flex-[3] bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-xl transition-all shadow-lg shadow-emerald-100 disabled:opacity-50 flex items-center justify-center gap-2"
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
