/**
 * GET /api/anti-spam/groups?config_id=...
 * Lista grupos monitorados (anti_spam_groups) da config do usuário.
 * POST /api/anti-spam/groups - Adiciona grupo. DELETE - Remove.
 * Config deve ser owner_type=user, owner_id=userId.
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export const runtime = 'nodejs';

async function ensureUserConfig(configId: string, userId: string): Promise<boolean> {
  const { data } = await supabaseServiceRole
    .from('anti_spam_configs')
    .select('id')
    .eq('id', configId)
    .eq('owner_type', 'user')
    .eq('owner_id', userId)
    .single();
  return !!data;
}

export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const configId = req.nextUrl.searchParams.get('config_id')?.trim();
    if (!configId) return errorResponse('config_id é obrigatório', 400);

    const ok = await ensureUserConfig(configId, userId);
    if (!ok) return errorResponse('Configuração não encontrada', 404);

    const { data, error } = await supabaseServiceRole
      .from('anti_spam_groups')
      .select('id, config_id, group_jid, group_name, is_monitored')
      .eq('config_id', configId)
      .order('group_name', { ascending: true });

    if (error) return errorResponse(error.message, 500);
    return successResponse(data ?? []);
  } catch (err: any) {
    return errorResponse(err.message || 'Não autorizado', 401);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const body = await req.json();
    const { config_id, group_jid, group_name } = body;
    if (!config_id || !group_jid) {
      return errorResponse('config_id e group_jid são obrigatórios', 400);
    }

    const ok = await ensureUserConfig(config_id, userId);
    if (!ok) return errorResponse('Configuração não encontrada', 404);

    const { data, error } = await supabaseServiceRole
      .from('anti_spam_groups')
      .upsert(
        {
          config_id,
          group_jid: String(group_jid).trim(),
          group_name: group_name?.trim() || null,
          is_monitored: true,
        },
        { onConflict: 'config_id,group_jid', ignoreDuplicates: false }
      )
      .select()
      .single();

    if (error) return errorResponse(error.message, 500);
    return successResponse(data, 'Grupo adicionado');
  } catch (err: any) {
    return errorResponse(err.message || 'Não autorizado', 401);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const configId = req.nextUrl.searchParams.get('config_id')?.trim();
    const groupJid = req.nextUrl.searchParams.get('group_jid')?.trim();
    if (!configId || !groupJid) {
      return errorResponse('config_id e group_jid são obrigatórios', 400);
    }

    const ok = await ensureUserConfig(configId, userId);
    if (!ok) return errorResponse('Configuração não encontrada', 404);

    const { error } = await supabaseServiceRole
      .from('anti_spam_groups')
      .delete()
      .eq('config_id', configId)
      .eq('group_jid', groupJid);

    if (error) return errorResponse(error.message, 500);
    return successResponse(null, 'Grupo removido');
  } catch (err: any) {
    return errorResponse(err.message || 'Não autorizado', 401);
  }
}
