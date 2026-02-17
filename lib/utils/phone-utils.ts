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
 * Aceita: 31999887766, 31 99988-7766, +55 31 999887766, 999887766 (sem DDD não é possível E.164 único).
 */
export function normalizeToE164BR(phone: string): string | null {
  if (!phone || typeof phone !== 'string') return null;
  let digits = phone.replace(/\D/g, '');
  if (digits.startsWith('55') && digits.length >= 12) {
    digits = digits.substring(0, 12); // 55 + 2 DDD + 8 ou 9 dígitos
  } else if (digits.startsWith('55') && digits.length >= 11) {
    digits = digits.substring(0, 12);
  } else if (digits.length === 11 && digits.startsWith('9')) {
    digits = '55' + digits; // assume BR
  } else if (digits.length === 10 && !digits.startsWith('9')) {
    digits = '55' + digits; // fixo
  } else if (digits.length >= 10 && digits.length <= 12 && !digits.startsWith('55')) {
    digits = '55' + digits;
  }
  if (digits.length < 12) return null; // 55 + DDD(2) + 8 ou 9
  if (digits.length > 12) digits = digits.substring(0, 12);
  return '+' + digits;
}

/**
 * Converte E.164 ou número para JID WhatsApp (número@s.whatsapp.net).
 */
export function toWaJid(phone: string): string {
  const e164 = normalizeToE164BR(phone) || phone.replace(/\D/g, '');
  const digits = e164.replace(/^\+/, '');
  return `${digits}@s.whatsapp.net`;
}
