export type CrmImportContact = { name: string; phone: string; email: string };

const NAME_HEADERS = ['nome', 'name', 'full_name', 'fullname', 'contact_name', 'contact'];
const PHONE_HEADERS = [
  'telefone',
  'phone',
  'phone_number',
  'phonenumber',
  'celular',
  'mobile',
  'whatsapp',
  'tel',
  'fone',
  'number',
];
const EMAIL_HEADERS = ['email', 'e-mail', 'e_mail', 'mail'];

function stripBom(text: string): string {
  return text.replace(/^\uFEFF/, '');
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/^"|"$/g, '');
}

function unquoteCell(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/""/g, '"').trim();
  }
  return trimmed;
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

/** Divide uma linha CSV respeitando campos entre aspas. */
export function splitCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (!inQuotes && ch === delimiter) {
      cells.push(unquoteCell(current));
      current = '';
      continue;
    }
    current += ch;
  }
  cells.push(unquoteCell(current));
  return cells;
}

function detectDelimiter(firstLine: string): string {
  const counts = { ';': 0, ',': 0, '\t': 0 };
  for (const ch of firstLine) {
    if (ch in counts) counts[ch as keyof typeof counts]++;
  }
  if (counts['\t'] >= counts[';'] && counts['\t'] >= counts[',']) return '\t';
  if (counts[';'] >= counts[',']) return ';';
  return ',';
}

function findColumnIndex(headers: string[], candidates: string[]): number {
  return headers.findIndex((h) => candidates.includes(normalizeHeader(h)));
}

function hasCsvHeader(headers: string[]): boolean {
  const normalized = headers.map(normalizeHeader);
  return normalized.some(
    (h) => NAME_HEADERS.includes(h) || PHONE_HEADERS.includes(h) || EMAIL_HEADERS.includes(h)
  );
}

function finalizeContact(partial: { name: string; phone: string; email: string }): CrmImportContact | null {
  const name = partial.name.trim();
  const phone = partial.phone.trim();
  const email = partial.email.trim();
  if (!name && !phone && !email) return null;
  return {
    name: name || phone || email,
    phone,
    email,
  };
}

/** Token parece telefone BR (8–13 dígitos), não um nome com poucas letras. */
export function looksLikePhoneToken(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  const digits = digitsOnly(trimmed);
  if (digits.length < 8 || digits.length > 13) return false;
  const letters = (trimmed.match(/[A-Za-zÀ-ÿ]/g) || []).length;
  if (letters >= 3) return false;
  const compact = trimmed.replace(/\s/g, '');
  return digits.length / Math.max(compact.length, 1) >= 0.55;
}

/**
 * Identifica nome/telefone/e-mail em pedaços já separados
 * (tab, vírgula, ponto-e-vírgula, etc.).
 */
export function assignNamePhoneEmail(parts: string[]): {
  name: string;
  phone: string;
  email: string;
} {
  let name = '';
  let phone = '';
  let email = '';
  const leftover: string[] = [];

  for (const raw of parts) {
    const p = raw.trim();
    if (!p) continue;
    if (!email && p.includes('@')) {
      email = p;
      continue;
    }
    if (!phone && looksLikePhoneToken(p)) {
      phone = p;
      continue;
    }
    leftover.push(p);
  }

  if (!name && leftover.length) {
    name = leftover.join(' ').trim();
  }

  // Se ainda não achou telefone, procura em leftover (ex.: "Guilherme (11) 99149-7158" veio junto)
  if (!phone && leftover.length === 1) {
    const split = splitInlineNamePhone(leftover[0]);
    if (split) {
      name = split.name || name;
      phone = split.phone;
    }
  }

  return { name, phone, email };
}

/**
 * Separa "Guilherme (11) 99149-7158" ou "Leandro 41992074020"
 * em nome + telefone no final da linha.
 */
export function splitInlineNamePhone(line: string): { name: string; phone: string } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // Telefone no final: DDD opcional entre parênteses, 9 opcional, espaços/traços
  const tail =
    /^(.*?)\s+((?:\+?55[\s.-]*)?(?:\(?\d{2}\)?[\s.-]*)?(?:9[\s.-]*)?\d{4,5}[\s.-]?\d{4})\s*$/u;
  const m = trimmed.match(tail);
  if (m) {
    const name = m[1].trim();
    const phone = m[2].trim();
    if (name && looksLikePhoneToken(phone) && !looksLikePhoneToken(name)) {
      return { name, phone };
    }
  }

  // Fallback mais frouxo: último bloco rico em dígitos
  const loose = /^(.*?)\s+(\+?\d[\d\s().\-]{6,}\d)\s*$/u;
  const m2 = trimmed.match(loose);
  if (m2) {
    const name = m2[1].trim();
    const phone = m2[2].trim();
    if (name && looksLikePhoneToken(phone) && !looksLikePhoneToken(name)) {
      return { name, phone };
    }
  }

  if (looksLikePhoneToken(trimmed)) {
    return { name: '', phone: trimmed };
  }

  return null;
}

function parseCsvRows(text: string): CrmImportContact[] {
  const lines = stripBom(text)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];

  const delimiter = detectDelimiter(lines[0]);
  const headerCells = splitCsvLine(lines[0], delimiter);
  if (!hasCsvHeader(headerCells)) return [];

  const nameIdx = findColumnIndex(headerCells, NAME_HEADERS);
  const phoneIdx = findColumnIndex(headerCells, PHONE_HEADERS);
  const emailIdx = findColumnIndex(headerCells, EMAIL_HEADERS);

  if (nameIdx < 0 && phoneIdx < 0) return [];

  const contacts: CrmImportContact[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i], delimiter);
    const contact = finalizeContact({
      name: nameIdx >= 0 ? cols[nameIdx] ?? '' : '',
      phone: phoneIdx >= 0 ? cols[phoneIdx] ?? '' : '',
      email: emailIdx >= 0 ? cols[emailIdx] ?? '' : '',
    });
    if (contact) contacts.push(contact);
  }
  return contacts;
}

function parsePlainLines(text: string): CrmImportContact[] {
  return stripBom(text)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      let parts: string[] = [];
      if (line.includes('\t')) {
        parts = splitCsvLine(line, '\t').map((p) => p.trim()).filter(Boolean);
      } else if (line.includes(';')) {
        parts = splitCsvLine(line, ';').map((p) => p.trim()).filter(Boolean);
      } else if (line.includes(',')) {
        parts = splitCsvLine(line, ',').map((p) => p.trim()).filter(Boolean);
      } else {
        parts = [line];
      }

      const assigned = assignNamePhoneEmail(parts);
      return finalizeContact(assigned);
    })
    .filter((c): c is CrmImportContact => !!c);
}

/**
 * Importa contatos de texto colado ou CSV/TXT com ou sem cabeçalho.
 * Sem cabeçalho: detecta automaticamente nome e telefone
 * (tab, vírgula, ou telefone formatado no final da linha).
 */
export function parseCrmImportContacts(text: string): CrmImportContact[] {
  const trimmed = stripBom(text).trim();
  if (!trimmed) return [];

  const fromCsv = parseCsvRows(trimmed);
  if (fromCsv.length > 0) return fromCsv;

  return parsePlainLines(trimmed);
}
