'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useRequireAuth } from '@/utils/useRequireAuth';
import { Check, Play, Clock, Loader2, ChevronRight, ArrowLeft, CheckCircle2 } from 'lucide-react';

// thumbnail_url já vem como signed URL resolvida pelo servidor
function getLessonThumbSrc(url: string | null): string | null {
  return url || null;
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
  const [moduleNotFound, setModuleNotFound] = useState(false);

  useEffect(() => {
    if (!moduleSlug) return;
    setModuleNotFound(false);
    (async () => {
      try {
        const [lessRes, progRes] = await Promise.all([
          fetch(`/api/academy/lessons?moduleSlug=${encodeURIComponent(moduleSlug)}`),
          userId ? fetch('/api/academy/progress', { headers: { 'x-user-id': userId } }).then((r) => r.ok ? r.json() : []) : Promise.resolve([]),
        ]);
        if (lessRes.ok) {
          const data = await lessRes.json();
          setLessons(Array.isArray(data.lessons) ? data.lessons : []);
          if (data.module_title) setModuleTitle(data.module_title);
          setModuleNotFound(false);
        } else if (lessRes.status === 404) {
          setLessons([]);
          setModuleNotFound(true);
        }
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

  const completedCount = lessons.filter((l) => getStatus(l.id) === 'completed').length;
  const progressPct = lessons.length > 0 ? Math.round((completedCount / lessons.length) * 100) : 0;

  return (
    <div className="mx-auto max-w-screen-xl px-3 py-6 sm:px-6 sm:py-10 lg:px-10">
      {/* Back button */}
      <Link
        href="/academy/trilhas"
        className="mb-6 inline-flex items-center gap-2 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 text-sm font-medium text-[var(--muted-foreground)] shadow-sm transition hover:border-[#4ade80]/50 hover:text-[#4ade80]"
      >
        <ArrowLeft className="h-4 w-4" />
        Voltar às trilhas
      </Link>

      {/* Header com identidade visual Academy */}
      <div className="mb-8 overflow-hidden rounded-2xl">
        <div className="relative bg-[#060f07] px-6 py-8 text-white">
          {/* Texture bg */}
          <div className="absolute inset-0 overflow-hidden">
            <div className="academy-orb-pulse absolute -right-8 -top-8 h-40 w-40 rounded-full bg-[#1a5c1a]/40 blur-3xl" style={{ animationDelay: '0s' }} />
            <div className="academy-orb-pulse absolute bottom-0 left-1/3 h-32 w-48 rounded-full bg-[#0d3d0d]/60 blur-3xl" style={{ animationDelay: '4s' }} />
            {[
              { s: 4, x: '5%',  y: '25%', o: 0.5, d: 0   },
              { s: 6, x: '20%', y: '70%', o: 0.3, d: 1.1  },
              { s: 3, x: '38%', y: '20%', o: 0.5, d: 2.2  },
              { s: 5, x: '55%', y: '60%', o: 0.3, d: 0.4  },
              { s: 4, x: '70%', y: '30%', o: 0.4, d: 1.6  },
              { s: 7, x: '82%', y: '75%', o: 0.2, d: 2.8  },
              { s: 3, x: '90%', y: '15%', o: 0.5, d: 0.9  },
              { s: 5, x: '48%', y: '85%', o: 0.3, d: 3.3  },
            ].map((dot, i) => (
              <div key={i}
                className="academy-bokeh-dot absolute rounded-full bg-[#4ade80]"
                style={{
                  width: dot.s, height: dot.s, left: dot.x, top: dot.y,
                  filter: `blur(${dot.s > 5 ? 2 : 1}px)`,
                  animationDelay: `${dot.d}s`,
                  ['--dot-o' as string]: dot.o,
                  opacity: dot.o,
                }}
              />
            ))}
            <div className="academy-grid-drift absolute inset-0 opacity-[0.04]"
              style={{ backgroundImage: 'linear-gradient(#4ade80 1px, transparent 1px), linear-gradient(90deg, #4ade80 1px, transparent 1px)', backgroundSize: '40px 40px' }} />
            <div className="academy-scanline absolute inset-x-0 h-px bg-gradient-to-r from-transparent via-[#4ade80]/50 to-transparent" style={{ top: 0 }} />
          </div>

          {/* Content */}
          <div className="relative">
            <div className="mb-1 inline-flex items-center gap-1.5 rounded-full border border-[#4ade80]/30 bg-[#4ade80]/10 px-2.5 py-0.5 text-xs font-medium text-[#4ade80]">
              Zaploto Academy
            </div>
            <h1 className="mt-2 text-2xl font-bold tracking-tight">{moduleTitle || 'Módulo'}</h1>
            <p className="mt-1 text-sm text-white/50">
              {lessons.length > 0 ? `${lessons.length} aula${lessons.length > 1 ? 's' : ''} neste módulo` : 'Aulas deste módulo'}
            </p>

            {/* Progress bar */}
            {userId && lessons.length > 0 && (
              <div className="mt-5">
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="font-medium text-white/70">Seu progresso</span>
                  <span className="font-bold text-[#4ade80]">{progressPct}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-2 rounded-full bg-[#4ade80] shadow-[0_0_8px_#4ade80aa] transition-all duration-500"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                <p className="mt-2 text-xs text-white/40">
                  {completedCount} de {lessons.length} aula{lessons.length > 1 ? 's' : ''} concluída{completedCount > 1 ? 's' : ''}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-[var(--zaploto-green)]" />
        </div>
      ) : moduleNotFound ? (
        <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-12 text-center text-[var(--muted-foreground)]">
          <p className="font-medium">Módulo não encontrado ou não está publicado.</p>
          <p className="mt-2 text-sm">Para as aulas aparecerem aqui, publique o módulo em Admin → Academy → Módulos.</p>
        </div>
      ) : lessons.length === 0 ? (
        <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-12 text-center text-[var(--muted-foreground)]">
          Nenhuma aula publicada neste módulo.
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {lessons.map((lesson, index) => {
            const status = getStatus(lesson.id);
            const isCompleted = status === 'completed';
            const isInProgress = status === 'in_progress';
            const thumbSrc = getLessonThumbSrc(lesson.thumbnail_url);
            return (
              <li key={lesson.id}>
                <Link
                  href={`/academy/aula/${lesson.slug}`}
                  className="group relative block overflow-hidden rounded-2xl border border-[#1e3a1e] bg-[#0a140a]/80 shadow-sm backdrop-blur-sm transition-all duration-300 hover:-translate-y-1 hover:border-[#4ade80]/50 hover:shadow-[0_0_24px_#4ade8028,0_0_48px_#4ade8012]"
                >
                  {/* Neon border top glow line */}
                  <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#4ade80]/60 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

                  {/* Thumbnail */}
                  <div className="relative aspect-video w-full overflow-hidden bg-zinc-900">
                    {thumbSrc ? (
                      <img
                        src={thumbSrc}
                        alt={lesson.title}
                        className="h-full w-full object-cover transition duration-500 group-hover:scale-105 group-hover:brightness-75"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-zinc-800 to-zinc-900">
                        {isCompleted ? (
                          <CheckCircle2 className="h-14 w-14 text-[#4ade80] drop-shadow-[0_0_12px_#4ade80]" />
                        ) : (
                          <Play className="h-14 w-14 text-zinc-600" />
                        )}
                      </div>
                    )}

                    {/* Play overlay com neon */}
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#4ade80] shadow-[0_0_20px_#4ade80,0_0_40px_#4ade8066] transition-transform duration-300 group-hover:scale-110">
                        <Play className="h-6 w-6 text-[#060f07]" fill="currentColor" />
                      </div>
                    </div>

                    {/* Scan line neon no hover */}
                    <div className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-[#4ade80]/5 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

                    {/* Completed badge */}
                    {isCompleted && (
                      <div className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-[#4ade80] px-2.5 py-1 text-xs font-semibold text-[#060f07] shadow-[0_0_10px_#4ade80]">
                        <Check className="h-3 w-3" /> Concluída
                      </div>
                    )}

                    {/* Lesson number com neon no hover */}
                    <div className="absolute left-2 top-2 flex h-7 w-7 items-center justify-center rounded-full border border-zinc-700 bg-black/70 text-xs font-bold text-white backdrop-blur-sm transition-all duration-300 group-hover:border-[#4ade80]/60 group-hover:text-[#4ade80] group-hover:shadow-[0_0_8px_#4ade8060]">
                      {index + 1}
                    </div>
                  </div>

                  {/* Info */}
                  <div className="flex items-center gap-3 bg-[#0a140a]/60 p-4">
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold leading-snug text-white/90 transition group-hover:text-[#4ade80]">
                        {lesson.title}
                      </h3>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-[var(--muted-foreground)]">
                        {lesson.estimated_minutes != null && (
                          <span className="flex items-center gap-1">
                            <Clock className="h-3.5 w-3.5" /> {lesson.estimated_minutes} min
                          </span>
                        )}
                        {isInProgress && (
                          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-400">
                            Em andamento
                          </span>
                        )}
                      </div>
                    </div>
                    <ChevronRight className="h-5 w-5 shrink-0 text-[var(--muted-foreground)] transition group-hover:text-[var(--zaploto-green)]" />
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
