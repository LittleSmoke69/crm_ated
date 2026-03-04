'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams } from 'next/navigation';

const REDIRECT_COUNTDOWN_SECONDS = 3;

export default function ZaplinkRedirectPage() {
  const params = useParams();
  const slug = params?.slug as string;
  const [targetUrl, setTargetUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(REDIRECT_COUNTDOWN_SECONDS);
  const didRedirect = useRef(false);

  // Resolve link em paralelo (não bloqueia o countdown)
  useEffect(() => {
    if (!slug) return;
    const search = typeof window !== 'undefined' ? window.location.search : '';
    fetch(`/api/zaplink/${encodeURIComponent(slug)}/resolve${search}`)
      .then((r) => r.json())
      .then((json) => {
        if (!json.success || !json.data?.target_url) {
          setError(json.error || 'Link não encontrado');
          return;
        }
        setTargetUrl(json.data.target_url);
      })
      .catch(() => setError('Erro ao carregar'));
  }, [slug]);

  // Countdown começa imediatamente (3, 2, 1) — igual à tela de redirect da VSL
  useEffect(() => {
    const t = setInterval(() => {
      setCountdown((c) => (c <= 0 ? 0 : c - 1));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  // Quando o countdown chega a 0: redireciona para a URL configurada
  useEffect(() => {
    if (countdown > 0) return;
    if (didRedirect.current) return;
    if (!targetUrl) return;
    didRedirect.current = true;
    window.location.href = targetUrl;
  }, [countdown, targetUrl]);

  if (error) {
    return (
      <main className="min-h-screen bg-gray-950 text-white flex items-center justify-center p-6">
        <p className="text-red-400">{error}</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center p-6">
      <h1 className="text-xl font-semibold text-center mb-4">
        Redirecionando você...
      </h1>
      <div className="text-4xl font-bold text-green-400 tabular-nums">
        {countdown}
      </div>
    </main>
  );
}
