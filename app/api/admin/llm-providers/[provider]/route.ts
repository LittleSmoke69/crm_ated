import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { encryptionService } from '@/lib/services/encryption-service';

/**
 * PUT /api/admin/llm-providers/[provider]
 * Atualiza provider LLM
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  try {
    const { userId } = await requireAuth(req);
    const { provider } = await params;
    const body = await req.json();

    if (!['gemini', 'openai', 'anthropic'].includes(provider)) {
      return errorResponse('Provider inválido', 400);
    }

    // Se api_key foi fornecida, criptografa
    let updateData: any = {
      updated_at: new Date().toISOString(),
    };

    if (body.api_key) {
      updateData.api_key_encrypted = encryptionService.encrypt(body.api_key);
    }

    if (body.model_default !== undefined) {
      updateData.model_default = body.model_default;
    }

    if (body.enabled !== undefined) {
      updateData.enabled = body.enabled;
    }

    const { data, error } = await supabaseServiceRole
      .from('llm_providers')
      .update(updateData)
      .eq('tenant_id', userId)
      .eq('provider', provider)
      .select()
      .single();

    if (error || !data) {
      return errorResponse('Provider não encontrado ou erro ao atualizar', 404);
    }

    return successResponse(data, 'Provider atualizado com sucesso');
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

/**
 * DELETE /api/admin/llm-providers/[provider]
 * Deleta provider LLM
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  try {
    const { userId } = await requireAuth(req);
    const { provider } = await params;

    const { error } = await supabaseServiceRole
      .from('llm_providers')
      .delete()
      .eq('tenant_id', userId)
      .eq('provider', provider);

    if (error) {
      return errorResponse('Erro ao deletar provider', 500);
    }

    return successResponse(null, 'Provider deletado com sucesso');
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

