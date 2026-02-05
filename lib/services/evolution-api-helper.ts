import { supabaseServiceRole } from './supabase-service';

/**
 * Busca a API Evolution configurada para um usuário
 * Retorna a API padrão do usuário ou a primeira API ativa disponível
 */
export async function getUserEvolutionApi(userId: string): Promise<{
  baseUrl: string;
  apiKey: string;
} | null> {
  try {
    // Busca a API padrão do usuário
    const { data: userApis } = await supabaseServiceRole
      .from('user_evolution_apis')
      .select(`
        evolution_api_id,
        is_default,
        evolution_apis (
          id,
          base_url,
          api_key_global,
          is_active
        )
      `)
      .eq('user_id', userId)
      .eq('is_default', true);

    // Filtra apenas APIs ativas
    const defaultApi = Array.isArray(userApis)
      ? userApis.find(
          (ua: any) => ua.evolution_apis && ua.evolution_apis.is_active === true
        )
      : null;

    if (defaultApi?.evolution_apis) {
      const api = defaultApi.evolution_apis as any;
      if (api && typeof api === 'object' && 'base_url' in api) {
        return {
          baseUrl: api.base_url,
          apiKey: api.api_key_global, // CRÍTICO: Usa api_key_global
        };
      }
    }

    // Se não tem padrão, busca qualquer API atribuída ao usuário
    const { data: anyUserApis } = await supabaseServiceRole
      .from('user_evolution_apis')
      .select(`
        evolution_apis (
          id,
          base_url,
          api_key_global,
          is_active
        )
      `)
      .eq('user_id', userId)
      .limit(10);

    // Filtra apenas APIs ativas
    const activeApi = Array.isArray(anyUserApis) 
      ? anyUserApis.find(
          (ua: any) => ua.evolution_apis && ua.evolution_apis.is_active === true
        )
      : null;

    if (activeApi?.evolution_apis) {
      const api = activeApi.evolution_apis as any;
      if (api && typeof api === 'object' && 'base_url' in api) {
        return {
          baseUrl: api.base_url,
          apiKey: api.api_key_global, // CRÍTICO: Usa api_key_global
        };
      }
    }

    // Se não tem API atribuída, busca a primeira API ativa do sistema
    const { data: systemApi } = await supabaseServiceRole
      .from('evolution_apis')
      .select('base_url, api_key_global')
      .eq('is_active', true)
      .limit(1)
      .single();

    if (systemApi) {
      return {
        baseUrl: systemApi.base_url,
        apiKey: systemApi.api_key_global, // CRÍTICO: Usa api_key_global
      };
    }

    return null;
  } catch (error) {
    console.error('Erro ao buscar API Evolution do usuário:', error);
    return null;
  }
}

