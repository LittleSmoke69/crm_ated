import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * PATCH /api/admin/proxy/[id] - Atualiza uma Proxy
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await requireAuth(req);
    const { id } = await params;
    
    // Verifica se é admin
    const { data: profile } = await supabaseServiceRole
      .from('profiles')
      .select('status')
      .eq('id', userId)
      .single();

    const canAccess = profile?.status === 'super_admin' || profile?.status === 'admin' || profile?.status === 'dono_banca';
    if (!canAccess) {
      return errorResponse('Acesso negado. Apenas administradores podem acessar.', 403);
    }

    const body = await req.json();
    const { name, host, port, username, password, protocol, enabled } = body.formDataProxy;

    const updateData: any = {
      updated_at: new Date().toISOString(),
    };

    if (name !== undefined) updateData.name = name;
    if (host !== undefined) updateData.host = host;
    if (port !== undefined) updateData.port = port;
    if (username !== undefined) updateData.username = username;
    if (password !== undefined) updateData.password = password;
    if (protocol !== undefined) updateData.protocol = protocol;
    if (enabled !== undefined) updateData.enabled = enabled;

    const { data, error } = await supabaseServiceRole
      .from('proxy_instances')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return errorResponse(`Erro ao atualizar Proxy: ${error.message}`);
    }

    if (!data) {
      return errorResponse('Proxy não encontrada', 404);
    }

    return successResponse(data, 'Proxy atualizada com sucesso');
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

/**
 * DELETE /api/admin/proxy/[id] - Deleta uma Proxy
 * Desvincula as instâncias que usam este proxy (remove proxy na Evolution e zera proxy_id), depois remove o proxy.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await requireAuth(req);
    const { id } = await params;

    const { data: profile } = await supabaseServiceRole
      .from('profiles')
      .select('status')
      .eq('id', userId)
      .single();

    const canAccess = profile?.status === 'super_admin' || profile?.status === 'admin' || profile?.status === 'dono_banca';
    if (!canAccess) {
      return errorResponse('Acesso negado. Apenas administradores podem acessar.', 403);
    }

    const { data: proxy, error: proxyError } = await supabaseServiceRole
      .from('proxy_instances')
      .select('id, host, port, protocol, username, password')
      .eq('id', id)
      .single();

    if (proxyError || !proxy) {
      return errorResponse('Proxy não encontrado', 404);
    }

    const { data: instances, error: instancesError } = await supabaseServiceRole
      .from('evolution_instances')
      .select('id, instance_name, evolution_api_id')
      .eq('proxy_id', id);

    if (instancesError) {
      return errorResponse(`Erro ao buscar instâncias: ${instancesError.message}`, 500);
    }

    const list = instances || [];
    const host = String(proxy.host ?? '').trim();
    const portStr = String(proxy.port ?? '').trim();
    const protocol = String(proxy.protocol ?? 'http').trim().toLowerCase();
    const hasProxyFields = !!host && !!portStr && !!protocol;

    if (list.length > 0 && hasProxyFields) {
      const normalizedBaseUrlByApiId: Record<string, string> = {};
      const apiKeyByApiId: Record<string, string> = {};

      for (const instance of list) {
        if (!instance.evolution_api_id) continue;
        if (normalizedBaseUrlByApiId[instance.evolution_api_id]) continue;
        const { data: evolutionApi } = await supabaseServiceRole
          .from('evolution_apis')
          .select('base_url, api_key_global')
          .eq('id', instance.evolution_api_id)
          .single();
        if (evolutionApi?.base_url && evolutionApi?.api_key_global) {
          const normalizedBaseUrl = evolutionApi.base_url.replace(/\/+$/, '').replace(/([^:]\/)\/+/g, '$1');
          normalizedBaseUrlByApiId[instance.evolution_api_id] = normalizedBaseUrl;
          apiKeyByApiId[instance.evolution_api_id] = String(evolutionApi.api_key_global).trim();
        }
      }

      const evolutionBody: Record<string, unknown> = {
        enabled: false,
        host,
        port: portStr,
        protocol,
        ...(proxy.username && String(proxy.username).trim() ? { username: String(proxy.username).trim() } : {}),
        ...(proxy.password ? { password: String(proxy.password) } : {}),
      };

      for (const instance of list) {
        const baseUrl = instance.evolution_api_id && normalizedBaseUrlByApiId[instance.evolution_api_id];
        const apiKey = instance.evolution_api_id && apiKeyByApiId[instance.evolution_api_id];
        if (!baseUrl || !apiKey) continue;
        try {
          const url = `${baseUrl}/proxy/set/${instance.instance_name}`.replace(/([^:]\/)\/+/g, '$1');
          await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', apikey: apiKey },
            body: JSON.stringify(evolutionBody),
          });
        } catch (err) {
          console.warn(`[proxy/delete] Aviso ao remover proxy da instância ${instance.instance_name}:`, err);
        }
      }
    }

    const { error: unlinkError } = await supabaseServiceRole
      .from('evolution_instances')
      .update({ proxy_id: null, updated_at: new Date().toISOString() })
      .eq('proxy_id', id);

    if (unlinkError) {
      return errorResponse(`Erro ao desvincular instâncias do proxy: ${unlinkError.message}`, 500);
    }

    const { error: deleteError } = await supabaseServiceRole
      .from('proxy_instances')
      .delete()
      .eq('id', id);

    if (deleteError) {
      return errorResponse(`Erro ao deletar proxy: ${deleteError.message}`, 500);
    }

    return successResponse(
      { instancesUnlinked: list.length },
      list.length > 0
        ? `Proxy removido e ${list.length} instância(s) desvinculada(s).`
        : 'Proxy deletado com sucesso.'
    );
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}
