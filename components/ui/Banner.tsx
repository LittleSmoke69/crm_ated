import React from 'react';
import { Info, CheckCircle2, AlertTriangle, AlertCircle } from 'lucide-react';

export type BannerVariant = 'info' | 'success' | 'warning' | 'error';

const VARIANT_CLASSES: Record<BannerVariant, { box: string; icon: React.ReactNode }> = {
  info: {
    box: 'bg-blue-50 border-blue-200 text-blue-800 dark:bg-blue-500/10 dark:border-blue-500/30 dark:text-blue-300',
    icon: <Info className="w-5 h-5 shrink-0" />,
  },
  success: {
    box: 'bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-500/10 dark:border-emerald-500/30 dark:text-emerald-300',
    icon: <CheckCircle2 className="w-5 h-5 shrink-0" />,
  },
  warning: {
    box: 'bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-500/10 dark:border-amber-500/30 dark:text-amber-300',
    icon: <AlertTriangle className="w-5 h-5 shrink-0" />,
  },
  error: {
    box: 'bg-red-50 border-red-200 text-red-800 dark:bg-red-500/10 dark:border-red-500/30 dark:text-red-300',
    icon: <AlertCircle className="w-5 h-5 shrink-0" />,
  },
};

export interface BannerProps {
  variant?: BannerVariant;
  title?: string;
  /** Ação à direita (ex.: botão de retry) */
  action?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}

/** Banner informativo inline — unifica os avisos azuis/âmbar/vermelhos das telas. */
export default function Banner({
  variant = 'info',
  title,
  action,
  className = '',
  children,
}: BannerProps) {
  const v = VARIANT_CLASSES[variant];
  return (
    <div
      className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${v.box} ${className}`.trim()}
      role={variant === 'error' ? 'alert' : undefined}
    >
      {v.icon}
      <div className="flex-1 min-w-0 text-sm">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={title ? 'mt-0.5' : ''}>{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
