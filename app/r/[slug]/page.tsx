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
  } | null>(null);
  const [countdown, setCountdown] = useState<number>(REDIRECT_COUNTDOWN_SECONDS);
  const [error, setError] = useState<string | null>(null);
  const [sid, setSid] = useState<string | null>(null);
  const didRedirect = useRef(false);

  useEffect(() => {
    if (!slug) return;
    const search = typeof window !== 'undefined' ? window.location.search : '';
    const s = new URLSearchParams(search).get('sid');
    if (s) setSid(s);
  }, [slug]);

  // Resolve redirect em paralelo (não bloqueia o countdown)
  useEffect(() => {
    if (!slug) return;
    fetch(`/api/redirect/${encodeURIComponent(slug)}/resolve${sid ? `?sid=${encodeURIComponent(sid)}` : ''}`)
      .then((r) => r.json())
      .then((json) => {
        if (!json.success || !json.data) {
          setError(json.error || 'Redirect não encontrado');
          return;
        }
        setData(json.data);
      })
      .catch(() => setError('Erro ao carregar'));
  }, [slug, sid]);

  // Countdown começa imediatamente ao abrir a página (3, 2, 1) — não espera a API
  useEffect(() => {
    const t = setInterval(() => {
      setCountdown((c) => (c <= 0 ? 0 : c - 1));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  // Quando o countdown chega a 0: redireciona assim que tiver data (ou quando a API responder)
  useEffect(() => {
    if (countdown > 0) return;
    if (didRedirect.current) return;
    if (!data?.invite_url) return;
    didRedirect.current = true;
    fetch('/api/redirect/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ click_id: data.click_id, sid }),
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
