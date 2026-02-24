'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRequireAuth } from '@/utils/useRequireAuth';
import { BookOpen, Play, ChevronRight, Loader2 } from 'lucide-react';

function getThumbnailSrc(url: string | null): string | null {
  if (!url) return null;
  return url.startsWith('http') ? url : `/api/academy/thumbnail?path=${encodeURIComponent(url)}`;
}

type Module = {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  order_index: number;
  thumbnail_url: string | null;
  tags: string[] | null;
};

type ProgressItem = { lesson_id: string; status: string; completed_at: string | null };

export default function AcademyHomePage() {
  const { userId } = useRequireAuth();
  const [modules, setModules] = useState<Module[]>([]);
  const [progress, setProgress] = useState<ProgressItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [modRes, progRes] = await Promise.all([
          fetch('/api/academy/modules'),
          userId ? fetch('/api/academy/progress', { headers: { 'x-user-id': userId } }) : null,
        ]);
        if (modRes.ok) {
          const data = await modRes.json();
          setModules(data);
        }
        if (userId && progRes?.ok) {
          const prog = await progRes.json();
          setProgress(prog);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [userId]);

  const completedCount = progress.filter((p) => p.status === 'completed').length;
  const inProgress = progress.find((p) => p.status === 'in_progress');
  const totalLessons = modules.length; // aproximado; poderia somar aulas de todos os módulos

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      {userId && (completedCount > 0 || inProgress) && (
        <section className="mb-12 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-6">
          <h2 className="mb-2 text-xl font-semibold">Continuar de onde parou</h2>
          <p className="mb-4 text-sm text-[var(--muted-foreground)]">
            {completedCount > 0 && `${completedCount} aula(s) concluída(s).`}
            {inProgress && ' Você tem uma aula em andamento.'}
          </p>
          <Link
            href="/academy/trilhas"
            className="inline-flex items-center gap-2 rounded-lg bg-[var(--zaploto-green)] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            Ver trilhas <ChevronRight className="h-4 w-4" />
          </Link>
        </section>
      )}

      <section>
        <h1 className="mb-2 text-3xl font-bold tracking-tight">Trilhas de aprendizado</h1>
        <p className="mb-8 text-[var(--muted-foreground)]">
          Escolha um módulo e avance no seu ritmo.
        </p>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-[var(--zaploto-green)]" />
          </div>
        ) : modules.length === 0 ? (
          <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-12 text-center text-[var(--muted-foreground)]">
            Nenhuma trilha publicada no momento.
          </div>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {modules.map((mod) => (
              <Link
                key={mod.id}
                href={`/academy/modulos/${mod.slug}`}
                className="group relative overflow-hidden rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] transition hover:border-[var(--zaploto-green-border)] hover:shadow-lg"
              >
                <div className="aspect-video w-full bg-[var(--input-bg)]">
                  {getThumbnailSrc(mod.thumbnail_url) ? (
                    <img
                      src={getThumbnailSrc(mod.thumbnail_url)!}
                      alt={mod.title}
                      className="h-full w-full object-cover transition group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <BookOpen className="h-16 w-16 text-[var(--muted-foreground)]" />
                    </div>
                  )}
                </div>
                <div className="p-4">
                  <h3 className="font-semibold group-hover:text-[var(--zaploto-green)]">{mod.title}</h3>
                  {mod.description && (
                    <p className="mt-1 line-clamp-2 text-sm text-[var(--muted-foreground)]">
                      {mod.description}
                    </p>
                  )}
                  <span className="mt-2 inline-flex items-center gap-1 text-sm text-[var(--zaploto-green)]">
                    <Play className="h-4 w-4" /> Ver aulas
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
