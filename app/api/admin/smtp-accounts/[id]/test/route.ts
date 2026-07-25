/**
 * POST /api/admin/smtp-accounts/[id]/test
 * Body: { to: string }
 * Envia um e-mail de teste usando ESTA conta específica (não entra na rotação),
 * para validar credenciais e entrega. Conta no limite diário da conta.
 * Apenas admin e super_admin (via requireAdmin).
 */
import { NextRequest } from 'next/server';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { requireAdmin } from '@/lib/middleware/permissions';
import { sendMailWithAccount, type SmtpAccount } from '@/lib/services/mailer';
import { htmlToText, wrapEmailLayout } from '@/lib/services/email-layout';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin(req);
    const { id } = await params;

    const body = await req.json().catch(() => ({}));
    const to = typeof body.to === 'string' ? body.to.trim().toLowerCase() : '';
    if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
      return errorResponse('Informe um e-mail de destino válido', 400);
    }

    const { data: account } = await supabaseServiceRole
      .from('smtp_accounts')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (!account) return errorResponse('Conta SMTP não encontrada', 404);

    const bodyHtml = `<h1 style="font-size:20px;color:#1a1a1a;margin:0 0 12px;">Teste da conta "${account.name}" ✅</h1>
<p style="font-size:14px;color:#6b6258;margin:0;line-height:1.6;">
  Este e-mail foi enviado pela conta SMTP <strong>${account.username}</strong> (${account.host}:${account.port})
  cadastrada no painel admin. Se ele chegou, a conta está pronta para entrar na rotação de disparos.
</p>`;
    const html = wrapEmailLayout(bodyHtml);
    await sendMailWithAccount(
      account as SmtpAccount,
      { to, subject: `[TESTE] Conta de envio ${account.username}`, html, text: htmlToText(bodyHtml) },
      { category: 'test' }
    );

    return successResponse({ sent: true, to }, `E-mail de teste enviado por ${account.username} para ${to}`);
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}
