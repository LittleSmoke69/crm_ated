'use client';

import React from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

interface ActivityByWeekdayChartProps {
  data?: {
    weekdays?: string[];
    values?: number[];
  };
}

const WEEKDAY_NAMES: Record<string, string> = {
  '0': 'Dom',
  '1': 'Seg',
  '2': 'Ter',
  '3': 'Qua',
  '4': 'Qui',
  '5': 'Sex',
  '6': 'Sáb',
};

export default function ActivityByWeekdayChart({ data }: ActivityByWeekdayChartProps) {
  if (!data || !data.weekdays || !Array.isArray(data.weekdays)) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500 dark:text-gray-400">
        Nenhum dado disponível
      </div>
    );
  }

  const chartData = data.weekdays.map((weekday, index) => ({
    weekday: WEEKDAY_NAMES[weekday] || weekday,
    Atividade: data.values?.[index] || 0,
  }));

  if (chartData.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500 dark:text-gray-400">
        Nenhum dado disponível
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#404040" />
        <XAxis
          dataKey="weekday"
          stroke="#9ca3af"
          style={{ fontSize: '12px' }}
        />
        <YAxis
          stroke="#9ca3af"
          style={{ fontSize: '12px' }}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: '#2a2a2a',
            border: '1px solid #404040',
            borderRadius: '8px',
            padding: '8px',
            color: '#e5e7eb',
          }}
        />
        <Legend />
        <Bar dataKey="Atividade" fill="#10b981" radius={[8, 8, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

