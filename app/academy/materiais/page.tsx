'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Link from '@/components/WhitelabelLink';
import { useRequireAuth } from '@/utils/useRequireAuth';
import { Download, Loader2, FileText, Image as ImageIcon, FileSpreadsheet, File as FileIcon, Lock, Eye, X, Search } from 'lucide-react';

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

const TYPE_ICON_COLORS: Record<string, string> = {
  pdf: 'bg-red-500/15 text-red-400',
  doc: 'bg-blue-500/15 text-blue-400',
  docx: 'bg-blue-500/15 text-blue-400',
  table: 'bg-green-500/15 text-green-400',
  image: 'bg-purple-500/15 text-purple-400',
  other: 'bg-[var(--zaploto-green)]/10 text-[var(--zaploto-green)]',
};

function TypeIcon({ type }: { type: string }) {
  const color = TYPE_ICON_COLORS[type] ?? TYPE_ICON_COLORS.other;
  const iconClass = 'h-5 w-5';
  const icon = type === 'pdf' || type === 'doc' || type === 'docx'
    ? <FileText className={iconClass} />
    : type === 'table'
    ? <FileSpreadsheet className={iconClass} />
    : type === 'image'
    ? <ImageIcon className={iconClass} />
    : <FileIcon className={iconClass} />;
  return (
    <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${color}`}>
      {icon}
    </div>
  );
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

function PreviewCloseBtn({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      onClick={onClose}
      className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-[var(--zaploto-green)]/30 bg-[#060f07]/80 text-[var(--zaploto-green)] backdrop-blur-sm transition hover:bg-[var(--zaploto-green)]/20 hover:shadow-[0_0_8px_var(--zaploto-green)]"
    >
      <X className="h-4 w-4" />
    </button>
  );
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
      <div className="relative overflow-hidden rounded-xl border border-[var(--zaploto-green)]/20 bg-[#030803]">
        {/* Neon glow top line */}
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--zaploto-green)]/60 to-transparent" />
        <PreviewCloseBtn onClose={onClose} />
        <div className="flex items-center justify-center p-2">
          <img
            src={signedUrl}
            alt={title}
            className="max-h-[70vh] rounded-lg object-contain shadow-[0_0_40px_var(--zaploto-green)]"
          />
        </div>
      </div>
    );
  }

  if (isVideo || (type === 'other' && isVideoPath(file_path))) {
    return (
      <div className="relative overflow-hidden rounded-xl border border-[var(--zaploto-green)]/20 bg-black">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--zaploto-green)]/60 to-transparent" />
        <PreviewCloseBtn onClose={onClose} />
        <video src={signedUrl} controls className="max-h-[70vh] w-full rounded-xl" preload="metadata" />
      </div>
    );
  }

  if (type === 'pdf') {
    return (
      <div className="relative overflow-hidden rounded-xl border border-[var(--zaploto-green)]/20 bg-[#030803]" style={{ minHeight: '60vh' }}>
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--zaploto-green)]/60 to-transparent" />
        <PreviewCloseBtn onClose={onClose} />
        <iframe src={signedUrl} title={title} className="h-[70vh] w-full rounded-xl border-0" />
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-xl border border-[var(--zaploto-green)]/20 bg-[#030803] p-8 text-center">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--zaploto-green)]/60 to-transparent" />
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-[var(--zaploto-green)]/20 bg-[var(--zaploto-green)]/10">
        <TypeIcon type={type} />
      </div>
      <p className="mt-4 text-sm text-white/50">Preview não disponível para este tipo. Use o botão Baixar.</p>
      <button type="button" onClick={onClose} className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-[var(--zaploto-green)]/30 px-4 py-2 text-sm font-medium text-[var(--zaploto-green)] hover:bg-[var(--zaploto-green)]/10 transition">
        <X className="h-3.5 w-3.5" /> Fechar
      </button>
    </div>
  );
}

export default function AcademyMateriaisPage() {
  const { userId } = useRequireAuth();
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState('');
  const [search, setSearch] = useState('');
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

  const filtered = filterByType(materials, typeFilter).filter((m) =>
    !search || m.title.toLowerCase().includes(search.toLowerCase())
  );
  const previewMaterial = previewId ? materials.find((m) => m.id === previewId) : null;

  return (
    <div className="mx-auto max-w-screen-xl px-3 py-6 sm:px-6 sm:py-10 lg:px-10">
      {/* Hero banner — identidade visual Academy */}
      <section className="mb-8">
        <div className="relative overflow-hidden rounded-2xl bg-[#060f07] px-8 py-10 text-white">
          <div className="absolute inset-0 overflow-hidden">
            <div className="academy-orb-pulse absolute -right-8 -top-6 h-36 w-36 rounded-full bg-[#1a5c1a]/40 blur-3xl" style={{ animationDelay: '0s' }} />
            <div className="academy-orb-pulse absolute bottom-0 left-10 h-40 w-40 rounded-full bg-[#0d3d0d]/60 blur-3xl" style={{ animationDelay: '4.5s' }} />
            {[
              { s: 4, x: '5%',  y: '40%', o: 0.5,  d: 0   },
              { s: 6, x: '22%', y: '75%', o: 0.3,  d: 1.0  },
              { s: 3, x: '40%', y: '20%', o: 0.4,  d: 2.1  },
              { s: 5, x: '60%', y: '65%', o: 0.3,  d: 0.5  },
              { s: 4, x: '75%', y: '30%', o: 0.45, d: 1.7  },
              { s: 3, x: '88%', y: '70%', o: 0.35, d: 2.9  },
              { s: 5, x: '93%', y: '20%', o: 0.3,  d: 0.8  },
              { s: 3, x: '50%', y: '85%', o: 0.4,  d: 3.4  },
            ].map((dot, i) => (
              <div key={i}
                className="academy-bokeh-dot absolute rounded-full bg-[var(--zaploto-green)]"
                style={{
                  width: dot.s, height: dot.s, left: dot.x, top: dot.y,
                  filter: `blur(${dot.s > 4 ? 2 : 1}px)`,
                  animationDelay: `${dot.d}s`,
                  ['--dot-o' as string]: dot.o,
                  opacity: dot.o,
                }}
              />
            ))}
            <div className="academy-grid-drift absolute inset-0 opacity-[0.04]"
              style={{ backgroundImage: 'linear-gradient(var(--zaploto-green) 1px, transparent 1px), linear-gradient(90deg, var(--zaploto-green) 1px, transparent 1px)', backgroundSize: '40px 40px' }} />
            <div className="academy-scanline absolute inset-x-0 h-px bg-gradient-to-r from-transparent via-[var(--zaploto-green)]/50 to-transparent" style={{ top: 0 }} />
          </div>

          <div className="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6">
            <div>
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[var(--zaploto-green)]/30 bg-[var(--zaploto-green)]/10 px-3 py-1 text-xs font-medium text-[var(--zaploto-green)] uppercase tracking-widest">
                Zaploto Academy
              </div>
              <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Material de apoio</h1>
              <p className="mt-2 text-sm text-white/50">
                PDFs, documentos, planilhas e imagens enviados pela equipe.
              </p>
            </div>
            <Link
              href="/academy"
              className="shrink-0 inline-flex items-center gap-2 self-start rounded-xl border border-[var(--zaploto-green)]/40 bg-[var(--zaploto-green)]/10 px-4 py-2.5 text-sm font-semibold text-[var(--zaploto-green)] hover:bg-[var(--zaploto-green)]/20 transition"
            >
              ← Início
            </Link>
          </div>
        </div>
      </section>

      {!userId ? (
        <div className="relative overflow-hidden rounded-2xl border border-[#1a3d1a] bg-[#060f07] p-12 text-center">
          <div className="absolute inset-0 opacity-[0.04]"
            style={{ backgroundImage: 'linear-gradient(var(--zaploto-green) 1px, transparent 1px), linear-gradient(90deg, var(--zaploto-green) 1px, transparent 1px)', backgroundSize: '40px 40px' }} />
          <div className="relative">
            <Lock className="mx-auto mb-4 h-12 w-12 text-[var(--zaploto-green)]/40" />
            <p className="mb-4 text-white/50">Faça login para acessar e baixar os materiais.</p>
            <Link
              href="/login"
              className="inline-flex items-center gap-2 rounded-xl border border-[var(--zaploto-green)]/40 bg-[var(--zaploto-green)]/10 px-5 py-2.5 text-sm font-semibold text-[var(--zaploto-green)] hover:bg-[var(--zaploto-green)]/20 transition"
            >
              Entrar
            </Link>
          </div>
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
          {/* Barra de pesquisa + filtros */}
          <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
            {/* Search */}
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
              <input
                type="text"
                placeholder="Buscar material pelo nome…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] py-2.5 pl-9 pr-4 text-sm text-[var(--foreground)] placeholder-[var(--muted-foreground)] outline-none transition focus:border-[var(--zaploto-green)]/60 focus:ring-1 focus:ring-[var(--zaploto-green)]/30"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* Filtro por tipo — chips com scroll horizontal no mobile */}
            <div className="-mx-3 overflow-x-auto px-3 sm:mx-0 sm:px-0">
              <div className="flex w-max items-center gap-2 pb-1 sm:w-auto">
                {TYPE_FILTER_OPTIONS.map((opt) => (
                  <button
                    key={opt.value || 'all'}
                    type="button"
                    onClick={() => setTypeFilter(opt.value)}
                    className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium transition ${
                      typeFilter === opt.value
                        ? 'bg-[var(--zaploto-green)] text-[#060f07] shadow-[0_0_8px_var(--zaploto-green)]'
                        : 'border border-[var(--card-border)] text-[var(--muted-foreground)] hover:border-[var(--zaploto-green)]/40 hover:text-[var(--zaploto-green)]'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Contagem */}
          <p className="mb-3 text-xs text-[var(--muted-foreground)]">
            {filtered.length} {filtered.length === 1 ? 'material encontrado' : 'materiais encontrados'}
            {(search || typeFilter) && (
              <button
                type="button"
                onClick={() => { setSearch(''); setTypeFilter(''); }}
                className="ml-2 text-[var(--zaploto-green)] hover:underline"
              >
                Limpar filtros
              </button>
            )}
          </p>

          {filtered.length === 0 ? (
            <div className="rounded-xl border border-[#1e3a1e] bg-[#0a140a]/80 p-10 text-center text-white/40 backdrop-blur-sm">
              {search ? `Nenhum material encontrado para "${search}".` : 'Nenhum material neste filtro.'}
            </div>
          ) : (
            <ul className="space-y-3">
              {filtered.map((m) => {
                const isOpen = previewId === m.id;
                return (
                  <li
                    key={m.id}
                    className={`group relative overflow-hidden rounded-xl border bg-[#0a140a]/80 backdrop-blur-sm transition-all duration-300 ${
                      isOpen
                        ? 'border-[var(--zaploto-green)]/40 shadow-[0_0_20px_var(--zaploto-green)]'
                        : 'border-[#1e3a1e] hover:border-[var(--zaploto-green)]/30 hover:shadow-[0_0_12px_var(--zaploto-green)]'
                    }`}
                  >
                    {/* Neon top line — aparece quando aberto ou hover */}
                    <div className={`absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--zaploto-green)]/60 to-transparent transition-opacity duration-300 ${isOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-60'}`} />

                    <div className="flex items-center gap-4 p-4">
                      <TypeIcon type={m.type} />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-white/90">{m.title}</p>
                        <p className="text-sm text-white/40">
                          {typeLabel(m.type)}
                          {m.description && ` · ${m.description}`}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handlePreview(m)}
                          className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-medium transition ${
                            isOpen
                              ? 'border-[var(--zaploto-green)]/40 bg-[var(--zaploto-green)]/10 text-[var(--zaploto-green)]'
                              : 'border-white/10 text-white/50 hover:border-[var(--zaploto-green)]/40 hover:text-[var(--zaploto-green)]'
                          }`}
                        >
                          <Eye className="h-4 w-4" />
                          {isOpen && previewLoading ? 'Carregando…' : isOpen ? 'Fechar' : 'Preview'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDownload(m.file_path, m.id)}
                          disabled={downloadingId === m.id}
                          className="inline-flex items-center gap-2 rounded-xl border border-[var(--zaploto-green)]/40 bg-[var(--zaploto-green)]/10 px-4 py-2 text-sm font-semibold text-[var(--zaploto-green)] transition hover:bg-[var(--zaploto-green)]/20 hover:shadow-[0_0_10px_var(--zaploto-green)] disabled:opacity-50"
                        >
                          {downloadingId === m.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                          Baixar
                        </button>
                      </div>
                    </div>

                    {/* Área de preview expandida */}
                    {isOpen && (
                      <div className="border-t border-[var(--zaploto-green)]/15 bg-[#030803]/80 p-4">
                        {previewLoading ? (
                          <div className="flex flex-col items-center justify-center gap-3 py-16">
                            <Loader2 className="h-8 w-8 animate-spin text-[var(--zaploto-green)]" />
                            <p className="text-sm text-white/30">Carregando preview…</p>
                          </div>
                        ) : previewUrl && previewMaterial ? (
                          <MaterialPreview material={previewMaterial} signedUrl={previewUrl} onClose={closePreview} />
                        ) : null}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

        </>
      )}
    </div>
  );
}
