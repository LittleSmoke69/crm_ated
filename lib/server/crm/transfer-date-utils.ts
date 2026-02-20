/**
 * Utilitários de data para APIs de transferência de leads (Histórico & Conversão).
 * As datas são interpretadas no fuso de São Paulo para que o filtro "19/02" signifique
 * o dia inteiro em horário local, não UTC.
 */

/** Normaliza string de data para YYYY-MM-DD (aceita YYYY-MM-DD ou DD/MM/YYYY). */
export function normalizeDateParam(value: string | null | undefined): string | null {
  const s = value?.trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const ddmmyy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (ddmmyy) return `${ddmmyy[3]}-${ddmmyy[2].padStart(2, '0')}-${ddmmyy[1].padStart(2, '0')}`;
  return null;
}

/**
 * Converte data YYYY-MM-DD para início do dia em São Paulo (ISO UTC).
 * Ex: "2025-02-19" → "2025-02-19T03:00:00.000Z" (00:00 BRT = 03:00 UTC)
 */
export function dateToStartOfDaySãoPauloISO(yyyyMmDd: string): string {
  return new Date(`${yyyyMmDd}T00:00:00.000-03:00`).toISOString();
}

/**
 * Converte data YYYY-MM-DD para fim do dia em São Paulo (ISO UTC).
 * Ex: "2025-02-19" → "2025-02-20T02:59:59.999Z" (23:59:59 BRT)
 */
export function dateToEndOfDaySãoPauloISO(yyyyMmDd: string): string {
  return new Date(`${yyyyMmDd}T23:59:59.999-03:00`).toISOString();
}
