/**
 * Utilitário para parsing de arquivos CSV
 */

export interface ParsedContact {
  name?: string;
  telefone: string;
  status?: string;
  status_disparo?: boolean;
  status_add_gp?: boolean;
}

/**
 * Parse um arquivo CSV e retorna array de contatos
 */
export function parseCSV(raw: string): ParsedContact[] {
  const firstLine = raw.split(/\r?\n/)[0] || '';
  const delimiter = firstLine.includes(';') && !firstLine.includes(',') ? ';' : ',';

  const lines = raw
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0);

  if (lines.length === 0) return [];

  const header = lines[0].split(delimiter).map(h => h.trim().toLowerCase());

  // Mapeamento melhorado de colunas de telefone (case-insensitive)
  const phoneCandidates = [
    'telefone',
    'phone',
    'phone_number',
    'number',
    'phone_numbwer_number',
    'phonenumber',
    'celular',
    'mobile',
    'whatsapp',
    'tel',
    'fone',
  ];
  const telIdx = header.findIndex(h => phoneCandidates.includes(h));
  
  // Validação: telefone é obrigatório
  if (telIdx < 0) {
    throw new Error('Coluna de telefone não encontrada. Campos aceitos: telefone, phone, phone_number, number, phone_numbwer_number, phonenumber, celular, mobile, whatsapp, tel, fone');
  }

  // Mapeamento melhorado de colunas de nome
  const nameCandidates = ['name', 'nome', 'full_name', 'fullname', 'contact_name', 'contact'];
  const nameIdx = header.findIndex(h => nameCandidates.includes(h));

  const parsed: ParsedContact[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(delimiter);
    const telefoneRaw = telIdx >= 0 ? (cols[telIdx] || '').replace(/\D/g, '') : '';
    
    // Telefone é obrigatório - pula linhas sem telefone válido
    if (!telefoneRaw || telefoneRaw.length < 8) continue;

    parsed.push({
      name: nameIdx >= 0 ? (cols[nameIdx] || '').trim() : undefined,
      telefone: telefoneRaw,
      status: 'pending',
      status_disparo: false,
      status_add_gp: false,
    });
  }
  return parsed;
}

/**
 * Valida se um CSV tem formato válido
 */
export function validateCSV(parsed: ParsedContact[]): {
  valid: boolean;
  error?: string;
} {
  if (parsed.length === 0) {
    return { valid: false, error: 'Nenhum contato válido encontrado' };
  }

  return { valid: true };
}

