'use client';

import { useEffect, useState, useRef } from 'react';
import Layout from '@/components/Layout';
import { useRequireAuth } from '@/utils/useRequireAuth';
import Link from 'next/link';
import { Upload, Loader2, FileText, Image as ImageIcon, FileSpreadsheet, File, ArrowLeft, ExternalLink, CheckCircle2, AlertCircle } from 'lucide-react';
import { getStoredUserId } from '@/lib/utils/stored-user-id';

type Asset = {
  id: string;
  type: string;
  title: string;
  description: string | null;
  file_path: string;
  public_url: string | null;
  category: string | null;
  is_published: boolean;
  created_at: string;
};

function AssetIcon({ type }: { type: string }) {
  if (type === 'pdf' || type === 'doc' || type === 'docx') return <FileText className="h-5 w-5" />;
  if (type === 'table') return <FileSpreadsheet className="h-5 w-5" />;
  if (type === 'image') return <ImageIcon className="h-5 w-5" />;
  return <File className="h-5 w-5" />;
}

const TYPE_COLORS: Record<string, string> = {
  pdf: 'bg-red-500/15 text-red-400',
  doc: 'bg-blue-500/15 text-blue-400',
  docx: 'bg-blue-500/15 text-blue-400',
  table: 'bg-green-500/15 text-green-400',
  image: 'bg-purple-500/15 text-purple-400',
  other: 'bg-zinc-600/40 text-[var(--muted-foreground)]',
};

export default function AdminAcademyAssetsPage() {
  const { checking, userId } = useRequireAuth();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [uploadForm, setUploadForm] = useState({ file: null as File | null, type: '', title: '' });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchAssets = () => {
    setListError(null);
    const h = { 'x-user-id': getStoredUserId() ?? '' };
    fetch('/api/admin/academy/assets', { headers: h })
      .then((r) => {
        if (r.status === 403) {
          setListError('Acesso negado. Apenas Admin ou Super Admin podem gerenciar materiais.');
          return [];
        }
        if (!r.ok) {
          setListError('Erro ao carregar a lista.');
          return [];
        }
        return r.json();
      })
      .then(setAssets)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!userId) return;
    fetchAssets();
  }, [userId]);

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    setUploadError(null);
    setUploadSuccess(false);
    if (!uploadForm.file || !uploadForm.file.size) {
      setUploadError('Selecione um arquivo.');
      return;
    }
    if (!uploadForm.title.trim()) {
      setUploadError('Informe o título do material.');
      return;
    }
    const uid = getStoredUserId();
    if (!uid) {
      setUploadError('Faça login novamente para enviar materiais.');
      return;
    }
    setUploading(true);
    const formData = new FormData();
    formData.set('file', uploadForm.file);
    formData.set('type', uploadForm.type);
    formData.set('title', uploadForm.title.trim());
    try {
      const res = await fetch('/api/admin/academy/upload', {
        method: 'POST',
        headers: { 'x-user-id': uid },
        body: formData,
      });
      const errData = await res.json().catch(() => ({}));
      if (!res.ok) {
        setUploadError(errData.error || (res.status === 403 ? 'Acesso negado.' : 'Erro no upload.'));
        return;
      }
      setUploadForm({ file: null, type: '', title: '' });
      if (fileInputRef.current) fileInputRef.current.value = '';
      setUploadSuccess(true);
      setTimeout(() => setUploadSuccess(false), 4000);
      fetchAssets();
    } finally {
      setUploading(false);
    }
  };

  if (checking) {
    return (
      <Layout>
        <div className="flex items-center justify-center p-12">
          <Loader2 className="h-8 w-8 animate-spin text-[var(--zaploto-green)]" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="p-6 max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-6 flex items-center gap-3">
          <Link
            href="/admin/academy"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--card-border)] hover:bg-[var(--input-bg)] transition"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-xl font-bold">Materiais de apoio</h1>
            <p className="text-xs text-[var(--muted-foreground)]">
              {assets.length} arquivo{assets.length !== 1 ? 's' : ''} · associe às aulas em Editar aula → Anexos
            </p>
          </div>
        </div>

        {/* Upload card */}
        <div className="mb-6 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-5">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-purple-500/10">
              <Upload className="h-5 w-5 text-purple-400" />
            </div>
            <div>
              <h2 className="font-semibold">Novo material</h2>
              <p className="text-xs text-[var(--muted-foreground)]">PDF, DOC, planilha, imagem, ZIP e mais</p>
            </div>
          </div>

          {uploadError && (
            <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {uploadError}
            </div>
          )}
          {uploadSuccess && (
            <div className="mb-4 flex items-center gap-2 rounded-xl border border-[var(--zaploto-green-border)] bg-[var(--zaploto-green-bg)] p-3 text-sm text-[var(--zaploto-green)]">
              <CheckCircle2 className="h-4 w-4 shrink-0" /> Material enviado com sucesso!
            </div>
          )}

          <form onSubmit={handleUpload}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="mb-1.5 block text-sm font-medium">Arquivo *</label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp,.gif,.svg,.txt,.csv,.xls,.xlsx,.zip,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/*,text/*,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/zip"
                  onChange={(e) => setUploadForm({ ...uploadForm, file: e.target.files?.[0] ?? null })}
                  className="block w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] p-2 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-[var(--zaploto-green)] file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Título *</label>
                <input
                  type="text"
                  value={uploadForm.title}
                  onChange={(e) => setUploadForm({ ...uploadForm, title: e.target.value })}
                  className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2.5"
                  placeholder="Ex: Apostila módulo 1"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Tipo</label>
                <select
                  value={uploadForm.type}
                  onChange={(e) => setUploadForm({ ...uploadForm, type: e.target.value })}
                  className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2.5"
                >
                  <option value="">Detectar automaticamente</option>
                  <option value="pdf">PDF</option>
                  <option value="doc">DOC</option>
                  <option value="docx">DOCX</option>
                  <option value="image">Imagem</option>
                  <option value="table">Planilha/Tabela</option>
                  <option value="other">Outro</option>
                </select>
              </div>
            </div>
            <div className="mt-4">
              <button
                type="submit"
                disabled={uploading || !uploadForm.file || !uploadForm.title}
                className="inline-flex items-center gap-2 rounded-xl bg-[var(--zaploto-green)] px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 transition"
              >
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {uploading ? 'Enviando…' : 'Enviar material'}
              </button>
            </div>
          </form>
        </div>

        {/* List */}
        {listError && (
          <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-400">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {listError}
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-[var(--zaploto-green)]" />
          </div>
        ) : assets.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[var(--card-border)] p-12 text-center text-[var(--muted-foreground)]">
            {!listError && 'Nenhum material enviado ainda. Use o formulário acima.'}
          </div>
        ) : (
          <ul className="space-y-2">
            {assets.map((a) => {
              const colorClass = TYPE_COLORS[a.type] ?? TYPE_COLORS.other;
              return (
                <li key={a.id} className="flex items-center gap-3 rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4 hover:border-[var(--zaploto-green-border)] transition">
                  {/* Icon */}
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${colorClass}`}>
                    <AssetIcon type={a.type} />
                  </div>

                  {/* Info */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-medium truncate">{a.title}</p>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium uppercase ${colorClass}`}>
                        {a.type}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-[var(--muted-foreground)]">{a.file_path}</p>
                  </div>

                  {/* Link */}
                  {a.public_url && (
                    <a
                      href={a.public_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 flex items-center gap-1 rounded-lg border border-[var(--card-border)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--input-bg)] transition"
                    >
                      <ExternalLink className="h-3.5 w-3.5" /> Abrir
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Layout>
  );
}
