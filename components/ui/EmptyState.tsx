import React from 'react';

export interface EmptyStateProps {
  /** Ícone lucide (ex.: <Inbox className="w-8 h-8" />) */
  icon?: React.ReactNode;
  title: string;
  description?: string;
  /** Ação sugerida (ex.: <Button>Cadastrar</Button>) */
  action?: React.ReactNode;
  /** Versão compacta para dentro de tabelas/colunas */
  compact?: boolean;
  className?: string;
}

/** Estado vazio padrão — ícone + título + instrução + ação opcional. */
export default function EmptyState({
  icon,
  title,
  description,
  action,
  compact = false,
  className = '',
}: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center text-center ${compact ? 'py-6 px-4' : 'py-12 px-6'} ${className}`.trim()}
    >
      {icon && (
        <div
          className={`flex items-center justify-center rounded-2xl bg-gray-100 dark:bg-[#333] text-gray-400 dark:text-gray-500 mb-3 ${compact ? 'w-10 h-10' : 'w-14 h-14'}`}
        >
          {icon}
        </div>
      )}
      <p className={`font-semibold text-gray-700 dark:text-gray-200 ${compact ? 'text-sm' : 'text-base'}`}>
        {title}
      </p>
      {description && (
        <p className={`mt-1 text-gray-500 dark:text-gray-400 max-w-sm ${compact ? 'text-xs' : 'text-sm'}`}>
          {description}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
