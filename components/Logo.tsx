'use client';

import Image from 'next/image';
import React from 'react';
import { usePathname } from 'next/navigation';
import { getPathnameTenantSlug } from '@/lib/utils/white-label-path';
import { useZaplotoTenant } from '@/contexts/ZaplotoTenantContext';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const Logo: React.FC<LogoProps> = ({ 
  size = 'md', 
  className = '' 
}) => {
  const pathname = usePathname();
  const wlSlugInUrl = pathname ? getPathnameTenantSlug(pathname) : null;
  const { tenant, loading } = useZaplotoTenant();
  const sizeClasses = {
    sm: 'h-10 w-auto',
    md: 'h-16 w-auto',
    lg: 'h-20 w-auto',
    xl: 'h-16 w-auto',
  };

  const widthValues = {
    sm: 100,
    md: 140,
    lg: 180,
    xl: 160,
  };

  const heightValues = {
    sm: 40,
    md: 64,
    lg: 80,
    xl: 64,
  };

  const altText = tenant.app_title || 'ZapLoto';

  /** Na URL `/{slug}/…` nunca mostrar a logo central até termos branding WL (evita flash ZapLoto → WL). */
  const isWlPublicUrl = !!wlSlugInUrl;
  const showCentralFallback = !isWlPublicUrl && !tenant.logo_url;

  if (isWlPublicUrl && !tenant.logo_url && loading) {
    return (
      <div className={`flex items-center justify-center ${className}`}>
        <div
          className={`${sizeClasses[size]} rounded-lg bg-gray-200 dark:bg-[#333] animate-pulse min-w-[100px]`}
          aria-hidden
        />
      </div>
    );
  }

  if (isWlPublicUrl && !tenant.logo_url && !loading) {
    return (
      <div className={`flex items-center justify-center ${className}`}>
        <span className="text-lg font-semibold text-gray-700 dark:text-gray-200 px-2 text-center max-w-[14rem] leading-tight">
          {tenant.app_title || tenant.name || wlSlugInUrl}
        </span>
      </div>
    );
  }

  const logoSrc = tenant.logo_url || (showCentralFallback ? '/logo_zaploto.png' : '');
  if (!logoSrc) {
    return (
      <div className={`flex items-center justify-center ${className}`}>
        <div
          className={`${sizeClasses[size]} rounded-lg bg-gray-200 dark:bg-[#333] animate-pulse min-w-[100px]`}
          aria-hidden
        />
      </div>
    );
  }

  return (
    <div className={`flex items-center justify-center ${className}`}>
      <div className="relative inline-block">
        <Image
          src={logoSrc}
          alt={altText}
          width={widthValues[size]}
          height={heightValues[size]}
          className={`${sizeClasses[size]} object-contain`}
          priority
          unoptimized={logoSrc.startsWith('http')}
        />
      </div>
    </div>
  );
};

export default Logo;

