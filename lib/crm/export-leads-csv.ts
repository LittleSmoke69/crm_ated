import type { Lead } from '@/components/CRM/types';

/**
 * Exportação CSV no CRM só para super_admin, admin e gerente.
 * Consultores e qualquer outro cargo não veem o botão (comparação normalizada).
 */
export function canUserExportCrmLeadsCsv(userStatus: string | null | undefined): boolean {
  const s = (userStatus ?? '').trim().toLowerCase();
  return s === 'super_admin' || s === 'admin' || s === 'gerente';
}

function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[;"'\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export type ExportLeadsCsvOptions = {
  filenamePrefix: string;
  /** Colunas extras de leads transferidos (página Transferido) */
  includeTransferredFields?: boolean;
  /** Mapa lead id → colunas do quadro CRM (filtros + regras das colunas); quando ausente, não inclui coluna no CSV */
  crmColumnLabelsByLeadId?: Map<string, string>;
  /** Nome da banca selecionada no filtro (ou todas); usado no nome do arquivo */
  filenameBancaLabel?: string | null;
  /** Primeiro nome do consultor (dono do pipeline / contexto); usado no nome do arquivo */
  filenameConsultantFirstName?: string | null;
};

/** Primeiro token do nome completo (para nome de arquivo). */
export function firstNameFromFullName(fullName: string | null | undefined): string {
  if (!fullName?.trim()) return '';
  const parts = fullName.trim().split(/\s+/);
  return parts[0] ?? '';
}

function sanitizeCsvFilenameSegment(raw: string | null | undefined, maxLen = 40): string {
  const s = (raw ?? '').trim();
  if (!s) return '';
  return s
    .replace(/[\u0000-\u001F<>:\"/\\|?*]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, maxLen);
}

function formatTags(lead: Lead): string {
  const tags = lead.tags || [];
  if (tags.length === 0) return '';
  return tags.map((t) => t.label || t.id).join(' | ');
}

function boolPt(v: boolean | undefined): string {
  if (v === true) return 'Sim';
  if (v === false) return 'Não';
  return '';
}

/**
 * Gera e baixa um CSV (UTF-8 com BOM, separador `;`) com dados dos leads visíveis na tela.
 */
export function downloadLeadsCsv(leads: Lead[], options: ExportLeadsCsvOptions): void {
  const {
    filenamePrefix,
    includeTransferredFields,
    crmColumnLabelsByLeadId,
    filenameBancaLabel,
    filenameConsultantFirstName,
  } = options;
  const includeCrmColumns = crmColumnLabelsByLeadId != null;

  const baseHeaders = [
    'ID',
    'ID original',
    'Nome',
    'Telefone',
    'E-mail',
    'Status',
    'Temperatura',
    'Banca',
    'URL banca',
    'Total depositado',
    'Total apostado',
    'Total ganho',
    'Qtd depósitos',
    'Saldo',
    'Saque disponível',
    'Último depósito',
    'Última interação',
    'Cadastro',
    'Afiliado',
    'Nome afiliado',
    'Estrelas',
    'Aposta estrelas',
    'Etiquetas',
    ...(includeCrmColumns ? ['Colunas CRM'] : []),
  ];

  const transferHeaders = includeTransferredFields
    ? [
        'Transferido em',
        'Consultor origem (nome)',
        'Consultor origem (e-mail)',
        'Tag redistribuição',
        'Vinculado',
      ]
    : [];

  const headers = [...baseHeaders, ...transferHeaders];

  const rows = leads.map((l) => {
    const row: unknown[] = [
      l.id,
      l.original_id ?? '',
      l.name ?? '',
      l.phone ?? '',
      l.email ?? '',
      l.status ?? '',
      l.temperature ?? l.thermalStatus ?? '',
      l.banca_name ?? '',
      l.banca_url ?? '',
      l.total_depositado ?? '',
      l.total_apostado ?? '',
      l.total_ganho ?? '',
      l.total_depositos_count ?? '',
      l.balance ?? '',
      l.available_withdraw ?? '',
      l.last_deposit_at ?? '',
      l.last_interaction ?? l.lastInteractionAt ?? '',
      l.created_at ?? l.createdAt ?? '',
      boolPt(l.is_affiliate === true),
      l.affiliate_name ?? '',
      l.stars ?? '',
      l.aposta_estrelas ?? '',
      formatTags(l),
    ];

    if (includeCrmColumns) {
      row.push(crmColumnLabelsByLeadId?.get(String(l.id)) ?? '');
    }

    if (includeTransferredFields) {
      row.push(
        l.transferred_at ?? '',
        l.original_consultant_name ?? '',
        l.original_consultant_email ?? '',
        l.tag_de_redistribuicao ?? '',
        boolPt(l.vinculado === true)
      );
    }

    return row;
  });

  const BOM = '\uFEFF';
  const sep = ';';
  const lines = [
    headers.map(escapeCsvCell).join(sep),
    ...rows.map((r) => r.map(escapeCsvCell).join(sep)),
  ];
  const csv = BOM + lines.join('\r\n');

  const safePrefix = filenamePrefix.replace(/[^\w\-]+/g, '_').slice(0, 60);
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const segBanca = sanitizeCsvFilenameSegment(filenameBancaLabel?.trim() || 'todas-as-bancas');
  const segConsult = sanitizeCsvFilenameSegment(filenameConsultantFirstName?.trim() || 'consultor');
  const filename = `${safePrefix}_${segBanca}_${segConsult}_${stamp}.csv`;

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
