'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams } from 'next/navigation';

const REDIRECT_COUNTDOWN_SECONDS = 3;

export default function RedirectPage() {
  const params = useParams();
  const slug = params?.slug as string;
  const [data, setData] = useState<{
    invite_url: string;
    timer_seconds: number;
    logo_url: string | null;
    project_name: string;
    click_id: string;
    pixel_id: string | null;
    visit_id: string | null;
  } | null>(null);
  const [countdown, setCountdown] = useState<number>(REDIRECT_COUNTDOWN_SECONDS);
  const [error, setError] = useState<string | null>(null);
  const [sid, setSid] = useState<string | null>(null);
  const didRedirect = useRef(false);
  const visitIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    const search = typeof window !== 'undefined' ? window.location.search : '';
    const s = new URLSearchParams(search).get('sid');
    if (s) setSid(s);
  }, [slug]);

  // Resolve redirect em paralelo (não bloqueia o countdown); envia UTM da URL para salvar
  useEffect(() => {
    if (!slug) return;
    const search = typeof window !== 'undefined' ? window.location.search : '';
    const params = new URLSearchParams(search);
    const sidParam = sid ? `sid=${encodeURIComponent(sid)}` : '';
    const utmParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']
      .filter((key) => params.get(key)?.trim())
      .map((key) => `${key}=${encodeURIComponent(params.get(key)!.trim())}`)
      .join('&');
    const query = [sidParam, utmParams].filter(Boolean).join('&');
    const url = `/api/redirect/${encodeURIComponent(slug)}/resolve${query ? `?${query}` : ''}`;
    fetch(url)
      .then((r) => r.json())
      .then((json) => {
        if (!json.success || !json.data) {
          setError(json.error || 'Redirect não encontrado');
          return;
        }
        setData(json.data);
        visitIdRef.current = json.data?.visit_id ?? null;
      })
      .catch(() => setError('Erro ao carregar'));
  }, [slug, sid]);

  // Ao sair sem concluir o redirect: marca visit como Incomplete e dispara evento no pixel
  useEffect(() => {
    const handleLeave = () => {
      if (didRedirect.current) return;
      const vid = visitIdRef.current;
      if (!vid) return;

      if (typeof window !== 'undefined' && (window as unknown as { fbq?: (...args: unknown[]) => void }).fbq) {
        (window as unknown as { fbq: (...args: unknown[]) => void }).fbq('trackCustom', 'RedirectIncomplete');
      }

      navigator.sendBeacon(
        '/api/redirect/visit-incomplete',
        new Blob([JSON.stringify({ visit_id: vid })], { type: 'application/json' })
      );
    };

    window.addEventListener('pagehide', handleLeave);
    return () => window.removeEventListener('pagehide', handleLeave);
  }, []);

  // Pixel Facebook no <head> da página /r/[slug] (rastreio PageView)
  useEffect(() => {
    const pixelId = data?.pixel_id;
    if (!pixelId || typeof document === 'undefined') return;
    const escapedId = pixelId.replace(/'/g, "\\'");
    // Script do pixel (padrão Meta: init + PageView)
    const script = document.createElement('script');
    script.innerHTML = `
      !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};
      if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
      t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script',
      'https://connect.facebook.net/en_US/fbevents.js');
      fbq('init', '${escapedId}');
      fbq('track', 'PageView');
    `;
    document.head.appendChild(script);
    // Fallback noscript (recomendado pelo Facebook quando JS está desabilitado)
    const noscript = document.createElement('noscript');
    const img = document.createElement('img');
    img.height = 1;
    img.width = 1;
    img.style.display = 'none';
    img.src = `https://www.facebook.com/tr?id=${encodeURIComponent(pixelId)}&ev=PageView&noscript=1`;
    noscript.appendChild(img);
    document.head.appendChild(noscript);
    return () => {
      try {
        if (script.parentNode) script.parentNode.removeChild(script);
        if (noscript.parentNode) noscript.parentNode.removeChild(noscript);
      } catch {
        // ignore
      }
    };
  }, [data?.pixel_id]);

  // Countdown começa imediatamente ao abrir a página (3, 2, 1) — não espera a API
  useEffect(() => {
    const t = setInterval(() => {
      setCountdown((c) => (c <= 0 ? 0 : c - 1));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  // Quando o countdown chega a 0: marca complete, dispara Lead no pixel (BM) e redireciona
  useEffect(() => {
    if (countdown > 0) return;
    if (didRedirect.current) return;
    if (!data?.invite_url) return;
    didRedirect.current = true;

    const pixelId = data.pixel_id;
    if (pixelId && typeof window !== 'undefined' && (window as unknown as { fbq?: (...args: unknown[]) => void }).fbq) {
      (window as unknown as { fbq: (...args: unknown[]) => void }).fbq('track', 'Lead');
    }

    fetch('/api/redirect/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ click_id: data.click_id, sid, visit_id: data.visit_id ?? undefined }),
    }).catch(() => {});

    window.location.href = data.invite_url;
  }, [countdown, data, sid]);

  if (error) {
    return (
      <main className="min-h-screen bg-gray-950 text-white flex items-center justify-center p-6">
        <p className="text-red-400">{error}</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center p-6">
      {data?.logo_url && (
        <img
          src={data.logo_url}
          alt={data.project_name}
          className="max-w-[200px] max-h-24 object-contain mb-8"
        />
      )}
      <h1 className="text-xl font-semibold text-center mb-4">
        Enviando você para o grupo de WhatsApp...
      </h1>
      <div className="text-4xl font-bold text-green-400 tabular-nums">
        {countdown}
      </div>
    </main>
  );
}
