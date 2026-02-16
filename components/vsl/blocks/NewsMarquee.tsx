'use client';

import { useRef, useEffect, useState } from 'react';
import type { NewsMarqueeProps as P } from '@/lib/vsl/runtime/types';

export function NewsMarquee(props: P) {
  const {
    text = 'ATUALIZAÇÕES',
    speed = 60,
    bgColor = '#7A0A0A',
    textColor = '#FFFFFF',
    uppercase = true,
  } = props;

  const [width, setWidth] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(el.offsetWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text]);

  const displayText = uppercase ? text.toUpperCase() : text;
  const duration = width > 0 ? width / speed : 20;

  return (
    <div
      className="w-full min-w-0 overflow-hidden border-t border-black/10"
      style={{ backgroundColor: bgColor, color: textColor }}
    >
      <div
        ref={ref}
        className="flex py-2 whitespace-nowrap text-sm font-medium vsl-marquee-inner"
        style={{
          animation: `vsl-marquee-keyframes ${duration}s linear infinite`,
        }}
      >
        <span className="inline-block pr-8">{displayText}</span>
        <span className="inline-block pr-8" aria-hidden>
          {displayText}
        </span>
      </div>
      <style>{`@keyframes vsl-marquee-keyframes { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }`}</style>
    </div>
  );
}
