'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Layout from '@/components/Layout';
import CrmSubNav from '@/components/CRM/CrmSubNav';
import { useRequireAuth } from '@/utils/useRequireAuth';
import { Plus, Loader2, Phone, Mail, User, Trash2, Upload, Check, MoreVertical, UserPlus, Tag as TagIcon, Columns3 } from 'lucide-react';
import { parseCrmImportContacts } from '@/lib/utils/crm-import-contacts';
import Modal, { ConfirmDialog } from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { ToastProvider, useToast } from '@/components/ui/ToastProvider';

type Tag = { id: string; label: string; color: string; move_to_column_key?: string | null };
type Column = { id: string; key: string; title: string; color: string; sort_order: number };
type Client = {
  external_id: string;
  owner_user_id: string | null;
  owner_name?: string | null;
  name: string;
  phone: string;
  email: string;
  column_key: string;
  position: number;
  tags: Tag[];
};
type Attendant = { id: string; name: string };

const COLOR_HEX: Record<string, string> = {
  gray: '#6b7280', blue: '#3b82f6', indigo: '#6366f1', amber: '#f59e0b', orange: '#E86A24',
  emerald: '#10b981', rose: '#f43f5e', red: '#ef4444', teal: '#14b8a6', purple: '#a855f7',
};
const COLOR_OPTIONS = Object.keys(COLOR_HEX);
const hexFor = (c: string) => COLOR_HEX[c] ?? '#6b7280';

export default function KanbanPage() {
  return (
    <ToastProvider>
      <KanbanBoard />
    </ToastProvider>
  );
}

function KanbanBoard() {
  const { userId } = useRequireAuth();
  const toast = useToast();
  const [columns, setColumns] = useState<Column[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [dragId, setDragId] = useState<string | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [addTargetColumn, setAddTargetColumn] = useState('');
  const [form, setForm] = useState({ name: '', phone: '', email: '' });
  const [saving, setSaving] = useState(false);

  const [showNewCol, setShowNewCol] = useState(false);
  const [newCol, setNewCol] = useState({ title: '', color: 'gray' });
  const [creatingCol, setCreatingCol] = useState(false);

  const [editColId, setEditColId] = useState<string | null>(null);
  const [editColTitle, setEditColTitle] = useState('');
  const [colToDelete, setColToDelete] = useState<Column | null>(null);
  const [deletingCol, setDeletingCol] = useState(false);
  const [menuColId, setMenuColId] = useState<string | null>(null);
  const [tagPickerId, setTagPickerId] = useState<string | null>(null);

  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState('');
  const [importColumn, setImportColumn] = useState('');
  const [importing, setImporting] = useState(false);
  const [importFileName, setImportFileName] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const [canViewAll, setCanViewAll] = useState(false);
  const [attendants, setAttendants] = useState<Attendant[]>([]);
  const [attendantFilter, setAttendantFilter] = useState('all');

  const headers = useMemo(() => ({ 'Content-Type': 'application/json', 'X-User-Id': userId ?? '' }), [userId]);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const [boardRes, tagsRes] = await Promise.all([
        fetch('/api/crm/board', { headers: { 'X-User-Id': userId }, credentials: 'include' }),
        fetch('/api/crm/tags', { headers: { 'X-User-Id': userId }, credentials: 'include' }),
      ]);
      const board = await boardRes.json();
      const tags = await tagsRes.json();
      if (board?.success) {
        setColumns(board.data.columns ?? []);
        setClients(board.data.clients ?? []);
        setCanViewAll(!!board.data.meta?.can_view_all);
        setAttendants(board.data.meta?.attendants ?? []);
      }
      if (tags?.success) setAllTags((tags.data ?? []).map((t: Tag) => ({ id: t.id, label: t.label, color: t.color, move_to_column_key: t.move_to_column_key ?? null })));
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  const visibleClients = useMemo(() => {
    if (!canViewAll || attendantFilter === 'all') return clients;
    return clients.filter((c) => c.owner_user_id === attendantFilter);
  }, [clients, canViewAll, attendantFilter]);

  const byColumn = useMemo(() => {
    const map = new Map<string, Client[]>();
    for (const col of columns) map.set(col.key, []);
    const fallback = columns[0]?.key;
    for (const c of visibleClients) {
      const key = map.has(c.column_key) ? c.column_key : fallback;
      if (!key) continue;
      (map.get(key) as Client[]).push(c);
    }
    if (canViewAll) {
      for (const [key, list] of map) {
        list.sort((a, b) => {
          const byOwner = (a.owner_name ?? '').localeCompare(b.owner_name ?? '', 'pt-BR');
          if (byOwner !== 0) return byOwner;
          return a.name.localeCompare(b.name, 'pt-BR');
        });
        map.set(key, list);
      }
    }
    return map;
  }, [columns, visibleClients, canViewAll]);

  const moveTo = useCallback(async (externalId: string, columnKey: string) => {
    const client = clients.find((c) => c.external_id === externalId);
    if (!client || client.column_key === columnKey || !userId) return;
    setClients((prev) => prev.map((c) => (c.external_id === externalId ? { ...c, column_key: columnKey } : c)));
    try {
      await fetch('/api/crm/board', {
        method: 'PATCH', headers, credentials: 'include',
        body: JSON.stringify({ lead_external_id: externalId, owner_user_id: client.owner_user_id, column_key: columnKey }),
      });
    } catch { load(); }
  }, [clients, userId, headers, load]);

  const openAddClient = (columnKey: string) => {
    setAddTargetColumn(columnKey);
    setForm({ name: '', phone: '', email: '' });
    setShowAdd(true);
    setMenuColId(null);
  };

  const addClient = useCallback(async () => {
    if (!userId || !form.name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch('/api/crm/board', {
        method: 'POST', headers, credentials: 'include',
        body: JSON.stringify({ ...form, column_key: addTargetColumn || undefined }),
      });
      const json = await res.json();
      if (json?.success) {
        setClients((prev) => [{ ...json.data, tags: json.data.tags ?? [] }, ...prev]);
        setShowAdd(false);
      } else {
        toast.error(json?.error || 'Erro ao adicionar cliente. Tente novamente.');
      }
    } catch {
      toast.error('Erro ao adicionar cliente. Verifique sua conexão e tente novamente.');
    } finally { setSaving(false); }
  }, [userId, form, addTargetColumn, headers, toast]);

  const createColumn = useCallback(async () => {
    if (!userId || !newCol.title.trim()) return;
    setCreatingCol(true);
    try {
      const res = await fetch('/api/crm/columns', { method: 'POST', headers, credentials: 'include', body: JSON.stringify(newCol) });
      const json = await res.json();
      if (json?.success) {
        setColumns((prev) => [...prev, json.data]);
        setNewCol({ title: '', color: 'gray' });
        setShowNewCol(false);
      } else {
        toast.error(json?.error || 'Erro ao criar coluna. Tente novamente.');
      }
    } catch {
      toast.error('Erro ao criar coluna. Verifique sua conexão e tente novamente.');
    } finally { setCreatingCol(false); }
  }, [userId, newCol, headers, toast]);

  const deleteColumn = useCallback(async () => {
    if (!userId || !colToDelete) return;
    setDeletingCol(true);
    try {
      await fetch(`/api/crm/columns/${colToDelete.id}`, { method: 'DELETE', headers: { 'X-User-Id': userId }, credentials: 'include' });
      setColToDelete(null);
      load();
    } catch {
      toast.error('Erro ao remover a coluna. Tente novamente.');
    } finally { setDeletingCol(false); }
  }, [userId, colToDelete, load, toast]);

  const saveColumnTitle = useCallback(async (col: Column) => {
    const title = editColTitle.trim();
    setEditColId(null);
    if (!userId || !title || title === col.title) return;
    setColumns((prev) => prev.map((c) => (c.id === col.id ? { ...c, title } : c)));
    await fetch(`/api/crm/columns/${col.id}`, { method: 'PATCH', headers, credentials: 'include', body: JSON.stringify({ title }) });
  }, [userId, editColTitle, headers]);

  const toggleTag = useCallback(async (client: Client, tag: Tag) => {
    if (!userId) return;
    const has = client.tags.some((t) => t.id === tag.id);
    setClients((prev) => prev.map((c) => {
      if (c.external_id !== client.external_id) return c;
      const tags = has
        ? c.tags.filter((t) => t.id !== tag.id)
        : [...c.tags, { id: tag.id, label: tag.label, color: tag.color }];
      // Automação: ao adicionar etiqueta com coluna-alvo, move o card também.
      const column_key = !has && tag.move_to_column_key ? tag.move_to_column_key : c.column_key;
      return { ...c, tags, column_key };
    }));
    const owner = client.owner_user_id ?? userId;
    if (has) {
      const qs = new URLSearchParams({ leadId: client.external_id, tagId: tag.id, targetUserId: owner });
      await fetch(`/api/crm/leads/tags?${qs.toString()}`, { method: 'DELETE', headers: { 'X-User-Id': userId }, credentials: 'include' });
    } else {
      await fetch('/api/crm/leads/tags', { method: 'POST', headers, credentials: 'include',
        body: JSON.stringify({ leadId: client.external_id, tagId: tag.id, targetUserId: owner }) });
    }
  }, [userId, headers]);

  const parsedImport = useMemo(() => parseCrmImportContacts(importText), [importText]);
  const doImport = useCallback(async () => {
    if (!userId || parsedImport.length === 0) return;
    setImporting(true);
    try {
      const res = await fetch('/api/crm/import', {
        method: 'POST', headers, credentials: 'include',
        body: JSON.stringify({ column_key: importColumn || columns[0]?.key, contacts: parsedImport }),
      });
      const json = await res.json();
      if (json?.success) { setShowImport(false); setImportText(''); load(); }
    } finally { setImporting(false); }
  }, [userId, parsedImport, importColumn, columns, headers, load]);

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setImportText(String(reader.result ?? ''));
      setImportFileName(file.name);
    };
    reader.readAsText(file, 'UTF-8');
    e.target.value = '';
  };

  return (
    <Layout>
      <div className="flex h-[calc(100vh-64px)] flex-col p-4 sm:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-white">CRM — Clientes</h1>
            <p className="text-sm text-gray-400">
              {canViewAll
                ? 'Visão de todos os clientes por atendente. Use o filtro para focar em um atendente.'
                : 'Arraste os clientes entre os estágios do funil.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canViewAll && attendants.length > 0 && (
              <label className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-gray-200">
                <span className="text-gray-400">Atendente</span>
                <select
                  value={attendantFilter}
                  onChange={(e) => setAttendantFilter(e.target.value)}
                  className="rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-sm text-white outline-none focus:border-[#E86A24]"
                >
                  <option value="all">Todos</option>
                  {attendants.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button
              onClick={() => {
                setNewCol({ title: '', color: 'gray' });
                setShowNewCol(true);
              }}
              className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-sm font-bold text-gray-200 transition hover:border-[#E86A24]/40 hover:bg-[#E86A24]/10 hover:text-[#E86A24]"
            >
              <Columns3 className="h-4 w-4" /> Nova coluna
            </button>
            <button onClick={() => { setImportColumn(columns[0]?.key ?? ''); setImportText(''); setImportFileName(''); setShowImport(true); }}
              className="inline-flex items-center gap-2 rounded-xl border border-[#E86A24]/40 bg-[#E86A24]/10 px-4 py-2 text-sm font-bold text-[#E86A24] transition hover:bg-[#E86A24]/20">
              <Upload className="h-4 w-4" /> Importar
            </button>
            <button onClick={() => openAddClient('')}
              className="inline-flex items-center gap-2 rounded-xl bg-[#E86A24] px-4 py-2 text-sm font-bold text-white shadow-md transition hover:bg-[#D95E1B]">
              <Plus className="h-4 w-4" /> Novo cliente
            </button>
          </div>
        </div>

        <CrmSubNav />

        {loading ? (
          <div className="flex flex-1 items-center justify-center text-gray-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : (
          <div className="flex min-h-0 flex-1 snap-x snap-mandatory items-stretch gap-4 overflow-x-auto pb-4">
            {columns.map((col) => {
              const list = byColumn.get(col.key) ?? [];
              const accent = hexFor(col.color);
              return (
                <div key={col.id}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => { if (dragId) moveTo(dragId, col.key); setDragId(null); }}
                  className="relative flex w-72 shrink-0 snap-start flex-col rounded-2xl border border-white/10 bg-black/20 p-3 backdrop-blur-sm">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: accent }} />
                      {editColId === col.id ? (
                        <input autoFocus value={editColTitle}
                          onChange={(e) => setEditColTitle(e.target.value)}
                          onBlur={() => saveColumnTitle(col)}
                          onKeyDown={(e) => { if (e.key === 'Enter') saveColumnTitle(col); if (e.key === 'Escape') setEditColId(null); }}
                          className="w-full rounded-md border border-[#E86A24]/50 bg-black/40 px-1.5 py-0.5 text-sm font-bold text-white outline-none" />
                      ) : (
                        <span className="truncate text-sm font-bold text-gray-100">{col.title}</span>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs font-semibold text-gray-300">{list.length}</span>
                      <button onClick={() => setMenuColId(menuColId === col.id ? null : col.id)}
                        className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg p-2 text-gray-400 transition hover:bg-white/10 hover:text-white" title="Opções">
                        <MoreVertical className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {menuColId === col.id && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setMenuColId(null)} />
                      <div className="absolute right-3 top-11 z-20 w-48 overflow-hidden rounded-xl border border-white/10 bg-[#1c130d] py-1 shadow-xl">
                        <MenuItem icon={<Pencilish />} label="Editar nome" onClick={() => { setEditColId(col.id); setEditColTitle(col.title); setMenuColId(null); }} />
                        <MenuItem icon={<UserPlus className="h-4 w-4" />} label="Adicionar cliente" onClick={() => openAddClient(col.key)} />
                        <MenuItem icon={<Trash2 className="h-4 w-4" />} label="Deletar coluna" danger onClick={() => { setMenuColId(null); setColToDelete(col); }} />
                      </div>
                    </>
                  )}

                  <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
                    {list.map((c) => (
                      <div key={c.external_id} draggable
                        onDragStart={() => setDragId(c.external_id)}
                        onDragEnd={() => setDragId(null)}
                        className="cursor-grab rounded-xl border border-white/10 bg-[#2a2a2a] p-3 shadow-sm transition hover:shadow-md active:cursor-grabbing"
                        style={{ borderLeft: `3px solid ${accent}` }}>
                        {canViewAll && c.owner_name && (
                          <div className="mb-2 inline-flex max-w-full items-center rounded-full bg-[#E86A24]/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#E86A24]">
                            <span className="truncate">{c.owner_name}</span>
                          </div>
                        )}
                        <div className="mb-1 flex items-center gap-2">
                          <User className="h-4 w-4 shrink-0 text-gray-400" />
                          <span className="truncate text-sm font-semibold text-white">{c.name}</span>
                        </div>
                        {c.phone && <div className="flex items-center gap-2 text-xs text-gray-400"><Phone className="h-3 w-3 shrink-0" /> <span className="truncate">{c.phone}</span></div>}
                        {c.email && <div className="flex items-center gap-2 text-xs text-gray-400"><Mail className="h-3 w-3 shrink-0" /> <span className="truncate">{c.email}</span></div>}

                        {/* Etiquetas */}
                        <div className="relative mt-2 flex flex-wrap items-center gap-1">
                          {c.tags.map((t) => (
                            <span key={t.id} className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
                              style={{ backgroundColor: `${t.color}22`, color: t.color, border: `1px solid ${t.color}55` }}>
                              {t.label}
                            </span>
                          ))}
                          <button onClick={() => setTagPickerId(tagPickerId === c.external_id ? null : c.external_id)}
                            className="inline-flex items-center gap-1 rounded-full border border-dashed border-white/20 px-2 py-0.5 text-[11px] text-gray-400 hover:border-[#E86A24]/50 hover:text-[#E86A24]">
                            <TagIcon className="h-3 w-3" /> {c.tags.length ? '' : 'Etiqueta'}
                          </button>

                          {tagPickerId === c.external_id && (
                            <>
                              <div className="fixed inset-0 z-10" onClick={() => setTagPickerId(null)} />
                              <div className="absolute left-0 top-7 z-20 w-52 rounded-xl border border-white/10 bg-[#1c130d] p-2 shadow-xl">
                                {allTags.length === 0 && <p className="px-1 py-1 text-xs text-gray-500">Nenhuma etiqueta cadastrada.</p>}
                                <div className="flex flex-wrap gap-1">
                                  {allTags.map((t) => {
                                    const active = c.tags.some((x) => x.id === t.id);
                                    return (
                                      <button key={t.id} onClick={() => toggleTag(c, t)}
                                        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold transition"
                                        style={{
                                          backgroundColor: active ? t.color : `${t.color}18`,
                                          color: active ? '#fff' : t.color,
                                          border: `1px solid ${t.color}${active ? '' : '55'}`,
                                        }}>
                                        {active && <Check className="h-3 w-3" />} {t.label}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                    {list.length === 0 && (
                      <div className="rounded-xl border border-dashed border-white/15 py-6 text-center text-xs text-gray-500">Sem clientes</div>
                    )}
                  </div>
                </div>
              );
            })}

          </div>
        )}
      </div>

      {/* Modais (kit) — wrapper .dark preserva a identidade dark-only da página */}
      <div className="dark">
        <Modal
          open={showNewCol}
          onClose={() => setShowNewCol(false)}
          title="Nova coluna"
          size="sm"
          footer={
            <>
              <Button variant="secondary" onClick={() => setShowNewCol(false)}>Cancelar</Button>
              <Button onClick={createColumn} loading={creatingCol} disabled={!newCol.title.trim()}>Criar coluna</Button>
            </>
          }
        >
          <div className="space-y-4">
            <Field label="Título da coluna" htmlFor="kanban-new-col-title" required>
              <Input
                id="kanban-new-col-title"
                autoFocus
                value={newCol.title}
                onChange={(e) => setNewCol((s) => ({ ...s, title: e.target.value }))}
                onKeyDown={(e) => e.key === 'Enter' && createColumn()}
                placeholder="Ex: Aguardando retorno"
              />
            </Field>
            <div>
              <p className="mb-2 text-xs font-medium text-gray-500 dark:text-gray-400">Cor da coluna</p>
              <div className="flex flex-wrap gap-2">
                {COLOR_OPTIONS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setNewCol((s) => ({ ...s, color: c }))}
                    className="flex h-10 w-10 items-center justify-center rounded-full ring-2 ring-offset-2 ring-offset-white transition dark:ring-offset-[#2a2a2a]"
                    style={{
                      backgroundColor: hexFor(c),
                      '--tw-ring-color': newCol.color === c ? hexFor(c) : 'transparent',
                    } as React.CSSProperties}
                    title={c}
                  >
                    {newCol.color === c && <Check className="h-4 w-4 text-white" />}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </Modal>

        <Modal
          open={showAdd}
          onClose={() => setShowAdd(false)}
          title={addTargetColumn ? `Novo cliente — ${columns.find((c) => c.key === addTargetColumn)?.title ?? ''}` : 'Novo cliente'}
          size="sm"
          footer={
            <>
              <Button variant="secondary" onClick={() => setShowAdd(false)}>Cancelar</Button>
              <Button onClick={addClient} loading={saving} disabled={!form.name.trim()}>Salvar</Button>
            </>
          }
        >
          <div className="space-y-3">
            {(['name', 'phone', 'email'] as const).map((field) => (
              <Field
                key={field}
                label={field === 'name' ? 'Nome' : field === 'phone' ? 'Telefone' : 'E-mail'}
                required={field === 'name'}
                htmlFor={`kanban-add-client-${field}`}
              >
                <Input
                  id={`kanban-add-client-${field}`}
                  value={form[field]}
                  onChange={(e) => setForm((f) => ({ ...f, [field]: e.target.value }))}
                  placeholder={field === 'name' ? 'Nome do cliente' : field === 'phone' ? 'Telefone' : 'E-mail'}
                />
              </Field>
            ))}
          </div>
        </Modal>

        <Modal
          open={showImport}
          onClose={() => { setShowImport(false); setImportFileName(''); }}
          title="Importar contatos"
          size="lg"
          footer={
            <>
              <Button variant="secondary" onClick={() => setShowImport(false)}>Cancelar</Button>
              <Button onClick={doImport} loading={importing} disabled={parsedImport.length === 0}>
                {`Importar ${parsedImport.length || ''}`.trim()}
              </Button>
            </>
          }
        >
          <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">
            Envie um <strong className="text-gray-700 dark:text-gray-300">.csv</strong> com colunas <code>nome</code> e <code>telefone</code> (também aceita <code>name</code>, <code>phone</code>, <code>email</code>),
            ou cole linhas no formato <code>Nome, Telefone, E-mail</code>.
          </p>
          <Textarea value={importText} onChange={(e) => { setImportText(e.target.value); setImportFileName(''); }} rows={8}
            placeholder={'nome,telefone\nJoão Silva,5511999999999\nMaria Santos,5511888888888'}
            className="font-mono text-xs" />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <input ref={fileRef} type="file" accept=".csv,.txt,text/csv" onChange={onFile} className="hidden" />
            <Button variant="secondary" size="sm" icon={<Upload className="h-4 w-4" />} onClick={() => fileRef.current?.click()}>
              Enviar CSV
            </Button>
            {importFileName && (
              <span className="text-xs text-gray-500 dark:text-gray-400">Arquivo: {importFileName}</span>
            )}
            <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">Coluna:
              <Select value={importColumn} onChange={(e) => setImportColumn(e.target.value)} className="w-auto">
                {columns.map((c) => <option key={c.id} value={c.key}>{c.title}</option>)}
              </Select>
            </label>
            <span className="ml-auto text-sm font-semibold text-[#E86A24]">{parsedImport.length} contato(s)</span>
          </div>
          {parsedImport.length > 0 && (
            <div className="mt-3 max-h-32 overflow-y-auto rounded-xl border border-gray-200 bg-gray-50 p-2 dark:border-white/10 dark:bg-black/30">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-gray-500">Prévia</p>
              <ul className="space-y-1 text-xs text-gray-700 dark:text-gray-300">
                {parsedImport.slice(0, 5).map((c, i) => (
                  <li key={`${c.phone}-${c.name}-${i}`} className="truncate">
                    <span className="font-semibold text-gray-900 dark:text-white">{c.name}</span>
                    {c.phone ? <span className="text-gray-500 dark:text-gray-400"> · {c.phone}</span> : null}
                    {c.email ? <span className="text-gray-400 dark:text-gray-500"> · {c.email}</span> : null}
                  </li>
                ))}
                {parsedImport.length > 5 && (
                  <li className="text-gray-500">+ {parsedImport.length - 5} contato(s)…</li>
                )}
              </ul>
            </div>
          )}
        </Modal>

        <ConfirmDialog
          open={!!colToDelete}
          onClose={() => { if (!deletingCol) setColToDelete(null); }}
          onConfirm={deleteColumn}
          title="Deletar coluna"
          description={colToDelete
            ? ((byColumn.get(colToDelete.key) ?? []).length
              ? `Remover "${colToDelete.title}"? Os ${(byColumn.get(colToDelete.key) ?? []).length} cliente(s) voltam para o 1º estágio.`
              : `Remover a coluna "${colToDelete.title}"?`)
            : undefined}
          confirmLabel="Remover"
          loading={deletingCol}
        />
      </div>
    </Layout>
  );
}

function Pencilish() {
  // ícone lápis inline (evita import extra)
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
      <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function MenuItem({ icon, label, onClick, danger }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition hover:bg-white/5 ${danger ? 'text-red-400' : 'text-gray-200'}`}>
      {icon} {label}
    </button>
  );
}

