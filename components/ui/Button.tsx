'use client';

import React from 'react';
import { Loader2 } from 'lucide-react';

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'outline'
  | 'ghost'
  | 'danger'
  | 'success';

export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  // Ação principal — laranja da marca, sempre texto branco
  primary:
    'bg-[#E86A24] hover:bg-[#D95E1B] text-white shadow-sm disabled:bg-gray-300 dark:disabled:bg-gray-600',
  // Ação neutra — superfície com borda (mesmo estilo dos botões de filtro)
  secondary:
    'bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 shadow-sm',
  // Ação secundária com identidade da marca
  outline:
    'bg-[#E86A2415] hover:bg-[#E86A2425] border border-[#E86A2440] hover:border-[#E86A2460] text-[#E86A24]',
  // Ação discreta, sem borda
  ghost:
    'bg-transparent text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#333]',
  // Ação destrutiva
  danger:
    'bg-red-600 hover:bg-red-700 text-white shadow-sm disabled:bg-gray-300 dark:disabled:bg-gray-600',
  // Confirmação/salvar quando o contexto pedir verde
  success:
    'bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm disabled:bg-gray-300 dark:disabled:bg-gray-600',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'min-h-[36px] px-3 py-1.5 text-xs gap-1.5 rounded-lg',
  md: 'min-h-[44px] px-4 py-2 text-sm gap-2 rounded-xl',
  lg: 'min-h-[48px] px-5 py-2.5 text-sm gap-2 rounded-xl',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** Ícone à esquerda (ex.: <Plus className="w-4 h-4" />) */
  icon?: React.ReactNode;
  fullWidth?: boolean;
}

/**
 * Botão padrão do app. Substitui as dezenas de implementações inline de
 * `bg-[#E86A24] hover:bg-[#D95E1B] ...` espalhadas pelas telas.
 */
const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    icon,
    fullWidth = false,
    disabled,
    className = '',
    children,
    ...rest
  },
  ref
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E86A24]/50 ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${fullWidth ? 'w-full' : ''} ${className}`.trim()}
      {...rest}
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : icon}
      {children}
    </button>
  );
});

export default Button;
