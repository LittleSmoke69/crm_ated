'use client';

/**
 * Card "Gasto de Ads × Depósito" — gráfico de linhas diário.
 *
 * Janela fixa: SEMPRE os últimos 7 dias (independe do filtro de período do painel).
 * Carrega automaticamente (sem botão de "carregar"); recarrega ao trocar o escopo de banca.
 *
 *   - linha 1 (gasto de ads/dia): agregação LIVE da Meta (mesma fonte do painel);
 *   - linha 2 (volume de recarga/depósito/dia): CRM `dashboard-metrics` (mesma fonte do ranking).
 *
 * Tudo via `/api/admin/meta/spend-vs-deposit-daily`.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { LineChart as LineChartIcon, RefreshCw, Loader2, AlertCircle } from 'lucide-react';

type ApiResponse = {
  success: boolean;
  data?: {
    period: { date_from: string; date_to: string; tz: string };
    banca_ids: string[];
    days: Array<{ date: string; spend: number; deposit: number }>;
    totals: { spend: number; deposit: number };
    deposit_failures: number;
  };
  error?: string;
};

export type SpendVsDepositChartProps = {
  userId: string;
  /** Escopo de bancas. Vazio = todas as bancas com gasto no período. */
  scopeBancaIds: string[];
  /** Carrega só quando true (default controlado pela página). */
  enabled: boolean;
};

const DEFAULT_TZ = 'America/Sao_Paulo';
/** Janela fixa do card. */
const WINDOW_DAYS = 7;

function formatBRL(value: number, fractionDigits: 0 | 2 = 0): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(Number.isFinite(value) ? value : 0);
}

/** YYYY-MM-DD → "dd/mm" para o eixo X. */
function shortDay(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  return m ? `${m[3]}/${m[2]}` : date;
}

/** "Hoje" em YYYY-MM-DD no fuso informado (dia civil BR). */
function todayYmd(tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** Janela [hoje-(WINDOW_DAYS-1) .. hoje], inclusiva, em YYYY-MM-DD. */
function lastWindowRange(tz: string): { dateFrom: string; dateTo: string } {
  const dateTo = todayYmd(tz);
  const end = new Date(`${dateTo}T00:00:00Z`).getTime();
  const start = end - (WINDOW_DAYS - 1) * 86400000;
  const dateFrom = new Date(start).toISOString().slice(0, 10);
  return { dateFrom, dateTo };
}

const SPEND_COLOR = '#EF4444'; // vermelho — custo
const DEPOSIT_COLOR = '#6AAE39'; // verde da marca — receita

export default function SpendVsDepositChart({ userId, scopeBancaIds, enabled }: SpendVsDepositChartProps) {
  const [data, setData] = useState<ApiResponse['data'] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scopeKey = useMemo(() => [...scopeBancaIds].sort().join(','), [scopeBancaIds]);
  const range = useMemo(() => lastWindowRange(DEFAULT_TZ), []);

  const load = useCallback(async () => {
    if (!userId || !enabled) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('date_from', range.dateFrom);
      params.set('date_to', range.dateTo);
      params.set('tz', DEFAULT_TZ);
      if (scopeBancaIds.length === 1) params.set('banca_id', scopeBancaIds[0]);
      else if (scopeBancaIds.length > 1) params.set('scope_banca_ids', scopeBancaIds.join(','));
      const res = await fetch(`/api/admin/meta/spend-vs-deposit-daily?${params.toString()}`, {
        headers: { 'X-User-Id': userId },
        cache: 'no-store',
      });
      const json = (await res.json()) as ApiResponse;
      if (!res.ok || !json.success || !json.data) {
        setError(json.error || `Falha ao carregar série diária (HTTP ${res.status}).`);
        setData(null);
        return;
      }
      setData(json.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar gráfico.');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [userId, enabled, range.dateFrom, range.dateTo, scopeBancaIds]);

  useEffect(() => {
    if (enabled) void load();
    // auto-carrega e refaz ao mudar escopo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, scopeKey]);

  const chartData = data?.days ?? [];
  const hasData = chartData.length > 0;

  return (
    <div className="rounded-2xl border border-gray-200 dark:border-[#404040] bg-white dark:bg-[#2a2a2a] p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-[#F1FAE8] dark:bg-emerald-950/40 flex items-center justify-center shrink-0">
            <LineChartIcon className="w-5 h-5 text-[#6AAE39] dark:text-emerald-400" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
              Gasto de Ads × Depósito (diário)
            </h3>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
              Últimos {WINDOW_DAYS} dias · {shortDay(range.dateFrom)} – {shortDay(range.dateTo)}
              {scopeBancaIds.length === 0 ? ' · Todas as bancas' : ` · ${scopeBancaIds.length} banca(s)`}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={!enabled || loading}
          className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-200 dark:border-[#404040] text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-[#333] disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          Atualizar
        </button>
      </div>

      {/* Totais do período */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="rounded-xl bg-red-50 dark:bg-red-950/30 px-3 py-2">
          <p className="text-[11px] font-medium text-red-600/80 dark:text-red-300/80">Gasto total</p>
          <p className="text-base font-bold text-red-600 dark:text-red-300">
            {loading && !data ? '—' : formatBRL(data?.totals.spend ?? 0, 2)}
          </p>
        </div>
        <div className="rounded-xl bg-[#F1FAE8] dark:bg-emerald-950/30 px-3 py-2">
          <p className="text-[11px] font-medium text-[#6AAE39] dark:text-emerald-300/80">Depósito total</p>
          <p className="text-base font-bold text-[#5a9730] dark:text-emerald-300">
            {loading && !data ? '—' : formatBRL(data?.totals.deposit ?? 0, 2)}
          </p>
        </div>
      </div>

      <div className="h-64 sm:h-72 w-full">
        {!enabled ? (
          <div className="h-full flex items-center justify-center text-sm text-gray-400 dark:text-gray-500">
            Aguardando…
          </div>
        ) : error ? (
          <div className="h-full flex flex-col items-center justify-center gap-2 text-sm text-red-500">
            <AlertCircle className="w-5 h-5" />
            <span className="text-center px-4">{error}</span>
          </div>
        ) : loading && !hasData ? (
          <div className="h-full flex items-center justify-center text-sm text-gray-400 dark:text-gray-500">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Carregando série diária…
          </div>
        ) : !hasData ? (
          <div className="h-full flex items-center justify-center text-sm text-gray-400 dark:text-gray-500">
            Sem dados no período.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#80808033" />
              <XAxis
                dataKey="date"
                tickFormatter={shortDay}
                tick={{ fontSize: 11, fill: '#9ca3af' }}
                minTickGap={16}
              />
              <YAxis
                tick={{ fontSize: 11, fill: '#9ca3af' }}
                width={64}
                tickFormatter={(v) => formatBRL(Number(v), 0)}
              />
              <Tooltip
                formatter={(value: number, name) => [
                  formatBRL(Number(value), 2),
                  name === 'spend' ? 'Gasto' : 'Depósito',
                ]}
                labelFormatter={(label) => `Dia ${shortDay(String(label))}`}
                contentStyle={{
                  borderRadius: 12,
                  border: '1px solid #40404040',
                  fontSize: 12,
                }}
              />
              <Legend
                formatter={(value) => (value === 'spend' ? 'Gasto de Ads' : 'Depósito')}
                wrapperStyle={{ fontSize: 12 }}
              />
              <Line
                type="monotone"
                dataKey="spend"
                stroke={SPEND_COLOR}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
              <Line
                type="monotone"
                dataKey="deposit"
                stroke={DEPOSIT_COLOR}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {data && data.deposit_failures > 0 ? (
        <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">
          {data.deposit_failures} consulta(s) de depósito falharam (CRM offline) — a linha de depósito pode estar subestimada.
        </p>
      ) : null}
    </div>
  );
}
