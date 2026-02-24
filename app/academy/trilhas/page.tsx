'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { BookOpen, Play, Loader2 } from 'lucide-react';

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
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="mb-2 text-3xl font-bold tracking-tight">Trilhas</h1>
      <p className="mb-8 text-[var(--muted-foreground)]">
        Todos os módulos disponíveis na Academy.
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
    </div>
  );
}
