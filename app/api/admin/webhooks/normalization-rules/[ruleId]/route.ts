import { NextRequest } from 'next/server';
import { requireSuperAdmin } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { normalizationService } from '@/lib/services/normalization-service';

/**
 * PUT /api/admin/webhooks/normalization-rules/[ruleId]
 * Atualiza uma regra de normalização
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ ruleId: string }> }
) {
  try {
    await requireSuperAdmin(req);
    const { ruleId } = await params;
    const body = await req.json();

    const rule = await normalizationService.updateRule(ruleId, body);

    if (!rule) {
      return errorResponse('Regra não encontrada ou erro ao atualizar', 404);
    }

    return successResponse(rule, 'Regra atualizada com sucesso');
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

/**
 * DELETE /api/admin/webhooks/normalization-rules/[ruleId]
 * Deleta uma regra de normalização
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ ruleId: string }> }
) {
  try {
    await requireSuperAdmin(req);
    const { ruleId } = await params;

    const success = await normalizationService.deleteRule(ruleId);

    if (!success) {
      return errorResponse('Regra não encontrada ou erro ao deletar', 404);
    }

    return successResponse(null, 'Regra deletada com sucesso');
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

