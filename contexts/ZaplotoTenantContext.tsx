'use client';

import React, { createContext, useContext, useEffect, useLayoutEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { getPathnameTenantSlug } from '@/lib/utils/white-label-path';
import { isCentralTenantSlug } from '@/lib/constants/white-label';
import {
  getActiveTenantSlug,
  isCentralZaplotoAuthPath,
} from '@/lib/utils/tenant-href';
import {
  resolveTenantPalettes,
  type TenantThemePalette,
} from '@/lib/constants/tenant-theme-map';

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
  /** Paletas resolvidas (tokens fixos + overrides do tenant) */
  theme: { light: TenantThemePalette; dark: TenantThemePalette };
}

/** Cache de branding WL para primeiro paint após logout/navegação (evita flash da logo ZapLoto). */
const WL_BRANDING_CACHE_KEY = 'zaploto_wl_branding_v1';

function readWlBrandingCache(pathSlug: string): Partial<ZaplotoTenantInfo> | null {
  try {
    const raw = sessionStorage.getItem(WL_BRANDING_CACHE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as { slug?: string };
    if (!data.slug || data.slug.toLowerCase() !== pathSlug.toLowerCase()) return null;
    return data as Partial<ZaplotoTenantInfo>;
  } catch {
    return null;
  }
}

function writeWlBrandingCache(t: ZaplotoTenantInfo) {
  try {
    if (!t.slug || isCentralTenantSlug(t.slug) || !t.id) return;
    sessionStorage.setItem(
      WL_BRANDING_CACHE_KEY,
      JSON.stringify({
        id: t.id,
        name: t.name,
        slug: t.slug,
        app_title: t.app_title,
        primary_color: t.primary_color,
        secondary_color: t.secondary_color,
        logo_url: t.logo_url,
        favicon_url: t.favicon_url,
        support_email: t.support_email,
        domain: t.domain,
        theme: t.theme,
      })
    );
  } catch {
    // silencioso
  }
}

function mergeCachedTenant(p: Partial<ZaplotoTenantInfo>): ZaplotoTenantInfo {
  const theme =
    p.theme?.light && p.theme?.dark
      ? p.theme
      : resolveTenantPalettes({
          primary_color: p.primary_color,
          secondary_color: p.secondary_color ?? null,
        });
  return {
    id: p.id ?? null,
    name: p.name ?? 'ZapLoto',
    slug: p.slug ?? 'zaploto',
    app_title: p.app_title ?? 'ZapLoto',
    primary_color: p.primary_color ?? '#8CD955',
    secondary_color: p.secondary_color ?? null,
    logo_url: p.logo_url ?? null,
    favicon_url: p.favicon_url ?? null,
    support_email: p.support_email ?? null,
    domain: p.domain ?? null,
    theme,
  };
}

const defaultPalettes = resolveTenantPalettes({});

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
  theme: defaultPalettes,
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

function clearClientSessionArtifacts() {
  try {
    sessionStorage.removeItem('user_id');
    sessionStorage.removeItem('profile_id');
    sessionStorage.removeItem('profile_email');
    sessionStorage.removeItem('profile_status');
    localStorage.removeItem('profile_id');
    document.cookie = 'user_id=; Path=/; Max-Age=0; SameSite=Lax';
  } catch {
    // silencioso
  }
}

export function useZaplotoTenant() {
  const ctx = useContext(ZaplotoTenantContext);
  if (!ctx) {
    throw new Error('useZaplotoTenant must be used within ZaplotoTenantProvider');
  }
  return ctx;
}

export function ZaplotoTenantProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [tenant, setTenant] = useState<ZaplotoTenantInfo>(defaultTenant);
  const [loading, setLoading] = useState(true);

  const fetchTenant = async () => {
    try {
      if (typeof window === 'undefined') {
        setTenant(defaultTenant);
        return;
      }
      const pathSlug = getPathnameTenantSlug(window.location.pathname);
      if (pathSlug) {
        const cached = readWlBrandingCache(pathSlug);
        if (cached?.slug && (cached.logo_url || cached.id)) {
          setTenant(mergeCachedTenant(cached));
        }
      }
      setLoading(true);
      const slug = getActiveTenantSlug();
      const centralAuth = isCentralZaplotoAuthPath(window.location.pathname);
      let userId =
        sessionStorage.getItem('user_id') ||
        sessionStorage.getItem('profile_id') ||
        localStorage.getItem('profile_id');

      const url = centralAuth
        ? `/api/zaploto/tenant?central=1`
        : slug
          ? `/api/zaploto/tenant?slug=${encodeURIComponent(slug)}`
          : `/api/zaploto/tenant`;

      const baseOpts: RequestInit = { credentials: 'include' };

      let res = await fetch(url, userId ? { ...baseOpts, headers: { 'X-User-Id': userId } } : baseOpts);
      let json = await res.json().catch(() => ({}));

      if (res.status === 403 && userId) {
        clearClientSessionArtifacts();
        userId = null;
        res = await fetch(url, baseOpts);
        json = await res.json().catch(() => ({}));
      }

      if (json.success && json.data) {
        const d = json.data;
        const theme =
          d.theme?.light && d.theme?.dark
            ? d.theme
            : resolveTenantPalettes({
                theme_colors: d.theme_colors ?? null,
                primary_color: d.primary_color,
                secondary_color: d.secondary_color ?? null,
              });
        const next: ZaplotoTenantInfo = {
          id: d.id,
          name: d.name || 'ZapLoto',
          slug: d.slug || 'zaploto',
          app_title: d.app_title || 'ZapLoto',
          primary_color: d.primary_color || '#8CD955',
          secondary_color: d.secondary_color || null,
          logo_url: d.logo_url || null,
          favicon_url: d.favicon_url || null,
          support_email: d.support_email || null,
          domain: d.domain || null,
          theme,
        };
        setTenant(next);
        writeWlBrandingCache(next);
      } else {
        setTenant(defaultTenant);
      }
    } catch {
      setTenant(defaultTenant);
    } finally {
      setLoading(false);
    }
  };

  useLayoutEffect(() => {
    if (typeof window === 'undefined') return;
    const pathSlug = getPathnameTenantSlug(window.location.pathname);
    if (!pathSlug) return;
    const cached = readWlBrandingCache(pathSlug);
    if (cached?.slug && (cached.logo_url || cached.id)) {
      setTenant(mergeCachedTenant(cached));
    }
  }, [pathname]);

  useEffect(() => {
    fetchTenant();
  }, [pathname]);

  return (
    <ZaplotoTenantContext.Provider value={{ tenant, loading, refresh: fetchTenant }}>
      {children}
    </ZaplotoTenantContext.Provider>
  );
}
