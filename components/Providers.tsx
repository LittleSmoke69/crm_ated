'use client';

import React from 'react';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { SidebarProvider } from '@/contexts/SidebarContext';
import { ZaplotoTenantProvider } from '@/contexts/ZaplotoTenantContext';
import { AdminTenantSwitcherProvider } from '@/contexts/AdminTenantSwitcherContext';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <ZaplotoTenantProvider>
        <AdminTenantSwitcherProvider>
          <SidebarProvider>
            {children}
          </SidebarProvider>
        </AdminTenantSwitcherProvider>
      </ZaplotoTenantProvider>
    </ThemeProvider>
  );
}

