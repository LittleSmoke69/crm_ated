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

interface StatusDistributionChartProps {
  data?: Record<string, number>;
  colors?: string[];
}

const DEFAULT_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

export default function StatusDistributionChart({ data, colors = DEFAULT_COLORS }: StatusDistributionChartProps) {
  // Ordem para distribuição por quantidade de depósitos (CRM Admin)
  const depositsCountOrder = [
    'Apenas cadastraram',
    'Depositaram 1x',
    'Depositaram 2x',
    'Depositaram 3x',
    'Depositaram 4x',
    'Depositaram 5x',
    'Depositaram 6x a 9x',
    'Depositaram 10x+',
  ];
  const isDepositsCount = data && depositsCountOrder.some(key => key in (data || {}));

  // Detecta se é dados de engajamento ou status
  const isEngagement = data && !isDepositsCount && Object.keys(data).some(key =>
    key.toLowerCase().includes('cadastrado') ||
    key.toLowerCase().includes('jogaram') ||
    key.toLowerCase().includes('depositou') ||
    key.toLowerCase().includes('deposito') ||
    key.toLowerCase().includes('só cadastro')
  );

  let chartData: Array<{ name: string; value: number }> = [];

  if (isDepositsCount && data) {
    chartData = depositsCountOrder
      .map(name => ({ name, value: data[name] || 0 }))
      .filter(item => item.value > 0);
  } else if (isEngagement) {
    // Para engajamento: mostra todos os valores na ordem correta
    const engagementOrder = [
      'Deposito 1x',
      'Deposito 2x',
      'Deposito 3x',
      'Deposito 5x',
      'Deposito 10x+',
      'Cadastrados',
      'Jogaram 1x',
      'Jogaram 2x',
      'Jogaram 3x+'
    ];
    chartData = engagementOrder
      .map(name => ({
        name,
        value: data[name] || 0
      }))
      .filter(item => item.value > 0);
  } else {
    // Para status: agrupa e normaliza para mostrar apenas "Ativo" e "Novo"
    const statusMap: Record<string, number> = {
      'Ativo': 0,
      'Novo': 0
    };

    // Processa todos os dados e agrupa por status
    Object.entries(data || {}).forEach(([name, value]) => {
      const normalizedName = name.toLowerCase();
      const numValue = typeof value === 'number' ? value : 0;
      
      if (normalizedName.includes('ativo') || normalizedName.includes('active')) {
        statusMap['Ativo'] += numValue;
      } else if (normalizedName.includes('novo') || normalizedName.includes('new') || 
                 normalizedName.includes('inativo') || normalizedName.includes('inactive')) {
        statusMap['Novo'] += numValue;
      }
    });

    // Cria o array de dados ordenado: "Ativo" primeiro (verde), depois "Novo" (vermelho)
    chartData = [
      { name: 'Ativo', value: statusMap['Ativo'] },
      { name: 'Novo', value: statusMap['Novo'] }
    ].filter(item => item.value > 0); // Remove itens com valor zero
  }

  if (chartData.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">
        Nenhum dado disponível
      </div>
    );
  }

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
            <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
          ))}
        </Pie>
        <Tooltip />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  );
}

