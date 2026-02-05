import { supabaseServiceRole } from './supabase-service';
import { encryptionService } from './encryption-service';

export interface LLMProvider {
  id: string;
  tenant_id: string;
  provider: 'gemini' | 'openai' | 'anthropic';
  api_key_encrypted: string;
  model_default?: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface LLMGenerateOptions {
  tenantId: string;
  agentId?: string;
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface LLMResponse {
  content: string;
  model: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

/**
 * Serviço de geração LLM (Gemini e outros)
 */
export class LLMService {
  /**
   * Gera resposta usando LLM (Gemini por padrão)
   */
  async generate(options: LLMGenerateOptions): Promise<LLMResponse> {
    const { tenantId, agentId, messages, model, temperature = 0.7, maxTokens = 1000 } = options;

    // Busca provider configurado para o tenant
    const provider = await this.getProvider(tenantId, 'gemini');
    if (!provider || !provider.enabled) {
      throw new Error('Provider LLM não configurado ou desabilitado para este tenant');
    }

    // Descriptografa API Key
    const apiKey = encryptionService.decrypt(provider.api_key_encrypted);
    if (!apiKey) {
      throw new Error('Erro ao descriptografar API Key');
    }

    // Usa modelo fornecido ou padrão
    const modelToUse = model || provider.model_default || 'gemini-pro';

    // Converte mensagens para formato Gemini
    const geminiMessages = this.convertMessagesForGemini(messages);

    try {
      // Chama API do Gemini
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelToUse}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            contents: geminiMessages,
            generationConfig: {
              temperature,
              maxOutputTokens: maxTokens,
            },
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `Erro HTTP ${response.status}`);
      }

      const data = await response.json();
      
      // Extrai resposta
      const content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      
      return {
        content,
        model: modelToUse,
        usage: {
          promptTokens: data.usageMetadata?.promptTokenCount,
          completionTokens: data.usageMetadata?.candidatesTokenCount,
          totalTokens: data.usageMetadata?.totalTokenCount,
        },
      };
    } catch (err: any) {
      console.error('❌ [LLM SERVICE] Erro ao gerar resposta:', err);
      throw new Error(`Erro ao gerar resposta: ${err.message}`);
    }
  }

  /**
   * Converte mensagens para formato Gemini
   */
  private convertMessagesForGemini(messages: Array<{ role: string; content: string }>): any[] {
    // Gemini usa formato: { parts: [{ text: "..." }], role: "user" | "model" }
    return messages
      .filter(msg => msg.role !== 'system') // System messages são enviadas separadamente
      .map(msg => ({
        parts: [{ text: msg.content }],
        role: msg.role === 'assistant' ? 'model' : 'user',
      }));
  }

  /**
   * Busca provider LLM para um tenant
   */
  async getProvider(tenantId: string, provider: 'gemini' | 'openai' | 'anthropic'): Promise<LLMProvider | null> {
    try {
      const { data, error } = await supabaseServiceRole
        .from('llm_providers')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('provider', provider)
        .eq('enabled', true)
        .single();

      if (error || !data) {
        return null;
      }

      return data as LLMProvider;
    } catch (err: any) {
      console.error('❌ [LLM SERVICE] Erro ao buscar provider:', err);
      return null;
    }
  }

  /**
   * Lista todos os providers de um tenant
   */
  async listProviders(tenantId: string): Promise<LLMProvider[]> {
    try {
      const { data, error } = await supabaseServiceRole
        .from('llm_providers')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('provider', { ascending: true });

      if (error) {
        console.error('❌ [LLM SERVICE] Erro ao listar providers:', error);
        return [];
      }

      return (data || []).map(provider => ({
        ...provider,
        api_key_encrypted: encryptionService.maskApiKey(encryptionService.decrypt(provider.api_key_encrypted)),
      })) as LLMProvider[];
    } catch (err: any) {
      console.error('❌ [LLM SERVICE] Erro ao listar providers:', err);
      return [];
    }
  }

  /**
   * Cria ou atualiza provider LLM
   */
  async upsertProvider(
    tenantId: string,
    provider: 'gemini' | 'openai' | 'anthropic',
    apiKey: string,
    modelDefault?: string,
    enabled: boolean = true,
    createdBy?: string
  ): Promise<LLMProvider | null> {
    try {
      // Criptografa API Key
      const apiKeyEncrypted = encryptionService.encrypt(apiKey);

      const { data, error } = await supabaseServiceRole
        .from('llm_providers')
        .upsert({
          tenant_id: tenantId,
          provider,
          api_key_encrypted: apiKeyEncrypted,
          model_default: modelDefault || null,
          enabled,
          created_by: createdBy || null,
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'tenant_id,provider',
        })
        .select()
        .single();

      if (error) {
        console.error('❌ [LLM SERVICE] Erro ao salvar provider:', error);
        return null;
      }

      return data as LLMProvider;
    } catch (err: any) {
      console.error('❌ [LLM SERVICE] Erro ao salvar provider:', err);
      return null;
    }
  }

  /**
   * Testa conexão com provider
   */
  async testConnection(tenantId: string, provider: 'gemini' | 'openai' | 'anthropic', apiKey: string): Promise<boolean> {
    try {
      // Para Gemini, testa com uma chamada simples
      if (provider === 'gemini') {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              contents: [{
                parts: [{ text: 'Test' }],
                role: 'user',
              }],
            }),
          }
        );

        return response.ok;
      }

      return false;
    } catch (err: any) {
      console.error('❌ [LLM SERVICE] Erro ao testar conexão:', err);
      return false;
    }
  }

  /**
   * Compoe prompt final do agente IA com persona/tom
   */
  async composeAgentPrompt(
    agentId: string,
    context: {
      event?: any;
      lead?: any;
      conversation?: any;
    } = {}
  ): Promise<string> {
    try {
      // Busca agente
      const { data: agent, error } = await supabaseServiceRole
        .from('ai_agents')
        .select('*')
        .eq('id', agentId)
        .single();

      if (error || !agent) {
        throw new Error('Agente IA não encontrado');
      }

      // Base do sistema
      const basePrompt = `Você é um assistente IA integrado ao Zaploto.
Regras do sistema:
- Sempre seja útil, preciso e respeitoso.
- Responda de forma clara e objetiva.
- Mantenha o contexto da conversa.
`;

      // Camada de persona/tom
      const tonePrompts: Record<string, string> = {
        amigavel: 'Seja amigável, caloroso e acolhedor. Use linguagem informal e positiva.',
        neutro: 'Seja neutro, profissional e objetivo. Use linguagem clara e direta.',
        profissional: 'Seja profissional, formal e respeitoso. Use linguagem corporativa.',
        agradavel: 'Seja agradável, educado e cortês. Use linguagem polida e positiva.',
        technical: 'Seja técnico, analítico e preciso. Use linguagem técnica e objetiva.',
      };

      const tonePrompt = agent.tone && tonePrompts[agent.tone] 
        ? `\nTom de comunicação:\n${tonePrompts[agent.tone]}\n`
        : '';

      // Persona adicional (se houver)
      const personaPrompt = agent.persona
        ? `\nPersona adicional:\n${agent.persona}\n`
        : '';

      // Prompt do usuário
      const userPrompt = agent.instructions || agent.system_prompt || '';

      // Contexto runtime
      const contextPrompt = context.event || context.lead || context.conversation
        ? `\nContexto atual:\n${JSON.stringify(context, null, 2)}\n`
        : '';

      // Compõe prompt final
      let finalPrompt = basePrompt + tonePrompt + personaPrompt + '\n' + userPrompt;
      
      if (contextPrompt) {
        finalPrompt += '\n\n' + contextPrompt;
      }

      // Se há template, aplica
      if (agent.prompt_template) {
        finalPrompt = agent.prompt_template
          .replace('{{base}}', basePrompt + tonePrompt + personaPrompt)
          .replace('{{instructions}}', userPrompt)
          .replace('{{context}}', contextPrompt);
      }

      return finalPrompt;
    } catch (err: any) {
      console.error('❌ [LLM SERVICE] Erro ao compor prompt:', err);
      throw err;
    }
  }
}

export const llmService = new LLMService();

