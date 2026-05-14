/**
 * POST /api/maturation/cron-tick
 *
 * Processa um lote de steps de maturação pendentes.
 * Chamado pela Netlify Scheduled Function `maturation-tick` a cada 1 minuto.
 * Também chamado por process-now para disparo imediato via frontend.
 *
 * Autenticação: x-internal-cron-secret (mesma secret usada por outros crons do projeto)
 *
 * Self-chaining para planos longos:
 * Se o tick termina com hasMorePending=true (saiu por limite de tempo, não por falta de steps),
 * ele encadeia automaticamente outro tick em segundo plano (fire-and-forget).
 * O header `x-chain-depth` controla a profundidade máxima (padrão: 0, limite: 4).
 * Isso permite que planos com muitos steps sejam processados sem esperar o próximo cron de 1 min.
 */

import { NextRequest, NextResponse, after } from 'next/server';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { runMaturationTick, runGroupMessaging } from '@/lib/services/maturation/processor';

/**
 * O tick pode levar dezenas de segundos; proxies (504 Inactivity Timeout) cortam se não houver resposta.
 * Modo assíncrono (padrão): responde na hora e executa `runMaturationTick` em `after()`.
 * Modo síncrono: env `MATURATION_CRON_TICK_SYNC=1` ou header `x-maturation-tick-mode: sync`.
 */
export const maxDuration = 120;

/** Profundidade máxima de encadeamento de ticks para não criar loop infinito */
const MAX_CHAIN_DEPTH = 4;

const MATURATION_VERBOSE_LOGS = process.env.MATURATION_VERBOSE_LOGS === 'true';

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET não configurado' }, { status: 500 });
  }

  const provided = req.headers.get('x-internal-cron-secret');
  if (provided !== cronSecret) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  // Profundidade atual de encadeamento (0 = tick original do cron/process-now)
  const chainDepth = parseInt(req.headers.get('x-chain-depth') || '0', 10);
  const origin = req.nextUrl?.origin || new URL(req.url).origin || 'http://localhost:3000';

  const syncMode =
    process.env.MATURATION_CRON_TICK_SYNC === '1' ||
    req.headers.get('x-maturation-tick-mode') === 'sync';

  const runTickAndMaybeChain = async () => {
    // Roda group messaging em paralelo ao tick — independente, sem bloquear o tick
    runGroupMessaging(supabaseServiceRole).catch((e) =>
      console.error('[cron-tick] group-messaging erro:', e instanceof Error ? e.message : e)
    );
    const result = await runMaturationTick(supabaseServiceRole);
    if (result.hasMorePending && chainDepth < MAX_CHAIN_DEPTH) {
      const nextDepth = chainDepth + 1;
      const nextTickUrl = `${origin}/api/maturation/cron-tick`;
      if (MATURATION_VERBOSE_LOGS) {
        console.log(`[cron-tick] hasMorePending=true, encadeando tick (depth=${nextDepth}/${MAX_CHAIN_DEPTH})`);
      }
      fetch(nextTickUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-cron-secret': cronSecret,
          'x-chain-depth': String(nextDepth),
        },
      }).catch((err) => {
        console.warn(`[cron-tick] Falha ao encadear tick depth=${nextDepth}:`, err?.message);
      });
    } else if (result.hasMorePending && MATURATION_VERBOSE_LOGS) {
      console.log(
        `[cron-tick] hasMorePending=true mas chain depth=${chainDepth} atingiu limite (${MAX_CHAIN_DEPTH}). Próximo cron de 1min processará o restante.`
      );
    }
    return result;
  };

  try {
    if (syncMode) {
      const result = await runTickAndMaybeChain();
      return NextResponse.json({
        success: true,
        mode: 'sync',
        processed: result.processed,
        virginCount: result.virginCount ?? 0,
        jobs: result.jobs ?? [],
        hasMorePending: result.hasMorePending ?? false,
        chainDepth,
      });
    }

    after(async () => {
      try {
        await runTickAndMaybeChain();
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Erro inesperado';
        console.error('[cron-tick] after() erro:', message);
      }
    });

    return NextResponse.json({
      success: true,
      queued: true,
      message: 'Tick agendado em segundo plano (evita 504 por inatividade no proxy).',
      chainDepth,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Erro inesperado';
    console.error('[cron-tick] Erro:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
