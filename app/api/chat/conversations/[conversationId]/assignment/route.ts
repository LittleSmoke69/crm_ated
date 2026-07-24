import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { assignConversations } from '@/lib/services/chat-assignment-service';

export async function PATCH(req: NextRequest, context: { params: Promise<{ conversationId: string }> }) {
  try {
    const { userId } = await requireAuth(req);
    const { conversationId } = await context.params;
    const body = await req.json().catch(() => ({}));
    if (typeof body.assignee_user_id !== 'string') return errorResponse('Captador obrigatório.', 400);
    const updated = await assignConversations({
      actorUserId: userId,
      conversationIds: [conversationId],
      assigneeUserId: body.assignee_user_id,
    });
    return successResponse({ updated }, 'Conversa atribuída com sucesso.');
  } catch (error) {
    return serverErrorResponse(error as Error);
  }
}
