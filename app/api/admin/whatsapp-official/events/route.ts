/**
 * GET /api/admin/whatsapp-official/events
 * Lista eventos recebidos no webhook da API oficial (produção), com paginação.
 * Apenas admin/super_admin.
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

const SOURCE = 'whatsapp_official';

export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);

    const { data: profile } = await supabaseServiceRole
      .from('profiles')
      .select('status')
      .eq('id', userId)
      .single();

    const canAccess = profile?.status === 'super_admin' || profile?.status === 'admin';
    if (!canAccess) {
      return errorResponse('Acesso negado. Apenas administradores podem acessar.', 403);
    }

    const { searchParams } = req.nextUrl;
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '25', 10)));

    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const { data: events, error, count } = await supabaseServiceRole
      .from('webhook_events')
      .select('id, source, event_name, raw_payload, created_at', { count: 'exact' })
      .eq('source', SOURCE)
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) {
      console.error('❌ [WHATSAPP OFFICIAL EVENTS] Erro ao buscar eventos:', error);
      return errorResponse('Erro ao buscar eventos', 500);
    }

    const total = count ?? 0;
    const totalPages = Math.ceil(total / limit);

    return successResponse(events || [], {
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    });
  } catch (err: unknown) {
    return serverErrorResponse(err as Error);
  }
}
