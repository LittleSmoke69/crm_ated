import { NextRequest } from 'next/server';
import { requireSuperAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * POST /api/admin/webhooks/evolution/test-waiters
 * Cria um waiter para aguardar evento de teste (estilo n8n)
 * 
 * Retorna: { id: string }
 */
export async function POST(req: NextRequest) {
  try {
    await requireSuperAdmin(req);

    // Cria waiter com expiração de 2 minutos
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 2);

    const { data: waiter, error } = await supabaseServiceRole
      .from('evolution_webhook_test_waiters')
      .insert({
        status: 'waiting',
        expires_at: expiresAt.toISOString(),
        env: 'test',
      })
      .select('id')
      .single();

    if (error || !waiter) {
      console.error('❌ [TEST WAITERS] Erro ao criar waiter:', error);
      return errorResponse('Erro ao criar waiter', 500);
    }

    return successResponse({ id: waiter.id });
  } catch (err: any) {
    return errorResponse(err.message || 'Erro ao criar waiter', 401);
  }
}

