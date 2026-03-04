import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { evolutionService } from '@/lib/services/evolution-service';
import { getUserEvolutionApi } from '@/lib/services/evolution-api-helper';
import { proxyAutoAssign } from '@/lib/services/proxy-auto-assign';
import { notifyInstanceDisconnected } from '@/lib/services/loto-notify-service';

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
    // 'connecting' = QR code gerado, aguardando escanear
    // 'disconnected' = desconectado
    let newStatus: string;
    const wasConnected = instance.status === 'ok';

    if (state === 'connected') {
      newStatus = 'ok';
      console.log(`✅ [STATUS] Instância ${instanceName} CONECTADA na Evolution API - atualizando status para 'ok' no banco`);
    } else if (state === 'connecting') {
      // QR code gerado ou aguardando escaneamento - NÃO marcar como ok até conectar de fato
      newStatus = 'connecting';
      console.log(`⏳ [STATUS] Instância ${instanceName} CONECTANDO (QR code) - mantendo status 'connecting' até o WhatsApp conectar`);
    } else if (state === 'disconnected') {
      newStatus = 'disconnected'; // Desconectado
      console.log(`⚠️ [STATUS] Instância ${instanceName} DESCONECTADA na Evolution API - atualizando status para 'disconnected'`);
    } else {
      // Estado desconhecido - mantém o atual
      newStatus = instance.status;
      console.log(`❓ [STATUS] Instância ${instanceName} estado desconhecido: ${state} - mantendo status atual: ${instance.status}`);
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

    const responseData = {
      status: state,
      state, // alias para compatibilidade com frontend que usa data.state
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
    
    const evolutionData = await evolutionService.connectInstance(instanceName, evolutionApi.api_key_global, evolutionApi.base_url);
    
    console.log(`📥 [POST /status] Dados brutos recebidos da Evolution API (SEM CORTES):`, JSON.stringify(evolutionData, null, 2));
    
    const state = evolutionService.extractState(evolutionData);
    const qrCode = evolutionService.extractQr(evolutionData);
    
    console.log(`📊 [POST /status] Estado extraído:`, state);
    console.log(`🔲 [POST /status] QR Code extraído (length: ${qrCode?.length || 0}):`, qrCode ? `${qrCode.substring(0, 50)}...` : 'null');

    // Atualiza no banco: 'ok' só quando realmente conectado; 'connecting' quando QR gerado; senão 'disconnected'
    const newStatus = state === 'connected' ? 'ok' : state === 'connecting' ? 'connecting' : 'disconnected';
    await supabaseServiceRole
      .from('evolution_instances')
      .update({
        status: newStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', instance.id);

    const responseData = {
      status: state,
      qrCode,
      message: 'Reconexão solicitada',
      raw: evolutionData, // Inclui dados brutos para debug
    };

    console.log(`📤 [POST /status] Resposta FINAL que será enviada ao frontend (SEM CORTES):`, JSON.stringify(responseData, null, 2));

    return successResponse(responseData);
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

