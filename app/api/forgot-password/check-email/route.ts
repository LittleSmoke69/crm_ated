/**
 * POST /api/forgot-password/check-email
 * Verifica se o e-mail existe na tabela profiles (para fluxo esqueci a senha).
 */
import { NextRequest } from 'next/server';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';

    if (!email) {
      return errorResponse('E-mail é obrigatório', 400);
    }

    const { data: profile, error } = await supabaseServiceRole
      .from('profiles')
      .select('id, email')
      .eq('email', email)
      .maybeSingle();

    if (error) {
      return errorResponse('Erro ao consultar e-mail', 500);
    }

    if (!profile) {
      return successResponse({ found: false }, 'E-mail não encontrado');
    }

    const maskedEmail = profile.email
      ? profile.email.replace(/(.{2})(.*)(@.*)/, '$1***$3')
      : '';
    return successResponse({ found: true, maskedEmail }, 'E-mail encontrado');
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}
