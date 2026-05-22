'use client';

import React, { useEffect, useState } from 'react';
import Link from '@/components/WhitelabelLink';
import { mergeAuthInit } from '@/lib/utils/authenticated-fetch';
import { useParams } from 'next/navigation';
import { useRequireAuth } from '@/utils/useRequireAuth';
import {
  Check, Download, ExternalLink, Lock, Loader2,
  FileText, Image as ImageIcon, FileSpreadsheet, File as FileIcon,
  ArrowLeft, CheckCircle2, ChevronRight, ChevronDown, Clock, PlayCircle,
} from 'lucide-react';
import VturbPlayer from '@/components/academy/VturbPlayer';
import LessonComments from '@/components/academy/LessonComments';

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

type LessonListItem = { id: string; title: string; slug: string; estimated_minutes: number | null };
type ProgressItem = { lesson_id: string; status: string };

export default function AcademyLessonPage() {
  const params = useParams();
  const lessonSlug = params.lessonSlug as string;
  const { userId } = useRequireAuth();
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [lessonsInModule, setLessonsInModule] = useState<LessonListItem[]>([]);
  const [progress, setProgress] = useState<ProgressItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [markingComplete, setMarkingComplete] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [loadError, setLoadError] = useState<'forbidden' | 'notfound' | null>(null);

  useEffect(() => {
    if (!lessonSlug) return;
    setLoading(true);
    setLoadError(null);
    setLesson(null);
    setLessonsInModule([]);
    (async () => {
      try {
        const authInit = mergeAuthInit(userId);
        const [lessonRes, progRes] = await Promise.all([
          fetch(`/api/academy/lessons/${lessonSlug}`, authInit),
          userId
            ? fetch('/api/academy/progress', authInit).then((r) => (r.ok ? r.json() : []))
            : Promise.resolve([]),
        ]);
        setProgress(progRes);
        if (lessonRes.status === 403) {
          setLoadError('forbidden');
          return;
        }
        if (!lessonRes.ok) {
          setLoadError('notfound');
          return;
        }
        const data = await lessonRes.json();
        setLesson(data);
        setCompleted(data.id && progRes.some((p: ProgressItem) => p.lesson_id === data.id && p.status === 'completed'));
        if (data.module?.slug) {
          const listRes = await fetch(
            `/api/academy/lessons?moduleSlug=${encodeURIComponent(data.module.slug)}`,
            authInit
          );
          if (listRes.ok) {
            const listJson = await listRes.json();
            const lessonsRows = Array.isArray(listJson?.lessons) ? listJson.lessons : [];
            const mapped: LessonListItem[] = lessonsRows.map((l: { id: string; title?: string; slug?: string; estimated_minutes?: number | null }) => ({
              id: String(l.id),
              title: String(l.title ?? ''),
              slug: String(l.slug ?? ''),
              estimated_minutes: l.estimated_minutes ?? null,
            }));
            setLessonsInModule(mapped);
          }
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [lessonSlug, userId]);

  const markComplete = async () => {
    if (!userId || !lesson?.id) return;
    setMarkingComplete(true);
    try {
      const res = await fetch(
        '/api/academy/progress',
        mergeAuthInit(userId, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lessonId: lesson.id, status: 'completed' }),
        })
      );
      if (res.ok) {
        setCompleted(true);
        setProgress((prev) => [...prev.filter((p) => p.lesson_id !== lesson.id), { lesson_id: lesson.id, status: 'completed' }]);
      }
    } finally {
      setMarkingComplete(false);
    }
  };

  const getSignedUrl = async (path: string) => {
    const res = await fetch(
      `/api/academy/signed-url?path=${encodeURIComponent(path)}`,
      mergeAuthInit(userId)
    );
    const data = await res.json();
    if (data.url) window.open(data.url, '_blank');
  };

  const isLessonCompleted = (id: string) => progress.some((p) => p.lesson_id === id && p.status === 'completed');

  const renderPlayer = () => {
    if (!lesson) return null;
    const isLocked = !userId;

    if (lesson.content_type === 'vturb' && lesson.vturb_project_id && lesson.vturb_player_id) {
      if (isLocked) return <LockedPlayer />;
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
      if (isLocked) return <LockedPlayer />;
      const safeSrc = sanitizeIframeSrc(lesson.iframe_html);
      if (safeSrc) {
        return (
          <div className="aspect-video w-full overflow-hidden rounded-2xl bg-black shadow-lg">
            <iframe title="Aula" src={safeSrc} className="h-full w-full border-0" allowFullScreen />
          </div>
        );
      }
      return (
        <div className="flex aspect-video w-full items-center justify-center rounded-2xl bg-[var(--card-bg)] text-sm text-[var(--muted-foreground)]">
          Conteúdo iframe inválido.
        </div>
      );
    }
    if (lesson.content_type === 'text') {
      return (
        <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-5 sm:p-6">
          {lesson.description
            ? <p className="whitespace-pre-wrap leading-relaxed text-[var(--foreground)]">{lesson.description}</p>
            : <p className="text-[var(--muted-foreground)]">Conteúdo em texto.</p>}
        </div>
      );
    }
    return null;
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--zaploto-green)]" />
      </div>
    );
  }

  if (loadError === 'forbidden') {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <Lock className="mx-auto mb-4 h-12 w-12 text-[var(--muted-foreground)]" />
        <h1 className="text-xl font-bold text-[var(--foreground)]">Aula não disponível para o seu perfil</h1>
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">
          Este conteúdo é exclusivo para determinados cargos. Se acredita que deveria ter acesso, fale com o administrador.
        </p>
        <Link
          href="/academy/trilhas"
          className="mt-6 inline-flex rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] px-5 py-2.5 text-sm font-medium text-[var(--zaploto-green)] hover:border-[var(--zaploto-green)]/50"
        >
          Ver trilhas disponíveis
        </Link>
      </div>
    );
  }

  if (loadError === 'notfound' || !lesson) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <h1 className="text-xl font-bold">Aula não encontrada</h1>
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">Verifique o link ou volte às trilhas.</p>
        <Link href="/academy/trilhas" className="mt-6 inline-block text-sm text-[var(--zaploto-green)] hover:underline">
          ← Trilhas
        </Link>
      </div>
    );
  }

  const safeLessonsInModule = Array.isArray(lessonsInModule) ? lessonsInModule : [];
  const currentIndex = safeLessonsInModule.findIndex((l) => l.slug === lesson.slug);
  const nextLesson = safeLessonsInModule[currentIndex + 1] ?? null;
  const prevLesson = safeLessonsInModule[currentIndex - 1] ?? null;
  const completedCount = safeLessonsInModule.filter((l) => isLessonCompleted(l.id)).length;

  return (
    <div className="mx-auto max-w-7xl px-3 py-4 sm:px-6 sm:py-6 lg:px-8">
      {/* ── Back button ── */}
      <Link
        href={`/academy/modulos/${lesson.module?.slug ?? ''}`}
        className="mb-4 inline-flex items-center gap-2 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 text-sm font-medium text-[var(--muted-foreground)] shadow-sm transition hover:border-[var(--zaploto-green)]/50 hover:text-[var(--zaploto-green)]"
      >
        <ArrowLeft className="h-4 w-4" />
        <span className="hidden xs:inline">{lesson.module?.title ?? 'Voltar ao módulo'}</span>
        <span className="xs:hidden">Voltar</span>
      </Link>

      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        {/* ── MAIN CONTENT ── */}
        <div className="min-w-0">
          {/* Title + duration */}
          <div className="mb-4">
            <h1 className="text-xl font-bold leading-snug tracking-tight sm:text-2xl">{lesson.title}</h1>
            {lesson.estimated_minutes != null && (
              <p className="mt-1 flex items-center gap-1.5 text-sm text-[var(--muted-foreground)]">
                <Clock className="h-4 w-4" /> {lesson.estimated_minutes} min de duração
              </p>
            )}
          </div>

          {/* Player — full width, no extra px on mobile */}
          <div className="-mx-3 mb-5 sm:mx-0">{renderPlayer()}</div>

          {/* ── Mobile: collapsible lesson list ── */}
          {safeLessonsInModule.length > 0 && (
            <div className="mb-5 overflow-hidden rounded-2xl border border-[#1a3d1a] lg:hidden">
              <button
                type="button"
                onClick={() => setSidebarOpen((v) => !v)}
                className="relative flex w-full items-center gap-3 overflow-hidden bg-[#060f07] px-4 py-3.5 text-left"
              >
                <div className="pointer-events-none absolute inset-0 opacity-[0.04]"
                  style={{ backgroundImage: 'linear-gradient(var(--zaploto-green) 1px, transparent 1px), linear-gradient(90deg, var(--zaploto-green) 1px, transparent 1px)', backgroundSize: '30px 30px' }} />
                <div className="relative flex-1">
                  <p className="text-xs font-medium uppercase tracking-widest text-[var(--zaploto-green)]/70">Zaploto Academy</p>
                  <p className="text-sm font-bold text-white">Aulas do módulo</p>
                  {userId && lessonsInModule.length > 0 && (
                    <p className="mt-0.5 text-xs text-white/40">{completedCount}/{lessonsInModule.length} concluídas</p>
                  )}
                </div>
                <ChevronDown className={`relative h-5 w-5 shrink-0 text-[var(--zaploto-green)] transition-transform ${sidebarOpen ? 'rotate-180' : ''}`} />
              </button>

              {sidebarOpen && (
                <ul className="divide-y divide-[var(--card-border)] bg-[var(--card-bg)]">
                  {lessonsInModule.map((l, index) => {
                    const isCurrent = l.slug === lesson.slug;
                    const isDone = isLessonCompleted(l.id);
                    return (
                      <li key={l.id}>
                        <Link
                          href={`/academy/aula/${l.slug}`}
                          onClick={() => setSidebarOpen(false)}
                          className={`flex items-center gap-3 px-4 py-3 text-sm transition hover:bg-[var(--input-bg)] ${isCurrent ? 'bg-[var(--zaploto-green)]/5 border-l-2 border-[var(--zaploto-green)]' : 'border-l-2 border-transparent'}`}
                        >
                          <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${isDone ? 'bg-[var(--zaploto-green)] text-[#060f07]' : isCurrent ? 'bg-[var(--zaploto-green)] text-[#060f07]' : 'bg-[var(--input-bg)] text-[var(--muted-foreground)]'}`}>
                            {isDone ? <Check className="h-3.5 w-3.5" /> : isCurrent ? <PlayCircle className="h-3.5 w-3.5" /> : index + 1}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className={`truncate font-medium ${isCurrent ? 'text-[var(--zaploto-green)]' : 'text-[var(--foreground)]'}`}>{l.title}</p>
                            {l.estimated_minutes != null && (
                              <p className="flex items-center gap-1 text-xs text-[var(--muted-foreground)]">
                                <Clock className="h-3 w-3" /> {l.estimated_minutes} min
                              </p>
                            )}
                          </div>
                          {isCurrent && <span className="shrink-0 rounded-full bg-[var(--zaploto-green)]/20 px-2 py-0.5 text-xs text-[var(--zaploto-green)]">Atual</span>}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}

          {/* Prev / Next navigation */}
          {(prevLesson || nextLesson) && (
            <div className="mb-5 flex gap-2">
              {prevLesson && (
                <Link href={`/academy/aula/${prevLesson.slug}`}
                  className="flex flex-1 items-center gap-2 rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-3 text-sm transition hover:border-[var(--zaploto-green)]/50">
                  <ArrowLeft className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
                  <span className="min-w-0">
                    <span className="block text-xs text-[var(--muted-foreground)]">Anterior</span>
                    <span className="block truncate font-medium">{prevLesson.title}</span>
                  </span>
                </Link>
              )}
              {nextLesson && (
                <Link href={`/academy/aula/${nextLesson.slug}`}
                  className="flex flex-1 items-center justify-end gap-2 rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-3 text-sm transition hover:border-[var(--zaploto-green)]/50">
                  <span className="min-w-0 text-right">
                    <span className="block text-xs text-[var(--muted-foreground)]">Próxima</span>
                    <span className="block truncate font-medium">{nextLesson.title}</span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
                </Link>
              )}
            </div>
          )}

          {/* Description */}
          {lesson.description && lesson.content_type !== 'text' && (
            <div className="mb-5 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4 sm:p-5">
              <h3 className="mb-2 font-semibold">Sobre esta aula</h3>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--muted-foreground)]">{lesson.description}</p>
            </div>
          )}

          {/* Actions — full width on mobile */}
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            {userId && (
              <button
                type="button"
                onClick={markComplete}
                disabled={completed || markingComplete}
                className={`flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold transition sm:w-auto ${
                  completed ? 'bg-[var(--zaploto-green)]/10 text-[var(--zaploto-green)] border border-[var(--zaploto-green)]/40' : 'bg-[var(--zaploto-green)] text-[#060f07] hover:opacity-90'
                } disabled:opacity-50`}
              >
                {completed ? <CheckCircle2 className="h-4 w-4" /> : markingComplete ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {completed ? 'Aula concluída' : markingComplete ? 'Salvando…' : 'Marcar como concluída'}
              </button>
            )}
            {lesson.cta_label && lesson.cta_url && (
              lesson.cta_type === 'external' ? (
                <a href={lesson.cta_url} target={lesson.cta_target} rel="noopener noreferrer"
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] px-5 py-3 text-sm font-semibold hover:bg-[var(--input-bg)] transition sm:w-auto">
                  {lesson.cta_label} <ExternalLink className="h-4 w-4" />
                </a>
              ) : (
                <Link href={lesson.cta_url}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] px-5 py-3 text-sm font-semibold hover:bg-[var(--input-bg)] transition sm:w-auto">
                  {lesson.cta_label}
                </Link>
              )
            )}
          </div>

          {/* Attachments */}
          {lesson.attachments && lesson.attachments.length > 0 && (
            <div className="mb-5 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4 sm:p-5">
              <h3 className="mb-3 font-semibold">Materiais da aula</h3>
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                {userId ? (
                  lesson.attachments.map((att) => {
                    const asset = att.academy_assets;
                    if (!asset) return null;
                    return (
                      <button key={att.id} type="button" onClick={() => getSignedUrl(asset.file_path)}
                        className="flex w-full items-center gap-2 rounded-xl border border-[var(--card-border)] bg-[var(--input-bg)] px-4 py-3 text-sm font-medium transition hover:border-[var(--zaploto-green)]/50 hover:text-[var(--zaploto-green)] sm:w-auto">
                        {asset.type === 'pdf' || asset.type === 'doc' || asset.type === 'docx' ? <FileText className="h-4 w-4 shrink-0" />
                          : asset.type === 'table' ? <FileSpreadsheet className="h-4 w-4 shrink-0" />
                          : asset.type === 'image' ? <ImageIcon className="h-4 w-4 shrink-0" />
                          : <FileIcon className="h-4 w-4 shrink-0" />}
                        <span className="truncate">{att.label || asset.title}</span>
                        <Download className="ml-auto h-4 w-4 shrink-0 opacity-60" />
                      </button>
                    );
                  })
                ) : (
                  <Link href="/login"
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--card-border)] bg-[var(--input-bg)] px-4 py-3 text-sm font-medium sm:w-auto">
                    <Lock className="h-4 w-4" /> Entrar para baixar materiais
                  </Link>
                )}
              </div>
            </div>
          )}

          <LessonComments lessonSlug={lesson.slug} />
        </div>

        {/* ── SIDEBAR desktop only ── */}
        {lessonsInModule.length > 0 && (
          <aside className="hidden lg:block lg:sticky lg:top-20 lg:self-start">
            <div className="overflow-hidden rounded-2xl border border-[#1a3d1a]">
              {/* Header com textura */}
              <div className="relative overflow-hidden bg-[#060f07] px-4 py-4">
                <div className="absolute inset-0 overflow-hidden">
                  <div className="absolute -right-4 -top-4 h-20 w-20 rounded-full bg-[#1a5c1a]/50 blur-2xl" />
                  <div className="absolute bottom-0 left-0 h-16 w-24 rounded-full bg-[#0d3d0d]/60 blur-2xl" />
                  {[
                    { s: 3, x: '10%', y: '30%', o: 0.5 },
                    { s: 4, x: '60%', y: '70%', o: 0.3 },
                    { s: 3, x: '85%', y: '20%', o: 0.4 },
                  ].map((dot, i) => (
                    <div key={i} className="absolute rounded-full bg-[var(--zaploto-green)]"
                      style={{ width: dot.s, height: dot.s, left: dot.x, top: dot.y, opacity: dot.o, filter: 'blur(1px)' }} />
                  ))}
                  <div className="absolute inset-0 opacity-[0.04]"
                    style={{ backgroundImage: 'linear-gradient(var(--zaploto-green) 1px, transparent 1px), linear-gradient(90deg, var(--zaploto-green) 1px, transparent 1px)', backgroundSize: '30px 30px' }} />
                </div>
                <div className="relative">
                  <p className="text-xs font-medium uppercase tracking-widest text-[var(--zaploto-green)]/70">Zaploto Academy</p>
                  <h3 className="mt-0.5 text-sm font-bold text-white">Aulas do módulo</h3>
                  {lesson.module?.title && <p className="mt-0.5 truncate text-xs text-white/40">{lesson.module.title}</p>}
                  {userId && lessonsInModule.length > 0 && (
                    <p className="mt-1 text-xs text-white/30">{completedCount}/{lessonsInModule.length} concluídas</p>
                  )}
                </div>
              </div>
              {/* List */}
              <ul className="max-h-[60vh] divide-y divide-[var(--card-border)] overflow-y-auto bg-[var(--card-bg)]">
                {lessonsInModule.map((l, index) => {
                  const isCurrent = l.slug === lesson.slug;
                  const isDone = isLessonCompleted(l.id);
                  return (
                    <li key={l.id}>
                      <Link href={`/academy/aula/${l.slug}`}
                        className={`flex items-start gap-3 px-4 py-3 text-sm transition hover:bg-[var(--input-bg)] ${isCurrent ? 'bg-[var(--zaploto-green)]/5 border-l-2 border-[var(--zaploto-green)]' : 'border-l-2 border-transparent'}`}>
                        <div className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${isDone || isCurrent ? 'bg-[var(--zaploto-green)] text-[#060f07]' : 'bg-[var(--input-bg)] text-[var(--muted-foreground)]'}`}>
                          {isDone ? <Check className="h-3 w-3" /> : isCurrent ? <PlayCircle className="h-3 w-3" /> : index + 1}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className={`font-medium leading-snug ${isCurrent ? 'text-[var(--zaploto-green)]' : 'text-[var(--foreground)]'}`}>{l.title}</p>
                          {l.estimated_minutes != null && (
                            <p className="mt-0.5 flex items-center gap-1 text-xs text-[var(--muted-foreground)]">
                              <Clock className="h-3 w-3" /> {l.estimated_minutes} min
                            </p>
                          )}
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

function LockedPlayer() {
  return (
    <div className="flex aspect-video w-full flex-col items-center justify-center rounded-2xl bg-black/90 text-white">
      <Lock className="mb-3 h-10 w-10 opacity-50" />
      <p className="mb-5 text-center text-sm font-medium">Faça login para assistir</p>
      <Link href="/login" className="rounded-xl border border-[var(--zaploto-green)]/40 bg-[var(--zaploto-green)]/10 px-5 py-2.5 text-sm font-semibold text-[var(--zaploto-green)] hover:bg-[var(--zaploto-green)]/20 transition">
        Entrar
      </Link>
    </div>
  );
}
