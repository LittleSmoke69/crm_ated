import { supabaseServiceRole } from './supabase-service';
import { getUserEvolutionApi } from './evolution-api-helper';
import { evolutionService } from './evolution-service';

export type InstanceStatus = 'ok' | 'rate_limited' | 'blocked' | 'error' | 'disconnected';

export interface EvolutionInstance {
  id: string;
  evolution_api_id: string;
  instance_name: string;
  phone_number: string | null;
  is_active: boolean;
  status: InstanceStatus;
  daily_limit: number | null;
  sent_today: number;
  error_today: number;
  rate_limit_count_today: number;
  last_used_at: string | null;
  cooldown_until: string | null;
  // Dados da Evolution API (join)
  evolution_api?: {
    id: string;
    name: string;
    base_url: string;
    api_key?: string; // apikey por instância (pickBestEvolutionInstance)
    api_key_global?: string; // token global da evolution_apis (getAllInstances)
    is_active: boolean;
  };
}

export interface PickInstanceOptions {
  userId?: string;
  preferUserBinding?: boolean;
  groupId?: string;
  leadPhone?: string;
}

export interface AddLeadToGroupParams {
  userId?: string;
  groupId: string;
  leadPhone: string;
  preferUserBinding?: boolean;
}

export interface AddLeadResult {
  success: boolean;
  error?: string;
  errorType?: 'rate_limit' | 'bad_request' | 'connection_closed' | 'unknown' | 'no_instance_available';
  instanceUsed?: {
    id: string;
    instance_name: string;
    evolution_api_id: string;
  };
  httpStatus?: number;
}

export class EvolutionBalancer {
  /**
   * Seleciona a melhor instância Evolution disponível para uso
   */
  async pickBestEvolutionInstance(
    options: PickInstanceOptions = {}
  ): Promise<EvolutionInstance | null> {
    const { userId, preferUserBinding = false } = options;
    const now = new Date().toISOString();

    // Base query: busca TODAS as instâncias ativas e disponíveis (balanceamento global)
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
      .not('apikey', 'is', null); // CRÍTICO: Só instâncias com apikey

    // Atribuição de usuário é OPCIONAL - apenas prioriza se preferUserBinding=true e usuário tem APIs atribuídas
    if (preferUserBinding && userId) {
      // Tenta priorizar instâncias vinculadas ao usuário (se tiver)
      const { data: userApiBindings } = await supabaseServiceRole
        .from('user_evolution_apis')
        .select('evolution_api_id')
        .eq('user_id', userId);

      if (userApiBindings && userApiBindings.length > 0) {
        const userApiIds = userApiBindings.map((b) => b.evolution_api_id);
        // Primeiro tenta apenas APIs do usuário
        const userQuery = query.in('evolution_api_id', userApiIds);
        const { data: userCandidates } = await userQuery;

        // Se encontrou instâncias do usuário, usa apenas elas
        if (userCandidates && userCandidates.length > 0) {
          const available = userCandidates.filter((inst: any) => {
            if (inst.cooldown_until) {
              const cooldownUntil = new Date(inst.cooldown_until);
              if (cooldownUntil > new Date()) return false;
            }
            if (inst.daily_limit !== null && inst.sent_today >= inst.daily_limit) {
              return false;
            }
            return true;
          });

          if (available.length > 0) {
            // Calcula score e retorna melhor instância do usuário
            return await this.selectBestFromCandidates(available, now);
          }
        }
      }
      // Se não encontrou do usuário ou preferUserBinding=false, continua com todas as instâncias
    }

    // Executa query
    const { data: candidates, error } = await query;

    if (error) {
      console.error('Erro ao buscar instâncias candidatas:', error);
      return null;
    }

    if (!candidates || candidates.length === 0) {
      return null;
    }

    // Filtra por cooldown e daily_limit
    const availableCandidates = candidates.filter((inst: any) => {
      // Verifica cooldown
      if (inst.cooldown_until) {
        const cooldownUntil = new Date(inst.cooldown_until);
        if (cooldownUntil > new Date()) {
          return false; // Ainda em cooldown
        }
      }

      // Verifica daily_limit
      if (inst.daily_limit !== null && inst.sent_today >= inst.daily_limit) {
        return false;
      }

      return true;
    });

    if (availableCandidates.length === 0) {
      return null;
    }

    // Seleciona melhor candidato
    return this.selectBestFromCandidates(availableCandidates, now);
  }

  /**
   * Método auxiliar para selecionar a melhor instância de uma lista de candidatos
   */
  private async selectBestFromCandidates(candidates: any[], now: string): Promise<EvolutionInstance | null> {
    if (candidates.length === 0) return null;

    console.log(`\n📊 [BALANCEADOR] Selecionando melhor instância entre ${candidates.length} candidato(s)`);

    // Calcula score para cada candidato e seleciona o melhor
    const scored = candidates.map((inst: any) => {
      const evolutionApi = Array.isArray(inst.evolution_apis) 
        ? inst.evolution_apis[0] 
        : inst.evolution_apis;

      const lastUsedAt = inst.last_used_at ? new Date(inst.last_used_at).getTime() : 0;
      const secondsSinceLastUse = lastUsedAt > 0 
        ? (Date.now() - lastUsedAt) / 1000 
        : 999999; // Nunca usado = muito tempo

      // Score: menor sent_today = melhor, maior tempo desde uso = melhor
      // Formula: (1 / (sent_today + 1)) + (secondsSinceLastUse / 1000) + random pequeno
      const usageScore = 1 / (inst.sent_today + 1);
      const timeScore = Math.min(secondsSinceLastUse / 1000, 100); // Cap em 100
      const randomScore = Math.random() * 0.1; // 0-0.1 para evitar padrão previsível
      const totalScore = usageScore + timeScore + randomScore;

      return {
        instance: inst,
        score: totalScore,
        metrics: {
          instanceName: inst.instance_name,
          evolutionApi: evolutionApi?.name || 'N/A',
          sentToday: inst.sent_today,
          errorToday: inst.error_today,
          dailyLimit: inst.daily_limit,
          secondsSinceLastUse: Math.round(secondsSinceLastUse),
          usageScore: usageScore.toFixed(4),
          timeScore: timeScore.toFixed(2),
          randomScore: randomScore.toFixed(4),
          totalScore: totalScore.toFixed(4),
        },
      };
    });

    // Ordena por score (maior primeiro)
    scored.sort((a, b) => b.score - a.score);

    // Log detalhado das top 3 candidatas
    console.log(`📈 [BALANCEADOR] Top 3 candidatas:`);
    scored.slice(0, 3).forEach((item, idx) => {
      console.log(`   ${idx + 1}. ${item.metrics.instanceName} (${item.metrics.evolutionApi})`);
      console.log(`      Score: ${item.metrics.totalScore} | Enviados hoje: ${item.metrics.sentToday}/${item.metrics.dailyLimit || '∞'} | Tempo desde último uso: ${item.metrics.secondsSinceLastUse}s`);
    });

    const selected = scored[0].instance;
    const selectedApi = Array.isArray(selected.evolution_apis) 
      ? selected.evolution_apis[0] 
      : selected.evolution_apis;

    console.log(`✅ [BALANCEADOR] Instância selecionada: ${selected.instance_name}`);
    console.log(`   Evolution API: ${selectedApi?.name || 'N/A'} (${selectedApi?.base_url})`);
    console.log(`   Status: ${selected.status} | Enviados hoje: ${selected.sent_today}/${selected.daily_limit || '∞'}\n`);

    // Atualiza last_used_at
    await supabaseServiceRole
      .from('evolution_instances')
      .update({
        last_used_at: now,
        updated_at: now,
      })
      .eq('id', selected.id);

    // Retorna instância formatada
    return {
      id: selected.id,
      evolution_api_id: selected.evolution_api_id,
      instance_name: selected.instance_name,
      phone_number: selected.phone_number,
      is_active: selected.is_active,
      status: selected.status as InstanceStatus,
      daily_limit: selected.daily_limit,
      sent_today: selected.sent_today,
      error_today: selected.error_today,
      rate_limit_count_today: selected.rate_limit_count_today,
      last_used_at: selected.last_used_at,
      cooldown_until: selected.cooldown_until,
      evolution_api: Array.isArray(selected.evolution_apis) 
        ? selected.evolution_apis[0] 
        : selected.evolution_apis,
    };
  }

  /**
   * Adiciona um lead a um grupo usando balanceamento inteligente
   */
  async addLeadToGroup(params: AddLeadToGroupParams): Promise<AddLeadResult> {
    const { userId, groupId, leadPhone, preferUserBinding = false } = params;

    const startTime = Date.now();
    console.log(`🚀 [BALANCEADOR] addLeadToGroup iniciado - Lead: ${leadPhone}, Grupo: ${groupId}`);

    // 1. Seleciona a melhor instância
    console.log(`🔍 [BALANCEADOR] Selecionando instância para lead ${leadPhone}...`);
    const instance = await this.pickBestEvolutionInstance({
      userId,
      preferUserBinding,
      groupId,
      leadPhone,
    });

    if (!instance || !instance.evolution_api) {
      console.log(`❌ [BALANCEADOR] Nenhuma instância disponível para adicionar lead ${leadPhone}`);
      return {
        success: false,
        error: 'Nenhuma instância Evolution disponível no momento. Tente novamente em alguns minutos.',
        errorType: 'no_instance_available',
      };
    }

    const { base_url } = instance.evolution_api;
    const { instance_name } = instance;
    
    // CRÍTICO: Busca a apikey da instância (não a global)
    const { data: instanceData } = await supabaseServiceRole
      .from('evolution_instances')
      .select('apikey')
      .eq('id', instance.id)
      .single();
    
    const instanceApikey = instanceData?.apikey;
    
    if (!instanceApikey) {
      console.error(`❌ [BALANCEADOR] Instância ${instance_name} não possui apikey`);
      return {
        success: false,
        error: 'Instância não possui apikey configurada',
        errorType: 'unknown',
        httpStatus: 0,
      };
    }

    console.log(`✅ [BALANCEADOR] Instância selecionada: ${instance_name} (${base_url})`);
    console.log(`📞 [BALANCEADOR] Preparando chamada DIRETA para Evolution API - Lead: ${leadPhone}, Grupo: ${groupId}`);
    console.log(`🔑 [BALANCEADOR] Usando apikey da instância: ${instanceApikey.substring(0, 10)}...`);

    // SIMPLIFICADO: Faz request DIRETO para Evolution API
    let result: {
      success: boolean;
      error?: string;
      errorType?: 'rate_limit' | 'bad_request' | 'connection_closed' | 'unknown';
      added?: number;
      httpStatus?: number;
      responseData?: any;
    };

    try {
      console.log(`🚀 [BALANCEADOR] Fazendo request DIRETO para Evolution API...`);
      
      // Normaliza URL
      const normalizedBaseUrl = this.normalizeBaseUrl(base_url);
      const url = `${normalizedBaseUrl}/group/updateParticipant/${instance_name}?groupJid=${encodeURIComponent(groupId)}`;
      const finalUrl = url.replace(/([^:]\/)\/+/g, '$1');
      
      // Body conforme curl fornecido
      const body = {
        action: 'add',
        participants: [leadPhone],
      };
      
      console.log(`📤 [BALANCEADOR] URL: ${finalUrl}`);
      console.log(`📤 [BALANCEADOR] Body:`, JSON.stringify(body));
      
      // Timeout de 30 segundos
      const FETCH_TIMEOUT_MS = 30000;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, FETCH_TIMEOUT_MS);
      
      const response = await fetch(finalUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: instanceApikey, // CRÍTICO: Usa apikey da instância
        },
        body: JSON.stringify(body),
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
      
      // Tratamento de respostas
      if (response.ok) {
        result = {
          success: true,
          added: 1,
          httpStatus: response.status,
          responseData,
        };
      } else if (response.status === 403) {
        result = {
          success: false,
          error: 'Rate limit (403)',
          errorType: 'rate_limit',
          added: 0,
          httpStatus: 403,
          responseData,
        };
      } else if (response.status === 400) {
        const errorMsg = responseData?.message || responseText || 'Bad request';
        const isConnectionClosed = errorMsg.toLowerCase().includes('connection closed');
        
        result = {
          success: false,
          error: isConnectionClosed ? 'Connection Closed' : errorMsg,
          errorType: isConnectionClosed ? 'connection_closed' : 'bad_request',
          added: 0,
          httpStatus: 400,
          responseData,
        };
      } else {
        result = {
          success: false,
          error: responseData?.message || `Erro HTTP ${response.status}`,
          errorType: 'unknown',
          added: 0,
          httpStatus: response.status,
          responseData,
        };
      }
      
      console.log(`✅ [BALANCEADOR] Request concluído - Sucesso: ${result.success}, Status: ${result.httpStatus}`);
    } catch (error: any) {
      console.error(`❌ [BALANCEADOR] Erro ao fazer request:`, error);
      
      const isTimeout = error?.name === 'AbortError' || error?.message?.toLowerCase().includes('timeout');
      
      result = {
        success: false,
        error: isTimeout ? 'Timeout na requisição' : (error?.message || 'Erro desconhecido'),
        errorType: 'unknown',
        httpStatus: 0,
        responseData: { error: error?.message },
      };
    }

    // 3. Atualiza contadores e registra log
    console.log(`📊 [BALANCEADOR] Processando resultado - Sucesso: ${result.success}, Erro: ${result.error || 'N/A'}`);
    await this.handleInstanceResult(instance, result, {
      groupId,
      leadPhone,
    });

    const totalDuration = Date.now() - startTime;
    console.log(`🏁 [BALANCEADOR] addLeadToGroup concluído em ${totalDuration}ms - Sucesso: ${result.success}`);

    return {
      success: result.success,
      error: result.error,
      errorType: result.errorType,
      instanceUsed: {
        id: instance.id,
        instance_name: instance.instance_name,
        evolution_api_id: instance.evolution_api_id,
      },
      httpStatus: result.httpStatus,
    };
  }

  /**
   * Normaliza a URL base removendo barras duplas e garantindo formato correto
   * IMPORTANTE: Remove barra final e barras duplas, mas preserva :// do protocolo
   */
  private normalizeBaseUrl(baseUrl: string): string {
    if (!baseUrl) return baseUrl;
    
    // Remove espaços em branco
    let normalized = baseUrl.trim();
    
    // Remove barra final se existir (pode ter múltiplas barras)
    normalized = normalized.replace(/\/+$/, '');
    
    // Remove barras duplas no meio da URL, mas preserva :// do protocolo (http:// ou https://)
    // Regex: substitui / seguido de uma ou mais / por apenas uma /, mas não mexe em ://
    normalized = normalized.replace(/([^:]\/)\/+/g, '$1');
    
    return normalized;
  }

  /**
   * Chama a Evolution API para adicionar participantes (wrapper com base_url customizada)
   */
  private async callEvolutionAddParticipants(
    baseUrl: string,
    apiKey: string,
    instanceName: string,
    groupId: string,
    participants: string[]
  ): Promise<{
    success: boolean;
    error?: string;
    errorType?: 'rate_limit' | 'bad_request' | 'connection_closed' | 'unknown';
    added?: number;
    httpStatus?: number;
    responseData?: any;
  }> {
    // Normaliza a base_url para garantir formato correto
    const normalizedBaseUrl = this.normalizeBaseUrl(baseUrl);
    
    // Constrói a URL garantindo apenas uma barra entre base_url e o path
    const url = `${normalizedBaseUrl}/group/updateParticipant/${instanceName}?groupJid=${encodeURIComponent(groupId)}`;
    
    // Validação final: remove qualquer barra dupla que possa ter sobrado
    const finalUrl = url.replace(/([^:]\/)\/+/g, '$1');
    
    // Validação adicional: verifica se não há barras duplas
    if (finalUrl.includes('//') && !finalUrl.includes('://')) {
      console.error(`❌ [BALANCEADOR] ERRO: URL ainda contém barras duplas após normalização: ${finalUrl}`);
      // Tenta corrigir novamente
      const correctedUrl = finalUrl.replace(/([^:]\/)\/+/g, '$1');
      console.log(`🔧 [BALANCEADOR] Tentando corrigir: ${correctedUrl}`);
    }
    
    const payload = {
      action: 'add',
      participants: participants,
    };

    console.log(`📤 [BALANCEADOR] callEvolutionAddParticipants - Base URL original: ${baseUrl}`);
    console.log(`📤 [BALANCEADOR] callEvolutionAddParticipants - Base URL normalizada: ${normalizedBaseUrl}`);
    console.log(`📤 [BALANCEADOR] callEvolutionAddParticipants - URL final: ${finalUrl}`);
    console.log(`✅ [BALANCEADOR] Validação: URL contém barras duplas? ${finalUrl.includes('//') && !finalUrl.includes('://') ? 'SIM (ERRO!)' : 'NÃO (OK)'}`);
    console.log(`📤 [BALANCEADOR] Payload:`, JSON.stringify(payload));
    console.log(`📤 [BALANCEADOR] Headers: apikey presente: ${!!apiKey}`);

    const fetchStartTime = Date.now();
    try {
      console.log(`🔄 [BALANCEADOR] Iniciando fetch para Evolution API...`);
      
      // Timeout de 30 segundos para evitar travamentos
      const FETCH_TIMEOUT_MS = 30000; // 30 segundos
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
        console.warn(`⏱️ [BALANCEADOR] Timeout de ${FETCH_TIMEOUT_MS}ms atingido para ${url}`);
      }, FETCH_TIMEOUT_MS);
      
      let response: Response;
      try {
        response = await fetch(finalUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: apiKey,
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
      } catch (fetchError: any) {
        clearTimeout(timeoutId);
        // Se foi abortado por timeout, relança com mensagem específica
        if (fetchError.name === 'AbortError' || controller.signal.aborted) {
          throw new Error(`Timeout: requisição excedeu ${FETCH_TIMEOUT_MS}ms`);
        }
        throw fetchError;
      }

      const fetchDuration = Date.now() - fetchStartTime;
      console.log(`⏱️ [BALANCEADOR] Fetch concluído em ${fetchDuration}ms - Status: ${response.status}`);

      const responseText = await response.text();
      console.log(`📥 [BALANCEADOR] Resposta recebida (${responseText.length} caracteres)`);
      
      let responseData: any = {};
      
      try {
        responseData = JSON.parse(responseText);
        console.log(`📥 [BALANCEADOR] Resposta JSON parseada:`, JSON.stringify(responseData).substring(0, 200));
      } catch {
        responseData = { message: responseText, raw: responseText };
        console.log(`📥 [BALANCEADOR] Resposta não é JSON, usando texto:`, responseText.substring(0, 200));
      }

      // Tratamento de erros igual ao EvolutionService
      if (response.status === 403) {
        return {
          success: false,
          error: 'Lead não foi adicionado ao grupo (403)',
          errorType: 'rate_limit',
          added: 0,
          httpStatus: 403,
          responseData,
        };
      }

      if (response.status === 400) {
        const errorMsg = responseData?.message || responseText || 'Bad request';
        
        // IMPORTANTE: Detecção mais precisa de "connection closed" baseada no código antigo
        // Só marca como connection_closed se for realmente connection closed, não outros erros 400
        const parseIsConnectionClosed = (status: number, text: string, data: any): boolean => {
          if (status !== 400) return false;
          
          try {
            // Tenta extrair mensagem de diferentes formatos de resposta
            const msgs = data?.response?.message || data?.message || text;
            const flat = Array.isArray(msgs) ? msgs.join(' ').toLowerCase() : String(msgs || '').toLowerCase();
            
            // Só retorna true se explicitamente mencionar "connection closed"
            // Não marca como disconnected em outros casos
            return flat.includes('connection closed');
          } catch {
            // Fallback: verifica no texto bruto
            return text.toLowerCase().includes('connection closed');
          }
        };

        const isConnectionClosed = parseIsConnectionClosed(response.status, responseText, responseData);

        if (isConnectionClosed) {
          console.warn(`⚠️ [BALANCEADOR] Connection Closed detectado - Status 400 com mensagem "connection closed"`);
          return {
            success: false,
            error: 'Connection Closed - número pode estar banido ou desconectado',
            errorType: 'connection_closed',
            added: 0,
            httpStatus: 400,
            responseData,
          };
        }

        // Outros erros 400 não são connection closed
        console.log(`⚠️ [BALANCEADOR] Bad Request (400) mas NÃO é connection closed: ${errorMsg}`);
        return {
          success: false,
          error: errorMsg,
          errorType: 'bad_request',
          added: 0,
          httpStatus: 400,
          responseData,
        };
      }

      if (!response.ok) {
        return {
          success: false,
          error: responseData?.message || `Erro HTTP ${response.status}`,
          errorType: 'unknown',
          added: 0,
          httpStatus: response.status,
          responseData,
        };
      }

      // Sucesso
      console.log(`✅ [BALANCEADOR] Sucesso ao adicionar participantes!`);
      return {
        success: true,
        added: participants.length,
        httpStatus: response.status,
        responseData,
      };
    } catch (error: any) {
      const errorDuration = Date.now() - fetchStartTime;
      console.error(`❌ [BALANCEADOR] Erro no fetch após ${errorDuration}ms:`, error);
      console.error(`❌ [BALANCEADOR] Erro detalhado:`, {
        message: error?.message,
        name: error?.name,
        code: error?.code,
        cause: error?.cause,
        stack: error?.stack?.substring(0, 500),
      });
      
      // Verifica se é erro de timeout
      const isTimeout = 
        error?.message?.toLowerCase().includes('timeout') ||
        error?.name === 'AbortError' ||
        error?.message?.toLowerCase().includes('excedeu');
      
      // IMPORTANTE: Timeout NÃO é connection closed - é apenas um problema temporário de rede
      // Não deve marcar a instância como desconectada
      if (isTimeout) {
        console.error(`⏱️ [BALANCEADOR] Timeout na requisição para ${finalUrl} após ${errorDuration}ms`);
        console.log(`⚠️ [BALANCEADOR] Timeout é um erro temporário, NÃO marca instância como desconectada`);
        return {
          success: false,
          error: `Timeout: requisição excedeu o tempo limite (${errorDuration}ms)`,
          errorType: 'unknown', // Timeout não é connection_closed
          added: 0,
          httpStatus: 0,
          responseData: { 
            error: error?.message, 
            code: error?.code,
            type: 'timeout',
            duration: errorDuration 
          },
        };
      }

      // Verifica se é erro de conexão REAL (ECONNRESET, ECONNREFUSED)
      // IMPORTANTE: Erros de rede temporários NÃO devem marcar como connection_closed
      // Só marca se for explicitamente "connection closed" na mensagem
      const isRealConnectionClosed = 
        error?.message?.toLowerCase().includes('connection closed') &&
        !error?.message?.toLowerCase().includes('timeout') &&
        !error?.message?.toLowerCase().includes('excedeu');

      // Erros de rede temporários (ECONNRESET, ECONNREFUSED) são tratados como 'unknown'
      // Não marcam a instância como desconectada, pois podem ser problemas temporários
      const isTemporaryNetworkError = 
        error?.code === 'ECONNRESET' ||
        error?.code === 'ECONNREFUSED' ||
        error?.code === 'ETIMEDOUT' ||
        error?.cause?.code === 'ECONNRESET' ||
        error?.cause?.code === 'ECONNREFUSED' ||
        error?.message?.toLowerCase().includes('econnreset') ||
        error?.message?.toLowerCase().includes('econnrefused') ||
        error?.message?.toLowerCase().includes('socket hang up');

      if (isRealConnectionClosed) {
        console.error(`🔌 [BALANCEADOR] Connection Closed REAL detectado:`, {
          message: error?.message,
          code: error?.code,
        });
        return {
          success: false,
          error: 'Connection Closed - número pode estar banido ou desconectado',
          errorType: 'connection_closed',
          added: 0,
          httpStatus: 0,
          responseData: { 
            error: error?.message, 
            code: error?.code,
            duration: errorDuration 
          },
        };
      }

      if (isTemporaryNetworkError) {
        console.warn(`⚠️ [BALANCEADOR] Erro de rede temporário detectado (NÃO marca como desconectado):`, {
          code: error?.code || error?.cause?.code,
          message: error?.message,
          host: error?.cause?.host || new URL(finalUrl).hostname,
          port: error?.cause?.port,
        });
        return {
          success: false,
          error: 'Erro temporário de conexão - tente novamente',
          errorType: 'unknown', // Erro temporário, não marca como desconectado
          added: 0,
          httpStatus: 0,
          responseData: { 
            error: error?.message, 
            code: error?.code || error?.cause?.code,
            host: error?.cause?.host,
            port: error?.cause?.port,
            duration: errorDuration,
            type: 'temporary_network_error'
          },
        };
      }

      return {
        success: false,
        error: error?.message || 'Erro desconhecido ao adicionar participantes',
        errorType: 'unknown',
        added: 0,
        httpStatus: 0,
        responseData: { 
          error: error?.message, 
          name: error?.name, 
          code: error?.code,
          cause: error?.cause,
          duration: errorDuration 
        },
      };
    }
  }

  /**
   * Processa o resultado da chamada e atualiza instância + logs
   */
  private async handleInstanceResult(
    instance: EvolutionInstance,
    result: {
      success: boolean;
      error?: string;
      errorType?: 'rate_limit' | 'bad_request' | 'connection_closed' | 'unknown';
      httpStatus?: number;
      responseData?: any;
    },
    metadata: {
      groupId?: string;
      leadPhone?: string;
    }
  ): Promise<void> {
    const now = new Date().toISOString();
    const { groupId, leadPhone } = metadata;

    if (result.success) {
      // Sucesso: incrementa sent_today e registra log
      await supabaseServiceRole
        .from('evolution_instances')
        .update({
          sent_today: instance.sent_today + 1,
          updated_at: now,
        })
        .eq('id', instance.id);

      await supabaseServiceRole
        .from('evolution_instance_logs')
        .insert({
          evolution_instance_id: instance.id,
          type: 'success',
          http_status: result.httpStatus || null,
          group_id: groupId || null,
          lead_phone: leadPhone || null,
        });
    } else {
      // Erro: processa baseado no tipo
      let newStatus = instance.status;
      let newCooldownUntil: string | null = null;
      const updates: any = {
        error_today: instance.error_today + 1,
        updated_at: now,
      };

      if (result.errorType === 'rate_limit') {
        // Rate limit: coloca em cooldown por 5 minutos
        newCooldownUntil = new Date(Date.now() + 5 * 60 * 1000).toISOString();
        updates.cooldown_until = newCooldownUntil;
        updates.rate_limit_count_today = instance.rate_limit_count_today + 1;
        // Mantém status como 'ok' mas com cooldown

        await supabaseServiceRole
          .from('evolution_instance_logs')
          .insert({
            evolution_instance_id: instance.id,
            type: 'rate_limit',
            http_status: result.httpStatus || null,
            error_message: result.error || null,
            group_id: groupId || null,
            lead_phone: leadPhone || null,
            raw_response_snippet: result.responseData 
              ? JSON.stringify(result.responseData).substring(0, 500) 
              : null,
          });
      } else if (result.errorType === 'connection_closed') {
        // IMPORTANTE: Só marca como disconnected se for realmente connection closed
        // Verifica se a resposta confirma que é connection closed
        const responseData = result.responseData || {};
        const errorMsg = (responseData.message || result.error || '').toLowerCase();
        
        // Só marca como desconectado se explicitamente mencionar "connection closed"
        // Não marca em erros temporários ou outros problemas
        if (errorMsg.includes('connection closed') || 
            errorMsg.includes('blocked-integrity-enforcement') ||
            (result.httpStatus === 400 && (errorMsg.includes('connection closed') || errorMsg.includes('blocked-integrity-enforcement')))) {
          console.warn(`⚠️ [BALANCEADOR] Marcando instância ${instance.instance_name} como desconectada - Connection Closed ou Bloqueio confirmado`);
          newStatus = 'disconnected';
          updates.status = 'disconnected';
          // Não alterar is_active: instância continua na lista /instancias como desconectada (exclusão = DELETE explícito).

          await supabaseServiceRole
            .from('evolution_instance_logs')
            .insert({
              evolution_instance_id: instance.id,
              type: 'disconnected',
              http_status: result.httpStatus || null,
              error_message: result.error || null,
              group_id: groupId || null,
              lead_phone: leadPhone || null,
              raw_response_snippet: result.responseData 
                ? JSON.stringify(result.responseData).substring(0, 500) 
                : null,
            });
        } else {
          // Se não for connection closed confirmado, trata como erro genérico
          console.log(`⚠️ [BALANCEADOR] Erro marcado como connection_closed mas não confirma - tratando como erro genérico`);
          await supabaseServiceRole
            .from('evolution_instance_logs')
            .insert({
              evolution_instance_id: instance.id,
              type: 'error',
              http_status: result.httpStatus || null,
              error_message: result.error || null,
              error_code: 'connection_closed_unconfirmed',
              group_id: groupId || null,
              lead_phone: leadPhone || null,
              raw_response_snippet: result.responseData 
                ? JSON.stringify(result.responseData).substring(0, 500) 
                : null,
            });
        }
      } else {
        // Outro erro
        await supabaseServiceRole
          .from('evolution_instance_logs')
          .insert({
            evolution_instance_id: instance.id,
            type: 'error',
            http_status: result.httpStatus || null,
            error_message: result.error || null,
            error_code: result.errorType || null,
            group_id: groupId || null,
            lead_phone: leadPhone || null,
            raw_response_snippet: result.responseData 
              ? JSON.stringify(result.responseData).substring(0, 500) 
              : null,
          });
      }

      await supabaseServiceRole
        .from('evolution_instances')
        .update(updates)
        .eq('id', instance.id);
    }
  }

  /**
   * Obtém lista de todas as instâncias com status
   */
  async getAllInstances(): Promise<EvolutionInstance[]> {
    const { data, error } = await supabaseServiceRole
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
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Erro ao buscar instâncias:', error);
      return [];
    }

    return (data || []).map((inst: any) => ({
      id: inst.id,
      evolution_api_id: inst.evolution_api_id,
      instance_name: inst.instance_name,
      phone_number: inst.phone_number,
      is_active: inst.is_active,
      status: inst.status as InstanceStatus,
      daily_limit: inst.daily_limit,
      sent_today: inst.sent_today,
      error_today: inst.error_today,
      rate_limit_count_today: inst.rate_limit_count_today,
      last_used_at: inst.last_used_at,
      cooldown_until: inst.cooldown_until,
      evolution_api: Array.isArray(inst.evolution_apis) 
        ? inst.evolution_apis[0] 
        : inst.evolution_apis,
    }));
  }
}

export const evolutionBalancer = new EvolutionBalancer();

