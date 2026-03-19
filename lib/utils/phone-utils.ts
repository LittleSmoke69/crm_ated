/**
 * Utilitários para extração e normalização de telefones (E.164 BR).
 * Usado pelo módulo Anti-Spam para blacklist e detecção de spam.
 */

/** Regex para sequências de 10-11 dígitos (DDD + número BR) ou com +55 */
const PHONE_PATTERNS = [
  /\b(\+?55\s?\d{2}\s?\d{4,5}\s?-?\d{4})\b/g,
  /\b(\d{2})\s*[\s\.\-]?\s*(\d{4,5})\s*[\s\.\-]?\s*(\d{4})\b/g,
  /\b(9\d{4}\s?-?\d{4})\b/g,
  /\b(\d{2}\s?\d{4,5}\s?-?\d{4})\b/g,
];

/**
 * Extrai números de telefone de um texto (BR).
 * Retorna apenas números normalizados (sem duplicatas).
 */
export function extractPhones(text: string): string[] {
  if (!text || typeof text !== 'string') return [];
  const normalized = new Set<string>();
  const raw: string[] = [];

  // +55 XX XXXXX-XXXX ou +55 XX XXXXXXXXX
  const m1 = text.matchAll(/\b(\+?55\s?\d{2}\s?\d{4,5}\s?\-?\d{4})\b/g);
  for (const match of m1) {
    raw.push(match[1].replace(/\s/g, '').replace(/-/g, ''));
  }

  // XX XXXXX-XXXX ou XX XXXXXXXXX (sem +55)
  const m2 = text.matchAll(/\b(\d{2})\s*[\s\.\-]?\s*(\d{4,5})\s*[\s\.\-]?\s*(\d{4})\b/g);
  for (const match of m2) {
    const full = match[1] + match[2] + match[3];
    if (full.length >= 10 && full.length <= 11) raw.push(full);
  }

  // 9XXXX-XXXX (só celular sem DDD)
  const m3 = text.matchAll(/\b(9\d{4}\s?\-?\d{4})\b/g);
  for (const match of m3) {
    raw.push(match[1].replace(/\s/g, '').replace(/-/g, ''));
  }

  for (const p of raw) {
    const e164 = normalizeToE164BR(p);
    if (e164) normalized.add(e164);
  }

  return Array.from(normalized);
}

/**
 * Normaliza número para E.164 Brasil (+55...).
 * Aceita: 31999887766, 31 99988-7766, +55 31 999887766, JIDs WhatsApp.
 * Rejeita números que não correspondam ao formato BR válido:
 *   - Fixo:   55 + DDD(2) + 8 dígitos  = 12 dígitos total
 *   - Móvel:  55 + DDD(2) + 9XXXXXXXX  = 13 dígitos total
 */
export function normalizeToE164BR(phone: string): string | null {
  if (!phone || typeof phone !== 'string') return null;
  let digits = phone.replace(/\D/g, '');
  if (!digits.length) return null;

  // Remove zeros à esquerda (ex.: 05531999887766 -> 5531999887766)
  digits = digits.replace(/^0+/, '');

  // Adiciona prefixo 55 se ausente (ex.: 31999887766 -> 5531999887766)
  if (!digits.startsWith('55')) {
    digits = '55' + digits;
  }

  // 55 seguido de 0 (código de saída) + 11 dígitos: remove o 0 (ex.: 55031999887766 -> 5531999887766)
  if (digits.length === 14 && digits.startsWith('55') && digits[2] === '0') {
    digits = digits.slice(0, 2) + digits.slice(3);
  }

  // Apenas 12 (fixo) ou 13 (móvel) dígitos são válidos para BR
  if (digits.length === 12 || digits.length === 13) {
    return '+' + digits;
  }

  return null;
}

/**
 * Converte E.164 ou número para JID WhatsApp (número@s.whatsapp.net).
 */
export function toWaJid(phone: string): string {
  const e164 = normalizeToE164BR(phone) || phone.replace(/\D/g, '');
  const digits = e164.replace(/^\+/, '');
  return `${digits}@s.whatsapp.net`;
}

/**
 * Formata número para exibição com +55 (ex.: +55 11 99988-7766).
 * Aceita dígitos com ou sem 55 no início.
 */
export function formatPhoneDisplay(phone: string): string {
  if (!phone || typeof phone !== 'string') return phone;
  const digits = phone.replace(/\D/g, '');
  if (!digits.length) return phone;
  let d = digits.startsWith('55') ? digits : '55' + digits;
  if (d.length === 12) return `+55 ${d.slice(2, 4)} ${d.slice(4, 8)}-${d.slice(8)}`;
  if (d.length === 13) return `+55 ${d.slice(2, 4)} ${d.slice(4, 9)}-${d.slice(9)}`;
  return d.length >= 2 ? '+55 ' + d.slice(2) : '+' + d;
}

/**
 * Formato para listas: apenas dígitos, com 55 (ex.: 558396667315 ou 5598396667315).
 * Sem prefixo + e sem espaços ou hífens.
 */
export function formatPhoneToList(phone: string): string {
  if (!phone || typeof phone !== 'string') return phone;
  const digits = phone.replace(/\D/g, '');
  if (!digits.length) return phone;
  return digits.startsWith('55') ? digits : '55' + digits;
}
