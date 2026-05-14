/**
 * POST /api/maturation/process-now
 *
 * Processamento imediato após Start no Maturador: executa {@link runMaturationTick}
 * no mesmo processo Node (Evolution API + espera entre steps já embutida no tick),
 * encadeando ticks até não haver mais pendências ou atingir limite de tempo/iterações.
 *
 * Opcional: `MATURATION_PROCESS_NOW_DELEGATE=1` restaura o fluxo antigo (Netlify ou
 * cron-tick em segundo plano), útil apenas se você mantiver esse agendamento externo.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { runMaturationTick, runGroupMessaging } from '@/lib/services/maturation/processor';

export const maxDuration = 300;

const MATURATION_VERBOSE_LOGS = process.env.MATURATION_VERBOSE_LOGS === 'true';

/** Quando true, não roda ticks inline; usa Netlify ou cron-tick em background (legado). */
const DELEGATE = process.env.MATURATION_PROCESS_NOW_DELEGATE === '1';

const MAX_WALL_MS = Math.min(
  Math.max(30_000, parseInt(process.env.MATURATION_PROCESS_NOW_MAX_MS || '240000', 10)),
  290_000
);
const MAX_ITERATIONS = Math.min(
  40,
  Math.max(1, parseInt(process.env.MATURATION_PROCESS_NOW_MAX_ITERATIONS || '12', 10))
);

export async function POST(req: NextRequest) {
  try {
    await requireAuth(req);

    const siteUrl = process.env.URL || process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL;
    const cronSecret = process.env.CRON_SECRET;

    if (DELEGATE && siteUrl && cronSecret) {
      const tickUrl = `${siteUrl.replace(/\/$/, '')}/.netlify/functions/maturation-tick`;
      if (MATURATION_VERBOSE_LOGS) console.log('[MATURATION] process-now (delegate) →', tickUrl);
      fetch(tickUrl).catch((e) => {
        console.error('[MATURATION] process-now: falha ao chamar maturation-tick:', e);
      });
      return NextResponse.json(
        { success: true, processing: true, mode: 'delegate_netlify', message: 'Tick disparado em segundo plano.' },
        { status: 202 }
      );
    }

    if (DELEGATE && cronSecret) {
      const baseUrl = req.nextUrl?.origin || new URL(req.url).origin;
      const tickUrl = `${baseUrl}/api/maturation/cron-tick`;
      if (MATURATION_VERBOSE_LOGS) console.log('[MATURATION] process-now (delegate) →', tickUrl);
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
      return NextResponse.json(
        { success: true, processing: true, mode: 'delegate_cron', message: 'Tick agendado em segundo plano.' },
        { status: 202 }
      );
    }

    // Dispara group messaging em paralelo sem bloquear o loop de ticks
    runGroupMessaging(supabaseServiceRole).catch((e) =>
      console.error('[process-now] group-messaging erro:', e instanceof Error ? e.message : e)
    );

    const deadline = Date.now() + MAX_WALL_MS;
    let totalProcessed = 0;
    let iterations = 0;
    let hasMorePending = true;
    const allTouchedJobs = new Set<string>();

    while (hasMorePending && iterations < MAX_ITERATIONS && Date.now() < deadline) {
      const result = await runMaturationTick(supabaseServiceRole);
      totalProcessed += Number(result.processed ?? 0);
      hasMorePending = result.hasMorePending === true;
      iterations += 1;
      for (const jid of result.jobs || []) {
        if (typeof jid === 'string') allTouchedJobs.add(jid);
      }
      if (!hasMorePending) break;
    }

    return NextResponse.json({
      success: true,
      mode: 'inline',
      processed: totalProcessed,
      iterations,
      hasMorePending,
      jobsTouched: Array.from(allTouchedJobs),
      message:
        'Ticks executados no servidor (Evolution + intervalos do plano entre mensagens). Se ainda houver pendências, o cron ou um novo Start/process-now continua o restante.',
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Erro ao processar';
    return NextResponse.json(
      { error: message },
      { status: message === 'Não autenticado' ? 401 : 500 }
    );
  }
}
