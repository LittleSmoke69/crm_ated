'use client';

import { useEffect, useState, useCallback } from 'react';
import Layout from '@/components/Layout';
import { useRequireAuth } from '@/utils/useRequireAuth';
import Link from '@/components/WhitelabelLink';
import { Plus, Pencil, Trash2, GripVertical, Loader2, Eye, EyeOff, FileVideo, ArrowLeft, BookOpen } from 'lucide-react';
import { getStoredUserId } from '@/lib/utils/stored-user-id';

type Module = {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  order_index: number;
  is_published: boolean;
  thumbnail_url: string | null;
};

function getThumbSrc(url: string | null) {
  if (!url) return null;
  return url.startsWith('http') ? url : `/api/academy/thumbnail?path=${encodeURIComponent(url)}`;
}

export default function AdminAcademyModulosPage() {
  const { checking, userId } = useRequireAuth();
  const [modules, setModules] = useState<Module[]>([]);
  const [loading, setLoading] = useState(true);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [reordering, setReordering] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const fetchModules = useCallback(() => {
    const h = { 'x-user-id': getStoredUserId() ?? '' };
    fetch('/api/admin/academy/modules', { headers: h })
      .then((r) => (r.ok ? r.json() : []))
      .then(setModules)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!userId) return;
    fetchModules();
  }, [userId, fetchModules]);

  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDraggedId(id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
  };

  const handleDragEnd = () => setDraggedId(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = async (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    const sourceId = e.dataTransfer.getData('text/plain');
    if (!sourceId || sourceId === targetId) return;
    const idx = modules.findIndex((m) => m.id === sourceId);
    const targetIdx = modules.findIndex((m) => m.id === targetId);
    if (idx < 0 || targetIdx < 0) return;
    const next = [...modules];
    const [removed] = next.splice(idx, 1);
    next.splice(targetIdx, 0, removed);
    setModules(next);
    setReordering(true);
    const res = await fetch('/api/admin/academy/modules/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': getStoredUserId() ?? '' },
      body: JSON.stringify({ orderedIds: next.map((m) => m.id) }),
    });
    setReordering(false);
    if (!res.ok) fetchModules();
  };

  const togglePublished = async (mod: Module) => {
    setTogglingId(mod.id);
    const res = await fetch(`/api/admin/academy/modules/${mod.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-user-id': getStoredUserId() ?? '' },
      body: JSON.stringify({ is_published: !mod.is_published }),
    });
    if (res.ok) fetchModules();
    setTogglingId(null);
  };

  const deleteModule = async (id: string) => {
    if (!confirm('Excluir este módulo e todas as aulas?')) return;
    const res = await fetch(`/api/admin/academy/modules/${id}`, {
      method: 'DELETE',
      headers: { 'x-user-id': getStoredUserId() ?? '' },
    });
    if (res.ok) fetchModules();
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
        <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link
              href="/admin/academy"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--card-border)] hover:bg-[var(--input-bg)] transition"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div>
              <h1 className="text-xl font-bold">Módulos</h1>
              <p className="text-xs text-[var(--muted-foreground)]">
                {modules.length} módulo{modules.length !== 1 ? 's' : ''} · arraste para reordenar
              </p>
            </div>
          </div>
          <Link
            href="/admin/academy/modulos/novo"
            className="inline-flex items-center gap-2 rounded-lg bg-[var(--zaploto-green)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition"
          >
            <Plus className="h-4 w-4" /> Novo módulo
          </Link>
        </div>

        {reordering && (
          <div className="mb-3 flex items-center gap-2 rounded-lg bg-[var(--zaploto-green-bg)] px-3 py-2 text-sm text-[var(--zaploto-green)]">
            <Loader2 className="h-4 w-4 animate-spin" /> Salvando nova ordem…
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-[var(--zaploto-green)]" />
          </div>
        ) : modules.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[var(--card-border)] p-16 text-center">
            <BookOpen className="mx-auto mb-3 h-10 w-10 text-[var(--muted-foreground)]" />
            <p className="font-medium text-[var(--muted-foreground)]">Nenhum módulo criado ainda</p>
            <Link href="/admin/academy/modulos/novo" className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[var(--zaploto-green)] px-4 py-2 text-sm font-medium text-white hover:opacity-90">
              <Plus className="h-4 w-4" /> Criar primeiro módulo
            </Link>
          </div>
        ) : (
          <ul className="space-y-2">
            {modules.map((mod) => {
              const thumb = getThumbSrc(mod.thumbnail_url);
              return (
                <li
                  key={mod.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, mod.id)}
                  onDragEnd={handleDragEnd}
                  onDragOver={handleDragOver}
                  onDrop={(e) => handleDrop(e, mod.id)}
                  className={`flex items-center gap-3 rounded-xl border bg-[var(--card-bg)] p-3 transition ${
                    draggedId === mod.id
                      ? 'border-[var(--zaploto-green-border)] opacity-50'
                      : 'border-[var(--card-border)] hover:border-[var(--zaploto-green-border)]'
                  } ${reordering ? 'pointer-events-none' : ''}`}
                >
                  {/* Drag handle */}
                  <span className="cursor-grab active:cursor-grabbing text-[var(--muted-foreground)] shrink-0 px-0.5" title="Arraste para reordenar">
                    <GripVertical className="h-5 w-5" />
                  </span>

                  {/* Thumbnail */}
                  <div className="h-14 w-24 shrink-0 overflow-hidden rounded-lg bg-zinc-900">
                    {thumb ? (
                      <img src={thumb} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center">
                        <BookOpen className="h-6 w-6 text-zinc-600" />
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-medium truncate">{mod.title}</p>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                        mod.is_published
                          ? 'bg-[var(--zaploto-green-bg)] text-[var(--zaploto-green)]'
                          : 'bg-zinc-700/40 text-[var(--muted-foreground)]'
                      }`}>
                        {mod.is_published ? 'Publicado' : 'Rascunho'}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">/{mod.slug}</p>
                  </div>

                  {/* Actions */}
                  <div className="flex shrink-0 items-center gap-1">
                    {/* Ver aulas */}
                    <Link
                      href={`/admin/academy/aulas?moduleId=${mod.id}`}
                      className="flex items-center gap-1 rounded-lg border border-[var(--card-border)] px-2.5 py-1.5 text-xs font-medium hover:bg-[var(--input-bg)] transition"
                      title="Ver aulas"
                    >
                      <FileVideo className="h-3.5 w-3.5" /> Aulas
                    </Link>

                    {/* Toggle publicado */}
                    <button
                      type="button"
                      onClick={() => togglePublished(mod)}
                      disabled={togglingId === mod.id}
                      className="rounded-lg p-2 hover:bg-[var(--input-bg)] transition"
                      title={mod.is_published ? 'Despublicar' : 'Publicar'}
                    >
                      {togglingId === mod.id ? (
                        <Loader2 className="h-4 w-4 animate-spin text-[var(--muted-foreground)]" />
                      ) : mod.is_published ? (
                        <Eye className="h-4 w-4 text-[var(--zaploto-green)]" />
                      ) : (
                        <EyeOff className="h-4 w-4 text-[var(--muted-foreground)]" />
                      )}
                    </button>

                    {/* Editar */}
                    <Link href={`/admin/academy/modulos/${mod.id}`} className="rounded-lg p-2 hover:bg-[var(--input-bg)] transition" title="Editar">
                      <Pencil className="h-4 w-4" />
                    </Link>

                    {/* Excluir */}
                    <button
                      type="button"
                      onClick={() => deleteModule(mod.id)}
                      className="rounded-lg p-2 text-red-500 hover:bg-red-500/10 transition"
                      title="Excluir"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Layout>
  );
}
