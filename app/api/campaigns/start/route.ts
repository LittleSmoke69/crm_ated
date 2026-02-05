/**
 * POST /api/campaigns/start - Cria campanha e inicia processamento via fila
 * 
 * Nova arquitetura: cria jobs na fila ao invés de processar sequencialmente
 * 
 * Body:
 * {
 *   groups: [{ jid: string, subject: string, target_contacts: number }], // até 3 grupos
 *   contacts: [{ contactId: string, phone: string }], // contatos a adicionar
 *   strategy: { delayConfig, max_retries, retry_backoff_minutes, ... },
 *   instances: string[]
 * }
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { rateLimitService } from '@/lib/services/rate-limit-service';
import { evolutionService } from '@/lib/services/evolution-service';

// Função auxiliar para normalizar telefone - garante que sempre comece com 55
function normalizePhoneNumber(phone: string): string {
  if (!phone) return '';
  // Remove todos os caracteres não numéricos
  let cleaned = phone.replace(/\D/g, '');
  
  // Se começa com 5555 (duplicado), remove os dois primeiros dígitos
  if (cleaned.startsWith('5555')) {
    cleaned = cleaned.substring(2);
  }
  
  // Se já começa com 55 (e não é 5555), retorna como está
  if (cleaned.startsWith('55')) {
    return cleaned;
  }
  
  // Caso contrário, adiciona 55 no início
  return `55${cleaned}`;
}

// Processa o primeiro job imediatamente para sinalizar início da campanha
async function processFirstJobImmediately(
  firstJob: any,
  campaign: any,
  group: any
): Promise<{ success: boolean; error?: string }> {
  try {
    const strategy = campaign.strategy || {};
    const preferUserBinding = strategy.preferUserBinding === true;
    
    // CRÍTICO: Pega o array de instâncias permitidas da campanha
    const allowedInstances = campaign.instances || [];
    
    if (!Array.isArray(allowedInstances) || allowedInstances.length === 0) {
      throw new Error('Campanha sem instâncias configuradas (coluna instances vazia ou inválida)');
    }

    console.log(`📋 [CAMPANHA ${campaign.id}] Primeiro job: Instâncias permitidas: ${allowedInstances.join(', ')}`);

    // Busca instância disponível (apenas das permitidas na campanha)
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
      .or('is_locked.is.null,is_locked.eq.false') // Exclui instâncias em maturação virgem
      .not('apikey', 'is', null)
      .in('instance_name', allowedInstances); // CRÍTICO: Filtra apenas pelas permitidas

    if (preferUserBinding && firstJob.user_id) {
      const { data: userBindings } = await supabaseServiceRole
        .from('user_evolution_apis')
        .select('evolution_api_id')
        .eq('user_id', firstJob.user_id);

      if (userBindings && userBindings.length > 0) {
        const userApiIds = userBindings.map(b => b.evolution_api_id);
        query = query.in('evolution_api_id', userApiIds);
      }
    }

    const { data: candidates, error: instanceError } = await query;

    if (instanceError || !candidates || candidates.length === 0) {
      throw new Error('Nenhuma instância disponível');
    }

    // Filtra por cooldown e daily_limit
    const available = candidates.filter((inst: any) => {
      if (inst.cooldown_until && new Date(inst.cooldown_until) > new Date()) return false;
      if (inst.daily_limit !== null && inst.sent_today >= inst.daily_limit) return false;
      return true;
    });

    if (available.length === 0) {
      throw new Error('Nenhuma instância disponível (cooldown ou limite atingido)');
    }

    // Seleciona a melhor instância
    const instance = available.sort((a: any, b: any) => {
      const scoreA = (1 / (a.sent_today + 1)) + (a.last_used_at ? (Date.now() - new Date(a.last_used_at).getTime()) / 1000 : 999);
      const scoreB = (1 / (b.sent_today + 1)) + (b.last_used_at ? (Date.now() - new Date(b.last_used_at).getTime()) / 1000 : 999);
      return scoreB - scoreA;
    })[0];

    const evolutionApi = Array.isArray(instance.evolution_apis) 
      ? instance.evolution_apis[0] 
      : instance.evolution_apis;

    if (!evolutionApi || !evolutionApi.base_url) {
      throw new Error('Evolution API não encontrada ou base_url não configurado');
    }

    const instanceApikey = instance.apikey;
    if (!instanceApikey) {
      throw new Error('Instância sem apikey configurada');
    }

    const normalizedPhone = normalizePhoneNumber(firstJob.phone);
    const groupJid = group.group_jid;

    // Normaliza base_url
    const normalizedBaseUrl = evolutionApi.base_url
      .replace(/\/+$/, '')
      .replace(/([^:]\/)\/+/g, '$1');
    
    const url = `${normalizedBaseUrl}/group/updateParticipant/${instance.instance_name}?groupJid=${encodeURIComponent(groupJid)}`;
    
    const requestBody = {
      action: 'add',
      participants: [normalizedPhone],
    };

    console.log(`🚀 [CAMPANHA ${campaign.id}] Processando primeiro job imediatamente:`);
    console.log(`   📱 Telefone: ${normalizedPhone}`);
    console.log(`   👥 Grupo: ${group.group_subject || groupJid}`);
    console.log(`   🌐 URL: ${url}`);
    console.log(`   🔑 Instance: ${instance.instance_name}`);

    // Faz request para Evolution API
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, 25000); // 25 segundos timeout

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
      
      if (!isSuccess || statusCode === '409') {
        // Não adicionou realmente (pode ser que já estava no grupo, erro 409, etc)
        const errorMsg = responseData?.message || responseText || `Status: ${statusCode}`;
        console.warn(`⚠️ [CAMPANHA ${campaign.id}] Primeiro contato não foi adicionado realmente. Status: ${statusCode}`);
        
        await supabaseServiceRole
          .from('campaign_contacts')
          .update({
            status: 'failed',
            finished_at: new Date().toISOString(),
            started_at: new Date().toISOString(),
            attempts: 1,
            last_error: errorMsg,
            updated_at: new Date().toISOString(),
          })
          .eq('id', firstJob.id);

        // Atualiza contato na tabela searches
        if (firstJob.contact_id) {
          await supabaseServiceRole
            .from('searches')
            .update({
              status: 'erro',
              updated_at: new Date().toISOString(),
            })
            .eq('id', firstJob.contact_id);
        }

        // Atualiza campanha imediatamente para o front-end ver
        await supabaseServiceRole
          .from('campaigns')
          .update({
            processed_contacts: 0,
            failed_contacts: 1,
            updated_at: new Date().toISOString(),
          })
          .eq('id', campaign.id);

        return { success: false, error: errorMsg };
      }

      // Atualiza job para success
      await supabaseServiceRole
        .from('campaign_contacts')
        .update({
          status: 'success',
          finished_at: new Date().toISOString(),
          instance_name: instance.instance_name,
          started_at: new Date().toISOString(),
          attempts: 1,
          updated_at: new Date().toISOString(),
        })
        .eq('id', firstJob.id);

      // Atualiza contato na tabela searches
      if (firstJob.contact_id) {
        await supabaseServiceRole
          .from('searches')
          .update({
            status_add_gp: true,
            status: 'added',
            updated_at: new Date().toISOString(),
          })
          .eq('id', firstJob.contact_id);
      }

      // Atualiza campanha IMEDIATAMENTE para o front-end ver (antes do delay)
      await supabaseServiceRole
        .from('campaigns')
        .update({
          processed_contacts: 1,
          updated_at: new Date().toISOString(),
        })
        .eq('id', campaign.id);

      console.log(`✅ [CAMPANHA ${campaign.id}] Primeiro contato adicionado com sucesso! Front-end atualizado imediatamente.`);

      // Calcula next_request_at baseado no delay configurado para o próximo lead
      // Primeiro job foi processado imediatamente, agora conta o delay para o segundo
      const delayConfig = strategy.delayConfig || {};
      let delayMs = 0;
      
      if (delayConfig.delayMode === 'random') {
        // Para random, calcula um delay aleatório entre min e max
        const min = Math.max(1, Number(delayConfig.randomMinSeconds) || 60);
        const max = Math.max(1, Number(delayConfig.randomMaxSeconds) || 120);
        const seconds = Math.floor(Math.random() * (max - min + 1)) + min;
        delayMs = seconds * 1000;
        console.log(`🎲 [CAMPANHA ${campaign.id}] Delay aleatório calculado para próximo lead: ${seconds}s (${delayMs}ms)`);
      } else {
        // Para fixed, usa o delayValue e delayUnit
        const value = Number(delayConfig.delayValue) || 1;
        const unit = delayConfig.delayUnit === 'minutes' ? 60 : 1;
        const seconds = value * unit;
        delayMs = Math.max(1000, seconds * 1000);
        console.log(`⏱️ [CAMPANHA ${campaign.id}] Delay fixo calculado para próximo lead: ${value} ${delayConfig.delayUnit || 'seconds'} = ${seconds}s (${delayMs}ms)`);
      }

      // Calcula quando o próximo lead será adicionado (agora + delay)
      const now = new Date();
      const nextRequestAt = new Date(now.getTime() + delayMs);
      
      // Atualiza a campanha com next_request_at (após atualizar processed_contacts)
      await supabaseServiceRole
        .from('campaigns')
        .update({
          next_request_at: nextRequestAt.toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', campaign.id);

      console.log(`⏳ [CAMPANHA ${campaign.id}] Próximo lead será adicionado em ${delayMs/1000}s (${nextRequestAt.toLocaleString('pt-BR')})`);
      
      return { success: true };
    } else {
      // Verifica se contém "Connection Closed" em qualquer lugar da resposta
      const errorMsg = responseData?.message || responseText || `HTTP ${response.status}`;
      
      const isConnectionClosed = 
        (typeof responseText === 'string' && responseText.toLowerCase().includes('connection closed')) ||
        (typeof errorMsg === 'string' && errorMsg.toLowerCase().includes('connection closed')) ||
        (responseData && JSON.stringify(responseData).toLowerCase().includes('connection closed')) ||
        (typeof errorMsg === 'string' && errorMsg.toLowerCase().includes('blocked-integrity-enforcement'));

      if (isConnectionClosed) {
        console.warn(`⚠️ [CAMPANHA ${campaign.id}] Possível "Connection Closed" detectado no primeiro job na instância ${instance.instance_name}. Verificando status real...`);
        
        // CRÍTICO: Verifica o status REAL da instância antes de marcar como desconectada
        let isReallyDisconnected = false;
        try {
          const evolutionApi = Array.isArray(instance.evolution_apis) 
            ? instance.evolution_apis[0] 
            : instance.evolution_apis;

          if (evolutionApi?.base_url) {
            // Busca api_key_global para verificar status
            const { data: apiData } = await supabaseServiceRole
              .from('evolution_apis')
              .select('api_key_global')
              .eq('id', evolutionApi.id)
              .single();

            if (apiData?.api_key_global) {
              // Verifica o status real na Evolution API
              const realStateData = await evolutionService.getConnectionState(
                instance.instance_name,
                apiData.api_key_global,
                evolutionApi.base_url
              );
              const realState = evolutionService.extractState(realStateData);

              console.log(`🔍 [CAMPANHA ${campaign.id}] Status real da instância ${instance.instance_name}: ${realState}`);

              // Só marca como desconectada se o status REAL confirmar
              if (realState === 'disconnected') {
                console.error(`🔌 [CAMPANHA ${campaign.id}] Status REAL confirmado: Instância ${instance.instance_name} está DESCONECTADA.`);
                isReallyDisconnected = true;
                
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
                // Instância ainda está conectada - pode ser apenas um erro temporário
                console.log(`✅ [CAMPANHA ${campaign.id}] Status REAL: Instância ${instance.instance_name} ainda está ${realState === 'connected' ? 'CONECTADA' : 'CONECTANDO'}. Não marcando como desconectada.`);
                
                // Retorna erro mas não marca como desconectada
                return { success: false, error: `Erro temporário na requisição. Instância ainda está ${realState}.` };
              }
            }
          }
        } catch (verifyError: any) {
          // Se não conseguir verificar, não marca como desconectada
          console.error(`❌ [CAMPANHA ${campaign.id}] Erro ao verificar status real:`, verifyError.message);
          console.log(`⚠️ [CAMPANHA ${campaign.id}] Não marcando como desconectada por segurança.`);
          return { success: false, error: 'Erro temporário. Não foi possível verificar status da instância.' };
        }

        // Só continua removendo da campanha se realmente estiver desconectada
        if (!isReallyDisconnected) {
          return { success: false, error: 'Erro temporário. Instância ainda está conectada.' };
        }

        // Remove a instância do pool da campanha (só se realmente caiu)
        const remainingInstances = allowedInstances.filter(name => name !== instance.instance_name);
        
        // Verifica se há outras instâncias disponíveis
        const remainingQuery = supabaseServiceRole
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
          .in('instance_name', remainingInstances);

        if (preferUserBinding && firstJob.user_id) {
          const { data: userBindings } = await supabaseServiceRole
            .from('user_evolution_apis')
            .select('evolution_api_id')
            .eq('user_id', firstJob.user_id);

          if (userBindings && userBindings.length > 0) {
            const userApiIds = userBindings.map(b => b.evolution_api_id);
            remainingQuery.in('evolution_api_id', userApiIds);
          }
        }

        const { data: remainingCandidates } = await remainingQuery;
        const availableRemaining = remainingCandidates?.filter((inst: any) => {
          if (inst.cooldown_until && new Date(inst.cooldown_until) > new Date()) return false;
          if (inst.daily_limit !== null && inst.sent_today >= inst.daily_limit) return false;
          return true;
        }) || [];

        // Atualiza a campanha removendo a instância que caiu
        if (remainingInstances.length > 0 && availableRemaining.length > 0) {
          await supabaseServiceRole
            .from('campaigns')
            .update({
              instances: remainingInstances,
              updated_at: new Date().toISOString(),
            })
            .eq('id', campaign.id);

          console.log(`🔄 [CAMPANHA ${campaign.id}] Instância ${instance.instance_name} removida da campanha. Restantes: ${remainingInstances.join(', ')}`);
          console.log(`✅ [CAMPANHA ${campaign.id}] Campanha continua com ${availableRemaining.length} instância(s) disponível(eis). Job será retentado.`);
          
          // Marca job como failed - sem retry
          await supabaseServiceRole
            .from('campaign_contacts')
            .update({
              status: 'failed',
              finished_at: new Date().toISOString(),
              last_error: `Instância ${instance.instance_name} caiu.`,
              updated_at: new Date().toISOString(),
            })
            .eq('id', firstJob.id);

          // Atualiza contato na tabela searches
          if (firstJob.contact_id) {
            await supabaseServiceRole
              .from('searches')
              .update({
                status: 'erro',
                updated_at: new Date().toISOString(),
              })
              .eq('id', firstJob.contact_id);
          }

          return { success: false, error: `Instância ${instance.instance_name} caiu. Job será retentado.` };
        }

        // Se não há mais instâncias disponíveis, PAUSA a campanha (não falha)
        console.warn(`⏸️ [CAMPANHA ${campaign.id}] Última instância da campanha caiu. Pausando campanha.`);
        
        await supabaseServiceRole
          .from('campaigns')
          .update({
            status: 'paused',
            observation: remainingInstances.length === 0 
              ? `Campanha pausada automaticamente: Todas as instâncias da campanha caíram. Última: ${instance.instance_name}`
              : `Campanha pausada automaticamente: Todas as instâncias disponíveis da campanha caíram.`,
            updated_at: new Date().toISOString(),
          })
          .eq('id', campaign.id);

        // Marca job como failed - sem retry
        await supabaseServiceRole
          .from('campaign_contacts')
          .update({
            status: 'failed',
            finished_at: new Date().toISOString(),
            last_error: `Instância ${instance.instance_name} caiu. Campanha pausada automaticamente.`,
            updated_at: new Date().toISOString(),
          })
          .eq('id', firstJob.id);

        // Atualiza contato na tabela searches
        if (firstJob.contact_id) {
          await supabaseServiceRole
            .from('searches')
            .update({
              status: 'erro',
              updated_at: new Date().toISOString(),
            })
            .eq('id', firstJob.contact_id);
        }

        return { success: false, error: `Instância ${instance.instance_name} caiu. Campanha pausada automaticamente.` };
      }

      // Se falhar por outros motivos, marca como failed e atualiza front-end imediatamente
      await supabaseServiceRole
        .from('campaign_contacts')
        .update({
          status: 'failed',
          finished_at: new Date().toISOString(),
          started_at: new Date().toISOString(),
          attempts: 1,
          last_error: responseData?.message || `HTTP ${response.status}`,
          updated_at: new Date().toISOString(),
        })
        .eq('id', firstJob.id);

      // Atualiza contato na tabela searches
      if (firstJob.contact_id) {
        await supabaseServiceRole
          .from('searches')
          .update({
            status: 'erro',
            updated_at: new Date().toISOString(),
          })
          .eq('id', firstJob.contact_id);
      }

      // Atualiza campanha IMEDIATAMENTE para o front-end ver (antes do delay)
      await supabaseServiceRole
        .from('campaigns')
        .update({
          processed_contacts: 0,
          failed_contacts: 1,
          updated_at: new Date().toISOString(),
        })
        .eq('id', campaign.id);

      console.log(`⚠️ [CAMPANHA ${campaign.id}] Primeiro contato falhou. Front-end atualizado imediatamente.`);
      return { success: false, error: responseData?.message || `HTTP ${response.status}` };
    }
    } catch (err: any) {
    const errorMsg = err.message || String(err);
    
    // Verifica se é um erro de conexão crítico
    const isConnectionError = 
      errorMsg.toLowerCase().includes('connection closed') ||
      errorMsg.toLowerCase().includes('econnreset') ||
      errorMsg.toLowerCase().includes('socket hang up');

    if (isConnectionError) {
      console.warn(`⏸️ [CAMPANHA ${campaign.id}] Erro de conexão crítico no primeiro job! Pausando campanha.`);
      
      // ⏸️ Pausar a campanha (não falhar)
      await supabaseServiceRole
        .from('campaigns')
        .update({
          status: 'paused',
          observation: `Campanha pausada automaticamente: Erro de conexão - ${errorMsg}. A instância pode ter caído.`,
          updated_at: new Date().toISOString(),
        })
        .eq('id', campaign.id);

      // Marca job como failed - sem retry
      await supabaseServiceRole
        .from('campaign_contacts')
        .update({
          status: 'failed',
          finished_at: new Date().toISOString(),
          last_error: `Erro de conexão: ${errorMsg}. Campanha pausada automaticamente.`,
          updated_at: new Date().toISOString(),
        })
        .eq('id', firstJob.id);

      // Atualiza contato na tabela searches
      if (firstJob.contact_id) {
        await supabaseServiceRole
          .from('searches')
          .update({
            status: 'erro',
            updated_at: new Date().toISOString(),
          })
          .eq('id', firstJob.contact_id);
      }

      return { success: false, error: `Erro de conexão. Campanha pausada automaticamente.` };
    }

    // Em caso de erro normal, marca como failed e atualiza front-end imediatamente
    await supabaseServiceRole
      .from('campaign_contacts')
      .update({
        status: 'failed',
        finished_at: new Date().toISOString(),
        started_at: new Date().toISOString(),
        attempts: 1,
        last_error: errorMsg,
        updated_at: new Date().toISOString(),
      })
      .eq('id', firstJob.id);

    // Atualiza contato na tabela searches
    if (firstJob.contact_id) {
      await supabaseServiceRole
        .from('searches')
        .update({
          status: 'erro',
          updated_at: new Date().toISOString(),
        })
        .eq('id', firstJob.contact_id);
    }

    // Atualiza campanha IMEDIATAMENTE para o front-end ver (antes do delay)
    await supabaseServiceRole
      .from('campaigns')
      .update({
        processed_contacts: 0,
        failed_contacts: 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', campaign.id);

    console.error(`❌ [CAMPANHA ${campaign.id}] Erro ao processar primeiro job. Front-end atualizado imediatamente.`);
    return { success: false, error: errorMsg };
  }
}

interface CampaignGroup {
  jid: string;
  subject: string;
  target_contacts: number;
}

interface CampaignContact {
  contactId: string;
  phone: string;
}

interface StartCampaignRequest {
  groups: CampaignGroup[];
  contacts: CampaignContact[];
  strategy: {
    delayConfig?: {
      delayMode?: 'random' | 'fixed';
      delayValue?: number;
      delayUnit?: 'seconds' | 'minutes';
      randomMinSeconds?: number;
      randomMaxSeconds?: number;
    };
    max_retries?: number;
    retry_backoff_minutes?: number[];
    preferUserBinding?: boolean;
    interval_minutes?: number; // Intervalo entre jobs (para schedule)
  };
  instances: string[];
  customListId?: string | null;
}

// Calcula delay em minutos baseado na strategy
function getIntervalMinutes(strategy: StartCampaignRequest['strategy']): number {
  const delayConfig = strategy.delayConfig || {};
  
  if (delayConfig.delayMode === 'random') {
    // Para random, usa média entre min e max
    const min = delayConfig.randomMinSeconds || 60;
    const max = delayConfig.randomMaxSeconds || 120;
    return Math.ceil((min + max) / 2 / 60); // Converte para minutos
  } else {
    const value = delayConfig.delayValue || 1;
    const unit = delayConfig.delayUnit === 'minutes' ? 1 : 1/60;
    return value * unit;
  }
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const body: StartCampaignRequest = await req.json();
    const { groups, contacts, strategy, instances, customListId } = body;

    // Validações
    if (!Array.isArray(groups) || groups.length === 0 || groups.length > 3) {
      return errorResponse('groups deve ser um array com 1 a 3 grupos', 400);
    }

    if (!Array.isArray(contacts) || contacts.length === 0) {
      return errorResponse('contacts é obrigatório e deve ser um array não vazio', 400);
    }

    if (!strategy || !Array.isArray(instances) || instances.length === 0) {
      return errorResponse('strategy e instances são obrigatórios', 400);
    }

    // Valida soma de target_contacts
    const totalTarget = groups.reduce((sum, g) => sum + (g.target_contacts || 0), 0);
    if (totalTarget !== contacts.length) {
      return errorResponse(
        `A soma de target_contacts (${totalTarget}) deve ser igual ao total de contatos (${contacts.length})`,
        400
      );
    }

    // Verifica rate limit
    const rateLimit = await rateLimitService.checkDailyLimit(userId);
    if (!rateLimit.allowed) {
      return errorResponse(
        `Limite diário atingido. Você pode adicionar até ${rateLimit.limit} leads por dia. Reset em ${new Date(rateLimit.resetAt).toLocaleTimeString()}`,
        429
      );
    }

    if (contacts.length > rateLimit.remaining) {
      return errorResponse(
        `Você pode adicionar apenas ${rateLimit.remaining} leads hoje. Tente novamente amanhã ou reduza a quantidade.`,
        429
      );
    }

    // Calcula intervalo entre jobs (em minutos)
    const intervalMinutes = strategy.interval_minutes || getIntervalMinutes(strategy) || 1;
    const intervalMs = intervalMinutes * 60 * 1000;

    const jids = groups.map(group => group.jid);
    const subjects = groups.map(group => group.subject);

    // Cria campanha
    const { data: campaign, error: campaignError } = await supabaseServiceRole
      .from('campaigns')
      .insert({
        user_id: userId,
        group_id: jids, // Mantém compatibilidade (primeiro grupo)
        group_subject: subjects || null,
        status: 'running', // Já inicia como running pois jobs serão criados
        total_contacts: contacts.length,
        processed_contacts: 0,
        failed_contacts: 0,
        strategy: {
          ...strategy,
          interval_minutes: intervalMinutes,
          max_retries: strategy.max_retries || 3,
          retry_backoff_minutes: strategy.retry_backoff_minutes || [1, 5, 15],
        },
        instances: instances,
        custom_list_id: customListId || null,
        started_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (campaignError || !campaign) {
      return errorResponse(`Erro ao criar campanha: ${campaignError?.message || 'Erro desconhecido'}`);
    }

    // Cria campaign_groups
    const groupsToInsert = groups.map((g, index) => ({
      campaign_id: campaign.id,
      user_id: userId,
      group_jid: g.jid,
      group_subject: g.subject || null,
      target_contacts: g.target_contacts,
      processed_contacts: 0,
      failed_contacts: 0,
    }));

    const { data: insertedGroups, error: groupsError } = await supabaseServiceRole
      .from('campaign_groups')
      .insert(groupsToInsert)
      .select();

    if (groupsError || !insertedGroups) {
      // Rollback: deleta campanha se grupos falharam
      await supabaseServiceRole.from('campaigns').delete().eq('id', campaign.id);
      return errorResponse(`Erro ao criar grupos: ${groupsError?.message || 'Erro desconhecido'}`);
    }

    // Distribui contatos pelos grupos conforme target_contacts
    const contactsByGroup: { [groupId: string]: CampaignContact[] } = {};
    let contactIndex = 0;

    for (const group of insertedGroups) {
      const target = group.target_contacts;
      contactsByGroup[group.id] = contacts.slice(contactIndex, contactIndex + target);
      contactIndex += target;
    }

    // Cria jobs na fila campaign_contacts
    const now = new Date();
    const jobsToInsert: any[] = [];
    let globalPosition = 1;

    for (const group of insertedGroups) {
      const groupContacts = contactsByGroup[group.id] || [];
      
      for (let i = 0; i < groupContacts.length; i++) {
        const contact = groupContacts[i];
        const normalizedPhone = normalizePhoneNumber(contact.phone);
        
        // scheduled_at: primeiro job = now(), demais = now() + (position-1) * interval
        const scheduledAt = new Date(now.getTime() + (globalPosition - 1) * intervalMs);

        jobsToInsert.push({
          campaign_id: campaign.id,
          campaign_group_id: group.id,
          user_id: userId,
          phone: normalizedPhone,
          contact_id: contact.contactId || null,
          position: globalPosition,
          status: 'queued',
          scheduled_at: scheduledAt.toISOString(),
          attempts: 0,
        });

        globalPosition++;
      }
    }

    // Insere jobs em lotes (Supabase tem limite de 1000 por insert)
    const BATCH_SIZE = 500;
    for (let i = 0; i < jobsToInsert.length; i += BATCH_SIZE) {
      const batch = jobsToInsert.slice(i, i + BATCH_SIZE);
      const { error: jobsError } = await supabaseServiceRole
        .from('campaign_contacts')
        .insert(batch);

      if (jobsError) {
        // Rollback: deleta campanha e grupos
        await supabaseServiceRole.from('campaigns').delete().eq('id', campaign.id);
        return errorResponse(`Erro ao criar jobs: ${jobsError.message}`);
      }
    }

    console.log(`✅ [CAMPANHA ${campaign.id}] Criada com ${insertedGroups.length} grupo(s) e ${jobsToInsert.length} job(s)`);
    console.log(`   Primeiro job scheduled_at: ${jobsToInsert[0]?.scheduled_at}`);
    console.log(`   Último job scheduled_at: ${jobsToInsert[jobsToInsert.length - 1]?.scheduled_at}`);

    // Processa o primeiro job imediatamente para sinalizar início da campanha
    const firstJob = jobsToInsert[0];
    if (firstJob) {
      // Busca o primeiro job criado no banco (com ID)
      const { data: firstJobData, error: firstJobError } = await supabaseServiceRole
        .from('campaign_contacts')
        .select('*')
        .eq('campaign_id', campaign.id)
        .eq('position', 1)
        .single();

      if (!firstJobError && firstJobData) {
        const firstGroup = insertedGroups.find((g: any) => g.id === firstJob.campaign_group_id) || insertedGroups[0];
        
        // Processa primeiro job em background (não bloqueia resposta)
        processFirstJobImmediately(firstJobData, campaign, firstGroup)
          .then((result) => {
            if (result.success) {
              console.log(`✅ [CAMPANHA ${campaign.id}] Primeiro contato adicionado com sucesso!`);
            } else {
              console.log(`⚠️ [CAMPANHA ${campaign.id}] Primeiro contato falhou, será retentado: ${result.error}`);
            }
          })
          .catch((err) => {
            console.error(`❌ [CAMPANHA ${campaign.id}] Erro ao processar primeiro job:`, err);
          });
      }
    }

    return successResponse(
      {
        campaign: {
          ...campaign,
          groups: insertedGroups,
          total_jobs: jobsToInsert.length,
        },
      },
      'Campanha criada e iniciada com sucesso. Primeiro contato sendo processado...'
    );
  } catch (err: any) {
    console.error('❌ Erro ao iniciar campanha:', err);
    return serverErrorResponse(err);
  }
}

