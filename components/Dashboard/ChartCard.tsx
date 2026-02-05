'use client';

import React, { useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

interface ChartData {
  month: string;
  mensagens: number;
  adicoes: number;
}

interface ChartCardProps {
  title: string;
  subtitle?: string;
  data?: ChartData[];
}

const ChartCard: React.FC<ChartCardProps> = ({ title, subtitle, data = [] }) => {
  const [period, setPeriod] = useState('7');

  // Se não houver dados, mostra dados vazios
  const chartData = data.length > 0 ? data : [
    { month: 'Jan', mensagens: 0, adicoes: 0 },
    { month: 'Fev', mensagens: 0, adicoes: 0 },
    { month: 'Mar', mensagens: 0, adicoes: 0 },
    { month: 'Abr', mensagens: 0, adicoes: 0 },
    { month: 'Mai', mensagens: 0, adicoes: 0 },
    { month: 'Jun', mensagens: 0, adicoes: 0 },
    { month: 'Jul', mensagens: 0, adicoes: 0 },
    { month: 'Ago', mensagens: 0, adicoes: 0 },
    { month: 'Set', mensagens: 0, adicoes: 0 },
    { month: 'Out', mensagens: 0, adicoes: 0 },
    { month: 'Nov', mensagens: 0, adicoes: 0 },
    { month: 'Dez', mensagens: 0, adicoes: 0 },
  ];

  return (
    <div className="bg-gray-100 rounded-xl shadow-md p-6 lg:col-span-2 border border-gray-200">
      <div className="flex justify-between items-start mb-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-800">{title}</h3>
          {subtitle && <p className="text-sm text-gray-500 mt-1">{subtitle}</p>}
        </div>
        <select
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 text-gray-700 focus:outline-none focus:ring-2"
          style={{ '--tw-ring-color': '#8CD955' } as React.CSSProperties}
        >
          <option value="7">Últimos 7 dias</option>
          <option value="30">Últimos 30 dias</option>
          <option value="90">Últimos 90 dias</option>
        </select>
      </div>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis
              dataKey="month"
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
              labelStyle={{ color: '#374151', fontWeight: 'bold' }}
            />
            <Legend
              wrapperStyle={{ paddingTop: '20px' }}
              iconType="line"
            />
            <Line
              type="monotone"
              dataKey="mensagens"
              stroke="#3b82f6"
              strokeWidth={2}
              name="Mensagens Enviadas"
              dot={{ fill: '#3b82f6', r: 4 }}
              activeDot={{ r: 6 }}
            />
            <Line
              type="monotone"
              dataKey="adicoes"
              stroke="#8CD955"
              strokeWidth={2}
              name="Adições aos Grupos"
              dot={{ fill: '#8CD955', r: 4 }}
              activeDot={{ r: 6 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default ChartCard;
