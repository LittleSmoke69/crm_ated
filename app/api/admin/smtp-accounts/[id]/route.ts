/**
 * PATCH/DELETE /api/admin/smtp-accounts/[id]
 * PATCH  - edita a conta. Senha em branco mantém a atual; se host/porta/usuário/senha
 *          mudarem, a conexão é verificada de novo antes de salvar.
 * DELETE - remove a conta (os envios já feitos ficam no histórico com smtp_account_id nulo).
 * Apenas admin e super_admin (via requireAdmin).
 */
import { NextRequest } from 'next/server';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { requireAdmin } from '@/lib/middleware/permissions';
import { verifySmtpConnection } from '@/lib/services/mailer';
import { SMTP_PUBLIC_COLUMNS, toPublicSmtpAccount } from '@/lib/services/smtp-accounts';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin(req);
    const { id } = await params;

    const { data: current } = await supabaseServiceRole
      .from('smtp_accounts')
      .select('id, host, port, username, password')
      .eq('id', id)
      .maybeSingle();
    if (!current) return errorResponse('Conta SMTP não encontrada', 404);

    const body = await req.json().catch(() => ({}));
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim();
    if (typeof body.host === 'string' && body.host.trim()) patch.host = body.host.trim();
    if (body.port !== undefined) {
      const port = Number(body.port);
      if (!Number.isInteger(port) || port < 1 || port > 65535) return errorResponse('Porta inválida', 400);
      patch.port = port;
    }
    if (typeof body.username === 'string' && body.username.trim()) {
      const username = body.username.trim().toLowerCase();
      if (!EMAIL_RE.test(username)) return errorResponse('Usuário SMTP inválido', 400);
      patch.username = username;
    }
    if (typeof body.password === 'string' && body.password) patch.password = body.password;
    if (typeof body.from_name === 'string') patch.from_name = body.from_name.trim() || null;
    if (typeof body.from_email === 'string' && body.from_email.trim()) {
      const fromEmail = body.from_email.trim().toLowerCase();
      if (!EMAIL_RE.test(fromEmail)) return errorResponse('Remetente (from) inválido', 400);
      patch.from_email = fromEmail;
    }
    if (body.daily_limit !== undefined) {
      const limit = Number(body.daily_limit);
      if (!Number.isInteger(limit) || limit < 1) return errorResponse('Limite diário inválido', 400);
      patch.daily_limit = limit;
    }
    if (body.is_active !== undefined) patch.is_active = Boolean(body.is_active);

    const credsChanged = ['host', 'port', 'username', 'password'].some(k => k in patch);
    if (credsChanged) {
      const check = await verifySmtpConnection({
        host: (patch.host as string) ?? current.host,
        port: (patch.port as number) ?? current.port,
        username: (patch.username as string) ?? current.username,
        password: (patch.password as string) ?? current.password,
      });
      if (!check.ok) {
        return errorResponse(`Falha ao conectar no SMTP com essas credenciais: ${check.error}`, 400);
      }
      patch.last_error = null;
    }

    const { data, error } = await supabaseServiceRole
      .from('smtp_accounts')
      .update(patch)
      .eq('id', id)
      .select(SMTP_PUBLIC_COLUMNS)
      .single();
    if (error) return errorResponse('Erro ao salvar conta SMTP', 500);

    return successResponse(toPublicSmtpAccount(data), 'Conta atualizada');
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin(req);
    const { id } = await params;

    const { error } = await supabaseServiceRole.from('smtp_accounts').delete().eq('id', id);
    if (error) return errorResponse('Erro ao excluir conta SMTP', 500);

    return successResponse({ id }, 'Conta excluída');
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}
