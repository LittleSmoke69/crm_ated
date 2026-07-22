'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Layout from '@/components/Layout';
import { useRequireAuth } from '@/utils/useRequireAuth';
import { Plus, Trash2, Pencil, Tag as TagIcon, ArrowRight } from 'lucide-react';
import { Badge, Banner, Button, ConfirmDialog, EmptyState, Field, Input, Modal, Select, Skeleton } from '@/components/ui';

type Tag = { id: string; label: string; color: string; move_to_column_key: string | null };
type Column = { id: string; key: string; title: string };

const COLORS = ['#E86A24', '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#6366f1', '#a855f7', '#f43f5e', '#14b8a6', '#6b7280'];

export default function EtiquetasPage() {
  const { userId } = useRequireAuth();
  const [tags, setTags] = useState<Tag[]>([]);
  const [columns, setColumns] = useState<Column[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Tag | null>(null);
  const [form, setForm] = useState({ label: '', color: COLORS[0], move_to_column_key: '' });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleteTag, setDeleteTag] = useState<Tag | null>(null);
  const [deleting, setDeleting] = useState(false);

  const headers = useMemo(() => ({ 'Content-Type': 'application/json', 'X-User-Id': userId ?? '' }), [userId]);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const [tagsRes, boardRes] = await Promise.all([
        fetch('/api/crm/tags', { headers: { 'X-User-Id': userId }, credentials: 'include' }),
        fetch('/api/crm/board', { headers: { 'X-User-Id': userId }, credentials: 'include' }),
      ]);
      const t = await tagsRes.json();
      const b = await boardRes.json();
      if (t?.success) setTags(t.data ?? []);
      if (b?.success) setColumns(b.data.columns ?? []);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  const columnTitle = (key: string | null) => columns.find((c) => c.key === key)?.title ?? null;

  const openNew = () => {
    setEditing(null);
    setForm({ label: '', color: COLORS[0], move_to_column_key: '' });
    setSaveError(null);
    setOpen(true);
  };
  const openEdit = (tag: Tag) => {
    setEditing(tag);
    setForm({ label: tag.label, color: tag.color, move_to_column_key: tag.move_to_column_key ?? '' });
    setSaveError(null);
    setOpen(true);
  };

  const save = useCallback(async () => {
    if (!userId || !form.label.trim()) return;
    setSaving(true);
    setSaveError(null);
    try {
      const url = editing ? `/api/crm/tags/${editing.id}` : '/api/crm/tags';
      const method = editing ? 'PATCH' : 'POST';
      const res = await fetch(url, { method, headers, credentials: 'include', body: JSON.stringify(form) });
      const json = await res.json();
      if (json?.success) {
        setOpen(false);
        load();
      } else {
        setSaveError(json?.error || 'Erro ao salvar etiqueta.');
      }
    } finally {
      setSaving(false);
    }
  }, [userId, form, editing, headers, load]);

  const confirmRemove = useCallback(async () => {
    if (!userId || !deleteTag) return;
    setDeleting(true);
    try {
      await fetch(`/api/crm/tags/${deleteTag.id}`, { method: 'DELETE', headers: { 'X-User-Id': userId }, credentials: 'include' });
      setTags((prev) => prev.filter((t) => t.id !== deleteTag.id));
      setDeleteTag(null);
    } finally {
      setDeleting(false);
    }
  }, [userId, deleteTag]);

  return (
    <Layout>
      <div className="p-4 sm:p-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-bold text-gray-900 dark:text-white"><TagIcon className="h-5 w-5 text-[#E86A24]" /> Etiquetas do CRM</h1>
            <p className="text-sm text-gray-600 dark:text-gray-400">Crie etiquetas e configure para qual coluna o cliente é movido ao recebê-la.</p>
          </div>
          <Button onClick={openNew} icon={<Plus className="h-4 w-4" />}>Nova etiqueta</Button>
        </div>

        {loading ? (
          <div className="max-w-2xl space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-[60px] w-full rounded-xl" />
            ))}
          </div>
        ) : (
          <div className="max-w-2xl space-y-2">
            {tags.length === 0 && (
              <div className="rounded-2xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-[#2a2a2a]">
                <EmptyState
                  icon={<TagIcon className="h-7 w-7" />}
                  title="Nenhuma etiqueta cadastrada"
                  description="Crie etiquetas para organizar seus clientes e automatizar a movimentação no kanban."
                  action={<Button onClick={openNew} icon={<Plus className="h-4 w-4" />}>Nova etiqueta</Button>}
                />
              </div>
            )}
            {tags.map((tag) => (
              <div key={tag.id} className="flex items-center gap-3 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-[#2a2a2a] p-3 shadow-sm">
                <Badge hexColor={tag.color}>{tag.label}</Badge>
                {tag.move_to_column_key && columnTitle(tag.move_to_column_key) && (
                  <span className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                    <ArrowRight className="h-3.5 w-3.5" /> move para <b className="text-gray-800 dark:text-gray-200">{columnTitle(tag.move_to_column_key)}</b>
                  </span>
                )}
                <div className="ml-auto flex items-center gap-1">
                  <button
                    onClick={() => openEdit(tag)}
                    className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg p-2 text-gray-500 dark:text-gray-400 transition-colors hover:bg-gray-100 dark:hover:bg-[#333] hover:text-gray-800 dark:hover:text-white"
                    title="Editar"
                    aria-label={`Editar etiqueta ${tag.label}`}
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => setDeleteTag(tag)}
                    className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg p-2 text-gray-500 dark:text-gray-400 transition-colors hover:bg-red-50 dark:hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400"
                    title="Remover"
                    aria-label={`Remover etiqueta ${tag.label}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? 'Editar etiqueta' : 'Nova etiqueta'}
        icon={<TagIcon className="h-5 w-5" />}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={saving}>Cancelar</Button>
            <Button onClick={save} loading={saving} disabled={saving || !form.label.trim()}>Salvar</Button>
          </>
        }
      >
        <div className="space-y-4">
          {saveError && <Banner variant="error">{saveError}</Banner>}

          <Field label="Nome" htmlFor="tag-label" required>
            <Input
              id="tag-label"
              autoFocus
              value={form.label}
              onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
              placeholder="Ex: Quente, VIP…"
            />
          </Field>

          <Field label="Cor">
            <div className="flex flex-wrap gap-2 pt-1">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, color: c }))}
                  className={`h-8 w-8 rounded-full transition ${form.color === c ? 'ring-2 ring-[#E86A24] ring-offset-2 ring-offset-white dark:ring-offset-[#2a2a2a]' : ''}`}
                  style={{ backgroundColor: c }}
                  title={c}
                  aria-label={`Selecionar cor ${c}`}
                />
              ))}
            </div>
          </Field>

          <Field label="Ao adicionar esta etiqueta, mover o cliente para" htmlFor="tag-move">
            <Select
              id="tag-move"
              value={form.move_to_column_key}
              onChange={(e) => setForm((f) => ({ ...f, move_to_column_key: e.target.value }))}
            >
              <option value="">— Não mover —</option>
              {columns.map((c) => <option key={c.id} value={c.key}>{c.title}</option>)}
            </Select>
          </Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteTag}
        onClose={() => setDeleteTag(null)}
        onConfirm={confirmRemove}
        title="Remover etiqueta"
        description={<>Tem certeza que deseja remover a etiqueta <strong>{deleteTag?.label}</strong>? Ela será desvinculada dos clientes que a possuem.</>}
        confirmLabel="Remover"
        loading={deleting}
      />
    </Layout>
  );
}
