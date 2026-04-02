import { supabaseServiceRole } from './supabase-service';

const DEFAULT_MAX_LEADS_PER_DAY = 100; // Padrão: máximo de leads por dia por usuário
const DEFAULT_MAX_INSTANCES_PER_USER = 20; // Padrão: máximo de instâncias por usuário

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  resetAt: string; // ISO timestamp
  reason?: string;
}

export interface InstanceStatus {
  instanceName: string;
  status: 'active' | 'banned' | 'suspended' | 'error';
  lastError?: string;
  errorType?: 'rate_limit' | 'bad_request' | 'connection_closed' | 'unknown';
  lastErrorAt?: string;
  consecutiveErrors?: number;
}

export class RateLimitService {
  /**
   * Obtém configurações do usuário (limites personalizados)
   */
  async getUserSettings(userId: string): Promise<{
    maxLeadsPerDay: number;
    maxInstances: number;
    isAdmin: boolean;
  }> {
    // Busca status no perfil primeiro (fonte de verdade para admin)
    const { data: profile } = await supabaseServiceRole
      .from('profiles')
      .select('status')
      .eq('id', userId)
      .single();

    const isAdminFromProfile = profile?.status === 'admin';

    const { data: settings } = await supabaseServiceRole
      .from('user_settings')
      .select('max_leads_per_day, max_instances, is_admin')
      .eq('user_id', userId)
      .single();

    return {
      maxLeadsPerDay: settings?.max_leads_per_day || DEFAULT_MAX_LEADS_PER_DAY,
      maxInstances: settings?.max_instances || DEFAULT_MAX_INSTANCES_PER_USER,
      isAdmin: isAdminFromProfile || settings?.is_admin || false,
    };
  }

  /**
   * Verifica se o usuário pode adicionar mais leads hoje
   */
  async checkDailyLimit(userId: string): Promise<RateLimitResult> {
    // Busca configurações do usuário
    const settings = await this.getUserSettings(userId);
    const maxLeads = settings.maxLeadsPerDay;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Busca campanhas do usuário criadas hoje
    const { data: campaigns, error } = await supabaseServiceRole
      .from('campaigns')
      .select('total_contacts, processed_contacts')
      .eq('user_id', userId)
      .gte('created_at', today.toISOString())
      .lt('created_at', tomorrow.toISOString());

    if (error) {
      console.error('Erro ao verificar rate limit:', error);
      // Em caso de erro, permite mas registra
      return {
        allowed: true,
        remaining: maxLeads,
        limit: maxLeads,
        resetAt: tomorrow.toISOString(),
      };
    }

    // Soma todos os contatos processados hoje
    const totalProcessedToday = campaigns?.reduce((sum, c) => sum + (c.processed_contacts || 0), 0) || 0;
    const remaining = Math.max(0, maxLeads - totalProcessedToday);

    return {
      allowed: remaining > 0,
      remaining,
      limit: maxLeads,
      resetAt: tomorrow.toISOString(),
      reason: remaining === 0 ? 'Limite diário de leads atingido' : undefined,
    };
  }

  /**
   * Verifica se o usuário pode criar mais instâncias
   * Agora conta TODAS as instâncias do sistema (balanceamento global)
   * Atribuição de usuário é opcional, então não filtra por user_evolution_apis
   */
  async checkInstanceLimit(userId: string): Promise<{ allowed: boolean; current: number; max: number; reason?: string }> {
    // Busca configurações do usuário
    const settings = await this.getUserSettings(userId);
    const maxInstances = settings.maxInstances;

    // Conta TODAS as instâncias ativas do sistema (balanceamento global)
    // Isso permite que o sistema distribua carga entre todas as Evolution APIs
    const { data: instances, error } = await supabaseServiceRole
      .from('evolution_instances')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true);

    if (error) {
      console.error('Erro ao verificar limite de instâncias:', error);
      return {
        allowed: true,
        current: 0,
        max: maxInstances,
      };
    }

    const current = instances?.length || 0;
    
    // Se for admin, o limite não se aplica (allowed é sempre true)
    if (settings.isAdmin) {
      return {
        allowed: true,
        current,
        max: maxInstances,
      };
    }

    const allowed = current < maxInstances;

    return {
      allowed,
      current,
      max: maxInstances,
      reason: !allowed ? `Limite de ${maxInstances} instâncias atingido` : undefined,
    };
  }

  /**
   * Registra uso de leads (atualiza contadores da campanha)
   */
  async recordLeadUsage(campaignId: string, count: number, success: boolean): Promise<void> {
    const updateField = success ? 'processed_contacts' : 'failed_contacts';
    
    // Busca valores atuais (busca ambos os campos para evitar problemas de tipo)
    const { data: campaign } = await supabaseServiceRole
      .from('campaigns')
      .select('processed_contacts, failed_contacts')
      .eq('id', campaignId)
      .single();

    const currentValue = campaign 
      ? (updateField === 'processed_contacts' 
          ? ((campaign as any).processed_contacts as number) || 0
          : ((campaign as any).failed_contacts as number) || 0)
      : 0;
    const newValue = currentValue + count;

    await supabaseServiceRole
      .from('campaigns')
      .update({
        [updateField]: newValue,
        updated_at: new Date().toISOString(),
      })
      .eq('id', campaignId);
  }

  /**
   * Obtém status das instâncias para distribuição inteligente
   * Agora usa evolution_instances
   */
  async getInstancesStatus(userId: string, instanceNames: string[]): Promise<Map<string, InstanceStatus>> {
    const statusMap = new Map<string, InstanceStatus>();

    // Busca APIs Evolution atribuídas ao usuário
    const { data: userApis } = await supabaseServiceRole
      .from('user_evolution_apis')
      .select('evolution_api_id')
      .eq('user_id', userId);

    if (!userApis || userApis.length === 0) {
      // Se não tem APIs, inicializa tudo como erro
      for (const instanceName of instanceNames) {
        statusMap.set(instanceName, {
          instanceName,
          status: 'error',
          consecutiveErrors: 0,
        });
      }
      return statusMap;
    }

    // Busca instâncias das APIs do usuário
    const apiIds = userApis.map(ua => ua.evolution_api_id);
    const { data: instances } = await supabaseServiceRole
      .from('evolution_instances')
      .select('instance_name, status, is_active')
      .in('evolution_api_id', apiIds)
      .in('instance_name', instanceNames);

    // Inicializa status para todas as instâncias solicitadas
    for (const instanceName of instanceNames) {
      const instance = instances?.find(i => i.instance_name === instanceName);
      const isActive = instance?.is_active && instance?.status === 'ok';
      statusMap.set(instanceName, {
        instanceName,
        status: isActive ? 'active' : 'error',
        consecutiveErrors: 0,
      });
    }

    return statusMap;
  }

  /**
   * Marca instância com erro e atualiza contador
   * Agora usa evolution_instances (mas o balanceador já faz isso, então este método pode estar obsoleto)
   */
  async markInstanceError(
    userId: string,
    instanceName: string,
    errorType: 'rate_limit' | 'bad_request' | 'connection_closed' | 'unknown',
    errorMessage: string
  ): Promise<void> {
    // Busca APIs Evolution atribuídas ao usuário
    const { data: userApis } = await supabaseServiceRole
      .from('user_evolution_apis')
      .select('evolution_api_id')
      .eq('user_id', userId);

    if (!userApis || userApis.length === 0) {
      return; // Não tem APIs atribuídas
    }

    // Busca instância nas APIs do usuário
    const apiIds = userApis.map(ua => ua.evolution_api_id);
    const { data: instance } = await supabaseServiceRole
      .from('evolution_instances')
      .select('*')
      .in('evolution_api_id', apiIds)
      .eq('instance_name', instanceName)
      .single();

    if (!instance) return;

    // Atualiza status baseado no tipo de erro (compatível com o novo sistema)
    let newStatus = instance.status;
    if (errorType === 'connection_closed') {
      newStatus = 'disconnected'; // Número desconectado/banido
    } else if (errorType === 'rate_limit') {
      newStatus = 'rate_limited'; // Temporariamente suspenso
    } else {
      newStatus = 'error';
    }

    await supabaseServiceRole
      .from('evolution_instances')
      .update({
        status: newStatus,
        // Desconexão só muda status; is_active não vira false (lista /instancias / campanhas).
        is_active: instance.is_active,
        error_today: instance.error_today + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', instance.id);
  }

  /**
   * Seleciona a melhor instância disponível para uso
   * NOTA: Este método está obsoleto - use evolutionBalancer.pickBestEvolutionInstance() em vez disso
   */
  async selectBestInstance(userId: string, instanceNames: string[]): Promise<string | null> {
    // Busca APIs Evolution atribuídas ao usuário
    const { data: userApis } = await supabaseServiceRole
      .from('user_evolution_apis')
      .select('evolution_api_id')
      .eq('user_id', userId);

    if (!userApis || userApis.length === 0) {
      return null;
    }

    // Busca instâncias das APIs do usuário
    const apiIds = userApis.map(ua => ua.evolution_api_id);
    const { data: instances } = await supabaseServiceRole
      .from('evolution_instances')
      .select('instance_name, status, is_active')
      .in('evolution_api_id', apiIds)
      .in('instance_name', instanceNames)
      .eq('is_active', true)
      .eq('status', 'ok')
      .order('last_used_at', { ascending: true, nullsFirst: true }); // Usa a menos recentemente usada

    if (!instances || instances.length === 0) {
      return null;
    }

    return instances[0].instance_name;
  }
}

export const rateLimitService = new RateLimitService();

