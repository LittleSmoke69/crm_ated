'use client';

import React from 'react';
import { Search } from 'lucide-react';

/** Classes compartilhadas dos controles de formulário (tema claro/escuro). */
export const fieldControlClasses =
  'w-full rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-[#333] px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:border-[#E86A24] focus:ring-2 focus:ring-[#E86A24]/30 focus:outline-none transition-colors disabled:opacity-60 disabled:cursor-not-allowed';

const fieldErrorClasses = 'border-red-400 dark:border-red-500 focus:border-red-500 focus:ring-red-500/30';

interface FieldProps {
  label?: string;
  htmlFor?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}

/** Wrapper label + controle + hint/erro. */
export function Field({ label, htmlFor, hint, error, required, className = '', children }: FieldProps) {
  return (
    <div className={`space-y-1 ${className}`.trim()}>
      {label && (
        <label
          htmlFor={htmlFor}
          className="block text-sm font-medium text-gray-700 dark:text-gray-300"
        >
          {label}
          {required && <span className="text-red-500 ml-0.5">*</span>}
        </label>
      )}
      {children}
      {error ? (
        <p className="text-xs text-red-600 dark:text-red-400" role="alert">{error}</p>
      ) : hint ? (
        <p className="text-xs text-gray-500 dark:text-gray-400">{hint}</p>
      ) : null}
    </div>
  );
}

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Ícone à esquerda dentro do input (ex.: <Mail className="w-5 h-5" />) */
  icon?: React.ReactNode;
  error?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { icon, error, className = '', ...rest },
  ref
) {
  if (!icon) {
    return (
      <input
        ref={ref}
        className={`${fieldControlClasses} min-h-[44px] ${error ? fieldErrorClasses : ''} ${className}`.trim()}
        {...rest}
      />
    );
  }
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 pointer-events-none">
        {icon}
      </span>
      <input
        ref={ref}
        className={`${fieldControlClasses} min-h-[44px] pl-10 ${error ? fieldErrorClasses : ''} ${className}`.trim()}
        {...rest}
      />
    </div>
  );
});

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  error?: boolean;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { error, className = '', children, ...rest },
  ref
) {
  return (
    <select
      ref={ref}
      className={`${fieldControlClasses} min-h-[44px] ${error ? fieldErrorClasses : ''} ${className}`.trim()}
      {...rest}
    >
      {children}
    </select>
  );
});

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { error, className = '', ...rest },
  ref
) {
  return (
    <textarea
      ref={ref}
      className={`${fieldControlClasses} ${error ? fieldErrorClasses : ''} ${className}`.trim()}
      {...rest}
    />
  );
});

/** Input de busca com ícone de lupa — substitui as ~10 cópias espalhadas. */
export const SearchInput = React.forwardRef<HTMLInputElement, Omit<InputProps, 'icon'>>(
  function SearchInput({ placeholder = 'Pesquisar...', ...rest }, ref) {
    return <Input ref={ref} icon={<Search className="w-4 h-4" />} placeholder={placeholder} {...rest} />;
  }
);
