/**
 * Isolamento de mensagens no chat hierárquico.
 * Captador NÃO deve ver mensagens enviadas por admin/super_admin (nem as
 * reatribuídas incorretamente ao dono da instância antes do assign).
 */
import { supabaseServiceRole } from '@/lib/services/supabase-service';

const ELEVATED_STATUSES = new Set(['admin', 'super_admin']);

export type ChatMessageVisibilityRow = {
  user_id?: string | null;
  from_me?: boolean | null;
  direction?: string | null;
  timestamp?: number | string | null;
};

function isOutbound(msg: ChatMessageVisibilityRow): boolean {
  if (msg.from_me === true) return true;
  if (String(msg.from_me) === 'true' || msg.from_me === (1 as unknown as boolean)) return true;
  return String(msg.direction || '').toLowerCase() === 'out';
}

export async function filterChatMessagesForViewer<T extends ChatMessageVisibilityRow>(input: {
  messages: T[];
  viewerId: string;
  viewerStatus: string | null | undefined;
  conversation?: {
    assigned_at?: string | null;
    assigned_by?: string | null;
  } | null;
}): Promise<T[]> {
  if (input.viewerStatus !== 'captador') return input.messages;

  const senderIds = new Set<string>();
  for (const msg of input.messages) {
    if (msg.user_id) senderIds.add(msg.user_id);
  }
  if (input.conversation?.assigned_by) {
    senderIds.add(input.conversation.assigned_by);
  }

  const elevatedIds = new Set<string>();
  if (senderIds.size > 0) {
    const { data: profiles } = await supabaseServiceRole
      .from('profiles')
      .select('id, status')
      .in('id', [...senderIds]);
    for (const row of profiles ?? []) {
      if (ELEVATED_STATUSES.has(String(row.status || ''))) {
        elevatedIds.add(row.id as string);
      }
    }
  }

  const assignedAtUnix = input.conversation?.assigned_at
    ? Math.floor(new Date(input.conversation.assigned_at).getTime() / 1000)
    : null;
  const assignedByElevated = !!(
    input.conversation?.assigned_by && elevatedIds.has(input.conversation.assigned_by)
  );

  return input.messages.filter((msg) => {
    if (!isOutbound(msg)) return true;
    // Próprias mensagens do captador
    if (msg.user_id && msg.user_id === input.viewerId) {
      // Mensagens "do captador" anteriores à atribuição feita por admin costumam
      // ser envios da admin gravados com user_id errado (dono da instância).
      if (
        assignedByElevated &&
        assignedAtUnix != null &&
        Number(msg.timestamp || 0) > 0 &&
        Number(msg.timestamp) < assignedAtUnix
      ) {
        return false;
      }
      return true;
    }
    // Admin / super_admin nunca aparecem para o captador
    if (msg.user_id && elevatedIds.has(msg.user_id)) return false;
    // Sem autor conhecido + saída antes da atribuição por admin → esconde
    if (
      assignedByElevated &&
      assignedAtUnix != null &&
      Number(msg.timestamp || 0) > 0 &&
      Number(msg.timestamp) < assignedAtUnix
    ) {
      return false;
    }
    // Outbound de gerente/outros: captador não herda o script anterior
    return false;
  });
}

/** Regra rápida no client (realtime): captador só recebe inbound + próprias. */
export function captadorMaySeeRealtimeMessage(
  viewerStatus: string | null | undefined,
  viewerId: string | null | undefined,
  msg: ChatMessageVisibilityRow
): boolean {
  if (viewerStatus !== 'captador') return true;
  if (!isOutbound(msg)) return true;
  return !!viewerId && msg.user_id === viewerId;
}
