import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * Aplica proxy na Evolution API (POST /proxy/set/:instanceName) e persiste proxy_id em evolution_instances.
 * Usado na atribuição manual (admin), na criação de instância com proxy_id e no fluxo de auto-assign.
 */
export async function assignProxyToEvolutionInstance(params: {
  instanceId: string;
  proxyId: string;
}): Promise<{ ok: true } | { ok: false; error: string; status?: number }> {
  const { instanceId, proxyId } = params;

  const { data: proxy, error: proxyError } = await supabaseServiceRole
    .from('proxy_instances')
    .select('*')
    .eq('id', proxyId)
    .single();

  if (proxyError || !proxy) {
    return { ok: false, error: 'Proxy não encontrado', status: 404 };
  }

  if (proxy.enabled === false) {
    return { ok: false, error: 'Proxy está desativado', status: 400 };
  }

  const { data: instance, error: instanceError } = await supabaseServiceRole
    .from('evolution_instances')
    .select('id, instance_name, evolution_api_id, proxy_id')
    .eq('id', instanceId)
    .single();

  if (instanceError || !instance) {
    return { ok: false, error: 'Instância não encontrada', status: 404 };
  }

  if (!instance.evolution_api_id) {
    return { ok: false, error: 'Instância não possui API Evolution vinculada', status: 400 };
  }

  const { data: evolutionApi, error: evolutionApiError } = await supabaseServiceRole
    .from('evolution_apis')
    .select('id, base_url, api_key_global')
    .eq('id', instance.evolution_api_id)
    .single();

  if (evolutionApiError || !evolutionApi) {
    return { ok: false, error: 'Evolution API não encontrada', status: 404 };
  }

  const normalizedBaseUrl = String(evolutionApi.base_url || '')
    .replace(/\/+$/, '')
    .replace(/([^:]\/)\/+/g, '$1');
  const trimmedApiKey = String(evolutionApi.api_key_global || '').trim();

  if (!normalizedBaseUrl || !trimmedApiKey) {
    return { ok: false, error: 'Configuração da Evolution API incompleta (base_url ou api_key_global)', status: 400 };
  }

  if (!proxy.host || !proxy.port || !proxy.protocol) {
    return { ok: false, error: 'Dados do proxy incompletos (host, port ou protocol)', status: 400 };
  }

  if (instance.proxy_id && instance.proxy_id !== proxyId) {
    try {
      const removeUrl = `${normalizedBaseUrl}/proxy/set/${instance.instance_name}`.replace(/([^:]\/)\/+/g, '$1');
      await fetch(removeUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: trimmedApiKey,
        },
        body: JSON.stringify({ enabled: false }),
      });
    } catch {
      // Continua para aplicar o novo proxy mesmo se a remoção falhar
    }
  }

  const portString = String(proxy.port).trim();
  if (!portString) {
    return { ok: false, error: 'Port do proxy inválido', status: 400 };
  }

  const proxyPayload: Record<string, unknown> = {
    enabled: true,
    host: String(proxy.host).trim(),
    port: portString,
    protocol: String(proxy.protocol).trim().toLowerCase(),
  };

  if (proxy.username && String(proxy.username).trim()) {
    proxyPayload.username = String(proxy.username).trim();
  }
  if (proxy.password) {
    proxyPayload.password = String(proxy.password);
  }

  const finalUrl = `${normalizedBaseUrl}/proxy/set/${instance.instance_name}`.replace(/([^:]\/)\/+/g, '$1');

  const evolutionResponse = await fetch(finalUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: trimmedApiKey,
    },
    body: JSON.stringify(proxyPayload),
  });

  if (!evolutionResponse.ok) {
    const errorText = await evolutionResponse.text();
    let message = errorText || evolutionResponse.statusText;
    try {
      const parsed = JSON.parse(errorText);
      message = parsed.message || parsed.error || message;
    } catch {
      /* texto bruto */
    }
    return {
      ok: false,
      error: message || `Erro na Evolution API (${evolutionResponse.status})`,
      status: evolutionResponse.status,
    };
  }

  const { error: updateError } = await supabaseServiceRole
    .from('evolution_instances')
    .update({ proxy_id: proxyId })
    .eq('id', instanceId);

  if (updateError) {
    return { ok: false, error: `Erro ao atualizar proxy no banco: ${updateError.message}` };
  }

  return { ok: true };
}
