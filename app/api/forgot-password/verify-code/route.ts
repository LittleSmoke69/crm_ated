/**
 * POST /api/forgot-password/verify-code
 * Valida o código de 6 dígitos e retorna um reset_token para a próxima etapa.
 */
import { NextRequest } from 'next/server';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { randomUUID } from 'crypto';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const code = typeof body.code === 'string' ? body.code.replace(/\D/g, '').slice(0, 6) : '';

    if (!email) return errorResponse('E-mail é obrigatório', 400);
    if (code.length !== 6) return errorResponse('Código deve ter 6 dígitos', 400);

    const { data: profile } = await supabaseServiceRole
      .from('profiles')
      .select('id')
      .eq('email', email)
      .single();

    if (!profile) {
      return errorResponse('E-mail não encontrado', 404);
    }

    const now = new Date().toISOString();
    const { data: row, error: findErr } = await supabaseServiceRole
      .from('password_reset_codes')
      .select('id, code, expires_at')
      .eq('profile_id', profile.id)
      .gte('expires_at', now)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (findErr || !row) {
      return errorResponse('Código inválido ou expirado', 400);
    }

    if (row.code !== code) {
      return errorResponse('Código incorreto', 400);
    }

    const resetToken = randomUUID();
    const tokenExpiry = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    await supabaseServiceRole
      .from('password_reset_codes')
      .update({ reset_token: resetToken, expires_at: tokenExpiry })
      .eq('id', row.id);

    return successResponse({ reset_token: resetToken }, 'Código válido. Defina sua nova senha.');
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}
