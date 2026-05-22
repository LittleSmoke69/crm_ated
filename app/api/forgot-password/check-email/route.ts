/**
 * POST /api/forgot-password/check-email
 * Resposta genérica (não revela se o e-mail existe).
 */
import { NextRequest } from 'next/server';
import { checkIpRateLimit } from '@/lib/server/ip-rate-limit';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

const GENERIC_OK = {
  found: true,
  maskedEmail: null as string | null,
  message: 'Se o e-mail estiver cadastrado, você poderá continuar o fluxo de recuperação.',
};

export async function POST(req: NextRequest) {
  try {
    const rateLimited = checkIpRateLimit(req, 'forgot-check-email', 15, 15 * 60 * 1000);
    if (rateLimited) return errorResponse(rateLimited, 429);

    const body = await req.json().catch(() => ({}));
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';

    if (!email) {
      return errorResponse('E-mail é obrigatório', 400);
    }

    const { data: profile } = await supabaseServiceRole
      .from('profiles')
      .select('id, email')
      .eq('email', email)
      .maybeSingle();

    if (profile?.email) {
      const maskedEmail = profile.email.replace(/(.{2})(.*)(@.*)/, '$1***$3');
      return successResponse({ found: true, maskedEmail }, GENERIC_OK.message);
    }

    return successResponse({ found: true, maskedEmail: null }, GENERIC_OK.message);
  } catch (err: unknown) {
    return serverErrorResponse(err);
  }
}
