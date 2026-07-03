import React from 'react';
import {
  zapCard,
  zapCardGlowBottom,
  zapCardGlowTop,
  zapCardMuted,
} from '@/lib/zap-card-styles';

type ZapCardVariant = 'default' | 'muted';

interface ZapCardProps {
  children: React.ReactNode;
  className?: string;
  variant?: ZapCardVariant;
  glow?: boolean;
  padding?: boolean;
}

export default function ZapCard({
  children,
  className = '',
  variant = 'default',
  glow = true,
  padding = true,
}: ZapCardProps) {
  const base = variant === 'muted' ? zapCardMuted : zapCard;
  const paddingClass = padding ? 'p-4 sm:p-6' : '';

  return (
    <div className={`${base} ${paddingClass} ${className}`.trim()}>
      {glow && variant === 'default' && (
        <>
          <div className={zapCardGlowTop} />
          <div className={zapCardGlowBottom} />
        </>
      )}
      <div className={glow && variant === 'default' ? 'relative z-10' : undefined}>{children}</div>
    </div>
  );
}
