'use client';

import { useEffect, useMemo } from 'react';
import { useTheme } from '@/contexts/ThemeContext';
import { useZaplotoTenant } from '@/contexts/ZaplotoTenantContext';
import { paletteToCssVars } from '@/lib/constants/tenant-theme-map';

/**
 * Injeta variáveis CSS do white label conforme o tema claro/escuro ativo.
 */
export function TenantThemeVariables() {
  const { theme: mode } = useTheme();
  const { tenant } = useZaplotoTenant();

  const palette = useMemo(
    () => (mode === 'dark' ? tenant.theme.dark : tenant.theme.light),
    [mode, tenant.theme]
  );

  useEffect(() => {
    const root = document.documentElement;
    const vars = paletteToCssVars(palette);
    for (const [k, v] of Object.entries(vars)) {
      root.style.setProperty(k, v);
    }
    return undefined;
  }, [palette]);

  return null;
}
