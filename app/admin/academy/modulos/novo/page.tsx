'use client';

import { useState } from 'react';
import Layout from '@/components/Layout';
import { useRequireAuth } from '@/utils/useRequireAuth';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Save, Loader2 } from 'lucide-react';
import { getStoredUserId } from '@/lib/utils/stored-user-id';

export default function AdminAcademyModuloNovoPage() {
  const router = useRouter();
  const { checking, userId } = useRequireAuth();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    title: '',
    slug: '',
    description: '',
    order_index: 0,
    is_published: false,
  });

  const slugFromTitle = (t: string) => t.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      const res = await fetch('/api/admin/academy/modules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': getStoredUserId() ?? '' },
        body: JSON.stringify({
          title: form.title.trim(),
          slug: form.slug.trim() || slugFromTitle(form.title),
          description: form.description.trim() || null,
          order_index: form.order_index,
          is_published: form.is_published,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error || 'Erro ao criar');
        return;
      }
      const data = await res.json();
      router.push(`/admin/academy/modulos/${data.id}`);
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

  return (
    <Layout>
      <div className="p-6 max-w-2xl mx-auto">
        <Link href="/admin/academy/modulos" className="mb-4 inline-block text-sm text-[var(--muted-foreground)] hover:text-[var(--zaploto-green)]">← Módulos</Link>
        <h1 className="text-2xl font-bold mb-6">Novo módulo</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Título *</label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value, slug: form.slug || slugFromTitle(e.target.value) })}
              className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Slug (URL)</label>
            <input
              type="text"
              value={form.slug}
              onChange={(e) => setForm({ ...form, slug: e.target.value })}
              className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2"
              placeholder="gerado a partir do título"
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
              Criar
            </button>
            <Link href="/admin/academy/modulos" className="rounded-lg border border-[var(--card-border)] px-4 py-2 text-sm">Cancelar</Link>
          </div>
        </form>
      </div>
    </Layout>
  );
}
