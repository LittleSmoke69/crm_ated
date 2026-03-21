import { supabaseServiceRole } from './supabase-service';
import { llmService } from './llm-service';
import { extractGroupParticipantAction } from '@/lib/utils/group-participants-payload';
import { FlowTemplatesService } from './flow-templates-service';

export interface FlowNode {
  id: string;
  type: 'webhookTrigger' | 'switch' | 'condition' | 'randomPicker' | 'delay' | 'httpRequest' | 'sendMessage' | 'sendImage' | 'sendAudio' | 'sendVideo' | 'generateImage' | 'generateVideo' | 'waitVideo' | 'saveToDataset' | 'agentIA' | 'pergunta';
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
   * @param instanceSettings - Configurações personalizadas da flow_instance (mensagens customizadas, banca selecionada)
   */
  async executeFlow(flowId: string, eventId: string, userId: string, instanceSettings?: any): Promise<string | null> {
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

      // Cria execução com proteção atômica contra double-trigger.
      // Usa ON CONFLICT DO NOTHING: se já existe execução para (flow_id, trigger_event_id),
      // o INSERT é silenciosamente ignorado pelo banco — sem race condition.
      // Requer UNIQUE CONSTRAINT uq_flow_executions_flow_event (migration: add_flow_executions_dedup_constraint.sql).
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

      // PGRST116 = no rows returned (ON CONFLICT DO NOTHING suprimiu o INSERT — duplicata)
      if (execError?.code === 'PGRST116' || execError?.code === '23505') {
        const { data: existingExecution } = await supabaseServiceRole
          .from('flow_executions')
          .select('id')
          .eq('flow_id', flowId)
          .eq('trigger_event_id', eventId)
          .limit(1)
          .maybeSingle();
        console.log(`⚠️ [FLOW EXECUTOR] Execução duplicada ignorada (idempotência atômica) flow=${flowId} event=${eventId}`);
        return existingExecution?.id ?? null;
      }

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

        // Se a flow_instance tem uma banca específica selecionada, usa ela; senão usa a padrão
        const bancaName = instanceSettings?.selectedBanca || userInfo.banca || '';
        
        // Executa o flow percorrendo os nodes
        const executionContext: Record<string, any> = {
          __flowId: flowId,
          __executionId: execution.id,
          $json: jsonData,
          json: jsonData, // Adiciona também sem prefixo para facilitar acesso
          $normalized: normalizedData,
          normalized: normalizedData.normalized || normalizedData, // Adiciona também sem prefixo para facilitar acesso
          $userId: userId, // Adiciona userId para uso nas APIs de IA
          // Variáveis globais
          $global: {
            numero: userInfo.numero || '',
            banca: bancaName,
            nome: userInfo.nome || '',
          },
          global: {
            numero: userInfo.numero || '',
            banca: bancaName,
            nome: userInfo.nome || '',
          },
          // Configurações da flow_instance para personalização de nós
          $instanceSettings: instanceSettings || {},
          instanceSettings: instanceSettings || {},
        };

        const outputData = await this.executeNodes(
          execution.id,
          graph,
          triggerNode.id,
          executionContext
        );

        if (executionContext.__flowPaused) {
          await this.finishExecution(execution.id, 'paused', null, {
            pendingQuestionId: executionContext.__pendingQuestionId,
            reason: 'awaiting_question_reply',
          });
          console.log(`⏸️ [FLOW EXECUTOR] Execução ${execution.id} pausada aguardando resposta à pergunta`);
          return execution.id;
        }

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
   * Normaliza event_type para comparação (Evolution pode enviar GROUP_PARTICIPANTS_UPDATE,
   * enquanto o flow usa group-participants.update).
   */
  private normalizeEventTypeForComparison(eventType: string): string {
    if (!eventType || typeof eventType !== 'string') return '';
    return eventType
      .toLowerCase()
      .replace(/-/g, '.')
      .replace(/_/g, '.');
  }

  /**
   * Verifica se o evento corresponde aos filtros do trigger
   */
  private matchesTrigger(triggerNode: FlowNode, event: any, inputData: any): boolean {
    const config = triggerNode.data.config || {};
    const filters = config.filters || {};

    // Filtro por event_type (compara versões normalizadas: GROUP_PARTICIPANTS_UPDATE === group-participants.update)
    if (filters.event_type) {
      const eventNorm = this.normalizeEventTypeForComparison(event.event_type);
      const filterNorm = this.normalizeEventTypeForComparison(filters.event_type);
      if (eventNorm !== filterNorm) return false;
    }

    // Filtro por instance_name
    if (filters.instance && event.instance_name !== filters.instance) {
      return false;
    }

    // Filtro por action (payload normalizado + raw do evento Evolution; comparação case-insensitive)
    if (filters.action) {
      const action =
        this.resolvePath(inputData, 'normalized.action') ||
        this.resolvePath(inputData, 'action') ||
        this.resolvePath(inputData, 'data.action') ||
        this.resolvePath(inputData, 'data.update.action') ||
        this.resolvePath(inputData, '$normalized.action') ||
        this.resolvePath(inputData, '$json.data.action') ||
        this.resolvePath(inputData, '$json.action') ||
        extractGroupParticipantAction(event?.payload) ||
        extractGroupParticipantAction(inputData);
      const actionStr = action != null ? String(action).toLowerCase() : '';
      const filterActionStr = String(filters.action).toLowerCase();
      if (actionStr !== filterActionStr) return false;
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
      if (context.__stopExecution) {
        return context;
      }

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

        // Pergunta: envia mensagem e pausa até resposta ou timeout (retomada via webhook/cron)
        if (node.type === 'pergunta' && stepOutput?.awaitingReply) {
          context.__flowPaused = true;
          context.__pendingQuestionId = stepOutput.pendingId;
          context.__stopExecution = true;
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

      if (context.__stopExecution) {
        return context;
      }

      for (const edge of nextEdges) {
        // Para switch/condition/pergunta nodes, verifica se o output corresponde ao sourceHandle
        if ((node.type === 'switch' || node.type === 'condition' || node.type === 'pergunta') && edge.sourceHandle) {
          const nodeOutput = stepOutput?.output ?? stepOutput;
          if (nodeOutput !== edge.sourceHandle) {
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

      case 'condition':
        return await this.executeConditionNode(node, input, context);

      case 'randomPicker':
        return await this.executeRandomPickerNode(node, input, context);

      case 'delay':
        return await this.executeDelayNode(node, input, context);

      case 'httpRequest':
        return await this.executeHttpRequestNode(node, input, context);

      case 'sendMessage':
        return await this.executeSendMessageNode(node, input, context);

      case 'sendImage':
        return await this.executeSendImageNode(node, input, context);

      case 'sendAudio':
        return await this.executeSendAudioNode(node, input, context);

      case 'sendVideo':
        return await this.executeSendVideoNode(node, input, context);

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

      case 'pergunta':
        return await this.executePerguntaNode(node, input, context);

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
   * Executa node Condition (condição inline true/false)
   */
  private async executeConditionNode(
    node: FlowNode,
    _input: any,
    context: Record<string, any>
  ): Promise<any> {
    const config = node.data.config || {};
    const condition = config.condition || '';
    const result = this.evaluateCondition(condition, context);
    const output = result ? 'true' : 'false';
    return { result, output, condition };
  }

  /**
   * Executa node Delay (pausa N segundos)
   */
  private async executeDelayNode(
    node: FlowNode,
    _input: any,
    _context: Record<string, any>
  ): Promise<any> {
    const config = node.data.config || {};
    const seconds = Math.min(Math.max(Number(config.seconds) || 2, 0.5), 30); // entre 0.5s e 30s
    console.log(`⏱️ [FLOW EXECUTOR] Delay: aguardando ${seconds}s`);
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
    return { delayed: true, seconds };
  }

  /**
   * Executa node HTTP Request (chamada HTTP externa)
   */
  private async executeHttpRequestNode(
    node: FlowNode,
    _input: any,
    context: Record<string, any>
  ): Promise<any> {
    const config = node.data.config || {};

    const url = this.resolveVariables(config.url || '', context);
    const method = (config.method || 'GET').toUpperCase();
    const headersRaw: Record<string, string> = config.headers || {};
    const bodyTemplate: string = config.body || '';

    if (!url || url.includes('{{') || url.includes('$')) {
      throw new Error(`URL do HTTP Request não resolvida: ${url}`);
    }

    // Resolve variáveis nos headers e body
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    for (const [k, v] of Object.entries(headersRaw)) {
      headers[k] = this.resolveVariables(v, context);
    }

    const resolvedBody = bodyTemplate ? this.resolveVariables(bodyTemplate, context) : undefined;

    console.log(`🌐 [FLOW EXECUTOR] HTTP Request: ${method} ${url}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
      const fetchOptions: RequestInit = {
        method,
        headers,
        signal: controller.signal,
      };
      if (method !== 'GET' && method !== 'HEAD' && resolvedBody) {
        fetchOptions.body = resolvedBody;
      }

      const response = await fetch(url, fetchOptions);
      clearTimeout(timeoutId);

      let data: any = null;
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        data = await response.json().catch(() => null);
      } else {
        data = await response.text().catch(() => null);
      }

      console.log(`✅ [FLOW EXECUTOR] HTTP Request concluído: status=${response.status}`);
      return {
        status: response.status,
        ok: response.ok,
        data,
      };
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') throw new Error(`HTTP Request timeout: ${url}`);
      throw new Error(`HTTP Request falhou: ${err.message}`);
    }
  }

  /**
   * Executa node Random Picker
   * Suporta mensagens customizadas por slot e numberOfVariants (3 a 10) via instanceSettings
   */
  private async executeRandomPickerNode(
    node: FlowNode,
    input: any,
    context: Record<string, any>
  ): Promise<any> {
    const config = node.data.config || {};
    const allSystemMessages: string[] = config.messages || [];

    if (allSystemMessages.length === 0) {
      return { selected: null, error: 'Nenhuma mensagem configurada' };
    }

    const instanceSettings = context.$instanceSettings || context.instanceSettings || {};
    const customMessagesForNode: (string | null)[] | undefined = instanceSettings.customMessages?.[node.id];
    // Número de variações escolhido pelo usuário (3 a 10); usa no máximo o que o nó tem
    const nVariants = Math.min(
      10,
      Math.max(3, Number(instanceSettings.numberOfVariants) || 10),
      allSystemMessages.length
    );
    const systemMessages = allSystemMessages.slice(0, nVariants);

    // Mescla: slot customizado substitui sistema; null/vazio = usa sistema (apenas nos primeiros nVariants)
    const effectiveMessages = systemMessages.map((sysMsg: string, idx: number) => {
      const custom = customMessagesForNode?.[idx];
      return (custom !== null && custom !== undefined && custom.trim() !== '') ? custom : sysMsg;
    }).filter((m: string) => m && m.trim() !== '');

    if (effectiveMessages.length === 0) {
      return { selected: null, error: 'Nenhuma mensagem configurada' };
    }

    // Escolhe mensagem aleatória entre as mensagens efetivas
    const randomIndex = Math.floor(Math.random() * effectiveMessages.length);
    const selected = effectiveMessages[randomIndex];

    // Resolve variáveis na mensagem (ex: {{$json.normalized.phoneNumber}})
    const resolvedMessage = this.resolveVariables(selected, context);

    return { 
      selected: resolvedMessage, 
      index: randomIndex,
      message: resolvedMessage,
      original: selected
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
    
    /** `grupo` = padrão legado (automações em grupo). `direto` = só conversa 1:1 (campo número). */
    const destinationType = config.destination_type === 'direto' ? 'direto' : 'grupo';

    let groupJid = '';
    let message = this.resolveVariables(config.message || '', context);
    let number = this.resolveVariables(config.number || '', context);

    const rawMessageConfigured = (config.message ?? '').toString().trim();
    if (!rawMessageConfigured) {
      throw new Error(
        'Configure o texto da mensagem no nó Enviar Mensagem (texto, variáveis ou ambos — o campo não pode ficar vazio).'
      );
    }

    const resolvePhoneFromContext = (): string =>
      this.resolvePath(context, 'json.data.participants[0].phoneNumber') ||
      this.resolvePath(context, '$json.data.participants[0].phoneNumber') ||
      this.resolvePath(context, 'json.data.participants.0.phoneNumber') ||
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

    if (destinationType === 'grupo') {
      groupJid = this.resolveVariables(config.group_jid || '', context);

      // Se groupJid ainda contém variáveis não resolvidas, tenta buscar do contexto normalizado
      if (!groupJid || groupJid.includes('{{') || groupJid.includes('$')) {
        groupJid =
          this.resolvePath(context, 'json.data.id') ||
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

      if (!number || number.includes('{{') || number.includes('$')) {
        number = resolvePhoneFromContext();
      }
    } else {
      // Direto: destinatário = apenas número/JID de contato (não usa grupo do evento)
      if (!number || number.includes('{{') || number.includes('$')) {
        number = resolvePhoneFromContext();
      }
      groupJid = '';
    }

    // Log detalhado do contexto para debug
    console.log(`🔍 [FLOW EXECUTOR] Debug - Contexto completo:`, {
      nodeId: node.id,
      config: {
        instance_name: config.instance_name,
        destination_type: destinationType,
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

    // Valida se ainda há placeholders {{...}} não resolvidos (resolveVariables devolve o match original).
    // NÃO usar includes('$'): texto livre com "R$", "$5" etc. é válido após resolução.
    let finalMessage = message;
    if (!message || this.hasUnresolvedTemplateVariables(message)) {
      const retryMessage = this.resolveVariables(message, context);
      if (retryMessage && !this.hasUnresolvedTemplateVariables(retryMessage)) {
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

    // Valida destinatário conforme o modo (grupo vs direto)
    if (destinationType === 'direto') {
      if (!number || number.includes('{{') || number.includes('$')) {
        throw new Error(
          `Envio direto: informe o número ou JID do contato (campo "Número / JID") e resolva as variáveis. Valor atual: ${number || 'vazio'}`
        );
      }
    } else if (
      (!groupJid || groupJid.includes('{{') || groupJid.includes('$')) &&
      (!number || number.includes('{{') || number.includes('$'))
    ) {
      throw new Error(
        `Group JID ou Number devem ser fornecidos e resolvidos. GroupJid: ${groupJid || 'não fornecido'}, Number: ${number || 'não fornecido'}`
      );
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
    
    // Grupo: prioriza group JID; direto: só número/JID de contato
    const recipient =
      destinationType === 'direto' ? number || '' : groupJid || number || '';
    
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
        destinationType,
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
   * Serializa contexto para retomar após resposta/timeout (sem flags de controle da execução atual).
   */
  private serializeContextForSnapshot(context: Record<string, any>): Record<string, any> {
    const skip = new Set(['__stopExecution', '__flowPaused', '__pendingQuestionId']);
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(context)) {
      if (skip.has(k)) continue;
      try {
        out[k] = JSON.parse(JSON.stringify(v));
      } catch {
        /* ignora não serializável */
      }
    }
    return out;
  }

  /**
   * Nó Pergunta: envia texto no WhatsApp e pausa o flow até resposta do usuário ou timeout.
   * Saídas no grafo: sourceHandle `resposta` | `tempo_esgotado`.
   */
  private async executePerguntaNode(
    node: FlowNode,
    input: any,
    context: Record<string, any>
  ): Promise<any> {
    const config = node.data.config || {};
    const delaySeconds = Math.min(Math.max(Number(config.delay_seconds) || 0, 0), 120);
    if (delaySeconds > 0) {
      console.log(`⏱️ [FLOW EXECUTOR] Pergunta: atraso ${delaySeconds}s antes de enviar`);
      await new Promise((r) => setTimeout(r, delaySeconds * 1000));
    }

    const questionRaw = (config.question_text ?? config.message ?? '').toString();
    let resolvedQuestion = this.resolveVariables(questionRaw, context);
    if (this.hasUnresolvedTemplateVariables(resolvedQuestion)) {
      const retry = this.resolveVariables(resolvedQuestion, context);
      if (retry && !this.hasUnresolvedTemplateVariables(retry)) {
        resolvedQuestion = retry;
      } else {
        throw new Error(`Texto da pergunta contém variáveis não resolvidas: ${resolvedQuestion}`);
      }
    }
    if (!resolvedQuestion?.trim()) {
      throw new Error('Pergunta: preencha o texto da pergunta');
    }

    const sendNode: FlowNode = {
      ...node,
      type: 'sendMessage',
      data: {
        ...node.data,
        config: {
          instance_name: config.instance_name,
          group_jid: config.group_jid,
          number: config.number,
          message: resolvedQuestion,
          mentioned: config.mentioned,
        },
      },
    };

    await this.executeSendMessageNode(sendNode, input, context);

    const unit = config.unit === 'minutes' ? 'minutes' : 'seconds';
    const limitVal = Math.max(Number(config.limit_value) || 5, 1);
    const timeoutMs = unit === 'minutes' ? limitVal * 60_000 : limitVal * 1000;
    const maxMs = 24 * 60 * 60 * 1000;
    const expiresAt = new Date(Date.now() + Math.min(timeoutMs, maxMs));

    let instanceNameResolved = this.resolveVariables(config.instance_name || '', context);
    if (!instanceNameResolved || instanceNameResolved.includes('{{')) {
      instanceNameResolved =
        this.resolvePath(context, 'normalized.instanceName') ||
        this.resolvePath(context, '$json.normalized.instanceName') ||
        this.resolvePath(context, '$json.instance') ||
        instanceNameResolved;
    }

    const groupJid = this.resolveVariables(config.group_jid || '', context);
    const recipient = groupJid || this.resolveVariables(config.number || '', context) || '';

    const snapshot = this.serializeContextForSnapshot(context);
    const flowId = context.__flowId;
    const executionId = context.__executionId;
    if (!flowId || !executionId) {
      throw new Error('Pergunta: contexto interno incompleto (__flowId / __executionId)');
    }

    const { data: pendingRow, error: insErr } = await supabaseServiceRole
      .from('flow_question_pending')
      .insert({
        flow_id: flowId,
        user_id: String(context.$userId || ''),
        node_id: node.id,
        execution_id: executionId,
        instance_name: instanceNameResolved || null,
        remote_jid: String(recipient).trim(),
        question_text: resolvedQuestion,
        context_snapshot: snapshot,
        status: 'waiting',
        expires_at: expiresAt.toISOString(),
      })
      .select('id')
      .single();

    if (insErr || !pendingRow) {
      console.error('❌ [FLOW EXECUTOR] Erro ao salvar flow_question_pending:', insErr);
      throw new Error(`Pergunta: não foi possível registrar espera de resposta: ${insErr?.message || 'unknown'}`);
    }

    console.log(`❓ [FLOW EXECUTOR] Pergunta enviada; aguardando resposta até ${expiresAt.toISOString()} (pending=${pendingRow.id})`);

    return {
      awaitingReply: true,
      pendingId: pendingRow.id,
      question: resolvedQuestion,
      expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * Helper: busca credenciais da instância Evolution no Supabase
   */
  private async fetchInstanceCredentials(instanceName: string): Promise<{ apikey: string; baseUrl: string; instance: any }> {
    const { data: instance, error } = await supabaseServiceRole
      .from('evolution_instances')
      .select(`*, evolution_apis (id, base_url, api_key_global)`)
      .eq('instance_name', instanceName)
      .eq('is_active', true)
      .single();

    if (error || !instance) throw new Error(`Instância ${instanceName} não encontrada ou inativa`);
    if (!instance.is_master) throw new Error(`Apenas instâncias mestre podem ser usadas em automações. A instância ${instanceName} não é mestre.`);
    if (instance.status !== 'ok') throw new Error(`Instância ${instanceName} deve estar conectada (status: ok). Status atual: ${instance.status}`);

    const evolutionApi = Array.isArray(instance.evolution_apis) ? instance.evolution_apis[0] : instance.evolution_apis;
    if (!evolutionApi?.base_url) throw new Error(`Evolution API não configurada para instância ${instanceName}`);

    const { data: instData } = await supabaseServiceRole.from('evolution_instances').select('apikey').eq('id', instance.id).single();
    const apikey = instData?.apikey || evolutionApi.api_key_global;
    if (!apikey) throw new Error(`API key não encontrada para instância ${instanceName}`);

    const baseUrl = evolutionApi.base_url.replace(/\/+$/, '').replace(/([^:]\/)\/+/g, '$1');
    return { apikey, baseUrl, instance };
  }

  /**
   * Executa node Send Image
   */
  private async executeSendImageNode(node: FlowNode, _input: any, context: Record<string, any>): Promise<any> {
    const config = node.data.config || {};
    const destinationType = config.destination_type === 'direto' ? 'direto' : 'grupo';

    let instanceName = this.resolveVariables(config.instance_name || '', context);
    let groupJid = '';
    let number = this.resolveVariables(config.number || '', context);
    const imageUrl = this.resolveVariables(config.image_url || '', context);
    const caption = config.caption ? this.resolveVariables(config.caption, context) : undefined;

    if (!instanceName || instanceName.includes('{{') || instanceName.includes('$')) {
      instanceName = this.resolvePath(context, 'normalized.instanceName') || this.resolvePath(context, '$json.normalized.instanceName') || instanceName;
    }

    const resolvePhone = () =>
      this.resolvePath(context, '$json.data.participants[0].phoneNumber') ||
      this.resolvePath(context, 'normalized.phoneNumber') ||
      this.resolvePath(context, '$json.normalized.phoneNumber') ||
      '';

    if (destinationType === 'grupo') {
      groupJid = this.resolveVariables(config.group_jid || '', context);
      if (!groupJid || groupJid.includes('{{') || groupJid.includes('$')) {
        groupJid = this.resolvePath(context, '$json.data.id') || this.resolvePath(context, 'normalized.groupId') || this.resolvePath(context, '$json.normalized.groupId') || '';
      }
      if (!number || number.includes('{{') || number.includes('$')) {
        number = resolvePhone();
      }
    } else {
      if (!number || number.includes('{{') || number.includes('$')) {
        number = resolvePhone();
      }
    }

    if (!instanceName || instanceName.includes('{{') || instanceName.includes('$')) {
      throw new Error(`Instance name não resolvido: ${instanceName}`);
    }
    if (!imageUrl || imageUrl.includes('{{') || imageUrl.includes('$')) {
      throw new Error(`URL da imagem não resolvida: ${imageUrl}`);
    }
    const recipient = destinationType === 'direto' ? number : groupJid || number;
    if (!recipient || recipient.includes('{{') || recipient.includes('$')) {
      throw new Error(`Recipient (group_jid/number) não resolvido: ${recipient || 'vazio'}`);
    }

    const { apikey, baseUrl } = await this.fetchInstanceCredentials(instanceName);
    const url = `${baseUrl}/message/sendMedia/${instanceName}`;

    const ext = imageUrl.split('?')[0].split('.').pop()?.toLowerCase() || 'jpg';
    const mimeMap: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
    const mimetype = mimeMap[ext] || 'image/jpeg';

    const body = { number: recipient, mediatype: 'image', mimetype, media: imageUrl, fileName: `image.${ext}`, ...(caption ? { caption } : {}) };

    console.log(`📤 [FLOW EXECUTOR] sendImage request:`, JSON.stringify({ url, body }, null, 2));

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey },
      body: JSON.stringify(body),
    });
    const responseData = await response.json().catch(() => ({ message: 'Erro ao parsear resposta' }));

    if (!response.ok) {
      const msg = responseData.message ?? responseData.error ?? `HTTP ${response.status}`;
      throw new Error(`Erro ao enviar imagem: ${Array.isArray(msg) ? msg.join('; ') : msg}`);
    }

    console.log(`✅ [FLOW EXECUTOR] Imagem enviada com sucesso`);
    return { success: true, messageId: responseData.key?.id, response: responseData };
  }

  /**
   * Executa node Send Audio
   */
  private async executeSendAudioNode(node: FlowNode, _input: any, context: Record<string, any>): Promise<any> {
    const config = node.data.config || {};
    const destinationType = config.destination_type === 'direto' ? 'direto' : 'grupo';

    let instanceName = this.resolveVariables(config.instance_name || '', context);
    let groupJid = '';
    let number = this.resolveVariables(config.number || '', context);
    const audioUrl = this.resolveVariables(config.audio_url || '', context);
    const ptt = config.ptt !== false; // default true

    if (!instanceName || instanceName.includes('{{') || instanceName.includes('$')) {
      instanceName = this.resolvePath(context, 'normalized.instanceName') || this.resolvePath(context, '$json.normalized.instanceName') || instanceName;
    }

    const resolvePhone = () =>
      this.resolvePath(context, '$json.data.participants[0].phoneNumber') ||
      this.resolvePath(context, 'normalized.phoneNumber') ||
      this.resolvePath(context, '$json.normalized.phoneNumber') ||
      '';

    if (destinationType === 'grupo') {
      groupJid = this.resolveVariables(config.group_jid || '', context);
      if (!groupJid || groupJid.includes('{{') || groupJid.includes('$')) {
        groupJid = this.resolvePath(context, '$json.data.id') || this.resolvePath(context, 'normalized.groupId') || this.resolvePath(context, '$json.normalized.groupId') || '';
      }
      if (!number || number.includes('{{') || number.includes('$')) {
        number = resolvePhone();
      }
    } else {
      if (!number || number.includes('{{') || number.includes('$')) {
        number = resolvePhone();
      }
    }

    if (!instanceName || instanceName.includes('{{') || instanceName.includes('$')) {
      throw new Error(`Instance name não resolvido: ${instanceName}`);
    }
    if (!audioUrl || audioUrl.includes('{{') || audioUrl.includes('$')) {
      throw new Error(`URL do áudio não resolvida: ${audioUrl}`);
    }
    const recipient = destinationType === 'direto' ? number : groupJid || number;
    if (!recipient || recipient.includes('{{') || recipient.includes('$')) {
      throw new Error(`Recipient (group_jid/number) não resolvido: ${recipient || 'vazio'}`);
    }

    const { apikey, baseUrl } = await this.fetchInstanceCredentials(instanceName);

    let url: string;
    let body: Record<string, any>;

    if (ptt) {
      url = `${baseUrl}/message/sendWhatsAppAudio/${instanceName}`;
      body = { number: recipient, audio: audioUrl };
    } else {
      url = `${baseUrl}/message/sendMedia/${instanceName}`;
      const ext = audioUrl.split('?')[0].split('.').pop()?.toLowerCase() || 'mp3';
      const mimeMap: Record<string, string> = { mp3: 'audio/mpeg', ogg: 'audio/ogg', m4a: 'audio/mp4', wav: 'audio/wav' };
      const mimetype = mimeMap[ext] || 'audio/mpeg';
      body = { number: recipient, mediatype: 'audio', mimetype, media: audioUrl, fileName: `audio.${ext}` };
    }

    console.log(`📤 [FLOW EXECUTOR] sendAudio request (ptt=${ptt}):`, JSON.stringify({ url, body }, null, 2));

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey },
      body: JSON.stringify(body),
    });
    const responseData = await response.json().catch(() => ({ message: 'Erro ao parsear resposta' }));

    if (!response.ok) {
      const msg = responseData.message ?? responseData.error ?? `HTTP ${response.status}`;
      throw new Error(`Erro ao enviar áudio: ${Array.isArray(msg) ? msg.join('; ') : msg}`);
    }

    console.log(`✅ [FLOW EXECUTOR] Áudio enviado com sucesso`);
    return { success: true, messageId: responseData.key?.id, response: responseData };
  }

  /**
   * Executa node Send Video
   */
  private async executeSendVideoNode(node: FlowNode, _input: any, context: Record<string, any>): Promise<any> {
    const config = node.data.config || {};
    const destinationType = config.destination_type === 'direto' ? 'direto' : 'grupo';

    let instanceName = this.resolveVariables(config.instance_name || '', context);
    let groupJid = '';
    let number = this.resolveVariables(config.number || '', context);
    const videoUrl = this.resolveVariables(config.video_url || '', context);
    const caption = config.caption ? this.resolveVariables(config.caption, context) : undefined;

    if (!instanceName || instanceName.includes('{{') || instanceName.includes('$')) {
      instanceName = this.resolvePath(context, 'normalized.instanceName') || this.resolvePath(context, '$json.normalized.instanceName') || instanceName;
    }

    const resolvePhone = () =>
      this.resolvePath(context, '$json.data.participants[0].phoneNumber') ||
      this.resolvePath(context, 'normalized.phoneNumber') ||
      this.resolvePath(context, '$json.normalized.phoneNumber') ||
      '';

    if (destinationType === 'grupo') {
      groupJid = this.resolveVariables(config.group_jid || '', context);
      if (!groupJid || groupJid.includes('{{') || groupJid.includes('$')) {
        groupJid = this.resolvePath(context, '$json.data.id') || this.resolvePath(context, 'normalized.groupId') || this.resolvePath(context, '$json.normalized.groupId') || '';
      }
      if (!number || number.includes('{{') || number.includes('$')) {
        number = resolvePhone();
      }
    } else {
      if (!number || number.includes('{{') || number.includes('$')) {
        number = resolvePhone();
      }
    }

    if (!instanceName || instanceName.includes('{{') || instanceName.includes('$')) {
      throw new Error(`Instance name não resolvido: ${instanceName}`);
    }
    if (!videoUrl || videoUrl.includes('{{') || videoUrl.includes('$')) {
      throw new Error(`URL do vídeo não resolvida: ${videoUrl}`);
    }
    const recipient = destinationType === 'direto' ? number : groupJid || number;
    if (!recipient || recipient.includes('{{') || recipient.includes('$')) {
      throw new Error(`Recipient (group_jid/number) não resolvido: ${recipient || 'vazio'}`);
    }

    const { apikey, baseUrl } = await this.fetchInstanceCredentials(instanceName);
    const url = `${baseUrl}/message/sendMedia/${instanceName}`;

    const ext = videoUrl.split('?')[0].split('.').pop()?.toLowerCase() || 'mp4';
    const mimeMap: Record<string, string> = { mp4: 'video/mp4', avi: 'video/x-msvideo', mov: 'video/quicktime', mkv: 'video/x-matroska' };
    const mimetype = mimeMap[ext] || 'video/mp4';

    const body = { number: recipient, mediatype: 'video', mimetype, media: videoUrl, fileName: `video.${ext}`, ...(caption ? { caption } : {}) };

    console.log(`📤 [FLOW EXECUTOR] sendVideo request:`, JSON.stringify({ url, body }, null, 2));

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey },
      body: JSON.stringify(body),
    });
    const responseData = await response.json().catch(() => ({ message: 'Erro ao parsear resposta' }));

    if (!response.ok) {
      const msg = responseData.message ?? responseData.error ?? `HTTP ${response.status}`;
      throw new Error(`Erro ao enviar vídeo: ${Array.isArray(msg) ? msg.join('; ') : msg}`);
    }

    console.log(`✅ [FLOW EXECUTOR] Vídeo enviado com sucesso`);
    return { success: true, messageId: responseData.key?.id, response: responseData };
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

    // 3) Carrega histórico de conversa (memória multi-turn)
    let conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    try {
      const { data: memberData } = await supabaseServiceRole
        .from('whatsapp_group_agent_members')
        .select('conversation_history')
        .eq('group_jid', groupJid)
        .eq('user_phone', userPhone || '')
        .maybeSingle();

      if (memberData?.conversation_history && Array.isArray(memberData.conversation_history)) {
        // Mantém as últimas 10 trocas (20 mensagens) para não explodir o contexto
        conversationHistory = (memberData.conversation_history as any[]).slice(-20);
      }
    } catch {
      // Coluna pode não existir ainda — continua sem histórico
    }

    // 4) Compõe prompt final com persona + contexto do usuário
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

    // Contexto do usuário injetado no prompt
    const nomeUsuario = context.$global?.nome || context.global?.nome || null;
    const bancaNome = context.$global?.banca || context.global?.banca || null;
    const phoneDisplay = userPhone ? String(userPhone).replace(/\D/g, '').replace(/@.*/, '') : null;
    const userContextLines: string[] = [];
    if (phoneDisplay) userContextLines.push(`Telefone do usuário: ${phoneDisplay}`);
    if (nomeUsuario) userContextLines.push(`Nome da banca/loja: ${nomeUsuario}`);
    if (bancaNome) userContextLines.push(`Nome da banca: ${bancaNome}`);

    const userContextBlock = userContextLines.length > 0
      ? `\nContexto do usuário:\n${userContextLines.join('\n')}`
      : '';

    const finalSystemPrompt = `${systemPrompt}

${tonePrompts[personaTone] || tonePrompts.gentil}

${rolePrompts[personaRole] || rolePrompts.consultor}

Objetivo principal: ${objective}${userContextBlock}

REGRAS ANTI-SPAM (OBRIGATÓRIO):
- Você só responde se a mensagem for claramente uma PERGUNTA, ou contiver palavras-chave de intenção, ou mencionar o suporte/agente.
- Se não for pergunta (ex: "ok", "bom dia", "todos", conversa solta), você NÃO responde.
- Você deve ser curto, direto, e sempre finalizar com uma pergunta simples para avançar.
- No máximo 1 resposta por vez, sem textos longos.`;

    // 5) Gera resposta usando LLM com histórico de conversa
    const userId = context.$userId || '';
    const tenantId = userId;

    // Monta mensagens: system + histórico + mensagem atual
    const llmMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: finalSystemPrompt },
      ...conversationHistory,
      { role: 'user', content: userMessage },
    ];

    let llmResponse;
    try {
      llmResponse = await llmService.generate({
        tenantId,
        messages: llmMessages,
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

      // 6b) Salva histórico de conversa (memória multi-turn)
      try {
        const updatedHistory = [
          ...conversationHistory,
          { role: 'user' as const, content: userMessage },
          { role: 'assistant' as const, content: agentResponse },
        ].slice(-20); // mantém as últimas 20 mensagens

        await supabaseServiceRole
          .from('whatsapp_group_agent_members')
          .upsert({
            group_jid: groupJid,
            user_phone: userPhone || '',
            conversation_history: updatedHistory,
            last_bot_reply_at: new Date().toISOString(),
          }, { onConflict: 'group_jid,user_phone', ignoreDuplicates: false });
      } catch {
        // Coluna pode não existir ainda — ignora silenciosamente
      }

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
   * Indica se ainda existem placeholders {{ ... }} não substituídos pelo resolveVariables.
   */
  private hasUnresolvedTemplateVariables(s: string): boolean {
    return typeof s === 'string' && s.includes('{{');
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

      if (trimmedPath === '$question.reply' || trimmedPath === 'question.reply') {
        const r = context.$question?.reply;
        return r !== undefined && r !== null ? String(r) : '';
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
    status: 'success' | 'failed' | 'cancelled' | 'paused',
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

        // Verifica filtros (event_type com mesma normalização que matchesTrigger / findMatchingFlowInstances)
        if (filters.event_type) {
          const eventNorm = this.normalizeEventTypeForComparison(eventType);
          const filterNorm = this.normalizeEventTypeForComparison(filters.event_type);
          if (eventNorm !== filterNorm) continue;
        }
        if (filters.instance && filters.instance !== instanceName) continue;

        if (filters.action) {
          const action =
            normalizedPayload?.action ||
            normalizedPayload?.normalized?.action ||
            normalizedPayload?.data?.action ||
            normalizedPayload?.data?.update?.action ||
            extractGroupParticipantAction(normalizedPayload);
          const actionStr = action != null ? String(action).toLowerCase() : '';
          const filterActionStr = String(filters.action).toLowerCase();
          if (actionStr !== filterActionStr) continue;
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
   * Retorna { flow_id, user_id, settings_json } para executar o flow no contexto de quem ativou.
   */
  async findMatchingFlowInstances(
    eventType: string,
    instanceName: string | null,
    groupJid: string | null,
    normalizedPayload: any
  ): Promise<Array<{ flow_id: string; user_id: string; settings_json?: any }>> {
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
          settings_json,
          flows:flow_id (
            id,
            name,
            type,
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
            settings_json,
            flows:flow_id (
              id,
              name,
              type,
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

      const action =
        normalizedPayload?.action ??
        normalizedPayload?.normalized?.action ??
        normalizedPayload?.data?.action ??
        normalizedPayload?.data?.update?.action ??
        extractGroupParticipantAction(normalizedPayload);

      const result: Array<{ flow_id: string; user_id: string; settings_json?: any }> = [];
      const seenFlowIds = new Set<string>();
      let welcomeBoasVindasScheduled = false;

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

        // Compara event_type normalizado (Evolution: GROUP_PARTICIPANTS_UPDATE vs template: group-participants.update)
        if (filters.event_type) {
          const eventNorm = this.normalizeEventTypeForComparison(eventType);
          const filterNorm = this.normalizeEventTypeForComparison(filters.event_type);
          if (eventNorm !== filterNorm) {
            console.log(`⚠️ [FLOW EXECUTOR] Flow ${flow.id} filtro event_type não corresponde: ${filters.event_type} !== ${eventType}`);
            continue;
          }
        }

        // Verifica action se o filtro estiver configurado (normaliza para string para comparação)
        if (filters.action) {
          const actionStr = action != null ? String(action).toLowerCase() : '';
          const filterActionStr = String(filters.action).toLowerCase();
          if (actionStr !== filterActionStr) {
            console.log(`⚠️ [FLOW EXECUTOR] Flow ${flow.id} filtro action não corresponde: ${filters.action} !== ${action}`);
            continue;
          }
        }

        // Gatilho group-participants sem filtro de action: não executar em remove (evita automações “neutras” dispararem na saída)
        const evtNorm = this.normalizeEventTypeForComparison(eventType);
        const isGroupParticipantsEvt =
          evtNorm === 'group.participants.update' ||
          String(eventType || '').toLowerCase().includes('participants');
        if (isGroupParticipantsEvt && !filters.action) {
          const actionStr = action != null ? String(action).toLowerCase() : '';
          if (actionStr === 'remove' || actionStr === 'leave') {
            console.log(
              `⚠️ [FLOW EXECUTOR] Flow ${flow.id} ignorado: evento de participante sem filtro action e action=${actionStr}`,
            );
            continue;
          }
        }

        if (seenFlowIds.has(fi.flow_id)) {
          continue;
        }

        const flowName = (flow as Flow).name;
        const isWelcomeTemplateFlow =
          flowName === FlowTemplatesService.WELCOME_TEMPLATE_NAME &&
          String(filters.action || '').toLowerCase() === 'add';
        if (isWelcomeTemplateFlow) {
          if (welcomeBoasVindasScheduled) {
            console.log(
              `⚠️ [FLOW EXECUTOR] Ignorando boas-vindas duplicada no mesmo grupo (flow ${flow.id}); mantendo apenas uma execução por evento`,
            );
            continue;
          }
          welcomeBoasVindasScheduled = true;
        }

        seenFlowIds.add(fi.flow_id);
        result.push({
          flow_id: fi.flow_id,
          user_id: fi.user_id,
          settings_json: (fi as any).settings_json || {},
        });
      }

      return result;
    } catch (err: any) {
      console.error('❌ [FLOW EXECUTOR] Erro ao buscar flow_instances:', err);
      return [];
    }
  }

  /**
   * Retoma o grafo a partir da edge `resposta` ou `tempo_esgotado` do nó pergunta.
   */
  async resumeContinuationFromPending(
    pendingId: string,
    branch: 'resposta' | 'tempo_esgotado',
    resumeEventId: string | null,
    replyText?: string
  ): Promise<string | null> {
    try {
      const { data: pending, error: pErr } = await supabaseServiceRole
        .from('flow_question_pending')
        .select('*')
        .eq('id', pendingId)
        .eq('status', 'waiting')
        .maybeSingle();

      if (pErr || !pending) {
        return null;
      }

      const sourceHandle = branch === 'resposta' ? 'resposta' : 'tempo_esgotado';

      const { data: flow } = await supabaseServiceRole.from('flows').select('*').eq('id', pending.flow_id).single();
      if (!flow || flow.status !== 'active') {
        return null;
      }

      const graph = flow.graph_json as FlowGraph;
      const edge = graph.edges.find((e) => e.source === pending.node_id && e.sourceHandle === sourceHandle);
      if (!edge) {
        console.error(`❌ [FLOW EXECUTOR] Edge "${sourceHandle}" não encontrada a partir do nó ${pending.node_id}`);
        return null;
      }

      let inputData: any = { resumed: true, branch };
      let ev: any = null;
      if (resumeEventId) {
        const { data: evRow } = await supabaseServiceRole.from('evolution_webhook_events').select('*').eq('id', resumeEventId).single();
        ev = evRow;
        if (ev) {
          inputData = ev.payload_normalized || ev.payload || inputData;
        }
      }

      const userId = pending.user_id;
      const userInfo = await this.getUserInfoForVariables(userId);

      const base = (pending.context_snapshot as Record<string, any>) || {};
      const executionContext: Record<string, any> = {
        ...base,
        __flowId: pending.flow_id,
        __executionId: undefined,
        $userId: userId,
        $global: {
          ...(base.$global || {}),
          numero: userInfo.numero || base.$global?.numero || '',
          banca: userInfo.banca || base.$global?.banca || '',
          nome: userInfo.nome || base.$global?.nome || '',
        },
        global: {
          ...(base.global || {}),
          numero: userInfo.numero || base.global?.numero || '',
          banca: userInfo.banca || base.global?.banca || '',
          nome: userInfo.nome || base.global?.nome || '',
        },
        $question: {
          reply: replyText ?? '',
          branch: sourceHandle,
        },
      };
      delete executionContext.__stopExecution;
      delete executionContext.__flowPaused;
      delete executionContext.__pendingQuestionId;

      executionContext[`pergunta_${pending.node_id}`] = {
        output: sourceHandle,
        replyText: replyText ?? '',
        branch,
      };

      if (resumeEventId && inputData && typeof inputData === 'object') {
        executionContext.$json = { ...base.$json, ...inputData, data: inputData.data ?? base.$json?.data };
        executionContext.json = executionContext.$json;
      }

      if (resumeEventId) {
        const { data: existingExec } = await supabaseServiceRole
          .from('flow_executions')
          .select('id')
          .eq('flow_id', pending.flow_id)
          .eq('trigger_event_id', resumeEventId)
          .maybeSingle();
        if (existingExec) {
          console.log(`⚠️ [FLOW EXECUTOR] Retomada já processada para evento ${resumeEventId}`);
          return existingExec.id;
        }
      }

      const { data: execution, error: execError } = await supabaseServiceRole
        .from('flow_executions')
        .insert({
          flow_id: pending.flow_id,
          trigger_event_id: resumeEventId,
          status: 'running',
          input_data: inputData,
          user_id: userId,
          env: ev?.env === 'test' ? 'test' : 'prod',
          instance_name: ev?.instance_name || pending.instance_name || null,
        })
        .select()
        .single();

      if (execError || !execution) {
        console.error('❌ [FLOW EXECUTOR] Erro ao criar execução de retomada:', execError);
        return null;
      }

      executionContext.__executionId = execution.id;

      const outputData = await this.executeNodes(execution.id, graph, edge.target, executionContext);

      await supabaseServiceRole
        .from('flow_question_pending')
        .update({
          status: branch === 'resposta' ? 'answered' : 'timed_out',
          answer_text: replyText ?? null,
          answer_event_id: resumeEventId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', pendingId);

      if (executionContext.__flowPaused) {
        await this.finishExecution(execution.id, 'paused', null, {
          pendingQuestionId: executionContext.__pendingQuestionId,
          reason: 'awaiting_question_reply',
        });
        return execution.id;
      }

      await this.finishExecution(execution.id, 'success', null, outputData);
      console.log(`✅ [FLOW EXECUTOR] Retomada ${execution.id} concluída (branch=${branch})`);
      return execution.id;
    } catch (err: any) {
      console.error('❌ [FLOW EXECUTOR] resumeContinuationFromPending:', err);
      return null;
    }
  }

  /**
   * Tenta retomar flow pausado em pergunta quando chega um evento de mensagem (Evolution).
   */
  async tryResumePendingQuestionFromWebhookEvent(eventId: string): Promise<boolean> {
    try {
      const { data: ev, error } = await supabaseServiceRole.from('evolution_webhook_events').select('*').eq('id', eventId).single();
      if (error || !ev) return false;

      const eventType = String(ev.event_type || '').toLowerCase();
      if (!eventType.includes('message') && !eventType.includes('upsert')) {
        return false;
      }

      const payload = ev.payload || {};
      const d = payload.data || payload;
      if (d?.key?.fromMe === true || payload?.data?.key?.fromMe === true) {
        return false;
      }

      const key = d?.key || d?.message?.key;
      const remoteJid = key?.remoteJid ? String(key.remoteJid) : null;
      if (!remoteJid) return false;

      const msg = d?.message || payload.message;
      const text =
        (msg?.conversation as string) ||
        (msg?.extendedTextMessage?.text as string) ||
        (msg?.imageMessage?.caption as string) ||
        '';
      if (!String(text).trim()) return false;

      const instanceName = ev.instance_name ? String(ev.instance_name) : null;

      const { data: pendings } = await supabaseServiceRole
        .from('flow_question_pending')
        .select('*')
        .eq('status', 'waiting')
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: true });

      if (!pendings?.length) return false;

      const norm = (j: string) => j.split('@')[0].replace(/\D/g, '');
      const remoteNorm = norm(remoteJid);

      const match = pendings.find((p: any) => {
        if (instanceName && p.instance_name && String(p.instance_name) !== instanceName) return false;
        const pr = String(p.remote_jid || '');
        return pr === remoteJid || norm(pr) === remoteNorm;
      });

      if (!match) return false;

      await this.resumeContinuationFromPending(match.id, 'resposta', eventId, String(text).trim());
      return true;
    } catch (err: any) {
      console.error('❌ [FLOW EXECUTOR] tryResumePendingQuestionFromWebhookEvent:', err);
      return false;
    }
  }

  /**
   * Processa pendências expiradas (tempo esgotado). Chamar via cron.
   */
  async processExpiredQuestionPendings(): Promise<number> {
    const { data: rows } = await supabaseServiceRole
      .from('flow_question_pending')
      .select('id')
      .eq('status', 'waiting')
      .lt('expires_at', new Date().toISOString());

    let n = 0;
    for (const row of rows || []) {
      const id = await this.resumeContinuationFromPending(row.id, 'tempo_esgotado', null, undefined);
      if (id) n += 1;
    }
    return n;
  }
}

export const flowExecutorService = new FlowExecutorService();

