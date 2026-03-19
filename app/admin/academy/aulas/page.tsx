'use client';

import { Suspense, useEffect, useState, useCallback } from 'react';
import Layout from '@/components/Layout';
import { useRequireAuth } from '@/utils/useRequireAuth';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Plus, Pencil, Trash2, Loader2, Eye, EyeOff, GripVertical, ArrowLeft, FileVideo, Clock, Filter } from 'lucide-react';
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

const CONTENT_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  vturb: { label: 'VTurb', color: 'bg-purple-500/15 text-purple-400' },
  iframe: { label: 'Iframe', color: 'bg-blue-500/15 text-blue-400' },
  text: { label: 'Texto', color: 'bg-zinc-600/40 text-[var(--muted-foreground)]' },
};

function AdminAcademyAulasContent() {
  const searchParams = useSearchParams();
  const moduleId = searchParams.get('moduleId');
  const { checking, userId } = useRequireAuth();
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [modules, setModules] = useState<Module[]>([]);
  const [loading, setLoading] = useState(true);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [reordering, setReordering] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

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

  const getModuleTitle = (mid: string) => modules.find((m) => m.id === mid)?.title ?? '—';
  const currentModule = moduleId ? modules.find((m) => m.id === moduleId) : null;

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
    setTogglingId(lesson.id);
    const res = await fetch(`/api/admin/academy/lessons/${lesson.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-user-id': getStoredUserId() ?? '' },
      body: JSON.stringify({ is_published: !lesson.is_published }),
    });
    if (res.ok) fetchData();
    setTogglingId(null);
  };

  const deleteLesson = async (id: string) => {
    if (!confirm('Excluir esta aula?')) return;
    const res = await fetch(`/api/admin/academy/lessons/${id}`, {
      method: 'DELETE',
      headers: { 'x-user-id': getStoredUserId() ?? '' },
    });
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
              <h1 className="text-xl font-bold">Aulas</h1>
              <p className="text-xs text-[var(--muted-foreground)]">
                {lessons.length} aula{lessons.length !== 1 ? 's' : ''}
                {moduleId ? ` · filtrando por módulo` : ' · todos os módulos'}
                {moduleId && ' · arraste para reordenar'}
              </p>
            </div>
          </div>
          <Link
            href={`/admin/academy/aulas/novo${moduleId ? `?moduleId=${moduleId}` : ''}`}
            className="inline-flex items-center gap-2 rounded-lg bg-[var(--zaploto-green)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition"
          >
            <Plus className="h-4 w-4" /> Nova aula
          </Link>
        </div>

        {/* Filter bar */}
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
            <Filter className="h-3.5 w-3.5" /> Filtrar por módulo:
          </span>
          <Link
            href="/admin/academy/aulas"
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              !moduleId ? 'bg-[var(--zaploto-green)] text-white' : 'border border-[var(--card-border)] hover:bg-[var(--input-bg)]'
            }`}
          >
            Todos
          </Link>
          {modules.map((m) => (
            <Link
              key={m.id}
              href={`/admin/academy/aulas?moduleId=${m.id}`}
              className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                moduleId === m.id ? 'bg-[var(--zaploto-green)] text-white' : 'border border-[var(--card-border)] hover:bg-[var(--input-bg)]'
              }`}
            >
              {m.title}
            </Link>
          ))}
        </div>

        {currentModule && (
          <div className="mb-4 flex items-center gap-2 rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] px-4 py-3">
            <FileVideo className="h-4 w-4 text-[var(--zaploto-green)]" />
            <p className="text-sm font-medium">{currentModule.title}</p>
            <Link href={`/admin/academy/modulos/${currentModule.id}`} className="ml-auto text-xs text-[var(--zaploto-green)] hover:underline">
              Editar módulo
            </Link>
          </div>
        )}

        {reordering && (
          <div className="mb-3 flex items-center gap-2 rounded-lg bg-[var(--zaploto-green-bg)] px-3 py-2 text-sm text-[var(--zaploto-green)]">
            <Loader2 className="h-4 w-4 animate-spin" /> Salvando nova ordem…
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-[var(--zaploto-green)]" />
          </div>
        ) : lessons.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[var(--card-border)] p-16 text-center">
            <FileVideo className="mx-auto mb-3 h-10 w-10 text-[var(--muted-foreground)]" />
            <p className="font-medium text-[var(--muted-foreground)]">Nenhuma aula encontrada</p>
            <Link
              href={`/admin/academy/aulas/novo${moduleId ? `?moduleId=${moduleId}` : ''}`}
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[var(--zaploto-green)] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              <Plus className="h-4 w-4" /> Criar primeira aula
            </Link>
          </div>
        ) : (
          <ul className="space-y-2">
            {lessons.map((l, index) => {
              const typeInfo = CONTENT_TYPE_LABELS[l.content_type] ?? { label: l.content_type, color: 'bg-zinc-700/40 text-[var(--muted-foreground)]' };
              return (
                <li
                  key={l.id}
                  draggable={!!moduleId}
                  onDragStart={moduleId ? (e) => handleDragStart(e, l.id) : undefined}
                  onDragEnd={moduleId ? handleDragEnd : undefined}
                  onDragOver={moduleId ? handleDragOver : undefined}
                  onDrop={moduleId ? (e) => handleDrop(e, l.id) : undefined}
                  className={`flex items-center gap-3 rounded-xl border bg-[var(--card-bg)] p-3 transition ${
                    draggedId === l.id
                      ? 'border-[var(--zaploto-green-border)] opacity-50'
                      : 'border-[var(--card-border)] hover:border-[var(--zaploto-green-border)]'
                  } ${reordering ? 'pointer-events-none' : ''}`}
                >
                  {/* Drag handle or index */}
                  {moduleId ? (
                    <span className="cursor-grab active:cursor-grabbing text-[var(--muted-foreground)] shrink-0" title="Arraste para reordenar">
                      <GripVertical className="h-5 w-5" />
                    </span>
                  ) : (
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--input-bg)] text-xs font-bold text-[var(--muted-foreground)]">
                      {index + 1}
                    </span>
                  )}

                  {/* Info */}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium truncate">{l.title}</p>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${typeInfo.color}`}>
                        {typeInfo.label}
                      </span>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                        l.is_published
                          ? 'bg-[var(--zaploto-green-bg)] text-[var(--zaploto-green)]'
                          : 'bg-zinc-700/40 text-[var(--muted-foreground)]'
                      }`}>
                        {l.is_published ? 'Publicado' : 'Rascunho'}
                      </span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-[var(--muted-foreground)]">
                      <span>{getModuleTitle(l.module_id)}</span>
                      <span>·</span>
                      <span>/{l.slug}</span>
                      {l.estimated_minutes != null && (
                        <>
                          <span>·</span>
                          <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {l.estimated_minutes} min</span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => togglePublished(l)}
                      disabled={togglingId === l.id}
                      className="rounded-lg p-2 hover:bg-[var(--input-bg)] transition"
                      title={l.is_published ? 'Despublicar' : 'Publicar'}
                    >
                      {togglingId === l.id ? (
                        <Loader2 className="h-4 w-4 animate-spin text-[var(--muted-foreground)]" />
                      ) : l.is_published ? (
                        <Eye className="h-4 w-4 text-[var(--zaploto-green)]" />
                      ) : (
                        <EyeOff className="h-4 w-4 text-[var(--muted-foreground)]" />
                      )}
                    </button>
                    <Link href={`/admin/academy/aulas/${l.id}`} className="rounded-lg p-2 hover:bg-[var(--input-bg)] transition" title="Editar">
                      <Pencil className="h-4 w-4" />
                    </Link>
                    <button
                      type="button"
                      onClick={() => deleteLesson(l.id)}
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
