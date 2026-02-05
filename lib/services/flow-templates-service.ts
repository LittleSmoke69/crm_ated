import { supabaseServiceRole } from './supabase-service';
import { Node, Edge } from 'reactflow';

/**
 * Serviço para gerenciar templates de flows
 */
export class FlowTemplatesService {
  /**
   * Cria template de boas-vindas quando alguém entra no grupo
   */
  async createWelcomeTemplate(userId: string): Promise<string | null> {
    try {
      // Define nodes do template
      const nodes: Node[] = [
        {
          id: 'trigger-1',
          type: 'webhookTrigger',
          position: { x: 100, y: 200 },
          data: {
            label: 'Webhook Event',
            config: {
              filters: {
                event_type: 'group-participants.update',
                instance: null,
                action: 'add',
              },
            },
          },
        },
        {
          id: 'random-picker-1',
          type: 'randomPicker',
          position: { x: 400, y: 200 },
          data: {
            label: 'Random Picker',
            config: {
              messages: [
                '👋 Bem-vindo ao grupo! Ficamos felizes em ter você aqui.',
                '🎉 Olá! Seja bem-vindo! Estamos animados para ter você conosco.',
                '🌟 Bem-vindo! Esperamos que você se sinta em casa aqui.',
                '🙌 Olá e bem-vindo! Ficamos felizes em ter você no grupo.',
                '😊 Seja bem-vindo! Estamos aqui para ajudar e apoiar.',
                '🎊 Bem-vindo ao grupo! Sinta-se à vontade para participar.',
                '👏 Olá! Bem-vindo! Esperamos que você tenha uma ótima experiência aqui.',
                '🤝 Seja bem-vindo! Estamos felizes em ter você conosco.',
                '💫 Bem-vindo! Ficamos animados para conhecer você melhor.',
                '🎈 Olá e bem-vindo! Esperamos que você se divirta aqui no grupo.',
              ],
            },
          },
        },
        {
          id: 'send-message-1',
          type: 'sendMessage',
          position: { x: 700, y: 200 },
          data: {
            label: 'Send Message',
            config: {
              instance_name: '{{$json.normalized.instanceName}}',
              group_jid: '{{$json.normalized.groupId}}',
              message: '{{$json.randomPicker.selected}}',
            },
          },
        },
      ];

      // Define edges (conexões)
      const edges: Edge[] = [
        {
          id: 'edge-1',
          source: 'trigger-1',
          target: 'random-picker-1',
          sourceHandle: null,
          targetHandle: null,
        },
        {
          id: 'edge-2',
          source: 'random-picker-1',
          target: 'send-message-1',
          sourceHandle: null,
          targetHandle: null,
        },
      ];

      // Cria flow template
      const { data: flow, error } = await supabaseServiceRole
        .from('flows')
        .insert({
          name: 'Boas-vindas (quando entra no grupo)',
          description: 'Template de boas-vindas automático quando alguém entra no grupo. Envia uma mensagem aleatória de boas-vindas.',
          type: 'template',
          status: 'inactive', // Template inativo por padrão (usuário deve ativar)
          graph_json: { nodes, edges },
          settings_json: {},
          user_id: userId,
          created_by: userId,
        })
        .select()
        .single();

      if (error || !flow) {
        console.error('❌ [FLOW TEMPLATES] Erro ao criar template:', error);
        return null;
      }

      console.log('✅ [FLOW TEMPLATES] Template de boas-vindas criado:', flow.id);
      return flow.id;
    } catch (err: any) {
      console.error('❌ [FLOW TEMPLATES] Erro ao criar template:', err);
      return null;
    }
  }

  /**
   * Lista templates disponíveis
   */
  async listTemplates(userId: string): Promise<any[]> {
    try {
      const { data, error } = await supabaseServiceRole
        .from('flows')
        .select('*')
        .eq('type', 'template')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('❌ [FLOW TEMPLATES] Erro ao listar templates:', error);
        return [];
      }

      return data || [];
    } catch (err: any) {
      console.error('❌ [FLOW TEMPLATES] Erro ao listar templates:', err);
      return [];
    }
  }
}

export const flowTemplatesService = new FlowTemplatesService();

