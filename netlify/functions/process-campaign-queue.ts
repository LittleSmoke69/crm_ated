/**
 * Netlify Scheduled Function: process-campaign-queue
 * 
 * Roda a cada 1 minuto (configurado no netlify.toml)
 * Processa jobs da fila campaign_contacts que estão devidos (scheduled_at <= now)
 * 
 * Fluxo:
 * 1. Filtra campanhas ativas com status 'running'
 * 2. Busca jobs devidos (campaign_contacts) apenas das campanhas ativas
 * 3. Para cada job, chama Evolution API para adicionar ao grupo
 * 4. Atualiza status do job (success/failed)
 * 5. Atualiza agregados (campaigns, campaign_groups)
 * 6. Finaliza campanha se não houver mais jobs pendentes
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

// Cliente Supabase inicializado lazy dentro do handler para evitar throw no top-level.
// Se env estiver faltando, o handler retorna 500 em vez de crashar o cold start inteiro.
let _supabaseClient: any = null;

function getSupabase(): any {
  if (_supabaseClient) return _supabaseClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key) {
    throw new Error('ENV AUSENTE: SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórias para process-campaign-queue');
  }
  _supabaseClient = createClient(url, key, { auth: { persistSession: false } });
  return _supabaseClient;
}

// Configurações
const BATCH_LIMIT = 20; // Máximo de jobs por execução
const LOCK_TTL_MINUTES = 3; // TTL do lock (recupera jobs travados após 3 min)
const FETCH_TIMEOUT_MS = 25000; // Timeout para Evolution API

// Função auxiliar para normalizar telefone
function normalizePhoneNumber(phone: string): string {
  if (!phone) return '';
  let cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('5555')) {
    cleaned = cleaned.substring(2);
  }
  if (cleaned.startsWith('55') && !cleaned.startsWith('5555')) {
    return cleaned;
  }
  return `55${cleaned}`;
}

// Função auxiliar para buscar string em objeto aninhado (incluindo arrays)
function containsStringInObject(obj: any, searchString: string): boolean {
  if (!obj) return false;
  
  // Se for string, verifica diretamente
  if (typeof obj === 'string') {
    return obj.includes(searchString);
  }
  
  // Se for array, verifica cada elemento
  if (Array.isArray(obj)) {
    return obj.some(item => containsStringInObject(item, searchString));
  }
  
  // Se for objeto, verifica cada propriedade
  if (typeof obj === 'object') {
    return Object.values(obj).some(value => containsStringInObject(value, searchString));
  }
  
  return false;
}

// Busca instâncias disponíveis da campanha
async function getAvailableInstances(
  userId: string,
  preferUserBinding: boolean,
  allowedInstanceNames: string[]
): Promise<any[]> {
  if (!allowedInstanceNames || allowedInstanceNames.length === 0) {
    return [];
  }

  // Query base: instâncias ativas e conectadas
  let query = getSupabase()
    .from('evolution_instances')
    .select(`
      *,
      evolution_apis!inner (
        id,
        name,
        base_url,
        is_active
      )
    `)
    .eq('is_active', true)
    .eq('status', 'ok')
    .eq('evolution_apis.is_active', true)
    .or('is_locked.is.null,is_locked.eq.false')
    .not('apikey', 'is', null)
    .in('instance_name', allowedInstanceNames);

  // Se preferUserBinding, tenta priorizar instâncias do usuário
  if (preferUserBinding && userId) {
    const { data: userBindings } = await getSupabase()
      .from('user_evolution_apis')
      .select('evolution_api_id')
      .eq('user_id', userId);

    if (userBindings && userBindings.length > 0) {
      const userApiIds = (userBindings as Array<{ evolution_api_id: string | number }>)
        .map((b) => b.evolution_api_id);
      query = query.in('evolution_api_id', userApiIds);
    }
  }

  const { data: candidates, error } = await query;

  if (error || !candidates || candidates.length === 0) {
    return [];
  }

  // Filtra por cooldown, daily_limit e bloqueio (maturação virgem)
  const available = candidates.filter((inst: any) => {
    if (inst.is_locked === true) return false;
    if (inst.cooldown_until && new Date(inst.cooldown_until) > new Date()) return false;
    if (inst.daily_limit !== null && inst.sent_today >= inst.daily_limit) return false;
    return true;
  });

  return available;
}

// Seleciona instância baseado no distributionMode
// distributionMode: 'sequential' ou 'random'
// position: posição do job na campanha (para distribuição sequencial)
async function pickInstanceByDistribution(
  userId: string,
  preferUserBinding: boolean,
  allowedInstanceNames: string[],
  distributionMode: 'sequential' | 'random',
  position: number
): Promise<any> {
  const available = await getAvailableInstances(userId, preferUserBinding, allowedInstanceNames);

  if (available.length === 0) {
    return null;
  }

  // Ordena instâncias pelo nome para garantir ordem consistente na distribuição sequencial
  const sortedInstances = available.sort((a: any, b: any) => {
    return a.instance_name.localeCompare(b.instance_name);
  });

  if (distributionMode === 'sequential') {
    // Distribuição sequencial: rotaciona entre instâncias baseado na posição
    // Ex: posição 0 -> instância 0, posição 1 -> instância 1, posição 2 -> instância 2, posição 3 -> instância 0...
    const instanceIndex = position % sortedInstances.length;
    return sortedInstances[instanceIndex];
  } else {
    // Distribuição aleatória: escolhe aleatoriamente entre disponíveis
    const randomIndex = Math.floor(Math.random() * sortedInstances.length);
    return sortedInstances[randomIndex];
  }
}

// Seleciona melhor instância Evolution disponível (modo padrão/fallback)
async function pickBestInstance(
  userId: string, 
  preferUserBinding: boolean,
  allowedInstanceNames?: string[]
): Promise<any> {
  if (!allowedInstanceNames || allowedInstanceNames.length === 0) {
    return null;
  }

  const available = await getAvailableInstances(userId, preferUserBinding, allowedInstanceNames);

  if (available.length === 0) {
    return null;
  }

  // Seleciona a melhor (menor sent_today, mais tempo desde último uso)
  const best = available.sort((a: any, b: any) => {
    const scoreA = (1 / (a.sent_today + 1)) + (a.last_used_at ? (Date.now() - new Date(a.last_used_at).getTime()) / 1000 : 999);
    const scoreB = (1 / (b.sent_today + 1)) + (b.last_used_at ? (Date.now() - new Date(b.last_used_at).getTime()) / 1000 : 999);
    return scoreB - scoreA;
  })[0];

  return best;
}

// Processa um job individual
async function processJob(job: any, workerId: string): Promise<{ success: boolean; error?: string }> {
  const { id, campaign_id, campaign_group_id, phone, contact_id, user_id, attempts, position } = job;
  try {
    // CRÍTICO: Reivindica o job atomicamente antes de qualquer operação externa.
    // Se dois workers rodarem ao mesmo tempo e buscarem o mesmo job (queued),
    // apenas um conseguirá fazer este UPDATE (PostgreSQL garante atomicidade).
    // O outro receberá 0 linhas e retornará sem processar — eliminando envios duplicados.
    const { data: claimed, error: claimErr } = await getSupabase()
      .from('campaign_contacts')
      .update({
        status: 'processing',
        locked_at: new Date().toISOString(),
        locked_by: workerId,
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('status', 'queued') // Condição atômica: só atualiza se ainda estiver queued
      .select('id')
      .single();

    if (claimErr || !claimed) {
      // Outro worker já reivindicou este job — pula sem erro
      console.log(`[WORKER ${workerId}] Job ${id}: já reivindicado por outro worker, pulando.`);
      return { success: false, error: 'Job já reivindicado por outro worker' };
    }

    // Busca dados da campanha e grupo
    const results = await Promise.all([
      getSupabase()
        .from('campaigns')
        .select('strategy, instances, group_id')
        .eq('id', campaign_id)
        .single(),
      getSupabase()
        .from('campaign_groups')
        .select('group_jid, group_subject')
        .eq('id', campaign_group_id)
        .single(),
    ]);
    const campaignResult = results[0] as { data: any; error: { message?: string } | null };
    const groupResult = results[1] as { data: any; error: { message?: string } | null };

    if (campaignResult.error || !campaignResult.data) {
      throw new Error(`Campanha não encontrada: ${campaignResult.error?.message}`);
    }

    if (groupResult.error || !groupResult.data) {
      throw new Error(`Grupo não encontrado: ${groupResult.error?.message}`);
    }

    const campaign = campaignResult.data;
    const group = groupResult.data;
    const strategy = campaign.strategy || {};
    const preferUserBinding = strategy.preferUserBinding === true;

    // CRÍTICO: Pega o array de instâncias permitidas da campanha
    const allowedInstances = campaign.instances || [];
    
    if (!Array.isArray(allowedInstances) || allowedInstances.length === 0) {
      throw new Error('Campanha sem instâncias configuradas (coluna instances vazia ou inválida)');
    }

    // Seleciona instância baseado no distributionMode
    const distributionMode = strategy.distributionMode || 'sequential';
    const instance = await pickInstanceByDistribution(
      user_id,
      preferUserBinding,
      allowedInstances,
      distributionMode,
      position || 0
    );

    if (!instance) {
      // Verifica se há instâncias disponíveis (mas não estão ok)
      const availableInstances = await getAvailableInstances(user_id, preferUserBinding, allowedInstances);
      
      if (availableInstances.length === 0 && allowedInstances.length === 1) {
        // Se só tem uma instância e ela não está disponível, PAUSA a campanha
        console.warn(`[WORKER ${workerId}] ⏸️ Última instância da campanha não está disponível. Pausando campanha ${campaign_id}.`);
        
        await getSupabase()
          .from('campaigns')
          .update({
            status: 'paused',
            observation: `Campanha pausada automaticamente: Última instância não está disponível.`,
            updated_at: new Date().toISOString(),
          })
          .eq('id', campaign_id);

        // Marca job como failed - sem retry
        await getSupabase()
          .from('campaign_contacts')
          .update({
            status: 'failed',
            finished_at: new Date().toISOString(),
            last_error: 'Última instância não está disponível. Campanha pausada automaticamente.',
            updated_at: new Date().toISOString(),
          })
          .eq('id', id);

        return { success: false, error: 'Última instância não está disponível. Campanha pausada automaticamente.' };
      } else if (availableInstances.length === 0) {
        // Múltiplas instâncias configuradas mas nenhuma disponível - PAUSA a campanha
        console.warn(`[WORKER ${workerId}] ⏸️ Todas as instâncias da campanha estão indisponíveis. Pausando campanha ${campaign_id}.`);
        
        await getSupabase()
          .from('campaigns')
          .update({
            status: 'paused',
            observation: `Campanha pausada automaticamente: Todas as instâncias estão indisponíveis no momento.`,
            updated_at: new Date().toISOString(),
          })
          .eq('id', campaign_id);

        // Marca job como failed - sem retry
        await getSupabase()
          .from('campaign_contacts')
          .update({
            status: 'failed',
            finished_at: new Date().toISOString(),
            last_error: 'Todas as instâncias estão indisponíveis. Campanha pausada automaticamente.',
            updated_at: new Date().toISOString(),
          })
          .eq('id', id);

        return { success: false, error: 'Todas as instâncias estão indisponíveis. Campanha pausada automaticamente.' };
      }
      
      // Caso genérico - não deveria chegar aqui, mas trata como erro temporário
      throw new Error('Nenhuma instância disponível');
    }

    // Extrai dados da Evolution API (já vem no join do pickBestInstance)
    const evolutionApi = Array.isArray(instance.evolution_apis) 
      ? instance.evolution_apis[0] 
      : instance.evolution_apis;

    if (!evolutionApi || !evolutionApi.base_url) {
      throw new Error('Evolution API não encontrada ou base_url não configurado');
    }

    // Busca apikey da instância (campo apikey da tabela evolution_instances)
    const instanceApikey = instance.apikey;
    
    if (!instanceApikey) {
      throw new Error('Instância sem apikey configurada na tabela evolution_instances');
    }

    const normalizedPhone = normalizePhoneNumber(phone);
    const groupJid = group.group_jid;

    // Normaliza base_url da Evolution API (remove barras finais e duplas)
    const normalizedBaseUrl = evolutionApi.base_url
      .replace(/\/+$/, '') // Remove barras finais
      .replace(/([^:]\/)\/+/g, '$1'); // Remove barras duplas (preservando ://)
    
    // Monta URL completa para adicionar participante
    const url = `${normalizedBaseUrl}/group/updateParticipant/${instance.instance_name}?groupJid=${encodeURIComponent(groupJid)}`;
    
    const requestBody = {
      action: 'add',
      participants: [normalizedPhone],
    };

    // Timeout de 25 segundos
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, FETCH_TIMEOUT_MS);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: instanceApikey,
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const responseText = await response.text();
    let responseData: any = {};
    
    try {
      responseData = JSON.parse(responseText);
    } catch {
      responseData = { message: responseText };
    }

    if (response.ok) {
      // Valida se realmente adicionou verificando a resposta da API
      const statusCode = responseData?.updateParticipants?.[0]?.status;
      const isSuccess = statusCode === '200' || statusCode === 200 || (!statusCode && response.ok);

      if(statusCode === '409' || !isSuccess){
        const errorMsg = responseData?.message || responseText || `Status: ${statusCode}`;
        console.warn(`[WORKER ${workerId}] Job ${id}: ⚠️ Contato não foi adicionado. Status: ${statusCode}`);

        // Marca como failed imediatamente - sem retry
        await getSupabase()
          .from('campaign_contacts')
          .update({
            status: 'failed',
            finished_at: new Date().toISOString(),
            last_error: errorMsg,
            updated_at: new Date().toISOString(),
          })
          .eq('id', id);

        // Atualiza contato na tabela searches
        if (contact_id) {
          await getSupabase()
            .from('searches')
            .update({
              status: 'erro',
              updated_at: new Date().toISOString(),
            })
            .eq('id', contact_id);
        }

        return { success: false, error: errorMsg };
      }
      
      // Sucesso confirmado - atualiza job para success
      await getSupabase()
        .from('campaign_contacts')
        .update({
          status: 'success',
          finished_at: new Date().toISOString(),
          instance_name: instance.instance_name,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);

      // Atualiza contato na tabela searches
      if (contact_id) {
        await getSupabase()
          .from('searches')
          .update({
            status_add_gp: true,
            status: 'added',
            updated_at: new Date().toISOString(),
          })
          .eq('id', contact_id);
      }

      // Registra uso do rate limit (atualiza contador diário)
      // Nota: rateLimitService pode ser implementado diretamente aqui se necessário

      return { success: true };
    } else {
      const errorMsg = responseData.message || responseText || `HTTP ${response.status}`;
      
      // Verifica se contém "Connection Closed" em qualquer lugar da resposta
      const isConnectionClosed = 
        containsStringInObject(responseData, 'Connection Closed') ||
        containsStringInObject(responseData, 'blocked-integrity-enforcement') ||
        (typeof responseText === 'string' && responseText.includes('Connection Closed')) ||
        (typeof errorMsg === 'string' && errorMsg.includes('Connection Closed'));
      
      if (isConnectionClosed) {
        console.warn(`[WORKER ${workerId}] ⚠️ Possível "Connection Closed" detectado na instância ${instance.instance_name}. Verificando status real...`);
        
        // CRÍTICO: Verifica o status REAL da instância antes de marcar como desconectada
        // Pode ser apenas um erro temporário na requisição específica
        try {
          // Extrai dados da Evolution API (já vem no join do pickBestInstance)
          const evolutionApi = Array.isArray(instance.evolution_apis) 
            ? instance.evolution_apis[0] 
            : instance.evolution_apis;

          if (evolutionApi?.base_url) {
            // Busca api_key_global para verificar status
            const { data: apiData } = await getSupabase()
              .from('evolution_apis')
              .select('api_key_global')
              .eq('id', evolutionApi.id)
              .single();

            if (apiData?.api_key_global) {
              // Verifica o status real na Evolution API
              const normalizedBaseUrl = evolutionApi.base_url.replace(/\/+$/, '').replace(/([^:]\/)\/+/g, '$1');
              const statusUrl = `${normalizedBaseUrl}/instance/connectionState/${instance.instance_name}`;
              
              const statusResponse = await fetch(statusUrl, {
                method: 'GET',
                headers: {
                  apikey: apiData.api_key_global,
                },
                cache: 'no-store',
              });

              if (statusResponse.ok) {
                const statusData = await statusResponse.json();
                
                // Extrai estado (simplificado - similar ao evolutionService.extractState)
                const stateRaw = (statusData?.instance?.status || statusData?.state || statusData?.connection?.state || '').toString().toLowerCase();
                const hasQrCode = !!(statusData?.base64 || statusData?.qrcode?.base64 || statusData?.qrcode);
                
                let realState: 'connected' | 'connecting' | 'disconnected' | 'unknown' = 'unknown';
                if (hasQrCode) {
                  realState = 'connecting';
                } else if (stateRaw === 'open' || stateRaw === 'connected' || stateRaw === 'ready' || stateRaw === 'online') {
                  realState = 'connected';
                } else if (stateRaw === 'close' || stateRaw === 'closed' || stateRaw === 'disconnected' || stateRaw === 'logout' || stateRaw === 'offline') {
                  realState = 'disconnected';
                }

                console.log(`[WORKER ${workerId}] 🔍 Status real da instância ${instance.instance_name}: ${realState}`);

                // Só marca como desconectada se o status REAL confirmar
                if (realState === 'disconnected') {
                  console.error(`[WORKER ${workerId}] 🔌 Status REAL confirmado: Instância ${instance.instance_name} está DESCONECTADA.`);
                  
                  // Desliga a instância que realmente caiu
                  await getSupabase()
                    .from('evolution_instances')
                    .update({
                      status: 'disconnected',
                      is_active: false,
                      updated_at: new Date().toISOString(),
                    })
                    .eq('instance_name', instance.instance_name);
                } else {
                  // Instância ainda está conectada - pode ser apenas um erro temporário
                  console.log(`[WORKER ${workerId}] ✅ Status REAL: Instância ${instance.instance_name} ainda está ${realState === 'connected' ? 'CONECTADA' : 'CONECTANDO'}. Não marcando como desconectada.`);
                  
                  // Marca job como failed - sem retry
                  await getSupabase()
                    .from('campaign_contacts')
                    .update({
                      status: 'failed',
                      finished_at: new Date().toISOString(),
                      last_error: `Erro temporário na requisição. Instância ainda está ${realState}.`,
                      updated_at: new Date().toISOString(),
                    })
                    .eq('id', id);

                  // Atualiza contato na tabela searches
                  if (contact_id) {
                    await getSupabase()
                      .from('searches')
                      .update({
                        status: 'erro',
                        updated_at: new Date().toISOString(),
                      })
                      .eq('id', contact_id);
                  }

                  return { success: false, error: `Erro temporário. Instância ainda está ${realState}.` };
                }
              }
            }
          }
        } catch (verifyError: any) {
          // Se não conseguir verificar, não marca como desconectada
          console.error(`[WORKER ${workerId}] ❌ Erro ao verificar status real da instância ${instance.instance_name}:`, verifyError.message);
          console.log(`[WORKER ${workerId}] ⚠️ Não marcando como desconectada por segurança - pode ser erro temporário.`);
          
          // Marca job como failed - sem retry
          await getSupabase()
            .from('campaign_contacts')
            .update({
              status: 'failed',
              finished_at: new Date().toISOString(),
              last_error: `Erro temporário. Não foi possível verificar status da instância.`,
              updated_at: new Date().toISOString(),
            })
            .eq('id', id);

          // Atualiza contato na tabela searches
          if (contact_id) {
            await getSupabase()
              .from('searches')
              .update({
                status: 'erro',
                updated_at: new Date().toISOString(),
              })
              .eq('id', contact_id);
          }

          return { success: false, error: 'Erro temporário. Não foi possível verificar status da instância.' };
        }

        // Verifica se há outras instâncias disponíveis na campanha
        const remainingInstances = allowedInstances.filter(name => name !== instance.instance_name);
        const availableRemaining = await getAvailableInstances(user_id, preferUserBinding, remainingInstances);

        // Atualiza a campanha removendo a instância que caiu
        if (remainingInstances.length > 0) {
          await getSupabase()
            .from('campaigns')
            .update({
              instances: remainingInstances,
              updated_at: new Date().toISOString(),
            })
            .eq('id', campaign_id);

          console.log(`🔄 [WORKER ${workerId}] Instância ${instance.instance_name} removida da campanha. Restantes: ${remainingInstances.join(', ')}`);

          // Se ainda há instâncias disponíveis, PAUSA a campanha para o usuário decidir
          if (availableRemaining.length > 0) {
            console.warn(`⏸️ [WORKER ${workerId}] Instância ${instance.instance_name} caiu. Pausando campanha automaticamente. Restam ${availableRemaining.length} instância(s) disponível(eis).`);
            
            // PAUSA a campanha automaticamente quando uma instância cai
            await getSupabase()
              .from('campaigns')
              .update({
                status: 'paused',
                observation: `Campanha pausada automaticamente: Instância ${instance.instance_name} desconectou. Restam ${availableRemaining.length} instância(s) disponível(eis).`,
                updated_at: new Date().toISOString(),
              })
              .eq('id', campaign_id);
            
            // Marca job como failed - sem retry
            await getSupabase()
              .from('campaign_contacts')
              .update({
                status: 'failed',
                finished_at: new Date().toISOString(),
                last_error: `Instância ${instance.instance_name} caiu. Campanha pausada automaticamente.`,
                updated_at: new Date().toISOString(),
              })
              .eq('id', id);

            // Atualiza contato na tabela searches
            if (contact_id) {
              await getSupabase()
                .from('searches')
                .update({
                  status: 'erro',
                  updated_at: new Date().toISOString(),
                })
                .eq('id', contact_id);
            }

            return { success: false, error: `Instância ${instance.instance_name} caiu. Campanha pausada automaticamente.` };
          }
        }

        // Se não há mais instâncias disponíveis, PAUSA a campanha (não falha)
        if (remainingInstances.length === 0 || availableRemaining.length === 0) {
          console.warn(`⏸️ [WORKER ${workerId}] Última instância da campanha caiu. Pausando campanha ${campaign_id}`);
          
          await getSupabase()
            .from('campaigns')
            .update({
              status: 'paused',
              observation: remainingInstances.length === 0 
                ? `Campanha pausada automaticamente: Todas as instâncias da campanha caíram. Última: ${instance.instance_name}`
                : `Campanha pausada automaticamente: Todas as instâncias disponíveis da campanha caíram.`,
              updated_at: new Date().toISOString(),
            })
            .eq('id', campaign_id);

          // Marca job como failed - sem retry
          await getSupabase()
            .from('campaign_contacts')
            .update({
              status: 'failed',
              finished_at: new Date().toISOString(),
              last_error: `Instância ${instance.instance_name} caiu. Campanha pausada automaticamente.`,
              updated_at: new Date().toISOString(),
            })
            .eq('id', id);

          // Atualiza contato na tabela searches
          if (contact_id) {
            await getSupabase()
              .from('searches')
              .update({
                status: 'erro',
                updated_at: new Date().toISOString(),
              })
              .eq('id', contact_id);
          }

          return { success: false, error: `Instância ${instance.instance_name} caiu. Campanha pausada automaticamente.` };
        }
      }
      
        if (response.status === 400) {
          const badRequest = errorMsg.includes('bad-request') || errorMsg.includes('Bad Request');

          if (badRequest) {
            // Esgotou tentativas, marca como failed
            await getSupabase()
              .from('campaign_contacts')
              .update({
                status: 'failed',
                finished_at: new Date().toISOString(),
                last_error: errorMsg,
                updated_at: new Date().toISOString(),
              })
              .eq('id', id);

            // Atualiza contato na tabela searches
            if (contact_id) {
              await getSupabase()
                .from('searches')
                .update({
                  status: 'erro',
                  updated_at: new Date().toISOString(),
                })
                .eq('id', contact_id);
            }

            return { success: false, error: errorMsg };
          }

          return { success: false, error: errorMsg };
        }


      // Marca como failed imediatamente - sem retry
      await getSupabase()
        .from('campaign_contacts')
        .update({
          status: 'failed',
          finished_at: new Date().toISOString(),
          last_error: errorMsg,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);

      // Atualiza contato na tabela searches
      if (contact_id) {
        await getSupabase()
          .from('searches')
          .update({
            status: 'erro',
            updated_at: new Date().toISOString(),
          })
          .eq('id', contact_id);
      }

      return { success: false, error: errorMsg };
    }
  } catch (error: any) {
    const errorMsg = error?.message || String(error);
    console.error(`[WORKER ${workerId}] Job ${id}: ❌ ERRO - ${errorMsg}`);

    // Verifica se é um erro de conexão que indica que a instância caiu
    const isConnectionError = 
      errorMsg.toLowerCase().includes('connection closed') ||
      errorMsg.toLowerCase().includes('econnreset') ||
      errorMsg.toLowerCase().includes('socket hang up') ||
      errorMsg.toLowerCase().includes('blocked-integrity-enforcement');

    if (isConnectionError) {
      console.warn(`[WORKER ${workerId}] ⚠️ Erro de conexão crítico no catch - Pausando campanha ${campaign_id}`);
      
      // ⏸️ Pausar a campanha (não falhar)
      await getSupabase()
        .from('campaigns')
        .update({
          status: 'paused',
          observation: `Campanha pausada automaticamente: Erro de conexão - ${errorMsg}. A instância pode ter caído.`,
          updated_at: new Date().toISOString(),
        })
        .eq('id', campaign_id);

      // Marca job como failed - sem retry
      await getSupabase()
        .from('campaign_contacts')
        .update({
          status: 'failed',
          finished_at: new Date().toISOString(),
          last_error: `Erro de conexão: ${errorMsg}. Campanha pausada automaticamente.`,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);

      // Atualiza contato na tabela searches
      if (contact_id) {
        await getSupabase()
          .from('searches')
          .update({
            status: 'erro',
            updated_at: new Date().toISOString(),
          })
          .eq('id', contact_id);
      }

      return { success: false, error: `Erro de conexão. Campanha pausada automaticamente.` };
    }

    // Marca como failed imediatamente - sem retry
    await getSupabase()
      .from('campaign_contacts')
      .update({
        status: 'failed',
        finished_at: new Date().toISOString(),
        last_error: errorMsg,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (contact_id) {
      await getSupabase()
        .from('searches')
        .update({
          status: 'erro',
          updated_at: new Date().toISOString(),
        })
        .eq('id', contact_id);
    }

    return { success: false, error: errorMsg };
  }
}

// Atualiza agregados (campaigns e campaign_groups)
// Recalcula métricas sempre do banco de dados para garantir precisão
async function updateAggregates(campaignId: string, workerId: string): Promise<void> {
  try {
    // Busca TODOS os jobs da campanha diretamente do banco
    // Isso garante que as métricas sejam sempre precisas, mesmo se houver processamentos paralelos
    const { data: jobStats, error: statsError } = await getSupabase()
      .from('campaign_contacts')
      .select('status, campaign_group_id')
      .eq('campaign_id', campaignId);

    if (statsError) {
      console.error(`[WORKER ${workerId}] ❌ Erro ao buscar stats:`, statsError);
      return;
    }

    if (!jobStats || jobStats.length === 0) {
      // Se não há jobs, zera as métricas
      await getSupabase()
        .from('campaigns')
        .update({
          processed_contacts: 0,
          failed_contacts: 0,
          updated_at: new Date().toISOString(),
        })
        .eq('id', campaignId);
      return;
    }

    // Agrega por grupo
    const groupStats = new Map<string, { processed: number; failed: number }>();
    let totalProcessed = 0;
    let totalFailed = 0;

    let queuedCount = 0;

    jobStats.forEach((job: any) => {
      if (!job.campaign_group_id) return;
      
      if (!groupStats.has(job.campaign_group_id)) {
        groupStats.set(job.campaign_group_id, { processed: 0, failed: 0 });
      }
      const stats = groupStats.get(job.campaign_group_id)!;
      
      // Conta apenas jobs finalizados (success ou failed)
      // Jobs com status 'queued' não são contabilizados ainda
      if (job.status === 'success') {
        stats.processed++;
        totalProcessed++;
      } else if (job.status === 'failed') {
        stats.failed++;
        totalFailed++;
      } else if (job.status === 'queued') {
        queuedCount++;
      }
      // Jobs com status 'retry' não existem mais - foram removidos
    });

    // Log detalhado para debug
    console.log(`[WORKER ${workerId}] 📊 Métricas da campanha ${campaignId}: ${totalProcessed} processados, ${totalFailed} falhas, ${queuedCount} em fila, total: ${jobStats.length}`);

    // Atualiza campaign_groups
    for (const [groupId, stats] of groupStats.entries()) {
      const { error: groupError } = await getSupabase()
        .from('campaign_groups')
        .update({
          processed_contacts: stats.processed,
          failed_contacts: stats.failed,
          updated_at: new Date().toISOString(),
        })
        .eq('id', groupId);

      if (groupError) {
        console.error(`[WORKER ${workerId}] ❌ Erro ao atualizar grupo ${groupId}:`, groupError);
      }
    }

    // Atualiza campaigns com os totais recalculados
    const { error: campaignError } = await getSupabase()
      .from('campaigns')
      .update({
        processed_contacts: totalProcessed,
        failed_contacts: totalFailed,
        updated_at: new Date().toISOString(),
      })
      .eq('id', campaignId);

    if (campaignError) {
      console.error(`[WORKER ${workerId}] ❌ Erro ao atualizar campanha ${campaignId}:`, campaignError);
    } else {
      console.log(`[WORKER ${workerId}] ✅ Métricas atualizadas: ${totalProcessed} processados, ${totalFailed} falhas para campanha ${campaignId}`);
    }

    // Verifica se deve finalizar campanha
    const { data: finalizeResult, error: finalizeError } = await getSupabase().rpc(
      'finalizar_campaign_se_necessario',
      { p_campaign_id: campaignId }
    );

    if (finalizeError) {
      console.error(`[WORKER ${workerId}] ❌ Erro ao verificar finalização: ${finalizeError.message}`);
    } else if (finalizeResult) {
      console.log(`[WORKER ${workerId}] ✅ Campanha ${campaignId} finalizada`);
    }
  } catch (error: any) {
    console.error(`[WORKER ${workerId}] ❌ Erro ao atualizar agregados:`, error?.message || error);
  }
}

// Handler principal do Netlify Scheduled Function
export const handler: Handler = async (event, context) => {
  const WORKER_ID = `netlify-worker-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const startTime = new Date().toISOString();

  console.log(`[WORKER ${WORKER_ID}] ▶ Iniciando execução | ${startTime}`);

  try {
    // PASSO 0: Converte jobs com status 'retry' para 'failed' (migração)
    // Isso garante que jobs antigos com retry sejam marcados como failed
    const { error: convertError } = await getSupabase()
      .from('campaign_contacts')
      .update({
        status: 'failed',
        finished_at: new Date().toISOString(),
        last_error: 'Job convertido de retry para failed - sistema de retry removido',
        updated_at: new Date().toISOString(),
      })
      .eq('status', 'retry');

    if (convertError) {
      console.warn(`[WORKER ${WORKER_ID}] ⚠️ Aviso ao converter jobs retry:`, convertError.message);
    }

    // PASSO 0.5: Recupera jobs travados em 'processing' há mais de LOCK_TTL_MINUTES.
    // Isso garante que jobs cujo worker morreu (timeout, crash) voltem para a fila.
    const staleThreshold = new Date(Date.now() - LOCK_TTL_MINUTES * 60 * 1000).toISOString();
    const { error: staleError } = await getSupabase()
      .from('campaign_contacts')
      .update({
        status: 'queued',
        locked_at: null,
        locked_by: null,
        updated_at: new Date().toISOString(),
      })
      .eq('status', 'processing')
      .lt('locked_at', staleThreshold);

    if (staleError) {
      console.warn(`[WORKER ${WORKER_ID}] ⚠️ Aviso ao recuperar jobs travados:`, staleError.message);
    }

    // PASSO 1: Busca campanhas ativas com status 'running'
    const { data: activeCampaigns, error: campaignsError } = await getSupabase()
      .from('campaigns')
      .select('id')
      .eq('status', 'running');

    if (campaignsError) {
      console.error(`[WORKER ${WORKER_ID}] ❌ Erro ao buscar campanhas: ${campaignsError.message}`);
      return {
        statusCode: 500,
        body: JSON.stringify({ 
          error: `Erro ao buscar campanhas: ${campaignsError.message}`,
          workerId: WORKER_ID,
          timestamp: startTime,
        }),
      };
    }

    if (!activeCampaigns || activeCampaigns.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({ 
          message: 'Nenhuma campanha ativa', 
          processed: 0,
          workerId: WORKER_ID,
          timestamp: startTime,
        }),
      };
    }

    const activeCampaignIds = activeCampaigns.map((c: { id: string }) => c.id);
    console.log(`[WORKER ${WORKER_ID}] Campanhas ativas: ${activeCampaignIds.length} | IDs: ${activeCampaignIds.join(', ')}`);

    // PASSO 2: Busca jobs devidos apenas das campanhas ativas
    const now = new Date().toISOString();
    const { data: jobs, error: claimError } = await getSupabase()
      .from('campaign_contacts')
      .select(`*`)
      .eq('status', 'queued')
      .lte('scheduled_at', now)
      .in('campaign_id', activeCampaignIds)
      .order('position', { ascending: true }) // CRÍTICO: Ordena por position para processar grupos sequencialmente
      .limit(BATCH_LIMIT);


    if (claimError) {
      console.error(`[WORKER ${WORKER_ID}] ❌ Erro ao buscar jobs: ${claimError.message}`);
      
      // Erro específico: função não encontrada
      if (claimError.code === 'PGRST202') {
        console.error(`[WORKER ${WORKER_ID}] ⚠️ Função SQL não encontrada - Execute migração: migrations/create_campaign_queue_tables.sql`);
      }
      
      return {
        statusCode: 500,
        body: JSON.stringify({ 
          error: claimError.message,
          code: claimError.code,
          details: claimError.details,
          workerId: WORKER_ID,
          timestamp: startTime,
          actionRequired: claimError.code === 'PGRST202' 
            ? 'Execute a migração SQL: migrations/create_campaign_queue_tables.sql no Supabase Dashboard'
            : null,
        }),
      };
    }

    if (!jobs || jobs.length === 0) {
      console.log(`[WORKER ${WORKER_ID}] Nenhum job devido (queued + scheduled_at <= ${now})`);
      return {
        statusCode: 200,
        body: JSON.stringify({ 
          message: 'Nenhum job devido nas campanhas ativas', 
          processed: 0,
          activeCampaigns: activeCampaignIds.length,
          workerId: WORKER_ID,
          timestamp: startTime,
        }),
      };
    }

    console.log(`[WORKER ${WORKER_ID}] Jobs devidos encontrados: ${jobs.length} | Campanhas: ${[...new Set(jobs.map((j: any) => j.campaign_id))].join(', ')}`);

    // Processa cada job
    const campaignIds = new Set<string>();
    const results = await Promise.allSettled(
      jobs.map((job: any) => {
        campaignIds.add(job.campaign_id);
        return processJob(job, WORKER_ID);
      })
    );

    const successCount = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
    const failedCount = results.length - successCount;
    const endTime = new Date().toISOString();
    const duration = Date.now() - new Date(startTime).getTime();

    console.log(`[WORKER ${WORKER_ID}] ◼ Concluído em ${duration}ms | ${successCount} ok, ${failedCount} falhas | campanhas: ${Array.from(campaignIds).join(', ')}`);

    // Atualiza agregados e next_request_at para cada campanha única
    await Promise.all(Array.from(campaignIds).map(async (id: string) => {
      await updateAggregates(id, WORKER_ID);

      // Atualiza next_request_at com o scheduled_at do próximo job pendente
      // Isso faz o timer na UI mostrar a contagem regressiva correta
      const { data: nextJob } = await getSupabase()
        .from('campaign_contacts')
        .select('scheduled_at')
        .eq('campaign_id', id)
        .eq('status', 'queued')
        .order('position', { ascending: true })
        .limit(1)
        .single();

      await getSupabase()
        .from('campaigns')
        .update({
          next_request_at: nextJob?.scheduled_at || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .eq('status', 'running');
    }));

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Processamento concluído',
        processed: jobs.length,
        success: successCount,
        failed: failedCount,
        workerId: WORKER_ID,
        startTime,
        endTime,
        duration: `${duration}ms`,
        campaigns: Array.from(campaignIds),
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

