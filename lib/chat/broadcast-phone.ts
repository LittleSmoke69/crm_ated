/**
 * Normaliza telefone para disparo em massa (Evolution): só dígitos;
 * prefixa código do país Brasil (55) quando ainda não começa com 55.
 */
export function normalizeBroadcastPhoneDigits(raw: string): string {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('55')) return digits;
  return `55${digits}`;
}
