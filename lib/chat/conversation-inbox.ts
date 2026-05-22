/**
 * Regras compartilhadas da inbox do chat (aba Todos vs Histórico, ordenação).
 */

export const CHAT_WINDOW_24H_MS = 24 * 60 * 60 * 1000;

export type InboxConversation = {
  id: string;
  whatsapp_config_id?: string | null;
  last_message_at?: string | null;
  last_customer_message_at?: string | null;
  attendance_status?: 'pendente' | 'resolvido' | null;
  user_id?: string | null;
};

export function isWithin24hWindow(conv: InboxConversation, now = Date.now()): boolean {
  if (!conv.whatsapp_config_id || !conv.last_customer_message_at) return false;
  const t = new Date(conv.last_customer_message_at).getTime();
  if (!Number.isFinite(t)) return false;
  return now - t < CHAT_WINDOW_24H_MS;
}

export function isActiveInboxConversation(conv: InboxConversation, now = Date.now()): boolean {
  const resolved = conv.attendance_status === 'resolvido';
  if (conv.whatsapp_config_id) {
    return isWithin24hWindow(conv, now) && !resolved;
  }
  return !resolved;
}

export function sortConversationsForInbox<T extends InboxConversation>(conversations: T[], now = Date.now()): T[] {
  return [...conversations].sort((a, b) => {
    const aActive = isActiveInboxConversation(a, now);
    const bActive = isActiveInboxConversation(b, now);
    if (aActive && !bActive) return -1;
    if (!aActive && bActive) return 1;
    const a24 = isWithin24hWindow(a, now);
    const b24 = isWithin24hWindow(b, now);
    if (a24 && !b24) return -1;
    if (!a24 && b24) return 1;
    return (
      new Date(b.last_message_at || 0).getTime() - new Date(a.last_message_at || 0).getTime()
    );
  });
}

const ENRICH_BATCH_SIZE = 40;
const ENRICH_ROWS_PER_BATCH = 2000;

type InboundRow = { conversation_id: string; timestamp: number | string };

/**
 * Preenche last_customer_message_at a partir da última mensagem inbound (uma por conversa).
 */
export function applyLastCustomerMessageFromInbound<T extends InboxConversation & Record<string, unknown>>(
  conversations: T[],
  inboundRows: InboundRow[]
): T[] {
  const latestInboundTs = new Map<string, number>();
  for (const row of inboundRows) {
    const cid = row.conversation_id;
    if (!cid || latestInboundTs.has(cid)) continue;
    const ts = Number(row.timestamp);
    if (Number.isFinite(ts) && ts > 0) latestInboundTs.set(cid, ts);
  }
  if (latestInboundTs.size === 0) return conversations;

  return conversations.map((c) => {
    if (c.last_customer_message_at) return c;
    const ts = latestInboundTs.get(String(c.id));
    if (!ts) return c;
    return { ...c, last_customer_message_at: new Date(ts * 1000).toISOString() };
  });
}

export function conversationIdsNeedingCustomerBackfill(
  conversations: Array<{ id: string; whatsapp_config_id?: string | null; last_customer_message_at?: string | null }>
): string[] {
  return conversations
    .filter((c) => c.whatsapp_config_id && !c.last_customer_message_at)
    .map((c) => String(c.id))
    .filter(Boolean);
}

export function buildEnrichBatches(convIds: string[]): string[][] {
  const batches: string[][] = [];
  for (let i = 0; i < convIds.length; i += ENRICH_BATCH_SIZE) {
    batches.push(convIds.slice(i, i + ENRICH_BATCH_SIZE));
  }
  return batches;
}

export { ENRICH_BATCH_SIZE, ENRICH_ROWS_PER_BATCH };
