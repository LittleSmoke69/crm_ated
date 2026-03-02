/**
 * Retorna o ID do usuário armazenado no cliente (sessionStorage ou localStorage).
 * Use em componentes client-side para enviar no header X-User-Id.
 * Não lança exceção se o storage estiver indisponível (ex.: modo privado).
 */
export function getStoredUserId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return (
      sessionStorage.getItem('user_id') ||
      sessionStorage.getItem('profile_id') ||
      window.localStorage.getItem('profile_id') ||
      null
    );
  } catch {
    return null;
  }
}
