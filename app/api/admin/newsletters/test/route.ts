/**
 * POST /api/admin/newsletters/test
 * Body: { subject: string, body: string, to?: string }
 * Com `to`: envia um e-mail de teste da newsletter. Sem `to`: retorna o preview renderizado.
 * Apenas admin e super_admin (via requireAdmin).
 */
import { NextRequest } from 'next/server';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { requireAdmin } from '@/lib/middleware/permissions';
import { sendMail, isMailerConfigured } from '@/lib/services/mailer';
import { renderNewsletter } from '@/lib/services/newsletter';

export async function POST(req: NextRequest) {
  try {
    await requireAdmin(req);

    const body = await req.json().catch(() => ({}));
    const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
    const html = typeof body.body === 'string' ? body.body.trim() : '';
    const to = typeof body.to === 'string' ? body.to.trim().toLowerCase() : '';

    if (!subject) return errorResponse('Assunto é obrigatório', 400);
    if (!html) return errorResponse('Corpo é obrigatório', 400);

    // Sem destino: só renderiza o preview com dados de exemplo
    if (!to) {
      const preview = renderNewsletter(subject, html, { email: 'usuario@exemplo.com', name: 'Usuário de Teste' });
      return successResponse({ preview_subject: preview.subject, preview_html: preview.html });
    }

    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
      return errorResponse('Informe um e-mail de destino válido', 400);
    }
    if (!(await isMailerConfigured())) {
      return errorResponse('SMTP não configurado: cadastre uma conta de envio em Admin > E-mails ou configure o .env.', 503);
    }

    const rendered = renderNewsletter(subject, html, { email: to, name: 'Usuário de Teste' });
    await sendMail({ to, subject: `[TESTE] ${rendered.subject}`, html: rendered.html, text: rendered.text }, { templateKey: 'newsletter', category: 'test' });

    return successResponse({ sent: true, to }, `E-mail de teste enviado para ${to}`);
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}
