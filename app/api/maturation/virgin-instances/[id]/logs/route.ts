/**
 * API Route: /api/maturation/virgin-instances/[id]/logs
 *
 * GET: Logs de maturação virgem da instância (admin)
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await requireAuth(req);
    const { id: instanceId } = await params;

    const { data: profile } = await supabaseServiceRole
      .from('profiles')
      .select('status')
      .eq('id', userId)
      .single();

    if (profile?.status !== 'admin') {
      return errorResponse('Acesso negado. Apenas administradores.', 403);
    }

    const { data: logs, error } = await supabaseServiceRole
      .from('virgin_maturation_logs')
      .select('id, event_type, message, payload_json, created_at')
      .eq('evolution_instance_id', instanceId)
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) {
      return errorResponse(`Erro ao buscar logs: ${error.message}`, 500);
    }

    return successResponse({ logs: logs || [] });
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}
