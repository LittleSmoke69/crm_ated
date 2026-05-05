'use client';

import React, { createContext, useContext, useState } from 'react';

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

  const setSelectedTenantId = (id: string | null) => {
    setSelectedTenantIdState(id);
    if (typeof window !== 'undefined') {
      if (id) sessionStorage.setItem(ADMIN_TENANT_KEY, id);
      else sessionStorage.removeItem(ADMIN_TENANT_KEY);
    }
  };

  const getTenantHeader = (): Record<string, string> => {
    if (selectedTenantId) {
      return { 'X-Zaploto-Id': selectedTenantId };
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
