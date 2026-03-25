import { supabaseServiceRole } from './supabase-service';
import { extractGroupParticipantAction } from '@/lib/utils/group-participants-payload';

/** Evita logar HTML de páginas de erro (ex.: Cloudflare 522) nos logs. */
function sanitizeErrorForLog(error: unknown): string {
  if (error == null) return 'Erro desconhecido';
  const msg = typeof (error as any)?.message === 'string' ? (error as any).message : String(error);
  if (msg.includes('<!DOCTYPE') || msg.includes('Connection timed out') || msg.includes('Error code 522')) {
    return 'Supabase indisponível (timeout/522). Tente novamente em instantes.';
  }
  return msg.length > 300 ? msg.slice(0, 300) + '…' : msg;
}

export interface NormalizationMapping {
  target: string; // Campo normalizado de saída
  source: string; // Path no payload original (JSONPath style)
  type: 'direct' | 'transform' | 'calculated';
  transform?: 'lowercase' | 'uppercase' | 'trim' | null;
  default?: any;
  calculated?: {
    type: 'state_compare' | 'custom';
    state_table?: string;
    key_fields?: string[];
    logic?: string;
  };
}

export interface NormalizationRule {
  id: string;
  name: string;
  description?: string;
  event_type: string;
  priority: number;
  enabled: boolean;
  rule_config: {
    mappings: NormalizationMapping[];
  };
  created_at: string;
  updated_at: string;
  created_by?: string;
}

/**
 * Serviço de normalização de payloads de webhook
 */
export class NormalizationService {
  /**
   * Aplica todas as regras de normalização ativas para um tipo de evento
   */
  async normalizePayload(
    eventType: string,
    payload: any,
    instanceName?: string,
    options?: { ruleFetchMaxAttempts?: number }
  ): Promise<any> {
    try {
      // Busca regras ativas (com retry para falhas transitórias ex.: 522/timeout Supabase)
      let rules: NormalizationRule[] | null = null;
      let lastError: unknown = null;
      /** Webhooks em alta frequência podem usar 1 tentativa para não multiplicar carga no banco em incidentes. */
      const maxAttempts = Math.min(
        3,
        Math.max(1, options?.ruleFetchMaxAttempts ?? 3),
      );

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const { data, error } = await supabaseServiceRole
          .from('webhook_normalization_rules')
          .select('*')
          .eq('event_type', eventType)
          .eq('enabled', true)
          .order('priority', { ascending: false });

        if (!error) {
          rules = data;
          break;
        }
        lastError = error;
        const msg = typeof error?.message === 'string' ? error.message : '';
        const isRetryable = msg.includes('522') || msg.includes('Connection timed out') || msg.includes('<!DOCTYPE');
        if (!isRetryable || attempt === maxAttempts) {
          console.error('❌ [NORMALIZATION] Erro ao buscar regras:', sanitizeErrorForLog(error));
          return payload;
        }
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }

      if (lastError && !rules) {
        console.error('❌ [NORMALIZATION] Erro ao buscar regras (após retries):', sanitizeErrorForLog(lastError));
        return payload;
      }

      if (!rules?.length) {
        // Mesmo sem regras, aplica normalizações comuns para eventos conhecidos (ex.: group-participants)
        // para que action, groupId, phoneNumber estejam sempre disponíveis para flows de boas-vindas
        const eventTypeNorm = String(eventType || '').toLowerCase();
        if (
          eventTypeNorm === 'group-participants.update' ||
          eventTypeNorm.includes('participants')
        ) {
          const base = JSON.parse(JSON.stringify(payload));
          return this.applyCommonNormalizations(base, payload, eventType);
        }
        return payload;
      }

      // Inicia com payload original (clone)
      let normalized = JSON.parse(JSON.stringify(payload));

      // Aplica cada regra (já ordenadas por prioridade)
      for (const rule of rules) {
        try {
          normalized = await this.applyRule(rule, normalized, instanceName);
        } catch (err: any) {
          console.error(`❌ [NORMALIZATION] Erro ao aplicar regra ${rule.id}:`, sanitizeErrorForLog(err));
          // Continua com próxima regra mesmo se esta falhar
        }
      }

      // Aplica normalização automática de campos comuns (fallback)
      normalized = this.applyCommonNormalizations(normalized, payload, eventType);

      return normalized;
    } catch (err: any) {
      console.error('❌ [NORMALIZATION] Erro ao normalizar payload:', sanitizeErrorForLog(err));
      return payload; // Retorna payload original em caso de erro
    }
  }

  /**
   * Aplica uma regra de normalização específica
   */
  private async applyRule(
    rule: NormalizationRule,
    payload: any,
    instanceName?: string
  ): Promise<any> {
    const normalized = JSON.parse(JSON.stringify(payload));
    const mappings = rule.rule_config.mappings || [];

    for (const mapping of mappings) {
      try {
        switch (mapping.type) {
          case 'direct':
            normalized[mapping.target] = this.getValueFromPath(
              payload,
              mapping.source,
              mapping.default
            );
            break;

          case 'transform':
            const sourceValue = this.getValueFromPath(
              payload,
              mapping.source,
              mapping.default
            );
            normalized[mapping.target] = this.applyTransform(
              sourceValue,
              mapping.transform || null
            );
            break;

          case 'calculated':
            if (mapping.calculated?.type === 'state_compare') {
              normalized[mapping.target] = await this.calculateStateCompare(
                mapping,
                payload,
                instanceName
              );
            }
            break;
        }
      } catch (err: any) {
        console.error(
          `❌ [NORMALIZATION] Erro ao aplicar mapeamento ${mapping.target}:`,
          sanitizeErrorForLog(err)
        );
        // Usa valor padrão se houver
        if (mapping.default !== undefined) {
          normalized[mapping.target] = mapping.default;
        }
      }
    }

    return normalized;
  }

  /**
   * Extrai valor de um path no payload (suporta JSONPath simples)
   * Ex: "data.participants[0].phoneNumber"
   */
  private getValueFromPath(obj: any, path: string, defaultValue?: any): any {
    if (!path || path === 'json') return obj;

    // Remove prefixo "json." se existir
    const cleanPath = path.replace(/^json\./, '');

    // Divide o path em partes
    const parts = cleanPath.split(/[\.\[\]]+/).filter(p => p);

    let current = obj;

    for (const part of parts) {
      if (current === null || current === undefined) {
        return defaultValue;
      }

      // Verifica se é array index
      const arrayMatch = part.match(/^(\d+)$/);
      if (arrayMatch) {
        const index = parseInt(arrayMatch[1], 10);
        if (Array.isArray(current) && index >= 0 && index < current.length) {
          current = current[index];
        } else {
          return defaultValue;
        }
      } else {
        // Propriedade de objeto
        current = current[part];
      }
    }

    return current !== undefined ? current : defaultValue;
  }

  /**
   * Aplica transformação ao valor
   */
  private applyTransform(value: any, transform?: string | null): any {
    if (!transform || value === null || value === undefined) {
      return value;
    }

    const str = String(value);

    switch (transform) {
      case 'lowercase':
        return str.toLowerCase();
      case 'uppercase':
        return str.toUpperCase();
      case 'trim':
        return str.trim();
      case 'remove_whatsapp_suffix':
        // Remove sufixos do WhatsApp: @s.whatsapp.net, @c.us, @g.us, @lid
        return str
          .replace('@s.whatsapp.net', '')
          .replace('@c.us', '')
          .replace('@g.us', '')
          .replace('@lid', '')
          .trim();
      default:
        return value;
    }
  }

  /**
   * Calcula valor baseado em comparação de estado (ex: add/remove em group-participants)
   */
  private async calculateStateCompare(
    mapping: NormalizationMapping,
    payload: any,
    instanceName?: string
  ): Promise<string> {
    if (!mapping.calculated || mapping.calculated.type !== 'state_compare') {
      return 'unknown';
    }

    const stateTable = mapping.calculated.state_table || 'group_participants_state';
    const keyFields = mapping.calculated.key_fields || [];
    const logic = mapping.calculated.logic || 'add_if_new';

    // Extrai valores dos campos chave do payload
    const keyValues: Record<string, any> = {};
    for (const keyField of keyFields) {
      keyValues[keyField] = this.getValueFromPath(payload, `data.${keyField}`);
    }

    // Para group-participants.update, precisamos de group_id e participant_id (phoneNumber)
    if (stateTable === 'group_participants_state' && logic === 'add_if_new') {
      // Tenta múltiplos caminhos para encontrar o groupId
      const groupId = this.getValueFromPath(payload, 'data.key.remoteJid') ||
                     this.getValueFromPath(payload, 'data.groupJid') ||
                     this.getValueFromPath(payload, 'data.group_id') ||
                     this.getValueFromPath(payload, 'key.remoteJid') ||
                     this.getValueFromPath(payload, 'groupJid') ||
                     this.getValueFromPath(payload, 'group_id');
      
      // Tenta múltiplos caminhos para encontrar o participantId
      const participantId = this.getValueFromPath(payload, 'data.participants[0].id') ||
                           this.getValueFromPath(payload, 'data.participants[0].phoneNumber') ||
                           this.getValueFromPath(payload, 'data.participant_id') ||
                           this.getValueFromPath(payload, 'participants[0].id') ||
                           this.getValueFromPath(payload, 'participants[0].phoneNumber') ||
                           this.getValueFromPath(payload, 'participant_id');
      
      if (!groupId || !participantId) {
        // Se não temos os campos necessários, verifica se o payload já traz action
        const existingAction = this.getValueFromPath(payload, 'data.action') ||
                              this.getValueFromPath(payload, 'action') ||
                              this.getValueFromPath(payload, 'data.update.action');
        if (existingAction === 'add' || existingAction === 'remove') {
          return existingAction;
        }
        return 'unknown';
      }

      // Verifica se participante já existe no estado
      const { data: existingState } = await supabaseServiceRole
        .from('group_participants_state')
        .select('*')
        .eq('group_id', groupId)
        .eq('participant_id', participantId)
        .eq('instance_name', instanceName || '')
        .single();

      if (existingState) {
        // Participante já existe - verifica se action foi explícita no payload
        const explicitAction = this.getValueFromPath(payload, 'data.action');
        if (explicitAction === 'remove') {
          // Marca como inativo
          await supabaseServiceRole
            .from('group_participants_state')
            .update({
              is_active: false,
              last_seen_at: new Date().toISOString(),
            })
            .eq('id', existingState.id);
          return 'remove';
        }
        // Se ainda está ativo, pode ser update, mantém como add (ou update)
        await supabaseServiceRole
          .from('group_participants_state')
          .update({
            is_active: true,
            last_seen_at: new Date().toISOString(),
          })
          .eq('id', existingState.id);
        return 'add'; // Re-adicionado ou atualizado
      } else {
        // Participante novo - adiciona ao estado
        await supabaseServiceRole
          .from('group_participants_state')
          .insert({
            group_id: groupId,
            participant_id: participantId,
            phone_number: participantId.includes('@') 
              ? participantId.split('@')[0] 
              : participantId,
            is_active: true,
            first_seen_at: new Date().toISOString(),
            last_seen_at: new Date().toISOString(),
            instance_name: instanceName || null,
          });
        return 'add';
      }
    }

    return 'unknown';
  }

  /**
   * Aplica normalizações comuns automaticamente (fallback quando não há regras)
   */
  private applyCommonNormalizations(normalized: any, originalPayload: any, eventType: string): any {
    // Para eventos group-participants (qualquer casing / underscore da Evolution), normaliza campos comuns
    const et = String(eventType || '').toLowerCase();
    if (et === 'group-participants.update' || et.includes('participants')) {
      // Extrai action se não estiver normalizado — nunca assumir 'add' (remove viraria boas-vindas)
      if (!normalized.action) {
        const fromPaths =
          this.getValueFromPath(originalPayload, 'data.action') ??
          this.getValueFromPath(originalPayload, 'action') ??
          this.getValueFromPath(originalPayload, 'data.update.action');
        const extracted =
          fromPaths != null && String(fromPaths).trim() !== ''
            ? String(fromPaths).trim().toLowerCase()
            : extractGroupParticipantAction(originalPayload);
        if (extracted) {
          normalized.action = extracted;
        }
      }

      // Extrai groupId se não estiver normalizado
      // Prioridade: data.id (ID do grupo) > data.key.remoteJid > outros
      if (!normalized.groupId && !normalized.group_id) {
        const groupId = this.getValueFromPath(originalPayload, 'data.id') ||
                       this.getValueFromPath(originalPayload, 'data.key.remoteJid') ||
                       this.getValueFromPath(originalPayload, 'data.groupJid') ||
                       this.getValueFromPath(originalPayload, 'data.group_id') ||
                       this.getValueFromPath(originalPayload, 'key.remoteJid') ||
                       this.getValueFromPath(originalPayload, 'groupJid');
        if (groupId) {
          normalized.groupId = groupId;
          normalized.group_id = groupId;
          // Garante que também está no nível raiz do normalized para facilitar acesso
          if (!normalized.data) {
            normalized.data = {};
          }
          normalized.data.groupId = groupId;
          normalized.data.group_id = groupId;
        }
      }

      // Extrai phoneNumber do primeiro participante se não estiver normalizado
      // Prioridade: data.participants[0].phoneNumber (campo direto) > data.participants[0].id
      if (!normalized.phoneNumber && !normalized.phone_number) {
        // Tenta pegar diretamente do campo phoneNumber do participante
        let phoneNumber = this.getValueFromPath(originalPayload, 'data.participants[0].phoneNumber');
        
        // Se não encontrou, tenta outros caminhos
        if (!phoneNumber) {
          phoneNumber = this.getValueFromPath(originalPayload, 'data.participants[0].id') ||
                       this.getValueFromPath(originalPayload, 'participants[0].phoneNumber') ||
                       this.getValueFromPath(originalPayload, 'participants[0].id');
        }
        
        if (phoneNumber) {
          // Para eventos group-participants.update, mantém o formato completo com @s.whatsapp.net
          // pois será usado para mencionar no grupo
          const phoneStr = String(phoneNumber);
          normalized.phoneNumber = phoneStr;
          normalized.phone_number = phoneStr;
          
          // Garante que também está no nível raiz do normalized para facilitar acesso
          if (!normalized.data) {
            normalized.data = {};
          }
          normalized.data.phoneNumber = phoneStr;
          normalized.data.phone_number = phoneStr;
        }
      }

      // Extrai leadId (número da lead) do id do participante
      if (!normalized.leadId && !normalized.lead_id) {
        const leadId = this.getValueFromPath(originalPayload, 'data.participants[0].id') ||
                      this.getValueFromPath(originalPayload, 'participants[0].id');
        if (leadId) {
          // Remove sufixos do WhatsApp
          const cleanLeadId = String(leadId)
            .replace('@s.whatsapp.net', '')
            .replace('@c.us', '')
            .replace('@g.us', '')
            .replace('@lid', '')
            .trim();
          normalized.leadId = cleanLeadId;
          normalized.lead_id = cleanLeadId;
        }
      }

      // Extrai instanceName se não estiver normalizado
      if (!normalized.instanceName && !normalized.instance_name) {
        const instanceName = this.getValueFromPath(originalPayload, 'instance') ||
                           this.getValueFromPath(originalPayload, 'data.instance') ||
                           this.getValueFromPath(originalPayload, 'instanceName') ||
                           this.getValueFromPath(originalPayload, 'data.instanceName');
        if (instanceName) {
          normalized.instanceName = instanceName;
          normalized.instance_name = instanceName;
        }
      }
    }

    return normalized;
  }

  /**
   * Salva payload normalizado no evento
   */
  async saveNormalizedPayload(eventId: string, normalizedPayload: any): Promise<void> {
    try {
      await supabaseServiceRole
        .from('evolution_webhook_events')
        .update({
          payload_normalized: normalizedPayload,
        })
        .eq('id', eventId);
    } catch (err: any) {
      console.error('❌ [NORMALIZATION] Erro ao salvar payload normalizado:', sanitizeErrorForLog(err));
    }
  }

  /**
   * Lista todas as regras de normalização
   */
  async listRules(eventType?: string): Promise<NormalizationRule[]> {
    try {
      let query = supabaseServiceRole
        .from('webhook_normalization_rules')
        .select('*')
        .order('event_type', { ascending: true })
        .order('priority', { ascending: false });

      if (eventType) {
        query = query.eq('event_type', eventType);
      }

      const { data, error } = await query;

      if (error) {
        console.error('❌ [NORMALIZATION] Erro ao listar regras:', sanitizeErrorForLog(error));
        return [];
      }

      return data || [];
    } catch (err: any) {
      console.error('❌ [NORMALIZATION] Erro ao listar regras:', sanitizeErrorForLog(err));
      return [];
    }
  }

  /**
   * Cria uma nova regra de normalização
   */
  async createRule(rule: Omit<NormalizationRule, 'id' | 'created_at' | 'updated_at'>): Promise<NormalizationRule | null> {
    try {
      const { data, error } = await supabaseServiceRole
        .from('webhook_normalization_rules')
        .insert({
          ...rule,
          updated_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (error) {
        console.error('❌ [NORMALIZATION] Erro ao criar regra:', sanitizeErrorForLog(error));
        return null;
      }

      return data;
    } catch (err: any) {
      console.error('❌ [NORMALIZATION] Erro ao criar regra:', sanitizeErrorForLog(err));
      return null;
    }
  }

  /**
   * Atualiza uma regra de normalização
   */
  async updateRule(ruleId: string, updates: Partial<NormalizationRule>): Promise<NormalizationRule | null> {
    try {
      const { data, error } = await supabaseServiceRole
        .from('webhook_normalization_rules')
        .update({
          ...updates,
          updated_at: new Date().toISOString(),
        })
        .eq('id', ruleId)
        .select()
        .single();

      if (error) {
        console.error('❌ [NORMALIZATION] Erro ao atualizar regra:', sanitizeErrorForLog(error));
        return null;
      }

      return data;
    } catch (err: any) {
      console.error('❌ [NORMALIZATION] Erro ao atualizar regra:', sanitizeErrorForLog(err));
      return null;
    }
  }

  /**
   * Deleta uma regra de normalização
   */
  async deleteRule(ruleId: string): Promise<boolean> {
    try {
      const { error } = await supabaseServiceRole
        .from('webhook_normalization_rules')
        .delete()
        .eq('id', ruleId);

      if (error) {
        console.error('❌ [NORMALIZATION] Erro ao deletar regra:', sanitizeErrorForLog(error));
        return false;
      }

      return true;
    } catch (err: any) {
      console.error('❌ [NORMALIZATION] Erro ao deletar regra:', sanitizeErrorForLog(err));
      return false;
    }
  }
}

export const normalizationService = new NormalizationService();

