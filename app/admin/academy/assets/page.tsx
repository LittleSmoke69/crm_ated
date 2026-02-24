'use client';

import { useEffect, useState, useRef } from 'react';
import Layout from '@/components/Layout';
import { useRequireAuth } from '@/utils/useRequireAuth';
import Link from 'next/link';
import { Upload, Loader2, FileText, Image as ImageIcon, FileSpreadsheet, File } from 'lucide-react';
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

export default function AdminAcademyAssetsPage() {
  const { checking, userId } = useRequireAuth();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
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
        setUploadError(errData.error || (res.status === 403 ? 'Acesso negado. Apenas Admin.' : 'Erro no upload. Tente outro formato ou tamanho.'));
        return;
      }
      setUploadForm({ file: null, type: '', title: '' });
      if (fileInputRef.current) fileInputRef.current.value = '';
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
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <h1 className="text-2xl font-bold text-[var(--foreground)]">Materiais (Assets)</h1>
          <Link href="/admin/academy" className="rounded-lg border border-[var(--card-border)] px-4 py-2 text-sm font-medium hover:bg-[var(--input-bg)]">Voltar</Link>
        </div>

        <form onSubmit={handleUpload} className="mb-8 rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
          <h2 className="font-semibold mb-1">Material de apoio</h2>
          <p className="text-sm text-[var(--muted-foreground)] mb-3">
            Envie PDFs, documentos, planilhas, imagens ou outros arquivos. Depois associe às aulas em Editar aula → Anexos. O usuário poderá baixar qualquer tipo.
          </p>
          {uploadError && (
            <div className="mb-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 text-sm p-3">
              {uploadError}
            </div>
          )}
          <div className="flex flex-wrap gap-4 items-end">
            <div>
              <label className="block text-sm font-medium mb-1">Arquivo *</label>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp,.gif,.svg,.txt,.csv,.xls,.xlsx,.zip,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/*,text/*,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/zip"
                onChange={(e) => setUploadForm({ ...uploadForm, file: e.target.files?.[0] ?? null })}
                className="block w-full text-sm file:mr-2 file:rounded file:border-0 file:bg-[var(--zaploto-green)] file:px-3 file:py-1.5 file:text-white file:text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Tipo (opcional)</label>
              <select value={uploadForm.type} onChange={(e) => setUploadForm({ ...uploadForm, type: e.target.value })} className="rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2">
                <option value="">Detectar pelo arquivo</option>
                <option value="pdf">PDF</option>
                <option value="doc">DOC</option>
                <option value="docx">DOCX</option>
                <option value="image">Imagem</option>
                <option value="table">Planilha/Tabela</option>
                <option value="other">Outro</option>
              </select>
            </div>
            <div className="min-w-[200px] flex-1">
              <label className="block text-sm font-medium mb-1">Título *</label>
              <input
                type="text"
                value={uploadForm.title}
                onChange={(e) => setUploadForm({ ...uploadForm, title: e.target.value })}
                className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2"
                placeholder="Ex: Apostila módulo 1"
              />
            </div>
            <button type="submit" disabled={uploading || !uploadForm.file} className="inline-flex items-center gap-2 rounded-lg bg-[var(--zaploto-green)] px-4 py-2 text-white hover:opacity-90 disabled:opacity-50">
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Enviar
            </button>
          </div>
        </form>

        {listError && (
          <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-amber-700 dark:text-amber-400 text-sm">
            {listError}
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-[var(--zaploto-green)]" />
          </div>
        ) : assets.length === 0 ? (
          <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-12 text-center text-[var(--muted-foreground)]">
            {listError ? null : 'Nenhum material. Faça upload acima.'}
          </div>
        ) : (
          <ul className="space-y-2">
            {assets.map((a) => (
              <li key={a.id} className="flex items-center gap-3 rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
                {a.type === 'pdf' || a.type === 'doc' || a.type === 'docx' ? (
                  <FileText className="h-5 w-5 shrink-0 text-[var(--muted-foreground)]" />
                ) : a.type === 'table' ? (
                  <FileSpreadsheet className="h-5 w-5 shrink-0 text-[var(--muted-foreground)]" />
                ) : a.type === 'image' ? (
                  <ImageIcon className="h-5 w-5 shrink-0 text-[var(--muted-foreground)]" />
                ) : (
                  <File className="h-5 w-5 shrink-0 text-[var(--muted-foreground)]" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{a.title}</p>
                  <p className="text-sm text-[var(--muted-foreground)]">{a.type} · {a.file_path}</p>
                </div>
                {a.public_url && (
                  <a href={a.public_url} target="_blank" rel="noopener noreferrer" className="text-sm text-[var(--zaploto-green)] hover:underline shrink-0">Abrir</a>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Layout>
  );
}
