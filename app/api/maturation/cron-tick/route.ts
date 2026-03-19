/**
 * POST /api/maturation/cron-tick
 *
 * Processa um lote de steps de maturação pendentes.
 * Chamado pela Netlify Scheduled Function `maturation-tick` a cada 1 minuto.
 * Também chamado por process-now para disparo imediato via frontend.
 *
 * Autenticação: x-internal-cron-secret (mesma secret usada por outros crons do projeto)
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { runMaturationTick } from '@/lib/services/maturation/processor';

export const maxDuration = 25; // segundos — limite seguro abaixo do corte do Netlify

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET não configurado' }, { status: 500 });
  }

  const provided = req.headers.get('x-internal-cron-secret');
  if (provided !== cronSecret) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  try {
    const result = await runMaturationTick(supabaseServiceRole);
    return NextResponse.json({
      success: true,
      processed: result.processed,
      virginCount: result.virginCount ?? 0,
      jobs: result.jobs ?? [],
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Erro inesperado';
    console.error('[cron-tick] Erro:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
