'use client';

import type { SectionProps as P } from '@/lib/vsl/runtime/types';
import type { ReactNode } from 'react';

interface SectionBlockProps extends P {
  children?: ReactNode;
}

export function Section({ maxWidth, padding, className, children }: SectionBlockProps) {
  const style: React.CSSProperties = { width: '100%', boxSizing: 'border-box' };
  if (maxWidth !== undefined) {
    style.maxWidth = typeof maxWidth === 'number' ? `${maxWidth}px` : maxWidth;
  }
  if (padding !== undefined) {
    style.padding = padding;
  }
  return (
    <section className={className ?? 'px-4 py-6 mx-auto min-w-0'} style={style}>
      {children}
    </section>
  );
}
