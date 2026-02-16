/**
 * POST /api/maturation/process-now
 *
 * Dispara o processamento imediato dos steps de maturação (tick).
 * Chamado pelo frontend após Start para processar na hora, sem depender do cron.
 * Em produção (Netlify) chama a função maturation-tick; em dev pode chamar a mesma URL se disponível.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { runMaturationTick } from '@/lib/services/maturation/processor';

export async function POST(req: NextRequest) {
  try {
    await requireAuth(req);

    console.log('[MATURATION] POST /api/maturation/process-now - Iniciando tick de processamento');
    // Executa o processamento imediatamente (uma batelada de até CLAIM_LIMIT steps)
    const result = await runMaturationTick(supabaseServiceRole);
    console.log('[MATURATION] POST /api/maturation/process-now - Resultado:', result);

    return NextResponse.json({
      success: true,
      processed: result.processed,
      jobs: result.jobs || []
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Erro ao processar';
    return NextResponse.json(
      { error: message },
      { status: message === 'Não autenticado' ? 401 : 500 }
    );
  }
}
