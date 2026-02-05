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
  Cell,
} from 'recharts';

interface FinancialMetricsBarChartProps {
  data: {
    total_deposited: number;
    total_bets: number;
    total_prizes: number;
    net_profit: number;
  };
}

export default function FinancialMetricsBarChart({ data }: FinancialMetricsBarChartProps) {
  const chartData = [
    {
      name: 'Depositado',
      valor: data.total_deposited || 0,
      fill: '#22c55e',
    },
    {
      name: 'Apostado',
      valor: data.total_bets || 0,
      fill: '#3b82f6',
    },
    {
      name: 'Prêmios',
      valor: data.total_prizes || 0,
      fill: '#f59e0b',
    },
    {
      name: 'Lucro Líquido',
      valor: data.net_profit || 0,
      fill: data.net_profit >= 0 ? '#10b981' : '#ef4444',
    },
  ];

  const formatCurrency = (value: number) => {
    if (value >= 1000000) {
      return `R$ ${(value / 1000000).toFixed(1)}M`;
    } else if (value >= 1000) {
      return `R$ ${(value / 1000).toFixed(1)}k`;
    }
    return `R$ ${value.toFixed(0)}`;
  };

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white p-3 rounded-lg shadow-lg border border-gray-200">
          <p className="font-bold text-gray-800">{payload[0].payload.name}</p>
          <p className="text-sm text-gray-600">
            Valor: <span className="font-semibold">{formatCurrency(payload[0].value)}</span>
          </p>
        </div>
      );
    }
    return null;
  };

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={chartData}
        margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
        <XAxis 
          dataKey="name" 
          tick={{ fill: '#6b7280', fontSize: 12 }}
          tickLine={{ stroke: '#9ca3af' }}
        />
        <YAxis 
          tick={{ fill: '#6b7280', fontSize: 12 }}
          tickLine={{ stroke: '#9ca3af' }}
          tickFormatter={formatCurrency}
        />
        <Tooltip content={<CustomTooltip />} />
        <Legend />
        <Bar 
          dataKey="valor" 
          radius={[8, 8, 0, 0]}
        >
          {chartData.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={entry.fill} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

