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

    console.log('[MATURATION] POST /api/maturation/process-now - Disparando tick em segundo plano');
    runMaturationTick(supabaseServiceRole)
      .then((result) => {
        console.log('[MATURATION] POST /api/maturation/process-now - Tick concluído:', result);
      })
      .catch((err) => {
        console.error('[MATURATION] POST /api/maturation/process-now - Erro no tick:', err);
      });

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
