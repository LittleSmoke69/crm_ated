'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useRequireAuth } from '@/utils/useRequireAuth';
import { Check, Play, Clock, Loader2, ChevronRight } from 'lucide-react';

function getLessonThumbSrc(url: string | null): string | null {
  if (!url) return null;
  return url.startsWith('http') ? url : `/api/academy/thumbnail?path=${encodeURIComponent(url)}`;
}

function normalizeSlug(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

type Lesson = {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  order_index: number;
  estimated_minutes: number | null;
  content_type: string;
  thumbnail_url: string | null;
};

type ProgressItem = { lesson_id: string; status: string };

export default function AcademyModulePage() {
  const params = useParams();
  const moduleSlug = params.moduleSlug as string;
  const { userId } = useRequireAuth();
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [progress, setProgress] = useState<ProgressItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [moduleTitle, setModuleTitle] = useState('');
  /** 404 = módulo não encontrado ou não publicado */
  const [moduleNotFound, setModuleNotFound] = useState(false);

  useEffect(() => {
    if (!moduleSlug) return;
    const norm = normalizeSlug(moduleSlug);
    setModuleNotFound(false);
    (async () => {
      try {
        const [lessRes, modRes, progRes] = await Promise.all([
          fetch(`/api/academy/lessons?moduleSlug=${encodeURIComponent(moduleSlug)}`),
          fetch('/api/academy/modules').then((r) => r.json()).then((arr: { slug: string; title: string }[]) => arr.find((x) => x.slug === moduleSlug || normalizeSlug(x.slug) === norm)?.title ?? ''),
          userId ? fetch('/api/academy/progress', { headers: { 'x-user-id': userId } }).then((r) => r.ok ? r.json() : []) : Promise.resolve([]),
        ]);
        if (lessRes.ok) {
          const data = await lessRes.json();
          setLessons(Array.isArray(data) ? data : []);
          setModuleNotFound(false);
        } else if (lessRes.status === 404) {
          setLessons([]);
          setModuleNotFound(true);
        }
        setModuleTitle(modRes);
        setProgress(progRes);
      } finally {
        setLoading(false);
      }
    })();
  }, [moduleSlug, userId]);

  const getStatus = (lessonId: string) => {
    const p = progress.find((x) => x.lesson_id === lessonId);
    if (!p) return 'not_started';
    return p.status;
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <Link href="/academy/trilhas" className="mb-6 inline-flex items-center gap-1 text-sm text-[var(--muted-foreground)] hover:text-[var(--zaploto-green)]">
        ← Trilhas
      </Link>
      <h1 className="mb-2 text-3xl font-bold tracking-tight">{moduleTitle || 'Módulo'}</h1>
      <p className="mb-8 text-[var(--muted-foreground)]">Aulas deste módulo</p>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-[var(--zaploto-green)]" />
        </div>
      ) : moduleNotFound ? (
        <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-12 text-center text-[var(--muted-foreground)]">
          <p className="font-medium">Módulo não encontrado ou não está publicado.</p>
          <p className="mt-2 text-sm">Para as aulas aparecerem aqui, publique o módulo em Admin → Academy → Módulos (ícone de olho).</p>
        </div>
      ) : lessons.length === 0 ? (
        <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-12 text-center text-[var(--muted-foreground)]">
          Nenhuma aula publicada neste módulo.
        </div>
      ) : (
        <ul className="grid gap-6 sm:grid-cols-1 md:grid-cols-2">
          {lessons.map((lesson) => {
            const status = getStatus(lesson.id);
            const isCompleted = status === 'completed';
            const isInProgress = status === 'in_progress';
            const thumbSrc = getLessonThumbSrc(lesson.thumbnail_url);
            return (
              <li key={lesson.id}>
                <Link
                  href={`/academy/aula/${lesson.slug}`}
                  className="group block overflow-hidden rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] transition hover:border-[var(--zaploto-green-border)] hover:shadow-lg"
                >
                  <div className="aspect-video w-full overflow-hidden bg-[var(--input-bg)]">
                    {thumbSrc ? (
                      <img src={thumbSrc} alt="" className="h-full w-full object-cover transition group-hover:scale-105" />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center">
                        {isCompleted ? (
                          <Check className="h-14 w-14 text-[var(--zaploto-green)]" />
                        ) : (
                          <Play className="h-14 w-14 text-[var(--zaploto-green)]" />
                        )}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 p-4">
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold text-[var(--foreground)] group-hover:text-[var(--zaploto-green)]">{lesson.title}</h3>
                      <div className="mt-1 flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
                        {lesson.estimated_minutes != null && (
                          <span className="flex items-center gap-1">
                            <Clock className="h-3.5 w-3.5" /> {lesson.estimated_minutes} min
                          </span>
                        )}
                        {isCompleted && <span className="text-[var(--zaploto-green)]">Concluída</span>}
                        {isInProgress && <span>Em andamento</span>}
                      </div>
                    </div>
                    <ChevronRight className="h-5 w-5 shrink-0 text-[var(--muted-foreground)] group-hover:text-[var(--zaploto-green)]" />
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
