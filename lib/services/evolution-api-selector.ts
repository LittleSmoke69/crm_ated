import { supabaseServiceRole } from './supabase-service';

/**
 * Serviço para selecionar a melhor Evolution API para criar novas instâncias
 * Distribui a carga entre todas as Evolution APIs disponíveis
 */
export class EvolutionApiSelector {
  /**
   * Seleciona a melhor Evolution API para criar uma nova instância
   * Estratégia: distribui uniformemente entre as APIs ativas baseado em quantas instâncias cada uma já tem
   */
  async selectBestEvolutionApiForNewInstance(): Promise<{
    id: string;
    name: string;
    base_url: string;
    api_key_global: string;
  } | null> {
    try {
      // Busca todas as Evolution APIs ativas e não bloqueadas para criação de instâncias
      console.log('🔍 [SELECTOR] Buscando Evolution APIs ativas e não bloqueadas...');
      const { data: apis, error: apisError } = await supabaseServiceRole
        .from('evolution_apis')
        .select('id, name, base_url, api_key_global, is_active, is_blocked_for_instances')
        .eq('is_active', true)
        .eq('is_blocked_for_instances', false)
        .order('created_at', { ascending: true });

      if (apisError) {
        console.error('❌ [SELECTOR] Erro ao buscar Evolution APIs:', apisError);
        return null;
      }

      if (!apis || apis.length === 0) {
        console.error('❌ [SELECTOR] Nenhuma Evolution API ativa encontrada no banco de dados');
        return null;
      }

      console.log(`✅ [SELECTOR] Encontradas ${apis.length} Evolution API(s) ativa(s):`, apis.map(a => a.name));
      
      // Log detalhado das APIs encontradas (sem mostrar as keys completas)
      apis.forEach(api => {
        const hasApiKey = !!api.api_key_global && typeof api.api_key_global === 'string' && api.api_key_global.trim().length > 0;
        const apiKeyLength = api.api_key_global ? api.api_key_global.length : 0;
        console.log(`📋 [SELECTOR] API: ${api.name}, Base URL: ${api.base_url}, Tem API Key: ${hasApiKey}, Key Length: ${apiKeyLength}`);
      });

      // Conta quantas instâncias cada API já tem
      const apiInstanceCounts = await Promise.all(
        apis.map(async (api) => {
          const { count, error } = await supabaseServiceRole
            .from('evolution_instances')
            .select('id', { count: 'exact', head: true })
            .eq('evolution_api_id', api.id)
            .eq('is_active', true);

          return {
            api,
            instanceCount: error ? 0 : (count || 0),
          };
        })
      );

      // FILTRO CRÍTICO: Remove APIs bloqueadas para criação de instâncias
      const availableApis = apiInstanceCounts.filter(a => a.api.is_blocked_for_instances !== true);
      
      if (availableApis.length === 0) {
        console.error('❌ [SELECTOR] Todas as APIs disponíveis estão bloqueadas para criação de instâncias');
        return null;
      }

      // Log das APIs bloqueadas (se houver)
      const blockedApis = apiInstanceCounts.filter(a => a.api.is_blocked_for_instances === true);
      if (blockedApis.length > 0) {
        console.log(`⚠️ [SELECTOR] ${blockedApis.length} API(s) bloqueada(s) para criação de instâncias:`, blockedApis.map(a => a.api.name));
      }

      // Seleciona a API com menor número de instâncias
      // Se houver empate, seleciona aleatoriamente entre as com menos instâncias
      const minCount = Math.min(...availableApis.map(a => a.instanceCount));
      const candidates = availableApis.filter(a => a.instanceCount === minCount);

      // Seleciona aleatoriamente entre as candidatas (para distribuição uniforme)
      const selected = candidates[Math.floor(Math.random() * candidates.length)];

      console.log(`✅ [SELECTOR] Evolution API selecionada: ${selected.api.name} (${selected.instanceCount} instâncias existentes)`);

      // VALIDAÇÃO CRÍTICA: Verifica se api_key_global está presente e não é null/undefined
      if (!selected.api.api_key_global || typeof selected.api.api_key_global !== 'string' || selected.api.api_key_global.trim().length === 0) {
        console.error(`❌ [SELECTOR] API key global vazia ou inválida para Evolution API: ${selected.api.name}`);
        // Retorna null para que o código acima tente a próxima API (se houver)
        // Se for a única API, o erro será tratado no código chamador
        return null;
      }

      const apiKeyPreview = selected.api.api_key_global.length > 10 
        ? `${selected.api.api_key_global.substring(0, 10)}...${selected.api.api_key_global.substring(selected.api.api_key_global.length - 4)}`
        : '***';
      console.log(`🔑 [SELECTOR] API key global validada (preview: ${apiKeyPreview}, length: ${selected.api.api_key_global.length})`);

      return {
        id: selected.api.id,
        name: selected.api.name,
        base_url: selected.api.base_url,
        api_key_global: selected.api.api_key_global.trim(), // CRÍTICO: Retorna api_key_global e remove espaços
      };
    } catch (error) {
      console.error('Erro ao selecionar Evolution API:', error);
      return null;
    }
  }

  /**
   * Obtém todas as Evolution APIs ativas
   */
  async getAllActiveApis(): Promise<Array<{
    id: string;
    name: string;
    base_url: string;
    api_key_global: string;
    instanceCount: number;
  }>> {
    try {
      const { data: apis, error } = await supabaseServiceRole
        .from('evolution_apis')
        .select('id, name, base_url, api_key_global, is_active, is_blocked_for_instances')
        .eq('is_active', true)
        .eq('is_blocked_for_instances', false)
        .order('created_at', { ascending: true });

      if (error || !apis || apis.length === 0) {
        return [];
      }

      // Conta instâncias por API
      const apisWithCounts = await Promise.all(
        apis.map(async (api) => {
          const { count } = await supabaseServiceRole
            .from('evolution_instances')
            .select('id', { count: 'exact', head: true })
            .eq('evolution_api_id', api.id)
            .eq('is_active', true);

          return {
            id: api.id,
            name: api.name,
            base_url: api.base_url,
            api_key_global: api.api_key_global, // CRÍTICO: Retorna api_key_global
            instanceCount: count || 0,
          };
        })
      );

      return apisWithCounts;
    } catch (error) {
      console.error('Erro ao buscar Evolution APIs:', error);
      return [];
    }
  }
}

export const evolutionApiSelector = new EvolutionApiSelector();

