import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { flowTemplatesService } from '@/lib/services/flow-templates-service';

/**
 * POST /api/admin/flows/templates/welcome
 * Cria template de boas-vindas
 */
export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);

    const flowId = await flowTemplatesService.createWelcomeTemplate(userId);

    if (!flowId) {
      return errorResponse('Erro ao criar template', 500);
    }

    return successResponse({ flow_id: flowId }, 'Template de boas-vindas criado com sucesso');
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

