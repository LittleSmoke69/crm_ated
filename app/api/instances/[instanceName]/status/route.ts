import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { evolutionService } from '@/lib/services/evolution-service';
import { getUserEvolutionApi } from '@/lib/services/evolution-api-helper';
import { proxyAutoAssign } from '@/lib/services/proxy-auto-assign';
import { notifyInstanceDisconnected } from '@/lib/services/loto-notify-service';
import {
  EVOLUTION_INSTANCE_WEBHOOK_EVENTS,
  ZAPLOTO_EVOLUTION_PROD_WEBHOOK_URL,
  shouldConfigureMasterChatWebhook,
} from '@/lib/server/evolution-chat-webhook-config';
import { evolutionApiSelector } from '@/lib/services/evolution-api-selector';

/**
 * O endpoint `instance/connect` da Evolution costuma devolver só `{ instance: { state: "open" } }`
 * quando o *processo* da instância está ativo — isso NÃO garante sessão WhatsApp pareada.
 * Só `connectionState` reflete se precisa de QR / está desconectado de fato.
 */
async function resolveReconnectStatus(
  instanceName: string,
  apiKey: string,
  baseUrl: string,
  connectResponse: unknown
): Promise<{
  state: ReturnType<typeof evolutionService.extractState>;
  qrCode: string | null;
  rawConnect: unknown;
  rawConnectionState: unknown | null;
}> {
  let connectionStatePayload: unknown | null = null;
  try {
    connectionStatePayload = await evolutionService.getConnectionState(
      instanceName,
      apiKey,
      baseUrl
    );
  } catch (err: unknown) {
    console.warn(
      `⚠️ [POST /status] getConnectionState após connect falhou:`,
      err instanceof Error ? err.message : err
    );
  }

  const qrFromConnect = evolutionService.extractQr(connectResponse);
  let state: ReturnType<typeof evolutionService.extractState>;
  let qrCode: string | null;

  if (connectionStatePayload != null) {
    state = evolutionService.extractState(connectionStatePayload);
    qrCode = evolutionService.extractQr(connectionStatePayload) ?? qrFromConnect;
  } else {
    qrCode = qrFromConnect;
    const fromConnect = evolutionService.extractState(connectResponse);
    // Sem connectionState não podemos cravar "connected": evita falso positivo do connect.
    state = fromConnect === 'connected' ? 'disconnected' : fromConnect;
  }

  return {
    state,
    qrCode,
    rawConnect: connectResponse,
    rawConnectionState: connectionStatePayload,
  };
}

/**
 * GET /api/instances/[instanceName]/status - Verifica status de conexão
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ instanceName: string }> }
) {
  try {
    console.log(`🔍 [GET /status] Iniciando verificação de status - ${new Date().toISOString()}`);
    
    const { userId } = await requireAuth(req);
    const { instanceName } = await params;

    console.log(`🔍 [GET /status] Parâmetros recebidos:`, {
      userId,
      instanceName,
      url: req.url,
      method: req.method,
    });

    // PERMITE acesso a todos os usuários autenticados para verificar status
    // Não precisa verificar se é dono ou admin - qualquer usuário pode verificar status
    console.log(`✅ [GET /status] Acesso permitido para usuário ${userId} verificar status da instância ${instanceName} (todos os usuários autenticados podem verificar status)`);

    // Busca a instância e sua Evolution API
    const { data: instance, error: fetchError } = await supabaseServiceRole
      .from('evolution_instances')
      .select(`
        *,
        evolution_apis!inner (
          id,
          name,
          base_url,
          api_key_global,
          is_active
        )
      `)
      .eq('instance_name', instanceName)
      .eq('is_active', true)
      .eq('evolution_apis.is_active', true)
      .single();

    // Se is_master não existir no banco, assume false (para compatibilidade)
    if (instance && instance.is_master === undefined) {
      instance.is_master = false;
    }

    if (fetchError || !instance) {
      return errorResponse('Instância não encontrada', 404);
    }

    const evolutionApi = Array.isArray(instance.evolution_apis) 
      ? instance.evolution_apis[0] 
      : instance.evolution_apis;

    if (!evolutionApi?.api_key_global) {
      return errorResponse('Instância sem API key global configurada', 404);
    }

    // Verifica status na Evolution usando api_key_global
    console.log(`🔄 [GET /status] Iniciando verificação de status da instância ${instanceName}`);
    console.log(`🔄 [GET /status] Base URL: ${evolutionApi.base_url}`);
    console.log(`🔄 [GET /status] API Key Global: ${evolutionApi.api_key_global?.substring(0, 10)}...${evolutionApi.api_key_global?.substring(evolutionApi.api_key_global.length - 4)}`);
    
    const evolutionData = await evolutionService.getConnectionState(instanceName, evolutionApi.api_key_global, evolutionApi.base_url);
    const state = evolutionService.extractState(evolutionData);
    const qrCode = evolutionService.extractQr(evolutionData);

    // Log detalhado da resposta da Evolution API
    console.log(`📥 [GET /status] Dados brutos recebidos da Evolution API (SEM CORTES):`, JSON.stringify(evolutionData, null, 2));
    console.log(`📊 [GET /status] Estado extraído:`, state);
    console.log(`🔲 [GET /status] QR Code extraído (length: ${qrCode?.length || 0}):`, qrCode ? `${qrCode.substring(0, 50)}... (primeiros 50 chars)` : 'null');
    console.log(`📊 [STATUS] Instância ${instanceName}:`, {
      stateExtraido: state,
      statusAtualBanco: instance.status,
      proxyId: instance.proxy_id,
      evolutionDataKeys: Object.keys(evolutionData || {}),
      evolutionDataSample: JSON.stringify(evolutionData).substring(0, 500),
      evolutionDataFull: JSON.stringify(evolutionData) // Log completo para debug
    });

    // Mapeia status da Evolution API para o banco
    // 'ok' no banco = somente quando WhatsApp está realmente conectado
    // Qualquer outro estado (connecting, disconnected, unknown) = 'disconnected' no banco
    // para a lista de instâncias sempre mostrar card "Desconectado" + Reconectar até conectar de fato.
    const wasConnected = instance.status === 'ok';
    let newStatus: string;

    if (state === 'connected') {
      newStatus = 'ok';
      console.log(`✅ [STATUS] Instância ${instanceName} CONECTADA na Evolution API - atualizando status para 'ok' no banco`);
    } else {
      newStatus = 'disconnected';
      if (state === 'connecting') {
        console.log(`⏳ [STATUS] Instância ${instanceName} aguardando QR (Evolution: connecting) — persistindo como 'disconnected' no banco até conectar`);
      } else if (state === 'disconnected') {
        console.log(`⚠️ [STATUS] Instância ${instanceName} DESCONECTADA na Evolution API - atualizando status para 'disconnected'`);
      } else {
        console.log(`❓ [STATUS] Instância ${instanceName} estado Evolution: ${state} — persistindo como 'disconnected' no banco (evita ficar preso em "connecting")`);
      }
    }

    // SEMPRE atualiza no banco (mesmo que seja o mesmo status, para garantir sincronização)
    const updatePayload: Record<string, unknown> = {
      status: newStatus,
      updated_at: new Date().toISOString(),
    };
    // Se acabou de conectar e é virgem: inicia auto maturação (5 dias, bloqueada). Auto maturador = mesmo fluxo do maturador manual, mas automático para tipo virgem.
    if (newStatus === 'ok' && instance.maturation_type === 'virgem' && !instance.maturation_status) {
      const now = new Date();
      const endsAt = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);
      updatePayload.maturation_status = 'waiting_connection_test';
      updatePayload.maturation_started_at = now.toISOString();
      updatePayload.maturation_ends_at = endsAt.toISOString();
      updatePayload.maturation_phase_started_at = now.toISOString();
      updatePayload.current_day = 1;
      updatePayload.is_locked = true;
      console.log(`[AUTO-MATURADOR] Instância virgem ${instanceName} conectada → entrou em auto maturação (5 dias) status=waiting_connection_test termina=${endsAt.toISOString()}`);
    }
    const { error: updateError } = await supabaseServiceRole
      .from('evolution_instances')
      .update(updatePayload)
      .eq('id', instance.id);

    if (updateError) {
      console.error(`❌ [STATUS] Erro ao atualizar status:`, updateError);
    } else {
      console.log(`✅ [STATUS] Status atualizado no banco: ${instance.status} -> ${newStatus}`);
    }

    // Se a instância está conectada (status = 'ok') e não tem proxy, atribui automaticamente
    // MAS: Instâncias mestres NÃO recebem proxy automaticamente
    const isNowConnected = newStatus === 'ok';
    const isMaster = instance.is_master === true;
    
    if (isNowConnected && !wasConnected && !instance.proxy_id && !isMaster) {
      console.log(`🔄 [STATUS] Instância ${instanceName} acabou de conectar (status: ${wasConnected} -> ${isNowConnected}) sem proxy - atribuindo automaticamente...`);
      // Executa em background (não bloqueia a resposta)
      proxyAutoAssign.assignProxyToInstance(instance.id, instanceName).catch((error) => {
        console.error(`❌ [STATUS] Erro ao atribuir proxy automaticamente:`, error);
      });
    } else if (isMaster && isNowConnected && !wasConnected) {
      console.log(`👑 [STATUS] Instância mestre ${instanceName} conectada - proxy não será atribuído automaticamente`);
    }

    // Quando passa de conectada para desconectada: avisa o dono via Loto Assistente (não bloqueia)
    if (newStatus === 'disconnected' && wasConnected && instance.user_id) {
      notifyInstanceDisconnected({
        instanceName,
        instanceId: instance.id,
        userId: instance.user_id,
        previousStatus: instance.status,
        newStatus: 'disconnected',
      }).catch((err) => console.error('[STATUS] Aviso Loto desconexão:', err));
    }

    // `status` = rótulo para cards/lista (connected | disconnected). `state` / `evolutionState` = estado bruto da Evolution (ex.: connecting) para polling/QR.
    const uiStatus = state === 'connected' ? 'connected' : 'disconnected';
    const responseData = {
      status: uiStatus,
      state,
      evolutionState: state,
      qrCode,
      raw: evolutionData,
    };

    console.log(`📤 [GET /status] Resposta FINAL que será enviada ao frontend (SEM CORTES):`, JSON.stringify(responseData, null, 2));

    return successResponse(responseData);
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

/**
 * POST /api/instances/[instanceName]/status - Reconecta instância
 * 
 * Usa o endpoint da Evolution API:
 * GET {base_url}/instance/connect/{instance_name}
 * Header: apikey: {global_api_key}
 * 
 * Equivalente ao curl:
 * curl --location '{url_evolution}instance/connect/{instance_name}' \
 * --header 'apikey: {global_api_key}'
 * 
 * Todas as informações são buscadas do banco de dados:
 * - url_evolution: evolution_apis.base_url
 * - instance_name: evolution_instances.instance_name
 * - global_api_key: evolution_apis.api_key_global
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ instanceName: string }> }
) {
  try {
    console.log(`🔍 [POST /status] Iniciando reconexão - ${new Date().toISOString()}`);
    
    const { userId } = await requireAuth(req);
    const { instanceName } = await params;

    console.log(`🔍 [POST /status] Parâmetros recebidos:`, {
      userId,
      instanceName,
      url: req.url,
      method: req.method,
    });

    // PERMITE acesso a todos os usuários autenticados para reconectar instância
    // Não precisa verificar se é dono ou admin - qualquer usuário pode reconectar
    console.log(`✅ [POST /status] Acesso permitido para usuário ${userId} reconectar instância ${instanceName} (todos os usuários autenticados podem reconectar)`);

    // Busca a instância e sua Evolution API do banco de dados
    // Obtém: base_url (url_evolution), instance_name, api_key_global (global_api_key)
    const { data: instance, error: fetchError } = await supabaseServiceRole
      .from('evolution_instances')
      .select(`
        *,
        evolution_apis!inner (
          id,
          name,
          base_url,
          api_key_global,
          is_active
        )
      `)
      .eq('instance_name', instanceName)
      .eq('is_active', true)
      .eq('evolution_apis.is_active', true)
      .single();

    if (fetchError || !instance) {
      return errorResponse('Instância não encontrada', 404);
    }

    const evolutionApi = Array.isArray(instance.evolution_apis) 
      ? instance.evolution_apis[0] 
      : instance.evolution_apis;

    if (!evolutionApi?.api_key_global) {
      return errorResponse('Instância sem API key global configurada', 404);
    }

    // Reconecta na Evolution API usando o endpoint correto
    // Chamada: GET {base_url}/instance/connect/{instance_name} com header apikey: {api_key_global}
    console.log(`🔄 [POST /status] Iniciando reconexão da instância ${instanceName}`);
    console.log(`🔄 [POST /status] Base URL: ${evolutionApi.base_url}`);
    console.log(`🔄 [POST /status] API Key Global: ${evolutionApi.api_key_global?.substring(0, 10)}...${evolutionApi.api_key_global?.substring(evolutionApi.api_key_global.length - 4)}`);
    
    const connectResponse = await evolutionService.connectInstance(
      instanceName,
      evolutionApi.api_key_global,
      evolutionApi.base_url
    );

    console.log(
      `📥 [POST /status] Resposta do connect (SEM CORTES):`,
      JSON.stringify(connectResponse, null, 2)
    );

    let { state, qrCode, rawConnect, rawConnectionState } = await resolveReconnectStatus(
      instanceName,
      evolutionApi.api_key_global,
      evolutionApi.base_url,
      connectResponse
    );

    if (rawConnectionState != null) {
      console.log(
        `📥 [POST /status] connectionState após connect (SEM CORTES):`,
        JSON.stringify(rawConnectionState, null, 2)
      );
    }

    let recycled = false;
    let chosenRecycleApi: {
      id: string;
      name: string;
      base_url: string;
      api_key_global: string;
    } | null = null;
    let createDataAfterRecycle: unknown = null;
    const hasQr = !!(qrCode && String(qrCode).trim());

    if (!hasQr) {
      console.log(
        `🔄 [POST /status] Sem QR após reconectar — reciclando (delete na API atual + create mesmo nome, priorizando outras APIs)`
      );

      await evolutionService.deleteInstanceBestEffort(
        instanceName,
        evolutionApi.api_key_global,
        evolutionApi.base_url,
        'reconnect-recycle-old-api'
      );

      const phoneDigits = String(instance.phone_number ?? '').replace(/\D/g, '');
      const createOptions =
        instance.is_master === true && shouldConfigureMasterChatWebhook()
          ? {
              webhook: {
                enabled: true,
                url: ZAPLOTO_EVOLUTION_PROD_WEBHOOK_URL,
                events: [...EVOLUTION_INSTANCE_WEBHOOK_EVENTS],
                base64: true,
              },
            }
          : undefined;

      const currentApiId = String(evolutionApi.id);
      const otherApis = await evolutionApiSelector.listApisForRecycleExcluding(currentApiId);
      const tryApis =
        otherApis.length > 0
          ? otherApis
          : [
              {
                id: currentApiId,
                name: 'API atual',
                base_url: evolutionApi.base_url,
                api_key_global: evolutionApi.api_key_global,
                instanceCount: 0,
              },
            ];

      if (otherApis.length > 0) {
        console.log(
          `🔄 [POST /status] Ordem de tentativa (outras APIs primeiro): ${tryApis.map((a) => `${a.name} (${a.id})`).join(' → ')}`
        );
      }

      let createData: unknown = null;
      let chosenApi: (typeof tryApis)[number] | null = null;
      let lastCreateErr = '';

      for (const api of tryApis) {
        try {
          createData = await evolutionService.createInstance(
            instanceName,
            phoneDigits,
            api.base_url,
            api.api_key_global.trim(),
            true,
            createOptions
          );
          chosenApi = api;
          console.log(`✅ [POST /status] Instância recriada na Evolution API: ${api.name} (${api.id})`);
          break;
        } catch (e: unknown) {
          lastCreateErr = e instanceof Error ? e.message : String(e);
          console.warn(
            `⚠️ [POST /status] create em "${api.name}" (${api.id}) falhou: ${lastCreateErr}`
          );
        }
      }

      if (!chosenApi || !createData) {
        return errorResponse(
          lastCreateErr ||
            'Nenhuma Evolution API conseguiu recriar a instância (tentativas esgotadas).',
          502
        );
      }

      recycled = true;
      chosenRecycleApi = {
        id: chosenApi.id,
        name: chosenApi.name,
        base_url: chosenApi.base_url,
        api_key_global: chosenApi.api_key_global,
      };
      createDataAfterRecycle = createData;
      rawConnect = createData;
      rawConnectionState = null;
      qrCode = evolutionService.extractQr(createData);
      state = evolutionService.extractState(createData);

      if (!qrCode || !String(qrCode).trim()) {
        try {
          const poll = await evolutionService.getConnectionState(
            instanceName,
            chosenApi.api_key_global.trim(),
            chosenApi.base_url
          );
          rawConnectionState = poll;
          qrCode = evolutionService.extractQr(poll) ?? qrCode;
          state = evolutionService.extractState(poll);
        } catch (pollErr: unknown) {
          console.warn(
            `⚠️ [POST /status] connectionState após recreate:`,
            pollErr instanceof Error ? pollErr.message : pollErr
          );
        }
      }

      console.log(`📊 [POST /status] Pós-reciclagem: state=${state}, qr length=${qrCode?.length ?? 0}`);
    } else {
      console.log(`📊 [POST /status] Estado final (via connectionState quando disponível):`, state);
      console.log(
        `🔲 [POST /status] QR Code extraído (length: ${qrCode?.length || 0}):`,
        qrCode ? `${qrCode.substring(0, 50)}...` : 'null'
      );
    }

    // Atualiza no banco: 'ok' só quando sessão WhatsApp ativa; após recreate sem parear = disconnected
    const newStatus = state === 'connected' ? 'ok' : 'disconnected';
    const updatePayload: Record<string, unknown> = {
      status: newStatus,
      updated_at: new Date().toISOString(),
    };

    if (recycled && chosenRecycleApi) {
      if (chosenRecycleApi.id !== evolutionApi.id) {
        updatePayload.evolution_api_id = chosenRecycleApi.id;
        console.log(
          `📝 [POST /status] evolution_instances.evolution_api_id → ${chosenRecycleApi.id} (${chosenRecycleApi.name})`
        );
      }
      const newHash = (createDataAfterRecycle as { hash?: string } | null)?.hash;
      if (typeof newHash === 'string' && newHash.trim()) {
        updatePayload.apikey = newHash.trim();
      } else {
        console.warn(
          `⚠️ [POST /status] Reciclagem sem hash na resposta — mantendo apikey atual (pode exigir novo pareamento manual se o balanceador falhar).`
        );
      }
    }

    const { error: updateErr } = await supabaseServiceRole
      .from('evolution_instances')
      .update(updatePayload)
      .eq('id', instance.id);

    if (updateErr) {
      console.error('❌ [POST /status] Erro ao atualizar instância após reconexão/reciclagem:', updateErr);
      return errorResponse(updateErr.message || 'Erro ao salvar status da instância', 500);
    }

    const uiStatus = state === 'connected' ? 'connected' : 'disconnected';
    const migratedApi = recycled && chosenRecycleApi && chosenRecycleApi.id !== evolutionApi.id;
    const responseData = {
      status: uiStatus,
      state,
      evolutionState: state,
      qrCode,
      message: recycled
        ? migratedApi && chosenRecycleApi
          ? `Instância recriada na API "${chosenRecycleApi.name}"; escaneie o novo QR Code.`
          : 'Instância recriada na Evolution; escaneie o novo QR Code.'
        : 'Reconexão solicitada',
      recycled,
      evolutionApiMigrated: migratedApi === true,
      evolutionApiId: chosenRecycleApi?.id ?? evolutionApi.id,
      raw: recycled ? rawConnect : rawConnectionState ?? rawConnect,
      rawConnect,
      rawConnectionState,
    };

    console.log(`📤 [POST /status] Resposta FINAL que será enviada ao frontend (SEM CORTES):`, JSON.stringify(responseData, null, 2));

    return successResponse(responseData);
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

