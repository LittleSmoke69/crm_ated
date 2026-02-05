import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { llmService } from '@/lib/services/llm-service';

/**
 * POST /api/admin/llm-providers/test
 * Testa conexão com provider LLM
 * 
 * Body:
 * {
 *   provider: 'gemini' | 'openai' | 'anthropic';
 *   api_key: string;
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const body = await req.json();
    const { provider, api_key } = body;

    if (!provider || !api_key) {
      return errorResponse('Provider e api_key são obrigatórios', 400);
    }

    const connectionOk = await llmService.testConnection(userId, provider, api_key);

    return successResponse(
      { success: connectionOk },
      connectionOk ? 'Conexão bem-sucedida' : 'Falha na conexão'
    );
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

