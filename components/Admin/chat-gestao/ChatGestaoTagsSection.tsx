'use client';

import React, { useState, useEffect } from 'react';
import { MessageSquare, Plus, Trash2, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import ChatGestaoTagsReport from '@/components/Admin/chat-gestao/ChatGestaoTagsReport';
import ZapCard from '@/components/ui/ZapCard';
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
    setError(null);
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
      } else setError(json.error || 'Erro ao criar');
    } catch {
      setError('Falha na conexão');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Excluir esta etiqueta? Ela deixará de aparecer no chat, mas conversas já marcadas manterão o texto da etiqueta.'))
      return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/admin/chat-tags/${id}`, {
        method: 'DELETE',
        headers: { 'X-User-Id': userId },
      });
      const json = await res.json();
      if (json.success) setTags((prev) => prev.filter((t) => t.id !== id));
      else setError(json.error || 'Erro ao excluir');
    } catch {
      setError('Falha na conexão');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <section className={secondary ? 'mt-10 pt-8 border-t border-gray-200 dark:border-[#404040]' : ''}>
      {secondary ? (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="w-full flex items-center justify-between gap-3 mb-4 text-left group"
        >
          <div className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-gray-400 group-hover:text-[#E86A24]" />
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
        <div className="mb-4 p-3 rounded-lg bg-red-900/20 text-red-300 text-sm">{error}</div>
      )}

      <form onSubmit={handleCreate} className="flex gap-2 mb-6">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Nome da etiqueta (ex: Urgente)"
          className={`flex-1 px-3 py-2 text-sm ${zapInput}`}
          maxLength={50}
        />
        <button
          type="submit"
          disabled={!newName.trim() || saving}
          className="px-4 py-2 text-sm font-medium rounded-lg flex items-center gap-2 bg-[#E86A24] text-white hover:opacity-90 disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Adicionar
        </button>
      </form>

      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="w-8 h-8 animate-spin text-gray-500" />
        </div>
      ) : tags.length === 0 ? (
        <div className="py-8 text-center text-gray-500 dark:text-gray-400 text-sm">
          Nenhuma etiqueta. Adicione uma acima para o atendente usar no chat.
        </div>
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
                onClick={() => handleDelete(tag.id)}
                disabled={deletingId === tag.id}
                className="p-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg disabled:opacity-50"
                title="Excluir etiqueta"
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
    </section>
  );
}
