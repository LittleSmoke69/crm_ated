import { supabaseServiceRole } from './supabase-service';
import { assignProxyToEvolutionInstance } from '@/lib/services/evolution-instance-proxy';

/**
 * Serviço para atribuição automática de proxies às instâncias
 * Implementa rotação sequencial baseada na quantidade de instâncias por proxy
 */
export class ProxyAutoAssign {
  /**
   * Seleciona o melhor proxy para uma nova instância
   * Estratégia: distribui uniformemente entre os proxies ativos baseado em quantas instâncias cada um já tem
   */
  async selectBestProxyForInstance(): Promise<{
    id: string;
    name: string;
    host: string;
    port: string;
    protocol: string;
    username: string | null;
    password: string | null;
  } | null> {
    try {
      // Busca todos os proxies ativos
      console.log('🔍 [PROXY-AUTO] Buscando proxies ativos...');
      const { data: proxies, error: proxiesError } = await supabaseServiceRole
        .from('proxy_instances')
        .select('id, name, host, port, protocol, username, password')
        .eq('enabled', true)
        .order('created_at', { ascending: true });

      if (proxiesError) {
        console.error('❌ [PROXY-AUTO] Erro ao buscar proxies:', proxiesError);
        return null;
      }

      if (!proxies || proxies.length === 0) {
        console.warn('⚠️ [PROXY-AUTO] Nenhum proxy ativo encontrado');
        return null;
      }

      console.log(`✅ [PROXY-AUTO] Encontrados ${proxies.length} proxy(s) ativo(s):`, proxies.map(p => p.name));

      // Conta quantas instâncias cada proxy já tem (apenas instâncias conectadas/ativas)
      const proxiesWithCounts = await Promise.all(
        proxies.map(async (proxy) => {
          const { count, error } = await supabaseServiceRole
            .from('evolution_instances')
            .select('id', { count: 'exact', head: true })
            .eq('proxy_id', proxy.id)
            .eq('is_active', true)
            .in('status', ['ok', 'disconnected']); // Conta instâncias ativas (conectadas ou desconectadas)

          return {
            proxy,
            instanceCount: error ? 0 : (count || 0),
          };
        })
      );

      // Seleciona o proxy com menor número de instâncias
      // Se houver empate, seleciona aleatoriamente entre as com menos instâncias
      const minCount = Math.min(...proxiesWithCounts.map(p => p.instanceCount));
      const candidates = proxiesWithCounts.filter(p => p.instanceCount === minCount);

      // Seleciona aleatoriamente entre as candidatas (para distribuição uniforme)
      const selected = candidates[Math.floor(Math.random() * candidates.length)];

      console.log(`✅ [PROXY-AUTO] Proxy selecionado: ${selected.proxy.name} (${selected.instanceCount} instâncias existentes)`);

      return {
        id: selected.proxy.id,
        name: selected.proxy.name,
        host: selected.proxy.host,
        port: selected.proxy.port,
        protocol: selected.proxy.protocol,
        username: selected.proxy.username,
        password: selected.proxy.password,
      };
    } catch (error) {
      console.error('❌ [PROXY-AUTO] Erro ao selecionar proxy:', error);
      return null;
    }
  }

  /**
   * Atribui automaticamente um proxy a uma instância quando ela conecta
   */
  async assignProxyToInstance(instanceId: string, instanceName: string): Promise<{
    success: boolean;
    proxyId?: string;
    error?: string;
    skipped?: boolean;
    reason?: string;
  }> {
    try {
      // Verifica se a instância já tem um proxy atribuído
      const { data: instance, error: instanceError } = await supabaseServiceRole
        .from('evolution_instances')
        .select('id, proxy_id, evolution_api_id, is_master')
        .eq('id', instanceId)
        .single();

      if (instanceError || !instance) {
        console.error('❌ [PROXY-AUTO] Erro ao buscar instância:', instanceError);
        return { success: false, error: 'Instância não encontrada' };
      }

      // Instâncias mestres NÃO recebem proxy automaticamente
      if (instance.is_master === true) {
        console.log(`👑 [PROXY-AUTO] Instância ${instanceName} é mestre - proxy não será atribuído automaticamente`);
        return { success: true, skipped: true, reason: 'Instância mestre não recebe proxy automático' };
      }

      // Se já tem proxy, não faz nada
      if (instance.proxy_id) {
        console.log(`ℹ️ [PROXY-AUTO] Instância ${instanceName} já possui proxy atribuído (ID: ${instance.proxy_id})`);
        return { success: true, proxyId: instance.proxy_id };
      }

      // Seleciona o melhor proxy
      const selectedProxy = await this.selectBestProxyForInstance();
      if (!selectedProxy) {
        console.warn(`⚠️ [PROXY-AUTO] Nenhum proxy disponível para instância ${instanceName}`);
        return { success: false, error: 'Nenhum proxy disponível' };
      }

      // Busca a Evolution API da instância
      if (!instance.evolution_api_id) {
        console.error('❌ [PROXY-AUTO] Instância sem evolution_api_id');
        return { success: false, error: 'Instância sem Evolution API vinculada' };
      }

      console.log(`📤 [PROXY-AUTO] Atribuindo proxy ${selectedProxy.name} à instância ${instanceName}`);

      const applied = await assignProxyToEvolutionInstance({
        instanceId,
        proxyId: selectedProxy.id,
      });

      if (!applied.ok) {
        console.error('❌ [PROXY-AUTO] Falha ao aplicar proxy:', applied.error);
        return { success: false, error: applied.error };
      }

      console.log(`✅ [PROXY-AUTO] Proxy ${selectedProxy.name} atribuído com sucesso à instância ${instanceName}`);
      return { success: true, proxyId: selectedProxy.id };
    } catch (error: any) {
      console.error('❌ [PROXY-AUTO] Erro ao atribuir proxy:', error);
      return { success: false, error: error.message || 'Erro desconhecido' };
    }
  }
}

export const proxyAutoAssign = new ProxyAutoAssign();

