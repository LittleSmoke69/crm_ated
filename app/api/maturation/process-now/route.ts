/**
 * POST /api/maturation/process-now
 *
 * Dispara o processamento imediato dos steps de maturação.
 * Chamado pelo frontend após iniciar um job para processar na hora.
 *
 * Em produção (Netlify): chama /.netlify/functions/maturation-tick via HTTP (fire-and-forget)
 * Em dev: chama /api/maturation/cron-tick diretamente com CRON_SECRET
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';

export async function POST(req: NextRequest) {
  try {
    await requireAuth(req);

    const siteUrl = process.env.URL || process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL;
    const cronSecret = process.env.CRON_SECRET;

    if (siteUrl && cronSecret) {
      // Produção: dispara a Netlify function via HTTP sem aguardar resposta
      const tickUrl = `${siteUrl.replace(/\/$/, '')}/.netlify/functions/maturation-tick`;
      console.log('[MATURATION] process-now → chamando Netlify function:', tickUrl);
      fetch(tickUrl).catch(() => { /* fire-and-forget intencional */ });
    } else if (cronSecret) {
      // Dev local: chama a rota cron-tick diretamente sem aguardar
      const baseUrl = req.nextUrl.origin;
      const tickUrl = `${baseUrl}/api/maturation/cron-tick`;
      console.log('[MATURATION] process-now (dev) → chamando cron-tick:', tickUrl);
      fetch(tickUrl, {
        method: 'POST',
        headers: { 'x-internal-cron-secret': cronSecret },
      }).catch(() => { /* fire-and-forget intencional */ });
    } else {
      console.warn('[MATURATION] process-now: CRON_SECRET não configurado, tick não disparado');
    }

    return NextResponse.json(
      { success: true, processing: true, message: 'Processamento em andamento em segundo plano.' },
      { status: 202 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Erro ao processar';
    return NextResponse.json(
      { error: message },
      { status: message === 'Não autenticado' ? 401 : 500 }
    );
  }
}
