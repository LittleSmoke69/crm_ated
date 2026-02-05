import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { rateLimitService } from '@/lib/services/rate-limit-service';
import { evolutionBalancer } from '@/lib/services/evolution-balancer';
import { evolutionService } from '@/lib/services/evolution-service';

export const runtime = 'nodejs';
export const maxDuration = 900; // 15 minutos - máximo suportado pela Netlify para funções serverless

interface ProcessCampaignRequest {
  campaignId: string;
  jobs: Array<{ contactId: string; phone: string }>;
}

/**
 * POST /api/campaigns/process - Processa uma campanha adicionando leads aos grupos
 * Processa tudo sequencialmente na mesma requisição HTTP para evitar que a Netlify mate o processo
 */
export async function POST(req: NextRequest) {
  try {
    // Autentica primeiro
    let userId: string;
    try {
      const auth = await requireAuth(req);
      userId = auth.userId;
    } catch (authError: any) {
      console.error('Erro de autenticação:', authError);
      return errorResponse(authError.message || 'Não autenticado', 401);
    }
    
    // Lê o body
    const body: ProcessCampaignRequest = await req.json();
    const { campaignId, jobs } = body;

    if (!campaignId || !Array.isArray(jobs) || jobs.length === 0) {
      return errorResponse('campaignId e jobs são obrigatórios', 400);
    }

    // Busca dados da campanha
    const { data: campaign, error: campaignError } = await supabaseServiceRole
      .from('campaigns')
      .select('*')
      .eq('user_id', userId)
      .eq('id', campaignId)
      .single();

    if (campaignError || !campaign) {
      return errorResponse('Campanha não encontrada', 404);
    }

    // Verifica rate limit diário
    console.log(`🔍 [CAMPANHA ${campaignId}] Verificando rate limits...`);
    
    const rateLimit = await rateLimitService.checkDailyLimit(userId);
    console.log(`📊 [CAMPANHA ${campaignId}] Rate limit diário: ${rateLimit.remaining}/${rateLimit.limit} leads restantes`);
    
    if (!rateLimit.allowed) {
      console.warn(`⚠️ [CAMPANHA ${campaignId}] Limite diário atingido: ${rateLimit.limit} leads`);
      return errorResponse(
        `Limite diário atingido. Você pode adicionar até ${rateLimit.limit} leads por dia. Reset em ${new Date(rateLimit.resetAt).toLocaleTimeString()}`,
        429
      );
    }

    // Verifica se há leads suficientes no limite
    if (jobs.length > rateLimit.remaining) {
      console.warn(`⚠️ [CAMPANHA ${campaignId}] Leads insuficientes no limite: ${jobs.length} solicitados, ${rateLimit.remaining} disponíveis`);
      return errorResponse(
        `Você pode adicionar apenas ${rateLimit.remaining} leads hoje. Tente novamente amanhã ou reduza a quantidade.`,
        429
      );
    }

    // Verifica limite de instâncias
    const instanceLimit = await rateLimitService.checkInstanceLimit(userId);
    console.log(`📊 [CAMPANHA ${campaignId}] Limite de instâncias: ${instanceLimit.current}/${instanceLimit.max} instâncias ativas`);
    
    if (!instanceLimit.allowed) {
      console.warn(`⚠️ [CAMPANHA ${campaignId}] Limite de instâncias atingido: ${instanceLimit.max} instâncias`);
      return errorResponse(
        `Limite de instâncias atingido. Máximo: ${instanceLimit.max} instâncias ativas no sistema.`,
        429
      );
    }

    // Registra o started_at
    await supabaseServiceRole
      .from('campaigns')
      .update({
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', campaignId);

    console.log(`🚀 [CAMPANHA ${campaignId}] Iniciando processamento sequencial de ${jobs.length} jobs...`);

    // Processa a campanha sequencialmente (tudo na mesma requisição HTTP)
    const result = await processCampaignQueue(campaignId, campaign, jobs, userId);

    return successResponse(result, 'Campanha processada com sucesso');
  } catch (err: any) {
    console.error('❌ Erro no processamento da campanha:', err);
    return serverErrorResponse(err);
  }
}

// Busca instâncias disponíveis da campanha
async function getAvailableInstancesForCampaign(
  userId: string,
  preferUserBinding: boolean,
  allowedInstanceNames: string[]
): Promise<any[]> {
  if (!allowedInstanceNames || allowedInstanceNames.length === 0) {
    return [];
  }

  // Query base: instâncias ativas e conectadas
  let query = supabaseServiceRole
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
    .not('apikey', 'is', null)
    .in('instance_name', allowedInstanceNames);

  // Se preferUserBinding, tenta priorizar instâncias do usuário
  if (preferUserBinding && userId) {
    const { data: userBindings } = await supabaseServiceRole
      .from('user_evolution_apis')
      .select('evolution_api_id')
      .eq('user_id', userId);

    if (userBindings && userBindings.length > 0) {
      const userApiIds = userBindings.map(b => b.evolution_api_id);
      query = query.in('evolution_api_id', userApiIds);
    }
  }

  const { data: candidates, error } = await query;

  if (error || !candidates || candidates.length === 0) {
    return [];
  }

  // Filtra por cooldown e daily_limit
  const available = candidates.filter((inst: any) => {
    if (inst.cooldown_until && new Date(inst.cooldown_until) > new Date()) return false;
    if (inst.daily_limit !== null && inst.sent_today >= inst.daily_limit) return false;
    return true;
  });

  return available;
}

// Seleciona instância baseado no distributionMode
async function pickInstanceByDistributionMode(
  userId: string,
  preferUserBinding: boolean,
  allowedInstanceNames: string[],
  distributionMode: 'sequential' | 'random',
  position: number
): Promise<any> {
  const available = await getAvailableInstancesForCampaign(userId, preferUserBinding, allowedInstanceNames);

  if (available.length === 0) {
    return null;
  }

  // Ordena instâncias pelo nome para garantir ordem consistente na distribuição sequencial
  const sortedInstances = available.sort((a: any, b: any) => {
    return a.instance_name.localeCompare(b.instance_name);
  });

  if (distributionMode === 'sequential') {
    // Distribuição sequencial: rotaciona entre instâncias baseado na posição
    const instanceIndex = position % sortedInstances.length;
    return sortedInstances[instanceIndex];
  } else {
    // Distribuição aleatória: escolhe aleatoriamente entre disponíveis
    const randomIndex = Math.floor(Math.random() * sortedInstances.length);
    return sortedInstances[randomIndex];
  }
}

/**
 * Processa fila de jobs sequencialmente
 * Cada job: request → delay → próximo request
 */
async function processCampaignQueue(
  campaignId: string,
  campaign: any,
  jobs: Array<{ contactId: string; phone: string }>,
  userId: string
) {
  // Extrai informações necessárias
  const strategy = campaign.strategy || {};
  const groupId = campaign.group_id;
  const delayConfig = strategy.delayConfig || {};
  const preferUserBinding = strategy.preferUserBinding === true;
  const distributionMode = strategy.distributionMode || 'sequential';
  let allowedInstances = [...(campaign.instances || [])];

  if (!groupId) {
    throw new Error('Campanha sem group_id');
  }

  // Função auxiliar para normalizar telefone
  const normalizePhoneNumber = (phone: string): string => {
    if (!phone) return '';
    let cleaned = phone.replace(/\D/g, '');
    if (cleaned.startsWith('5555')) {
      cleaned = cleaned.substring(2);
    }
    if (cleaned.startsWith('55') && !cleaned.startsWith('5555')) {
      return cleaned;
    }
    return `55${cleaned}`;
  };

  // Função para calcular delay (suporta segundos e minutos)
  const getDelay = (): number => {
    if (delayConfig.delayMode === 'random') {
      const min = Math.max(1, Number(delayConfig.randomMinSeconds) || 1);
      const max = Math.max(1, Number(delayConfig.randomMaxSeconds) || 1);
      const seconds = Math.floor(Math.random() * (max - min + 1)) + min;
      const delayMs = seconds * 1000;
      console.log(`🎲 [CAMPANHA ${campaignId}] Delay aleatório: ${seconds}s (${delayMs}ms)`);
      return delayMs;
    } else {
      const value = Number(delayConfig.delayValue) || 0;
      const unit = delayConfig.delayUnit === 'minutes' ? 60 : 1;
      const seconds = value * unit;
      const delayMs = Math.max(1000, seconds * 1000);
      console.log(`⏱️ [CAMPANHA ${campaignId}] Delay configurado: ${value} ${delayConfig.delayUnit} = ${seconds}s (${delayMs}ms)`);
      return delayMs;
    }
  };

  // Contadores
  let processed = 0;
  let failed = 0;
  let firstRequestDone = false;

  // Processa cada job sequencialmente
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    const jobNumber = i + 1;
    const normalizedPhone = normalizePhoneNumber(job.phone);

    // CRÍTICO: Verifica se a campanha foi excluída antes de processar cada job
    const { data: campaignCheck, error: checkError } = await supabaseServiceRole
      .from('campaigns')
      .select('id, status')
      .eq('id', campaignId)
      .single();
    
    // Se a campanha foi excluída ou não existe mais, para o processamento imediatamente
    if (checkError || !campaignCheck) {
      console.log(`🛑 [CAMPANHA ${campaignId}] Campanha foi excluída. Parando processamento no job ${jobNumber}/${jobs.length}`);
      break;
    }
    
    // Se a campanha foi finalizada, para o processamento
    if (campaignCheck.status === 'failed' || campaignCheck.status === 'completed') {
      console.log(`🛑 [CAMPANHA ${campaignId}] Campanha foi finalizada (status: ${campaignCheck.status}). Parando processamento.`);
      break;
    }
    
    // Se a campanha está pausada, aguarda até ser retomada ou excluída
    if (campaignCheck.status === 'paused') {
      console.log(`⏸️ [CAMPANHA ${campaignId}] Campanha pausada. Aguardando retomada...`);
      while (true) {
        await new Promise((resolve) => setTimeout(resolve, 2000)); // Verifica a cada 2 segundos
        
        const { data: statusCheck } = await supabaseServiceRole
          .from('campaigns')
          .select('id, status')
          .eq('id', campaignId)
          .single();
        
        // Se foi excluída, para o processamento
        if (!statusCheck) {
          console.log(`🛑 [CAMPANHA ${campaignId}] Campanha foi excluída durante pausa. Parando processamento.`);
          break;
        }
        
        // Se foi finalizada, para o processamento
        if (statusCheck.status === 'failed' || statusCheck.status === 'completed') {
          console.log(`🛑 [CAMPANHA ${campaignId}] Campanha foi finalizada durante pausa. Parando processamento.`);
          break;
        }
        
        // Se foi retomada, continua o processamento
        if (statusCheck.status === 'running') {
          console.log(`▶️ [CAMPANHA ${campaignId}] Campanha retomada. Continuando processamento.`);
          break;
        }
      }
      
      // Verifica novamente se deve continuar após a pausa
      const { data: finalCheck } = await supabaseServiceRole
        .from('campaigns')
        .select('id, status')
        .eq('id', campaignId)
        .single();
      
      if (!finalCheck || finalCheck.status === 'failed' || finalCheck.status === 'completed') {
        console.log(`🛑 [CAMPANHA ${campaignId}] Campanha não pode continuar após pausa. Parando processamento.`);
        break;
      }
    }

    console.log(`📞 [CAMPANHA ${campaignId}] Job ${jobNumber}/${jobs.length}: Processando ${normalizedPhone}`);

    try {
      // Verifica se ainda há instâncias disponíveis na campanha
      if (allowedInstances.length === 0) {
        console.error(`❌ [CAMPANHA ${campaignId}] Nenhuma instância disponível na campanha.`);
        
        await supabaseServiceRole
          .from('campaigns')
          .update({
            status: 'failed',
            observation: 'Campanha encerrada: Todas as instâncias foram removidas ou caíram.',
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', campaignId);
          
        break;
      }

      // Seleciona instância baseado no distributionMode
      const instance = await pickInstanceByDistributionMode(
        userId,
        preferUserBinding,
        allowedInstances,
        distributionMode,
        i // Usa o índice do job como posição
      );
      
      if (!instance || !instance.evolution_api) {
        // Verifica se há instâncias disponíveis mas não estão ok
        const availableInstances = await getAvailableInstancesForCampaign(userId, preferUserBinding, allowedInstances);
        
        if (availableInstances.length === 0 && allowedInstances.length === 1) {
          // Se só tem uma instância e ela não está disponível, falha a campanha
          console.error(`❌ [CAMPANHA ${campaignId}] Última instância não está disponível. Encerrando campanha.`);
          
          await supabaseServiceRole
            .from('campaigns')
            .update({
              status: 'failed',
              observation: 'Campanha encerrada: Última instância não está disponível.',
              completed_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('id', campaignId);
            
          break;
        } else if (availableInstances.length === 0) {
          // Múltiplas instâncias configuradas mas nenhuma disponível agora
          // Marca job como retry e continua
          console.warn(`⚠️ [CAMPANHA ${campaignId}] Job ${jobNumber}: Todas as instâncias indisponíveis no momento. Job será retentado.`);
          
          failed++;
          continue; // Continua para o próximo job
        } else {
          // Há instâncias disponíveis mas não foram encontradas (pode ser filtro)
          failed++;
          continue;
        }
      }
      
      console.log(`🔍 [CAMPANHA ${campaignId}] Job ${jobNumber}: Instância selecionada:`, {
        instanceId: instance.id,
        instanceName: instance.instance_name,
        evolutionApiId: instance.evolution_api_id,
        evolutionApiBaseUrl: instance.evolution_api.base_url,
      });
      
      // Busca apikey da instância da tabela evolution_instances
      const { data: instanceData, error: instanceDataError } = await supabaseServiceRole
        .from('evolution_instances')
        .select('apikey, instance_name')
        .eq('id', instance.id)
        .single();
      
      if (instanceDataError) {
        console.error(`❌ [CAMPANHA ${campaignId}] Job ${jobNumber}: Erro ao buscar apikey da instância:`, instanceDataError);
        throw new Error(`Erro ao buscar apikey: ${instanceDataError.message}`);
      }
      
      const instanceApikey = instanceData?.apikey;
      
      if (!instanceApikey) {
        console.error(`❌ [CAMPANHA ${campaignId}] Job ${jobNumber}: Instância sem apikey configurada na tabela evolution_instances`);
        throw new Error('Instância sem apikey configurada');
      }
      
      // Log da apikey (mascarada por segurança - mostra apenas primeiros e últimos caracteres)
      const maskedApikey = instanceApikey.length > 10 
        ? `${instanceApikey.substring(0, 6)}...${instanceApikey.substring(instanceApikey.length - 4)}`
        : '***';
      
      console.log(`🔑 [CAMPANHA ${campaignId}] Job ${jobNumber}: Apikey obtida da tabela evolution_instances:`, {
        instanceId: instance.id,
        instanceName: instanceData.instance_name,
        apikeyLength: instanceApikey.length,
        apikeyMasked: maskedApikey,
        source: 'evolution_instances.apikey',
      });
      
      // Faz request DIRETO para Evolution API
      const normalizedBaseUrl = instance.evolution_api.base_url.replace(/\/+$/, '').replace(/([^:]\/)\/+/g, '$1');
      const url = `${normalizedBaseUrl}/group/updateParticipant/${instance.instance_name}?groupJid=${encodeURIComponent(groupId)}`;
      const finalUrl = url.replace(/([^:]\/)\/+/g, '$1');
      
      const requestBody = {
        action: 'add',
        participants: [normalizedPhone],
      };
      
      console.log(`📤 [CAMPANHA ${campaignId}] Job ${jobNumber}: Request para Evolution API:`, {
        method: 'POST',
        url: finalUrl,
        headers: {
          'Content-Type': 'application/json',
          apikey: maskedApikey, // Log com apikey mascarada
        },
        body: requestBody,
        timeout: '25000ms',
      });
      
      // Timeout de 25 segundos
      const FETCH_TIMEOUT_MS = 25000;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, FETCH_TIMEOUT_MS);
      
      const response = await fetch(finalUrl, {
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
      
      // Log da resposta da Evolution API
      console.log(`📥 [CAMPANHA ${campaignId}] Job ${jobNumber}: Resposta da Evolution API:`, {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        responseData: responseData,
        responseTextLength: responseText.length,
      });
      
      // Processa resultado
      if (response.ok) {
        processed++;
        console.log(`✅ [CAMPANHA ${campaignId}] Job ${jobNumber}: SUCESSO - Contato ${normalizedPhone} adicionado ao grupo ${groupId}`);
        
        await rateLimitService.recordLeadUsage(campaignId, 1, true);
        await supabaseServiceRole
          .from('searches')
          .update({
            status_add_gp: true,
            status: 'added',
            updated_at: new Date().toISOString(),
          })
          .eq('id', job.contactId);
      } else {
        // Verifica se contém "Connection Closed" em qualquer lugar da resposta (mesmo com erro HTTP)
        const errorMsg = responseData?.message || responseText || `HTTP ${response.status}`;
        
        const isConnectionClosed = 
          (typeof responseText === 'string' && responseText.toLowerCase().includes('connection closed')) ||
          (typeof errorMsg === 'string' && errorMsg.toLowerCase().includes('connection closed')) ||
          (responseData && JSON.stringify(responseData).toLowerCase().includes('connection closed'));

        if (isConnectionClosed) {
          console.warn(`⚠️ [CAMPANHA ${campaignId}] Possível "Connection Closed" detectado na instância ${instance.instance_name}. Verificando status real...`);
          
          // CRÍTICO: Verifica o status REAL da instância antes de marcar como desconectada
          // Pode ser apenas um erro temporário na requisição específica
          try {
            const { data: instanceWithApi } = await supabaseServiceRole
              .from('evolution_instances')
              .select(`
                *,
                evolution_apis!inner (
                  id,
                  base_url,
                  api_key_global
                )
              `)
              .eq('id', instance.id)
              .single();

            if (instanceWithApi?.evolution_apis) {
              const evolutionApi = Array.isArray(instanceWithApi.evolution_apis)
                ? instanceWithApi.evolution_apis[0]
                : instanceWithApi.evolution_apis;

              if (evolutionApi?.api_key_global && evolutionApi?.base_url) {
                // Verifica o status real na Evolution API
                const realStateData = await evolutionService.getConnectionState(
                  instance.instance_name,
                  evolutionApi.api_key_global,
                  evolutionApi.base_url
                );
                const realState = evolutionService.extractState(realStateData);

                console.log(`🔍 [CAMPANHA ${campaignId}] Status real da instância ${instance.instance_name}: ${realState}`);

                // Marca como desconectada se o status REAL confirmar ou se for "unknown" com Connection Closed
                // "unknown" com Connection Closed geralmente indica que a instância caiu mas a API não retornou status claro
                if (realState === 'disconnected' || (realState === 'unknown' && isConnectionClosed)) {
                  const reason = realState === 'disconnected' 
                    ? 'Status REAL confirmado: DESCONECTADA'
                    : 'Status "unknown" com Connection Closed detectado - instância provavelmente caiu';
                  
                  console.error(`🔌 [CAMPANHA ${campaignId}] ${reason}. Instância ${instance.instance_name} será marcada como desconectada.`);
                  
                  // Desliga a instância que realmente caiu
                  await supabaseServiceRole
                    .from('evolution_instances')
                    .update({
                      status: 'disconnected',
                      is_active: false,
                      updated_at: new Date().toISOString(),
                    })
                    .eq('id', instance.id);
                } else {
                  // Instância ainda está conectada ou conectando - pode ser apenas um erro temporário
                  console.log(`✅ [CAMPANHA ${campaignId}] Status REAL: Instância ${instance.instance_name} ainda está ${realState === 'connected' ? 'CONECTADA' : realState === 'connecting' ? 'CONECTANDO' : 'UNKNOWN (mas sem Connection Closed)'}. Não marcando como desconectada.`);
                  
                  // Continua o processamento normalmente sem remover a instância
                  failed++;
                  continue;
                }
              }
            }
          } catch (verifyError: any) {
            // Se não conseguir verificar, não marca como desconectada
            // Pode ser um erro temporário de rede ao verificar
            console.error(`❌ [CAMPANHA ${campaignId}] Erro ao verificar status real da instância ${instance.instance_name}:`, verifyError.message);
            console.log(`⚠️ [CAMPANHA ${campaignId}] Não marcando como desconectada por segurança - pode ser erro temporário.`);
            
            // Continua sem remover a instância
            failed++;
            continue;
          }

          // Remove a instância do pool da campanha (só se realmente caiu)
          const remainingInstances = allowedInstances.filter(name => name !== instance.instance_name);
          
          // Verifica se há outras instâncias disponíveis
          const availableRemaining = await getAvailableInstancesForCampaign(userId, preferUserBinding, remainingInstances);

          // Atualiza a campanha removendo a instância que caiu
          if (remainingInstances.length > 0) {
            await supabaseServiceRole
              .from('campaigns')
              .update({
                instances: remainingInstances,
                updated_at: new Date().toISOString(),
              })
              .eq('id', campaignId);

            // Atualiza allowedInstances localmente
            allowedInstances = remainingInstances;

            console.log(`🔄 [CAMPANHA ${campaignId}] Instância ${instance.instance_name} removida da campanha. Restantes: ${remainingInstances.join(', ')}`);

            // Se ainda há instâncias disponíveis, pausa a campanha para o usuário decidir
            if (availableRemaining.length > 0) {
              console.warn(`⏸️ [CAMPANHA ${campaignId}] Instância ${instance.instance_name} caiu. Pausando campanha automaticamente. Restam ${availableRemaining.length} instância(s) disponível(eis).`);
              
              // PAUSA a campanha automaticamente quando uma instância cai
              await supabaseServiceRole
                .from('campaigns')
                .update({
                  status: 'paused',
                  observation: `Campanha pausada automaticamente: Instância ${instance.instance_name} desconectou. Restam ${availableRemaining.length} instância(s) disponível(eis).`,
                  updated_at: new Date().toISOString(),
                })
                .eq('id', campaignId);

              failed++;
              await rateLimitService.recordLeadUsage(campaignId, 1, false);
              
              // Para o processamento da fila imediatamente
              break;
            }
          }

          // Se não há mais instâncias disponíveis, falha a campanha
          if (remainingInstances.length === 0 || availableRemaining.length === 0) {
            console.error(`🚫 [CAMPANHA ${campaignId}] Última instância da campanha caiu. Encerrando campanha.`);
            
            await supabaseServiceRole
              .from('campaigns')
              .update({
                status: 'failed',
                observation: remainingInstances.length === 0 
                  ? `Todas as instâncias da campanha caíram. Última: ${instance.instance_name}`
                  : `Todas as instâncias disponíveis da campanha caíram.`,
                completed_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              })
              .eq('id', campaignId);

            failed++;
            await rateLimitService.recordLeadUsage(campaignId, 1, false);
            
            // Para o processamento da fila imediatamente
            break;
          }
        }

        failed++;
        console.log(`❌ [CAMPANHA ${campaignId}] Job ${jobNumber}: FALHA - Status: ${response.status}, Mensagem: ${errorMsg}`);
      }

      // CRÍTICO: Após o primeiro request (sucesso ou erro), muda status para 'running' para parar animação
      if (!firstRequestDone) {
        firstRequestDone = true;
        console.log(`🎬 [CAMPANHA ${campaignId}] Primeiro request concluído! Mudando status para 'running' - animação será removida`);
        
        // Verifica se a campanha ainda existe antes de atualizar
        const { data: updateCheck } = await supabaseServiceRole
          .from('campaigns')
          .select('id')
          .eq('id', campaignId)
          .single();
        
        if (updateCheck) {
          await supabaseServiceRole
            .from('campaigns')
            .update({
              status: 'running',
              updated_at: new Date().toISOString(),
            })
            .eq('id', campaignId);
        }
      }

      // Calcula delay para o próximo request (se não for o último job)
      let nextRequestAt: string | null = null;
      if (i < jobs.length - 1) {
        const delay = getDelay();
        const delayInSeconds = Math.floor(delay / 1000);
        const delayInMinutes = Math.floor(delayInSeconds / 60);
        const remainingSeconds = delayInSeconds % 60;
        
        // Calcula data/hora do próximo request
        const nextRequestDate = new Date(Date.now() + delay);
        nextRequestAt = nextRequestDate.toISOString();
        
        console.log(`⏳ [CAMPANHA ${campaignId}] Job ${jobNumber} concluído. Próximo request em ${delayInMinutes > 0 ? `${delayInMinutes}min ` : ''}${remainingSeconds}s (${delay}ms total)`);
      }

      // Atualiza progresso no banco APÓS CADA JOB (incluindo next_request_at)
      const { data: progressCheck } = await supabaseServiceRole
        .from('campaigns')
        .select('id')
        .eq('id', campaignId)
        .single();
      
      if (progressCheck) {
        const updateData: any = {
          processed_contacts: processed,
          failed_contacts: failed,
          status: 'running',
          updated_at: new Date().toISOString(),
        };
        
        // Adiciona next_request_at se houver próximo job
        if (nextRequestAt) {
          updateData.next_request_at = nextRequestAt;
        } else {
          // Se for o último job, limpa next_request_at
          updateData.next_request_at = null;
        }
        
        await supabaseServiceRole
          .from('campaigns')
          .update(updateData)
          .eq('id', campaignId);
      } else {
        console.warn(`⚠️ [CAMPANHA ${campaignId}] Campanha não encontrada ao atualizar progresso (foi excluída). Parando processamento.`);
        break;
      }
      
      console.log(`📊 [CAMPANHA ${campaignId}] Job ${jobNumber}: Progresso atualizado - Processados: ${processed}, Falhas: ${failed}, Total: ${jobs.length}${nextRequestAt ? `, Próximo request: ${new Date(nextRequestAt).toLocaleString('pt-BR')}` : ''}`);

      // Delay APÓS o request (antes do próximo) - mas não no último job
      if (i < jobs.length - 1) {
        const delay = getDelay();
        console.log(`⏳ [CAMPANHA ${campaignId}] Aguardando ${delay}ms (${(delay/1000).toFixed(1)}s) antes do próximo request...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        
        // Limpa next_request_at após o delay (request será feito agora)
        const { data: clearCheck } = await supabaseServiceRole
          .from('campaigns')
          .select('id')
          .eq('id', campaignId)
          .single();
        
        if (clearCheck) {
          await supabaseServiceRole
            .from('campaigns')
            .update({
              next_request_at: null, // Limpa porque o request será feito agora
              updated_at: new Date().toISOString(),
            })
            .eq('id', campaignId);
        }
      }

    } catch (error: any) {
      const errorMsg = error?.message || String(error);
      console.error(`❌ [CAMPANHA ${campaignId}] Job ${jobNumber}: ERRO:`, errorMsg);
      
      // Tenta identificar qual instância estava sendo usada (se houver)
      let instanceName: string | null = null;
      try {
        const testInstance = await pickInstanceByDistributionMode(
          userId,
          preferUserBinding,
          allowedInstances,
          distributionMode,
          i
        );
        instanceName = testInstance?.instance_name || null;
      } catch {
        // Se não conseguir identificar, continua
      }
      
      // Verifica se o erro indica que a instância caiu (fetch error)
      const isConnectionError = 
        errorMsg.toLowerCase().includes('connection closed') ||
        errorMsg.toLowerCase().includes('econnreset') ||
        errorMsg.toLowerCase().includes('socket hang up');

      if (isConnectionError && instanceName) {
        console.error(`🔌 [CAMPANHA ${campaignId}] Erro de conexão crítico detectado no job ${jobNumber}! Instância ${instanceName} pode ter caído.`);
        
        // Verifica o status real da instância antes de marcar como desconectada
        try {
          const { data: instanceWithApi } = await supabaseServiceRole
            .from('evolution_instances')
            .select(`
              *,
              evolution_apis!inner (
                id,
                base_url,
                api_key_global
              )
            `)
            .eq('instance_name', instanceName)
            .single();

          if (instanceWithApi?.evolution_apis) {
            const evolutionApi = Array.isArray(instanceWithApi.evolution_apis)
              ? instanceWithApi.evolution_apis[0]
              : instanceWithApi.evolution_apis;

            if (evolutionApi?.api_key_global && evolutionApi?.base_url) {
              // Verifica o status real na Evolution API
              const realStateData = await evolutionService.getConnectionState(
                instanceName,
                evolutionApi.api_key_global,
                evolutionApi.base_url
              );
              const realState = evolutionService.extractState(realStateData);

              console.log(`🔍 [CAMPANHA ${campaignId}] Status real da instância ${instanceName} após erro de conexão: ${realState}`);

              // Só marca como desconectada se o status REAL confirmar
              if (realState === 'disconnected') {
                // Desliga a instância que realmente caiu
                await supabaseServiceRole
                  .from('evolution_instances')
                  .update({
                    status: 'disconnected',
                    is_active: false,
                    updated_at: new Date().toISOString(),
                  })
                  .eq('instance_name', instanceName);

                // Remove a instância do pool da campanha
                const remainingInstances = allowedInstances.filter(name => name !== instanceName);
                
                // Verifica se há outras instâncias disponíveis
                const availableRemaining = await getAvailableInstancesForCampaign(userId, preferUserBinding, remainingInstances);

                // Atualiza a campanha removendo a instância que caiu
                if (remainingInstances.length > 0 && availableRemaining.length > 0) {
                  await supabaseServiceRole
                    .from('campaigns')
                    .update({
                      instances: remainingInstances,
                      status: 'paused',
                      observation: `Campanha pausada automaticamente: Instância ${instanceName} desconectou devido a erro de conexão. Restam ${availableRemaining.length} instância(s) disponível(eis).`,
                      updated_at: new Date().toISOString(),
                    })
                    .eq('id', campaignId);

                  allowedInstances = remainingInstances;

                  console.warn(`⏸️ [CAMPANHA ${campaignId}] Instância ${instanceName} desconectou. Campanha pausada automaticamente. Restantes: ${remainingInstances.join(', ')}`);
                  
                  failed++;
                  await rateLimitService.recordLeadUsage(campaignId, 1, false);
                  
                  // Para o processamento da fila imediatamente
                  break;
                } else {
                  // Não há mais instâncias disponíveis - falha a campanha
                  console.error(`🚫 [CAMPANHA ${campaignId}] Última instância caiu por erro de conexão. Encerrando campanha.`);
                  
                  await supabaseServiceRole
                    .from('campaigns')
                    .update({
                      status: 'failed',
                      observation: `Erro crítico de conexão: ${errorMsg}. Todas as instâncias caíram.`,
                      completed_at: new Date().toISOString(),
                      updated_at: new Date().toISOString(),
                    })
                    .eq('id', campaignId);
                    
                  failed++;
                  await rateLimitService.recordLeadUsage(campaignId, 1, false);
                  
                  break;
                }
              } else {
                // Instância ainda está conectada - pode ser apenas um erro temporário
                console.log(`✅ [CAMPANHA ${campaignId}] Status REAL: Instância ${instanceName} ainda está ${realState === 'connected' ? 'CONECTADA' : 'CONECTANDO'}. Tratando como erro temporário.`);
                
                failed++;
                continue;
              }
            }
          }
        } catch (verifyError: any) {
          // Se não conseguir verificar, trata como erro temporário
          console.error(`❌ [CAMPANHA ${campaignId}] Erro ao verificar status real da instância ${instanceName}:`, verifyError.message);
          console.log(`⚠️ [CAMPANHA ${campaignId}] Tratando como erro temporário por segurança.`);
          
          failed++;
          continue;
        }
      } else if (isConnectionError) {
        // Erro de conexão mas não conseguiu identificar a instância
        console.error(`🚫 [CAMPANHA ${campaignId}] Erro de conexão sem instância identificada. Pausando campanha por segurança.`);
        
        await supabaseServiceRole
          .from('campaigns')
          .update({
            status: 'paused',
            observation: `Erro crítico de conexão sem instância identificada: ${errorMsg}. Campanha pausada por segurança.`,
            updated_at: new Date().toISOString(),
          })
          .eq('id', campaignId);
          
        failed++;
        await rateLimitService.recordLeadUsage(campaignId, 1, false);
        
        break;
      }

      failed++;
      
      await rateLimitService.recordLeadUsage(campaignId, 1, false);
      await supabaseServiceRole
        .from('searches')
        .update({
          status: 'erro',
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.contactId);

      // CRÍTICO: Após o primeiro request (mesmo com erro), muda status para 'running'
      if (!firstRequestDone) {
        firstRequestDone = true;
        console.log(`🎬 [CAMPANHA ${campaignId}] Primeiro request falhou! Mudando status para 'running' - animação será removida`);
        
        const { data: errorUpdateCheck } = await supabaseServiceRole
          .from('campaigns')
          .select('id')
          .eq('id', campaignId)
          .single();
        
        if (errorUpdateCheck) {
          await supabaseServiceRole
            .from('campaigns')
            .update({
              status: 'running',
              updated_at: new Date().toISOString(),
            })
            .eq('id', campaignId);
        }
      }

      // Calcula delay para o próximo request mesmo em caso de erro (se não for o último job)
      let nextRequestAtError: string | null = null;
      if (i < jobs.length - 1) {
        const delay = getDelay();
        const delayInSeconds = Math.floor(delay / 1000);
        const delayInMinutes = Math.floor(delayInSeconds / 60);
        const remainingSeconds = delayInSeconds % 60;
        
        const nextRequestDate = new Date(Date.now() + delay);
        nextRequestAtError = nextRequestDate.toISOString();
        
        console.log(`⏳ [CAMPANHA ${campaignId}] Job ${jobNumber} falhou. Próximo request em ${delayInMinutes > 0 ? `${delayInMinutes}min ` : ''}${remainingSeconds}s`);
      }

      // Atualiza progresso mesmo em caso de erro
      const { data: errorProgressCheck } = await supabaseServiceRole
        .from('campaigns')
        .select('id')
        .eq('id', campaignId)
        .single();
      
      if (errorProgressCheck) {
        const updateData: any = {
          processed_contacts: processed,
          failed_contacts: failed,
          status: 'running',
          updated_at: new Date().toISOString(),
        };
        
        if (nextRequestAtError) {
          updateData.next_request_at = nextRequestAtError;
        } else {
          updateData.next_request_at = null;
        }
        
        await supabaseServiceRole
          .from('campaigns')
          .update(updateData)
          .eq('id', campaignId);
      } else {
        console.warn(`⚠️ [CAMPANHA ${campaignId}] Campanha não encontrada ao atualizar progresso após erro (foi excluída). Parando processamento.`);
        break;
      }

      // Continua para o próximo job mesmo se este falhou
      if (i < jobs.length - 1) {
        const delay = getDelay();
        console.log(`⏳ [CAMPANHA ${campaignId}] Aguardando ${delay}ms antes do próximo request...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        
        // Limpa next_request_at após o delay
        const { data: clearCheck } = await supabaseServiceRole
          .from('campaigns')
          .select('id')
          .eq('id', campaignId)
          .single();
        
        if (clearCheck) {
          await supabaseServiceRole
            .from('campaigns')
            .update({
              next_request_at: null,
              updated_at: new Date().toISOString(),
            })
            .eq('id', campaignId);
        }
      }
    }
  }

  // Finaliza campanha
  const { data: finalCheck } = await supabaseServiceRole
    .from('campaigns')
    .select('id, status')
    .eq('id', campaignId)
    .single();
  
  if (!finalCheck) {
    console.warn(`⚠️ [CAMPANHA ${campaignId}] Campanha foi excluída durante processamento. Não é possível finalizar.`);
    return {
      campaignId,
      status: 'failed',
      totalJobs: jobs.length,
      processed,
      failed,
      message: 'Campanha foi excluída durante processamento',
    };
  }

  // Status: 'failed' apenas se TODOS os jobs falharam, caso contrário 'completed'
  const finalStatus = failed === jobs.length && processed === 0 ? 'failed' : 'completed';
  
  await supabaseServiceRole
    .from('campaigns')
    .update({
      status: finalStatus,
      processed_contacts: processed,
      failed_contacts: failed,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', campaignId);

  console.log(`✅ [CAMPANHA ${campaignId}] Finalizada: ${processed} sucessos, ${failed} falhas, Status: ${finalStatus}`);

  return {
    campaignId,
    status: finalStatus,
    totalJobs: jobs.length,
    processed,
    failed,
    message: `Campanha finalizada: ${processed} sucessos, ${failed} falhas`,
  };
}
