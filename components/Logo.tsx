'use client';

import Image from 'next/image';
import React from 'react';
import { useZaplotoTenant } from '@/contexts/ZaplotoTenantContext';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const Logo: React.FC<LogoProps> = ({ 
  size = 'md', 
  className = '' 
}) => {
  const { tenant } = useZaplotoTenant();
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

  const logoSrc = tenant.logo_url || '/logo_zaploto.png';
  const altText = tenant.app_title || 'ZapLoto';

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

