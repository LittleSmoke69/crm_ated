import React from 'react';

export type BadgeColor =
  | 'orange'
  | 'emerald'
  | 'red'
  | 'amber'
  | 'blue'
  | 'purple'
  | 'gray';

const COLOR_CLASSES: Record<BadgeColor, string> = {
  orange: 'bg-[#E86A2415] text-[#E86A24] border-[#E86A2440]',
  emerald:
    'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30',
  red: 'bg-red-100 text-red-800 border-red-200 dark:bg-red-500/15 dark:text-red-300 dark:border-red-500/30',
  amber:
    'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30',
  blue: 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/30',
  purple:
    'bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-500/15 dark:text-purple-300 dark:border-purple-500/30',
  gray: 'bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-500/15 dark:text-gray-300 dark:border-gray-500/30',
};

export interface BadgeProps {
  color?: BadgeColor;
  /** Cor customizada em hex (ex.: cor de etiqueta vinda do banco) */
  hexColor?: string;
  size?: 'sm' | 'md';
  className?: string;
  children: React.ReactNode;
}

/** Pill/badge padrão — substitui as 5+ implementações inline de tags e status. */
export default function Badge({
  color = 'gray',
  hexColor,
  size = 'md',
  className = '',
  children,
}: BadgeProps) {
  const sizeClasses =
    size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-0.5 text-xs';

  if (hexColor) {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full border font-medium ${sizeClasses} ${className}`.trim()}
        style={{
          backgroundColor: `${hexColor}20`,
          color: hexColor,
          borderColor: `${hexColor}50`,
        }}
      >
        {children}
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border font-medium ${sizeClasses} ${COLOR_CLASSES[color]} ${className}`.trim()}
    >
      {children}
    </span>
  );
}
