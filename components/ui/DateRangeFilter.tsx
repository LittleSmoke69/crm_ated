'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Calendar, ChevronDown } from 'lucide-react';
import {
  DATE_PRESET_LABELS,
  DatePreset,
  DateRangeValue,
  getDateRangeLabel,
  toLocalDateString,
} from '@/lib/ui/date-range';
import Button from './Button';

const DEFAULT_PRESETS: DatePreset[] = [
  'daily',
  'yesterday',
  '7days',
  '15days',
  '30days',
  'custom',
  'all',
];

export interface DateRangeFilterProps {
  value: DateRangeValue;
  onChange: (value: DateRangeValue) => void;
  /** Subconjunto/ordem dos presets exibidos */
  presets?: DatePreset[];
  /** Alinhamento do dropdown em relação ao botão */
  align?: 'left' | 'right';
  className?: string;
}

/**
 * Filtro de período unificado — substitui as 7+ cópias inline do dropdown
 * de data. Fecha com clique fora e ESC; 'custom' abre inputs de data com
 * botão Aplicar.
 */
export default function DateRangeFilter({
  value,
  onChange,
  presets = DEFAULT_PRESETS,
  align = 'right',
  className = '',
}: DateRangeFilterProps) {
  const [open, setOpen] = useState(false);
  const [customStart, setCustomStart] = useState(value.startDate ?? '');
  const [customEnd, setCustomEnd] = useState(value.endDate ?? '');
  const [showCustom, setShowCustom] = useState(value.preset === 'custom');
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const selectPreset = (preset: DatePreset) => {
    if (preset === 'custom') {
      setShowCustom(true);
      // Restaura as datas aplicadas nos inputs, se existirem
      if (value.startDate) setCustomStart(value.startDate);
      if (value.endDate) setCustomEnd(value.endDate);
      return;
    }
    setShowCustom(false);
    onChange({ preset });
    setOpen(false);
  };

  const applyCustom = () => {
    if (!customStart || !customEnd) return;
    onChange({ preset: 'custom', startDate: customStart, endDate: customEnd });
    setOpen(false);
  };

  const todayStr = toLocalDateString(new Date());

  return (
    <div ref={containerRef} className={`relative ${className}`.trim()}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-2 min-h-[44px] bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-gray-600 px-3 sm:px-4 py-2 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors shadow-sm"
      >
        <Calendar className="w-4 h-4 text-[#E86A24] shrink-0" />
        <span className="truncate">{getDateRangeLabel(value)}</span>
        <ChevronDown
          className={`w-4 h-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div
          className={`absolute ${align === 'right' ? 'right-0' : 'left-0'} mt-2 min-w-[220px] rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-[#2a2a2a] shadow-lg z-50`}
        >
          <div className="p-2">
            {presets.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => selectPreset(preset)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                  value.preset === preset
                    ? 'bg-[#E86A2415] dark:bg-[#E86A2425] text-[#E86A24] font-medium'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                }`}
              >
                {DATE_PRESET_LABELS[preset]}
              </button>
            ))}
          </div>

          {showCustom && (
            <div className="p-3 border-t border-gray-200 dark:border-gray-600 space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                  Data Inicial
                </label>
                <input
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  max={customEnd || todayStr}
                  className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-[#E86A24] focus:border-[#E86A24] focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                  Data Final
                </label>
                <input
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  min={customStart}
                  max={todayStr}
                  className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-[#E86A24] focus:border-[#E86A24] focus:outline-none"
                />
              </div>
              <Button
                size="sm"
                fullWidth
                disabled={!customStart || !customEnd}
                onClick={applyCustom}
              >
                Aplicar
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
