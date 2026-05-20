/**
 * GET /api/chat/broadcast/conversations
 *
 * Lista todas as conversas (chat_conversations) que foram tocadas pelos disparos
 * em andamento do usuário (status running/pending/paused), atravessando todas as
 * instâncias da rotação — não fica limitado ao canal selecionado.
 *
 * Permite que o chat-atendimento mostre, em tempo real, cada conversa disparada
 * pela campanha já com a instância que efetivamente enviou (chat_conversations.instance_id).
 *
 * Permissão: como o próprio usuário criou o disparo, as instâncias da rotação
 * são por definição autorizadas para ele — não exige checagem extra além de user_id.
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

type RawBroadcastInstance = { id?: string } | null | undefined;
type RawBroadcastContact = { phone?: string } | null | undefined;

function toBrPhoneDigits(rawPhone: string): string {
  const digits = String(rawPhone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (!digits.startsWith('55') && (digits.length === 10 || digits.length === 11)) {
    return `55${digits}`;
  }
  return digits;
}

export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);

    const { data: broadcasts, error: bErr } = await supabaseServiceRole
      .from('chat_broadcasts')
      .select('id, broadcast_instances, instance_id, contacts, status')
      .eq('user_id', userId)
      .in('status', ['running', 'pending', 'paused']);

    if (bErr) return errorResponse(bErr.message, 500);

    const instanceIds = new Set<string>();
    const remoteJids = new Set<string>();
    for (const row of broadcasts ?? []) {
      const rawInstances = row.broadcast_instances as RawBroadcastInstance[] | null | undefined;
      if (Array.isArray(rawInstances)) {
        for (const r of rawInstances) {
          if (r && typeof r.id === 'string' && r.id.trim()) instanceIds.add(r.id);
        }
      } else if (typeof row.instance_id === 'string' && row.instance_id) {
        instanceIds.add(row.instance_id);
      }
      const rawContacts = row.contacts as RawBroadcastContact[] | null | undefined;
      if (Array.isArray(rawContacts)) {
        for (const c of rawContacts) {
          const digits = toBrPhoneDigits(String(c?.phone ?? ''));
          if (digits) remoteJids.add(`${digits}@s.whatsapp.net`);
        }
      }
    }

    if (instanceIds.size === 0 || remoteJids.size === 0) {
      return successResponse([]);
    }

    const { data: conversations, error: cErr } = await supabaseServiceRole
      .from('chat_conversations')
      .select('*')
      .in('instance_id', Array.from(instanceIds))
      .in('remote_jid', Array.from(remoteJids))
      .order('last_message_at', { ascending: false });

    if (cErr) return errorResponse(cErr.message, 500);

    return successResponse(conversations ?? []);
  } catch (err) {
    return serverErrorResponse(err as Error);
  }
}
