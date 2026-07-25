/**
 * POST /api/admin/newsletters/send
 * Body: { id: string }
 * Dispara o envio da newsletter em background e responde na hora com o total de destinatários.
 * O progresso fica em email_newsletters (sent_count/failed_count) — a UI acompanha via GET.
 * Apenas admin e super_admin (via requireAdmin).
 */
import { NextRequest } from 'next/server';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { requireAdmin } from '@/lib/middleware/permissions';
import { isMailerConfigured } from '@/lib/services/mailer';
import { resolveNewsletterRecipients, runNewsletterSend } from '@/lib/services/newsletter';

export async function POST(req: NextRequest) {
  try {
    await requireAdmin(req);

    const body = await req.json().catch(() => ({}));
    const id = typeof body.id === 'string' ? body.id.trim() : '';
    if (!id) return errorResponse('id é obrigatório', 400);

    if (!(await isMailerConfigured())) {
      return errorResponse('SMTP não configurado: cadastre uma conta de envio em Admin > E-mails ou configure o .env.', 503);
    }

    const { data: newsletter, error } = await supabaseServiceRole
      .from('email_newsletters')
      .select('id, subject, body, audience, custom_emails, status, smtp_account_ids')
      .eq('id', id)
      .maybeSingle();

    if (error || !newsletter) return errorResponse('Newsletter não encontrada', 404);
    if (newsletter.status === 'sending') {
      return errorResponse('Esta newsletter já está sendo enviada.', 400);
    }
    if (newsletter.status === 'paused') {
      return errorResponse('Esta newsletter está pausada. Use Retomar no histórico de campanhas.', 400);
    }
    if (newsletter.status === 'sent') {
      return errorResponse('Esta newsletter já foi enviada.', 400);
    }

    const recipients = await resolveNewsletterRecipients(newsletter.audience, newsletter.custom_emails);
    if (recipients.length === 0) {
      return errorResponse('Nenhum destinatário encontrado para esse público.', 400);
    }

    const { error: markErr } = await supabaseServiceRole
      .from('email_newsletters')
      .update({ status: 'sending', total_recipients: recipients.length, sent_count: 0, failed_count: 0 })
      .eq('id', id);
    if (markErr) return errorResponse('Erro ao iniciar envio', 500);

    // Envio em background: a resposta volta na hora e a UI acompanha pelo GET
    void runNewsletterSend(newsletter.id, newsletter.subject, newsletter.body, recipients, newsletter.smtp_account_ids ?? null);

    return successResponse(
      { started: true, total_recipients: recipients.length },
      `Envio iniciado para ${recipients.length} destinatário(s)`
    );
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}
