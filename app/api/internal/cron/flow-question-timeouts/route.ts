import { NextRequest, NextResponse } from 'next/server';
import { flowExecutorService } from '@/lib/services/flow-executor-service';

/**
 * GET/POST /api/internal/cron/flow-question-timeouts
 * Processa pendências do nó "Pergunta" com tempo esgotado.
 *
 * Autenticação: Authorization: Bearer <CRON_SECRET> ou ?token=<CRON_SECRET>
 * (CRON_SECRET ou INTERNAL_CRON_SECRET)
 *
 * Intervalo recomendado: **a cada 1 segundo** para disparar "Tempo esgotado" no segundo certo.
 * - Netlify Scheduled Functions: no máximo ~1/minuto (ver netlify.toml + função wrapper).
 * - Para 1s: use `FLOW_QUESTION_POLL_ENABLED` + `instrumentation.ts` (processo único) ou cron externo (curl a cada 1s).
 */
async function runFlowQuestionTimeoutsCron(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET || process.env.INTERNAL_CRON_SECRET;
  const auth = req.headers.get('authorization');
  const token =
    (auth?.startsWith('Bearer ') ? auth.slice(7) : null) ||
    req.nextUrl.searchParams.get('token');
  if (!secret || token !== secret) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const processed = await flowExecutorService.processExpiredQuestionPendings();
    return NextResponse.json({ ok: true, processed });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Erro';
    console.error('❌ [CRON] flow-question-timeouts:', e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return runFlowQuestionTimeoutsCron(req);
}

export async function POST(req: NextRequest) {
  return runFlowQuestionTimeoutsCron(req);
}
