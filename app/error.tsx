'use client';

import { useEffect, useRef } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

const isDomMutationError = (msg: string) =>
  /removeChild|Hydration|not a child of this node|insertBefore|Failed to execute.*on.*Node/i.test(msg);

const isExtensionError = (msg: string) =>
  /translate|notranslate|google.*translate|__NEXT|chrome-extension/i.test(msg);

const MAX_AUTO_RETRIES = 2;

export default function Error({ error, reset }: ErrorProps) {
  const retryCount = useRef(0);

  const message = error?.message ?? '';
  const isBrowserDomError = isDomMutationError(message);
  const isExtRelated = isExtensionError(message);
  const shouldAutoRetry = isBrowserDomError && retryCount.current < MAX_AUTO_RETRIES;

  useEffect(() => {
    console.error('[Zaploto Error Boundary]', error?.message, error?.digest, error);

    if (shouldAutoRetry) {
      retryCount.current += 1;
      const delay = retryCount.current * 500;
      const timer = setTimeout(() => reset(), delay);
      return () => clearTimeout(timer);
    }
  }, [error, reset, shouldAutoRetry]);

  if (shouldAutoRetry) return null;

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
          {isBrowserDomError
            ? 'Houve um problema ao atualizar esta parte da página. Isso pode ser causado por extensões do navegador (como tradutores automáticos). Desative extensões de tradução e recarregue.'
            : 'Ocorreu um erro ao carregar esta parte da página. Você pode tentar novamente.'}
        </p>
        {!isBrowserDomError && !isExtRelated && (
          <p className="text-xs text-muted-foreground font-mono truncate" title={message}>
            {message}
          </p>
        )}
        <button
          type="button"
          onClick={() => (isBrowserDomError ? window.location.reload() : reset())}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--zaploto-green)] text-white hover:opacity-90 transition-opacity"
        >
          <RefreshCw className="w-4 h-4" />
          {isBrowserDomError ? 'Recarregar página' : 'Tentar novamente'}
        </button>
      </div>
    </div>
  );
}
