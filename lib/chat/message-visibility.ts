/**
 * Isolamento de mensagens no chat hierárquico.
 *
 * Captador recebe a conversa “limpa”: não vê histórico anterior à atribuição
 * (nem “Olá tenho interesse”, nem scripts de admin/gerente). Só entra o que
 * acontecer a partir de assigned_at — mensagens do cliente novas + as dele.
 */
import { supabaseServiceRole } from '@/lib/services/supabase-service';

const ELEVATED_STATUSES = new Set(['admin', 'super_admin']);

export type ChatMessageVisibilityRow = {
  user_id?: string | null;
  from_me?: boolean | null;
  direction?: string | null;
  timestamp?: number | string | null;
  created_at?: string | null;
};

function isOutbound(msg: ChatMessageVisibilityRow): boolean {
  if (msg.from_me === true) return true;
  if (String(msg.from_me) === 'true' || msg.from_me === (1 as unknown as boolean)) return true;
  return String(msg.direction || '').toLowerCase() === 'out';
}

/** Prefer created_at (DB) quando o timestamp WhatsApp estiver inconsistente. */
function messageUnix(msg: ChatMessageVisibilityRow): number {
  const fromCreated = msg.created_at ? Math.floor(new Date(msg.created_at).getTime() / 1000) : 0;
  const fromTs = Number(msg.timestamp || 0);
  const ts = Number.isFinite(fromTs) ? fromTs : 0;
  if (fromCreated > 0 && ts > 0) {
    // Se divergem > 1h, confia no created_at
    if (Math.abs(fromCreated - ts) > 3600) return fromCreated;
    return Math.min(fromCreated, ts);
  }
  return fromCreated || ts || 0;
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

  // Sem assigned_at: conversa chega vazia (só o que o próprio captador enviar).
  const assignedAtUnix = input.conversation?.assigned_at
    ? Math.floor(new Date(input.conversation.assigned_at).getTime() / 1000)
    : Number.POSITIVE_INFINITY;

  return input.messages.filter((msg) => {
    const ts = messageUnix(msg);

    // Histórico anterior à atribuição nunca aparece para o captador
    if (ts > 0 && ts < assignedAtUnix) return false;

    const outbound = isOutbound(msg);
    if (!outbound) {
      // Cliente: só depois da atribuição
      return ts === 0 || ts >= assignedAtUnix;
    }

    // Admin / super_admin nunca
    if (msg.user_id && elevatedIds.has(msg.user_id)) return false;

    // Só as próprias mensagens do captador (após atribuição)
    return !!msg.user_id && msg.user_id === input.viewerId;
  });
}

/**
 * Realtime: captador só recebe inbound novo + próprias.
 * Mensagens outbound de outros agentes são bloqueadas aqui;
 * o corte por assigned_at é aplicado no GET (histórico).
 */
export function captadorMaySeeRealtimeMessage(
  viewerStatus: string | null | undefined,
  viewerId: string | null | undefined,
  msg: ChatMessageVisibilityRow,
  assignedAtIso?: string | null
): boolean {
  if (viewerStatus !== 'captador') return true;

  if (assignedAtIso) {
    const assignedAtUnix = Math.floor(new Date(assignedAtIso).getTime() / 1000);
    const ts = messageUnix(msg);
    if (ts > 0 && ts < assignedAtUnix) return false;
  }

  if (!isOutbound(msg)) return true;
  return !!viewerId && msg.user_id === viewerId;
}

/**
 * Preview/lista: se a última atividade for anterior à atribuição, captador vê
 * conversa “sem mensagem” (sem preview e sem unread do histórico).
 */
export function sanitizeCaptadorConversationList<
  T extends {
    assigned_at?: string | null;
    last_message_at?: string | null;
    last_message_preview?: string | null;
    unread_count?: number | null;
  },
>(rows: T[], viewerStatus?: string | null): T[] {
  if (viewerStatus !== 'captador') return rows;
  return rows.map((c) => {
    const assignedMs = c.assigned_at ? new Date(c.assigned_at).getTime() : NaN;
    const lastMs = c.last_message_at ? new Date(c.last_message_at).getTime() : 0;
    if (!Number.isFinite(assignedMs) || lastMs <= assignedMs) {
      return { ...c, last_message_preview: '', unread_count: 0 };
    }
    return c;
  });
}
