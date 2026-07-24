import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

async function mayAccess(userId: string, conversationId: string) {
  const [{ data: profile }, { data: conversation }] = await Promise.all([
    supabaseServiceRole.from('profiles').select('status, zaploto_id').eq('id', userId).single(),
    supabaseServiceRole.from('chat_conversations').select('workspace_id, user_id, gerente_id').eq('id', conversationId).single(),
  ]);
  if (!profile || !conversation) return false;
  if (profile.status === 'super_admin') return true;
  if (conversation.workspace_id !== profile.zaploto_id) return false;
  if (profile.status === 'admin') return true;
  if (profile.status === 'gerente') return conversation.gerente_id === userId || (!conversation.gerente_id && !conversation.user_id);
  return profile.status === 'captador' && conversation.user_id === userId;
}

export async function GET(req: NextRequest, context: { params: Promise<{ conversationId: string }> }) {
  try {
    const { userId } = await requireAuth(req);
    const { conversationId } = await context.params;
    if (!(await mayAccess(userId, conversationId))) return errorResponse('Acesso negado.', 403);
    const cutoff = new Date(Date.now() - 90_000).toISOString();
    const { data, error } = await supabaseServiceRole
      .from('chat_conversation_presence')
      .select('user_id, last_seen_at, profiles(full_name, username)')
      .eq('conversation_id', conversationId)
      .gte('last_seen_at', cutoff);
    if (error) throw error;
    return successResponse(data ?? []);
  } catch (error) { return serverErrorResponse(error as Error); }
}

export async function POST(req: NextRequest, context: { params: Promise<{ conversationId: string }> }) {
  try {
    const { userId } = await requireAuth(req);
    const { conversationId } = await context.params;
    if (!(await mayAccess(userId, conversationId))) return errorResponse('Acesso negado.', 403);
    const { error } = await supabaseServiceRole.from('chat_conversation_presence').upsert({
      conversation_id: conversationId, user_id: userId, last_seen_at: new Date().toISOString(),
    }, { onConflict: 'conversation_id,user_id' });
    if (error) throw error;
    return successResponse({ online: true });
  } catch (error) { return serverErrorResponse(error as Error); }
}
