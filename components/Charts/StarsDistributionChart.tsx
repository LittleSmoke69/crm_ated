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

interface StarsDistributionChartProps {
  data?: Record<string, number>;
}

export default function StarsDistributionChart({ data }: StarsDistributionChartProps) {
  if (!data || Object.keys(data).length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">
        Nenhum dado disponível
      </div>
    );
  }

  // Ordena por número de estrelas (extrai o número da string)
  // Exemplo: "0 Estrelas" -> 0, "1 Estrela" -> 1, "5 Estrelas" -> 5
  const sortedEntries = Object.entries(data).sort((a, b) => {
    const extractNumber = (str: string): number => {
      const match = str.match(/^(\d+)/);
      return match ? parseInt(match[1]) : 0;
    };
    return extractNumber(a[0]) - extractNumber(b[0]);
  });

  const chartData = sortedEntries.map(([key, value]) => ({
    estrelas: key,
    quantidade: value
  }));

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
        <XAxis
          dataKey="estrelas"
          stroke="#6b7280"
          style={{ fontSize: '12px' }}
        />
        <YAxis
          stroke="#6b7280"
          style={{ fontSize: '12px' }}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: '8px',
            padding: '8px',
          }}
        />
        <Legend />
        <Bar dataKey="quantidade" fill="#f59e0b" radius={[8, 8, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

