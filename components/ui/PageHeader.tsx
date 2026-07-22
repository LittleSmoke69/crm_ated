import React from 'react';

export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  /** Ícone lucide exibido no chip laranja (ex.: <Users className="w-6 h-6" />) */
  icon?: React.ReactNode;
  /** Ações à direita (botões, filtros) */
  actions?: React.ReactNode;
  className?: string;
}

/** Cabeçalho de página padrão — chip de ícone + título + subtítulo + ações. */
export default function PageHeader({
  title,
  subtitle,
  icon,
  actions,
  className = '',
}: PageHeaderProps) {
  return (
    <div
      className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6 ${className}`.trim()}
    >
      <div className="flex items-center gap-3 min-w-0">
        {icon && (
          <span className="flex items-center justify-center w-11 h-11 rounded-xl bg-[#E86A2415] text-[#E86A24] shrink-0">
            {icon}
          </span>
        )}
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white truncate">
            {title}
          </h1>
          {subtitle && (
            <p className="text-sm text-gray-500 dark:text-gray-400 truncate">{subtitle}</p>
          )}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap shrink-0">{actions}</div>}
    </div>
  );
}
