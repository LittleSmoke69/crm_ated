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

interface ConversionFunnelChartProps {
  data?: {
    stages?: string[];
    values?: number[];
  };
}

export default function ConversionFunnelChart({ data }: ConversionFunnelChartProps) {
  if (!data || !data.stages || !Array.isArray(data.stages)) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500 dark:text-gray-400">
        Nenhum dado disponível
      </div>
    );
  }

  const chartData = data.stages.map((stage, index) => ({
    etapa: stage.charAt(0).toUpperCase() + stage.slice(1),
    Valor: data.values?.[index] || 0,
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
          dataKey="etapa"
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
        <Bar dataKey="Valor" fill="#8b5cf6" radius={[8, 8, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

