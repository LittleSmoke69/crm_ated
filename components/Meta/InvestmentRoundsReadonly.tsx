'use client';

/**
 * Barra de gasto de ADS (Rodadas de Investimento) — visão SOMENTE LEITURA.
 *
 * Usada no dashboard do consultor (própria rodada + gasto diário) e do gerente
 * (rodadas dos consultores + barra agregada da equipe). Não cria nem edita.
 *
 * Endpoints (variam por papel, via `apiBase`):
 *   GET ${apiBase}/investment-rounds            → { rounds, consultors? }
 *   GET ${apiBase}/dash-metric?round_id=        → métricas + daily_spend
 *
 *   consultor: apiBase = /api/consultor
 *   gerente:   apiBase = /api/gerente
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Target, Loader2, TrendingUp, Wallet, AlertCircle, CalendarRange } from 'lucide-react';

interface RoundRow {
  id: string;
  consultor_id: string;
  consultor_email: string;
  data_inicial: string;
  data_final: string;
  meta_gasto: number;
  label: string | null;
}

interface ConsultorOption {
  id: string;
  email: string;
  full_name: string | null;
}

interface DailySpendPoint {
  date: string;
  spend: number;
  cumulative_spend: number;
}

interface DashMetric {
  spend_real: number;
  meta_gasto: number;
  progress_pct: number;
  roas: number | null;
  daily_spend: DailySpendPoint[];
  metrics: {
    total_deposited: number;
    total_deposits_count: number;
    ltv_avg: number;
    net_profit: number;
  } | null;
  metrics_error: string | null;
}

function formatBRL(value: number, fractionDigits: 0 | 2 = 0): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(Number(value) || 0);
}

function formatDateBR(ymd: string): string {
  const [y, m, d] = String(ymd).slice(0, 10).split('-');
  if (!y || !m || !d) return ymd;
  return `${d}/${m}/${y}`;
}

function authHeaders(userId: string | null): Record<string, string> {
  return { 'Content-Type': 'application/json', ...(userId ? { 'X-User-Id': userId } : {}) };
}

function barColorFor(pct: number): string {
  if (pct > 100) return 'bg-amber-500';
  if (pct >= 80) return 'bg-[#E86A24]';
  return 'bg-emerald-500';
}

/** Mini-barras de gasto diário, normalizadas pelo maior dia. */
function DailySpendBars({ daily }: { daily: DailySpendPoint[] }) {
  const max = Math.max(1, ...daily.map((d) => d.spend));
  if (daily.length === 0) return null;
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">Gasto diário</p>
      <div className="flex items-end gap-0.5 h-12">
        {daily.map((d) => (
          <div
            key={d.date}
            className="flex-1 min-w-[2px] bg-emerald-400/70 dark:bg-emerald-500/60 rounded-sm hover:bg-emerald-500"
            style={{ height: `${Math.max(3, (d.spend / max) * 100)}%` }}
            title={`${formatDateBR(d.date)} · ${formatBRL(d.spend, 2)} (acum. ${formatBRL(d.cumulative_spend)})`}
          />
        ))}
      </div>
    </div>
  );
}

function ReadonlyRoundCard({
  round,
  consultorName,
  apiBase,
  userId,
  onMetric,
}: {
  round: RoundRow;
  consultorName: string;
  apiBase: string;
  userId: string | null;
  onMetric?: (roundId: string, spend: number, meta: number) => void;
}) {
  const [metric, setMetric] = useState<DashMetric | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/dash-metric?round_id=${encodeURIComponent(round.id)}`, {
        headers: authHeaders(userId),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || `Erro ${res.status}`);
      const data = json.data as DashMetric;
      setMetric(data);
      onMetric?.(round.id, data.spend_real, data.meta_gasto);
    } catch (e: any) {
      setError(e?.message || 'Falha ao carregar');
    } finally {
      setLoading(false);
    }
    // onMetric intentionally excluded to avoid refetch loops
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round.id, apiBase, userId]);

  useEffect(() => {
    load();
  }, [load]);

  const pct = metric?.progress_pct ?? 0;
  const pctClamped = Math.min(100, Math.max(0, pct));
  const over = pct > 100;
  const m = metric?.metrics;

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#2a2a2a] p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {round.label || consultorName}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
            <CalendarRange className="w-3 h-3" />
            {formatDateBR(round.data_inicial)} → {formatDateBR(round.data_final)}
          </p>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between text-xs mb-1">
          <span className="text-gray-600 dark:text-gray-400">
            Gasto {loading ? '…' : formatBRL(metric?.spend_real ?? 0)} de {formatBRL(round.meta_gasto)}
          </span>
          <span className={`font-semibold tabular-nums ${over ? 'text-amber-600 dark:text-amber-400' : 'text-gray-800 dark:text-gray-200'}`}>
            {loading ? '—' : `${pct.toFixed(1)}%`}
          </span>
        </div>
        <div className="h-2.5 w-full rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
          <div className={`h-full rounded-full transition-all ${barColorFor(pct)}`} style={{ width: `${pctClamped}%` }} />
        </div>
      </div>

      {metric?.daily_spend && metric.daily_spend.length > 0 ? <DailySpendBars daily={metric.daily_spend} /> : null}

      {error ? (
        <div className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400">
          <AlertCircle className="w-4 h-4 shrink-0" /> {error}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Stat label="LTV médio" value={loading ? '…' : formatBRL(m?.ltv_avg ?? 0, 2)} icon={<TrendingUp className="w-3.5 h-3.5" />} />
          <Stat label="Depositado" value={loading ? '…' : formatBRL(m?.total_deposited ?? 0)} sub={m ? `${m.total_deposits_count} dep.` : undefined} icon={<Wallet className="w-3.5 h-3.5" />} />
          <Stat label="Lucro líq." value={loading ? '…' : formatBRL(m?.net_profit ?? 0)} icon={<TrendingUp className="w-3.5 h-3.5" />} />
          <Stat label="ROAS" value={loading ? '…' : metric?.roas != null ? `${metric.roas.toFixed(2)}x` : '—'} icon={<Target className="w-3.5 h-3.5" />} />
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub, icon }: { label: string; value: string; sub?: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-gray-50 dark:bg-gray-800/60 px-2.5 py-2">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {icon}
        <span>{label}</span>
      </div>
      <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 tabular-nums">{value}</p>
      {sub ? <p className="text-[10px] text-gray-500 dark:text-gray-400">{sub}</p> : null}
    </div>
  );
}

export default function InvestmentRoundsReadonly({
  apiBase,
  userId,
  title = 'Gasto de ADS — Rodadas de Investimento',
  showConsultorFilter = false,
  showAggregate = false,
}: {
  /** `/api/consultor` ou `/api/gerente` */
  apiBase: string;
  userId: string | null;
  title?: string;
  /** Gerente: filtro por consultor da equipe. */
  showConsultorFilter?: boolean;
  /** Gerente: barra agregada (soma de gasto ÷ soma de metas). */
  showAggregate?: boolean;
}) {
  const [rounds, setRounds] = useState<RoundRow[]>([]);
  const [consultors, setConsultors] = useState<ConsultorOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterConsultorId, setFilterConsultorId] = useState('');
  const [agg, setAgg] = useState<Record<string, { spend: number; meta: number }>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setAgg({});
    try {
      const res = await fetch(`${apiBase}/investment-rounds`, { headers: authHeaders(userId) });
      const json = await res.json();
      if (res.ok && json.success) {
        setRounds((json.data?.rounds ?? []) as RoundRow[]);
        setConsultors((json.data?.consultors ?? []) as ConsultorOption[]);
      } else {
        setRounds([]);
      }
    } catch {
      setRounds([]);
    } finally {
      setLoading(false);
    }
  }, [apiBase, userId]);

  useEffect(() => {
    load();
  }, [load]);

  const consultorNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of consultors) map.set(c.id, c.full_name || c.email);
    return map;
  }, [consultors]);

  const visibleRounds = useMemo(
    () => (filterConsultorId ? rounds.filter((r) => r.consultor_id === filterConsultorId) : rounds),
    [rounds, filterConsultorId]
  );

  const handleMetric = useCallback((roundId: string, spend: number, meta: number) => {
    setAgg((prev) => ({ ...prev, [roundId]: { spend, meta } }));
  }, []);

  const aggregate = useMemo(() => {
    let spend = 0;
    let meta = 0;
    for (const r of visibleRounds) {
      const a = agg[r.id];
      if (a) {
        spend += a.spend;
        meta += a.meta;
      }
    }
    const pct = meta > 0 ? (spend / meta) * 100 : 0;
    return { spend, meta, pct };
  }, [visibleRounds, agg]);

  return (
    <div className="bg-white dark:bg-[#2a2a2a] rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-4 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-emerald-50 dark:bg-emerald-900/30 rounded-xl">
            <Target className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
          </div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">{title}</h2>
        </div>
        {showConsultorFilter && consultors.length > 0 ? (
          <select
            value={filterConsultorId}
            onChange={(e) => setFilterConsultorId(e.target.value)}
            className="min-w-[200px] rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100"
          >
            <option value="">Todos os consultores</option>
            {consultors.map((c) => (
              <option key={c.id} value={c.id}>
                {c.full_name || c.email}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      {/* Barra de progresso — SEMPRE visível (mesmo sem rodada). % e valor no meio. */}
      <div>
        <div className="flex items-center justify-between text-xs mb-1.5">
          <span className="font-semibold text-gray-700 dark:text-gray-200">
            {showAggregate ? 'Total da equipe' : 'Progresso da meta de gasto'}
            {showAggregate && filterConsultorId ? ' (consultor selecionado)' : ''}
          </span>
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin text-[#E86A24]" /> : null}
        </div>
        <div className="relative h-8 w-full rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${barColorFor(aggregate.pct)}`}
            style={{ width: `${Math.min(100, Math.max(0, aggregate.pct))}%` }}
          />
          <div className="absolute inset-0 flex items-center justify-center px-3">
            <span className="text-xs sm:text-sm font-bold text-gray-900 dark:text-white tabular-nums [text-shadow:0_1px_2px_rgba(255,255,255,0.6)] dark:[text-shadow:0_1px_2px_rgba(0,0,0,0.6)]">
              {aggregate.meta > 0
                ? `${aggregate.pct.toFixed(1)}% · ${formatBRL(aggregate.spend)} de ${formatBRL(aggregate.meta)}`
                : 'Sem rodada de investimento ativa'}
            </span>
          </div>
        </div>
      </div>

      {/* Detalhe por rodada (quando houver) */}
      {visibleRounds.length > 0 ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {visibleRounds.map((r) => (
            <ReadonlyRoundCard
              key={r.id}
              round={r}
              consultorName={consultorNameById.get(r.consultor_id) || r.consultor_email}
              apiBase={apiBase}
              userId={userId}
              onMetric={handleMetric}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
