/**
 * GET /api/admin/chat-tags — Lista etiquetas (admin/super_admin)
 * POST /api/admin/chat-tags — Cria etiqueta (admin/super_admin)
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);

    const { data: profile } = await supabaseServiceRole
      .from('profiles')
      .select('status, zaploto_id')
      .eq('id', userId)
      .single();

    const isAdmin = profile?.status === 'admin' || profile?.status === 'super_admin';
    if (!isAdmin) return errorResponse('Acesso negado.', 403);

    let query = supabaseServiceRole
      .from('chat_conversation_tags')
      .select('id, zaploto_id, name, color, sort_order, created_at')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });

    if (profile?.status === 'admin' && profile?.zaploto_id) {
      query = query.or(`zaploto_id.eq.${profile.zaploto_id},zaploto_id.is.null`);
    }

    const { data: tags, error } = await query;

    if (error) {
      console.error('[admin/chat-tags] GET', error.message);
      return errorResponse(`Erro ao listar etiquetas: ${error.message}`, 500);
    }

    return successResponse(tags || []);
  } catch (err: unknown) {
    return serverErrorResponse(err as Error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);

    const { data: profile } = await supabaseServiceRole
      .from('profiles')
      .select('status, zaploto_id')
      .eq('id', userId)
      .single();

    const isAdmin = profile?.status === 'admin' || profile?.status === 'super_admin';
    if (!isAdmin) return errorResponse('Acesso negado.', 403);

    const body = await req.json().catch(() => ({})) as { name?: string; color?: string; sort_order?: number; zaploto_id?: string | null };
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return errorResponse('name é obrigatório.', 400);

    const zaplotoId = profile?.status === 'super_admin' && body.zaploto_id !== undefined
      ? (body.zaploto_id as string | null) || null
      : (profile?.zaploto_id ?? null);

    const { data: tag, error } = await supabaseServiceRole
      .from('chat_conversation_tags')
      .insert({
        zaploto_id: zaplotoId || null,
        name,
        color: typeof body.color === 'string' ? body.color.trim() || null : null,
        sort_order: typeof body.sort_order === 'number' ? body.sort_order : 0,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') return errorResponse('Já existe uma etiqueta com esse nome.', 409);
      console.error('[admin/chat-tags] POST', error.message);
      return errorResponse(`Erro ao criar etiqueta: ${error.message}`, 500);
    }

    return successResponse(tag);
  } catch (err: unknown) {
    return serverErrorResponse(err as Error);
  }
}
