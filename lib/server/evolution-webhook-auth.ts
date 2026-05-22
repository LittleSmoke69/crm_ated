import type { NextRequest } from 'next/server';

const HEADER = 'x-zaploto-token';

function readExpectedSecret(env: 'prod' | 'test'): string | null {
  if (env === 'prod') {
    return (
      process.env.EVOLUTION_WEBHOOK_SECRET_PROD?.trim() ||
      process.env.EVOLUTION_WEBHOOK_TOKEN?.trim() ||
      null
    );
  }
  return (
    process.env.EVOLUTION_WEBHOOK_SECRET_TEST?.trim() ||
    process.env.EVOLUTION_WEBHOOK_TOKEN?.trim() ||
    null
  );
}

function allowMissingSecret(): boolean {
  return (
    process.env.EVOLUTION_WEBHOOK_ALLOW_NO_TOKEN === 'true' &&
    process.env.NODE_ENV !== 'production'
  );
}

/**
 * Valida header x-zaploto-token dos webhooks Evolution.
 * Em produção exige secret configurado; em dev pode liberar com EVOLUTION_WEBHOOK_ALLOW_NO_TOKEN=true.
 */
export function assertEvolutionWebhookAuthorized(
  req: NextRequest,
  env: 'prod' | 'test'
): Response | null {
  const expected = readExpectedSecret(env);
  if (!expected) {
    if (allowMissingSecret()) return null;
    console.error(`[WEBHOOK ${env.toUpperCase()}] Secret não configurado (EVOLUTION_WEBHOOK_SECRET_${env.toUpperCase()})`);
    return new Response(JSON.stringify({ ok: false, error: 'Webhook não configurado' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const provided =
    req.headers.get(HEADER)?.trim() ||
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() ||
    '';

  if (!provided || provided !== expected) {
    return new Response(JSON.stringify({ ok: false, error: 'Não autorizado' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return null;
}
