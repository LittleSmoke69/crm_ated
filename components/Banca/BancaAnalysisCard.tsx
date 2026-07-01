'use client';

/**
 * Card "Análise da Banca" — métricas consolidadas da banca (Gasto de ADS, Faturamento,
 * LTV, etc.) com um botão que desliza para a direita, dentro do próprio card, revelando
 * a quebra por consultor (ADS / Faturamento / LTV).
 *
 * Só aparece quando a banca tem integração de Ads ativa.
 * Fonte: GET /api/banca-analysis (cohort-real-players + dashboard-metrics + Meta spend).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  BarChart3,
  Loader2,
  Megaphone,
  DollarSign,
  TrendingUp,
  Wallet,
  Users,
  ArrowRight,
  ArrowLeft,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

interface ConsultantRow {
  consultant_email: string;
  consultant_name: string;
  ads: number;
  faturamento: number;
  ltv: number;
  players: number;
  players_that_deposited: number;
}

interface AdsConsultantRow {
  consultant_email: string;
  consultant_name: string;
  ads: number;
}

interface ConsultantMetrics {
  cadastros: number;
  faturamento: number;
  total_deposits_count: number;
  players_that_deposited: number;
  ltv: number;
  players_with_ltv: number;
  ltv_avg: number;
}

interface Analysis {
  ads_active: boolean;
  ads_spend: number;
  faturamento: number;
  ltv: number;
  ltv_pct: number;
  custo_por_lead: number;
  total_depositos: number;
  depositos_recorrentes: number;
  total_cadastros: number;
  total_premio: number;
  total_gerados: number;
  cohort: {
    cohort_size: number;
    total_deposited_in_window: number;
    total_deposits_count_in_window: number;
    players_that_deposited: number;
    total_ltv_in_window: number;
    players_with_ltv: number;
    ltv_avg: number;
    deposit_buckets: { dep_1x: number; dep_2x: number; dep_3x: number; dep_4x_plus: number };
  } | null;
  first_deposit: {
    total_deposited: number;
    total_deposits_count: number;
    total_leads: number;
    active_leads: number;
    conversion_rate: number;
    ltv_avg: number;
    net_profit: number;
    total_prizes: number;
  } | null;
  consultants: ConsultantRow[];
  ads_consultants: AdsConsultantRow[];
}

function brl(v: number): string {
  return `R$ ${(Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function int(v: number): string {
  return String(Number(v) || 0);
}

function authHeaders(userId: string | null): Record<string, string> {
  return { 'Content-Type': 'application/json', ...(userId ? { 'X-User-Id': userId } : {}) };
}

function BigStat({ label, value, icon, accent, compact }: { label: string; value: string; icon: React.ReactNode; accent: 'rose' | 'emerald'; compact?: boolean }) {
  const ring = accent === 'rose' ? 'from-rose-500/15 to-rose-600/5 border-rose-400/30' : 'from-emerald-500/15 to-emerald-600/5 border-emerald-400/30';
  const iconColor = accent === 'rose' ? 'text-rose-500 dark:text-rose-400' : 'text-emerald-500 dark:text-emerald-400';
  return (
    <div className={`rounded-2xl border bg-gradient-to-br ${ring} ${compact ? 'p-3 min-h-[80px]' : 'p-4 min-h-[110px]'} flex flex-col justify-between`}>
      <div className={`flex items-center gap-2 text-xs font-bold uppercase tracking-wide ${iconColor}`}>
        {icon}
        <span>{label}</span>
      </div>
      <p className={`${compact ? 'text-xl' : 'text-2xl sm:text-3xl'} font-bold text-gray-900 dark:text-gray-100 tabular-nums mt-1.5`}>{value}</p>
    </div>
  );
}

/** Accordion das explicações "!": só uma aberta por vez dentro de cada card. */
const StatAccordionCtx = React.createContext<{ openId: string | null; setOpenId: (id: string | null) => void }>({
  openId: null,
  setOpenId: () => {},
});

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  const id = React.useId();
  const { openId, setOpenId } = React.useContext(StatAccordionCtx);
  const open = openId === id;
  return (
    <div className="relative rounded-xl bg-gray-50 dark:bg-gray-800/60 px-4 py-3">
      <div className="flex items-start justify-between gap-1">
        <p className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400 font-bold leading-tight">{label}</p>
        {hint && (
          <button
            type="button"
            onClick={() => setOpenId(open ? null : id)}
            className="shrink-0 w-4 h-4 rounded-full bg-white/80 dark:bg-gray-700 border border-gray-300 dark:border-gray-500 text-[10px] font-bold text-gray-600 dark:text-gray-200 flex items-center justify-center leading-none hover:bg-white dark:hover:bg-gray-600"
            aria-label={`O que é ${label}?`}
          >
            !
          </button>
        )}
      </div>
      <p className="text-xl font-bold text-gray-900 dark:text-gray-100 tabular-nums mt-1">{value}</p>
      {open && hint && (
        <div className="mt-2 text-[11px] leading-snug text-gray-600 dark:text-gray-200 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-2 shadow-sm z-10 relative">
          {hint}
        </div>
      )}
    </div>
  );
}

export default function BancaAnalysisCard({
  bancaId,
  userId,
  dateFrom,
  dateTo,
  bancaName,
  lazy = false,
  compact = false,
}: {
  bancaId: string | null;
  userId: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  bancaName?: string | null;
  /** Só busca os dados quando o card entra na viewport (evita rajada com muitos cards). */
  lazy?: boolean;
  /** Grids internos mais enxutos (para exibir cards lado a lado). */
  compact?: boolean;
}) {
  const metricGrid = compact
    ? 'grid grid-cols-2 lg:grid-cols-3 gap-2'
    : 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3';

  const periodLabel = React.useMemo(() => {
    const fmt = (iso: string | null) => {
      if (!iso) return null;
      const [y, m, d] = iso.split('-');
      return `${d}/${m}/${y}`;
    };
    const f = fmt(dateFrom);
    const t = fmt(dateTo);
    if (f && t && f !== t) return `${f} – ${t}`;
    if (f && t && f === t) return f;
    if (f) return `A partir de ${f}`;
    if (t) return `Até ${t}`;
    return 'Hoje';
  }, [dateFrom, dateTo]);
  const [data, setData] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showConsultors, setShowConsultors] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [openStatId, setOpenStatId] = useState<string | null>(null);
  const [consultorTab, setConsultorTab] = useState<'ads' | 'geral'>('ads');
  const [metricsByEmail, setMetricsByEmail] = useState<Record<string, { loading: boolean; data: ConsultantMetrics | null; error?: string }>>({});
  const metricsRef = useRef(metricsByEmail);
  metricsRef.current = metricsByEmail;
  const rootRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(!lazy);

  const loadConsultantMetrics = useCallback(
    async (email: string) => {
      if (!email || metricsRef.current[email]) return; // já carregado/carregando
      setMetricsByEmail((prev) => ({ ...prev, [email]: { loading: true, data: null } }));
      try {
        const params = new URLSearchParams();
        if (bancaId) params.set('banca_id', bancaId);
        params.set('consultant', email);
        if (dateFrom) params.set('date_from', dateFrom);
        if (dateTo) params.set('date_to', dateTo);
        const res = await fetch(`/api/banca-analysis/consultant-metrics?${params.toString()}`, {
          headers: authHeaders(userId),
        });
        const json = await res.json();
        if (res.ok && json.success) {
          setMetricsByEmail((prev) => ({ ...prev, [email]: { loading: false, data: (json.data?.metrics ?? null) as ConsultantMetrics | null } }));
        } else {
          setMetricsByEmail((prev) => ({ ...prev, [email]: { loading: false, data: null, error: json.error || 'Erro ao carregar' } }));
        }
      } catch {
        setMetricsByEmail((prev) => ({ ...prev, [email]: { loading: false, data: null, error: 'Falha ao carregar' } }));
      }
    },
    [bancaId, dateFrom, dateTo, userId]
  );

  // Pré-carrega as métricas (cohort) dos consultores ADS quando a aba/painel abre — 2 por vez.
  useEffect(() => {
    if (!showConsultors || consultorTab !== 'ads' || !data?.ads_consultants?.length) return;
    let cancelled = false;
    const emails = data.ads_consultants.map((c) => c.consultant_email).filter(Boolean);
    (async () => {
      // Endpoint leve (cohort-real-players-metrics) → dá pra paralelizar mais.
      const CONCURRENCY = 4;
      for (let i = 0; i < emails.length; i += CONCURRENCY) {
        if (cancelled) return;
        await Promise.all(emails.slice(i, i + CONCURRENCY).map((e) => loadConsultantMetrics(e)));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showConsultors, consultorTab, data?.ads_consultants, loadConsultantMetrics]);

  const load = useCallback(
    async (controller: AbortController) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (dateFrom) params.set('date_from', dateFrom);
        if (dateTo) params.set('date_to', dateTo);
        if (bancaId) params.set('banca_id', bancaId);
        const res = await fetch(`/api/banca-analysis?${params.toString()}`, {
          headers: authHeaders(userId),
          signal: controller.signal,
        });
        const json = await res.json();
        if (controller.signal.aborted) return;
        if (res.ok && json.success) {
          setData(json.data as Analysis);
        } else {
          setError(json.error || `Erro ${res.status}`);
          setData(null);
        }
      } catch (e: any) {
        if (e?.name === 'AbortError') return;
        setError('Falha ao carregar a análise da banca.');
        setData(null);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    },
    [bancaId, dateFrom, dateTo, userId]
  );

  // Lazy: marca visível quando entra na viewport (uma vez).
  useEffect(() => {
    if (!lazy || visible) return;
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          obs.disconnect();
        }
      },
      { rootMargin: '200px' }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [lazy, visible]);

  useEffect(() => {
    if (!userId || !visible) return;
    const controller = new AbortController();
    load(controller);
    return () => controller.abort();
  }, [load, userId, visible]);

  if (data && !data.ads_active) return null;

  return (
    <StatAccordionCtx.Provider value={{ openId: openStatId, setOpenId: setOpenStatId }}>
    <div ref={rootRef} className={`bg-white dark:bg-[#2a2a2a] rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden h-full ${compact ? 'p-3 sm:p-4' : 'p-4 sm:p-6'}`}>
      <div className="flex flex-wrap items-start justify-between gap-2 mb-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            Análise da Banca{bancaName ? ` — ${bancaName}` : ''}
          </h2>
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700/60 px-2 py-0.5 rounded-full w-fit">
            <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
            {periodLabel}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {loading ? <Loader2 className="w-5 h-5 animate-spin text-emerald-500" /> : null}
          {data && !showConsultors ? (
            <button
              onClick={() => setShowConsultors(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold"
            >
              <Users className="w-4 h-4" /> Ver consultores <ArrowRight className="w-4 h-4" />
            </button>
          ) : data && showConsultors ? (
            <button
              onClick={() => setShowConsultors(false)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-100 text-sm font-semibold"
            >
              <ArrowLeft className="w-4 h-4" /> Voltar
            </button>
          ) : null}
        </div>
      </div>

      {!visible && !data ? (
        <p className="text-xs text-gray-400 dark:text-gray-500 py-6 text-center">Role para carregar a análise…</p>
      ) : error && !data ? (
        <p className="text-sm text-amber-600 dark:text-amber-400 py-4">{error}</p>
      ) : loading && !data ? (
        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 py-10 justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-emerald-500" /> Carregando análise…
        </div>
      ) : data ? (
        // Trilho com 2 painéis lado a lado; desliza com translateX.
        <div className="relative overflow-hidden">
          <div
            className="flex w-[200%] transition-transform duration-300 ease-out"
            style={{ transform: showConsultors ? 'translateX(-50%)' : 'translateX(0)' }}
          >
            {/* Painel 1: visão da banca */}
            <div className="w-1/2 shrink-0 pr-1 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <BigStat label="Gasto de Ads" value={brl(data.ads_spend)} icon={<Megaphone className="w-4 h-4" />} accent="rose" compact={compact} />
                <BigStat label="Faturamento" value={brl(data.faturamento)} icon={<DollarSign className="w-4 h-4" />} accent="emerald" compact={compact} />
              </div>

              <div className={metricGrid}>
                <Stat label="LTV" value={brl(data.ltv)} hint="Valor total gerado pelos jogadores além do primeiro depósito. Mostra o quanto eles voltaram a depositar após a captação." />
                <Stat label="LTV %" value={`${data.ltv_pct.toFixed(1)}%`} hint="Percentual do faturamento que veio de depósitos recorrentes. Calculado como LTV ÷ Faturamento total." />
                <Stat label="Total de Depósitos" value={int(data.total_depositos)} hint="Número total de transações de depósito no período, contando primeiros depósitos e recorrentes juntos." />
                <Stat label="Depósitos recorrentes" value={int(data.depositos_recorrentes)} hint="Quantidade de jogadores que depositaram mais de uma vez no período, ou seja, voltaram a apostar." />
                <Stat label="Total Gerados (lucro)" value={brl(data.total_gerados)} hint="Lucro bruto da banca no período: Faturamento total menos o total de prêmios pagos aos jogadores." />
                <Stat label="Total de Prêmio" value={brl(data.total_premio)} hint="Soma total de prêmios pagos aos jogadores no período (saídas de caixa da banca)." />
                <Stat label="Total de Cadastro" value={int(data.total_cadastros)} hint="Número de jogadores reais cadastrados no período. É a base do cohort usada para calcular o LTV médio." />
                <Stat label="Custo por lead" value={brl(data.custo_por_lead)} hint="Quanto custou, em média, cada cadastro: Gasto de ADS ÷ Total de Cadastro no período." />
              </div>

              {(data.cohort || data.first_deposit) ? (
                <button
                  onClick={() => setShowDetails((s) => !s)}
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700 dark:text-emerald-400 hover:underline"
                >
                  {showDetails ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  {showDetails ? 'Ocultar submétricas e 1º depósito' : 'Ver submétricas e métricas de 1º depósito'}
                </button>
              ) : null}

              {showDetails && data.cohort ? (
                <div className="rounded-xl border border-gray-100 dark:border-gray-700 p-3">
                  <p className="text-xs font-bold text-gray-700 dark:text-gray-200 mb-2">Submétricas</p>
                  <div className={metricGrid}>
                    <Stat label="Faturamento bruto" value={brl(data.cohort.total_deposited_in_window)} hint="Todos os depósitos dos jogadores no período, incluindo o 1º (total_deposited_in_window). É o mesmo valor do Faturamento." />
                    <Stat label="Qtd. depósitos" value={int(data.cohort.total_deposits_count_in_window)} />
                    <Stat label="Depositaram ≥1x" value={int(data.cohort.players_that_deposited)} />
                    <Stat label="LTV médio" value={brl(data.cohort.ltv_avg)} hint="LTV ÷ jogadores da safra." />
                    <Stat label="Depositaram ≥1x" value={int(data.cohort.deposit_buckets.dep_1x)} />
                    <Stat label="Depositaram ≥2x" value={int(data.cohort.deposit_buckets.dep_2x)} />
                    <Stat label="Depositaram ≥3x" value={int(data.cohort.deposit_buckets.dep_3x)} />
                    <Stat label="Depositaram ≥4x" value={int(data.cohort.deposit_buckets.dep_4x_plus)} />
                  </div>
                  <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-2">Faixas cumulativas: ≥1x ≥ ≥2x ≥ ≥3x ≥ ≥4x.</p>
                </div>
              ) : null}

              {showDetails && data.first_deposit ? (
                <div className="rounded-xl border border-gray-100 dark:border-gray-700 p-3">
                  <p className="text-xs font-bold text-gray-700 dark:text-gray-200 mb-2">Métricas de 1º depósito</p>
                  <div className={metricGrid}>
                    <Stat label="Depositado (1º dep.)" value={brl(data.first_deposit.total_deposited)} />
                    <Stat label="Nº depósitos" value={int(data.first_deposit.total_deposits_count)} />
                    <Stat label="Leads" value={int(data.first_deposit.total_leads)} />
                    <Stat label="Leads ativos" value={int(data.first_deposit.active_leads)} />
                    <Stat label="Conversão" value={`${(data.first_deposit.conversion_rate || 0).toFixed(2)}%`} />
                    <Stat label="LTV médio (1º dep.)" value={brl(data.first_deposit.ltv_avg)} />
                    <Stat label="Lucro líquido" value={brl(data.first_deposit.net_profit)} />
                    <Stat label="Prêmios" value={brl(data.first_deposit.total_prizes)} />
                  </div>
                </div>
              ) : null}
            </div>

            {/* Painel 2: por consultor — abas ADS x Geral */}
            <div className="w-1/2 shrink-0 pl-1">
              <div className="flex items-center gap-2 mb-3">
                {(['ads', 'geral'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setConsultorTab(tab)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                      consultorTab === tab
                        ? 'bg-emerald-600 text-white'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'
                    }`}
                  >
                    {tab === 'ads' ? `Consultores ADS (${data.ads_consultants.length})` : `Geral (${data.consultants.length})`}
                  </button>
                ))}
              </div>

              {consultorTab === 'ads' ? (
                data.ads_consultants.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400 py-6 text-center">Nenhum consultor atribuído às campanhas.</p>
                ) : (
                  <div className="max-h-[420px] overflow-y-auto space-y-1.5 pr-1">
                    {data.ads_consultants.map((c) => {
                      const st = metricsByEmail[c.consultant_email];
                      const m = st?.data;
                      return (
                        <div key={c.consultant_email} className="rounded-lg border border-gray-100 dark:border-gray-700 px-3 py-2">
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{c.consultant_name}</p>
                              <p className="text-[10px] text-gray-400 truncate">{c.consultant_email}</p>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="text-xs tabular-nums text-rose-600 dark:text-rose-400" title="Gasto de ADS">{brl(c.ads)}</span>
                              {st?.loading ? <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-500" /> : null}
                            </div>
                          </div>
                          {m ? (
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2">
                              <Stat label="Cadastros" value={int(m.cadastros)} />
                              <Stat label="Faturamento" value={brl(m.faturamento)} />
                              <Stat label="LTV" value={brl(m.ltv)} />
                              <Stat label="Nº depósitos" value={int(m.total_deposits_count)} />
                              <Stat label="Depositaram" value={int(m.players_that_deposited)} />
                              <Stat label="LTV médio" value={brl(m.ltv_avg)} />
                            </div>
                          ) : st?.error ? (
                            <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">{st.error}</p>
                          ) : !st ? (
                            <p className="text-[11px] text-gray-400 mt-1">Aguardando…</p>
                          ) : st.loading ? null : (
                            <p className="text-[11px] text-gray-400 mt-1">Sem dados no período.</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )
              ) : data.consultants.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400 py-6 text-center">Nenhum consultor no período.</p>
              ) : (
                <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-white dark:bg-[#2a2a2a]">
                      <tr className="text-left text-[11px] text-gray-500 dark:text-gray-400 uppercase border-b border-gray-100 dark:border-gray-700">
                        <th className="px-3 py-2 font-bold">Consultor</th>
                        <th className="px-3 py-2 font-bold text-right"><Megaphone className="w-3.5 h-3.5 inline" /> ADS</th>
                        <th className="px-3 py-2 font-bold text-right"><Wallet className="w-3.5 h-3.5 inline" /> Faturamento</th>
                        <th className="px-3 py-2 font-bold text-right"><TrendingUp className="w-3.5 h-3.5 inline" /> LTV</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.consultants.map((c) => (
                        <tr key={c.consultant_email || c.consultant_name} className="border-b border-gray-50 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/40">
                          <td className="px-3 py-2.5 text-gray-800 dark:text-gray-100 font-medium">
                            {c.consultant_name}
                            <span className="block text-[10px] text-gray-400">{c.players_that_deposited}/{c.players} jogadores</span>
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-rose-600 dark:text-rose-400">{brl(c.ads)}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-gray-800 dark:text-gray-100">{brl(c.faturamento)}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-emerald-700 dark:text-emerald-400">{brl(c.ltv)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
    </StatAccordionCtx.Provider>
  );
}
