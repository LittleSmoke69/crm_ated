'use client';

import { useEffect, useState } from 'react';
import Layout from '@/components/Layout';
import { useRequireAuth } from '@/utils/useRequireAuth';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Save, Loader2, FileVideo, Upload } from 'lucide-react';
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
    } finally {
      setSaving(false);
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

  if (id === 'novo') {
    router.replace('/admin/academy/modulos/novo');
    return null;
  }

  if (loading && !module) {
    return (
      <Layout>
        <div className="flex items-center justify-center p-12">
          <Loader2 className="h-8 w-8 animate-spin text-[var(--zaploto-green)]" />
        </div>
      </Layout>
    );
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
        <Link href="/admin/academy/modulos" className="mb-4 inline-block text-sm text-[var(--muted-foreground)] hover:text-[var(--zaploto-green)]">← Módulos</Link>
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Editar módulo</h1>
          <Link
            href={`/admin/academy/aulas?moduleId=${module.id}`}
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--card-border)] px-3 py-2 text-sm hover:bg-[var(--input-bg)]"
          >
            <FileVideo className="h-4 w-4" /> Aulas
          </Link>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Título *</label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Slug</label>
            <input
              type="text"
              value={form.slug}
              onChange={(e) => setForm({ ...form, slug: e.target.value })}
              className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Descrição</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2"
              rows={3}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Thumbnail</label>
            {thumbnailSrc && (
              <div className="mb-2">
                <img src={thumbnailSrc} alt="Thumbnail" className="h-24 w-auto rounded-lg border border-[var(--card-border)] object-cover" />
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 text-sm hover:bg-[var(--input-bg)]">
                <Upload className="h-4 w-4" />
                {uploadingThumb ? 'Enviando…' : 'Enviar imagem'}
                <input type="file" accept=".png,.jpg,.jpeg,.webp" onChange={handleThumbnailUpload} className="hidden" disabled={uploadingThumb} />
              </label>
              <span className="text-xs text-[var(--muted-foreground)]">ou URL externa:</span>
            </div>
            <input
              type="text"
              value={form.thumbnail_url}
              onChange={(e) => setForm({ ...form, thumbnail_url: e.target.value })}
              className="mt-1 w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-sm"
              placeholder="path do Storage (ex: thumbnails/...) ou https://..."
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Ordem</label>
            <input
              type="number"
              value={form.order_index}
              onChange={(e) => setForm({ ...form, order_index: parseInt(e.target.value, 10) || 0 })}
              className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2"
            />
          </div>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.is_published}
              onChange={(e) => setForm({ ...form, is_published: e.target.checked })}
            />
            <span className="text-sm">Publicado</span>
          </label>
          <div className="flex gap-2 pt-4">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-lg bg-[var(--zaploto-green)] px-4 py-2 text-white hover:opacity-90 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Salvar
            </button>
            <Link href="/admin/academy/modulos" className="rounded-lg border border-[var(--card-border)] px-4 py-2 text-sm">Cancelar</Link>
          </div>
        </form>
      </div>
    </Layout>
  );
}
