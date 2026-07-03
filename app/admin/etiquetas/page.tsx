'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Layout from '@/components/Layout';
import { useRequireAuth } from '@/utils/useRequireAuth';
import { Plus, Loader2, X, Trash2, Pencil, Tag as TagIcon, ArrowRight } from 'lucide-react';

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
    setOpen(true);
  };
  const openEdit = (tag: Tag) => {
    setEditing(tag);
    setForm({ label: tag.label, color: tag.color, move_to_column_key: tag.move_to_column_key ?? '' });
    setOpen(true);
  };

  const save = useCallback(async () => {
    if (!userId || !form.label.trim()) return;
    setSaving(true);
    try {
      const url = editing ? `/api/crm/tags/${editing.id}` : '/api/crm/tags';
      const method = editing ? 'PATCH' : 'POST';
      const res = await fetch(url, { method, headers, credentials: 'include', body: JSON.stringify(form) });
      const json = await res.json();
      if (json?.success) {
        setOpen(false);
        load();
      } else {
        alert(json?.error || 'Erro ao salvar etiqueta.');
      }
    } finally {
      setSaving(false);
    }
  }, [userId, form, editing, headers, load]);

  const remove = useCallback(async (tag: Tag) => {
    if (!userId || !window.confirm(`Remover a etiqueta "${tag.label}"?`)) return;
    await fetch(`/api/crm/tags/${tag.id}`, { method: 'DELETE', headers: { 'X-User-Id': userId }, credentials: 'include' });
    setTags((prev) => prev.filter((t) => t.id !== tag.id));
  }, [userId]);

  return (
    <Layout>
      <div className="p-4 sm:p-6">
        <div className="mb-5 flex items-center justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-bold text-white"><TagIcon className="h-5 w-5 text-[#E86A24]" /> Etiquetas do CRM</h1>
            <p className="text-sm text-gray-400">Crie etiquetas e configure para qual coluna o cliente é movido ao recebê-la.</p>
          </div>
          <button onClick={openNew} className="inline-flex items-center gap-2 rounded-xl bg-[#E86A24] px-4 py-2 text-sm font-bold text-white shadow-md transition hover:bg-[#D95E1B]">
            <Plus className="h-4 w-4" /> Nova etiqueta
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-24 text-gray-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : (
          <div className="max-w-2xl space-y-2">
            {tags.length === 0 && <p className="rounded-xl border border-dashed border-white/15 py-10 text-center text-sm text-gray-500">Nenhuma etiqueta cadastrada.</p>}
            {tags.map((tag) => (
              <div key={tag.id} className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/20 p-3 backdrop-blur-sm">
                <span className="rounded-full px-3 py-1 text-sm font-semibold"
                  style={{ backgroundColor: `${tag.color}22`, color: tag.color, border: `1px solid ${tag.color}55` }}>
                  {tag.label}
                </span>
                {tag.move_to_column_key && columnTitle(tag.move_to_column_key) && (
                  <span className="inline-flex items-center gap-1 text-xs text-gray-400">
                    <ArrowRight className="h-3.5 w-3.5" /> move para <b className="text-gray-200">{columnTitle(tag.move_to_column_key)}</b>
                  </span>
                )}
                <div className="ml-auto flex items-center gap-1">
                  <button onClick={() => openEdit(tag)} className="rounded p-1.5 text-gray-400 transition hover:bg-white/10 hover:text-white" title="Editar">
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button onClick={() => remove(tag)} className="rounded p-1.5 text-gray-400 transition hover:bg-white/10 hover:text-red-400" title="Remover">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#1c130d] p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">{editing ? 'Editar etiqueta' : 'Nova etiqueta'}</h2>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-200"><X className="h-5 w-5" /></button>
            </div>

            <label className="mb-1 block text-xs font-semibold text-gray-400">Nome</label>
            <input autoFocus value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
              placeholder="Ex: Quente, VIP…"
              className="mb-4 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-[#E86A24]" />

            <label className="mb-1 block text-xs font-semibold text-gray-400">Cor</label>
            <div className="mb-4 flex flex-wrap gap-2">
              {COLORS.map((c) => (
                <button key={c} onClick={() => setForm((f) => ({ ...f, color: c }))}
                  className={`h-7 w-7 rounded-full transition ${form.color === c ? 'ring-2 ring-white ring-offset-2 ring-offset-[#1c130d]' : ''}`}
                  style={{ backgroundColor: c }} title={c} />
              ))}
            </div>

            <label className="mb-1 block text-xs font-semibold text-gray-400">Ao adicionar esta etiqueta, mover o cliente para</label>
            <select value={form.move_to_column_key} onChange={(e) => setForm((f) => ({ ...f, move_to_column_key: e.target.value }))}
              className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-[#E86A24]">
              <option value="">— Não mover —</option>
              {columns.map((c) => <option key={c.id} value={c.key}>{c.title}</option>)}
            </select>

            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setOpen(false)} className="rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-gray-300">Cancelar</button>
              <button onClick={save} disabled={saving || !form.label.trim()}
                className="inline-flex items-center gap-2 rounded-xl bg-[#E86A24] px-4 py-2 text-sm font-bold text-white transition hover:bg-[#D95E1B] disabled:opacity-50">
                {saving && <Loader2 className="h-4 w-4 animate-spin" />} Salvar
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
