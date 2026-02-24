'use client';

import React from 'react';
import { SidebarProvider } from '@/contexts/SidebarContext';
import { ZaplotoTenantProvider } from '@/contexts/ZaplotoTenantContext';
import { AdminTenantSwitcherProvider } from '@/contexts/AdminTenantSwitcherContext';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ZaplotoTenantProvider>
      <AdminTenantSwitcherProvider>
        <SidebarProvider>
          {children}
        </SidebarProvider>
      </AdminTenantSwitcherProvider>
    </ZaplotoTenantProvider>
  );
}

