'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';

export function useRequireAuth() {
  const router = useRouter();
  const pathname = usePathname();
  const [checking, setChecking] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [userStatus, setUserStatus] = useState<string | null>(null);

  useEffect(() => {
    // Rotas públicas que não devem redirecionar (vitrine da Academy é pública)
    const publicPaths = ['/login', '/register', '/admin/login', '/academy', '/academy/trilhas'];
    const publicPrefixes = ['/academy/modulos/', '/academy/aula/'];
    const isAcademyPublic = pathname.startsWith('/academy') && (
      publicPaths.includes(pathname) ||
      publicPrefixes.some((p) => pathname.startsWith(p))
    );

    // Garante que só roda no cliente
    if (typeof window === 'undefined') return;

    // Sessão (para Academy também queremos userId se logado)
    const id = sessionStorage.getItem('user_id')
      || sessionStorage.getItem('profile_id')
      || localStorage.getItem('profile_id');
    const status = sessionStorage.getItem('profile_status');

    // Se estiver numa rota pública (incluindo vitrine da Academy), não redireciona para login
    if (publicPaths.includes(pathname) || isAcademyPublic) {
      if (id) setUserId(id);
      setUserStatus(status);
      setChecking(false);
      return;
    }

    if (!id) {
      router.replace('/login');
      return;
    }

    setUserId(id);
    setUserStatus(status);
    setChecking(false);
  }, [router, pathname]);

  return { checking, userId, userStatus };
}
