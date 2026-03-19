'use client';

import { useEffect, useState } from 'react';
import Layout from '@/components/Layout';
import { useRequireAuth } from '@/utils/useRequireAuth';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Save, Loader2, FileVideo, Upload, ArrowLeft, Eye, EyeOff, CheckCircle2, ImageIcon } from 'lucide-react';
import { getStoredUserId } from '@/lib/utils/stored-user-id';

type Module = {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  order_index: number;
  is_published: boolean;
  thumbnail_url: string | null;
  tags: string[] | null;
};

export default function AdminAcademyModuloEditPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const { checking, userId } = useRequireAuth();
  const [module, setModule] = useState<Module | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState({ title: '', slug: '', description: '', order_index: 0, is_published: false, thumbnail_url: '' });
  const [uploadingThumb, setUploadingThumb] = useState(false);

  useEffect(() => {
    if (!userId || id === 'novo') return;
    const h = { 'x-user-id': getStoredUserId() ?? '' };
    fetch(`/api/admin/academy/modules/${id}`, { headers: h })
      .then((r) => {
        if (r.status === 404) return null;
        return r.json();
      })
      .then((data) => {
        if (data) {
          setModule(data);
          setForm({
            title: data.title,
            slug: data.slug,
            description: data.description ?? '',
            order_index: data.order_index ?? 0,
            is_published: data.is_published ?? false,
            thumbnail_url: data.thumbnail_url ?? '',
          });
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [userId, id]);

  const thumbnailSrc = form.thumbnail_url
    ? form.thumbnail_url.startsWith('http')
      ? form.thumbnail_url
      : `/api/academy/thumbnail?path=${encodeURIComponent(form.thumbnail_url)}`
    : null;

  const handleThumbnailUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !id) return;
    setUploadingThumb(true);
    try {
      const fd = new FormData();
      fd.set('file', file);
      fd.set('moduleId', id);
      const res = await fetch('/api/admin/academy/upload-thumbnail', {
        method: 'POST',
        headers: { 'x-user-id': getStoredUserId() ?? '' },
        body: fd,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error || 'Erro no upload');
        return;
      }
      const data = await res.json();
      setForm((f) => ({ ...f, thumbnail_url: data.path }));
    } finally {
      setUploadingThumb(false);
      e.target.value = '';
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch(`/api/admin/academy/modules/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-user-id': getStoredUserId() ?? '' },
        body: JSON.stringify({
          title: form.title.trim(),
          slug: form.slug.trim(),
          description: form.description.trim() || null,
          order_index: form.order_index,
          is_published: form.is_published,
          thumbnail_url: form.thumbnail_url.trim() || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error || 'Erro ao salvar');
        return;
      }
      const data = await res.json();
      setModule(data);
      setForm({ ...form, ...data });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setSaving(false);
    }
  };

  if (checking || (loading && !module)) {
    return (
      <Layout>
        <div className="flex items-center justify-center p-12">
          <Loader2 className="h-8 w-8 animate-spin text-[var(--zaploto-green)]" />
        </div>
      </Layout>
    );
  }

  if (id === 'novo') {
    router.replace('/admin/academy/modulos/novo');
    return null;
  }

  if (!module) {
    return (
      <Layout>
        <div className="p-6">
          <p className="text-[var(--muted-foreground)]">Módulo não encontrado.</p>
          <Link href="/admin/academy/modulos" className="mt-4 inline-block text-[var(--zaploto-green)]">← Voltar</Link>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="p-6 max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-6 flex items-center gap-3">
          <Link
            href="/admin/academy/modulos"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--card-border)] hover:bg-[var(--input-bg)] transition"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="flex-1">
            <h1 className="text-xl font-bold">Editar módulo</h1>
            <p className="text-xs text-[var(--muted-foreground)]">/{module.slug}</p>
          </div>
          <Link
            href={`/admin/academy/aulas?moduleId=${module.id}`}
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--card-border)] px-3 py-2 text-sm font-medium hover:bg-[var(--input-bg)] transition"
          >
            <FileVideo className="h-4 w-4" /> Gerenciar aulas
          </Link>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Thumbnail section */}
          <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-5">
            <h2 className="mb-4 font-semibold">Capa do módulo</h2>

            {thumbnailSrc ? (
              <div className="mb-4 overflow-hidden rounded-xl border border-[var(--card-border)]">
                <img src={thumbnailSrc} alt="Thumbnail" className="h-48 w-full object-cover" />
              </div>
            ) : (
              <div className="mb-4 flex h-36 items-center justify-center rounded-xl border border-dashed border-[var(--card-border)] bg-[var(--input-bg)]">
                <div className="text-center">
                  <ImageIcon className="mx-auto mb-2 h-8 w-8 text-[var(--muted-foreground)]" />
                  <p className="text-xs text-[var(--muted-foreground)]">Sem imagem</p>
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-[var(--zaploto-green)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition">
                {uploadingThumb ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {uploadingThumb ? 'Enviando…' : 'Enviar imagem'}
                <input type="file" accept=".png,.jpg,.jpeg,.webp" onChange={handleThumbnailUpload} className="hidden" disabled={uploadingThumb} />
              </label>
              <span className="text-xs text-[var(--muted-foreground)]">PNG, JPG ou WEBP</span>
            </div>

            {form.thumbnail_url && (
              <input
                type="text"
                value={form.thumbnail_url}
                onChange={(e) => setForm({ ...form, thumbnail_url: e.target.value })}
                className="mt-3 w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-xs text-[var(--muted-foreground)]"
                placeholder="path do Storage ou URL externa"
              />
            )}
          </div>

          {/* Basic info section */}
          <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-5">
            <h2 className="mb-4 font-semibold">Informações básicas</h2>
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium">Título *</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2.5"
                  required
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Slug (URL)</label>
                <div className="flex items-center gap-2 rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2.5">
                  <span className="text-sm text-[var(--muted-foreground)]">/academy/modulos/</span>
                  <input
                    type="text"
                    value={form.slug}
                    onChange={(e) => setForm({ ...form, slug: e.target.value })}
                    className="flex-1 bg-transparent text-sm outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Descrição</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2.5"
                  rows={3}
                  placeholder="Breve descrição do módulo…"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Ordem de exibição</label>
                <input
                  type="number"
                  value={form.order_index}
                  onChange={(e) => setForm({ ...form, order_index: parseInt(e.target.value, 10) || 0 })}
                  className="w-32 rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2.5"
                />
              </div>
            </div>
          </div>

          {/* Publication section */}
          <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-5">
            <h2 className="mb-4 font-semibold">Publicação</h2>
            <button
              type="button"
              onClick={() => setForm((f) => ({ ...f, is_published: !f.is_published }))}
              className={`flex w-full items-center gap-3 rounded-xl border-2 p-4 text-left transition ${
                form.is_published
                  ? 'border-[var(--zaploto-green)] bg-[var(--zaploto-green-bg)]'
                  : 'border-[var(--card-border)] bg-[var(--input-bg)]'
              }`}
            >
              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                form.is_published ? 'bg-[var(--zaploto-green)]' : 'bg-zinc-700'
              }`}>
                {form.is_published ? <Eye className="h-5 w-5 text-white" /> : <EyeOff className="h-5 w-5 text-white" />}
              </div>
              <div>
                <p className="font-medium">{form.is_published ? 'Publicado' : 'Rascunho'}</p>
                <p className="text-xs text-[var(--muted-foreground)]">
                  {form.is_published ? 'Visível para todos os alunos' : 'Não aparece na área pública'}
                </p>
              </div>
            </button>
          </div>

          {/* Save button */}
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-xl bg-[var(--zaploto-green)] px-6 py-2.5 font-semibold text-white hover:opacity-90 disabled:opacity-50 transition"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saving ? 'Salvando…' : 'Salvar módulo'}
            </button>
            {saved && (
              <span className="flex items-center gap-1.5 text-sm text-[var(--zaploto-green)]">
                <CheckCircle2 className="h-4 w-4" /> Salvo!
              </span>
            )}
            <Link href="/admin/academy/modulos" className="ml-auto text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
              Cancelar
            </Link>
          </div>
        </form>
      </div>
    </Layout>
  );
}
