'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRequireAuth } from '@/utils/useRequireAuth';
import { Download, Loader2, FileText, Image as ImageIcon, FileSpreadsheet, File as FileIcon, Lock, Eye, X } from 'lucide-react';

type Material = {
  id: string;
  title: string;
  type: string;
  description: string | null;
  file_path: string;
  category: string | null;
  created_at: string;
};

const TYPE_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Todos' },
  { value: 'image', label: 'Imagens' },
  { value: 'pdf', label: 'PDF' },
  { value: 'doc', label: 'Documentos (DOC/DOCX)' },
  { value: 'table', label: 'Planilhas / Tabelas' },
  { value: 'other', label: 'Outros' },
];

function typeLabel(t: string): string {
  const map: Record<string, string> = {
    pdf: 'PDF',
    doc: 'DOC',
    docx: 'DOCX',
    image: 'Imagem',
    table: 'Planilha',
    other: 'Arquivo',
  };
  return map[t] || t;
}

function TypeIcon({ type }: { type: string }) {
  if (type === 'pdf' || type === 'doc' || type === 'docx') return <FileText className="h-5 w-5 shrink-0 text-[var(--muted-foreground)]" />;
  if (type === 'table') return <FileSpreadsheet className="h-5 w-5 shrink-0 text-[var(--muted-foreground)]" />;
  if (type === 'image') return <ImageIcon className="h-5 w-5 shrink-0 text-[var(--muted-foreground)]" />;
  return <FileIcon className="h-5 w-5 shrink-0 text-[var(--muted-foreground)]" />;
}

/** Indica se o arquivo (por path) parece ser vídeo. */
function isVideoPath(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  return ['mp4', 'webm', 'mov', 'ogg', 'm4v'].includes(ext);
}

/** Filtra materiais por tipo; "doc" no filtro inclui doc e docx. */
function filterByType(materials: Material[], typeFilter: string): Material[] {
  if (!typeFilter) return materials;
  if (typeFilter === 'doc') return materials.filter((m) => m.type === 'doc' || m.type === 'docx');
  return materials.filter((m) => m.type === typeFilter);
}

function MaterialPreview({
  material,
  signedUrl,
  onClose,
}: {
  material: Material;
  signedUrl: string;
  onClose: () => void;
}) {
  const { type, file_path, title } = material;
  const isVideo = isVideoPath(file_path);

  if (type === 'image') {
    return (
      <div className="relative rounded-lg overflow-hidden bg-[var(--input-bg)]">
        <button type="button" onClick={onClose} className="absolute top-2 right-2 z-10 rounded-full bg-black/50 p-1.5 text-white hover:bg-black/70">
          <X className="h-4 w-4" />
        </button>
        <img src={signedUrl} alt={title} className="max-h-[70vh] w-full object-contain" />
      </div>
    );
  }

  if (isVideo || (type === 'other' && isVideoPath(file_path))) {
    return (
      <div className="relative rounded-lg overflow-hidden bg-black">
        <button type="button" onClick={onClose} className="absolute top-2 right-2 z-10 rounded-full bg-black/50 p-1.5 text-white hover:bg-black/70">
          <X className="h-4 w-4" />
        </button>
        <video src={signedUrl} controls className="max-h-[70vh] w-full" preload="metadata" />
      </div>
    );
  }

  if (type === 'pdf') {
    return (
      <div className="relative rounded-lg overflow-hidden bg-[var(--input-bg)]" style={{ minHeight: '60vh' }}>
        <button type="button" onClick={onClose} className="absolute top-2 right-2 z-10 rounded-full bg-black/50 p-1.5 text-white hover:bg-black/70">
          <X className="h-4 w-4" />
        </button>
        <iframe src={signedUrl} title={title} className="h-[70vh] w-full border-0" />
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] p-6 text-center">
      <TypeIcon type={type} />
      <p className="mt-2 text-sm text-[var(--muted-foreground)]">Preview não disponível para este tipo. Use o botão Baixar.</p>
      <button type="button" onClick={onClose} className="mt-3 text-sm text-[var(--zaploto-green)] hover:underline">
        Fechar
      </button>
    </div>
  );
}

export default function AcademyMateriaisPage() {
  const { userId } = useRequireAuth();
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState('');
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    fetch('/api/academy/materials')
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        setMaterials(Array.isArray(data) ? data : []);
      })
      .finally(() => setLoading(false));
  }, []);

  const handleDownload = async (path: string, id: string) => {
    setDownloadingId(id);
    try {
      const res = await fetch(`/api/academy/signed-url?path=${encodeURIComponent(path)}`);
      const data = await res.json().catch(() => ({}));
      if (data.url) window.open(data.url, '_blank');
    } finally {
      setDownloadingId(null);
    }
  };

  const handlePreview = useCallback(async (m: Material) => {
    if (previewId === m.id && previewUrl) {
      setPreviewId(null);
      setPreviewUrl(null);
      return;
    }
    setPreviewId(m.id);
    setPreviewUrl(null);
    setPreviewLoading(true);
    try {
      const res = await fetch(`/api/academy/signed-url?path=${encodeURIComponent(m.file_path)}`);
      const data = await res.json().catch(() => ({}));
      if (data.url) setPreviewUrl(data.url);
      else setPreviewId(null);
    } finally {
      setPreviewLoading(false);
    }
  }, [previewId, previewUrl]);

  const closePreview = useCallback(() => {
    setPreviewId(null);
    setPreviewUrl(null);
  }, []);

  const filtered = filterByType(materials, typeFilter);
  const previewMaterial = previewId ? materials.find((m) => m.id === previewId) : null;

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <Link href="/academy" className="mb-6 inline-flex items-center gap-1 text-sm text-[var(--muted-foreground)] hover:text-[var(--zaploto-green)]">
        ← Início
      </Link>
      <h1 className="mb-2 text-3xl font-bold tracking-tight">Material de apoio</h1>
      <p className="mb-6 text-[var(--muted-foreground)]">
        Materiais disponíveis para download: PDFs, documentos, planilhas e imagens enviados pela equipe.
      </p>

      {!userId ? (
        <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-12 text-center">
          <Lock className="mx-auto mb-4 h-12 w-12 text-[var(--muted-foreground)]" />
          <p className="mb-4 text-[var(--muted-foreground)]">Faça login para acessar e baixar os materiais.</p>
          <Link
            href="/login"
            className="inline-flex items-center gap-2 rounded-lg bg-[var(--zaploto-green)] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            Entrar
          </Link>
        </div>
      ) : loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-[var(--zaploto-green)]" />
        </div>
      ) : materials.length === 0 ? (
        <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-12 text-center text-[var(--muted-foreground)]">
          Nenhum material disponível no momento.
        </div>
      ) : (
        <>
          {/* Filtro por tipo */}
          <div className="mb-6 flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-[var(--muted-foreground)]">Filtrar:</span>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-sm"
            >
              {TYPE_FILTER_OPTIONS.map((opt) => (
                <option key={opt.value || 'all'} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            {typeFilter && (
              <span className="text-sm text-[var(--muted-foreground)]">
                {filtered.length} {filtered.length === 1 ? 'material' : 'materiais'}
              </span>
            )}
          </div>

          {filtered.length === 0 ? (
            <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-8 text-center text-[var(--muted-foreground)]">
              Nenhum material neste filtro. Tente outro tipo.
            </div>
          ) : (
            <ul className="space-y-3">
              {filtered.map((m) => (
                <li
                  key={m.id}
                  className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] overflow-hidden transition hover:border-[var(--zaploto-green-border)]"
                >
                  <div className="flex items-center gap-4 p-4">
                    <TypeIcon type={m.type} />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{m.title}</p>
                      <p className="text-sm text-[var(--muted-foreground)]">
                        {typeLabel(m.type)}
                        {m.description && ` · ${m.description}`}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handlePreview(m)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--card-border)] bg-[var(--input-bg)] px-3 py-2 text-sm font-medium hover:bg-[var(--card-bg)]"
                      >
                        <Eye className="h-4 w-4" />
                        {previewId === m.id && previewLoading ? 'Carregando…' : previewId === m.id ? 'Fechar' : 'Ver preview'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDownload(m.file_path, m.id)}
                        disabled={downloadingId === m.id}
                        className="inline-flex items-center gap-2 rounded-lg bg-[var(--zaploto-green)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                      >
                        {downloadingId === m.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                        Baixar
                      </button>
                    </div>
                  </div>

                  {/* Área de preview expandida */}
                  {previewId === m.id && (
                    <div className="border-t border-[var(--card-border)] bg-[var(--background)] p-4">
                      {previewLoading ? (
                        <div className="flex justify-center py-12">
                          <Loader2 className="h-8 w-8 animate-spin text-[var(--zaploto-green)]" />
                        </div>
                      ) : previewUrl && previewMaterial ? (
                        <MaterialPreview material={previewMaterial} signedUrl={previewUrl} onClose={closePreview} />
                      ) : null}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          {/* Opção de filtrar doc+docx juntos no select: já temos "Documentos" (value doc) que filtra os dois */}
        </>
      )}
    </div>
  );
}
