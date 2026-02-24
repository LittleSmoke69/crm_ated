'use client';

import React, { useEffect, useRef, useState } from 'react';
import Script from 'next/script';

const SDK_URL = 'https://scripts.converteai.net/lib/js/smartplayer-wc/v4/sdk.js';

export interface VturbPlayerProps {
  projectId: string;
  playerId: string;
  aspectRatio?: number | null; // ex: 0.7795 (height/width) ou % padding
  useSdk?: boolean;
  className?: string;
}

/**
 * Player VTurb (ConverteAI): carrega o SDK uma vez e renderiza o embed.
 * src do iframe: https://scripts.converteai.net/{projectId}/players/{playerId}/v4/embed.html?vl={encodeURIComponent(location.href)}
 */
export default function VturbPlayer({
  projectId,
  playerId,
  aspectRatio = 0.5625,
  useSdk = true,
  className = '',
}: VturbPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const [embedUrlState, setEmbedUrlState] = useState('');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const base = `https://scripts.converteai.net/${projectId}/players/${playerId}/v4/embed.html`;
    const qs = window.location.search || '?';
    const vl = encodeURIComponent(window.location.href || '');
    const sep = qs === '?' ? '' : '&';
    setEmbedUrlState(`${base}${qs}${sep}vl=${vl}`);
  }, [projectId, playerId]);
  const ratio = aspectRatio != null && aspectRatio > 0 ? aspectRatio : 0.5625;
  const paddingPercent = ratio * 100;

  return (
    <>
      {useSdk && <Script src={SDK_URL} strategy="afterInteractive" />}
      <div
        ref={containerRef}
        className={`relative w-full overflow-hidden bg-black ${className}`}
        style={{ paddingBottom: `${paddingPercent}%` }}
      >
        <iframe
          title="VTurb Player"
          src={embedUrlState || undefined}
          className="absolute left-0 top-0 h-full w-full border-0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
    </>
  );
}
