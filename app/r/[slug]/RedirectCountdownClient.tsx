'use client';

import { useEffect, useRef, useState } from 'react';

type Props = {
  inviteUrl: string;
  timerSeconds: number;
  logoUrl: string | null;
  projectName: string;
  pixelId: string | null;
  clickId: string;
  visitId: string | null;
};

/** Inicializa o pixel do Facebook inline e dispara os eventos informados. */
function firePixelEvents(pixelId: string, events: string[]) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const escapedId = pixelId.replace(/'/g, "\\'");
  const existing = (window as unknown as { fbq?: (...args: unknown[]) => void }).fbq;
  if (existing) {
    for (const ev of events) existing('track', ev);
    return;
  }
  const evLines = events.map((ev) => `fbq('track', '${ev}');`).join('\n');
  const script = document.createElement('script');
  script.innerHTML = `
    !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};
    if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
    t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script',
    'https://connect.facebook.net/en_US/fbevents.js');
    fbq('init', '${escapedId}');
    ${evLines}
  `;
  document.head.appendChild(script);
}

export default function RedirectCountdownClient({
  inviteUrl,
  timerSeconds,
  logoUrl,
  projectName,
  pixelId,
  clickId,
  visitId,
}: Props) {
  const [countdown, setCountdown] = useState<number>(timerSeconds);
  const didRedirect = useRef(false);
  const timerStarted = useRef(false);

  // Pixel PageView ao montar
  useEffect(() => {
    if (pixelId) firePixelEvents(pixelId, ['PageView']);
  }, [pixelId]);

  // Ao sair sem concluir: RedirectIncomplete
  useEffect(() => {
    const handleLeave = () => {
      if (didRedirect.current) return;
      if (!visitId) return;
      const fbq = (window as unknown as { fbq?: (...args: unknown[]) => void }).fbq;
      if (fbq) fbq('trackCustom', 'RedirectIncomplete');
      navigator.sendBeacon(
        '/api/redirect/visit-incomplete',
        new Blob([JSON.stringify({ visit_id: visitId })], { type: 'application/json' })
      );
    };
    window.addEventListener('pagehide', handleLeave);
    return () => window.removeEventListener('pagehide', handleLeave);
  }, [visitId]);

  // Countdown tick
  useEffect(() => {
    if (timerStarted.current) return;
    timerStarted.current = true;
    const t = setInterval(() => {
      setCountdown((c) => (c > 0 ? c - 1 : 0));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  // Redirect quando chega a 0
  useEffect(() => {
    if (countdown !== 0) return;
    if (didRedirect.current) return;
    didRedirect.current = true;
    if (pixelId) {
      const fbq = (window as unknown as { fbq?: (...args: unknown[]) => void }).fbq;
      if (fbq) fbq('track', 'Lead');
    }
    navigator.sendBeacon(
      '/api/redirect/complete',
      new Blob(
        [JSON.stringify({ click_id: clickId, visit_id: visitId ?? undefined })],
        { type: 'application/json' }
      )
    );
    window.location.href = inviteUrl;
  }, [countdown, inviteUrl, pixelId, clickId, visitId]);

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
