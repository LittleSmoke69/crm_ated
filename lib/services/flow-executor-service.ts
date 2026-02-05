import { supabaseServiceRole } from './supabase-service';
import { llmService } from './llm-service';

export interface FlowNode {
  id: string;
  type: 'webhookTrigger' | 'switch' | 'randomPicker' | 'sendMessage' | 'generateImage' | 'generateVideo' | 'waitVideo' | 'saveToDataset' | 'agentIA';
  position: { x: number; y: number };
  data: {
    label: string;
    config: any;
  };
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string; // Para switch nodes (ex: "add", "remove")
}

export interface FlowGraph {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export interface Flow {
  id: string;
  name: string;
  description?: string;
  type: 'automation' | 'template';
  status: 'active' | 'inactive' | 'draft';
  graph_json: FlowGraph;
  settings_json?: any;
  user_id: string;
  created_at: string;
  updated_at: string;
}

/**
 * Serviço de execução de flows
 */
export class FlowExecutorService {
  /**
   * Executa um flow dado um evento webhook
   */
  async executeFlow(flowId: string, eventId: string, userId: string): Promise<string | null> {
    try {
      // Busca o flow
      const { data: flow, error: flowError } = await supabaseServiceRole
        .from('flows')
        .select('*')
        .eq('id', flowId)
        .eq('status', 'active')
        .single();

      if (flowError || !flow) {
        console.error(`❌ [FLOW EXECUTOR] Flow ${flowId} não encontrado ou inativo:`, flowError);
        return null;
      }

      // Busca o evento
      const { data: event, error: eventError } = await supabaseServiceRole
        .from('evolution_webhook_events')
        .select('*')
        .eq('id', eventId)
        .single();

      if (eventError || !event) {
        console.error(`❌ [FLOW EXECUTOR] Evento ${eventId} não encontrado:`, eventError);
        return null;
      }

      // Prepara dados de entrada (usa payload_normalized se disponível, senão payload)
      const inputData = event.payload_normalized || event.payload;
      
      // Adiciona instanceName do evento se disponível
      if (event.instance_name && !inputData.instance && !inputData.instanceName) {
        inputData.instance = event.instance_name;
        inputData.instanceName = event.instance_name;
        if (inputData.normalized) {
          inputData.normalized.instance = event.instance_name;
          inputData.normalized.instanceName = event.instance_name;
        }
      }
      
      const graph = flow.graph_json as FlowGraph;

      // Cria execução (env e instance_name vêm do evento)
      const { data: execution, error: execError } = await supabaseServiceRole
        .from('flow_executions')
        .insert({
          flow_id: flowId,
          trigger_event_id: eventId,
          status: 'running',
          input_data: inputData,
          user_id: userId,
          env: (event as any).env === 'test' ? 'test' : 'prod',
          instance_name: (event as any).instance_name || null,
        })
        .select()
        .single();

      if (execError || !execution) {
        console.error(`❌ [FLOW EXECUTOR] Erro ao criar execução:`, execError);
        return null;
      }

      console.log(`🚀 [FLOW EXECUTOR] Iniciando execução ${execution.id} do flow ${flowId}`);

      try {
        // Encontra o node trigger (primeiro node do tipo webhookTrigger)
        const triggerNode = graph.nodes.find(n => n.type === 'webhookTrigger');
        if (!triggerNode) {
          throw new Error('Flow sem node trigger');
        }

        // Verifica se o evento corresponde aos filtros do trigger
        if (!this.matchesTrigger(triggerNode, event, inputData)) {
          console.log(`⚠️ [FLOW EXECUTOR] Evento não corresponde aos filtros do trigger`);
          await this.finishExecution(execution.id, 'cancelled', null, null);
          return execution.id;
        }

        // Garante que instanceName está no contexto normalizado
        const normalizedData = event.payload_normalized || inputData;
        if (event.instance_name) {
          if (!normalizedData.instance && !normalizedData.instanceName) {
            normalizedData.instance = event.instance_name;
            normalizedData.instanceName = event.instance_name;
          }
          if (normalizedData.normalized) {
            if (!normalizedData.normalized.instance && !normalizedData.normalized.instanceName) {
              normalizedData.normalized.instance = event.instance_name;
              normalizedData.normalized.instanceName = event.instance_name;
            }
          }
        }
        
        // Garante que $json tem acesso aos dados originais E normalizados
        // Para eventos group-participants.update, precisa ter acesso a data.id e data.participants[0].phoneNumber
        const jsonData = {
          ...inputData,
          // Garante que data está acessível
          data: inputData.data || normalizedData.data || {},
          // Garante que normalized está acessível dentro de $json também
          normalized: normalizedData.normalized || normalizedData,
        };
        
        // Busca informações do usuário para variáveis globais
        const userInfo = await this.getUserInfoForVariables(userId);
        
        // Executa o flow percorrendo os nodes
        const executionContext: Record<string, any> = {
          $json: jsonData,
          json: jsonData, // Adiciona também sem prefixo para facilitar acesso
          $normalized: normalizedData,
          normalized: normalizedData.normalized || normalizedData, // Adiciona também sem prefixo para facilitar acesso
          $userId: userId, // Adiciona userId para uso nas APIs de IA
          // Variáveis globais
          $global: {
            numero: userInfo.numero || '',
            banca: userInfo.banca || '',
            nome: userInfo.nome || '',
          },
          global: {
            numero: userInfo.numero || '',
            banca: userInfo.banca || '',
            nome: userInfo.nome || '',
          },
        };

        const outputData = await this.executeNodes(
          execution.id,
          graph,
          triggerNode.id,
          executionContext
        );

        await this.finishExecution(execution.id, 'success', null, outputData);
        console.log(`✅ [FLOW EXECUTOR] Execução ${execution.id} concluída com sucesso`);

        return execution.id;
      } catch (err: any) {
        const errorDetails = {
          flowId,
          eventId,
          userId,
          executionId: execution.id,
          errorMessage: err.message,
          errorStack: err.stack,
          errorName: err.name,
        };
        console.error(`❌ [FLOW EXECUTOR] Erro na execução:`, errorDetails);
        await this.finishExecution(execution.id, 'failed', err.message, null);
        return execution.id;
      }
    } catch (err: any) {
      const errorDetails = {
        flowId,
        eventId,
        userId,
        errorMessage: err.message,
        errorStack: err.stack,
        errorName: err.name,
      };
      console.error(`❌ [FLOW EXECUTOR] Erro ao executar flow:`, errorDetails);
      return null;
    }
  }

  /**
   * Verifica se o evento corresponde aos filtros do trigger
   */
  private matchesTrigger(triggerNode: FlowNode, event: any, inputData: any): boolean {
    const config = triggerNode.data.config || {};
    const filters = config.filters || {};

    // Filtro por event_type
    if (filters.event_type && event.event_type !== filters.event_type) {
      return false;
    }

    // Filtro por instance_name
    if (filters.instance && event.instance_name !== filters.instance) {
      return false;
    }

    // Filtro por action (no payload normalizado)
    if (filters.action) {
      // Tenta múltiplos caminhos para encontrar o action
      const action = this.resolvePath(inputData, 'normalized.action') || 
                     this.resolvePath(inputData, 'action') ||
                     this.resolvePath(inputData, 'data.action') ||
                     this.resolvePath(inputData, 'data.update.action') ||
                     this.resolvePath(inputData, '$normalized.action') ||
                     this.resolvePath(inputData, '$json.data.action') ||
                     this.resolvePath(inputData, '$json.action');
      if (action !== filters.action) {
        return false;
      }
    }

    return true;
  }

  /**
   * Executa os nodes do flow em ordem topológica
   */
  private async executeNodes(
    executionId: string,
    graph: FlowGraph,
    startNodeId: string,
    context: Record<string, any>
  ): Promise<any> {
    const visited = new Set<string>();
    const executedNodes: string[] = [];

    const executeNode = async (nodeId: string): Promise<any> => {
      if (visited.has(nodeId)) {
        return context;
      }

      visited.add(nodeId);
      const node = graph.nodes.find(n => n.id === nodeId);
      if (!node) {
        throw new Error(`Node ${nodeId} não encontrado`);
      }

      console.log(`📦 [FLOW EXECUTOR] Executando node ${nodeId} (${node.type})`);

      const stepStartTime = Date.now();
      let stepInput: any = null;
      let stepOutput: any = null;
      let stepError: string | null = null;
      let stepStatus: 'success' | 'failed' | 'skipped' = 'success';

      try {
        // Prepara input do node (dados dos nodes anteriores)
        stepInput = this.prepareNodeInput(node, context);

        // Executa o node
        stepOutput = await this.executeNodeByType(node, stepInput, context);

        // Atualiza contexto com output do node
        context[`${node.type}_${nodeId}`] = stepOutput;
        context[nodeId] = stepOutput;
        
        // Para randomPicker, adiciona também em context.randomPicker para facilitar acesso
        if (node.type === 'randomPicker') {
          context.randomPicker = stepOutput;
        }
        
        // Atualiza número do lead nas variáveis globais se disponível
        if (node.type === 'webhookTrigger' || node.type === 'switch') {
          const numero = this.resolvePath(context, 'normalized.phoneNumber') ||
                        this.resolvePath(context, 'normalized.phone_number') ||
                        this.resolvePath(context, '$normalized.phoneNumber') ||
                        this.resolvePath(context, '$json.normalized.phoneNumber') ||
                        this.resolvePath(context, '$json.data.participants[0].phoneNumber');
          
          if (numero) {
            if (!context.$global) context.$global = {};
            if (!context.global) context.global = {};
            context.$global.numero = numero;
            context.global.numero = numero;
          }
        }

        executedNodes.push(nodeId);
      } catch (err: any) {
        stepError = err.message || String(err);
        stepStatus = 'failed';
        
        // Log detalhado do erro
        const errorDetails = {
          executionId,
          nodeId: node.id,
          nodeType: node.type,
          nodeLabel: node.data?.label || 'Sem label',
          errorMessage: err.message,
          errorStack: err.stack,
          stepInput: stepInput ? JSON.stringify(stepInput).substring(0, 500) : null,
          contextKeys: Object.keys(context),
        };
        
        console.error(`❌ [FLOW EXECUTOR] Erro ao executar node ${node.id} (${node.type}):`, errorDetails);
        
        throw err;
      } finally {
        const stepDuration = Date.now() - stepStartTime;

        // Salva step da execução
        await supabaseServiceRole
          .from('flow_execution_steps')
          .insert({
            execution_id: executionId,
            node_id: nodeId,
            node_type: node.type,
            status: stepStatus,
            started_at: new Date(stepStartTime).toISOString(),
            ended_at: new Date().toISOString(),
            duration_ms: stepDuration,
            input_json: stepInput,
            output_json: stepOutput,
            error_message: stepError,
            execution_order: executedNodes.length,
          });
      }

      // Encontra próximos nodes (via edges)
      const nextEdges = graph.edges.filter(e => e.source === nodeId);
      
      for (const edge of nextEdges) {
        // Para switch nodes, verifica se o output corresponde ao sourceHandle
        if (node.type === 'switch' && edge.sourceHandle) {
          const switchOutput = stepOutput?.output || stepOutput;
          if (switchOutput !== edge.sourceHandle) {
            continue; // Pula esta edge se não corresponde
          }
        }

        await executeNode(edge.target);
      }

      return context;
    };

    await executeNode(startNodeId);
    return context;
  }

  /**
   * Prepara input do node baseado no contexto
   */
  private prepareNodeInput(node: FlowNode, context: Record<string, any>): any {
    // Por enquanto, retorna o contexto completo
    // Futuramente pode ter lógica mais sofisticada
    return context;
  }

  /**
   * Executa um node específico por tipo
   */
  private async executeNodeByType(
    node: FlowNode,
    input: any,
    context: Record<string, any>
  ): Promise<any> {
    switch (node.type) {
      case 'webhookTrigger':
        const triggerOutput: any = { data: input.$json || input };
        // Adiciona instanceName se disponível no evento
        if (input.$normalized?.instance || input.$normalized?.instanceName || input.$json?.instance) {
          triggerOutput.instance = input.$normalized?.instance || input.$normalized?.instanceName || input.$json?.instance;
          triggerOutput.instanceName = triggerOutput.instance;
        }
        return triggerOutput;

      case 'switch':
        return await this.executeSwitchNode(node, input, context);

      case 'randomPicker':
        return await this.executeRandomPickerNode(node, input, context);

      case 'sendMessage':
        return await this.executeSendMessageNode(node, input, context);

      case 'generateImage':
        return await this.executeGenerateImageNode(node, input, context);

      case 'generateVideo':
        return await this.executeGenerateVideoNode(node, input, context);

      case 'waitVideo':
        return await this.executeWaitVideoNode(node, input, context);

      case 'saveToDataset':
        return await this.executeSaveToDatasetNode(node, input, context);

      case 'agentIA':
        return await this.executeAgentIANode(node, input, context);

      default:
        throw new Error(`Tipo de node desconhecido: ${(node as any).type}`);
    }
  }

  /**
   * Executa node Switch (condicional)
   */
  private async executeSwitchNode(
    node: FlowNode,
    input: any,
    context: Record<string, any>
  ): Promise<any> {
    const config = node.data.config || {};
    const rules = config.rules || [];

    // Avalia cada regra
    for (const rule of rules) {
      const condition = rule.condition || '';
      const output = rule.output || 'default';

      if (this.evaluateCondition(condition, context)) {
        return { output, matched: true, rule: rule };
      }
    }

    return { output: 'default', matched: false };
  }

  /**
   * Executa node Random Picker
   */
  private async executeRandomPickerNode(
    node: FlowNode,
    input: any,
    context: Record<string, any>
  ): Promise<any> {
    const config = node.data.config || {};
    const messages = config.messages || [];

    if (messages.length === 0) {
      return { selected: null, error: 'Nenhuma mensagem configurada' };
    }

    // Escolhe mensagem aleatória
    const randomIndex = Math.floor(Math.random() * messages.length);
    const selected = messages[randomIndex];

    // Resolve variáveis na mensagem (ex: {{$json.normalized.phoneNumber}})
    const resolvedMessage = this.resolveVariables(selected, context);

    // Retorna tanto a mensagem resolvida quanto o objeto completo para acesso via {{$json.randomPicker.selected}}
    return { 
      selected: resolvedMessage, 
      index: randomIndex,
      message: resolvedMessage, // Alias para compatibilidade
      original: selected // Mensagem original antes da resolução
    };
  }

  /**
   * Executa node Send Message
   */
  private async executeSendMessageNode(
    node: FlowNode,
    input: any,
    context: Record<string, any>
  ): Promise<any> {
    const config = node.data.config || {};
    
    // Resolve variáveis nas configurações
    let instanceName = this.resolveVariables(config.instance_name || '', context);
    
    // Se instanceName ainda contém variáveis não resolvidas, tenta buscar do contexto normalizado
    if (!instanceName || instanceName.includes('{{') || instanceName.includes('$')) {
      // Tenta múltiplos caminhos para encontrar instanceName
      instanceName = this.resolvePath(context, 'normalized.instanceName') ||
                    this.resolvePath(context, 'normalized.instance_name') ||
                    this.resolvePath(context, 'normalized.instance') ||
                    this.resolvePath(context, '$normalized.instanceName') ||
                    this.resolvePath(context, '$normalized.instance_name') ||
                    this.resolvePath(context, '$normalized.instance') ||
                    this.resolvePath(context, '$json.instance') ||
                    this.resolvePath(context, '$json.data.instance') ||
                    this.resolvePath(context, '$json.instanceName') ||
                    this.resolvePath(context, '$json.data.instanceName') ||
                    // Tenta buscar em nodes anteriores (ex: output do trigger)
                    this.resolvePath(context, 'webhookTrigger_trigger-1.instance') ||
                    this.resolvePath(context, 'webhookTrigger_trigger-1.data.instance') ||
                    this.resolvePath(context, 'trigger-1.instance') ||
                    this.resolvePath(context, 'trigger-1.data.instance') ||
                    // Busca em todos os nodes do tipo webhookTrigger
                    (() => {
                      for (const key of Object.keys(context)) {
                        if (key.startsWith('webhookTrigger_') || key.startsWith('trigger-')) {
                          const nodeOutput = context[key];
                          if (nodeOutput?.instance) return nodeOutput.instance;
                          if (nodeOutput?.data?.instance) return nodeOutput.data.instance;
                          if (nodeOutput?.instanceName) return nodeOutput.instanceName;
                        }
                      }
                      return null;
                    })() ||
                    instanceName; // Mantém o valor original se não encontrar
    }
    
    // Log para debug
    if (!instanceName || instanceName.includes('{{') || instanceName.includes('$')) {
      console.log('⚠️ [FLOW EXECUTOR] instanceName não resolvido:', {
        config_instance_name: config.instance_name,
        resolved: instanceName,
        context_keys: Object.keys(context),
        normalized_keys: context.$normalized ? Object.keys(context.$normalized) : [],
        json_keys: context.$json ? Object.keys(context.$json) : [],
        trigger_outputs: Object.keys(context).filter(k => k.includes('trigger') || k.includes('webhookTrigger')),
      });
    }
    
    let groupJid = this.resolveVariables(config.group_jid || '', context);
    let message = this.resolveVariables(config.message || '', context);
    let number = this.resolveVariables(config.number || '', context);

    // Se groupJid ainda contém variáveis não resolvidas, tenta buscar do contexto normalizado
    if (!groupJid || groupJid.includes('{{') || groupJid.includes('$')) {
      // Prioriza data.id (ID do grupo) para eventos group-participants.update
      groupJid = this.resolvePath(context, 'json.data.id') || // ID do grupo em data.id (ex: "120363423429846273@g.us")
                 this.resolvePath(context, '$json.data.id') ||
                 this.resolvePath(context, 'normalized.groupId') ||
                 this.resolvePath(context, 'normalized.group_id') ||
                 this.resolvePath(context, '$normalized.groupId') ||
                 this.resolvePath(context, '$normalized.group_id') ||
                 this.resolvePath(context, 'json.normalized.groupId') ||
                 this.resolvePath(context, '$json.normalized.groupId') ||
                 this.resolvePath(context, 'json.normalized.group_id') ||
                 this.resolvePath(context, '$json.normalized.group_id') ||
                 this.resolvePath(context, 'normalized.groupJid') ||
                 this.resolvePath(context, '$normalized.groupJid') ||
                 '';
    }

    // Se number ainda contém variáveis não resolvidas, tenta buscar do contexto normalizado
    if (!number || number.includes('{{') || number.includes('$')) {
      // Prioriza participants[0].phoneNumber para eventos group-participants.update
      number = this.resolvePath(context, 'json.data.participants[0].phoneNumber') || // phoneNumber do primeiro participante (ex: "62851784815372@s.whatsapp.net")
               this.resolvePath(context, '$json.data.participants[0].phoneNumber') ||
               this.resolvePath(context, 'json.data.participants.0.phoneNumber') || // Formato alternativo
               this.resolvePath(context, '$json.data.participants.0.phoneNumber') ||
               this.resolvePath(context, 'normalized.phoneNumber') ||
               this.resolvePath(context, 'normalized.phone_number') ||
               this.resolvePath(context, '$normalized.phoneNumber') ||
               this.resolvePath(context, '$normalized.phone_number') ||
               this.resolvePath(context, 'json.normalized.phoneNumber') ||
               this.resolvePath(context, '$json.normalized.phoneNumber') ||
               this.resolvePath(context, 'json.normalized.phone_number') ||
               this.resolvePath(context, '$json.normalized.phone_number') ||
               this.resolvePath(context, 'normalized.number') ||
               this.resolvePath(context, '$normalized.number') ||
               this.resolvePath(context, 'json.normalized.number') ||
               this.resolvePath(context, '$json.normalized.number') ||
               '';
    }

    // Log detalhado do contexto para debug
    console.log(`🔍 [FLOW EXECUTOR] Debug - Contexto completo:`, {
      nodeId: node.id,
      config: {
        instance_name: config.instance_name,
        group_jid: config.group_jid,
        number: config.number,
        message: config.message ? `${config.message.substring(0, 50)}...` : 'vazio',
      },
      resolved: {
        instanceName,
        groupJid: groupJid || 'não resolvido',
        number: number || 'não resolvido',
        message: message ? `${message.substring(0, 100)}${message.length > 100 ? '...' : ''}` : 'vazio',
      },
      contextAvailable: {
        normalized: context.$normalized ? Object.keys(context.$normalized) : [],
        normalizedData: context.$normalized ? JSON.stringify(context.$normalized).substring(0, 500) : 'não disponível',
        json: context.$json ? Object.keys(context.$json) : [],
        jsonData: context.$json ? JSON.stringify(context.$json).substring(0, 500) : 'não disponível',
        allKeys: Object.keys(context),
      },
      // Testa resolução direta de paths importantes
      directResolutions: {
        'normalized.groupId': this.resolvePath(context, 'normalized.groupId'),
        '$normalized.groupId': this.resolvePath(context, '$normalized.groupId'),
        '$json.normalized.groupId': this.resolvePath(context, '$json.normalized.groupId'),
        '$json.data.id': this.resolvePath(context, '$json.data.id'),
        'normalized.phoneNumber': this.resolvePath(context, 'normalized.phoneNumber'),
        '$normalized.phoneNumber': this.resolvePath(context, '$normalized.phoneNumber'),
        '$json.normalized.phoneNumber': this.resolvePath(context, '$json.normalized.phoneNumber'),
        '$json.data.participants[0].phoneNumber': this.resolvePath(context, '$json.data.participants[0].phoneNumber'),
      },
    });

    // Valida se message ainda contém variáveis não resolvidas
    // Mas primeiro tenta resolver novamente com paths alternativos
    let finalMessage = message;
    if (!message || message.includes('{{') || message.includes('$')) {
      // Tenta resolver novamente com paths alternativos para randomPicker
      const retryMessage = this.resolveVariables(message, context);
      if (retryMessage && !retryMessage.includes('{{') && !retryMessage.includes('$')) {
        // Se conseguiu resolver, usa o valor resolvido
        finalMessage = retryMessage;
      } else {
        throw new Error(`Mensagem não pode conter variáveis não resolvidas: ${message}`);
      }
    } else {
      finalMessage = message;
    }

    if (!instanceName || instanceName.includes('{{') || instanceName.includes('$')) {
      throw new Error(`Instance name não pode conter variáveis não resolvidas: ${instanceName}`);
    }

    // Valida se groupJid ou number foram resolvidos
    if ((!groupJid || groupJid.includes('{{') || groupJid.includes('$')) && 
        (!number || number.includes('{{') || number.includes('$'))) {
      throw new Error(`Group JID ou Number devem ser fornecidos e resolvidos. GroupJid: ${groupJid || 'não fornecido'}, Number: ${number || 'não fornecido'}`);
    }

    // Usa finalMessage ao invés de message
    message = finalMessage;

    // Busca instância e Evolution API
    const { data: instance, error: instanceError } = await supabaseServiceRole
      .from('evolution_instances')
      .select(`
        *,
        evolution_apis (
          id,
          base_url,
          api_key_global
        )
      `)
      .eq('instance_name', instanceName)
      .eq('is_active', true)
      .single();

    if (instanceError || !instance) {
      throw new Error(`Instância ${instanceName} não encontrada ou inativa`);
    }

    // Valida se é instância mestre
    if (!instance.is_master) {
      throw new Error(`Apenas instâncias mestre podem ser usadas em automações. A instância ${instanceName} não é mestre.`);
    }

    // Valida se está conectada
    if (instance.status !== 'ok') {
      throw new Error(`Instância ${instanceName} deve estar conectada (status: ok) para executar automações. Status atual: ${instance.status}`);
    }

    const evolutionApi = Array.isArray(instance.evolution_apis) 
      ? instance.evolution_apis[0] 
      : instance.evolution_apis;

    if (!evolutionApi || !evolutionApi.base_url) {
      throw new Error(`Evolution API não configurada para instância ${instanceName}`);
    }

    // Busca apikey da instância
    const { data: instanceData } = await supabaseServiceRole
      .from('evolution_instances')
      .select('apikey')
      .eq('id', instance.id)
      .single();

    const apikey = instanceData?.apikey || evolutionApi.api_key_global;

    if (!apikey) {
      throw new Error(`API key não encontrada para instância ${instanceName}`);
    }

    // Prepara URL e body no formato correto da Evolution API
    const baseUrl = evolutionApi.base_url.replace(/\/+$/, '').replace(/([^:]\/)\/+/g, '$1');
    
    // Usa groupJid se disponível, caso contrário usa number
    // IMPORTANTE: groupJid deve ser o ID do grupo (ex: "120363423904121305@g.us")
    const recipient = groupJid || number || '';
    
    // Valida se recipient foi resolvido corretamente
    if (!recipient || recipient.includes('{{') || recipient.includes('$')) {
      throw new Error(`Recipient (groupJid/number) não foi resolvido corretamente: ${recipient || 'vazio'}`);
    }
    
    const url = `${baseUrl}/message/sendText/${instanceName}`;
    
    // Prepara body no formato Evolution API: { number, text, mentioned? }
    // mentioned = array de JIDs (ex: ["62851243461918@s.whatsapp.net"]) para marcar pessoas no WhatsApp
    const body: { number: string; text: string; mentioned?: string[] } = {
      number: recipient,
      text: message,
    };

    const toJid = (raw: string): string => {
      const s = String(raw).trim();
      if (!s || s.includes('{{') || s.includes('$')) return '';
      if (s.includes('@s.whatsapp.net')) return s;
      const clean = s.replace(/\D/g, '');
      return clean ? `${clean}@s.whatsapp.net` : '';
    };

    // 1) Campo "mentioned" configurado no nó (um JID por linha ou variável que resolve para JID)
    const mentionedConfig = (config.mentioned ?? '').toString().trim();
    if (mentionedConfig) {
      const lines = mentionedConfig.split(/[\n,]+/).map((l: string) => l.trim()).filter(Boolean);
      const resolvedJids: string[] = [];
      for (const line of lines) {
        const resolved = this.resolveVariables(line, context);
        const jid = toJid(resolved);
        if (jid) resolvedJids.push(jid);
      }
      if (resolvedJids.length > 0) {
        body.mentioned = resolvedJids;
        console.log(`📌 [FLOW EXECUTOR] mentioned no request (config):`, body.mentioned);
      }
    }

    // 2) Se não há mentioned no config, usa número do contexto (ex: participante que entrou no grupo)
    if (!body.mentioned) {
      const phoneNumber = this.resolvePath(context, 'normalized.phoneNumber') ||
                         this.resolvePath(context, 'normalized.phone_number') ||
                         this.resolvePath(context, '$normalized.phoneNumber') ||
                         this.resolvePath(context, '$normalized.phone_number') ||
                         this.resolvePath(context, '$json.normalized.phoneNumber') ||
                         this.resolvePath(context, '$json.normalized.phone_number') ||
                         this.resolvePath(context, '$json.data.participants[0].phoneNumber') ||
                         this.resolvePath(context, 'json.data.participants[0].phoneNumber') ||
                         this.resolvePath(context, 'normalized.participants[0].phoneNumber') ||
                         context.$global?.numero ||
                         context.global?.numero;
      if (phoneNumber) {
        const mentionedJid = toJid(phoneNumber);
        if (mentionedJid) {
          body.mentioned = [mentionedJid];
          console.log(`📌 [FLOW EXECUTOR] mentioned no request (contexto): [${mentionedJid}]`);
        }
      }
    }

    // Log detalhado do request que será enviado (apenas para debug)
    const requestDetails = {
      method: 'POST',
      url,
      headers: {
        'Content-Type': 'application/json',
        apikey: apikey ? `${apikey.substring(0, 8)}...${apikey.substring(apikey.length - 4)}` : 'N/A',
      },
      body: JSON.parse(JSON.stringify(body)), // Cria cópia limpa do body
      resolvedValues: {
        instanceName,
        groupJid: groupJid || 'não fornecido',
        number: number || 'não fornecido',
        recipient,
        messageLength: message ? message.length : 0,
        messagePreview: message ? `${message.substring(0, 100)}${message.length > 100 ? '...' : ''}` : 'vazio',
        mentioned: body.mentioned ? body.mentioned.join(', ') : 'não usado',
        hasMentioned: !!body.mentioned,
      },
    };

    console.log(`📤 [FLOW EXECUTOR] Request completo para Evolution API:`);
    console.log(JSON.stringify(requestDetails, null, 2));

    try {
      // IMPORTANTE: Request deve conter APENAS URL, headers e body (sem campos extras)
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: apikey,
        },
        body: JSON.stringify(body),
      });

      const responseData = await response.json().catch(() => ({ message: 'Erro ao parsear resposta' }));

      if (!response.ok) {
        const msgSource = responseData.message ?? responseData.response?.message;
        let errorMsg = '';
        if (msgSource) {
          errorMsg = Array.isArray(msgSource)
            ? msgSource.map((m: any) => (typeof m === 'string' ? m : JSON.stringify(m))).join('; ')
            : typeof msgSource === 'string'
              ? msgSource
              : String(responseData.error || `HTTP ${response.status}`);
        } else {
          errorMsg = String(responseData.error || `HTTP ${response.status}`);
        }
        if (!errorMsg) errorMsg = `HTTP ${response.status}`;

        if (errorMsg && /connection\s*closed/i.test(errorMsg)) {
          try {
            await supabaseServiceRole
              .from('evolution_instances')
              .update({ status: 'disconnected', updated_at: new Date().toISOString() })
              .eq('id', instance.id);
            console.log(`🔄 [FLOW EXECUTOR] Instância ${instanceName} marcada como desconectada (Connection Closed na Evolution API)`);
          } catch (updateErr: unknown) {
            console.error(`⚠️ [FLOW EXECUTOR] Erro ao atualizar status da instância:`, (updateErr as Error)?.message);
          }
        }

        const errorDetails = {
          nodeId: node.id,
          nodeType: node.type,
          instanceName,
          recipient: groupJid || number,
          url,
          httpStatus: response.status,
          responseData,
        };
        console.error(`❌ [FLOW EXECUTOR] Erro HTTP ao enviar mensagem:`, errorDetails);
        throw new Error(`Erro ao enviar mensagem: ${errorMsg} (HTTP ${response.status})`);
      }

      console.log(`✅ [FLOW EXECUTOR] Mensagem enviada com sucesso`);
      return {
        success: true,
        messageId: responseData.key?.id,
        response: responseData,
      };
    } catch (err: any) {
      const errorDetails = {
        nodeId: node.id,
        nodeType: node.type,
        instanceName,
        recipient: groupJid || number,
        url,
        errorMessage: err.message,
        errorStack: err.stack,
      };
      
      console.error(`❌ [FLOW EXECUTOR] Erro ao enviar mensagem:`, errorDetails);
      
      // Mensagem de erro mais detalhada
      let errorMsg = `Erro ao enviar mensagem`;
      if (err.message) {
        errorMsg += `: ${err.message}`;
      } else {
        errorMsg += `: ${String(err)}`;
      }
      
      throw new Error(errorMsg);
    }
  }

  /**
   * Executa node Generate Image
   */
  private async executeGenerateImageNode(
    node: FlowNode,
    input: any,
    context: Record<string, any>
  ): Promise<any> {
    const config = node.data.config || {};
    
    // Resolve variáveis
    const prompt = this.resolveVariables(config.prompt || '', context);
    const aspectRatio = config.aspectRatio || '1:1';
    const saveToDataset = config.saveToDataset !== false;

    if (!prompt) {
      throw new Error('Prompt é obrigatório para gerar imagem');
    }

    // Extrai store_id e group_jid do contexto se disponível
    const storeId = this.resolvePath(context, 'normalized.store_id') || 
                    this.resolvePath(context, '$normalized.store_id') || 
                    null;
    const groupJid = this.resolvePath(context, 'normalized.groupId') || 
                     this.resolvePath(context, '$normalized.groupId') || 
                     null;

    // Chama API de geração de imagem
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const response = await fetch(`${baseUrl}/api/ai/generate-image`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': context.$userId || '', // Precisa do userId no contexto
      },
      body: JSON.stringify({
        store_id: storeId,
        group_jid: groupJid,
        prompt,
        aspectRatio,
        saveToDataset,
      }),
    });

    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.error || 'Erro ao gerar imagem');
    }

    return {
      asset_id: result.data.asset?.id,
      asset: result.data.asset,
      dataset_item_id: result.data.datasetItem?.id,
      url: result.data.url,
    };
  }

  /**
   * Executa node Generate Video
   */
  private async executeGenerateVideoNode(
    node: FlowNode,
    input: any,
    context: Record<string, any>
  ): Promise<any> {
    const config = node.data.config || {};
    
    // Resolve variáveis
    const prompt = this.resolveVariables(config.prompt || '', context);
    const aspectRatio = config.aspectRatio || '16:9';
    const resolution = config.resolution || '720p';

    if (!prompt) {
      throw new Error('Prompt é obrigatório para gerar vídeo');
    }

    // Extrai store_id e group_jid do contexto se disponível
    const storeId = this.resolvePath(context, 'normalized.store_id') || 
                    this.resolvePath(context, '$normalized.store_id') || 
                    null;
    const groupJid = this.resolvePath(context, 'normalized.groupId') || 
                     this.resolvePath(context, '$normalized.groupId') || 
                     null;

    // Chama API de geração de vídeo
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const response = await fetch(`${baseUrl}/api/ai/generate-video`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': context.$userId || '', // Precisa do userId no contexto
      },
      body: JSON.stringify({
        store_id: storeId,
        group_jid: groupJid,
        prompt,
        aspectRatio,
        resolution,
      }),
    });

    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.error || 'Erro ao gerar vídeo');
    }

    return {
      job_id: result.data.job_id,
      operation_name: result.data.operation_name,
      status: result.data.status,
    };
  }

  /**
   * Executa node Wait Video (polling)
   */
  private async executeWaitVideoNode(
    node: FlowNode,
    input: any,
    context: Record<string, any>
  ): Promise<any> {
    const config = node.data.config || {};
    
    // Resolve variáveis
    const jobId = this.resolveVariables(config.job_id || '', context);
    const maxWaitSeconds = config.maxWaitSeconds || 300;
    const pollIntervalSeconds = config.pollIntervalSeconds || 5;

    if (!jobId) {
      throw new Error('Job ID é obrigatório para aguardar vídeo');
    }

    const startTime = Date.now();
    const maxWaitMs = maxWaitSeconds * 1000;

    // Polling até o vídeo estar pronto ou timeout
    while (Date.now() - startTime < maxWaitMs) {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
      const response = await fetch(`${baseUrl}/api/ai/video-status?job_id=${jobId}`, {
        headers: {
          'x-user-id': context.$userId || '',
        },
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Erro ao verificar status do vídeo');
      }

      if (result.data.status === 'succeeded') {
        return {
          status: 'succeeded',
          asset_id: result.data.asset?.id,
          asset: result.data.asset,
          dataset_item_id: result.data.datasetItem?.id,
          url: result.data.url,
        };
      }

      if (result.data.status === 'failed') {
        throw new Error(result.data.error || 'Geração de vídeo falhou');
      }

      // Aguarda antes do próximo polling
      await new Promise(resolve => setTimeout(resolve, pollIntervalSeconds * 1000));
    }

    throw new Error(`Timeout: vídeo não foi concluído em ${maxWaitSeconds} segundos`);
  }

  /**
   * Executa node Save to Dataset
   */
  private async executeSaveToDatasetNode(
    node: FlowNode,
    input: any,
    context: Record<string, any>
  ): Promise<any> {
    const config = node.data.config || {};
    
    // Resolve variáveis
    const assetId = this.resolveVariables(config.asset_id || '', context);
    const title = this.resolveVariables(config.title || '', context);
    const description = this.resolveVariables(config.description || '', context);
    const tags = Array.isArray(config.tags) ? config.tags : [];
    const intent = config.intent || null;

    if (!assetId) {
      throw new Error('Asset ID é obrigatório para salvar no dataset');
    }

    // Extrai store_id do contexto se disponível
    const storeId = this.resolvePath(context, 'normalized.store_id') || 
                    this.resolvePath(context, '$normalized.store_id') || 
                    null;

    // Salva no dataset
    const { data: datasetItem, error } = await supabaseServiceRole
      .from('training_dataset_items')
      .insert({
        store_id: storeId,
        asset_id: assetId,
        title: title || 'Item do dataset',
        description: description || '',
        tags: tags,
        intent: intent,
        approved: false, // Sempre false, precisa aprovação
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Erro ao salvar no dataset: ${error.message}`);
    }

    return {
      dataset_item_id: datasetItem.id,
      dataset_item: datasetItem,
    };
  }

  /**
   * Executa node Agent IA (com anti-spam)
   */
  private async executeAgentIANode(
    node: FlowNode,
    input: any,
    context: Record<string, any>
  ): Promise<any> {
    const config = node.data.config || {};
    
    // Resolve variáveis
    const systemPrompt = this.resolveVariables(config.system_prompt || '', context);
    const instanceName = this.resolveVariables(config.instance_name || '', context);
    const groupJid = this.resolveVariables(config.group_jid || '', context);
    const userMessage = this.resolveVariables(config.user_message || '', context);
    const userPhone = this.resolvePath(context, 'normalized.phoneNumber') || 
                      this.resolvePath(context, '$normalized.phoneNumber') || 
                      null;

    if (!systemPrompt || !instanceName || !groupJid || !userMessage) {
      throw new Error('Configuração incompleta: system_prompt, instance_name, group_jid e user_message são obrigatórios');
    }

    // 1) Verifica anti-spam usando as tabelas de agente por grupo
    const antiSpamResult = await this.checkAntiSpam(
      groupJid,
      userPhone,
      config,
      userMessage
    );

    if (!antiSpamResult.shouldReply) {
      return {
        shouldReply: false,
        reason: antiSpamResult.reason,
        skipped: true,
      };
    }

    // 2) Busca instância e Evolution API
    const { data: instance, error: instanceError } = await supabaseServiceRole
      .from('evolution_instances')
      .select(`
        *,
        evolution_apis (
          id,
          base_url,
          api_key_global
        )
      `)
      .eq('instance_name', instanceName)
      .eq('is_active', true)
      .single();

    if (instanceError || !instance) {
      throw new Error(`Instância ${instanceName} não encontrada ou inativa`);
    }

    if (!instance.is_master) {
      throw new Error(`Apenas instâncias mestre podem ser usadas em automações. A instância ${instanceName} não é mestre.`);
    }

    if (instance.status !== 'ok') {
      throw new Error(`Instância ${instanceName} deve estar conectada (status: ok) para executar automações. Status atual: ${instance.status}`);
    }

    const evolutionApi = Array.isArray(instance.evolution_apis) 
      ? instance.evolution_apis[0] 
      : instance.evolution_apis;

    if (!evolutionApi || !evolutionApi.base_url) {
      throw new Error(`Evolution API não configurada para instância ${instanceName}`);
    }

    const { data: instanceData } = await supabaseServiceRole
      .from('evolution_instances')
      .select('apikey')
      .eq('id', instance.id)
      .single();

    const apikey = instanceData?.apikey || evolutionApi.api_key_global;

    if (!apikey) {
      throw new Error(`API key não encontrada para instância ${instanceName}`);
    }

    // 3) Compõe prompt final com persona
    const personaTone = config.persona_tone || 'gentil';
    const personaRole = config.persona_role || 'consultor';
    const objective = config.objective || 'levar para deposito';

    const tonePrompts: Record<string, string> = {
      neutro: 'Seja neutro, profissional e objetivo. Use linguagem clara e direta.',
      gentil: 'Seja gentil, educado e acolhedor. Use linguagem amigável e positiva.',
      amigavel: 'Seja amigável, caloroso e descontraído. Use linguagem informal e positiva.',
    };

    const rolePrompts: Record<string, string> = {
      consultor: 'Você é um consultor que ajuda e orienta os clientes.',
      gerente: 'Você é um gerente que toma decisões e lidera conversas.',
    };

    const finalSystemPrompt = `${systemPrompt}

${tonePrompts[personaTone] || tonePrompts.gentil}

${rolePrompts[personaRole] || rolePrompts.consultor}

Objetivo principal: ${objective}

REGRAS ANTI-SPAM (OBRIGATÓRIO):
- Você só responde se a mensagem for claramente uma PERGUNTA, ou contiver palavras-chave de intenção, ou mencionar o suporte/agente.
- Se não for pergunta (ex: "ok", "bom dia", "todos", conversa solta), você NÃO responde.
- Você deve ser curto, direto, e sempre finalizar com uma pergunta simples para avançar.
- No máximo 1 resposta por vez, sem textos longos.`;

    // 4) Gera resposta usando LLM
    const userId = context.$userId || '';
    const tenantId = userId; // Assumindo que userId = tenantId por enquanto

    let llmResponse;
    try {
      llmResponse = await llmService.generate({
        tenantId,
        messages: [
          { role: 'system', content: finalSystemPrompt },
          { role: 'user', content: userMessage },
        ],
        temperature: 0.7,
        maxTokens: 500,
      });
    } catch (llmError: any) {
      throw new Error(`Erro ao gerar resposta do agente IA: ${llmError.message}`);
    }

    const agentResponse = llmResponse.content;

    if (!agentResponse) {
      throw new Error('Agente IA não retornou resposta');
    }

    // 5) Envia mensagem via Evolution API
    const baseUrl = evolutionApi.base_url.replace(/\/+$/, '').replace(/([^:]\/)\/+/g, '$1');
    const url = `${baseUrl}/message/sendText/${instanceName}`;
    
    const body: any = {
      number: groupJid,
      text: agentResponse,
    };

    // Adiciona mentioned se houver userPhone
    if (userPhone) {
      const cleanPhone = String(userPhone).replace(/\D/g, '');
      if (cleanPhone) {
        body.mentioned = [`${cleanPhone}@s.whatsapp.net`];
      }
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: apikey,
        },
        body: JSON.stringify(body),
      });

      const responseData = await response.json().catch(() => ({ message: 'Erro ao parsear resposta' }));

      if (!response.ok) {
        throw new Error(responseData.message || `HTTP ${response.status}`);
      }

      // 6) Atualiza contextos de anti-spam após enviar
      await this.updateAntiSpamContext(groupJid, userPhone, config);

      // 7) Log de uso (tokens)
      try {
        await supabaseServiceRole
          .from('ai_usage_logs')
          .insert({
            store_id: null, // Pode vir do contexto se disponível
            group_jid: groupJid,
            provider: 'gemini',
            model: llmResponse.model,
            endpoint: 'generateContent',
            prompt_tokens: llmResponse.usage?.promptTokens || null,
            output_tokens: llmResponse.usage?.completionTokens || null,
            total_tokens: llmResponse.usage?.totalTokens || null,
            estimated_cost_usd: null, // Calcule baseado no pricing
            created_by: userId,
          });
      } catch (logError) {
        console.error('Erro ao logar uso:', logError);
      }

      return {
        success: true,
        response: agentResponse,
        messageId: responseData.key?.id,
        usage: llmResponse.usage,
      };
    } catch (err: any) {
      console.error(`❌ [FLOW EXECUTOR] Erro ao enviar mensagem do agente IA:`, err);
      throw new Error(`Erro ao enviar mensagem: ${err.message}`);
    }
  }

  /**
   * Verifica regras de anti-spam
   */
  private async checkAntiSpam(
    groupJid: string,
    userPhone: string | null,
    config: any,
    userMessage: string
  ): Promise<{ shouldReply: boolean; reason?: string }> {
    // 1) Verifica se está em modo silencioso
    const { data: groupContext } = await supabaseServiceRole
      .from('whatsapp_group_agent_context')
      .select('*')
      .eq('group_jid', groupJid)
      .single();

    if (groupContext?.quiet_mode_until) {
      const quietUntil = new Date(groupContext.quiet_mode_until);
      if (quietUntil > new Date()) {
        // Só responde se mencionado
        if (config.only_reply_if_mentioned) {
          const isMentioned = userMessage.includes('@') || userMessage.toLowerCase().includes('agente') || userMessage.toLowerCase().includes('suporte');
          if (!isMentioned) {
            return { shouldReply: false, reason: 'Modo silencioso ativo' };
          }
        } else {
          return { shouldReply: false, reason: 'Modo silencioso ativo' };
        }
      }
    }

    // 2) Verifica rate limit por janela (grupo)
    const maxReplies = config.max_replies_per_window || 2;
    const windowSeconds = config.window_seconds || 300;
    const now = new Date();
    const windowStart = groupContext?.window_started_at 
      ? new Date(groupContext.window_started_at)
      : null;

    if (windowStart) {
      const windowAge = (now.getTime() - windowStart.getTime()) / 1000;
      
      if (windowAge < windowSeconds) {
        // Janela ainda ativa
        const repliesInWindow = groupContext?.replies_in_window || 0;
        if (repliesInWindow >= maxReplies) {
          return { shouldReply: false, reason: 'Rate limit por janela atingido' };
        }
      } else {
        // Janela expirou, reseta
        await supabaseServiceRole
          .from('whatsapp_group_agent_context')
          .upsert({
            group_jid: groupJid,
            window_started_at: now.toISOString(),
            replies_in_window: 0,
          }, {
            onConflict: 'group_jid',
          });
      }
    }

    // 3) Verifica cooldown por usuário
    if (userPhone) {
      const { data: member } = await supabaseServiceRole
        .from('whatsapp_group_agent_members')
        .select('*')
        .eq('group_jid', groupJid)
        .eq('user_phone', userPhone)
        .single();

      if (member?.last_bot_reply_at) {
        const lastReply = new Date(member.last_bot_reply_at);
        const cooldownSeconds = config.user_cooldown_seconds || 600;
        const timeSinceLastReply = (now.getTime() - lastReply.getTime()) / 1000;

        if (timeSinceLastReply < cooldownSeconds) {
          return { shouldReply: false, reason: 'Cooldown por usuário ativo' };
        }
      }
    }

    // 4) Verifica se é pergunta (se only_reply_if_question = true)
    if (config.only_reply_if_question !== false) {
      const isQuestion = userMessage.trim().endsWith('?') || 
                        userMessage.toLowerCase().includes('qual') ||
                        userMessage.toLowerCase().includes('como') ||
                        userMessage.toLowerCase().includes('quando') ||
                        userMessage.toLowerCase().includes('onde') ||
                        userMessage.toLowerCase().includes('quem') ||
                        userMessage.toLowerCase().includes('por que') ||
                        userMessage.toLowerCase().includes('porque');
      
      if (!isQuestion) {
        // Verifica se tem keywords
        const keywords = Array.isArray(config.keywords) ? config.keywords : [];
        const hasKeyword = keywords.some((keyword: string) => 
          userMessage.toLowerCase().includes(keyword.toLowerCase())
        );

        // Verifica se foi mencionado
        const isMentioned = config.only_reply_if_mentioned 
          ? (userMessage.includes('@') || userMessage.toLowerCase().includes('agente') || userMessage.toLowerCase().includes('suporte'))
          : false;

        if (!hasKeyword && !isMentioned) {
          return { shouldReply: false, reason: 'Não é pergunta e não contém palavras-chave' };
        }
      }
    }

    // 5) Verifica se foi mencionado (se only_reply_if_mentioned = true)
    if (config.only_reply_if_mentioned === true) {
      const isMentioned = userMessage.includes('@') || 
                         userMessage.toLowerCase().includes('agente') || 
                         userMessage.toLowerCase().includes('suporte');
      
      if (!isMentioned) {
        return { shouldReply: false, reason: 'Não foi mencionado' };
      }
    }

    return { shouldReply: true };
  }

  /**
   * Atualiza contextos de anti-spam após enviar mensagem
   */
  private async updateAntiSpamContext(
    groupJid: string,
    userPhone: string | null,
    config: any
  ): Promise<void> {
    const now = new Date();

    // Atualiza contexto do grupo
    const { data: groupContext } = await supabaseServiceRole
      .from('whatsapp_group_agent_context')
      .select('*')
      .eq('group_jid', groupJid)
      .single();

    const windowStart = groupContext?.window_started_at 
      ? new Date(groupContext.window_started_at)
      : null;
    const windowSeconds = config.window_seconds || 300;
    const windowAge = windowStart ? (now.getTime() - windowStart.getTime()) / 1000 : windowSeconds + 1;

    let newWindowStart = windowStart ? windowStart.toISOString() : now.toISOString();
    let repliesInWindow = groupContext?.replies_in_window || 0;

    if (windowAge >= windowSeconds) {
      // Janela expirou, inicia nova janela
      newWindowStart = now.toISOString();
      repliesInWindow = 1;
    } else {
      // Incrementa contador na janela atual
      repliesInWindow = (repliesInWindow || 0) + 1;
    }

    await supabaseServiceRole
      .from('whatsapp_group_agent_context')
      .upsert({
        group_jid: groupJid,
        last_bot_message_at: now.toISOString(),
        last_bot_message_text: '', // Será preenchido depois se necessário
        window_started_at: newWindowStart,
        replies_in_window: repliesInWindow,
      }, {
        onConflict: 'group_jid',
      });

    // Atualiza contexto do membro (se houver userPhone)
    if (userPhone) {
      await supabaseServiceRole
        .from('whatsapp_group_agent_members')
        .upsert({
          group_jid: groupJid,
          user_phone: userPhone,
          last_bot_reply_at: now.toISOString(),
          last_user_message_at: now.toISOString(),
          last_user_message_text: '', // Será preenchido depois se necessário
        }, {
          onConflict: 'group_jid,user_phone',
        });
    }
  }

  /**
   * Avalia uma condição (ex: "{{$json.normalized.action}} equals 'add'")
   */
  private evaluateCondition(condition: string, context: Record<string, any>): boolean {
    // Resolve variáveis na condição
    const resolved = this.resolveVariables(condition, context);

    // Suporta condições simples: "valor equals 'valor2'", "valor contains 'texto'"
    const equalsMatch = resolved.match(/^(.+?)\s+equals\s+['"](.+?)['"]$/i);
    if (equalsMatch) {
      return equalsMatch[1].trim() === equalsMatch[2].trim();
    }

    const containsMatch = resolved.match(/^(.+?)\s+contains\s+['"](.+?)['"]$/i);
    if (containsMatch) {
      return containsMatch[1].trim().includes(containsMatch[2].trim());
    }

    // Por padrão, considera true se a string não está vazia
    return !!resolved && resolved.trim() !== '';
  }

  /**
   * Resolve variáveis no formato {{$json.path}} ou {{$normalized.field}} ou {{numero}}, {{banca}}, {{nome}}
   */
  private resolveVariables(template: string, context: Record<string, any>): string {
    if (!template || typeof template !== 'string') {
      return template;
    }

    return template.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
      const trimmedPath = path.trim();
      
      // Variáveis globais simples (sem $ ou .)
      if (trimmedPath === 'numero') {
        // Busca número do lead do contexto normalizado
        const numero = this.resolvePath(context, 'normalized.phoneNumber') ||
                      this.resolvePath(context, 'normalized.phone_number') ||
                      this.resolvePath(context, '$normalized.phoneNumber') ||
                      this.resolvePath(context, '$normalized.phone_number') ||
                      this.resolvePath(context, '$json.normalized.phoneNumber') ||
                      this.resolvePath(context, '$json.normalized.phone_number') ||
                      this.resolvePath(context, '$json.data.participants[0].phoneNumber') ||
                      this.resolvePath(context, 'json.data.participants[0].phoneNumber') ||
                      context.$global?.numero ||
                      context.global?.numero ||
                      '';
        
        // Remove sufixos do WhatsApp para exibição, mas mantém formato completo para menção
        if (numero && numero.includes('@')) {
          return numero.split('@')[0];
        }
        return numero || '';
      }
      
      if (trimmedPath === 'banca') {
        return context.$global?.banca || context.global?.banca || '';
      }
      
      if (trimmedPath === 'nome') {
        return context.$global?.nome || context.global?.nome || '';
      }
      
      // Variáveis complexas (com $ ou .)
      const value = this.resolvePath(context, trimmedPath);
      return value !== undefined && value !== null ? String(value) : match;
    });
  }

  /**
   * Resolve um path no contexto (ex: "$json.normalized.action" ou "participants[0].phoneNumber" ou "randomPicker.selected")
   */
  private resolvePath(context: Record<string, any>, path: string): any {
    if (!path) return undefined;

    // Remove prefixo $ se houver
    const cleanPath = path.replace(/^\$/, '');

    // Suporte especial para acessar outputs de nodes anteriores
    // Ex: "randomPicker.selected" -> busca em todos os outputs de randomPicker
    if (cleanPath.startsWith('randomPicker.')) {
      const field = cleanPath.replace('randomPicker.', '');
      // Busca em todos os outputs de randomPicker
      for (const key of Object.keys(context)) {
        if (key.startsWith('randomPicker_') || key.startsWith('random-picker-')) {
          const output = context[key];
          if (output && typeof output === 'object' && field in output) {
            return output[field];
          }
        }
      }
      // Tenta também sem prefixo
      if (context.randomPicker && typeof context.randomPicker === 'object' && field in context.randomPicker) {
        return context.randomPicker[field];
      }
    }

    // Melhor parsing do path para suportar arrays corretamente
    // Ex: "data.participants[0].phoneNumber" -> ["data", "participants", "0", "phoneNumber"]
    const parts: string[] = [];
    let currentPart = '';
    let inBrackets = false;
    
    for (let i = 0; i < cleanPath.length; i++) {
      const char = cleanPath[i];
      
      if (char === '[') {
        if (currentPart) {
          parts.push(currentPart);
          currentPart = '';
        }
        inBrackets = true;
      } else if (char === ']') {
        if (currentPart) {
          parts.push(currentPart);
          currentPart = '';
        }
        inBrackets = false;
      } else if (char === '.' && !inBrackets) {
        if (currentPart) {
          parts.push(currentPart);
          currentPart = '';
        }
      } else {
        currentPart += char;
      }
    }
    
    if (currentPart) {
      parts.push(currentPart);
    }

    // Tenta múltiplos caminhos para encontrar o valor
    const searchPaths: any[] = [context];

    // Se começa com "json", tenta em context.$json primeiro
    if (parts[0] === 'json') {
      if (context.$json) {
        searchPaths.push(context.$json);
      }
      if (context.json) {
        searchPaths.push(context.json);
      }
      // Remove "json" do path
      parts.shift();
    }

    // Se começa com "normalized", tenta múltiplos caminhos
    if (parts[0] === 'normalized') {
      if (context.$normalized) {
        searchPaths.push(context.$normalized);
      }
      if (context.$json?.normalized) {
        searchPaths.push(context.$json.normalized);
      }
      if (context.json?.normalized) {
        searchPaths.push(context.json.normalized);
      }
      if (context.normalized) {
        searchPaths.push(context.normalized);
      }
      // Remove "normalized" do path
      parts.shift();
    }

    // Tenta resolver em cada caminho
    for (const base of searchPaths) {
      let current = base;

      for (const part of parts) {
        if (current === null || current === undefined) {
          break;
        }

        // Verifica se é índice de array (número)
        const arrayMatch = part.match(/^(\d+)$/);
        if (arrayMatch) {
          const index = parseInt(arrayMatch[1], 10);
          if (Array.isArray(current) && index >= 0 && index < current.length) {
            current = current[index];
          } else {
            current = undefined;
            break;
          }
        } else {
          // Propriedade de objeto
          current = current[part];
        }
      }

      if (current !== undefined && current !== null) {
        return current;
      }
    }

    return undefined;
  }

  /**
   * Busca informações do usuário para variáveis globais (nome, banca)
   */
  private async getUserInfoForVariables(userId: string): Promise<{
    nome: string;
    banca: string;
    numero: string;
  }> {
    try {
      const { getUserProfile } = await import('@/lib/middleware/permissions');
      const { getUserBancas } = await import('@/lib/utils/user-bancas');
      
      const profile = await getUserProfile(userId);
      if (!profile) {
        return { nome: '', banca: '', numero: '' };
      }

      // Busca nome do usuário
      const nome = profile.full_name || profile.email || '';

      // Busca bancas do usuário
      const bancas = await getUserBancas(userId);
      const banca = bancas.length > 0 ? bancas[0].name : '';

      return {
        nome,
        banca,
        numero: '', // número será preenchido durante a execução do flow
      };
    } catch (error: any) {
      console.error('[getUserInfoForVariables] Erro ao buscar informações do usuário:', error);
      return { nome: '', banca: '', numero: '' };
    }
  }

  /**
   * Finaliza uma execução
   */
  private async finishExecution(
    executionId: string,
    status: 'success' | 'failed' | 'cancelled',
    errorMessage: string | null,
    outputData: any
  ): Promise<void> {
    await supabaseServiceRole
      .from('flow_executions')
      .update({
        status,
        ended_at: new Date().toISOString(),
        error_message: errorMessage,
        output_data: outputData,
      })
      .eq('id', executionId);
  }

  /**
   * Busca flows ativos que correspondem a um evento
   */
  async findMatchingFlows(eventType: string, instanceName: string | null, normalizedPayload: any): Promise<Flow[]> {
    try {
      const { data: flows, error } = await supabaseServiceRole
        .from('flows')
        .select('*')
        .eq('status', 'active');

      if (error) {
        console.error('❌ [FLOW EXECUTOR] Erro ao buscar flows:', error);
        return [];
      }

      if (!flows || flows.length === 0) {
        return [];
      }

      // Filtra flows que correspondem ao evento
      const matchingFlows: Flow[] = [];

      for (const flow of flows) {
        const graph = flow.graph_json as FlowGraph;
        const triggerNode = graph.nodes.find(n => n.type === 'webhookTrigger');

        if (!triggerNode) continue;

        const config = triggerNode.data.config || {};
        const filters = config.filters || {};

        // Verifica filtros
        if (filters.event_type && filters.event_type !== eventType) continue;
        if (filters.instance && filters.instance !== instanceName) continue;

        if (filters.action) {
          const action = normalizedPayload?.action || normalizedPayload?.normalized?.action;
          if (action !== filters.action) continue;
        }

        matchingFlows.push(flow as Flow);
      }

      return matchingFlows;
    } catch (err: any) {
      console.error('❌ [FLOW EXECUTOR] Erro ao buscar flows:', err);
      return [];
    }
  }

  /**
   * Normaliza um groupJid para comparação, removendo diferenças de formato
   */
  private normalizeGroupJid(groupJid: string | null): string {
    if (!groupJid) return '';
    
    // Remove espaços
    let normalized = String(groupJid).trim();
    
    // Garante que tem o sufixo @g.us
    if (!normalized.includes('@')) {
      normalized = `${normalized}@g.us`;
    }
    
    return normalized;
  }

  /**
   * Gera variações de groupJid para busca flexível
   */
  private getGroupJidVariations(groupJid: string): string[] {
    const normalized = this.normalizeGroupJid(groupJid);
    const variations: string[] = [normalized];
    
    // Sem sufixo
    const withoutSuffix = normalized.replace('@g.us', '');
    if (withoutSuffix && !variations.includes(withoutSuffix)) {
      variations.push(withoutSuffix);
    }
    
    // Com sufixo (caso original não tenha)
    const withSuffix = normalized.includes('@g.us') ? normalized : `${normalized}@g.us`;
    if (!variations.includes(withSuffix)) {
      variations.push(withSuffix);
    }
    
    // Original sem modificação
    if (!variations.includes(groupJid)) {
      variations.push(groupJid);
    }
    
    return variations;
  }

  /**
   * Busca flow_instances (ativações por usuário) que correspondem a um evento
   * com instance + group. Usado para group-participants.update (ex.: boas-vindas).
   * Retorna { flow_id, user_id } para executar o flow no contexto de quem ativou.
   */
  async findMatchingFlowInstances(
    eventType: string,
    instanceName: string | null,
    groupJid: string | null,
    normalizedPayload: any
  ): Promise<Array<{ flow_id: string; user_id: string }>> {
    console.log('🔍 [FLOW EXECUTOR] findMatchingFlowInstances chamado:', {
      eventType,
      instanceName,
      groupJid,
      normalizedGroupJid: groupJid ? this.normalizeGroupJid(groupJid) : null,
    });

    if (!instanceName || !groupJid) {
      console.log('⚠️ [FLOW EXECUTOR] instanceName ou groupJid vazio, retornando []');
      return [];
    }

    try {
      // Gera variações do groupJid para busca flexível
      const groupJidVariations = this.getGroupJidVariations(groupJid);
      
      console.log('🔍 [FLOW EXECUTOR] Variações de groupJid para busca:', groupJidVariations);

      // Busca usando ilike para ser mais flexível
      let { data: instances, error } = await supabaseServiceRole
        .from('flow_instances')
        .select(`
          id,
          flow_id,
          user_id,
          instance_name,
          group_jid,
          is_active,
          flows:flow_id (
            id,
            status,
            graph_json
          )
        `)
        .eq('instance_name', instanceName)
        .in('group_jid', groupJidVariations)
        .eq('is_active', true);

      if (instances?.length) {
        console.log('🔍 [FLOW EXECUTOR] flow_instances encontradas:', instances.length);
      }

      // Se não encontrou, tenta busca mais ampla e compara manualmente
      if ((!instances || instances.length === 0) && !error) {
        
        // Busca todas as flow_instances ativas para essa instância
        const { data: allInstances } = await supabaseServiceRole
          .from('flow_instances')
          .select(`
            id,
            flow_id,
            user_id,
            instance_name,
            group_jid,
            is_active,
            flows:flow_id (
              id,
              status,
              graph_json
            )
          `)
          .eq('instance_name', instanceName)
          .eq('is_active', true);

        if (allInstances && allInstances.length > 0) {
          // Compara manualmente usando normalização
          const normalizedEventGroupJid = this.normalizeGroupJid(groupJid);
          const eventGroupJidBase = normalizedEventGroupJid.replace('@g.us', '');
          
          const manualMatches = allInstances.filter(fi => {
            const savedGroupJid = this.normalizeGroupJid(fi.group_jid);
            const savedGroupJidBase = savedGroupJid.replace('@g.us', '');
            
            // Compara com e sem sufixo
            const isMatch = 
              savedGroupJid === normalizedEventGroupJid ||
              savedGroupJidBase === eventGroupJidBase ||
              fi.group_jid === groupJid;
            
            return isMatch;
          });

          if (manualMatches.length > 0) {
            console.log(`✅ [FLOW EXECUTOR] ${manualMatches.length} match(es) encontrado(s) via comparação manual`);
            instances = manualMatches;
          }
        }
      }

      if (!instances || instances.length === 0) {
        console.warn(
          `⚠️ [FLOW EXECUTOR] flow_instance não encontrada instance=${instanceName} groupJid=${groupJid}`
        );
        return [];
      }

      if (error) {
        console.error('❌ [FLOW EXECUTOR] Erro na query flow_instances:', error);
        return [];
      }

      const action = normalizedPayload?.action ?? normalizedPayload?.normalized?.action ?? normalizedPayload?.data?.action;
      const result: Array<{ flow_id: string; user_id: string }> = [];

      for (const fi of instances) {
        const raw = (fi as any).flows;
        const flow = Array.isArray(raw) ? raw[0] : raw;

        if (!flow?.id) {
          console.log('⚠️ [FLOW EXECUTOR] Flow não encontrado para flow_instance:', fi.id);
          continue;
        }
        
        if (flow.status !== 'active') {
          console.log(`⚠️ [FLOW EXECUTOR] Flow ${flow.id} não está ativo (status: ${flow.status})`);
          continue;
        }

        const graph = flow.graph_json as FlowGraph;
        const triggerNode = graph?.nodes?.find((n: any) => n.type === 'webhookTrigger');
        
        if (!triggerNode) {
          console.log(`⚠️ [FLOW EXECUTOR] Flow ${flow.id} não tem triggerNode`);
          continue;
        }

        const filters = triggerNode.data?.config?.filters ?? {};

        if (filters.event_type && filters.event_type !== eventType) {
          console.log(`⚠️ [FLOW EXECUTOR] Flow ${flow.id} filtro event_type não corresponde: ${filters.event_type} !== ${eventType}`);
          continue;
        }
        
        // Verifica action se o filtro estiver configurado
        if (filters.action) {
          if (filters.action !== action) {
            console.log(`⚠️ [FLOW EXECUTOR] Flow ${flow.id} filtro action não corresponde: ${filters.action} !== ${action}`);
            continue;
          }
        }

        result.push({ flow_id: fi.flow_id, user_id: fi.user_id });
      }

      return result;
    } catch (err: any) {
      console.error('❌ [FLOW EXECUTOR] Erro ao buscar flow_instances:', err);
      return [];
    }
  }
}

export const flowExecutorService = new FlowExecutorService();

