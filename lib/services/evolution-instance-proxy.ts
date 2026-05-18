import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { isProxyEnabled } from '@/lib/utils/proxy-enabled';

const LOG_PREFIX = '[PROXY-ASSIGN]';

function sanitizeProxyPayloadForLog(payload: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...payload };
  if ('password' in copy) copy.password = copy.password ? '***' : copy.password;
  if ('apikey' in copy) copy.apikey = '***';
  return copy;
}

async function postEvolutionProxySet(params: {
  label: string;
  url: string;
  apiKey: string;
  body: Record<string, unknown>;
  context: Record<string, unknown>;
}): Promise<{ ok: boolean; status: number; bodyText: string }> {
  const started = Date.now();
  const safeBody = sanitizeProxyPayloadForLog(params.body);

  console.log(`${LOG_PREFIX} Evolution request → ${params.label}`, {
    ...params.context,
    method: 'POST',
    url: params.url,
    headers: { 'Content-Type': 'application/json', apikey: '***' },
    body: safeBody,
  });

  let response: Response;
  try {
    response = await fetch(params.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: params.apiKey,
      },
      body: JSON.stringify(params.body),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`${LOG_PREFIX} Evolution request ✗ rede (${params.label})`, {
      ...params.context,
      url: params.url,
      durationMs: Date.now() - started,
      error: message,
    });
    throw err;
  }

  const bodyText = await response.text();
  const durationMs = Date.now() - started;
  let parsedBody: unknown = bodyText;
  if (bodyText) {
    try {
      parsedBody = JSON.parse(bodyText);
    } catch {
      parsedBody = bodyText.length > 500 ? `${bodyText.slice(0, 500)}…` : bodyText;
    }
  }

  if (response.ok) {
    console.log(`${LOG_PREFIX} Evolution response ✓ ${params.label}`, {
      ...params.context,
      status: response.status,
      durationMs,
      body: parsedBody,
    });
  } else {
    console.error(`${LOG_PREFIX} Evolution response ✗ ${params.label}`, {
      ...params.context,
      status: response.status,
      statusText: response.statusText,
      durationMs,
      body: parsedBody,
    });
  }

  return { ok: response.ok, status: response.status, bodyText };
}

function parseEvolutionErrorMessage(bodyText: string, statusText: string): string {
  let message = bodyText || statusText;
  if (!bodyText) return message;
  try {
    const parsed = JSON.parse(bodyText) as { message?: string; error?: string };
    message = parsed.message || parsed.error || message;
  } catch {
    /* texto bruto */
  }
  return message;
}

/**
 * Aplica proxy na Evolution API (POST /proxy/set/:instanceName) e persiste proxy_id em evolution_instances.
 * Usado na atribuição manual (admin), na criação de instância com proxy_id e no fluxo de auto-assign.
 */
export async function assignProxyToEvolutionInstance(params: {
  instanceId: string;
  proxyId: string;
}): Promise<{ ok: true } | { ok: false; error: string; status?: number }> {
  const { instanceId, proxyId } = params;
  const logContext = { instanceId, proxyId };

  console.log(`${LOG_PREFIX} Início assignProxyToEvolutionInstance`, logContext);

  const { data: proxy, error: proxyError } = await supabaseServiceRole
    .from('proxy_instances')
    .select('*')
    .eq('id', proxyId)
    .single();

  if (proxyError || !proxy) {
    console.warn(`${LOG_PREFIX} Proxy não encontrado no banco`, { ...logContext, proxyError });
    return { ok: false, error: 'Proxy não encontrado', status: 404 };
  }

  if (!isProxyEnabled(proxy.enabled)) {
    console.warn(`${LOG_PREFIX} Proxy desativado no cadastro`, {
      ...logContext,
      enabled: proxy.enabled,
    });
    return { ok: false, error: 'Proxy está desativado', status: 400 };
  }

  const { data: instance, error: instanceError } = await supabaseServiceRole
    .from('evolution_instances')
    .select('id, instance_name, evolution_api_id, proxy_id')
    .eq('id', instanceId)
    .single();

  if (instanceError || !instance) {
    console.warn(`${LOG_PREFIX} Instância não encontrada`, { ...logContext, instanceError });
    return { ok: false, error: 'Instância não encontrada', status: 404 };
  }

  if (!instance.evolution_api_id) {
    console.warn(`${LOG_PREFIX} Instância sem evolution_api_id`, {
      ...logContext,
      instanceName: instance.instance_name,
    });
    return { ok: false, error: 'Instância não possui API Evolution vinculada', status: 400 };
  }

  const { data: evolutionApi, error: evolutionApiError } = await supabaseServiceRole
    .from('evolution_apis')
    .select('id, base_url, api_key_global')
    .eq('id', instance.evolution_api_id)
    .single();

  if (evolutionApiError || !evolutionApi) {
    console.warn(`${LOG_PREFIX} Evolution API não encontrada`, {
      ...logContext,
      evolutionApiId: instance.evolution_api_id,
      evolutionApiError,
    });
    return { ok: false, error: 'Evolution API não encontrada', status: 404 };
  }

  const normalizedBaseUrl = String(evolutionApi.base_url || '')
    .replace(/\/+$/, '')
    .replace(/([^:]\/)\/+/g, '$1');
  const trimmedApiKey = String(evolutionApi.api_key_global || '').trim();

  if (!normalizedBaseUrl || !trimmedApiKey) {
    console.warn(`${LOG_PREFIX} Evolution API incompleta`, {
      ...logContext,
      evolutionApiId: evolutionApi.id,
      hasBaseUrl: !!normalizedBaseUrl,
      hasApiKey: !!trimmedApiKey,
    });
    return { ok: false, error: 'Configuração da Evolution API incompleta (base_url ou api_key_global)', status: 400 };
  }

  if (!proxy.host || !proxy.port || !proxy.protocol) {
    console.warn(`${LOG_PREFIX} Dados do proxy incompletos`, {
      ...logContext,
      host: proxy.host,
      port: proxy.port,
      protocol: proxy.protocol,
    });
    return { ok: false, error: 'Dados do proxy incompletos (host, port ou protocol)', status: 400 };
  }

  const evolutionCtx = {
    ...logContext,
    instanceName: instance.instance_name,
    evolutionApiId: evolutionApi.id,
    evolutionBaseUrl: normalizedBaseUrl,
    previousProxyId: instance.proxy_id ?? null,
  };

  if (instance.proxy_id && instance.proxy_id !== proxyId) {
    const removeUrl = `${normalizedBaseUrl}/proxy/set/${instance.instance_name}`.replace(/([^:]\/)\/+/g, '$1');
    try {
      await postEvolutionProxySet({
        label: 'remover-proxy-anterior',
        url: removeUrl,
        apiKey: trimmedApiKey,
        body: { enabled: false },
        context: evolutionCtx,
      });
    } catch {
      console.warn(`${LOG_PREFIX} Falha ao remover proxy anterior na Evolution (continua)`, evolutionCtx);
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

  const evolutionResult = await postEvolutionProxySet({
    label: 'aplicar-proxy',
    url: finalUrl,
    apiKey: trimmedApiKey,
    body: proxyPayload,
    context: {
      ...evolutionCtx,
      proxyName: proxy.name,
      proxyHost: proxy.host,
      proxyPort: portString,
      proxyProtocol: proxyPayload.protocol,
    },
  });

  if (!evolutionResult.ok) {
    const message = parseEvolutionErrorMessage(evolutionResult.bodyText, '');
    return {
      ok: false,
      error: message || `Erro na Evolution API (${evolutionResult.status})`,
      status: evolutionResult.status,
    };
  }

  const { error: updateError } = await supabaseServiceRole
    .from('evolution_instances')
    .update({ proxy_id: proxyId })
    .eq('id', instanceId);

  if (updateError) {
    console.error(`${LOG_PREFIX} Falha ao persistir proxy_id no banco`, {
      ...evolutionCtx,
      updateError,
    });
    return { ok: false, error: `Erro ao atualizar proxy no banco: ${updateError.message}` };
  }

  console.log(`${LOG_PREFIX} Concluído com sucesso`, evolutionCtx);
  return { ok: true };
}
