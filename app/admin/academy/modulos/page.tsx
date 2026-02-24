'use client';

import { useEffect, useState, useCallback } from 'react';
import Layout from '@/components/Layout';
import { useRequireAuth } from '@/utils/useRequireAuth';
import Link from 'next/link';
import { Plus, Pencil, Trash2, GripVertical, Loader2, Eye, EyeOff } from 'lucide-react';
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

export default function AdminAcademyModulosPage() {
  const { checking, userId } = useRequireAuth();
  const [modules, setModules] = useState<Module[]>([]);
  const [loading, setLoading] = useState(true);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [reordering, setReordering] = useState(false);

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
    if (e.currentTarget instanceof HTMLElement) e.currentTarget.classList.add('opacity-50');
  };

  const handleDragEnd = (e: React.DragEvent) => {
    setDraggedId(null);
    if (e.currentTarget instanceof HTMLElement) e.currentTarget.classList.remove('opacity-50');
  };

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
    const orderedIds = next.map((m) => m.id);
    const res = await fetch('/api/admin/academy/modules/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': getStoredUserId() ?? '' },
      body: JSON.stringify({ orderedIds }),
    });
    setReordering(false);
    if (!res.ok) fetchModules();
  };

  const togglePublished = async (mod: Module) => {
    const res = await fetch(`/api/admin/academy/modules/${mod.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-user-id': getStoredUserId() ?? '' },
      body: JSON.stringify({ is_published: !mod.is_published }),
    });
    if (res.ok) fetchModules();
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
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <h1 className="text-2xl font-bold text-[var(--foreground)]">Módulos</h1>
          <div className="flex gap-2">
            <Link
              href="/admin/academy"
              className="rounded-lg border border-[var(--card-border)] px-4 py-2 text-sm font-medium hover:bg-[var(--input-bg)]"
            >
              Voltar
            </Link>
            <Link
              href="/admin/academy/modulos/novo"
              className="inline-flex items-center gap-2 rounded-lg bg-[var(--zaploto-green)] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              <Plus className="h-4 w-4" /> Novo módulo
            </Link>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-[var(--zaploto-green)]" />
          </div>
        ) : modules.length === 0 ? (
          <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-12 text-center text-[var(--muted-foreground)]">
            Nenhum módulo. Crie o primeiro.
          </div>
        ) : (
          <ul className="space-y-2">
            {modules.map((mod) => (
              <li
                key={mod.id}
                draggable
                onDragStart={(e) => handleDragStart(e, mod.id)}
                onDragEnd={handleDragEnd}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, mod.id)}
                className={`flex items-center gap-3 rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4 transition ${draggedId === mod.id ? 'opacity-50' : ''} ${reordering ? 'pointer-events-none' : ''}`}
              >
                <span className="cursor-grab active:cursor-grabbing text-[var(--muted-foreground)]" title="Arraste para reordenar"><GripVertical className="h-5 w-5" /></span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{mod.title}</p>
                  <p className="text-sm text-[var(--muted-foreground)]">/{mod.slug}</p>
                </div>
                <button
                  type="button"
                  onClick={() => togglePublished(mod)}
                  className="rounded p-2 hover:bg-[var(--input-bg)]"
                  title={mod.is_published ? 'Despublicar' : 'Publicar'}
                >
                  {mod.is_published ? <Eye className="h-4 w-4 text-[var(--zaploto-green)]" /> : <EyeOff className="h-4 w-4 text-[var(--muted-foreground)]" />}
                </button>
                <Link href={`/admin/academy/modulos/${mod.id}`} className="rounded p-2 hover:bg-[var(--input-bg)]">
                  <Pencil className="h-4 w-4" />
                </Link>
                <button type="button" onClick={() => deleteModule(mod.id)} className="rounded p-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20">
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Layout>
  );
}
