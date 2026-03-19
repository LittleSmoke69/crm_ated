'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { LogIn, LayoutDashboard, Menu, X } from 'lucide-react';
import { useRequireAuth } from '@/utils/useRequireAuth';

// delay em segundos para cada dot flutuar fora de sincronia
const BOKEH = [
  { s: 3, x: '12%', y: '25%', o: 0.45, d: 0    },
  { s: 4, x: '28%', y: '65%', o: 0.3,  d: 1.2  },
  { s: 3, x: '50%', y: '30%', o: 0.35, d: 2.4  },
  { s: 4, x: '67%', y: '70%', o: 0.25, d: 0.6  },
  { s: 3, x: '80%', y: '20%', o: 0.4,  d: 1.8  },
  { s: 4, x: '92%', y: '60%', o: 0.3,  d: 3.0  },
];

const NAV_LINKS = [
  { href: '/academy',           label: 'Início'    },
  { href: '/academy/trilhas',   label: 'Trilhas'   },
  { href: '/academy/materiais', label: 'Materiais' },
];

export default function AcademyLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { checking, userId } = useRequireAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="relative min-h-screen bg-[#030803] text-[var(--foreground)] flex flex-col">

      {/* ── BACKGROUND GLOBAL ANIMADO ── */}
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">

        {/* Glow radial da base — simula luz subindo dos cards */}
        <div className="absolute bottom-0 left-1/4 h-64 w-96 rounded-full bg-[#4ade80]/5 blur-3xl" />
        <div className="absolute bottom-0 right-1/4 h-56 w-80 rounded-full bg-[#22c55e]/4 blur-3xl" />
        <div className="absolute bottom-0 left-1/2 h-48 w-72 -translate-x-1/2 rounded-full bg-[#4ade80]/6 blur-3xl" />

        {/* Orbs pulsantes */}
        <div className="academy-orb-pulse absolute -left-16 top-1/4 h-72 w-72 rounded-full bg-[#1a5c1a]/12 blur-3xl" style={{ animationDelay: '0s' }} />
        <div className="academy-orb-pulse absolute right-0 top-1/2 h-80 w-80 rounded-full bg-[#0d3d0d]/18 blur-3xl" style={{ animationDelay: '4s' }} />
        <div className="academy-orb-pulse absolute bottom-1/4 left-1/2 h-60 w-60 rounded-full bg-[#1a5c1a]/10 blur-3xl" style={{ animationDelay: '7s' }} />


        {/* Partículas subindo — nascem na base, evaporam */}
        {[
          { s: 3, x: '8%',  y: '85%', o: 0.45, d: 0   },
          { s: 2, x: '18%', y: '90%', o: 0.35, d: 1.5  },
          { s: 4, x: '30%', y: '80%', o: 0.4,  d: 3.0  },
          { s: 2, x: '42%', y: '88%', o: 0.3,  d: 0.8  },
          { s: 3, x: '55%', y: '82%', o: 0.45, d: 2.2  },
          { s: 2, x: '65%', y: '92%', o: 0.35, d: 4.0  },
          { s: 4, x: '78%', y: '78%', o: 0.4,  d: 1.2  },
          { s: 2, x: '90%', y: '86%', o: 0.3,  d: 3.5  },
          { s: 3, x: '22%', y: '70%', o: 0.3,  d: 5.5  },
          { s: 2, x: '50%', y: '75%', o: 0.35, d: 2.8  },
          { s: 3, x: '70%', y: '65%', o: 0.25, d: 6.0  },
          { s: 2, x: '95%', y: '72%', o: 0.3,  d: 0.4  },
        ].map((p, i) => (
          <div
            key={i}
            className="academy-particle-rise absolute rounded-full bg-[#4ade80]"
            style={{
              width: p.s, height: p.s,
              left: p.x, top: p.y,
              boxShadow: `0 0 ${p.s * 3}px #4ade80`,
              animationDelay: `${p.d}s`,
              animationDuration: `${5 + (i % 3)}s`,
              ['--dot-o' as string]: p.o,
              opacity: p.o,
            }}
          />
        ))}

        {/* Bokeh dots estáticos flutuantes — espalhados pela tela */}
        {[
          { s: 3, x: '3%',  y: '12%', o: 0.22, d: 0   },
          { s: 2, x: '14%', y: '35%', o: 0.18, d: 1.1 },
          { s: 4, x: '25%', y: '58%', o: 0.15, d: 2.3 },
          { s: 3, x: '38%', y: '20%', o: 0.2,  d: 0.5 },
          { s: 2, x: '50%', y: '42%', o: 0.17, d: 1.9 },
          { s: 4, x: '62%', y: '15%', o: 0.16, d: 3.2 },
          { s: 3, x: '74%', y: '60%', o: 0.18, d: 0.7 },
          { s: 2, x: '85%', y: '30%', o: 0.22, d: 2.6 },
          { s: 3, x: '92%', y: '50%', o: 0.16, d: 1.4 },
          { s: 2, x: '7%',  y: '65%', o: 0.14, d: 4.1 },
          { s: 4, x: '32%', y: '48%', o: 0.12, d: 0.9 },
          { s: 3, x: '58%', y: '72%', o: 0.15, d: 3.7 },
        ].map((dot, i) => (
          <div
            key={i}
            className="academy-bokeh-dot absolute rounded-full bg-[#4ade80]"
            style={{
              width: dot.s, height: dot.s,
              left: dot.x, top: dot.y,
              boxShadow: `0 0 ${dot.s * 4}px #4ade8088`,
              filter: `blur(${dot.s > 3 ? 1 : 0}px)`,
              animationDelay: `${dot.d}s`,
              ['--dot-o' as string]: dot.o,
              opacity: dot.o,
            }}
          />
        ))}

        {/* Nós brilhantes da grid que pulsam */}
        {[
          { x: '20%', y: '25%', d: 0   },
          { x: '40%', y: '60%', d: 1.5 },
          { x: '60%', y: '30%', d: 3.0 },
          { x: '80%', y: '70%', d: 0.8 },
          { x: '15%', y: '75%', d: 2.2 },
          { x: '70%', y: '10%', d: 4.0 },
        ].map((n, i) => (
          <div
            key={i}
            className="academy-node-pulse absolute h-1 w-1 rounded-full bg-[#4ade80]"
            style={{
              left: n.x, top: n.y,
              boxShadow: '0 0 6px #4ade80, 0 0 12px #4ade8066',
              animationDelay: `${n.d}s`,
            }}
          />
        ))}

        {/* Grid derivando */}
        <div
          className="academy-grid-drift absolute inset-0 opacity-[0.035]"
          style={{
            backgroundImage: 'linear-gradient(#4ade80 1px, transparent 1px), linear-gradient(90deg, #4ade80 1px, transparent 1px)',
            backgroundSize: '40px 40px',
          }}
        />

        {/* Scanline varrendo */}
        <div
          className="academy-scanline absolute inset-x-0 h-px bg-gradient-to-r from-transparent via-[#4ade80]/30 to-transparent"
          style={{ top: 0 }}
        />
      </div>

      {/* ── HEADER ── */}
      <header className="sticky top-0 z-50 border-b border-[#1a3d1a] bg-[#060f07]">
        {/* Textura animada */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          {/* Orbs pulsantes */}
          <div className="academy-orb-pulse absolute -left-6 top-0 h-20 w-20 rounded-full bg-[#1a5c1a]/30 blur-2xl" style={{ animationDelay: '0s' }} />
          <div className="academy-orb-pulse absolute right-10 bottom-0 h-16 w-24 rounded-full bg-[#0d3d0d]/50 blur-2xl" style={{ animationDelay: '4s' }} />

          {/* Bokeh dots flutuantes */}
          {BOKEH.map((dot, i) => (
            <div
              key={i}
              className="academy-bokeh-dot absolute rounded-full bg-[#4ade80]"
              style={{
                width: dot.s,
                height: dot.s,
                left: dot.x,
                top: dot.y,
                filter: 'blur(1px)',
                animationDelay: `${dot.d}s`,
                ['--dot-o' as string]: dot.o,
                opacity: dot.o,
              }}
            />
          ))}

          {/* Grid drifting */}
          <div
            className="academy-grid-drift absolute inset-0 opacity-[0.035]"
            style={{ backgroundImage: 'linear-gradient(#4ade80 1px, transparent 1px), linear-gradient(90deg, #4ade80 1px, transparent 1px)', backgroundSize: '40px 40px' }}
          />

        </div>

        <div className="relative mx-auto flex h-14 max-w-screen-xl items-center justify-between px-4 sm:px-6 lg:px-10">
          {/* Logo */}
          <Link href="/academy" className="flex items-center hover:opacity-90 transition-opacity">
            <Image src="/logo_zaploto.png" alt="ZapLoto Academy" width={140} height={36}
              className="h-8 w-auto object-contain sm:h-9" priority />
          </Link>

          {/* Nav desktop */}
          <nav className="hidden sm:flex items-center gap-1">
            {NAV_LINKS.map(({ href, label }) => (
              <Link key={href} href={href}
                className={`rounded-lg px-3 py-2 text-sm font-medium transition ${pathname === href ? 'text-[#4ade80]' : 'text-white/50 hover:text-[#4ade80]'}`}>
                {label}
              </Link>
            ))}
            {!checking && (
              userId ? (
                <Link href="/admin"
                  className="ml-2 flex items-center gap-1.5 rounded-lg border border-[#4ade80]/40 bg-[#4ade80]/10 px-3 py-2 text-sm font-medium text-[#4ade80] hover:bg-[#4ade80]/20 transition">
                  <LayoutDashboard className="h-4 w-4" /> Painel
                </Link>
              ) : (
                <Link href="/login"
                  className="ml-2 flex items-center gap-1.5 rounded-lg border border-[#4ade80]/40 bg-[#4ade80]/10 px-3 py-2 text-sm font-medium text-[#4ade80] hover:bg-[#4ade80]/20 transition">
                  <LogIn className="h-4 w-4" /> Entrar
                </Link>
              )
            )}
          </nav>

          {/* Hamburger mobile */}
          <button
            type="button"
            className="sm:hidden flex h-9 w-9 items-center justify-center rounded-lg border border-[#4ade80]/30 text-[#4ade80] hover:bg-[#4ade80]/10 transition"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Menu"
          >
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>

        {/* Mobile dropdown menu */}
        {menuOpen && (
          <div className="relative sm:hidden border-t border-[#1a3d1a] bg-[#060f07] px-4 pb-4 pt-2">
            <div className="absolute inset-0 opacity-[0.03]"
              style={{ backgroundImage: 'linear-gradient(#4ade80 1px, transparent 1px), linear-gradient(90deg, #4ade80 1px, transparent 1px)', backgroundSize: '40px 40px' }} />
            <nav className="relative flex flex-col gap-1">
              {NAV_LINKS.map(({ href, label }) => (
                <Link key={href} href={href} onClick={() => setMenuOpen(false)}
                  className={`rounded-lg px-3 py-3 text-sm font-medium transition ${pathname === href ? 'text-[#4ade80] bg-[#4ade80]/10' : 'text-white/60 hover:text-[#4ade80] hover:bg-[#4ade80]/5'}`}>
                  {label}
                </Link>
              ))}
              {!checking && (
                <div className="mt-2 pt-2 border-t border-[#1a3d1a]">
                  {userId ? (
                    <Link href="/admin" onClick={() => setMenuOpen(false)}
                      className="flex items-center gap-2 rounded-lg border border-[#4ade80]/40 bg-[#4ade80]/10 px-3 py-3 text-sm font-medium text-[#4ade80]">
                      <LayoutDashboard className="h-4 w-4" /> Painel administrativo
                    </Link>
                  ) : (
                    <Link href="/login" onClick={() => setMenuOpen(false)}
                      className="flex items-center gap-2 rounded-lg border border-[#4ade80]/40 bg-[#4ade80]/10 px-3 py-3 text-sm font-medium text-[#4ade80]">
                      <LogIn className="h-4 w-4" /> Entrar na conta
                    </Link>
                  )}
                </div>
              )}
            </nav>
          </div>
        )}
      </header>

      <main className="relative z-10 flex-1">{children}</main>

      <footer className="relative z-10 overflow-hidden border-t border-[#1a3d1a] bg-[#060f07]/80 backdrop-blur-sm py-5 text-center text-sm text-white/30">
        <div className="pointer-events-none absolute inset-0 opacity-[0.03]"
          style={{ backgroundImage: 'linear-gradient(#4ade80 1px, transparent 1px), linear-gradient(90deg, #4ade80 1px, transparent 1px)', backgroundSize: '40px 40px' }} />
        <p className="relative">ZapLoto Academy — Conteúdos e trilhas de aprendizado</p>
      </footer>
    </div>
  );
}
