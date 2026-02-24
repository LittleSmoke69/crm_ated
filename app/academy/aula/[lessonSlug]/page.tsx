'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useRequireAuth } from '@/utils/useRequireAuth';
import {
  Check,
  Download,
  ExternalLink,
  Lock,
  Loader2,
  FileText,
  Image as ImageIcon,
  FileSpreadsheet,
  File as FileIcon,
} from 'lucide-react';
import VturbPlayer from '@/components/academy/VturbPlayer';
import LessonComments from '@/components/academy/LessonComments';

/** Extrai e valida src de um HTML de iframe (apenas https). */
function sanitizeIframeSrc(html: string | null): string | null {
  if (!html || typeof html !== 'string') return null;
  const match = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
  const src = match?.[1]?.trim();
  if (!src || !src.startsWith('https://')) return null;
  return src;
}

type Lesson = {
  id: string;
  module_id: string;
  title: string;
  slug: string;
  description: string | null;
  content_type: 'vturb' | 'iframe' | 'text';
  estimated_minutes: number | null;
  vturb_player_id: string | null;
  vturb_project_id: string | null;
  vturb_aspect_ratio: number | null;
  vturb_use_sdk: boolean;
  iframe_html: string | null;
  cta_label: string | null;
  cta_type: 'internal' | 'external' | null;
  cta_url: string | null;
  cta_target: '_self' | '_blank';
  thumbnail_url: string | null;
  module: { id: string; title: string; slug: string } | null;
  attachments: Array<{
    id: string;
    order_index: number;
    label: string | null;
    academy_assets: { id: string; type: string; title: string; file_path: string; public_url: string | null } | null;
  }>;
};

type ProgressItem = { lesson_id: string; status: string };

export default function AcademyLessonPage() {
  const params = useParams();
  const lessonSlug = params.lessonSlug as string;
  const { userId } = useRequireAuth();
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [lessonsInModule, setLessonsInModule] = useState<{ id: string; title: string; slug: string }[]>([]);
  const [progress, setProgress] = useState<ProgressItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [markingComplete, setMarkingComplete] = useState(false);
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    if (!lessonSlug) return;
    (async () => {
      try {
        const [lessonRes, progRes] = await Promise.all([
          fetch(`/api/academy/lessons/${lessonSlug}`),
          userId ? fetch('/api/academy/progress', { headers: { 'x-user-id': userId } }).then((r) => r.ok ? r.json() : []) : Promise.resolve([]),
        ]);
        if (lessonRes.ok) {
          const data = await lessonRes.json();
          setLesson(data);
          setCompleted(data.id && progRes.some((p: ProgressItem) => p.lesson_id === data.id && p.status === 'completed'));
          if (data.module?.slug) {
            const listRes = await fetch(`/api/academy/lessons?moduleSlug=${encodeURIComponent(data.module.slug)}`);
            if (listRes.ok) {
              const list = await listRes.json();
              setLessonsInModule(list);
            }
          }
        }
        setProgress(progRes);
      } finally {
        setLoading(false);
      }
    })();
  }, [lessonSlug, userId]);

  const markComplete = async () => {
    if (!userId || !lesson?.id) return;
    setMarkingComplete(true);
    try {
      const res = await fetch('/api/academy/progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': userId },
        body: JSON.stringify({ lessonId: lesson.id, status: 'completed' }),
      });
      if (res.ok) {
        setCompleted(true);
        setProgress((prev) => {
          const rest = prev.filter((p) => p.lesson_id !== lesson.id);
          return [...rest, { lesson_id: lesson.id, status: 'completed' }];
        });
      }
    } finally {
      setMarkingComplete(false);
    }
  };

  const getSignedUrl = async (path: string) => {
    const res = await fetch(`/api/academy/signed-url?path=${encodeURIComponent(path)}`);
    const data = await res.json();
    if (data.url) window.open(data.url, '_blank');
  };

  const renderPlayer = () => {
    if (!lesson) return null;
    const isLocked = !userId;
    if (lesson.content_type === 'vturb' && lesson.vturb_project_id && lesson.vturb_player_id) {
      if (isLocked) {
        return (
          <div className="flex aspect-video w-full flex-col items-center justify-center rounded-xl bg-black/90 text-white">
            <Lock className="mb-2 h-12 w-12" />
            <p className="mb-4 text-center">Faça login para assistir</p>
            <Link href="/login" className="rounded-lg bg-[var(--zaploto-green)] px-4 py-2 font-medium text-white hover:opacity-90">
              Entrar
            </Link>
          </div>
        );
      }
      return (
        <VturbPlayer
          projectId={lesson.vturb_project_id}
          playerId={lesson.vturb_player_id}
          aspectRatio={lesson.vturb_aspect_ratio}
          useSdk={lesson.vturb_use_sdk}
        />
      );
    }
    if (lesson.content_type === 'iframe' && lesson.iframe_html) {
      if (isLocked) {
        return (
          <div className="flex aspect-video w-full flex-col items-center justify-center rounded-xl bg-black/90 text-white">
            <Lock className="mb-2 h-12 w-12" />
            <p className="mb-4 text-center">Faça login para assistir</p>
            <Link href="/login" className="rounded-lg bg-[var(--zaploto-green)] px-4 py-2 font-medium text-white hover:opacity-90">
              Entrar
            </Link>
          </div>
        );
      }
      const safeSrc = sanitizeIframeSrc(lesson.iframe_html);
      if (safeSrc) {
        return (
          <div className="aspect-video w-full overflow-hidden rounded-xl bg-black">
            <iframe title="Aula" src={safeSrc} className="h-full w-full border-0" allowFullScreen />
          </div>
        );
      }
      return (
        <div className="flex aspect-video w-full items-center justify-center rounded-xl bg-[var(--card-bg)] text-[var(--muted-foreground)]">
          Conteúdo iframe inválido.
        </div>
      );
    }
    if (lesson.content_type === 'text') {
      return (
        <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-6">
          {lesson.description ? <p className="whitespace-pre-wrap text-[var(--foreground)]">{lesson.description}</p> : <p className="text-[var(--muted-foreground)]">Conteúdo em texto.</p>}
        </div>
      );
    }
    return null;
  };

  if (loading || !lesson) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--zaploto-green)]" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="grid gap-8 lg:grid-cols-[1fr_280px]">
        <div>
          <Link href={`/academy/modulos/${lesson.module?.slug ?? ''}`} className="mb-4 inline-flex items-center gap-1 text-sm text-[var(--muted-foreground)] hover:text-[var(--zaploto-green)]">
            ← {lesson.module?.title ?? 'Módulo'}
          </Link>
          <h1 className="mb-2 text-2xl font-bold tracking-tight">{lesson.title}</h1>
          {lesson.estimated_minutes != null && (
            <p className="mb-4 text-sm text-[var(--muted-foreground)]">Duração estimada: {lesson.estimated_minutes} min</p>
          )}

          <div className="mb-6">{renderPlayer()}</div>

          {lesson.description && (
            <div className="mb-6 rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
              <h3 className="mb-2 font-semibold">Descrição</h3>
              <p className="whitespace-pre-wrap text-sm text-[var(--muted-foreground)]">{lesson.description}</p>
            </div>
          )}

          <div className="flex flex-wrap gap-3">
            {userId && (
              <button
                type="button"
                onClick={markComplete}
                disabled={completed || markingComplete}
                className="inline-flex items-center gap-2 rounded-lg bg-[var(--zaploto-green)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {completed ? <Check className="h-4 w-4" /> : null}
                {markingComplete ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {completed ? 'Concluída' : markingComplete ? 'Salvando…' : 'Marcar como concluída'}
              </button>
            )}
            {lesson.attachments && lesson.attachments.length > 0 && (
              <>
                {userId ? (
                  lesson.attachments.map((att) => {
                    const asset = att.academy_assets;
                    if (!asset) return null;
                    return (
                      <button
                        key={att.id}
                        type="button"
                        onClick={() => getSignedUrl(asset.file_path)}
                        className="inline-flex items-center gap-2 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-4 py-2 text-sm font-medium hover:bg-[var(--input-bg)]"
                      >
                        {asset.type === 'pdf' || asset.type === 'doc' || asset.type === 'docx' ? (
                          <FileText className="h-4 w-4" />
                        ) : asset.type === 'table' ? (
                          <FileSpreadsheet className="h-4 w-4" />
                        ) : asset.type === 'image' ? (
                          <ImageIcon className="h-4 w-4" />
                        ) : (
                          <FileIcon className="h-4 w-4" />
                        )}
                        {att.label || asset.title}
                        <Download className="h-4 w-4" />
                      </button>
                    );
                  })
                ) : (
                  <Link href="/login" className="inline-flex items-center gap-2 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-4 py-2 text-sm font-medium hover:bg-[var(--input-bg)]">
                    <Lock className="h-4 w-4" /> Entrar para baixar materiais
                  </Link>
                )}
              </>
            )}
            {lesson.cta_label && lesson.cta_url && (
              lesson.cta_type === 'external' ? (
                <a
                  href={lesson.cta_url}
                  target={lesson.cta_target}
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-lg bg-[var(--zaploto-green-bg)] px-4 py-2 text-sm font-medium text-[var(--zaploto-green)] hover:bg-[var(--zaploto-green-bg-hover)]"
                >
                  {lesson.cta_label}
                  <ExternalLink className="h-4 w-4" />
                </a>
              ) : (
                <Link
                  href={lesson.cta_url}
                  className="inline-flex items-center gap-2 rounded-lg bg-[var(--zaploto-green-bg)] px-4 py-2 text-sm font-medium text-[var(--zaploto-green)] hover:bg-[var(--zaploto-green-bg-hover)]"
                >
                  {lesson.cta_label}
                </Link>
              )
            )}
          </div>

          <div className="mt-8">
            <LessonComments lessonSlug={lesson.slug} />
          </div>
        </div>

        {lessonsInModule.length > 0 && (
          <aside className="lg:sticky lg:top-24 lg:self-start">
            <h3 className="mb-3 font-semibold">Aulas do módulo</h3>
            <ul className="space-y-1 rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-2">
              {lessonsInModule.map((l) => (
                <li key={l.id}>
                  <Link
                    href={`/academy/aula/${l.slug}`}
                    className={`block rounded-lg px-3 py-2 text-sm transition hover:bg-[var(--input-bg)] ${l.slug === lesson.slug ? 'bg-[var(--zaploto-green-bg)] font-medium text-[var(--zaploto-green)]' : ''}`}
                  >
                    {l.title}
                  </Link>
                </li>
              ))}
            </ul>
          </aside>
        )}
      </div>
    </div>
  );
}