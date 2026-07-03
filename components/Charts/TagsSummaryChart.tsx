'use client';

import React, { useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';

export interface TagUsageItem {
  consultorId: string;
  consultorName: string;
  tags: Array<{
    id: string;
    label: string;
    color: string;
    count: number;
  }>;
}

interface TagsSummaryChartProps {
  tagUsage: TagUsageItem[];
  /** Número máximo de etiquetas no gráfico de "mais usadas" */
  maxTags?: number;
  /** Número máximo de consultores no gráfico */
  maxConsultores?: number;
}

/** Agrega uso global por etiqueta (soma de todos os consultores) */
function aggregateTagsUsage(tagUsage: TagUsageItem[]) {
  const byTag: Record<string, { label: string; color: string; count: number }> = {};
  tagUsage.forEach((item) => {
    item.tags.forEach((tag) => {
      if (!byTag[tag.id]) {
        byTag[tag.id] = { label: tag.label, color: tag.color, count: 0 };
      }
      byTag[tag.id].count += tag.count;
    });
  });
  return Object.entries(byTag).map(([id, { label, color, count }]) => ({
    id,
    name: label,
    color,
    count,
  }));
}

/** Total de etiquetas aplicadas por consultor */
function consultantTotals(tagUsage: TagUsageItem[]) {
  return tagUsage.map((item) => {
    const total = item.tags.reduce((acc, t) => acc + t.count, 0);
    return {
      consultorId: item.consultorId,
      name: item.consultorName,
      total,
    };
  });
}

export default function TagsSummaryChart({
  tagUsage,
  maxTags = 10,
  maxConsultores = 15,
}: TagsSummaryChartProps) {
  const tagsChartData = useMemo(() => {
    const aggregated = aggregateTagsUsage(tagUsage);
    return aggregated
      .sort((a, b) => b.count - a.count)
      .slice(0, maxTags);
  }, [tagUsage, maxTags]);

  const allConsultoresTotals = useMemo(() => {
    return consultantTotals(tagUsage).sort((a, b) => b.total - a.total);
  }, [tagUsage]);

  const consultoresChartData = useMemo(() => {
    return allConsultoresTotals
      .slice(0, maxConsultores)
      .map((item) => ({
        name: item.name.length > 18 ? item.name.slice(0, 16) + '…' : item.name,
        total: item.total,
        fullName: item.name,
      }));
  }, [allConsultoresTotals, maxConsultores]);

  const hasTagsData = tagsChartData.length > 0;
  const hasConsultoresData = consultoresChartData.length > 0;
  const mostUsedConsultor = allConsultoresTotals[0]?.name ?? null;
  const leastUsedConsultor = allConsultoresTotals.length > 1
    ? allConsultoresTotals[allConsultoresTotals.length - 1]?.name ?? null
    : null;

  if (!hasTagsData && !hasConsultoresData) {
    return null;
  }

  return (
    <div className="space-y-6">
      {/* Resumo em texto: quem mais usa e quem menos usa */}
      {hasConsultoresData && (mostUsedConsultor || leastUsedConsultor) && (
        <div className="flex flex-wrap gap-4 text-sm">
          {mostUsedConsultor && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[#E86A2415] dark:bg-[#E86A2425] border border-[#E86A24]/30">
              <span className="font-bold text-gray-600 dark:text-gray-400">Mais etiquetas:</span>
              <span className="font-bold text-[#E86A24] truncate max-w-[200px]" title={mostUsedConsultor}>
                {mostUsedConsultor}
              </span>
            </div>
          )}
          {leastUsedConsultor && mostUsedConsultor !== leastUsedConsultor && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-600">
              <span className="font-bold text-gray-600 dark:text-gray-400">Menos etiquetas:</span>
              <span className="font-bold text-gray-700 dark:text-gray-200 truncate max-w-[200px]" title={leastUsedConsultor}>
                {leastUsedConsultor}
              </span>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Gráfico: Etiquetas mais usadas */}
        {hasTagsData && (
          <div className="bg-gray-50/50 dark:bg-gray-800/50 p-4 rounded-xl border border-gray-100 dark:border-gray-700">
            <h3 className="text-sm font-bold text-gray-600 dark:text-gray-400 mb-4">
              Etiquetas mais usadas
            </h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={tagsChartData}
                  layout="vertical"
                  margin={{ top: 4, right: 20, left: 8, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" className="dark:stroke-gray-600" />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={100}
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v) => (v.length > 14 ? v.slice(0, 12) + '…' : v)}
                  />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (active && payload?.[0]) {
                        const p = payload[0].payload;
                        return (
                          <div className="bg-white dark:bg-[#2a2a2a] p-3 rounded-lg shadow-lg border border-gray-200 dark:border-gray-600">
                            <p className="font-bold text-gray-800 dark:text-gray-100">{p.name}</p>
                            <p className="text-sm text-gray-600 dark:text-gray-400">
                              Aplicações: <span className="font-semibold">{p.count}</span>
                            </p>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Bar dataKey="count" name="Aplicações" radius={[0, 4, 4, 0]}>
                    {tagsChartData.map((entry, index) => (
                      <Cell key={entry.id} fill={entry.color || '#E86A24'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Gráfico: Uso de etiquetas por consultor */}
        {hasConsultoresData && (
          <div className="bg-gray-50/50 dark:bg-gray-800/50 p-4 rounded-xl border border-gray-100 dark:border-gray-700">
            <h3 className="text-sm font-bold text-gray-600 dark:text-gray-400 mb-4">
              Uso de etiquetas por consultor
            </h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={consultoresChartData}
                  layout="vertical"
                  margin={{ top: 4, right: 20, left: 8, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" className="dark:stroke-gray-600" />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={100}
                    tick={{ fontSize: 11 }}
                  />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (active && payload?.[0]) {
                        const p = payload[0].payload;
                        return (
                          <div className="bg-white dark:bg-[#2a2a2a] p-3 rounded-lg shadow-lg border border-gray-200 dark:border-gray-600">
                            <p className="font-bold text-gray-800 dark:text-gray-100">{p.fullName}</p>
                            <p className="text-sm text-gray-600 dark:text-gray-400">
                              Total de etiquetas aplicadas: <span className="font-semibold">{p.total}</span>
                            </p>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Bar dataKey="total" name="Etiquetas aplicadas" radius={[0, 4, 4, 0]}>
                    {consultoresChartData.map((entry, index) => {
                      const isFirst = index === 0;
                      const isLast = consultoresChartData.length > 1 && index === consultoresChartData.length - 1;
                      let fill = '#E86A24';
                      if (isFirst) fill = '#E86A24';
                      else if (isLast) fill = '#9ca3af';
                      return <Cell key={entry.name + index} fill={fill} />;
                    })}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
