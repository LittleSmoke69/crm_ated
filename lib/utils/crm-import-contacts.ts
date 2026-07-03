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
      const parts = splitCsvLine(line, line.includes(';') ? ';' : line.includes('\t') ? '\t' : ',')
        .map((p) => p.trim())
        .filter(Boolean);
      let name = '';
      let phone = '';
      let email = '';
      for (const p of parts) {
        if (!email && p.includes('@')) email = p;
        else if (!phone && p.replace(/\D/g, '').length >= 8) phone = p;
        else if (!name) name = p;
      }
      if (!name) name = parts[0] ?? '';
      return finalizeContact({ name, phone, email });
    })
    .filter((c): c is CrmImportContact => !!c);
}

/**
 * Importa contatos de texto colado ou CSV com cabeçalho (nome/telefone/e-mail).
 */
export function parseCrmImportContacts(text: string): CrmImportContact[] {
  const trimmed = stripBom(text).trim();
  if (!trimmed) return [];

  const fromCsv = parseCsvRows(trimmed);
  if (fromCsv.length > 0) return fromCsv;

  return parsePlainLines(trimmed);
}
