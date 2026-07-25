import { NextRequest, NextResponse } from 'next/server';
import { isMailerConfigured } from '@/lib/services/mailer';
import { processDueScheduledNewsletters } from '@/lib/services/newsletter';

/**
 * GET/POST /api/internal/cron/send-scheduled-newsletters
 * Dispara as newsletters agendadas cujo horário chegou (status='scheduled', scheduled_at <= agora).
 * Agendado a cada 1 minuto (ver netlify/functions/send-scheduled-newsletters.ts e scripts/linux/scheduled-jobs.ts).
 *
 * Autenticação: Authorization: Bearer <CRON_SECRET> ou ?token=<CRON_SECRET>
 * (CRON_SECRET ou INTERNAL_CRON_SECRET)
 */
async function runNewsletterCron(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET || process.env.INTERNAL_CRON_SECRET;
  const auth = req.headers.get('authorization');
  const token =
    (auth?.startsWith('Bearer ') ? auth.slice(7) : null) ||
    req.nextUrl.searchParams.get('token');
  if (!secret || token !== secret) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  if (!(await isMailerConfigured())) {
    return NextResponse.json({ ok: false, error: 'SMTP não configurado.' }, { status: 503 });
  }

  try {
    const processed = await processDueScheduledNewsletters();
    return NextResponse.json({ ok: true, processed: processed.length, newsletters: processed });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erro';
    console.error('❌ [CRON] send-scheduled-newsletters:', err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return runNewsletterCron(req);
}

export async function POST(req: NextRequest) {
  return runNewsletterCron(req);
}
