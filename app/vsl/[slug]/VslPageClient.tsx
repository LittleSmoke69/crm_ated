'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useTenantRouter } from '@/lib/utils/tenant-href';
import { VturbPlayer } from '@/components/vsl/VturbPlayer';
import Image from 'next/image';
import { buildVslRedirectHref } from '@/lib/vsl/runtime/redirect-url';

declare global {
  interface Window {
    fbq?: (a: string, b: string, c?: Record<string, unknown>, d?: { eventID?: string }) => void;
  }
}

function getQueryParam(name: string): string | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  return params.get(name);
}

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return match ? match[2] : null;
}

function setFbcCookie(fbc: string) {
  if (typeof document === 'undefined') return;
  const maxAge = 90 * 24 * 60 * 60;
  document.cookie = `_fbc=${encodeURIComponent(fbc)}; path=/; max-age=${maxAge}; samesite=lax; secure`;
}

export interface VslTestimonial {
  type?: 'text' | 'video';
  author_name: string;
  author_avatar_url?: string;
  content?: string;
  video_url?: string | null;
  likes_count?: number;
}

interface VslPageClientProps {
  pageId: string;
  projectId: string;
  pixelId?: string;
  redirectSlug: string;
  ctaText: string;
  ctaMinWatchPercent: number;
  ctaDelaySeconds: number;
  videoPlayerId?: string;
  videoScriptSrc?: string;
  pageTitle?: string;
  headerTitle?: string;
  marqueeText?: string;
  testimonials?: VslTestimonial[];
}

export function VslPageClient({
  pageId,
  projectId,
  pixelId,
  redirectSlug,
  ctaText,
  ctaMinWatchPercent,
  ctaDelaySeconds,
  videoPlayerId,
  videoScriptSrc,
  pageTitle = '',
  headerTitle = 'FINANÇAS',
  marqueeText = 'ATUALIZAÇÕES DIÁRIAS SOBRE FINANÇAS E APOSTAS',
  testimonials = [],
}: VslPageClientProps) {
  const router = useTenantRouter();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [ctaVisible, setCtaVisible] = useState(ctaDelaySeconds === 0 && ctaMinWatchPercent === 0);
  const [progressReached, setProgressReached] = useState<Set<number>>(new Set());
  const delayDone = useRef(false);
  const delayTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const trackEvent = useCallback(
    async (eventName: string, metadata?: Record<string, unknown>) => {
      const eventId = crypto.randomUUID();
      if (sessionId) {
        await fetch('/api/tracking/event', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id: sessionId,
            event_name: eventName,
            event_id: eventId,
            metadata: metadata ?? {},
          }),
        });
      }
      if (pixelId && typeof window !== 'undefined' && window.fbq) {
        window.fbq('trackCustom', eventName, metadata ?? {}, { eventID: eventId });
      }
    },
    [sessionId, pixelId]
  );

  useEffect(() => {
    const utm_source = getQueryParam('utm_source');
    const utm_medium = getQueryParam('utm_medium');
    const utm_campaign = getQueryParam('utm_campaign');
    const utm_content = getQueryParam('utm_content');
    const utm_term = getQueryParam('utm_term');
    const fbclid = getQueryParam('fbclid');
    let fbp = getCookie('_fbp');
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
        utm_source,
        utm_medium,
        utm_campaign,
        utm_content,
        utm_term,
        fbclid,
        fbp: fbp ?? undefined,
        fbc: fbc ?? undefined,
      }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d?.data?.session_id) setSessionId(d.data.session_id);
      })
      .catch(() => {});

    if (pixelId) {
      const script = document.createElement('script');
      script.innerHTML = `
        !function(f,b,e,v,n,t,s)
        {if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};
        if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
        t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window, document,'script',
        'https://connect.facebook.net/en_US/fbevents.js');
        fbq('init', '${pixelId}');
        fbq('track', 'PageView');
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
      body: JSON.stringify({
        session_id: sessionId,
        event_name: 'VSL_VIEW',
        event_id: eventId,
        metadata: {},
      }),
    }).catch(() => {});
    if (pixelId && typeof window !== 'undefined' && window.fbq) {
      window.fbq('trackCustom', 'VSL_VIEW', {}, { eventID: eventId });
    }
  }, [sessionId, pixelId]);

  useEffect(() => {
    if (ctaDelaySeconds <= 0) return;
    delayTimer.current = setTimeout(() => {
      delayDone.current = true;
      setCtaVisible(true);
    }, ctaDelaySeconds * 1000);
    return () => {
      if (delayTimer.current) clearTimeout(delayTimer.current);
    };
  }, [ctaDelaySeconds]);

  const onPlay = useCallback(() => {
    trackEvent('VSL_PLAY');
  }, [trackEvent]);

  const onProgress = useCallback(
    (percent: number) => {
      const thresholds = [25, 50, 75];
      setProgressReached((prev) => {
        const next = new Set(prev);
        let changed = false;
        for (const t of thresholds) {
          if (percent >= t && !next.has(t)) {
            next.add(t);
            changed = true;
            trackEvent(`VSL_${t}`, { percent });
          }
        }
        if (changed && ctaMinWatchPercent > 0 && percent >= ctaMinWatchPercent) {
          setCtaVisible(true);
        }
        return next;
      });
    },
    [trackEvent, ctaMinWatchPercent]
  );

  const onCtaClick = useCallback(() => {
    trackEvent('VSL_CTA_CLICK', { redirect_slug: redirectSlug });
    const href = buildVslRedirectHref(redirectSlug, sessionId);
    if (!href) return;
    router.push(href);
  }, [sessionId, redirectSlug, trackEvent, router]);

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header vermelho com título e marquee */}
      <header className="bg-[#c41e3a] text-white shrink-0">
        <div className="flex items-center justify-center gap-4 py-3 px-4">
          <span className="sr-only">Busca</span>
          <h1 className="text-xl font-bold tracking-wide uppercase">{headerTitle}</h1>
          <span className="sr-only">Menu</span>
        </div>
        <div className="overflow-hidden border-t border-red-800/50 bg-[#a01830]">
          <div className="vsl-marquee-anim flex py-2 whitespace-nowrap text-sm font-medium text-white/95">
            <span className="inline-block pr-8">{marqueeText}</span>
            <span className="inline-block pr-8" aria-hidden>{marqueeText}</span>
          </div>
        </div>
      </header>

      {/* Conteúdo principal */}
      <div className="flex-1 max-w-2xl mx-auto w-full px-4 py-6 pb-12">
        {pageTitle && (
          <div className="mb-6">
            <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 leading-tight">{pageTitle}</h2>
          </div>
        )}

        {/* Vídeo */}
        {videoPlayerId && videoScriptSrc && (
          <div className="mb-6">
            <VturbPlayer
              playerId={videoPlayerId}
              scriptSrc={videoScriptSrc}
              maxWidth={600}
              onPlay={onPlay}
              onProgress={onProgress}
            />
          </div>
        )}

        {/* CTA amarelo pulsante */}
        {ctaVisible && (
          <div className="mb-10 flex justify-center">
            <button
              type="button"
              onClick={onCtaClick}
              className="vsl-cta-pulse inline-flex items-center justify-center py-4 px-8 rounded-full bg-[#facc15] text-gray-900 font-bold text-lg shadow-[0_4px_0_0_#ca8a04] hover:shadow-[0_6px_0_0_#ca8a04] active:shadow-[0_2px_0_0_#ca8a04] active:translate-y-0.5 transition-all duration-150 border-2 border-[#eab308] min-w-[280px]"
            >
              <span className="text-xl font-extrabold">SIM!</span>
              <span className="ml-1.5">{ctaText.replace(/^SIM!?\s*/i, '').trim() || 'Eu quero participar!'}</span>
            </button>
          </div>
        )}

        {/* Depoimentos (modelo rede social: texto ou vídeo + reações estilo Facebook) */}
        {testimonials.length > 0 && (
          <section className="mt-8">
            <h3 className="text-base font-semibold text-gray-700 mb-4">
              {testimonials.length} comentário{testimonials.length !== 1 ? 's' : ''}
            </h3>
            <ul className="space-y-4">
              {testimonials.map((t, i) => {
                const isVideo = t.type === 'video' && t.video_url;
                return (
                  <li key={i} className="flex gap-3">
                    <div className="shrink-0 w-10 h-10 rounded-full bg-gray-300 overflow-hidden">
                      {t.author_avatar_url ? (
                        <Image
                          src={t.author_avatar_url}
                          alt=""
                          width={40}
                          height={40}
                          className="w-full h-full object-cover"
                          unoptimized
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-500 text-sm font-medium">
                          {(t.author_name || '?').charAt(0).toUpperCase()}
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[#1877f2] font-semibold text-sm">{t.author_name || 'Anônimo'}</p>
                      {isVideo ? (
                        <div className="mt-1 rounded-2xl overflow-hidden bg-gray-100 max-w-full">
                          <video
                            src={t.video_url!}
                            controls
                            playsInline
                            className="w-full max-h-[280px]"
                          />
                        </div>
                      ) : (
                        <div className="mt-1 p-3 rounded-2xl rounded-tl-none bg-gray-100 text-gray-800 text-sm leading-relaxed">
                          {t.content ?? ''}
                        </div>
                      )}
                      <div className="mt-1 flex items-center gap-3 text-xs text-gray-500 flex-wrap">
                        <span className="hover:underline cursor-pointer text-[#1877f2]">Curtir</span>
                        <span className="hover:underline cursor-pointer text-[#1877f2]">Responder</span>
                        <span className="text-gray-400">·</span>
                        <span>{Math.floor(Math.random() * 12) + 1} h</span>
                        {/* Reações estilo Facebook: like + curtir com número personalizado */}
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-100/80 text-gray-600">
                          <span className="flex items-center justify-center w-5 h-5 rounded-full bg-[#1877f2] text-white text-[10px]" title="Like">👍</span>
                          <span className="flex items-center justify-center w-5 h-5 rounded-full bg-red-500 text-white text-[10px]" title="Curtir">❤</span>
                          <span className="ml-0.5 font-medium">{typeof t.likes_count === 'number' ? t.likes_count : 0}</span>
                        </span>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
