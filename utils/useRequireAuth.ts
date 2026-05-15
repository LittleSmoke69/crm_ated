'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useTenantRouter } from '@/lib/utils/tenant-href';
import { getInternalAppPathname } from '@/lib/utils/white-label-path';

/** Confirmação pontual de que o userId ainda existe em `profiles` (evita GET /profile a cada navegação admin). */
const ADMIN_PROFILE_SESSION_OK_KEY = 'zaploto_v1_admin_profile_session_ok_uid';

/** Remove artefatos locais de sessão (cookie + storage) quando o backend indica 401. */
function clearClientAuthSlice() {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem('user_id');
    sessionStorage.removeItem('profile_id');
    sessionStorage.removeItem('profile_email');
    sessionStorage.removeItem('profile_status');
    sessionStorage.removeItem(ADMIN_PROFILE_SESSION_OK_KEY);
    localStorage.removeItem('profile_id');
    localStorage.removeItem('profile_email');
    const secure = window.location.protocol === 'https:' ? ' Secure;' : '';
    document.cookie = `user_id=; Path=/; Max-Age=0; SameSite=Lax;${secure}`;
  } catch {
    /* ignore */
  }
}

export function useRequireAuth() {
  const router = useTenantRouter();
  const pathname = usePathname();
  const routePath = pathname ? getInternalAppPathname(pathname) : '/';
  const loginHref = routePath.startsWith('/admin') ? '/admin/login' : '/login';
  const [checking, setChecking] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [userStatus, setUserStatus] = useState<string | null>(null);

  useEffect(() => {
    // Rotas públicas que não devem redirecionar (vitrine da Academy é pública)
    const publicPaths = ['/login', '/register', '/admin/login', '/academy', '/academy/trilhas'];
    const publicPrefixes = ['/academy/modulos/', '/academy/aula/'];
    const isAcademyPublic =
      routePath.startsWith('/academy') &&
      (publicPaths.includes(routePath) || publicPrefixes.some((p) => routePath.startsWith(p)));

    // Garante que só roda no cliente
    if (typeof window === 'undefined') return;

    // Sessão (para Academy também queremos userId se logado)
    const id =
      sessionStorage.getItem('user_id') ||
      sessionStorage.getItem('profile_id') ||
      localStorage.getItem('profile_id');
    const statusFromStorage = sessionStorage.getItem('profile_status')?.trim() || null;

    // Se estiver numa rota pública (incluindo vitrine da Academy), não redireciona para login
    if (publicPaths.includes(routePath) || isAcademyPublic) {
      if (id) setUserId(id);
      setUserStatus(statusFromStorage);
      setChecking(false);
      return;
    }

    if (!id) {
      router.replace(loginHref);
      return;
    }

    setUserId(id);

    const isAdminRoute = routePath.startsWith('/admin');

    const fetchProfileAndHydrateStatus = async (cancelled: () => boolean) => {
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
        if (cancelled()) return;
        if (res.status === 401) {
          clearClientAuthSlice();
          router.replace(loginHref);
          return;
        }
        if (res.ok && text.trim()) {
          try {
            const json = JSON.parse(text) as { success?: boolean; data?: { status?: string | null } };
            if (isAdminRoute && json.success) {
              try {
                sessionStorage.setItem(ADMIN_PROFILE_SESSION_OK_KEY, id);
              } catch {
                /* ignore */
              }
            }
            const st =
              json.success && json.data?.status != null ? String(json.data.status).trim() : null;
            if (st) {
              setUserStatus(st);
              try {
                sessionStorage.setItem('profile_status', st);
              } catch {
                /* ignore */
              }
            } else {
              setUserStatus(statusFromStorage);
            }
          } catch {
            setUserStatus(statusFromStorage);
          }
        } else {
          setUserStatus(statusFromStorage);
        }
      } catch {
        if (!cancelled()) setUserStatus(statusFromStorage);
      } finally {
        if (!cancelled()) setChecking(false);
      }
    };

    // Sessões sem profile_status — alinhar com /api/user/profile
    if (!statusFromStorage) {
      let cancelled = false;
      void fetchProfileAndHydrateStatus(() => cancelled);
      return () => {
        cancelled = true;
      };
    }

    // Painel admin: validar uma vez por aba que o perfil ainda existe (userId órfão → 401 → login)
    if (isAdminRoute && statusFromStorage) {
      try {
        if (sessionStorage.getItem(ADMIN_PROFILE_SESSION_OK_KEY) === id) {
          setUserStatus(statusFromStorage);
          setChecking(false);
          return;
        }
      } catch {
        /* ignore */
      }
      let cancelled = false;
      void fetchProfileAndHydrateStatus(() => cancelled);
      return () => {
        cancelled = true;
      };
    }

    setUserStatus(statusFromStorage);
    setChecking(false);
  }, [router, pathname, routePath, loginHref]);

  return { checking, userId, userStatus };
}
