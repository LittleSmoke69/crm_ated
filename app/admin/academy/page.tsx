'use client';

import { useEffect, useState } from 'react';
import Layout from '@/components/Layout';
import { useRequireAuth } from '@/utils/useRequireAuth';
import Link from 'next/link';
import { BookOpen, FileVideo, FolderOpen, BarChart3, ExternalLink, Loader2 } from 'lucide-react';

export default function AdminAcademyDashboardPage() {
  const { checking, userId } = useRequireAuth();
  const [stats, setStats] = useState<{ modules: number; lessons: number; assets: number } | null>(null);

  useEffect(() => {
    if (!userId) return;
    const h = { 'x-user-id': userId } as Record<string, string>;
    Promise.all([
      fetch('/api/admin/academy/modules', { headers: h }).then((r) => (r.ok ? r.json() : [])),
      fetch('/api/admin/academy/lessons', { headers: h }).then((r) => (r.ok ? r.json() : [])),
      fetch('/api/admin/academy/assets', { headers: h }).then((r) => (r.ok ? r.json() : [])),
    ]).then(([modules, lessons, assets]) => {
      setStats({
        modules: Array.isArray(modules) ? modules.length : 0,
        lessons: Array.isArray(lessons) ? lessons.length : 0,
        assets: Array.isArray(assets) ? assets.length : 0,
      });
    });
  }, [userId]);

  if (checking) {
    return (
      <Layout>
        <div className="flex items-center justify-center p-12">
          <Loader2 className="h-8 w-8 animate-spin text-[var(--zaploto-green)]" />
        </div>
      </Layout>
    );
  }

  const cards = [
    { href: '/admin/academy/modulos', icon: FolderOpen, label: 'Módulos', count: stats?.modules ?? '-' },
    { href: '/admin/academy/aulas', icon: FileVideo, label: 'Aulas', count: stats?.lessons ?? '-' },
    { href: '/admin/academy/assets', icon: BookOpen, label: 'Materiais (Assets)', count: stats?.assets ?? '-' },
    { href: '/admin/academy/analytics', icon: BarChart3, label: 'Analytics VTurb', count: '' },
  ];

  return (
    <Layout>
      <div className="p-6 max-w-5xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <h1 className="text-2xl font-bold text-[var(--foreground)]">Academy — Configuração</h1>
          <a
            href="/academy"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-4 py-2 text-sm font-medium hover:bg-[var(--input-bg)]"
          >
            <ExternalLink className="h-4 w-4" /> Ver área pública
          </a>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {cards.map(({ href, icon: Icon, label, count }) => (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-4 rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-5 transition hover:border-[var(--zaploto-green-border)]"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-[var(--zaploto-green-bg)]">
                <Icon className="h-6 w-6 text-[var(--zaploto-green)]" />
              </div>
              <div>
                <p className="font-medium text-[var(--foreground)]">{label}</p>
                {count !== '' && <p className="text-sm text-[var(--muted-foreground)]">{count} itens</p>}
              </div>
            </Link>
          ))}
        </div>
      </div>
    </Layout>
  );
}
