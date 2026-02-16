/**
 * Utilitários para agendamento recorrente de mensagens.
 * Usado pela API de schedule (criação) e pelo worker process-message-queue (execução).
 * Garante que o primeiro next_run_utc seja "hoje" quando hoje for um dos dias e o horário não tiver passado.
 * Todas as horas são interpretadas no timezone do usuário e convertidas para UTC para armazenamento.
 */

const WEEKDAY_NAME_TO_NUM: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

/**
 * Retorna o offset em ms do timezone no instante date (UTC).
 * offset = (UTC - local no TZ), então local no TZ = UTC - offset.
 * Usado para converter "data/hora no TZ" em instante UTC.
 */
function getOffsetMs(timezone: string, date: Date): number {
  const tz = timezone || 'America/Sao_Paulo';
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const get = (type: string) => parseInt(parts.find((p) => p.type === type)?.value || '0', 10);
  const localAsUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
    0
  );
  return date.getTime() - localAsUtc;
}

/**
 * Converte uma data/hora no timezone do usuário para instante UTC (ISO string).
 * Ex: 13/02/2026 12:50 em America/Sao_Paulo → 2026-02-13T15:50:00.000Z
 */
export function dateAtTimezoneToUTC(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timezone: string
): string {
  const tz = timezone || 'America/Sao_Paulo';
  const L = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const offset = getOffsetMs(tz, new Date(L));
  return new Date(L + offset).toISOString();
}

/**
 * Retorna a data civil (ano, mês, dia) e hora atuais no timezone.
 */
export function getCurrentDateAndTimeInTimezone(timezone: string): {
  year: number;
  month: number;
  day: number;
  dayOfWeek: number;
  hours: number;
  minutes: number;
} {
  const tz = timezone || 'America/Sao_Paulo';
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'long',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '0';
  const dayName = get('weekday').toLowerCase();
  return {
    year: parseInt(get('year'), 10),
    month: parseInt(get('month'), 10),
    day: parseInt(get('day'), 10),
    dayOfWeek: WEEKDAY_NAME_TO_NUM[dayName] ?? 0,
    hours: parseInt(get('hour'), 10),
    minutes: parseInt(get('minute'), 10),
  };
}

export function getCurrentDayAndTimeInTimezone(
  timezone: string
): { day: number; hours: number; minutes: number } {
  const tz = timezone || 'America/Sao_Paulo';
  const full = getCurrentDateAndTimeInTimezone(tz);
  return {
    day: full.dayOfWeek,
    hours: full.hours,
    minutes: full.minutes,
  };
}

const WEEKDAY_NUM_TO_NAME: Record<number, string> = {
  0: 'sunday',
  1: 'monday',
  2: 'tuesday',
  3: 'wednesday',
  4: 'thursday',
  5: 'friday',
  6: 'saturday',
};

/** Converte valor (nome ou número 0-6) para nome do dia em minúsculo. */
function toDayName(d: string | number): string | null {
  const s = String(d).toLowerCase().trim();
  if (WEEKDAY_NAME_TO_NUM[s] !== undefined) return s;
  const num = parseInt(s, 10);
  if (!isNaN(num) && num >= 0 && num <= 6) return WEEKDAY_NUM_TO_NAME[num];
  return null;
}

export function normalizeRecurringDays(recurringDays: unknown): string[] {
  if (!recurringDays) return [];

  if (Array.isArray(recurringDays)) {
    const names = recurringDays
      .map((d) => toDayName(d))
      .filter((name): name is string => name != null);
    return [...new Set(names)];
  }

  if (typeof recurringDays === 'string') {
    try {
      const parsed = JSON.parse(recurringDays) as unknown;
      if (Array.isArray(parsed)) {
        const names = parsed
          .map((d) => toDayName(d))
          .filter((name): name is string => name != null);
        return [...new Set(names)];
      }
    } catch {
      const name = toDayName(recurringDays);
      return name ? [name] : [];
    }
  }

  return [];
}

export function isTodayInRecurringDays(
  recurringDays: unknown,
  timezone: string
): boolean {
  const normalized = normalizeRecurringDays(recurringDays);
  if (normalized.length === 0) return false;
  const { day } = getCurrentDayAndTimeInTimezone(timezone || 'America/Sao_Paulo');
  const dayNames = [
    'sunday',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
  ];
  const todayName = dayNames[day];
  return normalized.includes(todayName);
}

export function isCurrentTimeAtOrPastRecurringTime(
  recurringTime: string,
  timezone: string
): boolean {
  if (!recurringTime || !recurringTime.trim()) return false;
  const parts = recurringTime
    .trim()
    .split(':')
    .map((n) => parseInt(n, 10) || 0);
  const [hours = 0, minutes = 0] = parts;
  const tz = timezone || 'America/Sao_Paulo';
  const { hours: currentHour, minutes: currentMinute } =
    getCurrentDayAndTimeInTimezone(tz);
  return (
    currentHour > hours ||
    (currentHour === hours && currentMinute >= minutes)
  );
}

type LogFn = (msg: string, ...args: unknown[]) => void;

function noop(_msg: string, ..._args: unknown[]) {}

/**
 * Calcula o próximo horário de execução para agendamento recorrente.
 * Horário é sempre interpretado no timezone do usuário e convertido para UTC.
 * - Se hoje (no TZ) for um dos dias e o horário ainda não passou → executa HOJE nesse horário no TZ.
 * - Se criou no dia marcado e ainda não deu o horário → executa no mesmo dia no horário certo.
 * - Se criou no domingo e tem segunda nos dias → próxima execução é segunda no horário marcado.
 */
export function calculateNextRecurringRun(
  cronExpr: string,
  timezone: string,
  recurringDays: unknown,
  recurringTime: string,
  log: LogFn = noop
): string {
  const tz = timezone || 'America/Sao_Paulo';

  if (cronExpr && cronExpr.trim()) {
    const cronResult = calculateNextFromCronExpr(cronExpr, tz, log);
    if (cronResult) return cronResult;
  }

  const normalizedDays = normalizeRecurringDays(recurringDays);
  if (normalizedDays.length === 0 || !recurringTime) return '';

  const [targetHour, targetMinute] = recurringTime.split(':').map(Number);
  const current = getCurrentDateAndTimeInTimezone(tz);

  const dayMap: Record<string, number> = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
  };

  const selectedDayNumbers = normalizedDays
    .map((d) => dayMap[d.toLowerCase()])
    .filter((d) => d !== undefined)
    .sort((a, b) => a - b) as number[];

  if (selectedDayNumbers.length === 0) return '';

  const hasTimePassedToday =
    current.hours > targetHour ||
    (current.hours === targetHour && current.minutes >= targetMinute);
  const isTodaySelected = selectedDayNumbers.includes(current.dayOfWeek);

  // Hoje é um dos dias e o horário ainda não passou → próximo run é HOJE no horário marcado (no TZ)
  if (isTodaySelected && !hasTimePassedToday) {
    return dateAtTimezoneToUTC(
      current.year,
      current.month,
      current.day,
      targetHour,
      targetMinute,
      tz
    );
  }

  // Quando todos os dias da semana estão ativos, próxima execução = amanhã (sempre +1), nunca +7
  const allDaysActive = selectedDayNumbers.length === 7;
  if (allDaysActive && hasTimePassedToday) {
    const daysToAdd = 1;
    const noonTodayUtc = new Date(
      dateAtTimezoneToUTC(current.year, current.month, current.day, 12, 0, tz)
    ).getTime();
    const nextRunUtcInstant = noonTodayUtc + daysToAdd * 24 * 60 * 60 * 1000;
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = formatter.formatToParts(new Date(nextRunUtcInstant));
    const get = (type: string) => parseInt(parts.find((p) => p.type === type)?.value || '0', 10);
    return dateAtTimezoneToUTC(get('year'), get('month'), get('day'), targetHour, targetMinute, tz);
  }

  // Próximo dia da semana (no timezone do usuário)
  let daysToAdd: number;
  const nextDayInWeek = selectedDayNumbers.find((d) => d > current.dayOfWeek);
  if (nextDayInWeek !== undefined) {
    daysToAdd = nextDayInWeek - current.dayOfWeek;
  } else {
    daysToAdd = (7 - current.dayOfWeek + selectedDayNumbers[0]) % 7 || 7;
  }

  // Hoje selecionado e horário já passou (e não são todos os dias) → próxima ocorrência na semana que vem
  if (isTodaySelected && hasTimePassedToday && !allDaysActive) {
    daysToAdd = 7;
  }

  // "Hoje ao meio-dia" no TZ → UTC, + N dias, depois formatar no TZ para obter (ano, mês, dia)
  const noonTodayUtc = new Date(
    dateAtTimezoneToUTC(current.year, current.month, current.day, 12, 0, tz)
  ).getTime();
  const nextRunUtcInstant = noonTodayUtc + daysToAdd * 24 * 60 * 60 * 1000;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(new Date(nextRunUtcInstant));
  const get = (type: string) => parseInt(parts.find((p) => p.type === type)?.value || '0', 10);
  const nextY = get('year');
  const nextM = get('month');
  const nextD = get('day');

  return dateAtTimezoneToUTC(nextY, nextM, nextD, targetHour, targetMinute, tz);
}

function calculateNextFromCronExpr(
  cronExpr: string,
  timezone: string,
  log: LogFn
): string | null {
  if (!cronExpr || !cronExpr.trim()) return null;

  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length !== 5) return null;

  const [cronMinute, cronHour, , , cronWeekdays] = parts;
  const tz = timezone || 'America/Sao_Paulo';
  const [targetHour, targetMinute] = [Number(cronHour), Number(cronMinute)];

  if (cronWeekdays === '*') {
    const current = getCurrentDateAndTimeInTimezone(tz);
    const hasTimePassedToday =
      current.hours > targetHour ||
      (current.hours === targetHour && current.minutes >= targetMinute);
    if (!hasTimePassedToday) {
      return dateAtTimezoneToUTC(
        current.year,
        current.month,
        current.day,
        targetHour,
        targetMinute,
        tz
      );
    }
    const noonTodayUtc = new Date(
      dateAtTimezoneToUTC(current.year, current.month, current.day, 12, 0, tz)
    ).getTime();
    const nextRunUtcInstant = noonTodayUtc + 24 * 60 * 60 * 1000;
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const formatterParts = formatter.formatToParts(new Date(nextRunUtcInstant));
    const get = (type: string) =>
      parseInt(formatterParts.find((p) => p.type === type)?.value || '0', 10);
    return dateAtTimezoneToUTC(
      get('year'),
      get('month'),
      get('day'),
      targetHour,
      targetMinute,
      tz
    );
  }

  const weekdayNumbers = cronWeekdays
    .split(',')
    .map((d) => Number(d.trim()))
    .filter((d) => !isNaN(d) && d >= 0 && d <= 6)
    .sort((a, b) => a - b);

  if (weekdayNumbers.length === 0) return null;

  const current = getCurrentDateAndTimeInTimezone(tz);
  const hasTimePassedToday =
    current.hours > targetHour ||
    (current.hours === targetHour && current.minutes >= targetMinute);
  const isTodaySelected = weekdayNumbers.includes(current.dayOfWeek);

  if (isTodaySelected && !hasTimePassedToday) {
    return dateAtTimezoneToUTC(
      current.year,
      current.month,
      current.day,
      targetHour,
      targetMinute,
      tz
    );
  }

  let daysToAdd: number;
  const nextDayInWeek = weekdayNumbers.find((d) => d > current.dayOfWeek);
  if (nextDayInWeek !== undefined) {
    daysToAdd = nextDayInWeek - current.dayOfWeek;
  } else {
    daysToAdd = (7 - current.dayOfWeek + weekdayNumbers[0]) % 7 || 7;
  }

  // Quando todos os dias da semana estão ativos (cron * ou 0-6), próxima execução = amanhã
  if (isTodaySelected && hasTimePassedToday) {
    const allDaysActive = weekdayNumbers.length === 7;
    daysToAdd = allDaysActive ? 1 : 7;
  }

  const noonTodayUtc = new Date(
    dateAtTimezoneToUTC(current.year, current.month, current.day, 12, 0, tz)
  ).getTime();
  const nextRunUtcInstant = noonTodayUtc + daysToAdd * 24 * 60 * 60 * 1000;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const formatterParts = formatter.formatToParts(new Date(nextRunUtcInstant));
  const get = (type: string) =>
    parseInt(formatterParts.find((p) => p.type === type)?.value || '0', 10);
  return dateAtTimezoneToUTC(
    get('year'),
    get('month'),
    get('day'),
    targetHour,
    targetMinute,
    tz
  );
}
