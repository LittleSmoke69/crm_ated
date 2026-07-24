import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, serverErrorResponse } from '@/lib/utils/response';
import { getChatActor, listAvailableCaptadores } from '@/lib/services/chat-assignment-service';

export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    return successResponse(await listAvailableCaptadores(await getChatActor(userId)));
  } catch (error) {
    return serverErrorResponse(error as Error);
  }
}
