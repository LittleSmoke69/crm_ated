/**
 * Migração de mensagens históricas do Chat Interno
 *
 * Associa mensagens órfãs (sem conversation_id) a conversas,
 * agrupando por (whatsapp_config_id + sender_jid).
 *
 * Uso (na raiz do projeto, com .env carregado):
 *   npx tsx scripts/migrate-historical-messages.ts
 *
 * Variáveis de ambiente necessárias:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('[Zaploto Chat] NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não definidos.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

interface OrphanMessage {
  id: string;
  workspace_id: string | null;
  whatsapp_config_id: string | null;
  message_id: string;
  direction: 'in' | 'out';
  from_me: boolean;
  sender_jid: string | null;
  text: string | null;
  media_type: string | null;
  status: string | null;
  timestamp: number | string;
  created_at: string;
  provider: string;
}

function normalizeTimestamp(ts: number | string | null | undefined): number {
  if (!ts) return Math.floor(Date.now() / 1000);
  return typeof ts === 'string' ? parseInt(ts, 10) : ts;
}

async function run() {
  console.log('[Zaploto Chat] Iniciando migração de mensagens históricas...');

  // 1. Buscar todas as mensagens órfãs (sem conversation_id) do canal oficial
  const { data: orphans, error: fetchError } = await supabase
    .from('chat_messages')
    .select('*')
    .is('conversation_id', null)
    .eq('provider', 'whatsapp_official')
    .order('timestamp', { ascending: true });

  if (fetchError) {
    console.error('[Zaploto Chat] Erro ao buscar mensagens órfãs:', fetchError.message);
    process.exit(1);
  }

  if (!orphans || orphans.length === 0) {
    console.log('[Zaploto Chat] Nenhuma mensagem órfã encontrada. Migração concluída.');
    return;
  }

  console.log(`[Zaploto Chat] ${orphans.length} mensagens órfãs encontradas.`);

  // 2. Agrupar por (whatsapp_config_id + sender_jid) — mesmo número = mesma conversa
  const groups = new Map<string, OrphanMessage[]>();

  for (const msg of orphans as OrphanMessage[]) {
    if (!msg.whatsapp_config_id || !msg.sender_jid) {
      console.warn(`[Zaploto Chat] Mensagem ${msg.id} sem whatsapp_config_id ou sender_jid — ignorada.`);
      continue;
    }
    const key = `${msg.whatsapp_config_id}:${msg.sender_jid}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(msg);
  }

  console.log(`[Zaploto Chat] ${groups.size} grupo(s)/conversa(s) identificado(s).`);

  let processedMessages = 0;
  let conversationsUpserted = 0;
  const errors: string[] = [];

  // 3. Para cada grupo, upsert a conversa e associar as mensagens
  for (const [key, msgs] of groups) {
    const [whatsappConfigId, senderJid] = key.split(':');

    // Ordenar por timestamp para garantir cronologia correta
    const sorted = [...msgs].sort(
      (a, b) => normalizeTimestamp(a.timestamp) - normalizeTimestamp(b.timestamp)
    );

    const firstMsg = sorted[0];
    const lastMsg = sorted[sorted.length - 1];

    // Formatar remote_jid padronizado
    const remoteJid = senderJid.includes('@s.whatsapp.net')
      ? senderJid
      : `${senderJid.replace(/\D/g, '')}@s.whatsapp.net`;

    const tsLast = normalizeTimestamp(lastMsg.timestamp);
    const lastMessageAt = new Date(tsLast * 1000).toISOString();

    // last_customer_message_at: última mensagem inbound
    const lastInbound = [...sorted].reverse().find((m) => m.direction === 'in');
    const lastCustomerMessageAt = lastInbound
      ? new Date(normalizeTimestamp(lastInbound.timestamp) * 1000).toISOString()
      : null;

    const lastPreview =
      lastMsg.text?.slice(0, 100) ||
      (lastMsg.media_type && lastMsg.media_type !== 'text' ? lastMsg.media_type : '') ||
      '';

    const unreadCount = sorted.filter((m) => m.direction === 'in').length;

    // UPSERT da conversa (onConflict usa o índice parcial whatsapp_config_id,remote_jid)
    const { data: conv, error: convError } = await supabase
      .from('chat_conversations')
      .upsert(
        {
          whatsapp_config_id: whatsappConfigId,
          instance_id: null,
          workspace_id: firstMsg.workspace_id,
          remote_jid: remoteJid,
          title: remoteJid.replace('@s.whatsapp.net', ''),
          is_group: false,
          last_message_at: lastMessageAt,
          last_message_preview: lastPreview,
          last_customer_message_at: lastCustomerMessageAt,
          unread_count: unreadCount,
        },
        { onConflict: 'whatsapp_config_id,remote_jid' }
      )
      .select('id')
      .single();

    if (convError || !conv) {
      const msg = `[Zaploto Chat] Erro ao upsert conversa (${key}): ${convError?.message}`;
      console.error(msg);
      errors.push(msg);
      continue;
    }

    conversationsUpserted++;

    // UPDATE em batch: associar todas as mensagens do grupo à conversa
    const messageIds = sorted.map((m) => m.id);
    const { error: updateError } = await supabase
      .from('chat_messages')
      .update({ conversation_id: conv.id })
      .in('id', messageIds);

    if (updateError) {
      const msg = `[Zaploto Chat] Erro ao associar mensagens à conversa ${conv.id}: ${updateError.message}`;
      console.error(msg);
      errors.push(msg);
      continue;
    }

    processedMessages += sorted.length;
    process.stdout.write(
      `\r[Zaploto Chat] Processado ${processedMessages}/${orphans.length} mensagens, ${conversationsUpserted} conversas criadas/atualizadas`
    );
  }

  console.log(''); // nova linha após o progresso
  console.log(
    `[Zaploto Chat] Migração concluída! ${processedMessages} mensagens processadas, ${conversationsUpserted} conversas criadas/atualizadas.`
  );

  if (errors.length > 0) {
    console.warn(`[Zaploto Chat] ${errors.length} erro(s) durante a migração:`);
    errors.forEach((e) => console.warn(' -', e));
  }
}

run().catch((err) => {
  console.error('[Zaploto Chat] Erro fatal na migração:', err);
  process.exit(1);
});
