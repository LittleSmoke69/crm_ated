/**
 * GET /api/admin/whatsapp-official-configs - Lista configs (apenas admin/super_admin)
 * POST /api/admin/whatsapp-official-configs - Cria config
 * access_token nunca é retornado; apenas access_token_masked (últimos 4 caracteres).
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

    const { data: rows, error } = await supabaseServiceRole
      .from('whatsapp_official_configs')
      .select('id, zaploto_id, name, is_active, phone_number_id, waba_id, graph_version, verify_token, webhook_secret, created_at, updated_at')
      .order('created_at', { ascending: false });

    if (error) {
      return errorResponse(`Erro ao listar: ${error.message}`);
    }

    const list = (rows || []).map((r: Record<string, unknown>) => ({
      ...r,
      access_token_masked: '****',
    }));

    return successResponse(list);
  } catch (err: unknown) {
    return serverErrorResponse(err as Error);
  }
}

export async function POST(req: NextRequest) {
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

    if (!phone_number_id || !waba_id || !access_token || !verify_token) {
      return errorResponse('phone_number_id, waba_id, access_token e verify_token são obrigatórios', 400);
    }

    const insert: Record<string, unknown> = {
      name: name ?? 'WhatsApp Oficial',
      is_active: is_active !== false,
      phone_number_id: String(phone_number_id).trim(),
      waba_id: String(waba_id).trim(),
      graph_version: String(graph_version || 'v25.0').trim(),
      access_token: String(access_token).trim(),
      verify_token: String(verify_token).trim(),
      webhook_secret: webhook_secret ? String(webhook_secret).trim() : null,
      zaploto_id: zaploto_id || null,
    };

    const { data, error } = await supabaseServiceRole
      .from('whatsapp_official_configs')
      .insert(insert)
      .select()
      .single();

    if (error) {
      return errorResponse(`Erro ao criar: ${error.message}`);
    }

    const out = { ...data, access_token_masked: maskToken(data.access_token), access_token: undefined };
    return successResponse(out, 'Configuração criada com sucesso');
  } catch (err: unknown) {
    return serverErrorResponse(err as Error);
  }
}
