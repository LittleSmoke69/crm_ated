/**
 * Presets e cálculo de intervalo de datas — fonte única para os filtros de
 * período (antes copiado em 7+ arquivos com diferenças sutis de timezone).
 * Todas as datas são calculadas no fuso local (America/Sao_Paulo para os
 * usuários) e retornadas como 'YYYY-MM-DD'.
 */

export type DatePreset =
  | 'daily'
  | 'yesterday'
  | '7days'
  | '15days'
  | '30days'
  | 'custom'
  | 'all';

export interface DateRangeValue {
  preset: DatePreset;
  /** Presentes apenas quando preset === 'custom' */
  startDate?: string;
  endDate?: string;
}

export const DATE_PRESET_LABELS: Record<DatePreset, string> = {
  daily: 'Hoje',
  yesterday: 'Ontem',
  '7days': 'Últimos 7 dias',
  '15days': 'Últimos 15 dias',
  '30days': 'Últimos 30 dias',
  custom: 'Personalizado',
  all: 'Todo o Período',
};

/** Formata um Date local como 'YYYY-MM-DD' (sem conversão UTC). */
export function toLocalDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Resolve o preset em datas concretas.
 * Retorna null para 'all' (sem filtro) e as datas custom para 'custom'.
 */
export function getDateRange(
  value: DateRangeValue
): { startDate: string; endDate: string } | null {
  const today = new Date();

  switch (value.preset) {
    case 'all':
      return null;
    case 'custom':
      if (!value.startDate || !value.endDate) return null;
      return { startDate: value.startDate, endDate: value.endDate };
    case 'daily': {
      const d = toLocalDateString(today);
      return { startDate: d, endDate: d };
    }
    case 'yesterday': {
      const y = new Date(today);
      y.setDate(y.getDate() - 1);
      const d = toLocalDateString(y);
      return { startDate: d, endDate: d };
    }
    case '7days':
    case '15days':
    case '30days': {
      const days = value.preset === '7days' ? 7 : value.preset === '15days' ? 15 : 30;
      const start = new Date(today);
      start.setDate(start.getDate() - (days - 1));
      return { startDate: toLocalDateString(start), endDate: toLocalDateString(today) };
    }
  }
}

/** Rótulo exibido no botão do filtro. */
export function getDateRangeLabel(value: DateRangeValue): string {
  if (value.preset === 'custom' && value.startDate && value.endDate) {
    const fmt = (iso: string) => {
      const [y, m, d] = iso.split('-');
      return `${d}/${m}/${y.slice(2)}`;
    };
    return `${fmt(value.startDate)} – ${fmt(value.endDate)}`;
  }
  return DATE_PRESET_LABELS[value.preset];
}
