'use client';

import { useEffect, useRef, useState } from 'react';

type Props = {
  inviteUrl: string;
  timerSeconds: number;
  logoUrl: string | null;
  projectName: string;
  pixelId: string | null;
  clickId: string;
  clickToken: string;
  visitId: string | null;
  visitToken: string | null;
};

function loadMetaPixel(pixelId: string, onReady: (fbq: (...args: unknown[]) => void) => void) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const w = window as unknown as { fbq?: (...args: unknown[]) => void; _fbq?: unknown };
  if (w.fbq) {
    onReady(w.fbq);
    return;
  }
  const script = document.createElement('script');
  script.async = true;
  script.src = 'https://connect.facebook.net/en_US/fbevents.js';
  script.onload = () => {
    const fbq = w.fbq;
    if (fbq) {
      fbq('init', pixelId);
      onReady(fbq);
    }
  };
  document.head.appendChild(script);
  if (!w.fbq) {
    w.fbq = function (...args: unknown[]) {
      const q = (w.fbq as { queue?: unknown[] }).queue ?? [];
      q.push(args);
      (w.fbq as { queue?: unknown[] }).queue = q;
    };
    w._fbq = w.fbq;
  }
}

export default function RedirectCountdownClient({
  inviteUrl,
  timerSeconds,
  logoUrl,
  projectName,
  pixelId,
  clickId,
  clickToken,
  visitId,
  visitToken,
}: Props) {
  const [countdown, setCountdown] = useState<number>(timerSeconds);
  const didRedirect = useRef(false);
  const timerStarted = useRef(false);

  useEffect(() => {
    if (!pixelId || !/^\d{5,20}$/.test(pixelId)) return;
    loadMetaPixel(pixelId, (fbq) => fbq('track', 'PageView'));
  }, [pixelId]);

  useEffect(() => {
    const handleLeave = () => {
      if (didRedirect.current || !visitId || !visitToken) return;
      const fbq = (window as unknown as { fbq?: (...args: unknown[]) => void }).fbq;
      if (fbq) fbq('trackCustom', 'RedirectIncomplete');
      navigator.sendBeacon(
        '/api/redirect/visit-incomplete',
        new Blob([JSON.stringify({ visit_id: visitId, visit_token: visitToken })], {
          type: 'application/json',
        })
      );
    };
    window.addEventListener('pagehide', handleLeave);
    return () => window.removeEventListener('pagehide', handleLeave);
  }, [visitId, visitToken]);

  useEffect(() => {
    if (timerStarted.current) return;
    timerStarted.current = true;
    const t = setInterval(() => {
      setCountdown((c) => (c > 0 ? c - 1 : 0));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (countdown !== 0 || didRedirect.current) return;
    didRedirect.current = true;
    if (pixelId && /^\d{5,20}$/.test(pixelId)) {
      const fbq = (window as unknown as { fbq?: (...args: unknown[]) => void }).fbq;
      if (fbq) fbq('track', 'Lead');
    }
    if (clickId && clickToken) {
      navigator.sendBeacon(
        '/api/redirect/complete',
        new Blob(
          [
            JSON.stringify({
              click_id: clickId,
              click_token: clickToken,
              visit_id: visitId ?? undefined,
              visit_token: visitToken ?? undefined,
            }),
          ],
          { type: 'application/json' }
        )
      );
    }
    window.location.href = inviteUrl;
  }, [countdown, inviteUrl, pixelId, clickId, clickToken, visitId, visitToken]);

  return (
    <main className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center p-6">
      {logoUrl && (
        <img src={logoUrl} alt={projectName} className="max-w-[200px] max-h-24 object-contain mb-8" />
      )}
      <h1 className="text-xl font-semibold text-center mb-4">
        Enviando você para o grupo de WhatsApp...
      </h1>
      {countdown === 0 ? (
        <div className="text-base font-medium text-green-400 animate-pulse">Redirecionando...</div>
      ) : (
        <div className="text-4xl font-bold text-green-400 tabular-nums">{countdown}</div>
      )}
    </main>
  );
}
