'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRequireAuth } from '@/utils/useRequireAuth';
import { BookOpen, Play, ChevronRight, Loader2, GraduationCap, TrendingUp } from 'lucide-react';

// thumbnail_url já vem como signed URL resolvida pelo servidor
function getThumbnailSrc(url: string | null): string | null {
  return url || null;
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

  return (
    <div className="mx-auto max-w-screen-xl px-4 py-10 sm:px-6 lg:px-10">
      {/* Hero */}
      <section className="mb-12">
        <div className="relative overflow-hidden rounded-3xl bg-[#060f07] px-8 py-12 text-white shadow-xl">
          {/* Bokeh particles animadas */}
          <div className="absolute inset-0 overflow-hidden">
            {/* Orbs pulsantes */}
            <div className="academy-orb-pulse absolute -left-10 top-0 h-48 w-48 rounded-full bg-[#1a5c1a]/40 blur-3xl" style={{ animationDelay: '0s' }} />
            <div className="academy-orb-pulse absolute bottom-0 right-16 h-56 w-56 rounded-full bg-[#0d3d0d]/60 blur-3xl" style={{ animationDelay: '5s' }} />
            <div className="academy-orb-pulse absolute left-1/2 top-1/2 h-32 w-32 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#22c55e]/10 blur-2xl" style={{ animationDelay: '2.5s' }} />

            {/* Bokeh dots flutuantes */}
            {[
              { s: 6, x: '8%',  y: '20%', o: 0.6,  d: 0    },
              { s: 4, x: '15%', y: '70%', o: 0.4,  d: 1.0  },
              { s: 8, x: '25%', y: '40%', o: 0.3,  d: 2.0  },
              { s: 3, x: '32%', y: '80%', o: 0.5,  d: 0.5  },
              { s: 5, x: '48%', y: '15%', o: 0.4,  d: 1.5  },
              { s: 7, x: '55%', y: '60%', o: 0.25, d: 2.5  },
              { s: 4, x: '62%', y: '30%', o: 0.5,  d: 0.8  },
              { s: 6, x: '70%', y: '75%', o: 0.35, d: 1.8  },
              { s: 3, x: '78%', y: '20%', o: 0.6,  d: 3.0  },
              { s: 9, x: '82%', y: '50%', o: 0.2,  d: 0.3  },
              { s: 4, x: '88%', y: '85%', o: 0.45, d: 2.2  },
              { s: 5, x: '92%', y: '35%', o: 0.3,  d: 1.2  },
              { s: 3, x: '20%', y: '10%', o: 0.5,  d: 3.5  },
              { s: 6, x: '40%', y: '90%', o: 0.35, d: 0.7  },
              { s: 4, x: '65%', y: '10%', o: 0.4,  d: 2.8  },
              { s: 8, x: '75%', y: '40%', o: 0.2,  d: 1.4  },
              { s: 3, x: '5%',  y: '55%', o: 0.55, d: 4.0  },
              { s: 5, x: '95%', y: '65%', o: 0.3,  d: 0.9  },
            ].map((dot, i) => (
              <div
                key={i}
                className="academy-bokeh-dot absolute rounded-full bg-[#4ade80]"
                style={{
                  width: dot.s,
                  height: dot.s,
                  left: dot.x,
                  top: dot.y,
                  filter: `blur(${dot.s > 6 ? 2 : 1}px)`,
                  animationDelay: `${dot.d}s`,
                  ['--dot-o' as string]: dot.o,
                  opacity: dot.o,
                }}
              />
            ))}

            {/* Grid drifting */}
            <div
              className="academy-grid-drift absolute inset-0 opacity-[0.04]"
              style={{
                backgroundImage: 'linear-gradient(#4ade80 1px, transparent 1px), linear-gradient(90deg, #4ade80 1px, transparent 1px)',
                backgroundSize: '40px 40px',
              }}
            />

            {/* Scanline */}
            <div className="academy-scanline absolute inset-x-0 h-px bg-gradient-to-r from-transparent via-[#4ade80]/50 to-transparent" style={{ top: 0 }} />
          </div>

          {/* Content */}
          <div className="relative">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[#4ade80]/30 bg-[#4ade80]/10 px-3 py-1 text-sm font-medium text-[#4ade80] backdrop-blur-sm">
              <GraduationCap className="h-4 w-4" />
              Zaploto Academy
            </div>
            <h1 className="mb-3 text-3xl font-bold tracking-tight sm:text-4xl">
              Trilhas de aprendizado
            </h1>
            <p className="mb-6 max-w-xl text-white/60">
              Aprenda no seu ritmo com módulos práticos e objetivos sobre o Zaploto.
            </p>
            <Link
              href="/academy/trilhas"
              className="inline-flex items-center gap-2 rounded-xl border border-[#4ade80]/40 bg-[#4ade80]/10 px-5 py-2.5 text-sm font-semibold text-[#4ade80] backdrop-blur-sm hover:bg-[#4ade80]/20 transition"
            >
              Ver todas as trilhas <ChevronRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* Progress banner */}
      {userId && (completedCount > 0 || inProgress) && (
        <section className="mb-10 flex items-center gap-4 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-5 shadow-sm">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[var(--zaploto-green-bg)]">
            <TrendingUp className="h-6 w-6 text-[var(--zaploto-green)]" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-[var(--foreground)]">Continue aprendendo</p>
            <p className="text-sm text-[var(--muted-foreground)]">
              {completedCount > 0 && `${completedCount} aula${completedCount > 1 ? 's' : ''} concluída${completedCount > 1 ? 's' : ''}.`}
              {inProgress && ' Uma aula em andamento.'}
            </p>
          </div>
          <Link
            href="/academy/trilhas"
            className="shrink-0 inline-flex items-center gap-2 rounded-lg bg-[var(--zaploto-green)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition"
          >
            Continuar <ChevronRight className="h-4 w-4" />
          </Link>
        </section>
      )}

      {/* Modules grid */}
      <section>
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xl font-bold tracking-tight">Módulos disponíveis</h2>
          <Link href="/academy/trilhas" className="text-sm text-[var(--zaploto-green)] hover:underline">
            Ver todos
          </Link>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-[var(--zaploto-green)]" />
          </div>
        ) : modules.length === 0 ? (
          <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-16 text-center text-[var(--muted-foreground)]">
            Nenhuma trilha publicada no momento.
          </div>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {modules.map((mod) => {
              const thumb = getThumbnailSrc(mod.thumbnail_url);
              return (
                <Link
                  key={mod.id}
                  href={`/academy/modulos/${mod.slug}`}
                  className="group relative overflow-hidden rounded-2xl border border-[#1e3a1e] bg-[#0a140a]/80 shadow-sm backdrop-blur-sm transition-all duration-300 hover:-translate-y-1 hover:border-[#4ade80]/50 hover:shadow-[0_0_24px_#4ade8028,0_0_48px_#4ade8012]"
                >
                  {/* Neon border top glow line */}
                  <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#4ade80]/60 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

                  {/* Thumbnail */}
                  <div className="relative aspect-video w-full overflow-hidden bg-zinc-900">
                    {thumb ? (
                      <img
                        src={thumb}
                        alt={mod.title}
                        className="h-full w-full object-cover transition duration-500 group-hover:scale-105 group-hover:brightness-75"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-zinc-800 to-zinc-900">
                        <BookOpen className="h-16 w-16 text-zinc-600" />
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
                  </div>

                  {/* Content */}
                  <div className="p-5">
                    <h3 className="font-semibold leading-snug text-white/90 transition group-hover:text-[#4ade80]">
                      {mod.title}
                    </h3>
                    {mod.description && (
                      <p className="mt-1.5 line-clamp-2 text-sm text-[var(--muted-foreground)]">
                        {mod.description}
                      </p>
                    )}
                    {mod.tags && mod.tags.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {mod.tags.slice(0, 3).map((tag) => (
                          <span key={tag} className="rounded-full border border-[#4ade80]/20 bg-[#4ade80]/10 px-2.5 py-0.5 text-xs font-medium text-[#4ade80]">
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="mt-4 flex items-center gap-1 text-sm font-medium text-[#4ade80]">
                      <Play className="h-3.5 w-3.5" fill="currentColor" /> Ver aulas <ChevronRight className="ml-auto h-3.5 w-3.5" />
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
