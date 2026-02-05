/**
 * Parser para lista de números na feature Limpeza de Lista.
 * Aceita textarea (um número por linha) ou CSV/TXT com coluna phone.
 */

const MAX_NUMBERS = 1000;

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '').slice(0, 15);
}
const MIN_PHONE_LENGTH = 8;

/**
 * Extrai números de texto: linhas únicas, apenas dígitos, sem vazios.
 */
export function parsePhoneList(raw: string): string[] {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) return [];

  const first = lines[0].toLowerCase();
  const hasHeader =
    /^(phone|telefone|number|tel|fone|celular|whatsapp)$/.test(first) ||
    (first.includes(',') && /phone|telefone|number/.test(first));

  let startIndex = hasHeader ? 1 : 0;
  const numbers: string[] = [];

  for (let i = startIndex; i < lines.length && numbers.length < MAX_NUMBERS; i++) {
    const line = lines[i];
    let phone: string;
    if (line.includes(',') || line.includes(';')) {
      const delimiter = line.includes(';') ? ';' : ',';
      const cols = line.split(delimiter).map((c) => c.trim());
      const telIdx = cols.findIndex((c) => /^\d+$/.test(c.replace(/\D/g, '')) && c.replace(/\D/g, '').length >= MIN_PHONE_LENGTH);
      phone = telIdx >= 0 ? cols[telIdx] : cols[0] || '';
    } else {
      phone = line;
    }
    const normalized = normalizePhone(phone);
    if (normalized.length >= MIN_PHONE_LENGTH) {
      numbers.push(normalized);
    }
  }

  return numbers.slice(0, MAX_NUMBERS);
}

/**
 * Deduplica preservando ordem (primeira ocorrência).
 */
export function deduplicatePhones(phones: string[]): string[] {
  const seen = new Set<string>();
  return phones.filter((p) => {
    if (seen.has(p)) return false;
    seen.add(p);
    return true;
  });
}
