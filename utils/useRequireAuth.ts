'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useTenantRouter } from '@/lib/utils/tenant-href';
import { getInternalAppPathname } from '@/lib/utils/white-label-path';

export function useRequireAuth() {
  const router = useTenantRouter();
  const pathname = usePathname();
  const routePath = pathname ? getInternalAppPathname(pathname) : '/';
  const [checking, setChecking] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [userStatus, setUserStatus] = useState<string | null>(null);

  useEffect(() => {
    // Rotas públicas que não devem redirecionar (vitrine da Academy é pública)
    const publicPaths = ['/login', '/register', '/admin/login', '/academy', '/academy/trilhas'];
    const publicPrefixes = ['/academy/modulos/', '/academy/aula/'];
    const isAcademyPublic = routePath.startsWith('/academy') && (
      publicPaths.includes(routePath) ||
      publicPrefixes.some((p) => routePath.startsWith(p))
    );

    // Garante que só roda no cliente
    if (typeof window === 'undefined') return;

    // Sessão (para Academy também queremos userId se logado)
    const id = sessionStorage.getItem('user_id')
      || sessionStorage.getItem('profile_id')
      || localStorage.getItem('profile_id');
    const statusFromStorage = sessionStorage.getItem('profile_status')?.trim() || null;

    // Se estiver numa rota pública (incluindo vitrine da Academy), não redireciona para login
    if (publicPaths.includes(routePath) || isAcademyPublic) {
      if (id) setUserId(id);
      setUserStatus(statusFromStorage);
      setChecking(false);
      return;
    }

    if (!id) {
      router.replace('/login');
      return;
    }

    setUserId(id);

    // Sessões sem profile_status (login antigo, impersonação, outra aba) — alinhar com /api/user/profile
    if (!statusFromStorage) {
      let cancelled = false;
      (async () => {
        try {
          const res = await fetch('/api/user/profile', {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
              'X-User-Id': id,
            },
            credentials: 'include',
          });
          const text = await res.text();
          if (cancelled) return;
          if (res.ok && text.trim()) {
            try {
              const json = JSON.parse(text) as { success?: boolean; data?: { status?: string | null } };
              const st = json.success && json.data?.status != null ? String(json.data.status).trim() : null;
              if (st) {
                setUserStatus(st);
                try {
                  sessionStorage.setItem('profile_status', st);
                } catch {
                  /* ignore */
                }
              } else {
                setUserStatus(null);
              }
            } catch {
              setUserStatus(null);
            }
          } else {
            setUserStatus(null);
          }
        } catch {
          if (!cancelled) setUserStatus(null);
        } finally {
          if (!cancelled) setChecking(false);
        }
      })();
      return () => {
        cancelled = true;
      };
    }

    setUserStatus(statusFromStorage);
    setChecking(false);
  }, [router, pathname, routePath]);

  return { checking, userId, userStatus };
}
