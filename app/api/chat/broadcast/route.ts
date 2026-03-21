/**
 * /api/chat/broadcast
 *
 * GET  → lista broadcasts do usuário (últimos 20)
 * POST → cria um novo job de disparo em massa
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export interface BroadcastContact {
  phone: string;
  name?: string;
}

export interface BroadcastMessageConfig {
  type: 'text' | 'audio' | 'video' | 'image' | 'document';
  content?: string;
  attachment_url?: string;
  mimetype?: string;
  caption?: string;
  fileName?: string;
}

export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);

    const { data, error } = await supabaseServiceRole
      .from('chat_broadcasts')
      .select('id, title, instance_name, total_count, current_index, delay_seconds, status, started_at, completed_at, created_at, last_error')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) return errorResponse(error.message, 500);
    return successResponse(data ?? []);
  } catch (err) {
    return serverErrorResponse(err as Error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const body = await req.json() as {
      instance_id: string;
      title?: string;
      message_config: BroadcastMessageConfig;
      contacts: BroadcastContact[];
      delay_seconds?: number;
    };

    const { instance_id, title, message_config, contacts, delay_seconds = 120 } = body;

    if (!instance_id) return errorResponse('instance_id é obrigatório', 400);
    if (!message_config?.type) return errorResponse('message_config.type é obrigatório', 400);
    if (!contacts || contacts.length === 0) return errorResponse('contacts não pode ser vazio', 400);

    const delaySeconds = Math.min(600, Math.max(10, Number(delay_seconds) || 120));

    // Valida instância e acesso
    const { data: instance } = await supabaseServiceRole
      .from('evolution_instances')
      .select('id, instance_name, user_id')
      .eq('id', instance_id)
      .maybeSingle();

    if (!instance) return errorResponse('Instância não encontrada', 404);

    const { data: profile } = await supabaseServiceRole
      .from('profiles')
      .select('status')
      .eq('id', userId)
      .single();

    const isAdmin = profile?.status === 'super_admin' || profile?.status === 'admin' || profile?.status === 'suporte';
    if (!isAdmin && instance.user_id !== userId) {
      return errorResponse('Acesso negado à instância', 403);
    }

    // Filtra contatos com telefone válido
    const validContacts = contacts.filter((c) => {
      const digits = String(c.phone || '').replace(/\D/g, '');
      return digits.length >= 8;
    });

    if (validContacts.length === 0) return errorResponse('Nenhum contato com telefone válido', 400);

    const { data, error } = await supabaseServiceRole
      .from('chat_broadcasts')
      .insert({
        user_id: userId,
        instance_id: instance.id,
        instance_name: instance.instance_name,
        title: title || `Disparo ${new Date().toLocaleString('pt-BR')}`,
        message_config,
        contacts: validContacts,
        total_count: validContacts.length,
        current_index: 0,
        delay_seconds: delaySeconds,
        status: 'pending',
      })
      .select('id, title, instance_name, total_count, delay_seconds, status, created_at')
      .single();

    if (error) return errorResponse(error.message, 500);
    return successResponse(data, 'Disparo criado com sucesso');
  } catch (err) {
    return serverErrorResponse(err as Error);
  }
}
