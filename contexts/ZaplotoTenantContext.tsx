'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';

export interface ZaplotoTenantInfo {
  id: string | null;
  name: string;
  slug: string;
  app_title: string;
  primary_color: string;
  secondary_color: string | null;
  logo_url: string | null;
  favicon_url: string | null;
  support_email: string | null;
  domain: string | null;
}

const defaultTenant: ZaplotoTenantInfo = {
  id: null,
  name: 'ZapLoto',
  slug: 'zaploto',
  app_title: 'ZapLoto',
  primary_color: '#8CD955',
  secondary_color: null,
  logo_url: null,
  favicon_url: null,
  support_email: null,
  domain: null,
};

const ZaplotoTenantContext = createContext<{
  tenant: ZaplotoTenantInfo;
  loading: boolean;
  refresh: () => void;
}>({
  tenant: defaultTenant,
  loading: true,
  refresh: () => {},
});

export function useZaplotoTenant() {
  const ctx = useContext(ZaplotoTenantContext);
  if (!ctx) {
    throw new Error('useZaplotoTenant must be used within ZaplotoTenantProvider');
  }
  return ctx;
}

export function ZaplotoTenantProvider({ children }: { children: React.ReactNode }) {
  const [tenant, setTenant] = useState<ZaplotoTenantInfo>(defaultTenant);
  const [loading, setLoading] = useState(true);

  const fetchTenant = async () => {
    try {
      let userId: string | null = null;
      if (typeof window !== 'undefined') {
        try {
          userId =
            sessionStorage.getItem('user_id') ||
            sessionStorage.getItem('profile_id') ||
            localStorage.getItem('profile_id');
        } catch {
          // storage indisponível (ex.: modo privado com restrições)
        }
      }
      if (!userId) {
        setTenant(defaultTenant);
        setLoading(false);
        return;
      }

      const res = await fetch('/api/zaploto/tenant', {
        headers: { 'X-User-Id': userId },
        credentials: 'include',
      });
      const json = await res.json();

      if (json.success && json.data) {
        setTenant({
          id: json.data.id,
          name: json.data.name || 'ZapLoto',
          slug: json.data.slug || 'zaploto',
          app_title: json.data.app_title || 'ZapLoto',
          primary_color: json.data.primary_color || '#8CD955',
          secondary_color: json.data.secondary_color || null,
          logo_url: json.data.logo_url || null,
          favicon_url: json.data.favicon_url || null,
          support_email: json.data.support_email || null,
          domain: json.data.domain || null,
        });
      }
    } catch {
      setTenant(defaultTenant);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTenant();
  }, []);

  return (
    <ZaplotoTenantContext.Provider value={{ tenant, loading, refresh: fetchTenant }}>
      {children}
    </ZaplotoTenantContext.Provider>
  );
}
