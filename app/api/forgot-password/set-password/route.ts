/**
 * POST /api/forgot-password/set-password
 * Define nova senha usando reset_token e retorna dados para logar o usuário.
 */
import { NextRequest } from 'next/server';
import { checkIpRateLimit } from '@/lib/server/ip-rate-limit';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import bcrypt from 'bcryptjs';

export async function POST(req: NextRequest) {
  try {
    const rateLimited = checkIpRateLimit(req, 'forgot-set-password', 10, 15 * 60 * 1000);
    if (rateLimited) return errorResponse(rateLimited, 429);

    const body = await req.json().catch(() => ({}));
    const resetToken = typeof body.reset_token === 'string' ? body.reset_token.trim() : '';
    const newPassword = typeof body.new_password === 'string' ? body.new_password : '';

    if (!resetToken) return errorResponse('Token de redefinição é obrigatório', 400);
    if (!newPassword || newPassword.length < 8) {
      return errorResponse('A senha deve ter no mínimo 8 caracteres', 400);
    }

    const now = new Date().toISOString();
    const { data: row, error: findErr } = await supabaseServiceRole
      .from('password_reset_codes')
      .select('id, profile_id')
      .eq('reset_token', resetToken)
      .gte('expires_at', now)
      .maybeSingle();

    if (findErr || !row) {
      return errorResponse('Link expirado ou inválido. Refça o processo de recuperação.', 400);
    }

    const passwordHash = bcrypt.hashSync(newPassword, 10);

    const { data: profile, error: updateErr } = await supabaseServiceRole
      .from('profiles')
      .update({
        password_hash: passwordHash,
        updated_at: now,
      })
      .eq('id', row.profile_id)
      .select('id, email')
      .single();

    if (updateErr || !profile) {
      return errorResponse('Erro ao atualizar senha', 500);
    }

    await supabaseServiceRole
      .from('password_reset_codes')
      .delete()
      .eq('id', row.id);

    return successResponse(
      { user_id: profile.id, email: profile.email },
      'Senha alterada com sucesso. Redirecionando...'
    );
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}
