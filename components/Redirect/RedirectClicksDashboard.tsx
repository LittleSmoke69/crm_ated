'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Loader2 } from 'lucide-react';

type Preset = 'today' | 'yesterday' | '7d' | '30d' | 'month';

interface AnalyticsPayload {
  current: {
    total: number;
    by_day: Record<string, number>;
    by_hour_of_day: number[];
    by_group: { group_id: string; name: string; count: number }[];
  };
  previous: {
    total: number;
    by_day: Record<string, number>;
    by_hour_of_day: number[];
    by_group: { group_id: string; name: string; count: number }[];
  } | null;
  range: { from: string; to: string };
  previous_range: { from: string; to: string } | null;
}

function boundsForPreset(preset: Preset): { from: Date; to: Date } {
  const now = new Date();
  const startOfLocalDay = (d: Date) => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  };
  const endOfLocalDay = (d: Date) => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    x.setDate(x.getDate() + 1);
    return x;
  };

  switch (preset) {
    case 'today': {
      const s = startOfLocalDay(now);
      return { from: s, to: endOfLocalDay(now) };
    }
    case 'yesterday': {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      return { from: startOfLocalDay(y), to: endOfLocalDay(y) };
    }
    case '7d': {
      const s = startOfLocalDay(now);
      s.setDate(s.getDate() - 6);
      return { from: s, to: endOfLocalDay(now) };
    }
    case '30d': {
      const s = startOfLocalDay(now);
      s.setDate(s.getDate() - 29);
      return { from: s, to: endOfLocalDay(now) };
    }
    case 'month': {
      const s = new Date(now.getFullYear(), now.getMonth(), 1);
      const t = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      return { from: s, to: t };
    }
    default:
      return { from: startOfLocalDay(now), to: endOfLocalDay(now) };
  }
}

const PRESET_LABELS: Record<Preset, string> = {
  today: 'Hoje',
  yesterday: 'Ontem',
  '7d': 'Últimos 7 dias',
  '30d': 'Últimos 30 dias',
  month: 'Este mês',
};

function dayKeysBetween(fromIso: string, toIso: string): string[] {
  const out: string[] = [];
  const end = new Date(toIso).getTime();
  let t = new Date(fromIso).getTime();
  const step = 86400000;
  const seen = new Set<string>();
  while (t < end) {
    const key = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(t));
    if (!seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
    t += step;
  }
  return out;
}

/** Chave yyyy-mm-dd (calendário do redirect) → rótulos em pt-BR (âncora -03:00 = horário de Brasília). */
function labelsForDayKey(key: string): { chartTick: string; tableTitle: string; tableSubtitle: string } {
  const parts = key.split('-').map(Number);
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  if (!y || !m || !d) {
    return { chartTick: key, tableTitle: key, tableSubtitle: '' };
  }
  const anchor = new Date(`${key}T12:00:00-03:00`);
  const weekdayShort = anchor.toLocaleDateString('pt-BR', { weekday: 'short' });
  const weekdayLong = anchor.toLocaleDateString('pt-BR', { weekday: 'long' });
  const dayMonth = anchor.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
  const full = anchor.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
  return {
    chartTick: `${weekdayShort.replace(/\./g, '')} ${dayMonth}`.replace(/\s+/g, ' ').trim(),
    tableTitle: full,
    tableSubtitle: weekdayLong,
  };
}

export default function RedirectClicksDashboard({
  projectId,
  userId,
  redirectSlug,
}: {
  projectId: string | null;
  userId: string | null;
  redirectSlug: string | null;
}) {
  const [preset, setPreset] = useState<Preset>('7d');
  const [compare, setCompare] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AnalyticsPayload | null>(null);

  const load = useCallback(async () => {
    if (!projectId || !userId) return;
    const { from, to } = boundsForPreset(preset);
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        project_id: projectId,
        from: from.toISOString(),
        to: to.toISOString(),
        compare: compare ? '1' : '0',
      });
      const r = await fetch(`/api/admin/redirect/clicks-analytics?${qs}`, {
        headers: { 'X-User-Id': userId },
      });
      const j = await r.json();
      if (!j?.success) {
        setError(typeof j?.error === 'string' ? j.error : 'Erro ao carregar analytics');
        setData(null);
        return;
      }
      setData(j.data as AnalyticsPayload);
    } catch {
      setError('Falha de rede');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [projectId, userId, preset, compare]);

  useEffect(() => {
    void load();
  }, [load]);

  const dayChartData = useMemo(() => {
    if (!data?.current) return [];
    const keys = dayKeysBetween(data.range.from, data.range.to);
    const prevKeys =
      compare && data.previous && data.previous_range
        ? dayKeysBetween(data.previous_range.from, data.previous_range.to)
        : [];
    return keys.map((day, i) => {
      const { chartTick } = labelsForDayKey(day);
      const row: Record<string, string | number> = {
        day: chartTick,
        dayKey: day,
        fullDay: day,
        atual: data.current.by_day[day] ?? 0,
      };
      if (compare && data.previous?.by_day && prevKeys.length > 0) {
        const pDay = prevKeys[i];
        row.anterior = pDay ? data.previous.by_day[pDay] ?? 0 : 0;
      }
      return row;
    });
  }, [data, compare]);

  const dayDetailRows = useMemo(() => {
    if (!data?.current || dayChartData.length === 0) return [];
    const total = data.current.total;
    const counts = dayChartData.map((r) => Number(r.atual) || 0);
    const max = Math.max(1, ...counts);
    return [...dayChartData]
      .map((r) => {
        const key = String(r.fullDay);
        const n = Number(r.atual) || 0;
        const { tableTitle, tableSubtitle } = labelsForDayKey(key);
        const pct = total > 0 ? Math.round((n / total) * 1000) / 10 : 0;
        return {
          dayKey: key,
          tableTitle,
          tableSubtitle,
          cliques: n,
          pct,
          barPct: Math.round((n / max) * 100),
          anterior: compare ? Number(r.anterior) || 0 : null,
        };
      })
      .sort((a, b) => b.dayKey.localeCompare(a.dayKey));
  }, [data, dayChartData, compare]);

  const daySummary = useMemo(() => {
    if (!data?.current) return null;
    const n = dayDetailRows.length;
    const total = data.current.total;
    if (n === 0) return { avg: 0, peak: 0, peakDay: '', peakLabel: '' };
    const avg = Math.round((total / n) * 10) / 10;
    let peak = 0;
    let peakDay = '';
    for (const row of dayDetailRows) {
      if (row.cliques > peak) {
        peak = row.cliques;
        peakDay = row.dayKey;
      }
    }
    const peakLabel = peakDay ? labelsForDayKey(peakDay).tableTitle : '';
    return { avg, peak, peakDay, peakLabel };
  }, [data, dayDetailRows]);

  const hourChartData = useMemo(() => {
    if (!data?.current?.by_hour_of_day) return [];
    return data.current.by_hour_of_day.map((count, h) => ({
      hora: `${h}h`,
      h,
      cliques: count,
    }));
  }, [data]);

  const groupBarData = useMemo(() => {
    const list = data?.current?.by_group ?? [];
    return list.map((g) => ({
      nome: g.name.length > 22 ? `${g.name.slice(0, 20)}…` : g.name,
      fullName: g.name,
      cliques: g.count,
    }));
  }, [data]);
  const groupChartHeight = Math.max(288, groupBarData.length * 34);

  if (!projectId) return null;

  return (
    <section className="lg:col-span-3 bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-[#404040] rounded-xl shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 dark:border-[#404040] flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-semibold text-gray-800 dark:text-white">Cliques no redirect</h2>
          <p className="text-xs text-gray-500 dark:text-[#aaa] mt-0.5">
            Volume de cliques em <span className="font-mono">/r/{redirectSlug ?? '…'}</span> (por dia, hora e grupo). Períodos usam o fuso do seu navegador.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(Object.keys(PRESET_LABELS) as Preset[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPreset(p)}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition ${
                preset === p
                  ? 'bg-[#8CD955] text-white'
                  : 'bg-gray-100 dark:bg-[#333] text-gray-700 dark:text-[#ccc] hover:bg-gray-200 dark:hover:bg-[#404040]'
              }`}
            >
              {PRESET_LABELS[p]}
            </button>
          ))}
          <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-[#aaa] cursor-pointer select-none ml-1">
            <input
              type="checkbox"
              checked={compare}
              onChange={(e) => setCompare(e.target.checked)}
              className="w-3.5 h-3.5 rounded border-gray-300 dark:border-[#555] text-[#8CD955] focus:ring-[#8CD955]"
            />
            Comparar período anterior
          </label>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-700 dark:bg-[#3d3d3d] text-white hover:opacity-90 disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin inline" /> : 'Atualizar'}
          </button>
        </div>
      </div>

      <div className="p-4 space-y-6">
        {error && (
          <p className="text-sm text-red-600 dark:text-red-400" role="alert">
            {error}
          </p>
        )}

        {loading && !data ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
          </div>
        ) : data ? (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="bg-gray-50 dark:bg-[#333] rounded-lg p-3 border border-gray-100 dark:border-[#404040]">
                <p className="text-xs text-gray-500 dark:text-[#aaa]">Total no período</p>
                <p className="text-xl font-bold text-gray-800 dark:text-white">{data.current.total.toLocaleString('pt-BR')}</p>
                {daySummary && dayDetailRows.length > 1 && (
                  <p className="text-[11px] text-gray-500 dark:text-[#888] mt-1 leading-snug">
                    Média <span className="font-semibold text-gray-700 dark:text-[#ccc]">{daySummary.avg.toLocaleString('pt-BR')}</span>
                    /dia · Pico{' '}
                    <span className="font-semibold text-gray-700 dark:text-[#ccc]">{daySummary.peak.toLocaleString('pt-BR')}</span>
                    {daySummary.peakLabel ? ` (${daySummary.peakLabel})` : ''}
                  </p>
                )}
              </div>
              {compare && data.previous && (
                <>
                  <div className="bg-gray-50 dark:bg-[#333] rounded-lg p-3 border border-gray-100 dark:border-[#404040]">
                    <p className="text-xs text-gray-500 dark:text-[#aaa]">Período anterior</p>
                    <p className="text-xl font-bold text-gray-600 dark:text-[#ccc]">{data.previous.total.toLocaleString('pt-BR')}</p>
                  </div>
                  <div className="bg-gray-50 dark:bg-[#333] rounded-lg p-3 border border-gray-100 dark:border-[#404040] col-span-2 sm:col-span-2">
                    <p className="text-xs text-gray-500 dark:text-[#aaa]">Variação</p>
                    <p className={`text-xl font-bold ${varDelta(data.current.total, data.previous.total) >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                      {formatDelta(data.current.total, data.previous.total)}
                    </p>
                  </div>
                </>
              )}
            </div>

            <div>
              <h3 className="text-sm font-semibold text-gray-800 dark:text-white mb-1">Cliques por dia</h3>
              <p className="text-xs text-gray-500 dark:text-[#aaa] mb-3">
                Datas no fuso <span className="font-medium text-gray-600 dark:text-[#bbb]">America/São_Paulo</span>, alinhadas ao gráfico e à tabela.
              </p>
              <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
                <div className="xl:col-span-3 h-64 w-full min-w-0 order-1">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={dayChartData}
                      margin={{ top: 8, right: 8, left: 4, bottom: dayChartData.length > 10 ? 28 : 8 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" className="dark:stroke-gray-600" />
                      <XAxis
                        dataKey="day"
                        tick={{ fontSize: 10 }}
                        interval={dayChartData.length > 12 ? 'preserveStartEnd' : 0}
                        angle={dayChartData.length > 6 ? -32 : 0}
                        textAnchor={dayChartData.length > 6 ? 'end' : 'middle'}
                        height={dayChartData.length > 6 ? 52 : 28}
                      />
                      <YAxis tick={{ fontSize: 11 }} allowDecimals={false} width={36} />
                      <Tooltip
                        contentStyle={{ borderRadius: 8 }}
                        labelFormatter={(_, payload) => {
                          const p = payload?.[0]?.payload as { fullDay?: string } | undefined;
                          const k = p?.fullDay;
                          return k ? labelsForDayKey(k).tableTitle : '';
                        }}
                        formatter={(v: number | string, name: string) => [
                          Number(v).toLocaleString('pt-BR'),
                          name === 'atual' ? 'Período atual' : name === 'anterior' ? 'Período anterior' : String(name),
                        ]}
                      />
                      <Legend />
                      <Bar dataKey="atual" name="Período atual" fill="#8CD955" radius={[4, 4, 0, 0]} />
                      {compare && <Bar dataKey="anterior" name="Período anterior" fill="#94a3b8" radius={[4, 4, 0, 0]} />}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="xl:col-span-2 order-2 border border-gray-200 dark:border-[#404040] rounded-xl overflow-hidden bg-gray-50/50 dark:bg-[#252525]">
                  <div className="px-3 py-2 border-b border-gray-200 dark:border-[#404040] bg-gray-100/80 dark:bg-[#333]">
                    <p className="text-xs font-semibold text-gray-700 dark:text-[#ccc]">Detalhamento por dia</p>
                    <p className="text-[10px] text-gray-500 dark:text-[#888]">% em relação ao total do período</p>
                  </div>
                  <div className="max-h-64 overflow-y-auto overscroll-contain">
                    {dayDetailRows.length === 0 ? (
                      <p className="p-3 text-xs text-gray-500 dark:text-[#888]">Sem cliques neste intervalo.</p>
                    ) : (
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 z-[1] bg-white dark:bg-[#2a2a2a] shadow-sm">
                          <tr className="text-left text-[10px] uppercase tracking-wide text-gray-500 dark:text-[#888] border-b border-gray-100 dark:border-[#404040]">
                            <th className="px-3 py-2 font-medium">Data</th>
                            <th className="px-2 py-2 font-medium text-right w-16">Cliques</th>
                            <th className="px-2 py-2 font-medium text-right w-14">%</th>
                          </tr>
                        </thead>
                        <tbody>
                          {dayDetailRows.map((row) => (
                            <tr
                              key={row.dayKey}
                              className="border-t border-gray-100 dark:border-[#404040] hover:bg-white/80 dark:hover:bg-[#333]/60"
                            >
                              <td className="px-3 py-2 align-middle">
                                <p className="text-gray-800 dark:text-white font-medium leading-tight text-xs">{row.tableTitle}</p>
                                <p className="text-[10px] text-gray-500 dark:text-[#888] capitalize">{row.tableSubtitle}</p>
                                <div
                                  className="mt-1.5 h-1.5 rounded-full bg-gray-200 dark:bg-[#444] overflow-hidden max-w-[140px]"
                                  title={`${row.barPct}% do maior dia`}
                                >
                                  <div
                                    className="h-full rounded-full bg-[#8CD955]/90"
                                    style={{ width: `${row.barPct}%` }}
                                  />
                                </div>
                              </td>
                              <td className="px-2 py-2 text-right tabular-nums font-semibold text-gray-800 dark:text-white text-xs">
                                {row.cliques.toLocaleString('pt-BR')}
                                {compare && row.anterior !== null && (
                                  <span className="block text-[10px] font-normal text-gray-500 dark:text-[#888]">
                                    ant.: {row.anterior.toLocaleString('pt-BR')}
                                  </span>
                                )}
                              </td>
                              <td className="px-2 py-2 text-right tabular-nums text-gray-600 dark:text-[#aaa] text-xs">
                                {data.current.total > 0 ? `${row.pct.toLocaleString('pt-BR')}%` : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-gray-800 dark:text-white mb-2">
                Distribuição por hora do dia (America/São Paulo)
              </h3>
              <p className="text-xs text-gray-500 dark:text-[#aaa] mb-2">Soma de todos os cliques do período, agrupados pela hora em que ocorreram (0–23h).</p>
              <div className="h-56 w-full min-w-0">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={hourChartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200 dark:stroke-gray-600" />
                    <XAxis dataKey="hora" tick={{ fontSize: 10 }} interval={2} />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <Tooltip formatter={(v: number | string) => [Number(v).toLocaleString('pt-BR'), 'Cliques']} />
                    <Line type="monotone" dataKey="cliques" name="Cliques" stroke="#8CD955" strokeWidth={2} dot={{ r: 2 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {groupBarData.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-gray-800 dark:text-white mb-2">Por grupo</h3>
                <div className="w-full min-w-0" style={{ height: groupChartHeight }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={groupBarData} layout="vertical" margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200 dark:stroke-gray-600" />
                      <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                      <YAxis type="category" dataKey="nome" width={100} tick={{ fontSize: 10 }} />
                      <Tooltip
                        formatter={(v: number | string) => [Number(v).toLocaleString('pt-BR'), 'Cliques']}
                        labelFormatter={(_, payload) => {
                          const p = payload?.[0]?.payload as { fullName?: string } | undefined;
                          return p?.fullName ?? '';
                        }}
                      />
                      <Bar dataKey="cliques" name="Cliques" fill="#22c55e" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </>
        ) : null}
      </div>
    </section>
  );
}

function varDelta(cur: number, prev: number): number {
  if (prev === 0) return cur > 0 ? 100 : 0;
  return Math.round(((cur - prev) / prev) * 1000) / 10;
}

function formatDelta(cur: number, prev: number): string {
  if (prev === 0 && cur === 0) return '0%';
  if (prev === 0) return `+${cur.toLocaleString('pt-BR')} (sem base anterior)`;
  const pct = varDelta(cur, prev);
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct}% (${sign}${(cur - prev).toLocaleString('pt-BR')} cliques)`;
}

