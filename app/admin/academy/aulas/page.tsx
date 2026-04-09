'use client';

import { Suspense, useEffect, useState, useCallback, useRef } from 'react';
import Layout from '@/components/Layout';
import { useRequireAuth } from '@/utils/useRequireAuth';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Plus, Pencil, Trash2, Loader2, Eye, EyeOff, GripVertical, ArrowLeft, FileVideo, Clock, Filter, Users, X, ArrowRightLeft } from 'lucide-react';
import { getStoredUserId } from '@/lib/utils/stored-user-id';
import { ZAPLOTO_ACADEMY_ROLE_OPTIONS } from '@/lib/academy/lesson-role-access';

type Lesson = {
  id: string;
  module_id: string;
  title: string;
  slug: string;
  order_index: number;
  is_published: boolean;
  content_type: string;
  estimated_minutes: number | null;
  allowed_role_codes?: string[] | null;
};

function roleRestrictionLabel(codes: string[] | null | undefined): string {
  if (!codes?.length) return '';
  return codes
    .map((c) => ZAPLOTO_ACADEMY_ROLE_OPTIONS.find((o) => o.code === c)?.label ?? c)
    .join(', ');
}

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
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [bulkRoleDraft, setBulkRoleDraft] = useState<string[]>([]);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [moveModalIds, setMoveModalIds] = useState<string[] | null>(null);
  const [moveTargetModuleId, setMoveTargetModuleId] = useState('');
  const [moveSaving, setMoveSaving] = useState(false);
  const masterCheckboxRef = useRef<HTMLInputElement>(null);

  const fetchData = useCallback(() => {
    const h = { 'x-user-id': getStoredUserId() ?? '' };
    Promise.all([
      fetch('/api/admin/academy/lessons' + (moduleId ? `?moduleId=${moduleId}` : ''), { headers: h }).then((r) => (r.ok ? r.json() : [])),
      fetch('/api/admin/academy/modules', { headers: h }).then((r) => (r.ok ? r.json() : [])),
    ]).then(([lessonsData, modulesData]) => {
      setLessons(lessonsData);
      setModules(modulesData);
      setLoading(false);
      setSelectedIds((prev) => prev.filter((id) => (lessonsData as Lesson[]).some((l) => l.id === id)));
    });
  }, [moduleId]);

  useEffect(() => {
    if (!userId) return;
    fetchData();
  }, [userId, fetchData]);

  const allVisibleSelected =
    lessons.length > 0 && lessons.every((l) => selectedIds.includes(l.id));
  const someVisibleSelected = selectedIds.length > 0 && !allVisibleSelected;

  useEffect(() => {
    const el = masterCheckboxRef.current;
    if (el) el.indeterminate = someVisibleSelected;
  }, [someVisibleSelected]);

  const toggleLessonSelected = (id: string) => {
    setSelectedIds((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  };

  const toggleSelectAllVisible = () => {
    if (allVisibleSelected) {
      const visible = new Set(lessons.map((l) => l.id));
      setSelectedIds((s) => s.filter((id) => !visible.has(id)));
    } else {
      setSelectedIds((s) => [...new Set([...s, ...lessons.map((l) => l.id)])]);
    }
  };

  const openBulkModal = () => {
    setBulkRoleDraft([]);
    setBulkModalOpen(true);
  };

  const applyBulkRoles = async () => {
    if (selectedIds.length === 0) return;
    setBulkSaving(true);
    try {
      const res = await fetch('/api/admin/academy/lessons/bulk-roles', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': getStoredUserId() ?? '',
        },
        body: JSON.stringify({
          lessonIds: selectedIds,
          allowed_role_codes: bulkRoleDraft.length > 0 ? bulkRoleDraft : null,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(j.error || 'Erro ao atualizar');
        return;
      }
      setBulkModalOpen(false);
      setSelectedIds([]);
      fetchData();
    } finally {
      setBulkSaving(false);
    }
  };

  const toggleBulkRole = (code: string) => {
    setBulkRoleDraft((cur) => (cur.includes(code) ? cur.filter((c) => c !== code) : [...cur, code]));
  };

  const openMoveModal = (ids: string[]) => {
    if (ids.length === 0) return;
    setMoveTargetModuleId('');
    setMoveModalIds(ids);
  };

  const applyMoveToModule = async () => {
    if (!moveModalIds?.length || !moveTargetModuleId) return;
    setMoveSaving(true);
    try {
      const res = await fetch('/api/admin/academy/lessons/move', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': getStoredUserId() ?? '',
        },
        body: JSON.stringify({
          lessonIds: moveModalIds,
          targetModuleId: moveTargetModuleId,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(j.error || 'Erro ao mover aulas');
        return;
      }
      if (typeof j.message === 'string' && j.moved === 0) {
        alert(j.message);
      }
      const movedIds = moveModalIds;
      setMoveModalIds(null);
      setSelectedIds((prev) => prev.filter((id) => !movedIds.includes(id)));
      fetchData();
    } finally {
      setMoveSaving(false);
    }
  };

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

        {!loading && lessons.length > 0 && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] px-4 py-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                ref={masterCheckboxRef}
                type="checkbox"
                checked={allVisibleSelected}
                onChange={toggleSelectAllVisible}
                className="rounded"
              />
              <span className="text-[var(--foreground)]">Selecionar todas nesta lista</span>
            </label>
            {selectedIds.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-[var(--zaploto-green)]">
                  {selectedIds.length} selecionada{selectedIds.length !== 1 ? 's' : ''}
                </span>
                <button
                  type="button"
                  onClick={() => openMoveModal([...selectedIds])}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--card-border)] bg-[var(--input-bg)] px-3 py-1.5 text-sm font-medium hover:bg-[var(--card-bg)]"
                >
                  <ArrowRightLeft className="h-4 w-4" />
                  Mover de módulo
                </button>
                <button
                  type="button"
                  onClick={openBulkModal}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--zaploto-green)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
                >
                  <Users className="h-4 w-4" />
                  Definir cargos em lote
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedIds([])}
                  className="text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                >
                  Limpar seleção
                </button>
              </div>
            )}
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
                  onDragOver={moduleId ? handleDragOver : undefined}
                  onDrop={moduleId ? (e) => handleDrop(e, l.id) : undefined}
                  className={`flex items-center gap-3 rounded-xl border bg-[var(--card-bg)] p-3 transition ${
                    draggedId === l.id
                      ? 'border-[var(--zaploto-green-border)] opacity-50'
                      : 'border-[var(--card-border)] hover:border-[var(--zaploto-green-border)]'
                  } ${reordering ? 'pointer-events-none' : ''}`}
                >
                  <label
                    className="flex shrink-0 cursor-pointer items-center py-1"
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(l.id)}
                      onChange={() => toggleLessonSelected(l.id)}
                      className="rounded"
                      aria-label={`Selecionar ${l.title}`}
                    />
                  </label>
                  {/* Drag handle or index */}
                  {moduleId ? (
                    <span
                      draggable
                      onDragStart={(e) => handleDragStart(e, l.id)}
                      onDragEnd={handleDragEnd}
                      className="cursor-grab active:cursor-grabbing text-[var(--muted-foreground)] shrink-0 touch-none"
                      title="Arraste para reordenar"
                    >
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
                      {l.allowed_role_codes && l.allowed_role_codes.length > 0 && (
                        <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400" title={roleRestrictionLabel(l.allowed_role_codes)}>
                          Por cargo
                        </span>
                      )}
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
                    <button
                      type="button"
                      onClick={() => openMoveModal([l.id])}
                      className="rounded-lg p-2 hover:bg-[var(--input-bg)] transition"
                      title="Mover para outro módulo"
                    >
                      <ArrowRightLeft className="h-4 w-4 text-[var(--muted-foreground)]" />
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

        {moveModalIds && (
          <div
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
            role="dialog"
            aria-modal="true"
            aria-labelledby="move-module-title"
          >
            <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-5 shadow-xl">
              <div className="mb-4 flex items-start justify-between gap-2">
                <div>
                  <h2 id="move-module-title" className="text-lg font-bold">
                    Mover para outro módulo
                  </h2>
                  <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                    {moveModalIds.length} aula{moveModalIds.length !== 1 ? 's' : ''} — serão adicionadas ao{' '}
                    <strong>final</strong> do módulo escolhido, mantendo a ordem relativa entre elas.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setMoveModalIds(null)}
                  className="rounded-lg p-2 hover:bg-[var(--input-bg)]"
                  aria-label="Fechar"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <label className="mb-4 block text-sm font-medium">
                Módulo de destino
                <select
                  value={moveTargetModuleId}
                  onChange={(e) => setMoveTargetModuleId(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2"
                >
                  <option value="">Selecione…</option>
                  {modules.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.title}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={moveSaving || !moveTargetModuleId}
                  onClick={applyMoveToModule}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-[var(--zaploto-green)] px-4 py-2.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 sm:flex-none"
                >
                  {moveSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Mover
                </button>
                <button
                  type="button"
                  disabled={moveSaving}
                  onClick={() => setMoveModalIds(null)}
                  className="rounded-lg border border-[var(--card-border)] px-4 py-2.5 text-sm"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        )}

        {bulkModalOpen && (
          <div
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
            role="dialog"
            aria-modal="true"
            aria-labelledby="bulk-roles-title"
          >
            <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-5 shadow-xl">
              <div className="mb-4 flex items-start justify-between gap-2">
                <div>
                  <h2 id="bulk-roles-title" className="text-lg font-bold">
                    Cargos em lote
                  </h2>
                  <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                    Aplicar aos mesmos cargos em <strong>{selectedIds.length}</strong> aula
                    {selectedIds.length !== 1 ? 's' : ''} selecionada{selectedIds.length !== 1 ? 's' : ''}.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setBulkModalOpen(false)}
                  className="rounded-lg p-2 hover:bg-[var(--input-bg)]"
                  aria-label="Fechar"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <p className="mb-3 text-xs text-[var(--muted-foreground)]">
                Nenhum cargo marcado = aula visível para <strong>todos</strong> os perfis. Marque um ou mais para
                restringir (substitui a configuração atual de cada aula selecionada).
              </p>
              <div className="mb-6 grid gap-2 sm:grid-cols-2">
                {ZAPLOTO_ACADEMY_ROLE_OPTIONS.map(({ code, label }) => (
                  <label
                    key={code}
                    className="flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--card-border)] bg-[var(--input-bg)] px-3 py-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      className="rounded"
                      checked={bulkRoleDraft.includes(code)}
                      onChange={() => toggleBulkRole(code)}
                    />
                    {label}
                  </label>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={bulkSaving}
                  onClick={applyBulkRoles}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-[var(--zaploto-green)] px-4 py-2.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 sm:flex-none"
                >
                  {bulkSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Aplicar
                </button>
                <button
                  type="button"
                  disabled={bulkSaving}
                  onClick={() => setBulkModalOpen(false)}
                  className="rounded-lg border border-[var(--card-border)] px-4 py-2.5 text-sm"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
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
