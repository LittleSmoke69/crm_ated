'use client';

import React, { createContext, useContext, useLayoutEffect, useState } from 'react';

/** sessionStorage — alinhado ao TenantSwitcher e à página /admin/zaploto */
export const ADMIN_ZAPLOTO_TENANT_STORAGE_KEY = 'admin_zaploto_id';

const ADMIN_TENANT_KEY = ADMIN_ZAPLOTO_TENANT_STORAGE_KEY;

interface AdminTenantSwitcherContextValue {
  selectedTenantId: string | null;
  setSelectedTenantId: (id: string | null) => void;
  getTenantHeader: () => Record<string, string>;
}

const AdminTenantSwitcherContext = createContext<AdminTenantSwitcherContextValue | null>(null);

export function useAdminTenantSwitcher() {
  return useContext(AdminTenantSwitcherContext);
}

export function AdminTenantSwitcherProvider({ children }: { children: React.ReactNode }) {
  const [selectedTenantId, setSelectedTenantIdState] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return sessionStorage.getItem(ADMIN_TENANT_KEY);
  });

  /**
   * No SSR/hidratação o primeiro render pode vir com `null` mesmo com `sessionStorage` já definido
   * (initializer só roda no servidor sem `window`). Sincroniza antes do paint para o switcher e os fetches
   * enxergarem o tenant escolhido.
   */
  useLayoutEffect(() => {
    try {
      const stored = sessionStorage.getItem(ADMIN_TENANT_KEY)?.trim();
      if (stored) {
        setSelectedTenantIdState((prev) => (prev !== stored ? stored : prev));
      }
    } catch {
      // ignore
    }
  }, []);

  const setSelectedTenantId = (id: string | null) => {
    setSelectedTenantIdState(id);
    if (typeof window !== 'undefined') {
      if (id) sessionStorage.setItem(ADMIN_TENANT_KEY, id);
      else sessionStorage.removeItem(ADMIN_TENANT_KEY);
    }
  };

  const getTenantHeader = (): Record<string, string> => {
    const id =
      (typeof window !== 'undefined'
        ? selectedTenantId?.trim() || sessionStorage.getItem(ADMIN_TENANT_KEY)?.trim()
        : selectedTenantId?.trim()) || '';
    if (id) {
      return { 'X-Zaploto-Id': id };
    }
    return {} as Record<string, string>;
  };

  return (
    <AdminTenantSwitcherContext.Provider
      value={{ selectedTenantId, setSelectedTenantId, getTenantHeader }}
    >
      {children}
    </AdminTenantSwitcherContext.Provider>
  );
}
