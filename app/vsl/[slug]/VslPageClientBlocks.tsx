'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { VslContentRenderer } from '@/components/vsl/VslContentRenderer';
import type { VslContentRoot } from '@/lib/vsl/runtime/types';
import { buildVslRedirectHref } from '@/lib/vsl/runtime/redirect-url';

declare global {
  interface Window {
    fbq?: (a: string, b: string, c?: Record<string, unknown>, d?: { eventID?: string }) => void;
  }
}

function getQueryParam(name: string): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get(name);
}
function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return m ? m[2] : null;
}
function setFbcCookie(fbc: string) {
  if (typeof document === 'undefined') return;
  document.cookie = `_fbc=${encodeURIComponent(fbc)}; path=/; max-age=${90 * 24 * 60 * 60}; samesite=lax; secure`;
}

export interface VslPageClientBlocksProps {
  pageId: string;
  projectId: string;
  pixelId?: string;
  redirectSlug: string;
  ctaText: string;
  ctaMinWatchPercent: number;
  ctaDelaySeconds: number;
  videoPlayerId?: string;
  videoScriptSrc?: string;
  content: VslContentRoot | null;
}

export function VslPageClientBlocks({
  pageId,
  projectId,
  pixelId,
  redirectSlug,
  ctaText,
  ctaMinWatchPercent,
  ctaDelaySeconds,
  videoPlayerId,
  videoScriptSrc,
  content,
}: VslPageClientBlocksProps) {
  const router = useRouter();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [ctaVisible, setCtaVisible] = useState(ctaDelaySeconds === 0 && ctaMinWatchPercent === 0);
  const delayDone = useRef(false);
  const delayTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const trackEvent = useCallback(
    async (eventName: string, metadata?: Record<string, unknown>) => {
      const eventId = crypto.randomUUID();
      if (sessionId) {
        await fetch('/api/tracking/event', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: sessionId, event_name: eventName, event_id: eventId, metadata: metadata ?? {} }),
        });
      }
      if (pixelId && typeof window !== 'undefined' && window.fbq) {
        window.fbq('trackCustom', eventName, metadata ?? {}, { eventID: eventId });
      }
    },
    [sessionId, pixelId]
  );

  useEffect(() => {
    const fbclid = getQueryParam('fbclid');
    let fbc = getCookie('_fbc');
    if (fbclid && !fbc) {
      fbc = 'fb.1.' + Math.floor(Date.now() / 1000) + '.' + fbclid;
      setFbcCookie(fbc);
    }
    fetch('/api/tracking/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: projectId,
        page_id: pageId,
        utm_source: getQueryParam('utm_source'),
        utm_medium: getQueryParam('utm_medium'),
        utm_campaign: getQueryParam('utm_campaign'),
        utm_content: getQueryParam('utm_content'),
        utm_term: getQueryParam('utm_term'),
        fbclid,
        fbp: getCookie('_fbp') ?? undefined,
        fbc: fbc ?? undefined,
      }),
    })
      .then((r) => r.json())
      .then((d) => { if (d?.data?.session_id) setSessionId(d.data.session_id); })
      .catch(() => {});
    if (pixelId) {
      const script = document.createElement('script');
      script.innerHTML = `
        !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};
        if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
        t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script',
        'https://connect.facebook.net/en_US/fbevents.js');
        fbq('init','${pixelId}');fbq('track','PageView');
      `;
      document.head.appendChild(script);
      return () => {
        try {
          if (script.parentNode) script.parentNode.removeChild(script);
        } catch {
          // Evita erro removeChild quando o nó já foi removido
        }
      };
    }
  }, [projectId, pageId, pixelId]);

  useEffect(() => {
    if (!sessionId) return;
    const eventId = crypto.randomUUID();
    fetch('/api/tracking/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, event_name: 'VSL_VIEW', event_id: eventId, metadata: {} }),
    }).catch(() => {});
    if (pixelId && typeof window !== 'undefined' && window.fbq) {
      window.fbq('trackCustom', 'VSL_VIEW', {}, { eventID: eventId });
    }
  }, [sessionId, pixelId]);

  useEffect(() => {
    if (ctaDelaySeconds <= 0) return;
    delayTimer.current = setTimeout(() => setCtaVisible(true), ctaDelaySeconds * 1000);
    return () => { if (delayTimer.current) clearTimeout(delayTimer.current); };
  }, [ctaDelaySeconds]);

  const onPlay = useCallback(() => trackEvent('VSL_PLAY'), [trackEvent]);
  const onProgress = useCallback(
    (percent: number) => {
      if (ctaMinWatchPercent > 0 && percent >= ctaMinWatchPercent) setCtaVisible(true);
    },
    [ctaMinWatchPercent]
  );
  const onCtaClick = useCallback(() => {
    trackEvent('VSL_CTA_CLICK', { redirect_slug: redirectSlug });
    const href = buildVslRedirectHref(redirectSlug, sessionId);
    if (!href) return;
    router.push(href);
  }, [sessionId, redirectSlug, trackEvent, router]);

  const context = {
    pageId,
    projectId,
    pixelId,
    redirectSlug,
    ctaText,
    ctaMinWatchPercent,
    ctaDelaySeconds,
    videoPlayerId,
    videoScriptSrc,
    onPlay,
    onProgress,
    onCtaClick,
    ctaVisible,
    setCtaVisible,
    resolveAssetUrl: undefined as ((id: string) => string | undefined) | undefined,
  };

  return (
    <main className="min-h-screen bg-white text-gray-900">
      <VslContentRenderer content={content} context={context} />
    </main>
  );
}
