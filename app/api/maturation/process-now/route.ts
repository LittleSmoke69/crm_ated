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
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { runMaturationTick } from '@/lib/services/maturation/processor';

const MATURATION_VERBOSE_LOGS = process.env.MATURATION_VERBOSE_LOGS === 'true';

export async function POST(req: NextRequest) {
  try {
    await requireAuth(req);

    const siteUrl = process.env.URL || process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL;
    const cronSecret = process.env.CRON_SECRET;

    if (siteUrl && cronSecret) {
      // Produção: dispara a Netlify function via HTTP sem aguardar resposta
      const tickUrl = `${siteUrl.replace(/\/$/, '')}/.netlify/functions/maturation-tick`;
      if (MATURATION_VERBOSE_LOGS) console.log('[MATURATION] process-now → chamando Netlify function:', tickUrl);
      fetch(tickUrl).catch((e) => {
        console.error('[MATURATION] process-now: falha ao chamar maturation-tick:', e);
      });
    } else if (cronSecret) {
      // Dev: chama cron-tick na mesma origem (loga se 401/500)
      const baseUrl = req.nextUrl.origin;
      const tickUrl = `${baseUrl}/api/maturation/cron-tick`;
      if (MATURATION_VERBOSE_LOGS) console.log('[MATURATION] process-now (dev) → chamando cron-tick:', tickUrl);
      fetch(tickUrl, {
        method: 'POST',
        headers: { 'x-internal-cron-secret': cronSecret },
      })
        .then(async (r) => {
          if (!r.ok) {
            const t = await r.text().catch(() => '');
            console.error('[MATURATION] process-now: cron-tick HTTP', r.status, t?.slice(0, 500));
          }
        })
        .catch((e) => {
          console.error('[MATURATION] process-now: falha de rede no cron-tick:', e);
        });
    } else {
      /**
       * Sem CRON_SECRET (comum em .env local): executa o tick no mesmo processo.
       * Caso contrário nenhuma mensagem do maturador seria enviada após Start.
       */
      console.warn('[MATURATION] process-now: CRON_SECRET ausente — executando runMaturationTick inline (dev).');
      const result = await runMaturationTick(supabaseServiceRole);
      return NextResponse.json(
        {
          success: true,
          processing: true,
          inline: true,
          message: 'Tick executado inline (configure CRON_SECRET para usar cron-tick em segundo plano).',
          processed: result.processed,
          hasMorePending: result.hasMorePending ?? false,
        },
        { status: 200 }
      );
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
