'use client';

import { Suspense, useEffect, useState, useCallback } from 'react';
import Layout from '@/components/Layout';
import { useRequireAuth } from '@/utils/useRequireAuth';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Plus, Pencil, Trash2, Loader2, Eye, EyeOff, GripVertical } from 'lucide-react';
import { getStoredUserId } from '@/lib/utils/stored-user-id';

type Lesson = {
  id: string;
  module_id: string;
  title: string;
  slug: string;
  order_index: number;
  is_published: boolean;
  content_type: string;
  estimated_minutes: number | null;
};

type Module = { id: string; title: string; slug: string };

function AdminAcademyAulasContent() {
  const searchParams = useSearchParams();
  const moduleId = searchParams.get('moduleId');
  const { checking, userId } = useRequireAuth();
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [modules, setModules] = useState<Module[]>([]);
  const [loading, setLoading] = useState(true);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [reordering, setReordering] = useState(false);

  const fetchData = useCallback(() => {
    const h = { 'x-user-id': getStoredUserId() ?? '' };
    Promise.all([
      fetch('/api/admin/academy/lessons' + (moduleId ? `?moduleId=${moduleId}` : ''), { headers: h }).then((r) => (r.ok ? r.json() : [])),
      fetch('/api/admin/academy/modules', { headers: h }).then((r) => (r.ok ? r.json() : [])),
    ]).then(([lessonsData, modulesData]) => {
      setLessons(lessonsData);
      setModules(modulesData);
      setLoading(false);
    });
  }, [moduleId]);

  useEffect(() => {
    if (!userId) return;
    fetchData();
  }, [userId, fetchData]);

  const getModuleTitle = (mid: string) => modules.find((m) => m.id === mid)?.title ?? mid;

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
    const idx = lessons.findIndex((l) => l.id === sourceId);
    const targetIdx = lessons.findIndex((l) => l.id === targetId);
    if (idx < 0 || targetIdx < 0) return;
    const next = [...lessons];
    const [removed] = next.splice(idx, 1);
    next.splice(targetIdx, 0, removed);
    setLessons(next);
    setReordering(true);
    const res = await fetch('/api/admin/academy/lessons/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': getStoredUserId() ?? '' },
      body: JSON.stringify({ orderedIds: next.map((l) => l.id) }),
    });
    setReordering(false);
    if (!res.ok) fetchData();
  };

  const togglePublished = async (lesson: Lesson) => {
    const res = await fetch(`/api/admin/academy/lessons/${lesson.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-user-id': getStoredUserId() ?? '' },
      body: JSON.stringify({ is_published: !lesson.is_published }),
    });
    if (res.ok) fetchData();
  };
  const deleteLesson = async (id: string) => {
    if (!confirm('Excluir esta aula?')) return;
    const res = await fetch(`/api/admin/academy/lessons/${id}`, { method: 'DELETE', headers: { 'x-user-id': getStoredUserId() ?? '' } });
    if (res.ok) fetchData();
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
          <h1 className="text-2xl font-bold text-[var(--foreground)]">Aulas</h1>
          <div className="flex gap-2">
            <Link href="/admin/academy" className="rounded-lg border border-[var(--card-border)] px-4 py-2 text-sm font-medium hover:bg-[var(--input-bg)]">Voltar</Link>
            <Link href="/admin/academy/aulas/novo" className="inline-flex items-center gap-2 rounded-lg bg-[var(--zaploto-green)] px-4 py-2 text-sm font-medium text-white hover:opacity-90">
              <Plus className="h-4 w-4" /> Nova aula
            </Link>
          </div>
        </div>
        {moduleId && (
          <p className="mb-4 text-sm text-[var(--muted-foreground)]">
            Módulo: {getModuleTitle(moduleId)}
            <Link href="/admin/academy/aulas" className="ml-2 text-[var(--zaploto-green)]">Ver todas</Link>
          </p>
        )}
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-[var(--zaploto-green)]" />
          </div>
        ) : lessons.length === 0 ? (
          <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-12 text-center text-[var(--muted-foreground)]">
            Nenhuma aula.
          </div>
        ) : (
          <ul className="space-y-2">
            {lessons.map((l) => (
              <li
                key={l.id}
                draggable={!!moduleId}
                onDragStart={moduleId ? (e) => handleDragStart(e, l.id) : undefined}
                onDragEnd={moduleId ? handleDragEnd : undefined}
                onDragOver={moduleId ? handleDragOver : undefined}
                onDrop={moduleId ? (e) => handleDrop(e, l.id) : undefined}
                className={`flex items-center gap-3 rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4 transition ${draggedId === l.id ? 'opacity-50' : ''} ${reordering ? 'pointer-events-none' : ''}`}
              >
                {moduleId ? <span className="cursor-grab active:cursor-grabbing text-[var(--muted-foreground)] shrink-0" title="Arraste para reordenar"><GripVertical className="h-5 w-5" /></span> : null}
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{l.title}</p>
                  <p className="text-sm text-[var(--muted-foreground)]">{getModuleTitle(l.module_id)} · {l.content_type} · /{l.slug}</p>
                </div>
                <button type="button" onClick={() => togglePublished(l)} className="rounded p-2 hover:bg-[var(--input-bg)]" title={l.is_published ? 'Despublicar' : 'Publicar'}>
                  {l.is_published ? <Eye className="h-4 w-4 text-[var(--zaploto-green)]" /> : <EyeOff className="h-4 w-4 text-[var(--muted-foreground)]" />}
                </button>
                <Link href={`/admin/academy/aulas/${l.id}`} className="rounded p-2 hover:bg-[var(--input-bg)]"><Pencil className="h-4 w-4" /></Link>
                <button type="button" onClick={() => deleteLesson(l.id)} className="rounded p-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20"><Trash2 className="h-4 w-4" /></button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Layout>
  );
}

export default function AdminAcademyAulasPage() {
  return (
    <Suspense fallback={
      <Layout>
        <div className="flex items-center justify-center p-12">
          <Loader2 className="h-8 w-8 animate-spin text-[var(--zaploto-green)]" />
        </div>
      </Layout>
    }>
      <AdminAcademyAulasContent />
    </Suspense>
  );
}
