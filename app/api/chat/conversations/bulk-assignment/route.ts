import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { assignConversations } from '@/lib/services/chat-assignment-service';

export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const body = await req.json().catch(() => ({}));
    const conversationIds = Array.isArray(body.conversation_ids)
      ? body.conversation_ids.filter((id: unknown): id is string => typeof id === 'string')
      : [];
    if (typeof body.assignee_user_id !== 'string') return errorResponse('Captador obrigatório.', 400);
    const updated = await assignConversations({
      actorUserId: userId,
      conversationIds,
      assigneeUserId: body.assignee_user_id,
    });
    return successResponse({ updated }, `${updated} conversa(s) atribuída(s).`);
  } catch (error) {
    return serverErrorResponse(error as Error);
  }
}
