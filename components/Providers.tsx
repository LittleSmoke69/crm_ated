'use client';

import React from 'react';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { SidebarProvider } from '@/contexts/SidebarContext';
import { ZaplotoTenantProvider } from '@/contexts/ZaplotoTenantContext';
import { AdminTenantSwitcherProvider } from '@/contexts/AdminTenantSwitcherContext';
import { TenantThemeVariables } from '@/components/TenantThemeVariables';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <ZaplotoTenantProvider>
        <TenantThemeVariables />
        <AdminTenantSwitcherProvider>
          <SidebarProvider>
            {children}
          </SidebarProvider>
        </AdminTenantSwitcherProvider>
      </ZaplotoTenantProvider>
    </ThemeProvider>
  );
}

