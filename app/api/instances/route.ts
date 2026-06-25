import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { evolutionService } from '@/lib/services/evolution-service';
import { getUserEvolutionApi } from '@/lib/services/evolution-api-helper';
import { evolutionApiSelector } from '@/lib/services/evolution-api-selector';
import { getSubordinates } from '@/lib/middleware/permissions';
import {
  EVOLUTION_INSTANCE_WEBHOOK_EVENTS,
  buildEvolutionProdWebhookUrlFromBase,
  resolvePublicBaseUrlForWebhooks,
  shouldConfigureMasterChatWebhook,
} from '@/lib/server/evolution-chat-webhook-config';
import { getUserProfile } from '@/lib/middleware/permissions';
import {
  getEffectiveZaplotoId,
  getEvolutionInstancesZaplotoScopeId,
  ZAPLOTO_DEFAULT_TENANT_ID,
} from '@/lib/tenant-context';
import { assignProxyToEvolutionInstance } from '@/lib/services/evolution-instance-proxy';
import { evolutionDbStatusToPublicListUi } from '@/lib/utils/evolution-instance-status';

/**
 * GET /api/instances - Lista instâncias do usuário
 * - Admin: vê todas as instâncias
 * - Usuário normal: vê apenas suas instâncias
 */
export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);

    const fullProfile = await getUserProfile(userId);
    if (!fullProfile) {
      return errorResponse('Perfil não encontrado', 404);
    }

    const effectiveZaplotoId = await getEffectiveZaplotoId(req, fullProfile);

    const { data: shareRowsForMe } = await supabaseServiceRole
      .from('evolution_instance_shared_users')
      .select('evolution_instance_id')
      .eq('user_id', userId);
    const sharedWithMeIds = new Set(
      (shareRowsForMe || []).map((r: { evolution_instance_id: string }) => r.evolution_instance_id)
    );

    const userStatus = fullProfile.status;
    const isSuperAdmin = userStatus === 'super_admin';
    const isAdmin = userStatus === 'admin' || isSuperAdmin;
    const isDonoBanca = userStatus === 'dono_banca';
    const isGerente = userStatus === 'gerente';

    /** WL (cookie/referer) pode divergir do perfil; gerente/consultor/dono usam tenant do perfil na lista. */
    const instancesZaplotoScopeId = getEvolutionInstancesZaplotoScopeId({
      profile: fullProfile,
      effectiveZaplotoId,
      userStatus,
    });

    let instances: any[] = [];
    
    // Define os user_ids que podem ver as instâncias baseado no tipo de usuário
    // Baseado na query SQL: mostra instâncias bloqueadas e não bloqueadas, filtradas por user_id
    // - Admin: vê todas as instâncias (sem filtro de user_id)
    // - Dono de banca/Gerente: vê suas instâncias + instâncias dos subordinados
    // - Consultor: vê apenas suas próprias instâncias
    let allowedUserIds: string[] = [userId];
    
    // Se for dono de banca ou gerente, inclui subordinados
    if (isDonoBanca || isGerente) {
      const subordinates = await getSubordinates(userId);
      const subordinateIds = subordinates.map(s => s.id);
      allowedUserIds = [userId, ...subordinateIds];
    }
    // Se for admin (não super), não filtra por user_id — todas as instâncias do tenant
    // Se for super_admin, não filtra por user_id nem por tenant — visão global
    // Se for consultor, usa apenas o próprio userId (já definido acima)

    /** Mesma regra de GET /api/chat/channels: gerente vê instâncias ligadas em atendimento_chat_assignments. */
    const instanceIdsForOrFilter = new Set<string>(sharedWithMeIds);
    let gerenteAtendimentoAssignmentRows = 0;
    if (isGerente) {
      const { data: gerenteAssignRows } = await supabaseServiceRole
        .from('atendimento_chat_assignments')
        .select('evolution_instance_id')
        .eq('gerente_user_id', userId);
      gerenteAtendimentoAssignmentRows = (gerenteAssignRows || []).length;
      for (const r of gerenteAssignRows || []) {
        const eid = (r as { evolution_instance_id?: string | null }).evolution_instance_id;
        if (typeof eid === 'string' && eid.length > 0) instanceIdsForOrFilter.add(eid);
      }
    }

    const sharedIdArr = Array.from(instanceIdsForOrFilter);

    // Query base SEM !inner para garantir LEFT JOIN e retornar TODAS as instâncias
    // IMPORTANTE: Sem !inner, o Supabase faz LEFT JOIN por padrão, retornando TODAS as instâncias,
    // incluindo as que estão associadas a APIs Evolution bloqueadas (is_blocked_for_instances = true)
    // Equivalente ao LEFT JOIN da query SQL: evolution_instances LEFT JOIN evolution_apis
    // Isso garante que instâncias de APIs bloqueadas (como evolution4) também sejam retornadas
    // CRÍTICO: Não usar !inner aqui, pois isso faria INNER JOIN e excluiria instâncias sem API válida
    let query = supabaseServiceRole
      .from('evolution_instances')
      .select(`
        *,
        evolution_apis (
          id,
          name,
          base_url,
          api_key_global,
          is_blocked_for_instances
        ),
        proxy_instances:proxy_id (
          id,
          name,
          host
        )
      `);

    // evolution_instances.zaploto_id pode ser NULL (legado); no tenant padrão isso equivale ao ZapLoto central.
    if (!isSuperAdmin) {
      if (instancesZaplotoScopeId === ZAPLOTO_DEFAULT_TENANT_ID) {
        query = query.or(
          `zaploto_id.eq.${ZAPLOTO_DEFAULT_TENANT_ID},zaploto_id.is.null`
        );
      } else {
        query = query.eq('zaploto_id', instancesZaplotoScopeId);
      }
    }

    // Aplica filtro de user_id + instâncias compartilhadas / vínculo atendimento (mesmo WL)
    if (!isAdmin) {
      // PostgREST: `.or()` com uma única cláusula costuma falhar ou retornar vazio de forma inconsistente.
      // Sem IDs extras: usar `.in('user_id', ...)` (gerente/dono/consultor).
      if (sharedIdArr.length > 0) {
        query = query.or(
          `user_id.in.(${allowedUserIds.join(',')}),id.in.(${sharedIdArr.join(',')})`
        );
      } else {
        query = query.in('user_id', allowedUserIds);
      }
    }

    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) {
      console.error('[ListaInstancias] Supabase erro na query evolution_instances', {
        message: error.message,
        code: (error as { code?: string }).code,
      });
      return errorResponse(`Erro ao buscar instâncias: ${error.message}`, 500);
    }

    // IMPORTANTE: Mostra TODAS as instâncias do usuário (user_id/Owner)
    // Independente de estarem conectadas, desconectadas ou bloqueadas
    // is_active=false = registro arquivado (não uso para “caiu”); desconexão usa status
    const filteredData = (data || []).filter((inst: any) => 
        inst.is_active !== false
      );
      
      // Converte para formato compatível com o frontend
      instances = filteredData.map((inst: any) => {
        // Extrai evolution_api - pode vir como array ou objeto único
        let evolutionApi = inst.evolution_apis;
        if (Array.isArray(evolutionApi)) {
          evolutionApi = evolutionApi.length > 0 ? evolutionApi[0] : null;
        }
        
        // Mapeia status do banco para o frontend (case-insensitive: OK, ok, connected)
        const frontendStatus = evolutionDbStatusToPublicListUi(inst.status);

        // Processa informações do proxy
        const proxyData = inst.proxy_instances;
        const proxy = Array.isArray(proxyData) ? proxyData[0] : proxyData;

        // Extrai is_blocked_for_instances da API Evolution
        // Verifica explicitamente se o campo existe e é true (trata diferentes tipos)
        const rawBlockedValue = evolutionApi?.is_blocked_for_instances;
        const isBlocked = rawBlockedValue === true || rawBlockedValue === 'true' || rawBlockedValue === 1;

        const instanceData = {
          id: inst.id,
          instance_name: inst.instance_name,
          shared_with_me:
            Boolean(inst.id && sharedWithMeIds.has(inst.id)) &&
            String(inst.user_id ?? '') !== userId,
          status: frontendStatus,
          number: inst.phone_number,
          created_at: inst.created_at,
          updated_at: inst.updated_at,
          hash: evolutionApi?.api_key_global || null, // API key global da Evolution API para compatibilidade
          qr_code: null, // QR code é temporário
          user_id: inst.user_id || userId, // Usa o user_id da instância, não do usuário logado
          proxy_id: inst.proxy_id || null,
          is_master: inst.is_master || false, // Indica se é instância mestre
          webhook_configured: inst.webhook_configured === true,
          maturation_type: inst.maturation_type || 'maturado',
          maturation_status: inst.maturation_status || null,
          maturation_ends_at: inst.maturation_ends_at || null,
          current_day: inst.current_day ?? null,
          is_locked: inst.is_locked === true,
          is_blocked_for_instances: isBlocked, // Indica se a API está bloqueada para criação de instâncias
          blocked_from_maturation: inst.blocked_from_maturation === true,
          proxy: proxy ? {
            id: proxy.id,
            name: proxy.name,
            host: proxy.host
          } : null,
        };
        
        return instanceData;
      });

      const ownerIds = [...new Set(instances.map((i: { user_id?: string }) => i.user_id).filter(Boolean))] as string[];
      if (ownerIds.length > 0) {
        const { data: ownerProfiles } = await supabaseServiceRole
          .from('profiles')
          .select('id, full_name, email')
          .in('id', ownerIds);
        const displayByUserId = new Map<string, string>();
        for (const p of ownerProfiles || []) {
          const name = (p.full_name && String(p.full_name).trim()) || (p.email && String(p.email).trim()) || '';
          if (name) displayByUserId.set(p.id, name);
        }
        instances = instances.map((inst: { user_id?: string }) => ({
          ...inst,
          owner_display_name: inst.user_id ? displayByUserId.get(inst.user_id) ?? null : null,
        }));
      }

    return successResponse(instances, 'Instâncias carregadas com sucesso');
  } catch (err: any) {
    return errorResponse(err.message || 'Erro ao buscar instâncias', 401);
  }
}

/**
 * POST /api/instances - Cria uma nova instância
 */
export async function POST(req: NextRequest) {
  try {
    
    // Passo 1: Autenticação
    let userId: string;
    try {
      const authResult = await requireAuth(req);
      userId = authResult.userId;
    } catch (authError: any) {
      console.error('❌ [INSTÂNCIA] Erro na autenticação:', authError);
      return errorResponse(authError?.message || 'Erro de autenticação', 401);
    }

    const fullProfile = await getUserProfile(userId);
    if (!fullProfile) {
      return errorResponse('Perfil não encontrado', 404);
    }
    const effectiveZaplotoId = await getEffectiveZaplotoId(req, fullProfile);
    const instancesZaplotoScopeId = getEvolutionInstancesZaplotoScopeId({
      profile: fullProfile,
      effectiveZaplotoId,
      userStatus: fullProfile.status,
    });

    let tenantSlugForWebhook: string | null = null;
    if (instancesZaplotoScopeId) {
      const { data: tenantRow } = await supabaseServiceRole
        .from('zaploto_tenants')
        .select('slug')
        .eq('id', instancesZaplotoScopeId)
        .maybeSingle();
      tenantSlugForWebhook = tenantRow?.slug?.trim().toLowerCase() ?? null;
    }

    // Passo 3: Parse do body
    let body: any;
    try {
      body = await req.json();
      console.log('✅ [INSTÂNCIA] Body parseado com sucesso');
    } catch (parseError: any) {
      console.error('❌ [INSTÂNCIA] Erro ao parsear body:', parseError);
      return errorResponse('Erro ao processar dados da requisição', 400);
    }

    const { instanceName, isMaster, maturationType, proxy_id: proxyIdFromBody } = body;
    /** Instância mestre: webhook Zaploto (chat) sempre na criação, salvo EVOLUTION_WEBHOOK_SKIP_MASTER=true no servidor */
    const shouldConfigureChatWebhook = isMaster === true && shouldConfigureMasterChatWebhook();

    if (!instanceName) {
      return errorResponse('instanceName é obrigatório', 400);
    }

    // Tipo de maturação: virgem = fluxo rede mútua no Maturador (sem trava de dias ao conectar); maturado = fluxo normal
    const maturationTypeValue = maturationType === 'virgem' ? 'virgem' : 'maturado';

    // Número de instâncias mestres por usuário é ilimitado (trava removida).

    // Validação: permite apenas letras, números e underscore
    if (!/^[a-zA-Z0-9_]+$/.test(instanceName)) {
      return errorResponse('O nome da instância pode conter apenas letras, números e underscore (_). Ex: teste1, adicione1, consultorjão, teste_teste', 400);
    }


    // Passo 3.5: Verifica se o nome da instância já existe na tabela evolution_instances
    // Como cada Evolution API pode criar instâncias com o mesmo nome (são sistemas diferentes),
    // precisamos garantir que o nome seja único no banco Zaploto
    let uniqueNameQuery = supabaseServiceRole
      .from('evolution_instances')
      .select('id, instance_name, is_active, evolution_api_id')
      .eq('instance_name', instanceName)
      .eq('is_active', true); // Verifica apenas instâncias ativas
    if (instancesZaplotoScopeId === ZAPLOTO_DEFAULT_TENANT_ID) {
      uniqueNameQuery = uniqueNameQuery.or(
        `zaploto_id.eq.${ZAPLOTO_DEFAULT_TENANT_ID},zaploto_id.is.null`
      );
    } else {
      uniqueNameQuery = uniqueNameQuery.eq('zaploto_id', instancesZaplotoScopeId);
    }
    const { data: existingInstance, error: checkError } = await uniqueNameQuery.maybeSingle();

    if (checkError && checkError.code !== 'PGRST116') {
      console.error(`❌ [INSTÂNCIA] Erro ao verificar nome duplicado:`, checkError);
      return errorResponse(`Erro ao verificar nome da instância: ${checkError.message}`, 500);
    }

    if (existingInstance) {
      console.warn(`⚠️ [INSTÂNCIA] Nome ${instanceName} já está em uso por outra instância ativa (ID: ${existingInstance.id})`);
      return errorResponse(
        `O nome "${instanceName}" já está registrado. Por favor, escolha outro nome para a instância.`,
        400
      );
    }


    // Passo 4: SIMPLIFICADO: Sempre usa balanceamento automático para distribuir carga
    // A atribuição de usuário é opcional e não é necessária
    
    let selectedApi;
    try {
      selectedApi = await evolutionApiSelector.selectBestEvolutionApiForNewInstance();
    
      if (!selectedApi) {
        console.error('❌ [INSTÂNCIA] Nenhuma Evolution API ativa encontrada');
        return errorResponse(
          'Nenhuma Evolution API ativa configurada. Configure pelo menos uma Evolution API no painel admin.',
          400
        );
      }
      
    } catch (selectorError: any) {
      console.error('❌ [INSTÂNCIA] Erro ao selecionar Evolution API:', selectorError);
      return errorResponse(`Erro ao selecionar Evolution API: ${selectorError?.message || 'Erro desconhecido'}`, 500);
    }

    // Passo 6: VALIDAÇÃO CRÍTICA: Verifica se a API key está presente e válida
    if (!selectedApi.api_key_global || typeof selectedApi.api_key_global !== 'string' || selectedApi.api_key_global.trim().length === 0) {
      console.error(`❌ [INSTÂNCIA] API key inválida ou vazia para Evolution API ${selectedApi.name}`);
      return errorResponse(
        `API key não configurada para a Evolution API "${selectedApi.name}". Configure a API key no painel admin.`,
        400
      );
    }

    // Log de validação (sem mostrar a key completa por segurança)
    const apiKeyPreview = selectedApi.api_key_global.length > 10 
      ? `${selectedApi.api_key_global.substring(0, 10)}...${selectedApi.api_key_global.substring(selectedApi.api_key_global.length - 4)}`
      : '***';

    const apiRecord = { id: selectedApi.id };

    // Normaliza a URL base (remove barras duplas e finais)
    const normalizeBaseUrl = (baseUrl: string): string => {
      if (!baseUrl) return baseUrl;
      let normalized = baseUrl.trim();
      normalized = normalized.replace(/\/+$/, ''); // Remove barras finais
      normalized = normalized.replace(/([^:]\/)\/+/g, '$1'); // Remove barras duplas (preservando ://)
      return normalized;
    };

    const normalizedBaseUrl = normalizeBaseUrl(selectedApi.base_url);

    /**
     * Instância mestre: webhook aponta para `/api/webhooks/evolution/prod` ou `/{slug}/api/...` em WL,
     * salvo skip por env (shouldConfigureChatWebhook).
     */
    let masterChatWebhookUrl: string | null = null;
    if (shouldConfigureChatWebhook) {
      const publicBase =
        resolvePublicBaseUrlForWebhooks(req) ||
        process.env.NEXT_PUBLIC_APP_URL?.trim()?.replace(/\/+$/, '') ||
        process.env.NEXT_PUBLIC_WEBHOOK_BASE_URL?.trim()?.replace(/\/+$/, '') ||
        'https://zaploto.com';
      masterChatWebhookUrl = buildEvolutionProdWebhookUrlFromBase(
        publicBase,
        tenantSlugForWebhook
      );
    }

    // Cria instância na Evolution API selecionada pelo balanceador
    const tempEvolutionService = {
      baseUrl: normalizedBaseUrl,
      masterKey: selectedApi.api_key_global.trim(), // Remove espaços e garante string limpa
      apiKeyPreview: apiKeyPreview, // Preview para logs
      apiName: selectedApi.name, // Nome da API para logs de erro
      isMaster: isMaster === true,
      masterChatWebhookUrl,
      async createInstance(name: string, number: string, qrcode: boolean = true) {
        try {
          const requestUrl = `${this.baseUrl}/instance/create`;
          const requestHeaders = {
            'Content-Type': 'application/json',
            apikey: this.masterKey,
          };
          const requestBody: any = {
            instanceName: name,
            qrcode,
            // "number": "{{number}}", // (Optional)
            integration: 'WHATSAPP-BAILEYS',
          };

          // Instância mestre: webhook prod Zaploto (MESSAGES_UPSERT + SEND_MESSAGE)
          if (this.isMaster && this.masterChatWebhookUrl) {
            requestBody.webhook = {
              enabled: true,
              url: this.masterChatWebhookUrl,
              events: [...EVOLUTION_INSTANCE_WEBHOOK_EVENTS],
              base64: true,
            };
          }

          // Validação prévia da URL
          try {
            const urlObj = new URL(requestUrl);
            if (!urlObj.protocol || !urlObj.hostname) {
              throw new Error(`URL inválida: ${requestUrl}`);
            }
          } catch (urlError: any) {
            throw new Error(`URL da Evolution API inválida: ${requestUrl}. Verifique a configuração da base_url no banco de dados.`);
          }

          let response: Response;
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000);

            try {
              response = await fetch(requestUrl, {
                method: 'POST',
                headers: requestHeaders,
                body: JSON.stringify(requestBody),
                signal: controller.signal,
              });
              clearTimeout(timeoutId);
            } catch (fetchErr: any) {
              clearTimeout(timeoutId);
              if (fetchErr.name === 'AbortError') {
                throw new Error(`Timeout ao conectar com Evolution API (${this.baseUrl}). O servidor demorou mais de 30 segundos para responder.`);
              }
              throw fetchErr;
            }
          } catch (fetchNetworkError: any) {
            const networkErrorMsg = fetchNetworkError?.message || 'Erro de conexão';
            const errorCode = fetchNetworkError?.code;
            const errorErrno = fetchNetworkError?.errno;
            
            // Verifica diferentes tipos de erros de rede
            if (errorCode === 'ENOTFOUND' || errorCode === 'EAI_AGAIN' || networkErrorMsg.includes('getaddrinfo')) {
              throw new Error(
                `DNS não encontrado para a Evolution API (${this.baseUrl}). ` +
                `O hostname "${fetchNetworkError?.hostname || 'desconhecido'}" não pode ser resolvido. ` +
                `Verifique se a URL está correta e se o servidor está acessível.`
              );
            } else if (errorCode === 'ECONNREFUSED' || errorErrno === 'ECONNREFUSED') {
              throw new Error(
                `Conexão recusada pela Evolution API (${this.baseUrl}). ` +
                `O servidor está rejeitando conexões. Verifique se: ` +
                `1) O servidor da Evolution API está rodando, ` +
                `2) A porta está correta, ` +
                `3) Não há firewall bloqueando a conexão.`
              );
            } else if (errorCode === 'ETIMEDOUT' || errorCode === 'TIMEOUT' || networkErrorMsg.includes('timeout')) {
              throw new Error(
                `Timeout ao conectar com a Evolution API (${this.baseUrl}). ` +
                `O servidor não respondeu em até 30 segundos. ` +
                `Verifique se o servidor está online e acessível.`
              );
            } else if (errorCode === 'ECONNRESET' || errorErrno === 'ECONNRESET') {
              throw new Error(
                `Conexão resetada pela Evolution API (${this.baseUrl}). ` +
                `O servidor fechou a conexão inesperadamente.`
              );
            } else if (networkErrorMsg.includes('SSL') || networkErrorMsg.includes('certificate') || networkErrorMsg.includes('TLS')) {
              throw new Error(
                `Erro de certificado SSL/TLS ao conectar com Evolution API (${this.baseUrl}). ` +
                `Verifique se o certificado é válido e se a URL usa o protocolo correto (http/https).`
              );
            } else if (networkErrorMsg.toLowerCase().includes('fetch failed')) {
              throw new Error(
                `Falha ao conectar com Evolution API (${this.baseUrl}). ` +
                `Possíveis causas: ` +
                `1) URL incorreta ou inacessível, ` +
                `2) Servidor offline, ` +
                `3) Problema de rede/firewall, ` +
                `4) CORS bloqueando a requisição. ` +
                `Detalhes: ${errorCode ? `código=${errorCode}` : ''} ${errorErrno ? `errno=${errorErrno}` : ''}`
              );
            } else {
              throw new Error(
                `Erro de rede ao conectar com Evolution API: ${networkErrorMsg} ` +
                `(${this.baseUrl}). ` +
                `Código: ${errorCode || 'desconhecido'}, ` +
                `Errno: ${errorErrno || 'desconhecido'}`
              );
            }
          }

          if (!response.ok) {
            let errorMessage = `Erro HTTP ${response.status}: ${response.statusText}`;
            let errorDetails: any = {};
            
            try {
              const errorData = await response.json();
              errorMessage = errorData.message || errorData.error || errorMessage;
              errorDetails = errorData;
            } catch {
              // Se não conseguir parsear JSON, tenta ler como texto
              try {
                const errorText = await response.text();
                errorMessage = errorText || errorMessage;
                errorDetails = { raw: errorText };
              } catch {
                // Mantém a mensagem padrão
              }
            }

            // Log detalhado do erro
            console.error(`❌ [INSTÂNCIA] Evolution API retornou erro: ${errorMessage}`);
            console.error(`❌ [INSTÂNCIA] Detalhes do erro:`, {
              status: response.status,
              statusText: response.statusText,
              url: requestUrl,
              apiKeyPreview: this.apiKeyPreview,
              apiKeyLength: this.masterKey.length,
              errorDetails,
            });

            // Mensagem mais amigável para 403 Forbidden
            if (response.status === 403) {
              const detailedMessage = 
                `Acesso negado pela Evolution API (403 Forbidden). ` +
                `Possíveis causas:\n` +
                `1. API key incorreta ou vazia no banco de dados (campo api_key_global)\n` +
                `2. API key sem permissões para criar instâncias\n` +
                `3. Evolution API bloqueando requisições da origem (CORS/IP whitelist)\n` +
                `4. Evolution API não está acessível ou está bloqueando o Netlify\n\n` +
                `Informações de debug:\n` +
                `- API: ${this.apiName}\n` +
                `- URL: ${this.baseUrl}\n` +
                `- API Key length: ${this.masterKey.length}\n` +
                `- API Key preview: ${this.apiKeyPreview}`;
              
              console.error(`❌ [INSTÂNCIA] 403 Forbidden - Detalhes:`, {
                apiName: this.apiName,
                baseUrl: this.baseUrl,
                apiKeyLength: this.masterKey.length,
                apiKeyPreview: this.apiKeyPreview,
                requestUrl: requestUrl,
                requestBody: requestBody,
                errorDetails,
              });
              
              throw new Error(detailedMessage);
            }

            throw new Error(errorMessage);
          }

          const data = await response.json();
          return data;
        } catch (fetchError: any) {
          console.error('❌ [INSTÂNCIA] Erro no fetch para Evolution API:', fetchError);
          throw new Error(fetchError?.message || 'Erro ao conectar com Evolution API');
        }
      },
    };

    console.log(`📊 Criando instância ${instanceName} na Evolution API: ${selectedApi.name} (${selectedApi.base_url})`);

    let evolutionData;
    try {
      evolutionData = await tempEvolutionService.createInstance(instanceName, '', true);
    } catch (createError: any) {
      console.error('❌ [INSTÂNCIA] Erro ao criar instância na Evolution API:', createError);
      const errorMsg = createError?.message || 'Erro ao criar instância na Evolution API';
      return errorResponse(`Erro ao criar instância: ${errorMsg}`, 500);
    }

    // Log detalhado da resposta da Evolution API
    // Extrai QR code usando o método do evolutionService que já tem lógica completa
    // Isso suporta múltiplos formatos: base64 direto, qrcode.base64, qrcode (string), instance.qrcode.base64, etc.
    // O método extractQr já retorna o QR code limpo (sem prefixo data:image)
    let qrCodeBase64: string | null = evolutionService.extractQr(evolutionData);

    // Verifica se o QR code ainda não foi gerado (count === 0 ou estrutura vazia)
    // Neste caso, tenta buscar via status endpoint
    const qrcodeCount = evolutionData?.qrcode?.count;
    const hasQrcodePending = evolutionData?.qrcode && (qrcodeCount === 0 || (typeof evolutionData.qrcode === 'object' && !evolutionData.qrcode.base64));
    
    // Se não encontrou QR code na resposta inicial, tenta buscar via status
    if (!qrCodeBase64 || (typeof qrCodeBase64 === 'string' && qrCodeBase64.trim().length < 100)) {
      try {
        // Aguarda um pequeno delay para dar tempo da Evolution API processar
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Tenta buscar o status da instância que pode conter o QR code
        const statusUrl = `${normalizedBaseUrl}/instance/fetchInstances`;
        const statusResponse = await fetch(statusUrl, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            apikey: selectedApi.api_key_global.trim(),
          },
        });

        if (statusResponse.ok) {
          const statusData = await statusResponse.json();
          // Procura a instância recém-criada na lista
          const instanceData = Array.isArray(statusData) 
            ? statusData.find((inst: any) => inst.instance?.instanceName === instanceName || inst.instanceName === instanceName)
            : statusData;
          
          if (instanceData) {
            const qrFromStatus = evolutionService.extractQr(instanceData);
            if (qrFromStatus && qrFromStatus.trim().length >= 100) {
              qrCodeBase64 = qrFromStatus.replace(/^data:image\/[a-z]+;base64,/, '');
            }
          }
        }
      } catch {
        // Continuando sem QR do status
      }
    }
    
    // Se ainda não encontrou, verifica se é um caso de QR code pendente
    if (!qrCodeBase64 || (typeof qrCodeBase64 === 'string' && qrCodeBase64.trim().length < 100)) {
      if (hasQrcodePending) {
        qrCodeBase64 = null;
      } else {
        qrCodeBase64 = null;
      }
    }

    // Passo 7: Verifica se a instância já existe na Evolution API específica
    let existingInstanceInApi;
    try {
      let existingInApiQuery = supabaseServiceRole
        .from('evolution_instances')
        .select('id')
        .eq('evolution_api_id', apiRecord.id)
        .eq('instance_name', instanceName);
      if (instancesZaplotoScopeId === ZAPLOTO_DEFAULT_TENANT_ID) {
        existingInApiQuery = existingInApiQuery.or(
          `zaploto_id.eq.${ZAPLOTO_DEFAULT_TENANT_ID},zaploto_id.is.null`
        );
      } else {
        existingInApiQuery = existingInApiQuery.eq('zaploto_id', instancesZaplotoScopeId);
      }
      const { data, error: checkError } = await existingInApiQuery.single();

      if (checkError && checkError.code !== 'PGRST116') { // PGRST116 = nenhum resultado encontrado (não é erro)
        console.error('❌ [INSTÂNCIA] Erro ao verificar instância existente:', checkError);
        return errorResponse(`Erro ao verificar instância existente: ${checkError.message}`, 500);
      }

      existingInstanceInApi = data;
    } catch (checkErr: any) {
      console.error('❌ [INSTÂNCIA] Erro ao verificar instância existente:', checkErr);
      return errorResponse('Erro ao verificar se instância já existe', 500);
    }

    if (existingInstanceInApi) {
      // Tenta deletar na Evolution se já existe no banco
      try {
        if (evolutionData.hash) {
          const deleteUrl = `${normalizedBaseUrl}/instance/delete/${instanceName}`;
          const deleteResponse = await fetch(deleteUrl, {
            method: 'DELETE',
             headers: {
               apikey: selectedApi.api_key_global.trim(), // api_key_global contém o valor da API key
             },
          });
          if (!deleteResponse.ok) {
            console.warn('Não foi possível deletar instância duplicada na Evolution');
          }
        }
      } catch (deleteErr) {
        console.error('Erro ao deletar instância duplicada na Evolution:', deleteErr);
      }
      return errorResponse('Instância com este nome já existe para esta Evolution API', 400);
    }

    // CRÍTICO: Captura o hash da instância retornado pela Evolution API
    // O hash é uma string direta, não um objeto
    const instanceHash = evolutionData.hash || null;
    
    if (!instanceHash) {
      console.warn(`⚠️ [INSTÂNCIA] Hash não encontrado na resposta da Evolution API. Resposta:`, JSON.stringify(evolutionData).substring(0, 500));
    } else {
    }

    // Passo 8: Salva na nova tabela evolution_instances com user_id
    // Status inicial: desconectado até o QR ser lido e a Evolution reportar conectado — NÃO 'ok'
    let savedInstance;
    let dbError;
    try {
      const insertResult = await supabaseServiceRole
        .from('evolution_instances')
        .insert({
          evolution_api_id: apiRecord.id,
          instance_name: instanceName,
          phone_number: null,
          is_active: true,
          status: 'disconnected', // Status inicial: desconectado aguardando QR code
          daily_limit: 100, // Padrão
          sent_today: 0,
          error_today: 0,
          rate_limit_count_today: 0,
          user_id: userId, // Vincula a instância ao usuário que criou
          zaploto_id: instancesZaplotoScopeId,
          apikey: instanceHash, // CRÍTICO: Salva o hash da instância (que é usado como apikey nos requests)
          is_master: isMaster === true, // Marca como instância mestre se solicitado
          maturation_type: maturationTypeValue, // virgem = maturador/rede mútua; maturado = fluxo normal
          webhook_configured: !!(isMaster === true && shouldConfigureChatWebhook && masterChatWebhookUrl),
        })
        .select()
        .single();

      dbError = insertResult.error;
      savedInstance = insertResult.data;
    } catch (insertErr: any) {
      console.error('❌ [INSTÂNCIA] Erro ao inserir instância no banco:', insertErr);
      dbError = insertErr;
      savedInstance = null;
    }

    if (dbError || !savedInstance) {
      // Tenta deletar na Evolution se falhou no banco
      try {
        if (evolutionData.hash) {
          // Cria função temporária para deletar
          const deleteUrl = `${normalizedBaseUrl}/instance/delete/${instanceName}`;
          const deleteResponse = await fetch(deleteUrl, {
            method: 'DELETE',
             headers: {
               apikey: selectedApi.api_key_global.trim(), // api_key_global contém o valor da API key
             },
          });
          if (!deleteResponse.ok) {
            console.warn('Não foi possível deletar instância na Evolution após falha no banco');
          }
        }
      } catch (deleteErr) {
        console.error('Erro ao deletar instância na Evolution após falha no banco:', deleteErr);
      }
      return errorResponse(`Erro ao salvar instância: ${dbError?.message || 'Erro desconhecido'}`);
    }

    // Opcional: aplica proxy na Evolution logo após criar a instância (antes do QR / pareamento).
    let proxyWarning: string | null = null;
    const proxyIdStr =
      typeof proxyIdFromBody === 'string' && proxyIdFromBody.trim().length > 0
        ? proxyIdFromBody.trim()
        : null;
    if (proxyIdStr) {
      const proxyResult = await assignProxyToEvolutionInstance({
        instanceId: savedInstance.id,
        proxyId: proxyIdStr,
      });
      if (!proxyResult.ok) {
        proxyWarning = proxyResult.error;
        console.warn(`⚠️ [INSTÂNCIA] Instância criada mas falha ao aplicar proxy: ${proxyResult.error}`);
      }
    }

    // Retorna dados no formato compatível com o frontend (inclui QR code)
    // Na UI a instância aparece como desconectada até conectar; o polling usa o estado real da Evolution em GET /status.
    const responseData = {
      id: savedInstance.id,
      instance_name: savedInstance.instance_name,
      status: 'disconnected',
      qr_code: qrCodeBase64,
      hash: evolutionData.hash,
      number: savedInstance.phone_number,
      created_at: savedInstance.created_at,
      updated_at: savedInstance.updated_at,
      ...(proxyWarning ? { proxy_warning: proxyWarning } : {}),
    };

    return successResponse(
      responseData,
      proxyWarning ? 'Instância criada; revise o aviso sobre o proxy' : 'Instância criada com sucesso'
    );
  } catch (err: any) {
    console.error('❌ [INSTÂNCIA] Erro inesperado ao criar instância:', err);
    console.error('❌ [INSTÂNCIA] Stack trace:', err?.stack);
    console.error('❌ [INSTÂNCIA] Erro detalhado:', {
      message: err?.message,
      name: err?.name,
      code: err?.code,
      cause: err?.cause,
      type: typeof err,
      constructor: err?.constructor?.name,
    });
    
    // Garante que sempre retorna JSON válido
    let errorMessage = 'Erro desconhecido ao criar instância';
    
    if (err?.message) {
      errorMessage = err.message;
    } else if (typeof err === 'string') {
      errorMessage = err;
    } else if (err?.toString && typeof err.toString === 'function') {
      errorMessage = err.toString();
    }
    
    // Log adicional para erros de fetch/network
    if (errorMessage.includes('fetch') || errorMessage.includes('network') || errorMessage.includes('ECONNREFUSED') || errorMessage.includes('ENOTFOUND')) {
      console.error('❌ [INSTÂNCIA] Erro de rede detectado - verifique conectividade com Evolution API');
    }
    
    return errorResponse(errorMessage, 500);
  }
}

