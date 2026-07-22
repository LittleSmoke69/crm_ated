'use client';

import React, { useState } from 'react';

export interface StatCardProps {
  label: string;
  value: React.ReactNode;
  /** Ícone opcional (ex.: <Users className="w-5 h-5" />) */
  icon?: React.ReactNode;
  /** Cor do chip do ícone em hex; padrão laranja da marca */
  iconColor?: string;
  /** Texto explicativo exibido ao tocar no "!" */
  hint?: string;
  /** Linha auxiliar abaixo do valor (ex.: variação, contagem) */
  sub?: React.ReactNode;
  /** Card clicável (usado como filtro); `selected` liga o destaque */
  onClick?: () => void;
  selected?: boolean;
  className?: string;
}

/**
 * Card de métrica padrão — unifica MetricCard (admin), Stat/MetricInfoCard
 * (dono-banca, BancaAnalysisCard, InvestmentRounds*) e os cards clicáveis
 * do /consultor/detalhado.
 */
export default function StatCard({
  label,
  value,
  icon,
  iconColor = '#E86A24',
  hint,
  sub,
  onClick,
  selected = false,
  className = '',
}: StatCardProps) {
  const [showHint, setShowHint] = useState(false);

  const base =
    'relative rounded-2xl border bg-white dark:bg-[#2a2a2a] p-4 transition-all';
  const interactive = onClick
    ? 'cursor-pointer text-left w-full hover:border-[#E86A24]/50 hover:shadow-md'
    : '';
  const borderClasses = selected
    ? 'border-[#E86A24] ring-2 ring-[#E86A24]/25'
    : 'border-gray-200 dark:border-gray-600';

  const content = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400 truncate">
            {label}
          </p>
          <p className="mt-1 text-xl sm:text-2xl font-bold text-gray-900 dark:text-white tabular-nums truncate">
            {value}
          </p>
          {sub && (
            <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{sub}</div>
          )}
        </div>
        {icon && (
          <span
            className="flex items-center justify-center w-10 h-10 rounded-xl shrink-0"
            style={{ backgroundColor: `${iconColor}15`, color: iconColor }}
          >
            {icon}
          </span>
        )}
        {hint && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setShowHint((v) => !v);
            }}
            className="flex items-center justify-center w-6 h-6 rounded-full border border-gray-300 dark:border-gray-500 text-[11px] font-bold text-gray-500 dark:text-gray-400 hover:border-[#E86A24] hover:text-[#E86A24] transition-colors shrink-0"
            aria-label={`Sobre ${label}`}
            aria-expanded={showHint}
          >
            !
          </button>
        )}
      </div>
      {hint && showHint && (
        <p className="mt-2 text-xs leading-relaxed text-gray-600 dark:text-gray-300 border-t border-gray-100 dark:border-gray-700 pt-2">
          {hint}
        </p>
      )}
    </>
  );

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={`${base} ${interactive} ${borderClasses} ${className}`.trim()}>
        {content}
      </button>
    );
  }

  return <div className={`${base} ${borderClasses} ${className}`.trim()}>{content}</div>;
}

export interface KpiHeroItem {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  /** Ícone opcional ao lado do label (ex.: <Users className="w-4 h-4" />) */
  icon?: React.ReactNode;
}

export interface KpiHeroProps {
  title?: React.ReactNode;
  /** Slot à direita do título (ex.: filtro de período) */
  actions?: React.ReactNode;
  items: KpiHeroItem[];
  /** Colunas no desktop (padrão: até 4 por linha) */
  columns?: 4 | 5 | 9;
  loading?: boolean;
  emptyMessage?: string;
  className?: string;
}

const COLUMN_CLASSES: Record<NonNullable<KpiHeroProps['columns']>, string> = {
  4: 'grid-cols-2 md:grid-cols-4',
  5: 'grid-cols-2 md:grid-cols-3 lg:grid-cols-5',
  9: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-9',
};

/**
 * Banner hero de KPIs — gradiente laranja com mini-cards translúcidos.
 * Unifica as 4 variações (laranja sem dark, emerald, indigo) num único
 * componente com dark mode.
 */
export function KpiHero({
  title,
  actions,
  items,
  columns = 4,
  loading = false,
  emptyMessage = 'Sem dados para o período selecionado',
  className = '',
}: KpiHeroProps) {
  return (
    <div
      className={`rounded-2xl bg-gradient-to-br from-[#EF9057] to-[#E86A24] dark:from-[#9c4514] dark:to-[#7a350e] p-4 sm:p-6 shadow-lg ${className}`.trim()}
    >
      {(title || actions) && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          {title && <h2 className="text-lg font-bold text-white">{title}</h2>}
          {actions && <div className="shrink-0">{actions}</div>}
        </div>
      )}

      {loading ? (
        <div className={`grid gap-3 ${COLUMN_CLASSES[columns]}`}>
          {Array.from({ length: columns === 9 ? 9 : columns }).map((_, i) => (
            <div
              key={i}
              className="h-[76px] rounded-xl bg-white/10 border border-white/20 animate-pulse"
            />
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-white/80 py-6 text-center">{emptyMessage}</p>
      ) : (
        <div className={`grid gap-3 ${COLUMN_CLASSES[columns]}`}>
          {items.map((item, i) => (
            <div
              key={i}
              className="rounded-xl bg-white/10 backdrop-blur-sm border border-white/20 p-3 sm:p-4 min-w-0"
            >
              <p className="flex items-center gap-1.5 text-xs font-medium text-white/80 truncate">
                {item.icon && <span className="shrink-0 text-white">{item.icon}</span>}
                {item.label}
              </p>
              <p className="mt-0.5 text-lg sm:text-xl font-bold text-white tabular-nums truncate">
                {item.value}
              </p>
              {item.sub && <div className="mt-0.5 text-[11px] text-white/70">{item.sub}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
