'use client';

import { useEffect } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/**
 * Captura erros no segmento (página/rota) e exibe fallback em vez de tela branca.
 * Reduz "exceção no lado do cliente" ao aplicar filtros, carregar página ou outras ações.
 */
export default function Error({ error, reset }: ErrorProps) {
  useEffect(() => {
    console.error('[Zaploto Error Boundary]', error?.message, error?.digest, error);
  }, [error]);

  return (
    <div className="min-h-[40vh] flex items-center justify-center p-6 bg-background">
      <div className="max-w-md w-full text-center space-y-4">
        <div className="flex justify-center">
          <div className="rounded-full bg-red-100 dark:bg-red-900/30 p-4">
            <AlertCircle className="w-10 h-10 text-red-600 dark:text-red-400" />
          </div>
        </div>
        <h2 className="text-lg font-semibold text-foreground">
          Algo deu errado
        </h2>
        <p className="text-sm text-muted-foreground">
          Ocorreu um erro ao carregar esta parte da página. Você pode tentar novamente.
        </p>
        <p className="text-xs text-muted-foreground font-mono truncate" title={error?.message}>
          {error?.message}
        </p>
        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--zaploto-green)] text-white hover:opacity-90 transition-opacity"
        >
          <RefreshCw className="w-4 h-4" />
          Tentar novamente
        </button>
      </div>
    </div>
  );
}
