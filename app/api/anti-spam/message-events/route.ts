/**
 * GET /api/anti-spam/message-events?config_id=&page=&limit=
 * Lista eventos messages.upsert da(s) instância(s) da config do usuário (produção).
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { extractMessagePreview, extractMessageKey } from '@/lib/anti-spam/evolution-message-extract';
import {
  createAntiSpamGroupLabelResolver,
  subjectFromParticipantsPayload,
} from '@/lib/anti-spam/event-group-label';

export const runtime = 'nodejs';

const EVENT_TYPES = ['messages.upsert', 'MESSAGES_UPSERT'];
const DEFAULT_LIMIT = 15;
const MAX_LIMIT = 50;
const MAX_Q_LEN = 200;

function mapMessageEventsRpcError(error: { message?: string; code?: string }): string | null {
  const msg = (error.message || '').toLowerCase();
  const code = String(error.code || '');
  if (
    code === 'PGRST202' ||
    code === '42883' ||
    msg.includes('anti_spam_message_events_page') ||
    msg.includes('anti_spam_message_events_match_count') ||
    (msg.includes('function') && msg.includes('does not exist'))
  ) {
    return 'Função de pesquisa indisponível. Aplique a migration add_anti_spam_message_events_search_rpc.sql no Supabase.';
  }
  return null;
}

export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const configId = req.nextUrl.searchParams.get('config_id')?.trim();
    const page = Math.max(1, parseInt(req.nextUrl.searchParams.get('page') || '1', 10));
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(req.nextUrl.searchParams.get('limit') || String(DEFAULT_LIMIT), 10)));
    const qRaw = req.nextUrl.searchParams.get('q')?.trim() ?? '';
    const searchSubstring = qRaw.slice(0, MAX_Q_LEN);

    if (!configId) return errorResponse('config_id é obrigatório', 400);

    const { data: config, error: cfgErr } = await supabaseServiceRole
      .from('anti_spam_configs')
      .select('id, master_instance_id, watcher_instance_id')
      .eq('id', configId)
      .eq('owner_type', 'user')
      .eq('owner_id', userId)
      .single();

    if (cfgErr || !config) return errorResponse('Configuração não encontrada', 404);

    const instanceIds = [config.master_instance_id].filter(Boolean);
    if (config.watcher_instance_id) instanceIds.push(config.watcher_instance_id);

    const { data: instances } = await supabaseServiceRole
      .from('evolution_instances')
      .select('instance_name')
      .in('id', instanceIds);

    const instanceNames = (instances || []).map((i: { instance_name: string }) => i.instance_name).filter(Boolean);
    if (instanceNames.length === 0) return successResponse([], { pagination: { total: 0, page, limit } });

    const from = (page - 1) * limit;

    type Row = {
      id: string;
      received_at: string;
      instance_name: string | null;
      remote_jid: string | null;
      payload: unknown;
    };

    let rows: Row[] | null = null;
    let count: number | null = null;

    if (searchSubstring.length > 0) {
      const { data: rpcRows, error: rpcError } = await supabaseServiceRole.rpc('anti_spam_message_events_page', {
        p_instance_names: instanceNames,
        p_search_substring: searchSubstring,
        p_limit: limit,
        p_offset: from,
      });

      if (rpcError) {
        const friendly = mapMessageEventsRpcError(rpcError);
        if (friendly) {
          console.error('[message-events GET rpc]', rpcError);
          return errorResponse(friendly, 503);
        }
        console.error('[message-events GET rpc]', rpcError);
        return errorResponse(rpcError.message, 500);
      }

      const list = (rpcRows || []) as Array<Row & { full_total?: number | string }>;
      if (list.length > 0) {
        count = Number(list[0].full_total ?? 0);
        rows = list.map(({ full_total: _t, ...r }) => r);
      } else {
        const { data: cnt, error: cntErr } = await supabaseServiceRole.rpc('anti_spam_message_events_match_count', {
          p_instance_names: instanceNames,
          p_search_substring: searchSubstring,
        });
        if (cntErr) {
          const friendly = mapMessageEventsRpcError(cntErr);
          if (friendly) {
            console.error('[message-events GET rpc count]', cntErr);
            return errorResponse(friendly, 503);
          }
          console.error('[message-events GET rpc count]', cntErr);
          return errorResponse(cntErr.message, 500);
        }
        count = Number(cnt ?? 0);
        rows = [];
      }
    } else {
      const res = await supabaseServiceRole
        .from('evolution_webhook_events')
        .select('id, received_at, instance_name, remote_jid, payload', { count: 'exact' })
        .in('event_type', EVENT_TYPES)
        .in('instance_name', instanceNames)
        .eq('env', 'prod')
        .order('received_at', { ascending: false })
        .range(from, from + limit - 1);

      if (res.error) return errorResponse(res.error.message, 500);
      rows = res.data as Row[] | null;
      count = res.count ?? 0;
    }

    const baseItems = (rows || []).map((r: Row) => {
      const payload = r.payload || {};
      const key = extractMessageKey(payload);
      const preview = extractMessagePreview(payload);
      return {
        id: r.id,
        received_at: r.received_at,
        instance_name: r.instance_name,
        remote_jid: key?.remoteJid ?? r.remote_jid ?? null,
        message_id: key?.id ?? null,
        from_me: key?.fromMe ?? false,
        participant: key?.participant || null,
        preview: preview.slice(0, 400),
        _payload: payload,
      };
    });

    const groupJids = [
      ...new Set(
        baseItems.map((i) => i.remote_jid).filter((j): j is string => typeof j === 'string' && j.endsWith('@g.us'))
      ),
    ];

    const resolveGroupLabel = await createAntiSpamGroupLabelResolver(supabaseServiceRole, {
      configId,
      groupIds: groupJids,
      userId,
    });

    const items = baseItems.map(({ _payload, ...rest }) => {
      const jid = rest.remote_jid;
      let group_name: string | null = null;
      if (jid && jid.endsWith('@g.us')) {
        group_name =
          resolveGroupLabel(jid, rest.instance_name || '') ?? subjectFromParticipantsPayload(_payload);
      }
      return { ...rest, group_name };
    });

    return successResponse(items, {
      pagination: {
        total: count ?? 0,
        page,
        limit,
        totalPages: Math.ceil((count ?? 0) / limit) || 1,
      },
    });
  } catch (err: any) {
    return errorResponse(err.message || 'Não autorizado', 401);
  }
}
