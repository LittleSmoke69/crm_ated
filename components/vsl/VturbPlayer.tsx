'use client';

import { useEffect, useRef, createElement } from 'react';

interface VturbPlayerProps {
  playerId: string;
  scriptSrc: string;
  maxWidth?: number;
  onPlay?: () => void;
  onProgress?: (percent: number) => void;
}

export function VturbPlayer({
  playerId,
  scriptSrc,
  maxWidth = 400,
  onPlay,
  onProgress,
}: VturbPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scriptLoadedRef = useRef(false);

  useEffect(() => {
    if (!playerId || !scriptSrc) return;
    const existing = document.querySelector(`script[src="${scriptSrc}"]`);
    if (existing) {
      scriptLoadedRef.current = true;
      return;
    }
    const script = document.createElement('script');
    script.src = scriptSrc;
    script.async = true;
    script.onload = () => {
      scriptLoadedRef.current = true;
    };
    document.head.appendChild(script);
    return () => {
      script.remove();
      scriptLoadedRef.current = false;
    };
  }, [scriptSrc, playerId]);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      let data = event.data;
      if (typeof data === 'string') {
        try {
          data = JSON.parse(data);
        } catch {
          return;
        }
      }
      if (!data || typeof data !== 'object') return;
      const type = data.event ?? data.type ?? data.name ?? data.action;
      const percent = Number(data.percent ?? data.progress ?? data.percentWatched ?? 0);
      if (type === 'play' || type === 'start' || data.playing) {
        onPlay?.();
      }
      if (percent > 0) {
        onProgress?.(percent);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [onPlay, onProgress]);

  return (
    <div ref={containerRef} style={{ maxWidth: `${maxWidth}px`, margin: '0 auto' }}>
      {createElement('vturb-smartplayer', { id: playerId })}
    </div>
  );
}
