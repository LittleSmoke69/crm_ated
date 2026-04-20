/**
 * Utilitários para exportação de CSV.
 *
 * Decisões de formato:
 * - Separador: ';' (padrão PT-BR/Excel) — menos conflito com vírgula decimal.
 * - Encoding: UTF-8 com BOM — abre corretamente no Excel em Windows PT-BR.
 * - Quoting: sempre entre aspas duplas, com aspas internas duplicadas ("").
 * - CSV injection: prefixa com aspa simples valores que começam com '=', '+', '-', '@'
 *   para impedir execução de fórmulas em planilhas (OWASP).
 *
 * Metadata:
 * - As 6 primeiras linhas (comentário informativo) começam com '#'.
 * - Linha em branco separa metadata da tabela propriamente dita.
 */

export type CsvCellValue = string | number | boolean | null | undefined | Date;

export interface CsvColumn<T> {
  header: string;
  get: (row: T) => CsvCellValue;
  /** Força formatação numérica PT-BR (com vírgula). Default: false para strings, true p/ number. */
  numeric?: boolean;
}

export interface CsvExportMetadata {
  banca: string | null;
  bancaUrl: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  scope: string;
  generatedAt?: Date;
  extra?: Array<{ label: string; value: string }>;
}

const CSV_SEPARATOR = ';';
const CSV_LINE_BREAK = '\r\n';
const UTF8_BOM = '\uFEFF';
const FORMULA_PREFIXES = ['=', '+', '-', '@'];

/**
 * Sanitiza um valor de célula, aplicando:
 * - Prevenção de CSV injection (valores que começam com caracteres perigosos).
 * - Escape de aspas duplas.
 * - Wrap em aspas.
 */
export function formatCsvCell(value: CsvCellValue, numeric = false): string {
  if (value === null || value === undefined) return '""';

  let str: string;
  if (value instanceof Date) {
    str = value.toISOString();
  } else if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      str = '';
    } else if (numeric) {
      str = value.toLocaleString('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    } else {
      str = String(value);
    }
  } else if (typeof value === 'boolean') {
    str = value ? 'Sim' : 'Não';
  } else {
    str = String(value);
  }

  // Prevenção de CSV injection
  if (str.length > 0 && FORMULA_PREFIXES.includes(str[0])) {
    str = `'${str}`;
  }

  // Escape de aspas duplas + wrap
  str = str.replace(/"/g, '""');
  return `"${str}"`;
}

/**
 * Formata uma data YYYY-MM-DD para DD/MM/YYYY (amigável no Excel PT-BR).
 */
export function formatDateBr(iso: string | null | undefined): string {
  if (!iso) return '';
  const parts = String(iso).split('T')[0].split('-');
  if (parts.length !== 3) return String(iso);
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

/**
 * Constrói as linhas de metadata (comentário) que vão no topo do CSV.
 */
function buildMetadataLines(meta: CsvExportMetadata): string[] {
  const lines: string[] = [];
  const generatedAt = meta.generatedAt ?? new Date();
  const generatedAtStr = generatedAt.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
  });

  lines.push(`# Relatório Zaploto - Meu Desempenho`);
  lines.push(`# Banca: ${meta.banca || 'Todas as bancas'}${meta.bancaUrl ? ` (${meta.bancaUrl})` : ''}`);
  lines.push(
    `# Período: ${meta.dateFrom ? formatDateBr(meta.dateFrom) : 'início'} a ${
      meta.dateTo ? formatDateBr(meta.dateTo) : 'hoje'
    }`
  );
  lines.push(`# Escopo: ${meta.scope}`);
  if (meta.extra && meta.extra.length > 0) {
    for (const item of meta.extra) {
      lines.push(`# ${item.label}: ${item.value}`);
    }
  }
  lines.push(`# Gerado em: ${generatedAtStr}`);
  lines.push('');
  return lines;
}

/**
 * Monta o conteúdo completo de um CSV (metadata + header + linhas).
 */
export function buildCsv<T>(
  rows: T[],
  columns: CsvColumn<T>[],
  meta: CsvExportMetadata
): string {
  const metaLines = buildMetadataLines(meta);
  const headerLine = columns.map((c) => formatCsvCell(c.header)).join(CSV_SEPARATOR);
  const dataLines = rows.map((row) =>
    columns.map((c) => formatCsvCell(c.get(row), c.numeric ?? false)).join(CSV_SEPARATOR)
  );

  return UTF8_BOM + [...metaLines, headerLine, ...dataLines].join(CSV_LINE_BREAK);
}

/**
 * Converte uma URL/nome em slug seguro para arquivo.
 */
export function slugifyForFileName(input: string | null | undefined): string {
  if (!input) return 'todas-bancas';
  return String(input)
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'banca';
}

/**
 * Gera um nome de arquivo padronizado.
 * Ex: meu-desempenho_resumo_lototrevo-online_2026-03-22_2026-04-20.csv
 */
export function buildCsvFileName(params: {
  kind: 'resumo' | 'apostas-por-usuario' | 'depositos-por-usuario' | 'comissao-por-tipo';
  bancaSlugOrName: string | null | undefined;
  dateFrom: string | null | undefined;
  dateTo: string | null | undefined;
}): string {
  const parts = [
    'meu-desempenho',
    params.kind,
    slugifyForFileName(params.bancaSlugOrName),
    params.dateFrom || 'inicio',
    params.dateTo || 'hoje',
  ];
  return `${parts.filter(Boolean).join('_')}.csv`;
}

/**
 * Dispara o download do CSV no navegador.
 */
export function downloadCsv(content: string, filename: string): void {
  if (typeof window === 'undefined') return;
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
