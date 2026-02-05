'use client';

import React from 'react';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Legend,
  Tooltip,
} from 'recharts';

interface LeadsDistributionChartProps {
  totalLeads: number;
  activeLeads: number;
}

export default function LeadsDistributionChart({ totalLeads, activeLeads }: LeadsDistributionChartProps) {
  const inactiveLeads = Math.max(0, totalLeads - activeLeads);

  const chartData = [
    { name: 'Ativos', value: activeLeads, color: '#10b981' },
    { name: 'Inativos', value: inactiveLeads, color: '#ef4444' },
  ].filter(item => item.value > 0);

  if (chartData.length === 0 || totalLeads === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">
        Nenhum dado disponível
      </div>
    );
  }

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0];
      const percentage = totalLeads > 0 ? ((data.value / totalLeads) * 100).toFixed(1) : 0;
      return (
        <div className="bg-white p-3 rounded-lg shadow-lg border border-gray-200">
          <p className="font-bold text-gray-800">{data.name}</p>
          <p className="text-sm text-gray-600">
            Quantidade: <span className="font-semibold">{data.value}</span>
          </p>
          <p className="text-sm text-gray-600">
            Percentual: <span className="font-semibold">{percentage}%</span>
          </p>
        </div>
      );
    }
    return null;
  };

  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie
          data={chartData}
          cx="50%"
          cy="50%"
          labelLine={false}
          label={({ name, percent }) => `${name}: ${((percent || 0) * 100).toFixed(0)}%`}
          outerRadius={80}
          fill="#8884d8"
          dataKey="value"
        >
          {chartData.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={entry.color} />
          ))}
        </Pie>
        <Tooltip content={<CustomTooltip />} />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  );
}

