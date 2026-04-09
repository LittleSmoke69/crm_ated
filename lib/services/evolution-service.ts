export interface EvolutionInstance {
  instanceName: string;
  number?: string;
  qrcode?: {
    base64: string;
  };
  hash?: string;
  state?: string;
}

export interface EvolutionGroup {
  id: string;
  subject: string;
  pictureUrl?: string;
  size?: number;
}

export class EvolutionService {
  /**
   * Cria uma nova instância WhatsApp
   * @param baseUrl URL base da Evolution API (obtida do banco de dados)
   * @param apiKey Chave da API (obtida do banco de dados)
   */
  async createInstance(
    instanceName: string,
    number: string,
    baseUrl: string,
    apiKey: string,
    qrcode: boolean = true,
    options?: {
      webhook?: { enabled: boolean; url: string; events: readonly string[]; base64?: boolean };
    }
  ): Promise<EvolutionInstance> {
    const normalizedBaseUrl = this.normalizeBaseUrl(baseUrl);
    const requestUrl = `${normalizedBaseUrl}/instance/create`.replace(/([^:]\/)\/+/g, '$1');

    const body: Record<string, unknown> = {
      instanceName,
      qrcode,
      number: number || '',
      integration: 'WHATSAPP-BAILEYS',
    };
    if (options?.webhook) {
      body.webhook = options.webhook;
    }

    const response = await fetch(requestUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || `Erro ao criar instância: ${response.statusText}`);
    }

    return await response.json();
  }

  /**
   * Verifica o status de conexão de uma instância.
   * Usa timeout e retry para falhas de rede temporárias (maior estabilidade).
   * @param baseUrl URL base da Evolution API (obtida do banco de dados)
   */
  async getConnectionState(instanceName: string, apiKey: string, baseUrl: string): Promise<any> {
    const FETCH_TIMEOUT_MS = 15000; // 15s para evitar requisições penduradas
    const MAX_RETRIES = 2; // 1 tentativa inicial + 1 retry em falha de rede

    const normalizedBaseUrl = this.normalizeBaseUrl(baseUrl);
    const url = `${normalizedBaseUrl}/instance/connectionState/${instanceName}`;
    const finalUrl = url.replace(/([^:]\/)\/+/g, '$1');

    const doFetch = async (): Promise<Response> => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        const response = await fetch(finalUrl, {
          method: 'GET',
          headers: { apikey: apiKey },
          cache: 'no-store',
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        return response;
      } catch (err: any) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
          throw new Error(`Timeout: verificação de status excedeu ${FETCH_TIMEOUT_MS / 1000}s`);
        }
        throw err;
      }
    };

    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        console.log(`📡 [GET STATUS] Chamando: ${finalUrl} (tentativa ${attempt}/${MAX_RETRIES})`);
        console.log(`🔑 [GET STATUS] API Key: ${apiKey.substring(0, 10)}...${apiKey.substring(apiKey.length - 4)} (total: ${apiKey.length} caracteres)`);

        const response = await doFetch();

        console.log(`📡 [GET STATUS] Status da resposta: ${response.status} ${response.statusText}`);
        console.log(`📋 [GET STATUS] Headers da resposta:`, Object.fromEntries(response.headers.entries()));

        if (!response.ok) {
          const errorText = await response.text().catch(() => '');
          console.error(`❌ [GET STATUS] Erro ao verificar status da instância ${instanceName}`);
          console.error(`❌ [GET STATUS] Status: ${response.status} ${response.statusText}`);
          console.error(`❌ [GET STATUS] Erro completo (SEM CORTES):`, errorText);
          throw new Error(`Erro ao verificar status: ${response.status} ${response.statusText} - ${errorText}`);
        }

        const result = await response.json().catch(async () => {
          const textResult = await response.text().catch(() => '');
          console.log(`⚠️ [GET STATUS] Resposta não é JSON, retornando texto (SEM CORTES):`, textResult);
          return { raw: textResult };
        });

        console.log(`✅ [GET STATUS] Instância ${instanceName} - resposta recebida com sucesso`);
        console.log(`📦 [GET STATUS] Resposta COMPLETA (SEM CORTES):`, JSON.stringify(result, null, 2));
        console.log(`📦 [GET STATUS] Tipo da resposta:`, typeof result);
        console.log(`📦 [GET STATUS] Chaves da resposta:`, Object.keys(result || {}));

        return result;
      } catch (err: any) {
        lastError = err;
        const isRetryable =
          err?.message?.includes('Timeout') ||
          err?.code === 'ECONNRESET' ||
          err?.code === 'ECONNREFUSED' ||
          err?.code === 'ETIMEDOUT' ||
          err?.cause?.code === 'ECONNRESET' ||
          err?.cause?.code === 'ECONNREFUSED' ||
          err?.message?.toLowerCase().includes('econnreset') ||
          err?.message?.toLowerCase().includes('econnrefused') ||
          err?.message?.toLowerCase().includes('socket hang up');
        if (attempt < MAX_RETRIES && isRetryable) {
          console.warn(`⚠️ [GET STATUS] Tentativa ${attempt} falhou (${err?.message}), retry em 1s...`);
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }
        throw err;
      }
    }
    throw lastError || new Error('Falha ao verificar status da instância');
  }

  /**
   * Conecta/reconecta uma instância.
   * Usa timeout para evitar requisições penduradas (maior estabilidade).
   * Endpoint: {baseUrl}/instance/connect/{instanceName}
   * Método: GET
   * Header: apikey: {global_api_key}
   *
   * @param instanceName Nome da instância no banco de dados
   * @param apiKey API key global da Evolution API (global_api_key)
   * @param baseUrl URL base da Evolution API (obtida do banco de dados)
   */
  async connectInstance(instanceName: string, apiKey: string, baseUrl: string): Promise<any> {
    const FETCH_TIMEOUT_MS = 20000; // 20s para reconexão (pode demorar mais que status)

    const normalizedBaseUrl = this.normalizeBaseUrl(baseUrl);
    const url = `${normalizedBaseUrl}/instance/connect/${instanceName}`;
    const finalUrl = url.replace(/([^:]\/)\/+/g, '$1');

    console.log(`🔌 [RECONNECT] Chamando: ${finalUrl}`);
    console.log(`🔑 [RECONNECT] API Key: ${apiKey.substring(0, 10)}...${apiKey.substring(apiKey.length - 4)} (total: ${apiKey.length} caracteres)`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(finalUrl, {
        method: 'GET',
        headers: { apikey: apiKey },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        throw new Error(`Timeout: reconexão excedeu ${FETCH_TIMEOUT_MS / 1000}s. Tente novamente.`);
      }
      throw err;
    }

    console.log(`📡 [RECONNECT] Status da resposta: ${response.status} ${response.statusText}`);
    console.log(`📋 [RECONNECT] Headers da resposta:`, Object.fromEntries(response.headers.entries()));

    if (!response.ok) {
      const error = await response.text().catch(() => '');
      console.error(`❌ [RECONNECT] Erro ao reconectar instância ${instanceName}`);
      console.error(`❌ [RECONNECT] Status: ${response.status} ${response.statusText}`);
      console.error(`❌ [RECONNECT] Erro completo (SEM CORTES):`, error);
      throw new Error(`Erro ao conectar: ${response.status} ${error}`);
    }

    const result = await response.json().catch(async () => {
      const textResult = await response.text().catch(() => '');
      console.log(`⚠️ [RECONNECT] Resposta não é JSON, retornando texto (SEM CORTES):`, textResult);
      return { raw: textResult };
    });

    console.log(`✅ [RECONNECT] Instância ${instanceName} - resposta recebida com sucesso`);
    console.log(`📦 [RECONNECT] Resposta COMPLETA (SEM CORTES):`, JSON.stringify(result, null, 2));
    console.log(`📦 [RECONNECT] Tipo da resposta:`, typeof result);
    console.log(`📦 [RECONNECT] Chaves da resposta:`, Object.keys(result || {}));

    return result;
  }

  /**
   * Deleta uma instância
   * @param baseUrl URL base da Evolution API (obtida do banco de dados)
   */
  async deleteInstance(instanceName: string, apiKey: string, baseUrl: string): Promise<void> {
    const normalizedBaseUrl = this.normalizeBaseUrl(baseUrl);
    const url = `${normalizedBaseUrl}/instance/delete/${instanceName}`;
    const finalUrl = url.replace(/([^:]\/)\/+/g, '$1');
    
    const response = await fetch(finalUrl, {
      method: 'DELETE',
      headers: {
        apikey: apiKey,
      },
    });

    if (!response.ok) {
      const error = await response.text().catch(() => '');
      throw new Error(`Erro ao deletar: ${response.status} ${error}`);
    }
  }

  /**
   * Remove a instância na Evolution; ignora falha (ex.: já removida, connection closed).
   */
  async deleteInstanceBestEffort(
    instanceName: string,
    apiKey: string,
    baseUrl: string,
    context?: string
  ): Promise<void> {
    try {
      await this.deleteInstance(instanceName, apiKey, baseUrl);
    } catch (e: unknown) {
      console.warn(
        `⚠️ [Evolution delete best-effort] ${instanceName}${context ? ` (${context})` : ''}:`,
        e instanceof Error ? e.message : e
      );
    }
  }

  /**
   * Busca todos os grupos de uma instância
   * @param baseUrl URL base da Evolution API (obtida do banco de dados)
   */
  async fetchAllGroups(instanceName: string, apiKey: string, baseUrl: string, getParticipants: boolean = true): Promise<EvolutionGroup[]> {
    // Normaliza a base_url para garantir formato correto
    const normalizedBaseUrl = this.normalizeBaseUrl(baseUrl);
    const url = `${normalizedBaseUrl}/group/fetchAllGroups/${instanceName}?getParticipants=${getParticipants}`;
    
    // Validação final: remove qualquer barra dupla que possa ter sobrado
    const finalUrl = url.replace(/([^:]\/)\/+/g, '$1');
    
    const response = await fetch(finalUrl, {
      method: 'GET',
      headers: {
        apikey: apiKey,
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(`Erro ao buscar grupos: ${response.statusText}`);
    }

    const data = await response.json();
    
    // Normaliza diferentes formatos de resposta
    if (Array.isArray(data)) {
      return data;
    } else if (Array.isArray(data?.groups)) {
      return data.groups;
    } else if (data?.id && data?.subject) {
      return [data];
    }
    
    return [];
  }

  /**
   * Extrai o estado de conexão de uma resposta
   */
  extractState(data: any): 'connected' | 'connecting' | 'disconnected' | 'unknown' {
    // Se tem base64, significa que está aguardando QR code = connecting
    if (data?.base64 || data?.qrcode?.base64 || data?.qrcode) {
      console.log(`🔍 [EvolutionService] QR Code presente, estado: connecting`);
      return 'connecting';
    }
    
    // Tenta extrair o estado de diferentes formatos de resposta
    // Verifica múltiplos caminhos possíveis na resposta
    const raw = (data?.instance?.state ?? 
                 data?.instance?.status ??
                 data?.instancee?.status ?? // Pode ser "instancee" (typo da API)
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

    console.log(`🔍 [EvolutionService] Extraindo estado - raw: "${raw}", data keys:`, Object.keys(data || {}));
    
    // Se não encontrou estado, verifica campos alternativos
    if (!raw || raw === 'null' || raw === 'undefined' || raw === '') {
      // Verifica instancee.status (typo comum da API)
      if (data?.instancee?.status) {
        const instanceStatus = data.instancee.status.toString().toLowerCase();
        if (instanceStatus === 'open' || instanceStatus === 'connected' || instanceStatus === 'ready') return 'connected';
        if (instanceStatus === 'connecting') return 'connecting';
        if (instanceStatus === 'close' || instanceStatus === 'closed' || instanceStatus === 'disconnected') return 'disconnected';
      }
      // Verifica se tem qrcode (indica que está aguardando conexão)
      if (data?.base64 || data?.qrcode || data?.qrcode?.base64 || data?.qrcode?.code) {
        return 'connecting';
      }
      // Se não tem qrcode e não tem estado, verifica se tem dados de conexão
      // Se tem dados de instância mas sem estado explícito, pode estar conectado
      if (data?.instance && !data?.instance?.state && !data?.instance?.status) {
        // Se tem dados da instância mas não tem estado, pode estar conectado
        // Mas por segurança, assume desconectado se não tem informação
        return 'disconnected';
      }
      // Se não tem qrcode e não tem estado, assume desconectado
      return 'disconnected';
    }
    
    // Mapeia estados conhecidos - PRIORIDADE para 'connected'
    if (raw === 'open' || raw === 'connected' || raw === 'ready' || raw === 'online') {
      return 'connected';
    }
    if (['connecting', 'pairing', 'qrcode', 'qr', 'waiting_qr', 'waiting', 'pairing_code'].includes(raw)) {
      return 'connecting';
    }
    if (['close', 'closed', 'disconnected', 'logout', 'offline'].includes(raw)) {
      return 'disconnected';
    }
    
    console.warn(`⚠️ [EvolutionService] Estado desconhecido: "${raw}" - dados:`, JSON.stringify(data).substring(0, 200));
    return 'unknown';
  }

  /**
   * Extrai o QR code de uma resposta
   * Suporta múltiplos formatos:
   * - base64 (direto no objeto raiz) - usado na reconexão
   * - qrcode.base64 (formato padrão)
   * - qrcode (string base64)
   * - qrcode.code (formato alternativo)
   * - instance.qrcode.base64
   * - instance.qrcode (string)
   * - data.qrcode.base64
   * - data.qrcode (string)
   */
  extractQr(data: any): string | null {
    if (!data) {
      console.log(`⚠️ [EvolutionService] Dados vazios ao extrair QR Code`);
      return null;
    }

    // Log completo da estrutura para debug
    console.log(`🔍 [EvolutionService] Tentando extrair QR Code. Estrutura recebida:`, {
      hasBase64: !!data.base64,
      hasQrcode: !!data.qrcode,
      qrcodeType: typeof data.qrcode,
      hasInstance: !!data.instance,
      hasData: !!data.data,
      keys: Object.keys(data),
      qrcodeKeys: data.qrcode && typeof data.qrcode === 'object' ? Object.keys(data.qrcode) : null,
    });

    // Função auxiliar para validar se é um QR code válido (base64)
    const isValidQrCode = (value: any): boolean => {
      if (!value || typeof value !== 'string') return false;
      const trimmed = value.trim();
      if (trimmed.length === 0) return false;
      
      // Remove prefixo data:image se houver para validar
      const cleaned = trimmed.replace(/^data:image\/[a-z]+;base64,/, '');
      
      // Verifica se tem tamanho mínimo (QR codes geralmente têm pelo menos 100 caracteres em base64)
      // E parece ser base64 válido (pode conter A-Z, a-z, 0-9, +, /, =)
      if (cleaned.length < 100) return false;
      
      // Valida formato base64 (pode ter prefixo data:image, mas o conteúdo deve ser base64 válido)
      const base64Pattern = /^[A-Za-z0-9+/=]+$/;
      return base64Pattern.test(cleaned);
    };

    // Função auxiliar para limpar e retornar QR code
    const cleanQrCode = (value: string): string => {
      // Remove prefixo data:image se houver, mas mantém o base64
      return value.replace(/^data:image\/[a-z]+;base64,/, '');
    };

    // Prioridade 1: qrcode.base64 (formato mais comum na criação de instância)
    // Verifica se qrcode.count > 0 indica que há QR code disponível
    if (data.qrcode?.base64) {
      const qrValue = data.qrcode.base64;
      if (isValidQrCode(qrValue)) {
        console.log(`🔲 [EvolutionService] QR Code encontrado em qrcode.base64 (length: ${qrValue.length}, count: ${data.qrcode.count || 'N/A'})`);
        // Retorna com o prefixo removido para consistência
        return cleanQrCode(qrValue);
      } else {
        console.log(`⚠️ [EvolutionService] qrcode.base64 encontrado mas não é válido (length: ${qrValue.length})`);
      }
    }
    
    // Prioridade 2: base64 direto (formato de reconexão)
    if (data.base64 && isValidQrCode(data.base64)) {
      console.log(`🔲 [EvolutionService] QR Code encontrado em base64 direto (length: ${data.base64.length})`);
      return cleanQrCode(data.base64);
    }
    
    // Prioridade 3: qrcode como string (sem objeto aninhado)
    if (data.qrcode && typeof data.qrcode === 'string' && isValidQrCode(data.qrcode)) {
      console.log(`🔲 [EvolutionService] QR Code encontrado em qrcode (string, length: ${data.qrcode.length})`);
      return cleanQrCode(data.qrcode);
    }
    
    // Prioridade 4: instance.qrcode.base64
    if (data.instance?.qrcode?.base64 && isValidQrCode(data.instance.qrcode.base64)) {
      console.log(`🔲 [EvolutionService] QR Code encontrado em instance.qrcode.base64 (length: ${data.instance.qrcode.base64.length})`);
      return cleanQrCode(data.instance.qrcode.base64);
    }
    
    // Prioridade 5: instance.qrcode como string
    if (data.instance?.qrcode && typeof data.instance.qrcode === 'string' && isValidQrCode(data.instance.qrcode)) {
      console.log(`🔲 [EvolutionService] QR Code encontrado em instance.qrcode (string, length: ${data.instance.qrcode.length})`);
      return cleanQrCode(data.instance.qrcode);
    }

    // Prioridade 6: data.qrcode.base64 (formato aninhado)
    if (data.data?.qrcode?.base64 && isValidQrCode(data.data.qrcode.base64)) {
      console.log(`🔲 [EvolutionService] QR Code encontrado em data.qrcode.base64 (length: ${data.data.qrcode.base64.length})`);
      return cleanQrCode(data.data.qrcode.base64);
    }

    // Prioridade 7: data.qrcode como string
    if (data.data?.qrcode && typeof data.data.qrcode === 'string' && isValidQrCode(data.data.qrcode)) {
      console.log(`🔲 [EvolutionService] QR Code encontrado em data.qrcode (string, length: ${data.data.qrcode.length})`);
      return cleanQrCode(data.data.qrcode);
    }

    // Prioridade 8: Verifica se qrcode é um objeto com outras propriedades que contenham base64
    if (data.qrcode && typeof data.qrcode === 'object') {
      // Tenta encontrar qualquer propriedade que contenha base64 (mas não "code" que é pairing code)
      for (const key in data.qrcode) {
        if (key.includes('base64') && key !== 'code') {
          const value = data.qrcode[key];
          if (isValidQrCode(value)) {
            console.log(`🔲 [EvolutionService] QR Code encontrado em qrcode.${key} (length: ${value.length})`);
            return cleanQrCode(value);
          }
        }
      }
    }
    
    // Log detalhado quando não encontra
    console.log(`⚠️ [EvolutionService] QR Code não encontrado. Estrutura completa:`, JSON.stringify(data, null, 2).substring(0, 1000));
    return null;
  }

  /**
   * Adiciona participantes a um grupo
   * Retorna resultado detalhado com tratamento de erros específicos
   * groupId é passado como parâmetro na URL
   * @param baseUrl URL base da Evolution API (obtida do banco de dados)
   */
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

  async addParticipantsToGroup(
    instanceName: string,
    apiKey: string,
    groupId: string,
    participants: string[],
    baseUrl: string
  ): Promise<{
    success: boolean;
    error?: string;
    errorType?: 'rate_limit' | 'bad_request' | 'connection_closed' | 'unknown';
    added?: number;
    httpStatus?: number;
    responseData?: any;
  }> {
    const startTime = Date.now();
    
    // Normaliza a base_url para garantir formato correto
    const normalizedBaseUrl = this.normalizeBaseUrl(baseUrl);
    
    // Passa groupJid como parâmetro na URL (a API Evolution espera 'groupJid', não 'groupId')
    const url = `${normalizedBaseUrl}/group/updateParticipant/${instanceName}?groupJid=${encodeURIComponent(groupId)}`;
    
    // Validação final: remove qualquer barra dupla que possa ter sobrado
    const finalUrl = url.replace(/([^:]\/)\/+/g, '$1');
    
    // Validação adicional: verifica se não há barras duplas
    if (finalUrl.includes('//') && !finalUrl.includes('://')) {
      console.error(`❌ [Evolution API] ERRO: URL ainda contém barras duplas após normalização: ${finalUrl}`);
      // Tenta corrigir novamente
      const correctedUrl = finalUrl.replace(/([^:]\/)\/+/g, '$1');
      console.log(`🔧 [Evolution API] Tentando corrigir: ${correctedUrl}`);
    }
    
    const payload = {
      action: 'add',
      participants: participants,
    };

    console.log(`📤 [Evolution API] Base URL original: ${baseUrl}`);
    console.log(`📤 [Evolution API] Base URL normalizada: ${normalizedBaseUrl}`);
    console.log(`📤 [Evolution API] URL final: ${finalUrl}`);
    console.log(`✅ [Evolution API] Validação: URL contém barras duplas? ${finalUrl.includes('//') && !finalUrl.includes('://') ? 'SIM (ERRO!)' : 'NÃO (OK)'}`);
    console.log(`📤 [Evolution API] Enviando requisição:`, {
      url: finalUrl,
      instanceName,
      groupId,
      groupJidInUrl: true, // Usa groupJid conforme esperado pela API
      participantsCount: participants.length,
      participants: participants,
      timestamp: new Date().toISOString(),
    });

    try {
      // Timeout de 30 segundos para evitar travamentos
      const FETCH_TIMEOUT_MS = 30000; // 30 segundos
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
        console.warn(`⏱️ [Evolution API] Timeout de ${FETCH_TIMEOUT_MS}ms atingido para ${url}`);
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

      const duration = Date.now() - startTime;
      const responseText = await response.text();
      let responseData: any = {};
      
      try {
        responseData = JSON.parse(responseText);
      } catch {
        // Se não for JSON, mantém o texto
        responseData = { message: responseText, raw: responseText };
      }

      console.log(`📥 [Evolution API] Resposta recebida:`, {
        instanceName,
        groupId,
        httpStatus: response.status,
        statusText: response.statusText,
        duration: `${duration}ms`,
        responseSize: responseText.length,
        responseData,
        timestamp: new Date().toISOString(),
      });

      // Tratamento específico de erros conforme documentação
      if (response.status === 403) {
        // 403: Request OK mas lead não foi adicionado ao grupo
        console.warn(`⚠️ [Evolution API] Status 403 - Request OK mas lead não adicionado:`, {
          instanceName,
          groupId,
          participants,
          responseData,
        });
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
        // 400: Bad request - pode ser número inválido ou erro na requisição
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
          console.warn(`⚠️ [Evolution API] Connection Closed detectado - Status 400 com mensagem "connection closed"`);
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
        console.log(`⚠️ [Evolution API] Bad Request (400) mas NÃO é connection closed: ${errorMsg}`);
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
        console.error(`❌ [Evolution API] Erro HTTP ${response.status}:`, {
          instanceName,
          groupId,
          participants,
          httpStatus: response.status,
          statusText: response.statusText,
          responseData,
        });
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
      console.log(`✅ [Evolution API] Lead adicionado com sucesso:`, {
        instanceName,
        groupId,
        participants,
        added: participants.length,
        responseData,
      });
      return {
        success: true,
        added: participants.length,
        httpStatus: response.status,
        responseData,
      };
    } catch (error: any) {
      const duration = Date.now() - startTime;
      const errorDetails = {
        instanceName,
        groupId,
        participants,
        duration: `${duration}ms`,
        errorName: error?.name,
        errorMessage: error?.message,
        errorStack: error?.stack,
        timestamp: new Date().toISOString(),
      };

      // IMPORTANTE: Timeout NÃO é connection closed - é apenas um problema temporário de rede
      // Não deve marcar a instância como desconectada
      const isTimeout = 
        error?.message?.toLowerCase().includes('timeout') ||
        error?.name === 'AbortError' ||
        error?.message?.toLowerCase().includes('excedeu');

      if (isTimeout) {
        console.error(`⏱️ [Evolution API] Timeout na requisição após ${duration}ms`);
        console.log(`⚠️ [Evolution API] Timeout é um erro temporário, NÃO marca instância como desconectada`);
        return {
          success: false,
          error: `Timeout: requisição excedeu o tempo limite (${duration}ms)`,
          errorType: 'unknown', // Timeout não é connection_closed
          added: 0,
          httpStatus: 0,
          responseData: { 
            error: error?.message, 
            code: error?.code,
            type: 'timeout',
            duration 
          },
        };
      }

      // Verifica se é connection closed REAL (não erro temporário de rede)
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
        console.error(`🔌 [Evolution API] Connection Closed REAL detectado:`, errorDetails);
        return {
          success: false,
          error: 'Connection Closed - número pode estar banido ou desconectado',
          errorType: 'connection_closed',
          added: 0,
          httpStatus: 0,
          responseData: { 
            error: error?.message, 
            code: error?.code,
            duration 
          },
        };
      }

      if (isTemporaryNetworkError) {
        console.warn(`⚠️ [Evolution API] Erro de rede temporário (NÃO marca como desconectado):`, errorDetails);
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
            duration,
            type: 'temporary_network_error'
          },
        };
      }

      console.error(`❌ [Evolution API] Erro inesperado:`, errorDetails);
      return {
        success: false,
        error: error?.message || 'Erro desconhecido ao adicionar participantes',
        errorType: 'unknown',
        added: 0,
        httpStatus: 0,
        responseData: { error: error?.message, name: error?.name, code: error?.code },
      };
    }
  }

  /**
   * Envia uma mensagem de texto
   */
  async sendText(
    instanceName: string,
    apiKey: string,
    baseUrl: string,
    number: string,
    text: string,
    options: {
      mentionsEveryone?: boolean;
      mentioned?: string[];
    } = {}
  ): Promise<any> {
    const normalizedBaseUrl = this.normalizeBaseUrl(baseUrl);
    const url = `${normalizedBaseUrl}/message/sendText/${instanceName}`;
    const finalUrl = url.replace(/([^:]\/)\/+/g, '$1');

    const body = {
      number,
      text,
      mentionsEveryone: options.mentionsEveryone || false,
    };

    console.log(`📤 [Evolution API] sendText request:`, JSON.stringify({ url: finalUrl, body }, null, 2));

    // Timeout de 25 segundos
    const FETCH_TIMEOUT_MS = 25000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(finalUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: apiKey,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch {
          errorData = { raw: errorText };
        }
        
        console.error(`❌ [Evolution API] sendText error:`, JSON.stringify({
          status: response.status,
          statusText: response.statusText,
          errorData
        }, null, 2));

        throw new Error(errorData.message || errorData.raw || `Erro ao enviar texto: ${response.statusText}`);
      }

      return await response.json();
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError' || controller.signal.aborted) {
        throw new Error(`Timeout: requisição excedeu ${FETCH_TIMEOUT_MS}ms`);
      }
      throw error;
    }
  }

  /**
   * Envia uma mídia (imagem, vídeo, documento)
   */
  async sendMedia(
    instanceName: string,
    apiKey: string,
    baseUrl: string,
    number: string,
    mediaUrl: string,
    mediaType: 'image' | 'video' | 'document',
    mimetype: string,
    caption?: string,
    fileName?: string,
    options: {
      mentionsEveryone?: boolean;
      mentioned?: string[];
    } = {}
  ): Promise<any> {
    const normalizedBaseUrl = this.normalizeBaseUrl(baseUrl);
    const url = `${normalizedBaseUrl}/message/sendMedia/${instanceName}`;
    const finalUrl = url.replace(/([^:]\/)\/+/g, '$1');

    const body = {
      number,
      mediatype: mediaType,
      mimetype,
      caption,
      media: mediaUrl,
      fileName: fileName || (mediaType === 'image' ? 'image.png' : 'file'),
      mentionsEveryone: options.mentionsEveryone || false,
    };

    console.log(`📤 [Evolution API] sendMedia request:`, JSON.stringify({ url: finalUrl, body }, null, 2));

    // Timeout de 25 segundos
    const FETCH_TIMEOUT_MS = 25000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(finalUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: apiKey,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch {
          errorData = { raw: errorText };
        }

        console.error(`❌ [Evolution API] sendMedia error:`, {
          status: response.status,
          statusText: response.statusText,
          errorData
        });

        throw new Error(errorData.message || errorData.raw || `Erro ao enviar mídia: ${response.statusText}`);
      }

      return await response.json();
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError' || controller.signal.aborted) {
        throw new Error(`Timeout: requisição excedeu ${FETCH_TIMEOUT_MS}ms`);
      }
      throw error;
    }
  }

  /**
   * Envia um áudio narrado (gravado)
   */
  async sendWhatsAppAudio(
    instanceName: string,
    apiKey: string,
    baseUrl: string,
    number: string,
    audioUrl: string,
    options: {
      mentionsEveryone?: boolean;
      mentioned?: string[];
    } = {}
  ): Promise<any> {
    const normalizedBaseUrl = this.normalizeBaseUrl(baseUrl);
    const url = `${normalizedBaseUrl}/message/sendWhatsAppAudio/${instanceName}`;
    const finalUrl = url.replace(/([^:]\/)\/+/g, '$1');

    const body = {
      number,
      audio: audioUrl,
      mentionsEveryone: options.mentionsEveryone || false,
    };

    console.log(`📤 [Evolution API] sendWhatsAppAudio request:`, JSON.stringify({ url: finalUrl, body }, null, 2));

    // Timeout de 25 segundos
    const FETCH_TIMEOUT_MS = 25000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(finalUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: apiKey,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch {
          errorData = { raw: errorText };
        }

        console.error(`❌ [Evolution API] sendWhatsAppAudio error:`, {
          status: response.status,
          statusText: response.statusText,
          errorData
        });

        throw new Error(errorData.message || errorData.raw || `Erro ao enviar áudio: ${response.statusText}`);
      }

      return await response.json();
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError' || controller.signal.aborted) {
        throw new Error(`Timeout: requisição excedeu ${FETCH_TIMEOUT_MS}ms`);
      }
      throw error;
    }
  }
}

export const evolutionService = new EvolutionService();

