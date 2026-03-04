/**
 * Netlify Scheduled Function: check-instances-status
 * 
 * Roda a cada 5 minutos (configurado no netlify.toml)
 * Verifica o status de todas as instâncias ativas e atualiza no banco de dados
 * 
 * Usa a mesma lógica do endpoint /api/instances/[instanceName]/status
 * Processa em lotes para escalabilidade (evita sobrecarga na Evolution API)
 * 
 * Fluxo:
 * 1. Busca todas as instâncias ativas (is_active = true)
 * 2. Processa em lotes (BATCH_SIZE instâncias por vez)
 * 3. Para cada instância, usa evolutionService.getConnectionState() e extractState()
 * 4. Atualiza status no banco usando a mesma lógica do endpoint de verificação
 * 5. Loga resultados para monitoramento
 */

import { createClient } from '@supabase/supabase-js';

// Tipo para o handler do Netlify
interface HandlerEvent {
  httpMethod?: string;
  path?: string;
  headers?: Record<string, string>;
  body?: string;
  queryStringParameters?: Record<string, string>;
}

interface HandlerContext {
  functionName?: string;
  requestId?: string;
}

interface HandlerResponse {
  statusCode: number;
  body: string;
  headers?: Record<string, string>;
}

type Handler = (event: HandlerEvent, context: HandlerContext) => Promise<HandlerResponse>;

// Configurações de escalabilidade
const BATCH_SIZE = 10; // Processa 10 instâncias por vez
const BATCH_DELAY_MS = 1000; // Delay de 1 segundo entre lotes (evita rate limit)
const REQUEST_TIMEOUT_MS = 10000; // Timeout de 10 segundos por requisição

// Cria cliente Supabase com service role key
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error('Variáveis de ambiente SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórias');
}

const supabaseServiceRole = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: { persistSession: false },
});

// Função auxiliar para normalizar base_url (mesma do evolutionService)
function normalizeBaseUrl(baseUrl: string): string {
  if (!baseUrl) return '';
  return baseUrl
    .replace(/\/+$/, '') // Remove barras finais
    .replace(/([^:]\/)\/+/g, '$1'); // Remove barras duplas (preservando ://)
}

// Função auxiliar para extrair estado (mesma lógica do evolutionService.extractState)
function extractState(data: any): 'connected' | 'connecting' | 'disconnected' | 'unknown' {
  // Se tem base64, significa que está aguardando QR code = connecting
  if (data?.base64 || data?.qrcode?.base64 || data?.qrcode) {
    return 'connecting';
  }
  
  // Tenta extrair o estado de diferentes formatos de resposta
  const raw = (data?.instance?.state ?? 
               data?.instance?.status ??
               data?.instancee?.status ??
               data?.state ?? 
               data?.connection?.state ?? 
               data?.status ?? 
               data?.data?.state ??
               data?.data?.status ??
               data?.response?.state ??
               data?.response?.status ??
               '')
    .toString()
    .toLowerCase();
  
  // Se não encontrou estado, verifica campos alternativos
  if (!raw || raw === 'null' || raw === 'undefined' || raw === '') {
    if (data?.instancee?.status) {
      const instanceStatus = data.instancee.status.toString().toLowerCase();
      if (instanceStatus === 'open' || instanceStatus === 'connected' || instanceStatus === 'ready') return 'connected';
      if (instanceStatus === 'connecting') return 'connecting';
      if (instanceStatus === 'close' || instanceStatus === 'closed' || instanceStatus === 'disconnected') return 'disconnected';
    }
    if (data?.base64 || data?.qrcode || data?.qrcode?.base64 || data?.qrcode?.code) {
      return 'connecting';
    }
    if (data?.instance && !data?.instance?.state && !data?.instance?.status) {
      return 'disconnected';
    }
    return 'disconnected';
  }
  
  // Mapeia estados conhecidos
  if (raw === 'open' || raw === 'connected' || raw === 'ready' || raw === 'online') {
    return 'connected';
  }
  if (['connecting', 'pairing', 'qrcode', 'qr', 'waiting_qr', 'waiting', 'pairing_code'].includes(raw)) {
    return 'connecting';
  }
  if (['close', 'closed', 'disconnected', 'logout', 'offline'].includes(raw)) {
    return 'disconnected';
  }
  
  return 'unknown';
}

// Notifica dono da instância via Loto Assistente quando desconecta (não bloqueia; falhas só são logadas)
async function notifyDisconnectViaLoto(instance: { instance_name: string; user_id?: string }, workerId: string) {
  if (!instance.user_id) return;
  try {
    const { data: instanceRow } = await supabaseServiceRole.from('system_settings').select('value').eq('key', 'loto_assistencia_instance_id').maybeSingle();
    const lotoInstanceId = instanceRow?.value;
    if (!lotoInstanceId) return;

    const { data: lotoInst, error: lotoErr } = await supabaseServiceRole
      .from('evolution_instances')
      .select('instance_name, apikey, evolution_apis ( base_url, api_key_global )')
      .eq('id', lotoInstanceId)
      .single();
    if (lotoErr || !lotoInst) return;
    const apis = (lotoInst as any).evolution_apis;
    const baseUrl = Array.isArray(apis) ? apis[0]?.base_url : apis?.base_url;
    const apikey = (lotoInst as any).apikey || (Array.isArray(apis) ? apis[0]?.api_key_global : apis?.api_key_global);
    if (!baseUrl || !apikey) return;

    const { data: profile } = await supabaseServiceRole.from('profiles').select('telefone').eq('id', instance.user_id).single();
    const phone = profile?.telefone?.trim();
    if (!phone || phone.length < 10) return;

    let template = '⚠️ *Zaploto*: A instância *{{NomeInstancia}}* foi desconectada. Status: {{Status}}. Acesse o painel para reconectar.';
    const { data: msgRow } = await supabaseServiceRole.from('system_settings').select('value').eq('key', 'loto_assistencia_message_instance_disconnected').maybeSingle();
    if (msgRow?.value && typeof msgRow.value === 'string') template = msgRow.value;
    const text = template.replace(/\{\{NomeInstancia\}\}/g, instance.instance_name).replace(/\{\{Status\}\}/g, 'desconectada');

    let num = phone.replace(/\D/g, '');
    if (num.length >= 10 && num.length <= 11 && !num.startsWith('55')) num = '55' + num;
    const remoteJid = num.includes('@') ? num : `${num}@s.whatsapp.net`;
    const url = `${baseUrl.replace(/\/+$/, '')}/message/sendText/${(lotoInst as any).instance_name}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey },
      body: JSON.stringify({ number: remoteJid, text }),
    });
    if (!res.ok) throw new Error(`${res.status}`);
    console.log(`[WORKER ${workerId}] 📲 Aviso de desconexão (Loto) enviado para usuário da instância ${instance.instance_name}`);
  } catch (e: any) {
    console.warn(`[WORKER ${workerId}] ⚠️ Falha ao enviar aviso Loto (${instance.instance_name}):`, e?.message || e);
  }
}

// Verifica status de uma instância usando a mesma lógica do endpoint /api/instances/[instanceName]/status
async function checkInstanceStatus(instance: any, workerId: string): Promise<{ success: boolean; newStatus: string; state?: string; error?: string }> {
  try {
    const evolutionApi = Array.isArray(instance.evolution_apis) 
      ? instance.evolution_apis[0] 
      : instance.evolution_apis;

    if (!evolutionApi?.base_url || !evolutionApi?.api_key_global) {
      return { 
        success: false, 
        newStatus: instance.status,
        error: 'Evolution API sem base_url ou api_key_global configurada' 
      };
    }

    // Usa a mesma lógica do evolutionService.getConnectionState()
    const normalizedBaseUrl = normalizeBaseUrl(evolutionApi.base_url);
    const url = `${normalizedBaseUrl}/instance/connectionState/${instance.instance_name}`;
    const finalUrl = url.replace(/([^:]\/)\/+/g, '$1');
    
    // Timeout de 10 segundos para verificação de status
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, REQUEST_TIMEOUT_MS);

    const response = await fetch(finalUrl, {
      method: 'GET',
      headers: {
        apikey: evolutionApi.api_key_global,
      },
      cache: 'no-store',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      console.warn(`[WORKER ${workerId}] ⚠️ Erro ao verificar status da instância ${instance.instance_name}: ${response.status} ${response.statusText}`);
      
      // Se erro 404, pode indicar que a instância não existe mais na Evolution API
      if (response.status === 404) {
        return { 
          success: true, 
          newStatus: 'disconnected',
          state: 'disconnected',
          error: 'Instância não encontrada na Evolution API' 
        };
      }
      
      // Para outros erros, mantém o status atual
      return { 
        success: false, 
        newStatus: instance.status,
        error: `Erro HTTP ${response.status}: ${errorText.substring(0, 100)}` 
      };
    }

    const evolutionData = await response.json().catch(async () => {
      const textResult = await response.text().catch(() => '');
      return { raw: textResult };
    });

    // Usa a mesma lógica do evolutionService.extractState()
    const state = extractState(evolutionData);
    
    // Mapeia status da Evolution API para o banco (mesma lógica do endpoint /api/instances/[instanceName]/status)
    // 'ok' no banco = somente quando WhatsApp está realmente conectado
    // 'connecting' = QR code gerado, aguardando escanear
    // 'disconnected' no banco = desconectado
    let newStatus: string;
    const wasConnected = instance.status === 'ok';

    if (state === 'connected') {
      newStatus = 'ok';
    } else if (state === 'connecting') {
      newStatus = 'connecting';
    } else if (state === 'disconnected') {
      newStatus = 'disconnected';
    } else {
      // Estado desconhecido - mantém o atual
      newStatus = instance.status;
    }

    return { success: true, newStatus, state };
  } catch (error: any) {
    const errorMsg = error?.message || String(error);
    
    // Se for timeout ou erro de conexão, pode indicar que a instância está desconectada
    if (errorMsg.includes('aborted') || errorMsg.includes('timeout') || errorMsg.includes('ECONNREFUSED')) {
      console.warn(`[WORKER ${workerId}] ⚠️ Timeout/erro de conexão ao verificar ${instance.instance_name} - marcando como desconectada`);
      return { 
        success: true, 
        newStatus: 'disconnected',
        state: 'disconnected',
        error: `Erro de conexão: ${errorMsg.substring(0, 100)}` 
      };
    }
    
    // Para outros erros, mantém o status atual
    return { 
      success: false, 
      newStatus: instance.status,
      error: errorMsg.substring(0, 200) 
    };
  }
}

// Handler principal do Netlify Scheduled Function
export const handler: Handler = async (event, context) => {
  const WORKER_ID = `status-checker-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const startTime = new Date().toISOString();

  // Valida e cria cliente Supabase dentro do handler
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    const errorMsg = `Variáveis de ambiente obrigatórias não encontradas`;
    console.error(`[WORKER ${WORKER_ID}] ❌ ${errorMsg}`);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: errorMsg,
        workerId: WORKER_ID,
        timestamp: startTime,
      }),
    };
  }

  const supabaseServiceRole = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false },
  });

  try {
    console.log(`[WORKER ${WORKER_ID}] 🔍 Iniciando verificação de status das instâncias...`);

    // Busca todas as instâncias ativas (inclui maturation_type para iniciar auto maturação virgem)
    const { data: instances, error: instancesError } = await supabaseServiceRole
      .from('evolution_instances')
      .select(`
        id,
        instance_name,
        status,
        user_id,
        is_active,
        maturation_type,
        maturation_status,
        evolution_apis!inner (
          id,
          base_url,
          api_key_global,
          is_active
        )
      `)
      .eq('is_active', true)
      .eq('evolution_apis.is_active', true)
      .not('evolution_apis.api_key_global', 'is', null);

    if (instancesError) {
      console.error(`[WORKER ${WORKER_ID}] ❌ Erro ao buscar instâncias: ${instancesError.message}`);
      return {
        statusCode: 500,
        body: JSON.stringify({ 
          error: `Erro ao buscar instâncias: ${instancesError.message}`,
          workerId: WORKER_ID,
          timestamp: startTime,
        }),
      };
    }

    if (!instances || instances.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({ 
          message: 'Nenhuma instância ativa encontrada', 
          processed: 0,
          workerId: WORKER_ID,
          timestamp: startTime,
        }),
      };
    }

    console.log(`[WORKER ${WORKER_ID}] 📋 Encontradas ${instances.length} instância(s) ativa(s)`);

    // Processa em lotes para escalabilidade (evita sobrecarga na Evolution API)
    const results: any[] = [];
    const totalBatches = Math.ceil(instances.length / BATCH_SIZE);
    
    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      const batchStart = batchIndex * BATCH_SIZE;
      const batchEnd = Math.min(batchStart + BATCH_SIZE, instances.length);
      const batch = instances.slice(batchStart, batchEnd);
      
      console.log(`[WORKER ${WORKER_ID}] 📦 Processando lote ${batchIndex + 1}/${totalBatches} (${batch.length} instância(s))`);
      
      // Processa lote em paralelo
      const batchResults = await Promise.allSettled(
        batch.map(async (instance: any) => {
          const result = await checkInstanceStatus(instance, WORKER_ID);
          
          // Atualiza status no banco se mudou (mesma lógica do endpoint /api/instances/[instanceName]/status)
          if (result.success && result.newStatus !== instance.status) {
            const updatePayload: Record<string, unknown> = {
              status: result.newStatus,
              updated_at: new Date().toISOString(),
            };
            // Se acabou de conectar e é virgem: inicia auto maturação (5 dias, bloqueada). Auto maturador = mesmo fluxo do maturador manual, automático para tipo virgem.
            if (result.newStatus === 'ok' && instance.maturation_type === 'virgem' && !instance.maturation_status) {
              const now = new Date();
              const endsAt = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);
              updatePayload.maturation_status = 'waiting_connection_test';
              updatePayload.maturation_started_at = now.toISOString();
              updatePayload.maturation_ends_at = endsAt.toISOString();
              updatePayload.maturation_phase_started_at = now.toISOString();
              updatePayload.current_day = 1;
              updatePayload.is_locked = true;
              console.log(`[AUTO-MATURADOR] Instância virgem ${instance.instance_name} conectada → entrou em auto maturação (5 dias) status=waiting_connection_test`);
            }
            const { error: updateError } = await supabaseServiceRole
              .from('evolution_instances')
              .update(updatePayload)
              .eq('id', instance.id);

            if (updateError) {
              console.error(`[WORKER ${WORKER_ID}] ❌ Erro ao atualizar status da instância ${instance.instance_name}: ${updateError.message}`);
              return {
                instanceName: instance.instance_name,
                oldStatus: instance.status,
                newStatus: result.newStatus,
                state: result.state,
                updated: false,
                error: updateError.message,
              };
            }

            console.log(`[WORKER ${WORKER_ID}] ✅ Instância ${instance.instance_name}: ${instance.status} → ${result.newStatus} (${result.state})`);
            if (result.newStatus === 'disconnected' && instance.status === 'ok' && instance.user_id) {
              notifyDisconnectViaLoto({ instance_name: instance.instance_name, user_id: instance.user_id }, WORKER_ID).catch(() => {});
            }
            return {
              instanceName: instance.instance_name,
              oldStatus: instance.status,
              newStatus: result.newStatus,
              state: result.state,
              updated: true,
            };
          } else if (result.success) {
            // Status não mudou, mas verificação foi bem-sucedida
            return {
              instanceName: instance.instance_name,
              oldStatus: instance.status,
              newStatus: result.newStatus,
              state: result.state,
              updated: false,
              message: 'Status já estava correto',
            };
          } else {
            // Erro na verificação
            console.warn(`[WORKER ${WORKER_ID}] ⚠️ Erro ao verificar ${instance.instance_name}: ${result.error}`);
            return {
              instanceName: instance.instance_name,
              oldStatus: instance.status,
              newStatus: instance.status,
              updated: false,
              error: result.error,
            };
          }
        })
      );
      
      // Adiciona resultados do lote
      results.push(...batchResults);
      
      // Delay entre lotes (exceto no último lote)
      if (batchIndex < totalBatches - 1) {
        await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
      }
    }

    // Processa resultados
    const processed = results.length;
    const updated = results.filter(r => r.status === 'fulfilled' && r.value.updated).length;
    const errors = results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && r.value.error)).length;
    
    const details = results.map(r => {
      if (r.status === 'fulfilled') {
        return r.value;
      } else {
        return {
          error: r.reason?.message || 'Erro desconhecido',
        };
      }
    });

    const endTime = new Date().toISOString();
    const duration = Date.now() - new Date(startTime).getTime();

    console.log(`[WORKER ${WORKER_ID}] ✅ Verificação concluída: ${processed} instância(s) verificada(s), ${updated} atualizada(s), ${errors} erro(s)`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Verificação de status concluída',
        processed,
        updated,
        errors,
        details,
        workerId: WORKER_ID,
        startTime,
        endTime,
        duration: `${duration}ms`,
      }),
    };
  } catch (error: any) {
    const endTime = new Date().toISOString();
    console.error(`[WORKER ${WORKER_ID}] ❌ ERRO FATAL: ${error?.message || 'Erro desconhecido'}`);
    
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: error?.message || 'Erro desconhecido',
        workerId: WORKER_ID,
        startTime,
        endTime,
        stack: error?.stack,
      }),
    };
  }
};

