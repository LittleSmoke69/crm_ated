/**
 * PATCH /api/admin/newsletters/[id]
 * body: { action: 'pause' | 'resume' | 'retry' }
 * - pause: pausa campanha em envio
 * - resume: retoma campanha pausada (continua de onde parou)
 * - retry: reenvia campanha com falha (ou só os destinatários que falharam)
 * Apenas admin e super_admin (via requireAdmin).
 */
import { NextRequest } from 'next/server';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { requireAdmin } from '@/lib/middleware/permissions';
import { resolveNewsletterRecipients, runNewsletterSend } from '@/lib/services/newsletter';
import { isMailerConfigured } from '@/lib/services/mailer';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin(req);

    const { id: rawId } = await params;
    const id = typeof rawId === 'string' ? rawId.trim() : '';
    if (!id) return errorResponse('ID da campanha é obrigatório', 400);

    const body = await req.json().catch(() => ({}));
    const action = body?.action;
    if (action !== 'pause' && action !== 'resume' && action !== 'retry') {
      return errorResponse('action deve ser "pause", "resume" ou "retry"', 400);
    }

    const { data: newsletter, error } = await supabaseServiceRole
      .from('email_newsletters')
      .select('id, subject, body, audience, custom_emails, status, smtp_account_ids, sent_count, failed_count, total_recipients')
      .eq('id', id)
      .maybeSingle();

    if (error || !newsletter) return errorResponse('Newsletter não encontrada', 404);

    if (action === 'pause') {
      if (newsletter.status !== 'sending') {
        return errorResponse('Só é possível pausar campanhas em envio.', 400);
      }
      const { error: upErr } = await supabaseServiceRole
        .from('email_newsletters')
        .update({ status: 'paused' })
        .eq('id', id)
        .eq('status', 'sending');
      if (upErr) return errorResponse('Erro ao pausar campanha', 500);
      return successResponse({ status: 'paused' }, 'Campanha pausada. O envio para no próximo destinatário.');
    }

    if (!(await isMailerConfigured())) {
      return errorResponse('SMTP não configurado: cadastre uma conta de envio ou configure o .env.', 503);
    }

    // resume: só pausadas | retry: falhou OU enviada com falhas parciais
    if (action === 'resume') {
      if (newsletter.status !== 'paused') {
        return errorResponse('Só é possível retomar campanhas pausadas.', 400);
      }
    } else {
      const canRetryFailed = newsletter.status === 'failed';
      const canRetryPartial =
        newsletter.status === 'sent' && Number(newsletter.failed_count || 0) > 0;
      if (!canRetryFailed && !canRetryPartial) {
        return errorResponse(
          'Só é possível repetir campanhas com status Falhou ou Enviada com falhas.',
          400
        );
      }
    }

    const fromStatus = newsletter.status;
    const { data: claimed, error: claimErr } = await supabaseServiceRole
      .from('email_newsletters')
      .update({
        status: 'sending',
        scheduled_at: null,
        // Mantém contadores: runNewsletterSend recalcula a partir de email_logs (não reenvia sucesso).
      })
      .eq('id', id)
      .eq('status', fromStatus)
      .select('id, subject, body, audience, custom_emails, smtp_account_ids')
      .maybeSingle();

    if (claimErr) {
      return errorResponse(action === 'resume' ? 'Erro ao retomar campanha' : 'Erro ao repetir campanha', 500);
    }
    if (!claimed) {
      return errorResponse(
        action === 'resume'
          ? 'Campanha já foi retomada ou não está mais pausada.'
          : 'Campanha já foi reprocessada ou mudou de status.',
        409
      );
    }

    const recipients = await resolveNewsletterRecipients(claimed.audience, claimed.custom_emails);
    if (recipients.length === 0) {
      await supabaseServiceRole
        .from('email_newsletters')
        .update({ status: 'failed', sent_at: new Date().toISOString() })
        .eq('id', id);
      return errorResponse('Nenhum destinatário encontrado para o envio.', 400);
    }

    await supabaseServiceRole
      .from('email_newsletters')
      .update({ total_recipients: recipients.length })
      .eq('id', id);

    void runNewsletterSend(claimed.id, claimed.subject, claimed.body, recipients, claimed.smtp_account_ids ?? null);

    return successResponse(
      { status: 'sending', total_recipients: recipients.length },
      action === 'resume'
        ? 'Envio retomado — continua de onde parou.'
        : 'Campanha reiniciada — reenvia apenas quem ainda não recebeu com sucesso.'
    );
  } catch (err: unknown) {
    return serverErrorResponse(err);
  }
}
