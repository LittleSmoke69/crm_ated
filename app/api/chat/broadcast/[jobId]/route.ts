/**
 * /api/chat/broadcast/[jobId]
 *
 * GET   → detalhes do broadcast
 * PATCH → atualiza status (pause, resume, cancel)
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { userId } = await requireAuth(req);
    const { jobId } = await params;

    const { data, error } = await supabaseServiceRole
      .from('chat_broadcasts')
      .select('*')
      .eq('id', jobId)
      .eq('user_id', userId)
      .single();

    if (error || !data) return errorResponse('Broadcast não encontrado', 404);
    return successResponse(data);
  } catch (err) {
    return serverErrorResponse(err as Error);
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { userId } = await requireAuth(req);
    const { jobId } = await params;
    const body = await req.json() as { status: 'running' | 'paused' | 'cancelled' };

    const allowed = ['running', 'paused', 'cancelled'];
    if (!allowed.includes(body.status)) {
      return errorResponse('Status inválido. Use: running, paused, cancelled', 400);
    }

    const { data: current } = await supabaseServiceRole
      .from('chat_broadcasts')
      .select('id, status')
      .eq('id', jobId)
      .eq('user_id', userId)
      .single();

    if (!current) return errorResponse('Broadcast não encontrado', 404);
    if (current.status === 'completed' || current.status === 'cancelled') {
      return errorResponse(`Não é possível alterar um broadcast ${current.status}`, 400);
    }

    const updates: Record<string, unknown> = {
      status: body.status,
      updated_at: new Date().toISOString(),
    };

    if (body.status === 'running' && current.status === 'pending') {
      updates.started_at = new Date().toISOString();
    }

    const { data, error } = await supabaseServiceRole
      .from('chat_broadcasts')
      .update(updates)
      .eq('id', jobId)
      .select('id, status, current_index, total_count')
      .single();

    if (error) return errorResponse(error.message, 500);
    return successResponse(data, `Broadcast ${body.status}`);
  } catch (err) {
    return serverErrorResponse(err as Error);
  }
}
