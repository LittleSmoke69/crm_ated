'use client';

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
} from 'react';

export type Theme = 'light' | 'dark';

interface ThemeContextType {
  theme: Theme;
  /** Aplica e persiste (localStorage + perfil no banco quando logado). Retorna se o API salvou. */
  setTheme: (theme: Theme) => Promise<boolean>;
  toggleTheme: () => Promise<boolean>;
  isLoading: boolean;
}

const ThemeContext = createContext<ThemeContextType | null>(null);

export const THEME_STORAGE_KEY = 'zaploto_theme_preference';
export const THEME_SESSION_READY_EVENT = 'zaploto-session-ready';

function readStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'light';
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'dark' || stored === 'light') return stored;
  } catch {
    /* ignore */
  }
  return 'light';
}

function readUserId(): string | null {
  if (typeof window === 'undefined') return null;
  return (
    sessionStorage.getItem('user_id') ||
    sessionStorage.getItem('profile_id') ||
    localStorage.getItem('profile_id')
  );
}

function applyDomTheme(t: Theme) {
  const root = document.documentElement;
  root.setAttribute('data-theme', t);
  if (t === 'dark') root.classList.add('dark');
  else root.classList.remove('dark');
}

async function putThemePreference(userId: string, theme: Theme): Promise<boolean> {
  try {
    const res = await fetch('/api/user/theme', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
      credentials: 'include',
      body: JSON.stringify({ theme }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Default alinhado ao layout (sem localStorage = light). Lê storage só no client após mount.
  const [theme, setThemeState] = useState<Theme>('light');
  const [isLoading, setIsLoading] = useState(true);
  /** Usuário escolheu tema nesta sessão — ignora resposta atrasada do perfil. */
  const userSetRef = useRef(false);
  const initGenRef = useRef(0);

  const setTheme = useCallback(async (t: Theme): Promise<boolean> => {
    userSetRef.current = true;
    setThemeState(t);
    applyDomTheme(t);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, t);
    } catch {
      /* ignore */
    }

    const userId = readUserId();
    if (!userId) return true;

    const ok = await putThemePreference(userId, t);
    if (!ok) {
      console.warn('[theme] Falha ao salvar preferência no perfil');
    }
    return ok;
  }, []);

  const toggleTheme = useCallback(async () => {
    return setTheme(theme === 'light' ? 'dark' : 'light');
  }, [theme, setTheme]);

  /** Carrega tema do perfil (fonte da verdade quando logado) e alinha localStorage. */
  const hydrateFromProfile = useCallback(async () => {
    const gen = ++initGenRef.current;
    const userId = readUserId();

    if (!userId) {
      if (gen === initGenRef.current) setIsLoading(false);
      return;
    }

    try {
      const res = await fetch('/api/user/profile', {
        headers: { 'X-User-Id': userId },
        credentials: 'include',
      });
      if (!res.ok) {
        if (gen === initGenRef.current) setIsLoading(false);
        return;
      }
      const json = await res.json();
      const pref = json?.data?.theme_preference;
      if (
        (pref === 'dark' || pref === 'light') &&
        !userSetRef.current &&
        gen === initGenRef.current
      ) {
        setThemeState(pref);
        applyDomTheme(pref);
        try {
          localStorage.setItem(THEME_STORAGE_KEY, pref);
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* mantém localStorage */
    } finally {
      if (gen === initGenRef.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const local = readStoredTheme();
    setThemeState(local);
    applyDomTheme(local);
    void hydrateFromProfile();

    const onSessionReady = () => {
      const userId = readUserId();
      if (!userId) return;
      userSetRef.current = true;
      const current = readStoredTheme();
      setThemeState(current);
      applyDomTheme(current);
      void putThemePreference(userId, current);
    };

    window.addEventListener(THEME_SESSION_READY_EVENT, onSessionReady);
    return () => window.removeEventListener(THEME_SESSION_READY_EVENT, onSessionReady);
  }, [hydrateFromProfile]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme, isLoading }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return ctx;
}

/** Disparar após login bem-sucedido para sincronizar tema local → perfil. */
export function notifyThemeSessionReady() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(THEME_SESSION_READY_EVENT));
}
