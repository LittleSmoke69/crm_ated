import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { llmService } from '@/lib/services/llm-service';

/**
 * GET /api/admin/llm-providers
 * Lista providers LLM do usuário
 */
export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const providers = await llmService.listProviders(userId);
    return successResponse(providers);
  } catch (err: any) {
    return errorResponse(err.message || 'Erro ao buscar providers', 401);
  }
}

/**
 * POST /api/admin/llm-providers
 * Cria ou atualiza um provider LLM
 * 
 * Body:
 * {
 *   provider: 'gemini' | 'openai' | 'anthropic';
 *   api_key: string; // API Key em texto puro (será criptografada)
 *   model_default?: string;
 *   enabled?: boolean;
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const body = await req.json();
    const { provider, api_key, model_default, enabled } = body;

    // Validação
    if (!provider || !api_key) {
      return errorResponse('Provider e api_key são obrigatórios', 400);
    }

    if (!['gemini', 'openai', 'anthropic'].includes(provider)) {
      return errorResponse('Provider inválido', 400);
    }

    // Testa conexão (opcional, mas recomendado)
    const testConnection = body.test_connection !== false;
    if (testConnection) {
      const connectionOk = await llmService.testConnection(userId, provider, api_key);
      if (!connectionOk) {
        return errorResponse('Falha ao conectar com o provider. Verifique a API Key.', 400);
      }
    }

    const result = await llmService.upsertProvider(
      userId,
      provider,
      api_key,
      model_default,
      enabled !== undefined ? enabled : true,
      userId
    );

    if (!result) {
      return errorResponse('Erro ao salvar provider', 500);
    }

    return successResponse(result, 'Provider configurado com sucesso');
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

