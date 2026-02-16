'use client';

import React from 'react';

export interface Funnel3DChartProps {
  data?: {
    stages?: string[];
    values?: number[];
  };
  /** Tons de verde do claro (topo) ao escuro (base). */
  greenShades?: string[];
  /** Exibir texto de placeholder quando valores são zero */
  showPlaceholder?: boolean;
}

const DEFAULT_GREENS = [
  '#BBF7D0', // green-200
  '#86EFAC', // green-300
  '#4ADE80', // green-400
  '#22C55E', // green-500
  '#16A34A', // green-600
  '#15803D', // green-700
  '#166534', // green-800
];

export default function Funnel3DChart({
  data,
  greenShades = DEFAULT_GREENS,
  showPlaceholder = true,
}: Funnel3DChartProps) {
  const stages = data?.stages ?? [];
  const values = data?.values ?? [];
  const items = stages.map((label, i) => ({
    label,
    value: values[i] ?? 0,
  }));

  if (items.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500 text-sm">
        Nenhum dado disponível
      </div>
    );
  }

  const shades = [...greenShades];
  while (shades.length < items.length) {
    shades.push(greenShades[greenShades.length - 1]!);
  }

  return (
    <div className="w-full flex flex-col items-center justify-center py-6" style={{ minHeight: 320 }}>
      <div className="w-full max-w-lg flex flex-col items-center gap-1">
        {items.map((item, index) => {
          const n = items.length;
          const widthPercent = 100 - (index / Math.max(n - 1, 1)) * 38;
          const bg = shades[index] ?? DEFAULT_GREENS[0]!;
          const isFirst = index === 0;
          const isLast = index === n - 1;
          const textDark = index <= 2; // topo claro: texto escuro; base escura: texto claro

          return (
            <div
              key={index}
              className="relative flex items-center justify-between px-4 py-2.5 rounded-lg transition-colors hover:opacity-95"
              style={{
                width: `${widthPercent}%`,
                backgroundColor: bg,
                borderRadius: isFirst ? 10 : isLast ? 10 : 6,
                border: '1px solid rgba(0,0,0,0.06)',
              }}
            >
              <span
                className={`text-sm font-medium truncate ${textDark ? 'text-gray-800' : 'text-white'}`}
              >
                {item.label}
              </span>
              <span
                className={`text-sm tabular-nums shrink-0 ml-2 ${textDark ? 'text-gray-700' : 'text-white/95'}`}
              >
                {item.value > 0 ? item.value.toLocaleString('pt-BR') : '0'}
              </span>
            </div>
          );
        })}
      </div>
      {showPlaceholder && items.every((i) => i.value === 0) && (
        <p className="text-xs text-gray-500 mt-5 text-center max-w-sm">
          Dados do funil serão preenchidos após a integração com o Facebook Ads.
        </p>
      )}
    </div>
  );
}
