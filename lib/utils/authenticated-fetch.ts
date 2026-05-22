'use client';

/** Opções padrão para chamadas API autenticadas (cookie de sessão + header legado). */
export function getAuthenticatedFetchInit(userId?: string | null): RequestInit {
  const headers: Record<string, string> = {};
  if (userId?.trim()) {
    headers['X-User-Id'] = userId.trim();
  }
  return {
    credentials: 'include',
    headers,
  };
}

export function mergeAuthInit(
  userId: string | null | undefined,
  init?: RequestInit
): RequestInit {
  const base = getAuthenticatedFetchInit(userId);
  return {
    ...init,
    credentials: 'include',
    headers: {
      ...base.headers,
      ...(init?.headers as Record<string, string> | undefined),
    },
  };
}
