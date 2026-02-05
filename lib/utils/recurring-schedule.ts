/**
 * Utilitários para agendamento recorrente de mensagens.
 * Usado pela API de schedule (criação) e pelo worker process-message-queue (execução).
 * Garante que o primeiro next_run_utc seja "hoje" quando hoje for um dos dias e o horário não tiver passado.
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

export function getCurrentDayAndTimeInTimezone(
  timezone: string
): { day: number; hours: number; minutes: number } {
  const tz = timezone || 'America/Recife';
  const now = new Date();
  const dayFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'long',
  });
  const dayName = dayFormatter.format(now).toLowerCase();
  const timeFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = timeFormatter.formatToParts(now);
  const hours = parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10);
  const minutes = parseInt(
    parts.find((p) => p.type === 'minute')?.value || '0',
    10
  );
  return {
    day: WEEKDAY_NAME_TO_NUM[dayName] ?? 0,
    hours,
    minutes,
  };
}

export function normalizeRecurringDays(recurringDays: unknown): string[] {
  if (!recurringDays) return [];

  if (Array.isArray(recurringDays)) {
    return recurringDays.map((d) => String(d).toLowerCase().trim());
  }

  if (typeof recurringDays === 'string') {
    try {
      const parsed = JSON.parse(recurringDays) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.map((d) => String(d).toLowerCase().trim());
      }
    } catch {
      return [recurringDays.toLowerCase().trim()];
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
  const { day } = getCurrentDayAndTimeInTimezone(timezone || 'America/Recife');
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
  const tz = timezone || 'America/Recife';
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
 * Se hoje for um dos dias selecionados e o horário ainda não passou, retorna HOJE nesse horário.
 */
export function calculateNextRecurringRun(
  cronExpr: string,
  timezone: string,
  recurringDays: unknown,
  recurringTime: string,
  log: LogFn = noop
): string {
  const tz = timezone || 'America/Recife';

  if (cronExpr && cronExpr.trim()) {
    const cronResult = calculateNextFromCronExpr(cronExpr, tz, log);
    if (cronResult) return cronResult;
  }

  const normalizedDays = normalizeRecurringDays(recurringDays);
  if (normalizedDays.length === 0 || !recurringTime) return '';

  const [hours, minutes] = recurringTime.split(':').map(Number);
  const { day: currentDay, hours: currentHour, minutes: currentMinute } =
    getCurrentDayAndTimeInTimezone(tz);

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
    currentHour > hours ||
    (currentHour === hours && currentMinute >= minutes);
  const isTodaySelected = selectedDayNumbers.includes(currentDay);

  const nextDate = new Date();
  nextDate.setHours(hours, minutes, 0, 0);

  if (isTodaySelected && !hasTimePassedToday) {
    return nextDate.toISOString();
  }

  let nextDay = selectedDayNumbers.find((d) => d > currentDay);
  if (nextDay === undefined) {
    nextDay = selectedDayNumbers[0];
    const daysUntilNext = (7 - currentDay + nextDay) % 7 || 7;
    nextDate.setDate(nextDate.getDate() + daysUntilNext);
  } else {
    const daysUntilNext = nextDay - currentDay;
    nextDate.setDate(nextDate.getDate() + daysUntilNext);
  }

  if (isTodaySelected && hasTimePassedToday) {
    nextDate.setDate(nextDate.getDate() + 7);
  }

  return nextDate.toISOString();
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

  if (cronWeekdays === '*') {
    const now = new Date();
    const [hours, minutes] = [Number(cronHour), Number(cronMinute)];
    const nextDate = new Date(now);
    nextDate.setHours(hours, minutes, 0, 0);
    if (nextDate <= now) nextDate.setDate(nextDate.getDate() + 1);
    return nextDate.toISOString();
  }

  const weekdayNumbers = cronWeekdays
    .split(',')
    .map((d) => Number(d.trim()))
    .filter((d) => !isNaN(d) && d >= 0 && d <= 6)
    .sort((a, b) => a - b);

  if (weekdayNumbers.length === 0) return null;

  const tz = timezone || 'America/Recife';
  const now = new Date();
  const [hours, minutes] = [Number(cronHour), Number(cronMinute)];
  const { day: currentDay, hours: currentHour, minutes: currentMinute } =
    getCurrentDayAndTimeInTimezone(tz);

  const nextDate = new Date(now);
  nextDate.setHours(hours, minutes, 0, 0);

  const isTodaySelected = weekdayNumbers.includes(currentDay);
  const hasTimePassedToday =
    currentHour > hours ||
    (currentHour === hours && currentMinute >= minutes);

  if (isTodaySelected && !hasTimePassedToday) {
    return nextDate.toISOString();
  }

  let nextDay = weekdayNumbers.find((d) => d > currentDay);
  if (nextDay === undefined) {
    nextDay = weekdayNumbers[0];
    const daysUntilNext = (7 - currentDay + nextDay) % 7 || 7;
    nextDate.setDate(nextDate.getDate() + daysUntilNext);
  } else {
    const daysUntilNext = nextDay - currentDay;
    nextDate.setDate(nextDate.getDate() + daysUntilNext);
  }

  if (isTodaySelected && hasTimePassedToday) {
    nextDate.setDate(nextDate.getDate() + 7);
  }

  return nextDate.toISOString();
}
