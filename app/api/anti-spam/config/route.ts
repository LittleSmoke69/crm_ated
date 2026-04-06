/**
 * GET /api/anti-spam/config - Lista config do usuário logado
 * POST /api/anti-spam/config - Cria/atualiza config do usuário
 * Qualquer usuário autenticado.
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);

    const { data, error } = await supabaseServiceRole
      .from('anti_spam_configs')
      .select('*')
      .eq('owner_type', 'user')
      .eq('owner_id', userId)
      .order('created_at', { ascending: false });

    if (error) return errorResponse(error.message, 500);
    const configs = data ?? [];
    return successResponse(configs.length ? [configs[0]] : []);
  } catch (err: any) {
    return errorResponse(err.message || 'Não autorizado', 401);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const body = await req.json();
    const {
      id,
      is_enabled,
      master_instance_id,
      watcher_instance_id,
      denuncia_group_jid,
      scan_mode,
      suspicious_messages_enabled,
    } = body;

    if (!master_instance_id) {
      return errorResponse('Escolha a instância que vai remover números dos grupos', 400);
    }

    const payload: Record<string, unknown> = {
      owner_type: 'user',
      owner_id: userId,
      banca_id: null,
      is_enabled: is_enabled ?? true,
      master_instance_id,
      watcher_instance_id: watcher_instance_id || null,
      denuncia_group_jid: denuncia_group_jid || '',
      scan_mode: scan_mode === 'selected_groups' ? 'selected_groups' : 'all_groups',
      suspicious_messages_enabled: !!suspicious_messages_enabled,
    };

    if (id) {
      const { data: existing } = await supabaseServiceRole
        .from('anti_spam_configs')
        .select('id')
        .eq('id', id)
        .eq('owner_type', 'user')
        .eq('owner_id', userId)
        .single();

      if (!existing) return errorResponse('Configuração não encontrada', 404);

      const { data, error } = await supabaseServiceRole
        .from('anti_spam_configs')
        .update(payload)
        .eq('id', id)
        .select()
        .single();
      if (error) return errorResponse(error.message, 500);
      return successResponse(data, 'Configuração atualizada');
    }

    const { data, error } = await supabaseServiceRole
      .from('anti_spam_configs')
      .insert(payload)
      .select()
      .single();
    if (error) return errorResponse(error.message, 500);
    return successResponse(data, 'Configuração criada');
  } catch (err: any) {
    return errorResponse(err.message || 'Não autorizado', 401);
  }
}
