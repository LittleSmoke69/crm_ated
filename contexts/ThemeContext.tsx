'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';

export type Theme = 'light' | 'dark';

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  isLoading: boolean;
}

const ThemeContext = createContext<ThemeContextType | null>(null);

const STORAGE_KEY = 'zaploto_theme_preference';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('dark');
  const [isLoading, setIsLoading] = useState(true);

  const applyTheme = useCallback((t: Theme) => {
    const root = document.documentElement;
    root.setAttribute('data-theme', t);
    if (t === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, []);

  const setTheme = useCallback(async (t: Theme) => {
    setThemeState(t);
    applyTheme(t);
    try {
      localStorage.setItem(STORAGE_KEY, t);
      const userId = typeof window !== 'undefined'
        ? (sessionStorage.getItem('user_id') || sessionStorage.getItem('profile_id') || localStorage.getItem('profile_id'))
        : null;
      if (userId) {
        await fetch('/api/user/theme', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
          credentials: 'include',
          body: JSON.stringify({ theme: t }),
        });
      }
    } catch {
      // Silencioso: mantém no localStorage
    }
  }, [applyTheme]);

  const toggleTheme = useCallback(() => {
    setTheme(theme === 'light' ? 'dark' : 'light');
  }, [theme, setTheme]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const userId = sessionStorage.getItem('user_id') || sessionStorage.getItem('profile_id') || localStorage.getItem('profile_id');

    const initTheme = async () => {
      try {
        if (userId) {
          const res = await fetch('/api/user/profile', {
            headers: { 'X-User-Id': userId },
            credentials: 'include',
          });
          if (res.ok) {
            const json = await res.json();
            const pref = json?.data?.theme_preference;
            if (pref === 'dark' || pref === 'light') {
              setThemeState(pref);
              applyTheme(pref);
              setIsLoading(false);
              return;
            }
          }
        }
      } catch {
        // Fallback para localStorage
      }

      const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
      const resolved: Theme = stored === 'dark' || stored === 'light' ? stored : 'dark';
      setThemeState(resolved);
      applyTheme(resolved);
      setIsLoading(false);
    };

    initTheme();
  }, [applyTheme]);

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
