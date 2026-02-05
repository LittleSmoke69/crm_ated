import { NextRequest } from 'next/server';
import { requireSuperAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * GET /api/admin/webhooks/evolution/test-waiters/[id]
 * Retorna status de um waiter e, se recebido, o evento completo
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireSuperAdmin(req);
    const { id } = await params;

    // Busca waiter
    const { data: waiter, error } = await supabaseServiceRole
      .from('evolution_webhook_test_waiters')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !waiter) {
      return errorResponse('Waiter não encontrado', 404);
    }

    // Verifica se expirou
    const now = new Date();
    const expiresAt = new Date(waiter.expires_at);
    if (waiter.status === 'waiting' && expiresAt < now) {
      // Atualiza status para expired
      await supabaseServiceRole
        .from('evolution_webhook_test_waiters')
        .update({ status: 'expired' })
        .eq('id', id);

      return successResponse({
        id: waiter.id,
        status: 'expired',
        created_at: waiter.created_at,
        expires_at: waiter.expires_at,
      });
    }

    // Se recebido, busca o evento completo
    let event = null;
    if (waiter.status === 'received' && waiter.received_event_id) {
      const { data: eventData } = await supabaseServiceRole
        .from('evolution_webhook_events')
        .select('*')
        .eq('id', waiter.received_event_id)
        .single();

      event = eventData;
    }

    return successResponse({
      id: waiter.id,
      status: waiter.status,
      created_at: waiter.created_at,
      expires_at: waiter.expires_at,
      received_at: waiter.received_at,
      event: event ? {
        id: event.id,
        received_at: event.received_at,
        event_type: event.event_type,
        instance_name: event.instance_name,
        remote_jid: event.remote_jid,
        message_id: event.message_id,
        payload: event.payload,
      } : null,
    });
  } catch (err: any) {
    return errorResponse(err.message || 'Erro ao buscar waiter', 401);
  }
}

