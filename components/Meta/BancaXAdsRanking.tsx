'use client';

/**
 * Ranking Diário — Banca x ADS (Conciliação).
 *
 * Consome `/api/admin/meta/banca-x-ads-ranking` e renderiza:
 *   - Cards de conciliação (Gasto, Depositado, ROI, ROAS médio).
 *   - Tabela ordenável com gasto LIVE Meta Ads + métricas operacionais da banca.
 *
 * Mostra apenas bancas com ads ativos no dia (campanhas com delivery_info=active).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Trophy,
  DollarSign,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  Loader2,
  AlertCircle,
  Wallet,
  Target,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Info,
} from 'lucide-react';

export type BancaXAdsRankingApiRow = {
  rank: number;
  banca_id: string;
  banca_name: string;
  banca_url: string;
  ads: {
    spend: number;
    active_campaigns: number;
    currency: string;
  };
  banca: {
    total_leads: number;
    total_deposited: number;
    total_bets: number;
    total_prizes: number;
    awarded_clients_count: number;
    active_leads: number;
    conversion_rate: number;
    ltv_avg: number;
    net_profit: number;
    available: boolean;
  };
  conciliacao: {
    roi_absoluto: number;
    roas: number | null;
    cpa_deposito: number | null;
    cobertura_gasto_pct: number | null;
    margem_pct: number | null;
    status: 'positivo' | 'atencao' | 'negativo' | 'sem_dados';
  };
};

export type BancaXAdsRankingApiResponse = {
  success: boolean;
  data?: {
    period: { date: string; date_from?: string; date_to?: string; tz: string };
    rows: BancaXAdsRankingApiRow[];
    totals: {
      spend_total: number;
      active_campaigns_total: number;
      leads_total: number;
      deposited_total: number;
      bets_total: number;
      prizes_total: number;
      roi_total: number;
      roas_medio: number | null;
      bancas_total: number;
      bancas_crm_indisponivel: number;
    };
  };
  error?: string;
};

type SortKey =
  | 'rank'
  | 'banca_name'
  | 'spend'
  | 'total_leads'
  | 'total_deposited'
  | 'roi_absoluto'
  | 'roas';
type SortDir = 'asc' | 'desc';

function formatBRL(value: number, fractionDigits: 0 | 2 = 0): string {
  const safe = Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(safe);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('pt-BR').format(Number.isFinite(value) ? value : 0);
}

function todayInTz(tz = 'America/Sao_Paulo'): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function statusBadge(status: BancaXAdsRankingApiRow['conciliacao']['status']) {
  switch (status) {
    case 'positivo':
      return {
        label: 'Lucro',
        bg: 'bg-emerald-50 dark:bg-emerald-900/30',
        text: 'text-emerald-700 dark:text-emerald-300',
        border: 'border-emerald-200 dark:border-emerald-800',
      };
    case 'atencao':
      return {
        label: 'Atenção',
        bg: 'bg-amber-50 dark:bg-amber-900/30',
        text: 'text-amber-700 dark:text-amber-300',
        border: 'border-amber-200 dark:border-amber-800',
      };
    case 'negativo':
      return {
        label: 'Prejuízo',
        bg: 'bg-red-50 dark:bg-red-900/30',
        text: 'text-red-700 dark:text-red-300',
        border: 'border-red-200 dark:border-red-800',
      };
    default:
      return {
        label: 'Sem dados',
        bg: 'bg-gray-100 dark:bg-gray-800/50',
        text: 'text-gray-500 dark:text-gray-400',
        border: 'border-gray-200 dark:border-gray-700',
      };
  }
}

function SortHeader({
  label,
  active,
  dir,
  onClick,
  align = 'left',
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
  align?: 'left' | 'right' | 'center';
}) {
  const Icon = !active ? ArrowUpDown : dir === 'desc' ? ArrowDown : ArrowUp;
  return (
    <th
      onClick={onClick}
      className={`px-3 py-2.5 font-bold text-[11px] uppercase tracking-wide select-none cursor-pointer transition-colors ${
        active
          ? 'text-[#6AAE39] dark:text-emerald-400'
          : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
      } text-${align}`}
    >
      <span className={`inline-flex items-center gap-1 ${align === 'right' ? 'justify-end w-full' : ''}`}>
        {label}
        <Icon className="w-3 h-3 shrink-0" />
      </span>
    </th>
  );
}

export default function BancaXAdsRanking({
  defaultDate,
  dateFrom,
  dateTo,
  refreshKey,
}: {
  defaultDate?: string;
  /** Início do range vindo do filtro global da página. Sobrepõe o picker interno. */
  dateFrom?: string | null;
  /** Fim do range. Se ausente e `dateFrom` vier, usa o próprio dateFrom (single day). */
  dateTo?: string | null;
  /**
   * Token que, quando muda, força o ranking a re-fetch. Use para sinalizar que
   * a atribuição de campanhas mudou (ex.: dropdown «Vincular banca» em métricas).
   */
  refreshKey?: number;
}) {
  /**
   * Resolve o range efetivo. Prioridade: filtro global (dateFrom/dateTo) > defaultDate > hoje.
   * Quando há range vindo da prop, o picker interno é só leitura.
   */
  const effectiveRange = useMemo<{ from: string; to: string; source: 'prop' | 'internal' }>(() => {
    const from = (dateFrom ?? '').trim() || null;
    const to = (dateTo ?? '').trim() || null;
    if (from || to) {
      const a = from || to || todayInTz();
      const b = to || from || a;
      return { from: a <= b ? a : b, to: a <= b ? b : a, source: 'prop' };
    }
    const single = defaultDate ?? todayInTz();
    return { from: single, to: single, source: 'internal' };
  }, [dateFrom, dateTo, defaultDate]);

  const [internalDate, setInternalDate] = useState<string>(defaultDate ?? todayInTz());
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<BancaXAdsRankingApiResponse['data'] | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('spend');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const isControlledByProp = effectiveRange.source === 'prop';
  const queryFrom = isControlledByProp ? effectiveRange.from : internalDate;
  const queryTo = isControlledByProp ? effectiveRange.to : internalDate;
  const isRange = queryFrom !== queryTo;

  const load = useCallback(async (from: string, to: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('date_from', from);
      params.set('date_to', to);
      const res = await fetch(
        `/api/admin/meta/banca-x-ads-ranking?${params.toString()}`,
        { method: 'GET', cache: 'no-store' }
      );
      const json = (await res.json()) as BancaXAdsRankingApiResponse;
      if (!res.ok || !json.success || !json.data) {
        throw new Error(json.error || `Falha (${res.status})`);
      }
      setData(json.data);
    } catch (err: any) {
      setError(err?.message || 'Erro ao carregar ranking.');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(queryFrom, queryTo);
  }, [queryFrom, queryTo, load, refreshKey]);

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'banca_name' || key === 'rank' ? 'asc' : 'desc');
    }
  };

  const sortedRows = useMemo<BancaXAdsRankingApiRow[]>(() => {
    const rows = data?.rows ? [...data.rows] : [];
    const dir = sortDir === 'desc' ? -1 : 1;
    const numericFallback = (v: number | null | undefined) =>
      v == null || !Number.isFinite(v) ? -Infinity * dir : (v as number);

    const getValue = (r: BancaXAdsRankingApiRow): number | string => {
      switch (sortKey) {
        case 'rank':
          return r.rank;
        case 'banca_name':
          return (r.banca_name || '').toLowerCase();
        case 'spend':
          return r.ads.spend;
        case 'total_leads':
          return r.banca.total_leads;
        case 'total_deposited':
          return r.banca.total_deposited;
        case 'roi_absoluto':
          return r.conciliacao.roi_absoluto;
        case 'roas':
          return numericFallback(r.conciliacao.roas);
        default:
          return 0;
      }
    };

    rows.sort((a, b) => {
      const va = getValue(a);
      const vb = getValue(b);
      if (typeof va === 'string' && typeof vb === 'string') {
        return va.localeCompare(vb) * dir;
      }
      return ((va as number) - (vb as number)) * dir;
    });
    return rows;
  }, [data, sortKey, sortDir]);

  const totals = data?.totals;

  return (
    <div className="bg-white dark:bg-[#2a2a2a] rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-4 sm:p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-amber-50 dark:bg-amber-900/30 rounded-xl">
            <Trophy className="w-5 h-5 text-amber-600 dark:text-amber-400" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
              Ranking Diário — Banca x ADS (Conciliação)
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Campanhas vinculadas a bancas em «Métricas de Campanhas», ordenadas por gasto. Gasto LIVE do Meta Graph cruzado com métricas do CRM.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {isControlledByProp ? (
            <span
              className="inline-flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2"
              title="Período herdado do filtro de data no topo da página"
            >
              <span className="font-medium">Período:</span>
              <span className="tabular-nums text-gray-800 dark:text-gray-200">
                {isRange ? `${queryFrom} → ${queryTo}` : queryFrom}
              </span>
            </span>
          ) : (
            <label className="flex items-center gap-2 text-sm">
              <span className="text-gray-600 dark:text-gray-400 font-medium">Data:</span>
              <input
                type="date"
                value={internalDate}
                max={todayInTz()}
                onChange={(e) => setInternalDate(e.target.value)}
                className="px-3 py-2 border border-gray-200 dark:border-[#404040] rounded-xl text-sm text-gray-800 dark:text-gray-100 bg-white dark:bg-[#2a2a2a]"
              />
            </label>
          )}
          <button
            type="button"
            onClick={() => load(queryFrom, queryTo)}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-2 bg-[#8CD955] hover:bg-[#7AC444] disabled:bg-gray-300 dark:disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-xl font-medium text-sm transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'Atualizando…' : 'Atualizar'}
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-xl text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Cards de Conciliação */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <ConciliacaoCard
          label="Gasto Total"
          value={loading ? null : formatBRL(totals?.spend_total ?? 0)}
          icon={<DollarSign className="w-4 h-4" />}
          tone="neutral"
          info={{
            title: 'Como calculamos o Gasto Total',
            formula: 'Σ spend das campanhas vinculadas em Métricas de Campanhas',
            description:
              'Soma o gasto LIVE de todas as campanhas (ativas ou pausadas que gastaram) que têm vínculo em meta_campaigns, vindo direto do Meta Graph API. A banca é sempre o meta_campaigns.banca_id mostrado em Métricas de Campanhas.',
          }}
        />
        <ConciliacaoCard
          label="Depositado"
          value={loading ? null : formatBRL(totals?.deposited_total ?? 0)}
          icon={<Wallet className="w-4 h-4" />}
          tone="info"
          info={{
            title: 'Como calculamos o Depositado',
            formula: 'Σ total_deposited por banca no dia',
            description:
              'Soma o total depositado pelos clientes em cada banca no dia selecionado. Dados vindos do CRM de cada banca via /api/crm/dashboard-metrics (mesma fonte do Resumo Geral).',
          }}
        />
        <ConciliacaoCard
          label="ROI (saldo)"
          value={loading ? null : formatBRL(totals?.roi_total ?? 0)}
          icon={(totals?.roi_total ?? 0) >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
          tone={(totals?.roi_total ?? 0) >= 0 ? 'success' : 'danger'}
          info={{
            title: 'Como calculamos o ROI',
            formula: 'ROI = Total Depositado − Gasto Ads',
            description:
              'Saldo absoluto em reais. Positivo = lucro (depósitos cobriram o gasto e sobrou). Negativo = prejuízo (gasto maior que o retorno em depósitos).',
            examples: [
              'Gasto R$ 100 + Depositado R$ 300 → ROI = +R$ 200 (lucro).',
              'Gasto R$ 500 + Depositado R$ 200 → ROI = −R$ 300 (prejuízo).',
            ],
          }}
        />
        <ConciliacaoCard
          label="ROAS médio"
          value={
            loading
              ? null
              : totals?.roas_medio != null
                ? `${totals.roas_medio.toFixed(2)}x`
                : '—'
          }
          icon={<Target className="w-4 h-4" />}
          tone={
            totals?.roas_medio == null
              ? 'neutral'
              : totals.roas_medio >= 1
                ? 'success'
                : totals.roas_medio >= 0.5
                  ? 'warning'
                  : 'danger'
          }
          info={{
            title: 'Como calculamos o ROAS',
            formula: 'ROAS = Total Depositado ÷ Gasto Ads',
            description:
              'Multiplicador de retorno sobre investimento em ads. Indica quantos reais retornaram em depósitos para cada R$1 gasto. ROAS médio usa os totais consolidados (não a média simples das bancas).',
            examples: [
              'ROAS 2,5x → cada R$1 gasto retornou R$2,50.',
              '≥1,0x: lucro · 0,5–1,0x: atenção · <0,5x: prejuízo.',
            ],
          }}
        />
      </div>

      {/* Tabela */}
      <div className="overflow-x-auto rounded-xl border border-gray-100 dark:border-gray-700">
        <table className="w-full min-w-[1080px] text-sm border-collapse">
          <thead className="bg-gray-50/80 dark:bg-gray-800/60 sticky top-0 z-10">
            <tr className="border-b border-gray-200 dark:border-gray-700">
              <SortHeader label="#" active={sortKey === 'rank'} dir={sortDir} onClick={() => handleSort('rank')} />
              <SortHeader label="Banca" active={sortKey === 'banca_name'} dir={sortDir} onClick={() => handleSort('banca_name')} />
              <SortHeader label="Gasto Ads" active={sortKey === 'spend'} dir={sortDir} onClick={() => handleSort('spend')} align="right" />
              <SortHeader label="Total de Leads" active={sortKey === 'total_leads'} dir={sortDir} onClick={() => handleSort('total_leads')} align="right" />
              <SortHeader label="Depositado" active={sortKey === 'total_deposited'} dir={sortDir} onClick={() => handleSort('total_deposited')} align="right" />
              <SortHeader label="ROI" active={sortKey === 'roi_absoluto'} dir={sortDir} onClick={() => handleSort('roi_absoluto')} align="right" />
              <SortHeader label="ROAS" active={sortKey === 'roas'} dir={sortDir} onClick={() => handleSort('roas')} align="right" />
              <th className="px-3 py-2.5 font-bold text-[11px] uppercase tracking-wide text-gray-600 dark:text-gray-400 text-center">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading && !data && (
              <tr>
                <td colSpan={8} className="px-3 py-10 text-center text-gray-500 dark:text-gray-400">
                  <Loader2 className="w-5 h-5 inline animate-spin mr-2" />
                  Carregando ranking…
                </td>
              </tr>
            )}
            {!loading && sortedRows.length === 0 && !error && (
              <tr>
                <td colSpan={8} className="px-3 py-10 text-center text-gray-500 dark:text-gray-400">
                  Nenhuma campanha vinculada em Métricas de Campanhas com gasto no período.
                </td>
              </tr>
            )}
            {sortedRows.map((r) => {
              const badge = statusBadge(r.conciliacao.status);
              return (
                <tr
                  key={r.banca_id}
                  className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50/50 dark:hover:bg-gray-700/30"
                >
                  <td className="px-3 py-2.5 font-bold text-gray-800 dark:text-gray-100">{r.rank}</td>
                  <td className="px-3 py-2.5">
                    <div className="font-medium text-gray-900 dark:text-gray-100">{r.banca_name}</div>
                    <div className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500">
                      {r.ads.active_campaigns} campanha{r.ads.active_campaigns === 1 ? '' : 's'} vinculada{r.ads.active_campaigns === 1 ? '' : 's'}
                    </div>
                    {!r.banca.available && (
                      <div className="text-[10px] uppercase tracking-wide text-amber-600 dark:text-amber-400">
                        CRM indisponível
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right text-gray-800 dark:text-gray-200">
                    {formatBRL(r.ads.spend, 2)}
                  </td>
                  <td className="px-3 py-2.5 text-right text-gray-800 dark:text-gray-200">
                    {r.banca.available ? formatNumber(r.banca.total_leads) : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-right text-gray-800 dark:text-gray-200">
                    {r.banca.available ? formatBRL(r.banca.total_deposited) : '—'}
                  </td>
                  <td
                    className={`px-3 py-2.5 text-right font-semibold ${
                      r.conciliacao.roi_absoluto >= 0
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-red-600 dark:text-red-400'
                    }`}
                  >
                    {!r.banca.available && r.ads.spend === 0 ? '—' : formatBRL(r.conciliacao.roi_absoluto, 2)}
                  </td>
                  <td className="px-3 py-2.5 text-right text-gray-800 dark:text-gray-200">
                    {r.conciliacao.roas != null ? `${r.conciliacao.roas.toFixed(2)}x` : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <span
                      className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide border ${badge.bg} ${badge.text} ${badge.border}`}
                    >
                      {badge.label}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
          {totals && sortedRows.length > 0 && (
            <tfoot className="bg-gray-50/80 dark:bg-gray-800/60 sticky bottom-0">
              <tr className="border-t-2 border-gray-200 dark:border-gray-700 font-bold">
                <td className="px-3 py-2.5 text-gray-700 dark:text-gray-200" colSpan={2}>
                  Totais ({totals.bancas_total} bancas)
                </td>
                <td className="px-3 py-2.5 text-right text-gray-900 dark:text-gray-100">{formatBRL(totals.spend_total, 2)}</td>
                <td className="px-3 py-2.5 text-right text-gray-900 dark:text-gray-100">{formatNumber(totals.leads_total)}</td>
                <td className="px-3 py-2.5 text-right text-gray-900 dark:text-gray-100">{formatBRL(totals.deposited_total)}</td>
                <td
                  className={`px-3 py-2.5 text-right ${
                    totals.roi_total >= 0
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-red-600 dark:text-red-400'
                  }`}
                >
                  {formatBRL(totals.roi_total, 2)}
                </td>
                <td className="px-3 py-2.5 text-right text-gray-900 dark:text-gray-100">
                  {totals.roas_medio != null ? `${totals.roas_medio.toFixed(2)}x` : '—'}
                </td>
                <td className="px-3 py-2.5 text-center text-[10px] text-gray-500 dark:text-gray-400">
                  {totals.active_campaigns_total} campanha{totals.active_campaigns_total === 1 ? '' : 's'}
                  {totals.bancas_crm_indisponivel > 0 ? ` · ${totals.bancas_crm_indisponivel} CRM off` : ''}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {data?.period && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Período:{' '}
          <strong>
            {data.period.date_from && data.period.date_to && data.period.date_from !== data.period.date_to
              ? `${data.period.date_from} → ${data.period.date_to}`
              : data.period.date}
          </strong>{' '}
          ({data.period.tz}). Gasto Ads vindo do{' '}
          <strong>Meta Graph API</strong> (LIVE, todas as campanhas com spend no período, atribuídas via{' '}
          <code className="text-[11px]">meta_campaigns.banca_id</code>).
          Métricas da banca vindas de <code className="text-[11px]">/api/crm/dashboard-metrics</code>.
        </p>
      )}
    </div>
  );
}

type ConciliacaoCardInfo = {
  title: string;
  formula: string;
  description: string;
  examples?: string[];
};

function ConciliacaoCard({
  label,
  value,
  icon,
  tone,
  info,
}: {
  label: string;
  value: string | null;
  icon: React.ReactNode;
  tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger';
  info?: ConciliacaoCardInfo;
}) {
  const toneClasses: Record<typeof tone, string> = {
    neutral: 'bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200',
    info: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300',
    success: 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300',
    warning: 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300',
    danger: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300',
  };

  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [open]);

  return (
    <div ref={popoverRef} className={`relative rounded-xl border p-3 ${toneClasses[tone]}`}>
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-2 opacity-90 min-w-0">
          {icon}
          <p className="text-[10px] font-bold uppercase tracking-wide truncate">{label}</p>
        </div>
        {info && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setOpen((v) => !v);
            }}
            aria-label={`Como calculamos: ${label}`}
            title={info.title}
            className={`shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full border transition-colors ${
              open
                ? 'bg-current text-white dark:text-gray-900 border-current'
                : 'border-current opacity-60 hover:opacity-100'
            }`}
          >
            <Info className="w-3 h-3" />
          </button>
        )}
      </div>
      <p className="text-lg font-bold min-h-[1.75rem] flex items-center">
        {value == null ? <span className="inline-block h-5 w-20 bg-current opacity-20 rounded animate-pulse" /> : value}
      </p>

      {open && info && (
        <div
          role="dialog"
          aria-label={info.title}
          className="absolute z-30 top-full right-0 mt-2 w-72 sm:w-80 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#1f1f1f] shadow-xl p-3 text-left"
        >
          <p className="text-[11px] font-bold uppercase tracking-wide text-gray-700 dark:text-gray-200 mb-1">
            {info.title}
          </p>
          <code className="block text-[12px] font-mono px-2 py-1.5 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-100 mb-2 break-words">
            {info.formula}
          </code>
          <p className="text-[12px] leading-snug text-gray-600 dark:text-gray-300">
            {info.description}
          </p>
          {info.examples && info.examples.length > 0 && (
            <ul className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-700 space-y-1 text-[11px] leading-snug text-gray-500 dark:text-gray-400">
              {info.examples.map((ex, i) => (
                <li key={i} className="flex gap-1">
                  <span className="opacity-60">·</span>
                  <span>{ex}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
