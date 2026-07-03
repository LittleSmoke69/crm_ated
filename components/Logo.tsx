'use client';

import React from 'react';
import { useZaplotoTenant } from '@/contexts/ZaplotoTenantContext';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const APP_NAME = 'crmTR';

const LEGACY_APP_TITLES = new Set(['crm-atendimento']);

function resolveBrandLabel(appTitle?: string | null, name?: string | null): string {
  const raw = (appTitle || name || APP_NAME).trim();
  if (LEGACY_APP_TITLES.has(raw)) return APP_NAME;
  return raw;
}

const textSizeClasses = {
  sm: 'text-sm sm:text-base',
  md: 'text-lg sm:text-xl',
  lg: 'text-xl sm:text-2xl',
  xl: 'text-2xl sm:text-3xl',
};

/** Wordmark de texto (sem imagem). Usa o nome do tenant quando definido. */
const Logo: React.FC<LogoProps> = ({ size = 'md', className = '' }) => {
  const { tenant } = useZaplotoTenant();
  const label = resolveBrandLabel(tenant.app_title, tenant.name);

  return (
    <div className={`flex min-w-0 items-center justify-center ${className}`}>
      <span
        className={`${textSizeClasses[size]} max-w-full truncate font-bold tracking-tight text-[var(--zaploto-green)]`}
      >
        {label}
      </span>
    </div>
  );
};

export default Logo;
