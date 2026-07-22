'use client';

import React, { useState, useEffect } from 'react';
import { MessageSquare, Plus, Trash2, Loader2, ChevronDown, ChevronUp, RefreshCw, Tag } from 'lucide-react';
import ChatGestaoTagsReport from '@/components/Admin/chat-gestao/ChatGestaoTagsReport';
import ZapCard from '@/components/ui/ZapCard';
import { Banner, Button, ConfirmDialog, EmptyState, Skeleton } from '@/components/ui';
import ToastContainer from '@/components/Toast/ToastContainer';
import type { Toast as ToastType } from '@/components/Toast/Toast';
import { zapCardMuted, zapInput } from '@/lib/zap-card-styles';

interface ChatTag {
  id: string;
  zaploto_id: string | null;
  name: string;
  color: string | null;
  sort_order: number;
  created_at?: string;
}

export default function ChatGestaoTagsSection({
  userId,
  secondary = false,
}: {
  userId: string;
  secondary?: boolean;
}) {
  const [open, setOpen] = useState(!secondary);
  const [tags, setTags] = useState<ChatTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastType[]>([]);

  const pushToast = (message: string, type: ToastType['type']) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((prev) => [...prev, { id, message, type }]);
  };

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const fetchTags = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/chat-tags', { headers: { 'X-User-Id': userId } });
      const json = await res.json();
      if (json.success) setTags(json.data || []);
      else setError(json.error || 'Erro ao carregar');
    } catch {
      setError('Falha na conexão');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTags();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name || saving) return;
    setSaving(true);
    try {
      const res = await fetch('/api/admin/chat-tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
        body: JSON.stringify({ name }),
      });
      const json = await res.json();
      if (json.success) {
        setTags((prev) => [...prev, json.data]);
        setNewName('');
        pushToast('Etiqueta criada com sucesso.', 'success');
      } else pushToast(json.error || 'Erro ao criar etiqueta.', 'error');
    } catch {
      pushToast('Falha na conexão ao criar etiqueta.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/admin/chat-tags/${id}`, {
        method: 'DELETE',
        headers: { 'X-User-Id': userId },
      });
      const json = await res.json();
      if (json.success) {
        setTags((prev) => prev.filter((t) => t.id !== id));
        pushToast('Etiqueta excluída.', 'success');
      } else pushToast(json.error || 'Erro ao excluir etiqueta.', 'error');
    } catch {
      pushToast('Falha na conexão ao excluir etiqueta.', 'error');
    } finally {
      setDeletingId(null);
      setConfirmDeleteId(null);
    }
  };

  const confirmTag = confirmDeleteId ? tags.find((t) => t.id === confirmDeleteId) : null;

  return (
    <section className={secondary ? 'mt-10 pt-8 border-t border-gray-200 dark:border-[#404040]' : ''}>
      {secondary ? (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="w-full flex items-center justify-between gap-3 mb-4 min-h-[44px] text-left group rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E86A24]/50"
        >
          <div className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-gray-400 group-hover:text-[#E86A24] transition-colors" />
            <div>
              <h2 className="text-base font-semibold text-gray-700 dark:text-gray-300">Etiquetas do chat</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Classifique conversas e veja o relatório de conversas etiquetadas
              </p>
            </div>
          </div>
          {open ? (
            <ChevronUp className="w-5 h-5 text-gray-400 shrink-0" />
          ) : (
            <ChevronDown className="w-5 h-5 text-gray-400 shrink-0" />
          )}
        </button>
      ) : (
        <div className="flex items-center gap-3 mb-6">
          <MessageSquare className="w-8 h-8 text-[#E86A24]" />
          <div>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Etiquetas do chat</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Crie etiquetas para o atendente usar nas conversas (ex: Urgente, Reclamação). Elas aparecem no filtro e ao
              marcar conversas.
            </p>
          </div>
        </div>
      )}

      {(!secondary || open) && (
        <ZapCard className={secondary ? 'w-full' : 'max-w-2xl mx-auto'}>
      {error && (
        <Banner
          variant="error"
          title={error}
          className="mb-4"
          action={
            <Button
              size="sm"
              variant="secondary"
              onClick={fetchTags}
              icon={<RefreshCw className="w-4 h-4" />}
            >
              Tentar novamente
            </Button>
          }
        >
          Não foi possível carregar as etiquetas.
        </Banner>
      )}

      <form onSubmit={handleCreate} className="flex gap-2 mb-6">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Nome da etiqueta (ex: Urgente)"
          aria-label="Nome da nova etiqueta"
          className={`flex-1 px-3 py-2 text-sm ${zapInput}`}
          maxLength={50}
        />
        <Button
          type="submit"
          size="sm"
          disabled={!newName.trim()}
          loading={saving}
          icon={<Plus className="w-4 h-4" />}
        >
          Adicionar
        </Button>
      </form>

      {loading ? (
        <ul className="space-y-2" aria-hidden="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <li key={i} className={`flex items-center justify-between gap-4 p-3 ${zapCardMuted}`}>
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-8 w-8 rounded-lg" />
            </li>
          ))}
        </ul>
      ) : tags.length === 0 ? (
        <EmptyState
          compact
          icon={<Tag className="w-5 h-5" />}
          title="Nenhuma etiqueta cadastrada"
          description="Adicione uma etiqueta acima para o atendente usar no chat."
        />
      ) : (
        <ul className="space-y-2">
          {tags.map((tag) => (
            <li
              key={tag.id}
              className={`flex items-center justify-between gap-4 p-3 rounded-lg ${zapCardMuted}`}
            >
              <span className="font-medium text-white">{tag.name}</span>
              <button
                type="button"
                onClick={() => setConfirmDeleteId(tag.id)}
                disabled={deletingId === tag.id}
                aria-label={`Excluir etiqueta ${tag.name}`}
                title="Excluir etiqueta"
                className="flex items-center justify-center min-w-[40px] min-h-[40px] text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg disabled:opacity-50 transition-colors"
              >
                {deletingId === tag.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              </button>
            </li>
          ))}
        </ul>
      )}

      <ChatGestaoTagsReport userId={userId} availableTags={tags.map((t) => t.name)} />
        </ZapCard>
      )}

      <ConfirmDialog
        open={!!confirmDeleteId}
        onClose={() => setConfirmDeleteId(null)}
        onConfirm={() => {
          if (confirmDeleteId) handleDelete(confirmDeleteId);
        }}
        title="Excluir etiqueta"
        description={
          <>
            Excluir a etiqueta{confirmTag ? <strong> “{confirmTag.name}”</strong> : ''}? Ela deixará de aparecer no
            chat, mas conversas já marcadas manterão o texto da etiqueta.
          </>
        }
        confirmLabel="Excluir"
        cancelLabel="Cancelar"
        tone="danger"
        loading={!!deletingId}
      />

      <ToastContainer toasts={toasts} onClose={removeToast} />
    </section>
  );
}
