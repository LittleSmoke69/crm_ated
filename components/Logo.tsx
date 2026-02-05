import Image from 'next/image';
import React from 'react';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const Logo: React.FC<LogoProps> = ({ 
  size = 'md', 
  className = '' 
}) => {
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

  return (
    <div className={`flex items-center justify-center ${className}`}>
      <div 
        className="relative inline-block"
      >
        <Image
          src="/logo_zaploto.png"
          alt="ZapLoto Logo"
          width={widthValues[size]}
          height={heightValues[size]}
          className={`${sizeClasses[size]} object-contain`}
          priority
        />
      </div>
    </div>
  );
};

export default Logo;

