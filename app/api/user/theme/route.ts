import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { successResponse, errorResponse } from '@/lib/utils/response';
import { z } from 'zod';

const schema = z.object({
  theme: z.enum(['light', 'dark']),
});

/**
 * PUT /api/user/theme - Atualiza a preferência de tema do usuário
 */
export async function PUT(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return errorResponse('Body inválido', 400);
    }

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return errorResponse('theme deve ser "light" ou "dark"', 400);
    }

    const { theme } = parsed.data;

    const { error } = await supabaseServiceRole
      .from('profiles')
      .update({ theme_preference: theme })
      .eq('id', userId);

    if (error) {
      console.error('[theme] Erro ao atualizar:', error.message);
      return errorResponse('Erro ao salvar preferência', 500);
    }

    return successResponse({ theme });
  } catch (err: unknown) {
    const e = err as { message?: string };
    return errorResponse(e?.message || 'Não autenticado', 401);
  }
}
