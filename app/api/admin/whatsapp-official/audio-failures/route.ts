import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

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

    const page = Math.max(1, parseInt(req.nextUrl.searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(req.nextUrl.searchParams.get('limit') || '25', 10)));
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const { data: rows, error, count } = await supabaseServiceRole
      .from('chat_messages')
      .select(
        'id, conversation_id, whatsapp_config_id, message_id, sender_jid, media_type, status, text, caption, created_at, timestamp',
        { count: 'exact' }
      )
      .eq('provider', 'whatsapp_official')
      .eq('media_type', 'audio')
      .eq('status', 'failed')
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) return errorResponse(`Erro ao listar falhas de áudio: ${error.message}`, 500);

    const list = rows ?? [];
    const cfgIds = [...new Set(list.map((r: { whatsapp_config_id: string | null }) => r.whatsapp_config_id).filter(Boolean))] as string[];
    const convIds = [...new Set(list.map((r: { conversation_id: string | null }) => r.conversation_id).filter(Boolean))] as string[];

    let cfgs: Array<{ id: string; name: string; phone_number_id: string }> = [];
    let convs: Array<{ id: string; title: string; remote_jid: string }> = [];
    if (cfgIds.length > 0) {
      const { data } = await supabaseServiceRole
        .from('whatsapp_official_configs')
        .select('id, name, phone_number_id')
        .in('id', cfgIds);
      cfgs = data ?? [];
    }
    if (convIds.length > 0) {
      const { data } = await supabaseServiceRole
        .from('chat_conversations')
        .select('id, title, remote_jid')
        .in('id', convIds);
      convs = data ?? [];
    }
    const cfgById = Object.fromEntries(cfgs.map((c) => [c.id, c]));
    const convById = Object.fromEntries(convs.map((c) => [c.id, c]));

    const out = list.map((r: {
      id: string;
      conversation_id: string | null;
      whatsapp_config_id: string | null;
      message_id: string;
      sender_jid: string | null;
      status: string;
      text: string | null;
      caption: string | null;
      created_at: string;
      timestamp: number | null;
    }) => ({
      ...r,
      config_name: r.whatsapp_config_id ? (cfgById[r.whatsapp_config_id]?.name ?? null) : null,
      config_phone_number_id: r.whatsapp_config_id ? (cfgById[r.whatsapp_config_id]?.phone_number_id ?? null) : null,
      conversation_title: r.conversation_id ? (convById[r.conversation_id]?.title ?? null) : null,
      conversation_remote_jid: r.conversation_id ? (convById[r.conversation_id]?.remote_jid ?? null) : null,
    }));

    const total = count ?? 0;
    return successResponse(out, {
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (err) {
    return serverErrorResponse(err as Error);
  }
}

