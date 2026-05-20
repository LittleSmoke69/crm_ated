/**
 * GET /api/chat/broadcast/active
 *
 * Lista disparos em massa do usuário em estados ativos (running, pending, paused).
 * Devolve telefones dos contatos do disparo (normalizados) e a rotação de instâncias,
 * para que o chat-atendimento possa:
 *   - priorizar conversas com disparo ativo no topo da lista;
 *   - marcar balões de mensagens enviados pela rotação como parte do disparo.
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

type RawBroadcastInstance = { id?: string; name?: string } | null | undefined;
type RawBroadcastContact = { phone?: string; name?: string } | null | undefined;

/** Reduz o telefone aos dígitos no padrão BR (prefixa 55 quando 10/11 dígitos). */
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

    const { data, error } = await supabaseServiceRole
      .from('chat_broadcasts')
      .select(
        'id, title, instance_id, instance_name, broadcast_instances, contacts, status, started_at, created_at'
      )
      .eq('user_id', userId)
      .in('status', ['running', 'pending', 'paused'])
      .order('created_at', { ascending: false });

    if (error) return errorResponse(error.message, 500);

    const rows = (data ?? []).map((row: Record<string, unknown>) => {
      const rawInstances = row.broadcast_instances as RawBroadcastInstance[] | null | undefined;
      const instances: { id: string; name: string }[] = [];
      if (Array.isArray(rawInstances)) {
        for (const r of rawInstances) {
          if (r && typeof r.id === 'string' && r.id.trim()) {
            instances.push({ id: r.id, name: (r.name && String(r.name).trim()) || '' });
          }
        }
      }
      if (instances.length === 0 && typeof row.instance_id === 'string') {
        instances.push({
          id: row.instance_id,
          name: typeof row.instance_name === 'string' ? row.instance_name : '',
        });
      }

      const rawContacts = row.contacts as RawBroadcastContact[] | null | undefined;
      const phones: string[] = [];
      if (Array.isArray(rawContacts)) {
        for (const c of rawContacts) {
          const d = toBrPhoneDigits(String(c?.phone ?? ''));
          if (d) phones.push(d);
        }
      }

      return {
        id: row.id as string,
        title: (row.title as string) || '',
        status: row.status as string,
        started_at: (row.started_at as string | null) || null,
        created_at: (row.created_at as string | null) || null,
        instances,
        /** Dígitos do telefone (com 55) — usar para casar com remote_jid das conversas. */
        phone_digits: phones,
      };
    });

    return successResponse(rows);
  } catch (err) {
    return serverErrorResponse(err as Error);
  }
}
