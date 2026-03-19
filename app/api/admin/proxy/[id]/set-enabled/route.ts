/**
 * POST /api/admin/proxy/[id]/set-enabled
 * Habilita ou desabilita o proxy na Evolution API para todas as instâncias que usam este proxy.
 * Body: { "enabled": true | false }
 * Chama a Evolution API: POST /proxy/set/:instanceName com body { enabled: false } ou payload completo do proxy para habilitar.
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

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

    const canAccess = profile?.status === 'super_admin' || profile?.status === 'admin' || profile?.status === 'dono_banca';
    if (!canAccess) {
      return errorResponse('Acesso negado. Apenas administradores podem alterar proxy.', 403);
    }

    const body = await req.json().catch(() => ({}));
    const enabled = body.enabled === true || body.enabled === 'true';

    const { data: proxy, error: proxyError } = await supabaseServiceRole
      .from('proxy_instances')
      .select('*')
      .eq('id', proxyId)
      .single();

    if (proxyError || !proxy) {
      return errorResponse('Proxy não encontrado', 404);
    }

    // Evolution API exige host, port e protocol em todo request (inclusive ao desabilitar)
    const host = String(proxy.host ?? '').trim();
    const portStr = String(proxy.port ?? '').trim();
    const protocol = String(proxy.protocol ?? 'http').trim().toLowerCase();
    if (!host || !portStr || !protocol) {
      return errorResponse(
        'Proxy incompleto: configure host, port e protocol no cadastro do proxy.',
        400
      );
    }

    const { data: instances, error: instancesError } = await supabaseServiceRole
      .from('evolution_instances')
      .select('id, instance_name, evolution_api_id')
      .eq('proxy_id', proxyId);

    if (instancesError) {
      return errorResponse(`Erro ao buscar instâncias: ${instancesError.message}`, 500);
    }

    const list = instances || [];
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

    for (const instance of list) {
      const baseUrl = instance.evolution_api_id && normalizedBaseUrlByApiId[instance.evolution_api_id];
      const apiKey = instance.evolution_api_id && apiKeyByApiId[instance.evolution_api_id];
      if (!baseUrl || !apiKey) continue;

      const url = `${baseUrl}/proxy/set/${instance.instance_name}`.replace(/([^:]\/)\/+/g, '$1');

      // Evolution API exige host, port e protocol em todo request (inclusive ao desabilitar)
      const evolutionBody: Record<string, unknown> = {
        enabled,
        host,
        port: portStr,
        protocol,
        ...(proxy.username && String(proxy.username).trim() ? { username: String(proxy.username).trim() } : {}),
        ...(proxy.password ? { password: String(proxy.password) } : {}),
      };

      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: apiKey },
          body: JSON.stringify(evolutionBody),
        });
        if (!res.ok) {
          const text = await res.text();
          console.error(`[proxy/set-enabled] Evolution API erro para ${instance.instance_name}:`, res.status, text);
        }
      } catch (err) {
        console.error(`[proxy/set-enabled] Erro ao chamar Evolution para ${instance.instance_name}:`, err);
      }
    }

    const { error: updateError } = await supabaseServiceRole
      .from('proxy_instances')
      .update({ enabled, updated_at: new Date().toISOString() })
      .eq('id', proxyId);

    if (updateError) {
      return errorResponse(`Erro ao atualizar proxy no banco: ${updateError.message}`, 500);
    }

    return successResponse(
      { enabled, instancesUpdated: list.length },
      enabled ? 'Proxy habilitado.' : 'Proxy desabilitado.'
    );
  } catch (err: unknown) {
    return serverErrorResponse(err as Error);
  }
}
