'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BookOpen, LogIn, LayoutDashboard } from 'lucide-react';
import { useRequireAuth } from '@/utils/useRequireAuth';

/**
 * Layout externo da Academy: clean, sem sidebar do app principal.
 * Estilo premium (Netflix/Hotmart).
 */
export default function AcademyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { checking, userId } = useRequireAuth();

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)] flex flex-col">
      <header className="sticky top-0 z-50 border-b border-[var(--card-border)] bg-[var(--card-bg)]/95 backdrop-blur supports-[backdrop-filter]:bg-[var(--card-bg)]/80">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link
            href="/academy"
            className="flex items-center gap-2 font-semibold text-lg text-[var(--foreground)] hover:opacity-90"
          >
            <BookOpen className="h-7 w-7 text-[var(--zaploto-green)]" />
            <span>Academy</span>
          </Link>
          <nav className="flex items-center gap-4">
            <Link
              href="/academy"
              className={`text-sm font-medium transition hover:text-[var(--zaploto-green)] ${pathname === '/academy' ? 'text-[var(--zaploto-green)]' : 'text-[var(--muted-foreground)]'}`}
            >
              Início
            </Link>
            <Link
              href="/academy/trilhas"
              className={`text-sm font-medium transition hover:text-[var(--zaploto-green)] ${pathname === '/academy/trilhas' ? 'text-[var(--zaploto-green)]' : 'text-[var(--muted-foreground)]'}`}
            >
              Trilhas
            </Link>
            <Link
              href="/academy/materiais"
              className={`text-sm font-medium transition hover:text-[var(--zaploto-green)] ${pathname === '/academy/materiais' ? 'text-[var(--zaploto-green)]' : 'text-[var(--muted-foreground)]'}`}
            >
              Materiais
            </Link>
            {!checking && (
              userId ? (
                <Link
                  href="/admin"
                  className="flex items-center gap-1.5 rounded-lg bg-[var(--zaploto-green-bg)] px-3 py-2 text-sm font-medium text-[var(--zaploto-green)] hover:bg-[var(--zaploto-green-bg-hover)]"
                >
                  <LayoutDashboard className="h-4 w-4" />
                  Painel
                </Link>
              ) : (
                <Link
                  href="/login"
                  className="flex items-center gap-1.5 rounded-lg bg-[var(--zaploto-green)] px-3 py-2 text-sm font-medium text-white hover:opacity-90"
                >
                  <LogIn className="h-4 w-4" />
                  Entrar
                </Link>
              )
            )}
          </nav>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-[var(--card-border)] py-6 text-center text-sm text-[var(--muted-foreground)]">
        <p>ZapLoto Academy — Conteúdos e trilhas de aprendizado</p>
      </footer>
    </div>
  );
}
