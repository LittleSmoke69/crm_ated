'use client';

import { useEffect, useState } from 'react';
import Layout from '@/components/Layout';
import { useRequireAuth } from '@/utils/useRequireAuth';
import Link from 'next/link';
import { BookOpen, FileVideo, FolderOpen, BarChart3, ExternalLink, Loader2, Plus, ChevronRight } from 'lucide-react';

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

  return (
    <Layout>
      <div className="p-6 max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-bold text-[var(--foreground)]">Academy</h1>
            <p className="mt-0.5 text-sm text-[var(--muted-foreground)]">Gerencie módulos, aulas e materiais de apoio</p>
          </div>
          <a
            href="/academy"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-4 py-2 text-sm font-medium hover:bg-[var(--input-bg)] transition"
          >
            <ExternalLink className="h-4 w-4" /> Ver área pública
          </a>
        </div>

        {/* Stats row */}
        <div className="mb-8 grid grid-cols-3 gap-4">
          {[
            { label: 'Módulos', value: stats?.modules ?? '—', color: 'text-blue-400' },
            { label: 'Aulas', value: stats?.lessons ?? '—', color: 'text-[var(--zaploto-green)]' },
            { label: 'Materiais', value: stats?.assets ?? '—', color: 'text-purple-400' },
          ].map(({ label, value, color }) => (
            <div key={label} className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4 text-center">
              <p className={`text-3xl font-bold ${color}`}>{value}</p>
              <p className="mt-1 text-xs text-[var(--muted-foreground)]">{label}</p>
            </div>
          ))}
        </div>

        {/* Main nav cards */}
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Módulos */}
          <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] overflow-hidden">
            <div className="flex items-center gap-3 border-b border-[var(--card-border)] p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
                <FolderOpen className="h-5 w-5 text-blue-400" />
              </div>
              <div className="flex-1">
                <p className="font-semibold">Módulos</p>
                <p className="text-xs text-[var(--muted-foreground)]">{stats?.modules ?? '—'} publicados</p>
              </div>
            </div>
            <div className="p-4 flex gap-2">
              <Link href="/admin/academy/modulos" className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-[var(--card-border)] py-2 text-sm font-medium hover:bg-[var(--input-bg)] transition">
                Gerenciar <ChevronRight className="h-4 w-4" />
              </Link>
              <Link href="/admin/academy/modulos/novo" className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[var(--zaploto-green)] py-2 text-sm font-medium text-white hover:opacity-90 transition">
                <Plus className="h-4 w-4" /> Novo módulo
              </Link>
            </div>
          </div>

          {/* Aulas */}
          <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] overflow-hidden">
            <div className="flex items-center gap-3 border-b border-[var(--card-border)] p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--zaploto-green-bg)]">
                <FileVideo className="h-5 w-5 text-[var(--zaploto-green)]" />
              </div>
              <div className="flex-1">
                <p className="font-semibold">Aulas</p>
                <p className="text-xs text-[var(--muted-foreground)]">{stats?.lessons ?? '—'} no total</p>
              </div>
            </div>
            <div className="p-4 flex gap-2">
              <Link href="/admin/academy/aulas" className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-[var(--card-border)] py-2 text-sm font-medium hover:bg-[var(--input-bg)] transition">
                Gerenciar <ChevronRight className="h-4 w-4" />
              </Link>
              <Link href="/admin/academy/aulas/novo" className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[var(--zaploto-green)] py-2 text-sm font-medium text-white hover:opacity-90 transition">
                <Plus className="h-4 w-4" /> Nova aula
              </Link>
            </div>
          </div>

          {/* Materiais */}
          <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] overflow-hidden">
            <div className="flex items-center gap-3 border-b border-[var(--card-border)] p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-500/10">
                <BookOpen className="h-5 w-5 text-purple-400" />
              </div>
              <div className="flex-1">
                <p className="font-semibold">Materiais</p>
                <p className="text-xs text-[var(--muted-foreground)]">{stats?.assets ?? '—'} arquivos</p>
              </div>
            </div>
            <div className="p-4">
              <Link href="/admin/academy/assets" className="flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--card-border)] py-2 text-sm font-medium hover:bg-[var(--input-bg)] transition">
                Gerenciar materiais <ChevronRight className="h-4 w-4" />
              </Link>
            </div>
          </div>

          {/* Analytics */}
          <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] overflow-hidden">
            <div className="flex items-center gap-3 border-b border-[var(--card-border)] p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10">
                <BarChart3 className="h-5 w-5 text-amber-400" />
              </div>
              <div className="flex-1">
                <p className="font-semibold">Analytics VTurb</p>
                <p className="text-xs text-[var(--muted-foreground)]">Métricas dos vídeos</p>
              </div>
            </div>
            <div className="p-4">
              <Link href="/admin/academy/analytics" className="flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--card-border)] py-2 text-sm font-medium hover:bg-[var(--input-bg)] transition">
                Ver analytics <ChevronRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
