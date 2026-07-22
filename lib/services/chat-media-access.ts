import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { canUserAccessEvolutionChatInstance } from '@/lib/services/atendimento-chat-access';

export type AccessibleChatMediaMessage = {
  id: string;
  message_id: string;
  media_type: string | null;
  media_url: string | null;
  caption: string | null;
  whatsapp_config_id: string | null;
  conversation_id: string;
  provider: string | null;
  provider_media_id: string | null;
  media_mime_type: string | null;
  media_filename: string | null;
  media_recovery_attempts: number | null;
};

export async function getAccessibleChatMediaMessage(
  userId: string,
  chatMessageId: string
): Promise<{ message: AccessibleChatMediaMessage | null; status: 403 | 404 | null }> {
  const { data: message } = await supabaseServiceRole
    .from('chat_messages')
    .select(
      'id, message_id, media_type, media_url, caption, whatsapp_config_id, conversation_id, provider, provider_media_id, media_mime_type, media_filename, media_recovery_attempts'
    )
    .eq('id', chatMessageId)
    .maybeSingle();
  if (!message) return { message: null, status: 404 };

  const [{ data: conversation }, { data: profile }] = await Promise.all([
    supabaseServiceRole
      .from('chat_conversations')
      .select('instance_id, whatsapp_config_id, user_id, workspace_id')
      .eq('id', message.conversation_id)
      .maybeSingle(),
    supabaseServiceRole
      .from('profiles')
      .select('status, zaploto_id')
      .eq('id', userId)
      .maybeSingle(),
  ]);
  if (!conversation || !profile) return { message: null, status: 404 };

  const status = String(profile.status || '').toLowerCase();
  const elevated = status === 'super_admin' || status === 'admin' || status === 'suporte';
  let allowed = false;
  if (conversation.instance_id) {
    allowed =
      elevated ||
      conversation.user_id === userId ||
      (await canUserAccessEvolutionChatInstance(userId, profile, conversation.instance_id));
  } else if (conversation.whatsapp_config_id) {
    allowed = elevated || conversation.workspace_id === profile.zaploto_id;
  }

  return allowed
    ? { message: message as AccessibleChatMediaMessage, status: null }
    : { message: null, status: 403 };
}
