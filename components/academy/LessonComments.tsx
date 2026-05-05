'use client';

import React, { useEffect, useState } from 'react';
import { MessageCircle, Send, Loader2, Lock } from 'lucide-react';
import Link from '@/components/WhitelabelLink';
import { getStoredUserId } from '@/lib/utils/stored-user-id';

type Comment = {
  id: string;
  lesson_id: string;
  user_id: string;
  parent_id: string | null;
  body: string;
  created_at: string;
  updated_at?: string;
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60000) return 'Agora';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} min atrás`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} h atrás`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)} dias atrás`;
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function LessonComments({ lessonSlug }: { lessonSlug: string }) {
  const userId = getStoredUserId();
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [newBody, setNewBody] = useState('');
  const [error, setError] = useState<string | null>(null);

  const fetchComments = () => {
    fetch(`/api/academy/lessons/${encodeURIComponent(lessonSlug)}/comments`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        setComments(Array.isArray(data) ? data : []);
        setError(null);
      })
      .catch(() => setError('Erro ao carregar comentários'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!lessonSlug) return;
    fetchComments();
  }, [lessonSlug]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = newBody.trim();
    if (!body || !userId) return;
    setPosting(true);
    setError(null);
    try {
      const res = await fetch(`/api/academy/lessons/${encodeURIComponent(lessonSlug)}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': userId },
        body: JSON.stringify({ body }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Erro ao enviar');
        return;
      }
      setNewBody('');
      fetchComments();
    } finally {
      setPosting(false);
    }
  };

  const topLevel = comments.filter((c) => !c.parent_id);
  const byParent = comments.reduce<Record<string, Comment[]>>((acc, c) => {
    if (c.parent_id) {
      if (!acc[c.parent_id]) acc[c.parent_id] = [];
      acc[c.parent_id].push(c);
    }
    return acc;
  }, {});

  return (
    <section className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-6">
      <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold">
        <MessageCircle className="h-5 w-5 text-[var(--zaploto-green)]" />
        Dúvidas e comentários
        {comments.length > 0 && (
          <span className="text-sm font-normal text-[var(--muted-foreground)]">({comments.length})</span>
        )}
      </h3>

      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin text-[var(--zaploto-green)]" />
        </div>
      ) : (
        <>
          {userId ? (
            <form onSubmit={handleSubmit} className="mb-6">
                <textarea
                  value={newBody}
                  onChange={(e) => setNewBody(e.target.value)}
                  placeholder="Escreva sua dúvida ou comentário..."
                  rows={3}
                  className="mb-2 w-full resize-y rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-sm placeholder:text-[var(--muted-foreground)] focus:border-[var(--zaploto-green)] focus:outline-none"
                  disabled={posting}
                />
                {error && <p className="mb-2 text-sm text-red-500">{error}</p>}
                <button
                  type="submit"
                  disabled={posting || !newBody.trim()}
                  className="inline-flex items-center gap-2 rounded-lg bg-[var(--zaploto-green)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                >
                  {posting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  {posting ? 'Enviando…' : 'Enviar'}
                </button>
              </form>
          ) : (
            <div className="mb-6 rounded-xl bg-[var(--input-bg)] p-4 text-center text-sm text-[var(--muted-foreground)]">
              <Lock className="mx-auto mb-2 h-6 w-6" />
              <p>Faça login para enviar dúvidas e comentários.</p>
              <Link href="/login" className="mt-1 inline-block text-[var(--zaploto-green)] hover:underline">Entrar</Link>
            </div>
          )}

          <ul className="space-y-4">
            {topLevel.length === 0 ? (
              <li className="py-4 text-center text-sm text-[var(--muted-foreground)]">
                Nenhum comentário ainda. {userId ? 'Seja o primeiro a tirar uma dúvida!' : 'Faça login para comentar.'}
              </li>
            ) : (
              topLevel.map((c) => (
                <li key={c.id} className="rounded-xl border border-[var(--card-border)] bg-[var(--input-bg)]/50 p-3">
                  <p className="text-sm text-[var(--foreground)]">{c.body}</p>
                  <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                    {userId && c.user_id === userId ? 'Você' : 'Usuário'} · {formatDate(c.created_at)}
                  </p>
                  {byParent[c.id]?.length > 0 && (
                    <ul className="mt-2 ml-4 space-y-2 border-l-2 border-[var(--zaploto-green)]/30 pl-3">
                      {byParent[c.id].map((r) => (
                        <li key={r.id}>
                          <p className="text-sm text-[var(--foreground)]">{r.body}</p>
                          <p className="text-xs text-[var(--muted-foreground)]">
                            {userId && r.user_id === userId ? 'Você' : 'Usuário'} · {formatDate(r.created_at)}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))
            )}
          </ul>
        </>
      )}
    </section>
  );
}
