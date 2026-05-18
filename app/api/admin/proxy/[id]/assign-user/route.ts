import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { assignProxyToEvolutionInstance } from '@/lib/services/evolution-instance-proxy';

/**
 * POST /api/admin/proxy/[id]/assign-user — Atribui um proxy a uma instância (Evolution + banco).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await requireAuth(req);
    const { id: proxyId } = await params;

    const { data: profile } = await supabaseServiceRole
      .from('profiles')
      .select('status')
      .eq('id', userId)
      .single();

    const canAccess =
      profile?.status === 'super_admin' ||
      profile?.status === 'admin' ||
      profile?.status === 'dono_banca';
    if (!canAccess) {
      return errorResponse('Acesso negado. Apenas administradores podem acessar.', 403);
    }

    const body = await req.json();
    const { user_id: instanceId } = body;

    if (!instanceId) {
      return errorResponse('user_id é obrigatório (ID da instância evolution_instances)', 400);
    }

    console.log('[PROXY-ASSIGN] POST /api/admin/proxy/[id]/assign-user', {
      proxyId,
      instanceId,
      adminUserId: userId,
    });

    const result = await assignProxyToEvolutionInstance({
      instanceId,
      proxyId,
    });

    if (!result.ok) {
      console.error('[PROXY-ASSIGN] assign-user falhou', {
        proxyId,
        instanceId,
        status: result.status ?? 400,
        error: result.error,
      });
      return errorResponse(result.error, result.status ?? 400);
    }

    console.log('[PROXY-ASSIGN] assign-user OK', { proxyId, instanceId });

    const { data, error } = await supabaseServiceRole
      .from('evolution_instances')
      .select()
      .eq('id', instanceId)
      .single();

    if (error) {
      return successResponse(null, 'Proxy atribuído na Evolution; erro ao recarregar instância');
    }

    return successResponse(data, 'Proxy atribuído com sucesso na instância e na Evolution API');
  } catch (err: unknown) {
    return serverErrorResponse(err as Error);
  }
}

/**
 * DELETE /api/admin/proxy/[id]/assign-user — Remove proxy da instância.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await requireAuth(req);
    const { id: proxyId } = await params;

    const { data: profile } = await supabaseServiceRole
      .from('profiles')
      .select('status')
      .eq('id', userId)
      .single();

    const canAccess =
      profile?.status === 'super_admin' ||
      profile?.status === 'admin' ||
      profile?.status === 'dono_banca';
    if (!canAccess) {
      return errorResponse('Acesso negado. Apenas administradores podem acessar.', 403);
    }

    const { searchParams } = new URL(req.url);
    const user_id = searchParams.get('user_id');

    if (!user_id) {
      return errorResponse('user_id é obrigatório', 400);
    }

    const { data: instance, error: instanceError } = await supabaseServiceRole
      .from('evolution_instances')
      .select('id, instance_name, evolution_api_id, proxy_id')
      .eq('id', user_id)
      .single();

    if (instanceError || !instance) {
      return errorResponse('Instância não encontrada', 404);
    }

    if (instance.proxy_id && instance.proxy_id !== proxyId) {
      return errorResponse(
        'A instância não está vinculada a este proxy; remova pelo proxy correto ou atualize no painel.',
        409
      );
    }

    if (instance.evolution_api_id) {
      const { data: evolutionApi } = await supabaseServiceRole
        .from('evolution_apis')
        .select('base_url, api_key_global')
        .eq('id', instance.evolution_api_id)
        .single();

      if (evolutionApi?.base_url && evolutionApi?.api_key_global) {
        const normalizedBaseUrl = String(evolutionApi.base_url)
          .replace(/\/+$/, '')
          .replace(/([^:]\/)\/+/g, '$1');

        const finalUrl = `${normalizedBaseUrl}/proxy/set/${instance.instance_name}`.replace(/([^:]\/)\/+/g, '$1');

        try {
          await fetch(finalUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              apikey: String(evolutionApi.api_key_global).trim(),
            },
            body: JSON.stringify({ enabled: false }),
          });
        } catch (fetchError) {
          console.error('Erro ao desativar proxy na Evolution:', fetchError);
        }
      }
    }

    const { error } = await supabaseServiceRole
      .from('evolution_instances')
      .update({ proxy_id: null })
      .eq('id', user_id);

    if (error) {
      return errorResponse(`Erro ao remover proxy da instância: ${error.message}`);
    }

    return successResponse(null, 'Proxy removido com sucesso');
  } catch (err: unknown) {
    return serverErrorResponse(err as Error);
  }
}
