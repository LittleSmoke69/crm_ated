/**
 * POST /api/admin/newsletters/schedule
 * Body: { id: string, scheduled_at: string | null }
 * Com scheduled_at (ISO, no futuro): agenda o disparo (status 'scheduled', processado pelo cron).
 * Com scheduled_at = null: cancela o agendamento (volta para rascunho).
 * Apenas admin e super_admin (via requireAdmin).
 */
import { NextRequest } from 'next/server';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { requireAdmin } from '@/lib/middleware/permissions';
import { isMailerConfigured } from '@/lib/services/mailer';

export async function POST(req: NextRequest) {
  try {
    await requireAdmin(req);

    const body = await req.json().catch(() => ({}));
    const id = typeof body.id === 'string' ? body.id.trim() : '';
    if (!id) return errorResponse('id é obrigatório', 400);

    const { data: newsletter } = await supabaseServiceRole
      .from('email_newsletters')
      .select('id, status')
      .eq('id', id)
      .maybeSingle();
    if (!newsletter) return errorResponse('Newsletter não encontrada', 404);

    // Cancelar agendamento → volta para rascunho
    if (body.scheduled_at === null) {
      if (newsletter.status !== 'scheduled') {
        return errorResponse('Esta campanha não está agendada.', 400);
      }
      const { error } = await supabaseServiceRole
        .from('email_newsletters')
        .update({ status: 'draft', scheduled_at: null })
        .eq('id', id)
        .eq('status', 'scheduled');
      if (error) return errorResponse('Erro ao cancelar agendamento', 500);
      return successResponse({ id, status: 'draft' }, 'Agendamento cancelado');
    }

    // Agendar
    if (newsletter.status !== 'draft' && newsletter.status !== 'scheduled') {
      return errorResponse('Só é possível agendar rascunhos.', 400);
    }
    if (!(await isMailerConfigured())) {
      return errorResponse('SMTP não configurado: cadastre uma conta de envio em Admin > E-mails ou configure o .env.', 503);
    }

    const scheduledAt = typeof body.scheduled_at === 'string' ? new Date(body.scheduled_at) : null;
    if (!scheduledAt || isNaN(scheduledAt.getTime())) {
      return errorResponse('scheduled_at inválido (use data/hora válida)', 400);
    }
    if (scheduledAt.getTime() < Date.now() - 60 * 1000) {
      return errorResponse('O horário do agendamento precisa ser no futuro.', 400);
    }

    const { error } = await supabaseServiceRole
      .from('email_newsletters')
      .update({ status: 'scheduled', scheduled_at: scheduledAt.toISOString() })
      .eq('id', id);
    if (error) return errorResponse('Erro ao agendar', 500);

    return successResponse(
      { id, status: 'scheduled', scheduled_at: scheduledAt.toISOString() },
      `Campanha agendada para ${scheduledAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`
    );
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}
