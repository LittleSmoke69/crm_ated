/**
 * GET /api/admin/whatsapp-official-configs/[id] - Obtém uma config (token mascarado)
 * PATCH /api/admin/whatsapp-official-configs/[id] - Atualiza (access_token só se enviado e não placeholder)
 * DELETE /api/admin/whatsapp-official-configs/[id] - Remove config
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

function maskToken(token: string | null | undefined): string {
  if (!token || typeof token !== 'string') return '****';
  const t = token.trim();
  if (t.length <= 4) return '****';
  return '****' + t.slice(-4);
}

function isPlaceholderToken(value: string): boolean {
  const v = (value || '').trim();
  return v === '' || v === '****' || /^\*+$/.test(v);
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await requireAuth(req);
    const { id } = await params;

    const { data: profile } = await supabaseServiceRole
      .from('profiles')
      .select('status')
      .eq('id', userId)
      .single();

    const canAccess = profile?.status === 'super_admin' || profile?.status === 'admin';
    if (!canAccess) {
      return errorResponse('Acesso negado.', 403);
    }

    const { data, error } = await supabaseServiceRole
      .from('whatsapp_official_configs')
      .select('id, zaploto_id, name, is_active, phone_number_id, waba_id, graph_version, verify_token, webhook_secret, created_at, updated_at')
      .eq('id', id)
      .single();

    if (error || !data) {
      return errorResponse('Configuração não encontrada', 404);
    }

    return successResponse({
      ...data,
      access_token_masked: '****',
    });
  } catch (err: unknown) {
    return serverErrorResponse(err as Error);
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await requireAuth(req);
    const { id } = await params;

    const { data: profile } = await supabaseServiceRole
      .from('profiles')
      .select('status')
      .eq('id', userId)
      .single();

    const canAccess = profile?.status === 'super_admin' || profile?.status === 'admin';
    if (!canAccess) {
      return errorResponse('Acesso negado.', 403);
    }

    const body = await req.json().catch(() => ({}));
    const {
      name,
      is_active,
      phone_number_id,
      waba_id,
      graph_version,
      access_token,
      verify_token,
      webhook_secret,
      zaploto_id,
    } = body;

    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (name !== undefined) updateData.name = name;
    if (is_active !== undefined) updateData.is_active = is_active;
    if (phone_number_id !== undefined) updateData.phone_number_id = String(phone_number_id).trim();
    if (waba_id !== undefined) updateData.waba_id = String(waba_id).trim();
    if (graph_version !== undefined) updateData.graph_version = String(graph_version || 'v25.0').trim();
    if (verify_token !== undefined) updateData.verify_token = String(verify_token).trim();
    if (webhook_secret !== undefined) updateData.webhook_secret = webhook_secret ? String(webhook_secret).trim() : null;
    if (zaploto_id !== undefined) updateData.zaploto_id = zaploto_id || null;

    if (access_token !== undefined && !isPlaceholderToken(access_token)) {
      updateData.access_token = String(access_token).trim();
    }

    const { data, error } = await supabaseServiceRole
      .from('whatsapp_official_configs')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return errorResponse(`Erro ao atualizar: ${error.message}`);
    }
    if (!data) {
      return errorResponse('Configuração não encontrada', 404);
    }

    const out = { ...data, access_token_masked: maskToken(data.access_token), access_token: undefined };
    return successResponse(out, 'Configuração atualizada com sucesso');
  } catch (err: unknown) {
    return serverErrorResponse(err as Error);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await requireAuth(req);
    const { id } = await params;

    const { data: profile } = await supabaseServiceRole
      .from('profiles')
      .select('status')
      .eq('id', userId)
      .single();

    const canAccess = profile?.status === 'super_admin' || profile?.status === 'admin';
    if (!canAccess) {
      return errorResponse('Acesso negado.', 403);
    }

    const { error } = await supabaseServiceRole
      .from('whatsapp_official_configs')
      .delete()
      .eq('id', id);

    if (error) {
      return errorResponse(`Erro ao deletar: ${error.message}`);
    }

    return successResponse(null, 'Configuração removida com sucesso');
  } catch (err: unknown) {
    return serverErrorResponse(err as Error);
  }
}
