import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { createEvolutionChatInstance } from '@/lib/server/evolution-chat-instance-create';

/**
 * POST /api/instances/create
 *
 * REGRA CRÍTICA:
 * - Webhook deve ser criado junto com a instância no MESMO request para a Evolution API.
 *
 * Auth:
 * - Criar instância + webhook: usa SEMPRE evolution_apis.api_key_global (token global)
 */
export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);

    const { data: profile } = await supabaseServiceRole
      .from('profiles')
      .select('status, zaploto_id')
      .eq('id', userId)
      .single();

    if (profile?.status !== 'admin') {
      return errorResponse('Acesso negado. Apenas administradores podem criar instâncias de chat.', 403);
    }

    const body = await req.json();
    const { evolution_api_id, workspace_id, instance_name, maturation_type } = body || {};

    if (!evolution_api_id || !instance_name) {
      return errorResponse('evolution_api_id e instance_name são obrigatórios', 400);
    }

    const maturationTypeValue = maturation_type === 'virgem' ? 'virgem' : 'maturado';
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin;

    const result = await createEvolutionChatInstance({
      evolutionApiId: evolution_api_id,
      instanceName: instance_name,
      ownerUserId: userId,
      workspaceId: workspace_id || null,
      maturationType: maturationTypeValue,
      zaplotoId: profile?.zaploto_id ?? null,
      appUrl,
    });

    if (!result.ok) {
      return errorResponse(result.error, result.status);
    }

    return successResponse(
      {
        instance: result.instance,
        qr_code: result.qr_code,
        evolution_data: result.evolution_data,
        warning: result.warning,
      },
      result.warning ? 'Instância criada com aviso' : 'Instância criada com sucesso'
    );
  } catch (err: unknown) {
    return serverErrorResponse(err as Error);
  }
}
