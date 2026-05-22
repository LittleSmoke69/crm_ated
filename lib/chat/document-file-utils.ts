/**
 * Utilitários para exibição e download de documentos no chat.
 */

export type DocumentFileKind = 'pdf' | 'txt' | 'word' | 'excel' | 'other';

const EXT_KIND: Record<string, DocumentFileKind> = {
  pdf: 'pdf',
  txt: 'txt',
  doc: 'word',
  docx: 'word',
  xls: 'excel',
  xlsx: 'excel',
};

export function extensionFromName(name: string): string {
  const m = name.toLowerCase().match(/\.([a-z0-9]+)(?:\?|$)/);
  return m?.[1] ?? '';
}

/** Extensão com ponto (ex.: `.docx`) a partir do nome do arquivo ou URL. */
export function dottedExtensionFromName(name: string): string {
  const ext = extensionFromName(name);
  return ext ? `.${ext}` : '';
}

const MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  txt: 'text/plain',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/** MIME a partir da extensão do nome (quando o browser/Meta não informam tipo correto). */
export function inferMimeFromFileName(name: string): string | null {
  const ext = extensionFromName(name);
  return ext ? MIME_BY_EXT[ext] ?? null : null;
}

/** Cabeçalho mágico `%PDF` — valida antes de exibir no visualizador. */
export function isPdfBytes(data: ArrayBuffer | Uint8Array): boolean {
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46
  );
}

export function inferDocumentFileKind(url: string, caption?: string | null): DocumentFileKind {
  // Nome original (caption/filename) tem prioridade sobre a URL do Storage (pode ser .pdf genérico).
  const sources = [caption ?? '', url];
  for (const raw of sources) {
    const ext = extensionFromName(raw);
    if (ext && EXT_KIND[ext]) return EXT_KIND[ext];
  }
  for (const raw of sources) {
    if (/\.pdf(\?|$)/i.test(raw)) return 'pdf';
    if (/\.txt(\?|$)/i.test(raw) || raw.includes('text/plain')) return 'txt';
    if (/\.docx?(\?|$)/i.test(raw)) return 'word';
    if (/\.xlsx?(\?|$)/i.test(raw)) return 'excel';
  }
  return 'other';
}

export function documentDisplayName(caption?: string | null, url?: string | null): string {
  const cap = caption?.trim();
  if (cap && !cap.startsWith('[')) return cap;
  if (!url) return 'Documento';
  try {
    const path = new URL(url).pathname;
    const base = decodeURIComponent(path.split('/').pop() || 'Documento');
    return base || 'Documento';
  } catch {
    return 'Documento';
  }
}

export function documentKindLabel(kind: DocumentFileKind): string {
  switch (kind) {
    case 'pdf':
      return 'PDF';
    case 'txt':
      return 'Texto';
    case 'word':
      return 'Word';
    case 'excel':
      return 'Excel';
    default:
      return 'Arquivo';
  }
}

export function suggestedDownloadName(
  caption: string | null | undefined,
  url: string,
  kind: DocumentFileKind
): string {
  const base = documentDisplayName(caption, url);
  if (extensionFromName(base)) return base;
  const fallbacks: Record<DocumentFileKind, string> = {
    pdf: '.pdf',
    txt: '.txt',
    word: '.docx',
    excel: '.xlsx',
    other: '',
  };
  const ext = fallbacks[kind];
  return ext && !base.includes('.') ? `${base}${ext}` : base;
}

export function contentTypeForDocumentKind(kind: DocumentFileKind): string {
  switch (kind) {
    case 'pdf':
      return 'application/pdf';
    case 'txt':
      return 'text/plain; charset=utf-8';
    case 'word':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case 'excel':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    default:
      return 'application/octet-stream';
  }
}
