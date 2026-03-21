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

    const result = await flowTemplatesService.createWelcomeTemplate(userId);

    if (!result) {
      return errorResponse('Erro ao criar template', 500);
    }

    const message = result.alreadyExisted
      ? 'Template de boas-vindas já existia. Redirecionando para edição.'
      : 'Template de boas-vindas criado com sucesso';
    return successResponse(
      { flow_id: result.flowId, already_existed: result.alreadyExisted },
      message
    );
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

