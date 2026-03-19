'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { BookOpen, Play, Loader2, ChevronRight } from 'lucide-react';

// thumbnail_url já vem resolvida pelo servidor
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

const BOKEH = [
  { s: 5, x: '6%',  y: '30%', o: 0.5 },
  { s: 3, x: '18%', y: '70%', o: 0.35 },
  { s: 7, x: '30%', y: '20%', o: 0.25 },
  { s: 4, x: '45%', y: '80%', o: 0.4 },
  { s: 5, x: '58%', y: '40%', o: 0.3 },
  { s: 3, x: '68%', y: '75%', o: 0.5 },
  { s: 6, x: '78%', y: '15%', o: 0.3 },
  { s: 4, x: '87%', y: '60%', o: 0.4 },
  { s: 3, x: '94%', y: '35%', o: 0.5 },
  { s: 5, x: '38%', y: '55%', o: 0.25 },
];

export default function AcademyTrilhasPage() {
  const [modules, setModules] = useState<Module[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/academy/modules')
      .then((r) => r.ok ? r.json() : [])
      .then(setModules)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="mx-auto max-w-screen-xl px-4 py-10 sm:px-6 lg:px-10">
      {/* Hero banner — identidade visual Academy */}
      <section className="mb-10">
        <div className="relative overflow-hidden rounded-2xl bg-[#060f07] px-8 py-10 text-white">
          {/* Texture animada */}
          <div className="absolute inset-0 overflow-hidden">
            <div className="academy-orb-pulse absolute -left-8 top-0 h-40 w-40 rounded-full bg-[#1a5c1a]/40 blur-3xl" style={{ animationDelay: '0s' }} />
            <div className="academy-orb-pulse absolute bottom-0 right-10 h-48 w-48 rounded-full bg-[#0d3d0d]/60 blur-3xl" style={{ animationDelay: '5s' }} />
            {BOKEH.map((dot, i) => (
              <div
                key={i}
                className="academy-bokeh-dot absolute rounded-full bg-[#4ade80]"
                style={{
                  width: dot.s, height: dot.s, left: dot.x, top: dot.y,
                  filter: `blur(${dot.s > 5 ? 2 : 1}px)`,
                  animationDelay: `${i * 0.7}s`,
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
          <div className="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6">
            <div>
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[#4ade80]/30 bg-[#4ade80]/10 px-3 py-1 text-xs font-medium text-[#4ade80] uppercase tracking-widest">
                Zaploto Academy
              </div>
              <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Trilhas de aprendizado</h1>
              <p className="mt-2 text-sm text-white/50">
                {loading ? '…' : `${modules.length} módulo${modules.length !== 1 ? 's' : ''} disponíve${modules.length !== 1 ? 'is' : 'l'}`}
              </p>
            </div>
            <Link
              href="/academy"
              className="shrink-0 inline-flex items-center gap-2 self-start rounded-xl border border-[#4ade80]/40 bg-[#4ade80]/10 px-4 py-2.5 text-sm font-semibold text-[#4ade80] backdrop-blur-sm hover:bg-[#4ade80]/20 transition"
            >
              ← Início
            </Link>
          </div>
        </div>
      </section>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-[var(--zaploto-green)]" />
        </div>
      ) : modules.length === 0 ? (
        <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-12 text-center text-[var(--muted-foreground)]">
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
                    <img src={thumb} alt={mod.title} className="h-full w-full object-cover transition duration-500 group-hover:scale-105 group-hover:brightness-75" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-zinc-800 to-zinc-900">
                      <BookOpen className="h-14 w-14 text-zinc-600" />
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

                {/* Card body */}
                <div className="p-5">
                  <h3 className="font-semibold leading-snug text-white/90 transition group-hover:text-[#4ade80]">
                    {mod.title}
                  </h3>
                  {mod.description && (
                    <p className="mt-1.5 line-clamp-2 text-sm text-[var(--muted-foreground)]">{mod.description}</p>
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
                    <Play className="h-3.5 w-3.5" fill="currentColor" /> Ver aulas <ChevronRight className="h-3.5 w-3.5 ml-auto" />
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
