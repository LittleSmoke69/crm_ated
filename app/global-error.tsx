'use client';

import { useEffect } from 'react';

/**
 * Captura exceções não tratadas em toda a aplicação (incluindo root layout).
 * Quando dispara, substitui o layout raiz — por isso inclui <html> e <body>.
 * Reduz a tela branca "exceção no lado do cliente ao carregar zaploto.com".
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[Zaploto Global Error]', error?.message, error?.digest, error);
  }, [error]);

  return (
    <html lang="pt-BR">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: '#f9fafb', color: '#171717' }}>
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
            boxSizing: 'border-box',
          }}
        >
          <div style={{ maxWidth: 420, width: '100%', textAlign: 'center' }}>
            <div
              style={{
                width: 56,
                height: 56,
                margin: '0 auto 16px',
                borderRadius: '50%',
                background: 'rgba(239, 68, 68, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 28,
              }}
            >
              ⚠️
            </div>
            <h1 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>
              Erro na aplicação
            </h1>
            <p style={{ fontSize: 14, color: '#6b7280', marginBottom: 16 }}>
              Ocorreu uma exceção no lado do cliente. Tente recarregar a página ou voltar depois.
            </p>
            <p style={{ fontSize: 12, color: '#9ca3af', fontFamily: 'monospace', wordBreak: 'break-all', marginBottom: 24 }}>
              {error?.message}
            </p>
            <button
              type="button"
              onClick={reset}
              style={{
                padding: '10px 20px',
                borderRadius: 8,
                border: 'none',
                background: '#8CD955',
                color: '#171717',
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Tentar novamente
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
