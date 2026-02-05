'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';

export function useRequireAuth() {
  const router = useRouter();
  const pathname = usePathname();
  const [checking, setChecking] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    // Rotas públicas que não devem redirecionar
    const publicPaths = ['/login', '/register', '/admin/login'];

    // Garante que só roda no cliente
    if (typeof window === 'undefined') return;

    // Se estiver numa rota pública, não precisa checar sessão
    if (publicPaths.includes(pathname)) {
      setChecking(false);
      return;
    }

    // Sessão curta (some ao fechar o navegador)
    const id = sessionStorage.getItem('user_id')
      || sessionStorage.getItem('profile_id')
      || localStorage.getItem('profile_id'); // Fallback para localStorage se existir

    if (!id) {
      router.replace('/login');
      return;
    }

    setUserId(id);
    setChecking(false);
  }, [router, pathname]);

  return { checking, userId };
}
