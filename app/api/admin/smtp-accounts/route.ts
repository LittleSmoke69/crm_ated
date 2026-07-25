/**
 * GET/POST /api/admin/smtp-accounts
 * GET  - lista as contas SMTP cadastradas (sem a senha) com o uso do dia.
 * POST - cadastra uma conta nova. A conexão é verificada (login SMTP) antes de salvar.
 * Body POST: { name?, host?, port?, username, password, from_name?, from_email?, daily_limit?, is_active? }
 * Apenas admin e super_admin (via requireAdmin).
 */
import { NextRequest } from 'next/server';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { requireAdmin } from '@/lib/middleware/permissions';
import { verifySmtpConnection } from '@/lib/services/mailer';
import { SMTP_PUBLIC_COLUMNS, toPublicSmtpAccount } from '@/lib/services/smtp-accounts';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function missingTableResponse(message: string) {
  if (message.includes('smtp_accounts')) {
    return errorResponse('Tabela smtp_accounts não existe. Rode a migration create_smtp_accounts.sql no Supabase.', 503);
  }
  return null;
}

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);

    const { data, error } = await supabaseServiceRole
      .from('smtp_accounts')
      .select(SMTP_PUBLIC_COLUMNS)
      .order('created_at', { ascending: true });
    if (error) {
      return missingTableResponse(error.message || '') || errorResponse('Erro ao listar contas SMTP', 500);
    }

    return successResponse({
      accounts: (data || []).map(toPublicSmtpAccount),
      env_configured: Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS),
      env_user: process.env.SMTP_USER || null,
    });
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin(req);

    const body = await req.json().catch(() => ({}));
    const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const host = (typeof body.host === 'string' && body.host.trim()) || 'smtp.hostinger.com';
    const port = Number(body.port) || 465;
    const fromEmail = (typeof body.from_email === 'string' && body.from_email.trim().toLowerCase()) || username;
    const fromName = typeof body.from_name === 'string' ? body.from_name.trim() : '';
    const name = (typeof body.name === 'string' && body.name.trim()) || username;
    const dailyLimit = Math.max(1, Number(body.daily_limit) || 1000);
    const isActive = body.is_active === undefined ? true : Boolean(body.is_active);

    if (!EMAIL_RE.test(username)) return errorResponse('Informe o usuário SMTP (e-mail da caixa) válido', 400);
    if (!password) return errorResponse('Informe a senha da caixa de e-mail', 400);
    if (!EMAIL_RE.test(fromEmail)) return errorResponse('Remetente (from) inválido', 400);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return errorResponse('Porta inválida', 400);

    const check = await verifySmtpConnection({ host, port, username, password });
    if (!check.ok) {
      return errorResponse(`Falha ao conectar no SMTP com essas credenciais: ${check.error}`, 400);
    }

    const { data, error } = await supabaseServiceRole
      .from('smtp_accounts')
      .insert({
        name,
        host,
        port,
        username,
        password,
        from_name: fromName || null,
        from_email: fromEmail,
        daily_limit: dailyLimit,
        is_active: isActive,
      })
      .select(SMTP_PUBLIC_COLUMNS)
      .single();
    if (error) {
      return missingTableResponse(error.message || '') || errorResponse('Erro ao salvar conta SMTP', 500);
    }

    return successResponse(toPublicSmtpAccount(data), `Conta "${name}" conectada e salva`);
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}
