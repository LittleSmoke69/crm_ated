'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

export interface Contact {
  id: string;
  name?: string;
  telefone: string | null;
  status_disparo?: boolean;
  status_add_gp?: boolean;
  status?: string;
  id_list?: string | null;
  block_list?: boolean; // Indica se o contato está em alguma lista (true = bloqueado, false = disponível)
  created_at?: string;
}

export interface WhatsAppInstance {
  id?: string;
  instance_name: string;
  status: string;
  hash?: string;
  number?: string;
  qr_code?: string | null;
  connected_at?: string | null;
  user_id?: string;
  /** Nome amigável do dono da instância (perfil em `user_id`), preenchido pela API. */
  owner_display_name?: string | null;
  proxy_id?: string | null;
  webhook_configured?: boolean;
  is_blocked_for_instances?: boolean; // Indica se a API Evolution está bloqueada para criação de instâncias
  /** Quando true, a instância não pode ser usada no maturador (definido em Instâncias). */
  blocked_from_maturation?: boolean;
  proxy?: {
    id: string;
    name: string;
    host: string;
  } | null;
}

export interface DbGroup {
  group_id: string;
  group_subject: string;
}

export interface EvolutionGroup {
  id: string;
  subject: string;
  pictureUrl?: string;
  size?: number;
}

export interface Campaign {
  id: string;
  user_id: string;
  observation: string | null;
  group_id: string;
  group_subject: string | null;
  status: string;
  total_contacts: number;
  processed_contacts: number;
  failed_contacts: number;
  strategy: Record<string, any>;
  instances: string[];
  created_at: string;
  updated_at: string;
  started_at?: string | null;
  completed_at?: string | null;
  next_request_at?: string | null;
}

export interface LogEntry {
  timestamp: string;
  type: 'info' | 'success' | 'error';
  message: string;
}

export interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

export const useDashboardData = () => {
  const [userId, setUserId] = useState<string | null>(null);
  const [instances, setInstances] = useState<WhatsAppInstance[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [dbGroups, setDbGroups] = useState<DbGroup[]>([]);
  const [availableGroups, setAvailableGroups] = useState<EvolutionGroup[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [kpiSent, setKpiSent] = useState<number>(0);
  const [kpiAdded, setKpiAdded] = useState<number>(0);
  const [kpiPending, setKpiPending] = useState<number>(0);
  const [kpiConnected, setKpiConnected] = useState<number>(0);
  const [kpiFailedSends, setKpiFailedSends] = useState<number>(0);
  const [kpiFailedAdds, setKpiFailedAdds] = useState<number>(0);
  const [chartData, setChartData] = useState<Array<{ month: string; mensagens: number; adicoes: number }>>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [loadingInitial, setLoadingInitial] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const id =
      sessionStorage.getItem('user_id') ||
      sessionStorage.getItem('profile_id') ||
      window.localStorage.getItem('profile_id');
    setUserId(id);
  }, []);

  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = Math.random().toString(36).substr(2, 9);
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  }, []);

  const addLog = useCallback((message: string, type: 'info' | 'success' | 'error' = 'info') => {
    const ts = new Date().toISOString();
    const entry: LogEntry = { timestamp: ts, type, message };
    if (type === 'error') console.error(`[${ts}] ❌ ${message}`);
    else if (type === 'success') console.log(`[${ts}] ✅ ${message}`);
    else console.log(`[${ts}] ℹ️ ${message}`);
    setLogs(prev => [entry, ...prev].slice(0, 200));
  }, []);

  const loadChartData = useCallback(async (currentUserId: string) => {
    try {
      const twelveMonthsAgo = new Date();
      twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

      const [campaignsResult, contactsResult] = await Promise.all([
        supabase
          .from('campaigns')
          .select('processed_contacts, created_at')
          .eq('user_id', currentUserId)
          .gte('created_at', twelveMonthsAgo.toISOString()),
        supabase
          .from('campaign_contacts')
          .select('status, created_at')
          .eq('user_id', currentUserId)
          .gte('created_at', twelveMonthsAgo.toISOString())
      ]);

      const campaigns = campaignsResult.data || [];
      const contacts = contactsResult.data || [];

      const monthNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
      const monthlyData: Record<string, { mensagens: number; adicoes: number }> = {};

      for (let i = 0; i < 12; i++) {
        const date = new Date();
        date.setMonth(date.getMonth() - (11 - i));
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        monthlyData[monthKey] = { mensagens: 0, adicoes: 0 };
      }

      campaigns.forEach((campaign: any) => {
        if (campaign.created_at) {
          const date = new Date(campaign.created_at);
          const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
          if (monthlyData[monthKey]) {
            monthlyData[monthKey].adicoes += campaign.processed_contacts || 0;
          }
        }
      });

      contacts.forEach((contact: any) => {
        if (contact.created_at && contact.status === "success") {
          const date = new Date(contact.created_at);
          const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
          if (monthlyData[monthKey]) {
            monthlyData[monthKey].mensagens += 1;
          }
        }
      });

      const chartDataArray = Object.keys(monthlyData)
        .sort()
        .map((key) => {
          const date = new Date(key + '-01');
          return {
            month: monthNames[date.getMonth()],
            mensagens: monthlyData[key].mensagens,
            adicoes: monthlyData[key].adicoes,
          };
        });

      setChartData(chartDataArray);
    } catch (error) {
      console.error('Erro ao carregar dados do gráfico:', error);
    }
  }, []);

  const loadInitialData = useCallback(async () => {
    if (!userId) return;
    setLoadingInitial(true);
    try {
      addLog('Carregando dados iniciais...', 'info');

      // Busca instâncias via API (agora usa evolution_instances)
      let instancesData: WhatsAppInstance[] = [];
      try {
        const instancesResponse = await fetch('/api/instances', {
          headers: { 'X-User-Id': userId },
        });
        if (instancesResponse.ok) {
          const instancesResult = await instancesResponse.json();
          if (instancesResult.success && instancesResult.data) {
            instancesData = instancesResult.data as WhatsAppInstance[];
          }
        }
      } catch (instancesError) {
        console.error('Erro ao buscar instâncias via API:', instancesError);
        addLog('Erro ao buscar instâncias. Usando dados locais se disponíveis.', 'error');
      }

      // Busca todos os contatos em lotes (Supabase tem limite de 1000 por query)
      const fetchAllContacts = async () => {
        const allContacts: any[] = [];
        let offset = 0;
        const batchSize = 1000;
        let hasMore = true;

        while (hasMore) {
          const { data, error } = await supabase
            .from('searches')
            .select('id, name, telefone, status_disparo, status_add_gp, status, id_list, block_list, created_at, updated_at')
            .eq('user_id', userId)
            .not('telefone', 'is', null)
            .order('created_at', { ascending: false })
            .range(offset, offset + batchSize - 1);

          if (error) {
            console.error('Erro ao buscar contatos:', error);
            break;
          }

          if (data && data.length > 0) {
            allContacts.push(...data);
            offset += batchSize;
            hasMore = data.length === batchSize; // Se retornou menos que batchSize, não há mais
          } else {
            hasMore = false;
          }
        }

        return { data: allContacts, error: null };
      };

      const [contactsResult, dbGroupstemp, campaignsApiResponse, kpiResults] = await Promise.all([
        fetchAllContacts(),
        supabase
          .from('whatsapp_groups')
          .select('*')
          .eq('user_id', userId)
          .order('group_subject', { ascending: true }),
        // Campanhas via API para ter métricas recalculadas de campaign_contacts (processados/falhas corretos)
        fetch(`/api/campaigns?limit=500`, { headers: { 'X-User-Id': userId } }).then((r) => r.json()),
        Promise.all([
          supabase.from('searches').select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('status_disparo', true),
          supabase.from('campaign_contacts').select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('status', "success"),
          supabase.from('campaign_contacts').select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'queued'),
          supabase.from('searches').select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'failed').eq('status_disparo', false),
          supabase.from('campaign_contacts').select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'failed'),
        ])
      ]);

      setDbGroups(dbGroupstemp.data || [])


      if (!contactsResult.error && contactsResult.data) {
        // Todos os contatos já vêm de fetchAllContacts (em lotes, sem limite)
        const allContacts: Contact[] = contactsResult.data.map((c: any) => ({
          id: c.id,
          name: c.name || undefined,
          telefone: c.telefone,
          status_disparo: c.status_disparo,
          status_add_gp: c.status_add_gp,
          status: c.status,
          id_list: c.id_list || null,
          block_list: !!c.block_list,
          created_at: c.created_at
        }));

        // Bloqueados primeiro; depois disponíveis ordenados por data (mais recentes primeiro)
        const bloqueadosIntegrados = allContacts.filter(c => c.block_list);
        const disponiveisOrdenados = allContacts.filter(c => !c.block_list)
          .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());

        // Retorna todos os contatos importados (sem limite)
        const formatted = [
          ...bloqueadosIntegrados,
          ...disponiveisOrdenados
        ];

        console.log('[useDashboardData] Sincronização Concluída:', {
          totalNoEstado: formatted.length,
          bloqueados: formatted.filter(f => f.block_list).length,
          disponiveis: formatted.filter(f => !f.block_list).length
        });
        
        setContacts(formatted);
      }

      // Usa instâncias buscadas via API (sempre atualiza, mesmo se vazio)
      setInstances(instancesData || []);
      const connectedCount = (instancesData || []).filter((i: any) => i.status === 'connected').length;
      setKpiConnected(connectedCount);
      
      if (instancesData.length > 0) {
        addLog(`Carregadas ${instancesData.length} instância(s), ${connectedCount} conectada(s)`, 'info');
      } else {
        addLog('Nenhuma instância encontrada', 'info');
      }

      if (campaignsApiResponse?.success && campaignsApiResponse?.data?.campaigns) {
        const raw = campaignsApiResponse.data.campaigns as Campaign[];
        const normalized = raw.map((c) => ({
          ...c,
          processed_contacts: Number(c.processed_contacts ?? 0),
          failed_contacts: Number(c.failed_contacts ?? 0),
          total_contacts: Number(c.total_contacts ?? 0),
        }));
        setCampaigns(normalized);
      }

      const [{ count: sent }, { count: added }, { count: pending }, { count: failedSends }, { count: failedAdds }] = kpiResults;
      setKpiSent(sent || 0);
      setKpiAdded(added || 0);
      setKpiPending(pending || 0);
      setKpiFailedSends(failedSends || 0);
      setKpiFailedAdds(failedAdds || 0);

      await loadChartData(userId);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Erro desconhecido';
      addLog(`Erro geral no loadInitialData: ${msg}`, 'error');
      showToast('Erro ao carregar dados do banco', 'error');
    } finally {
      setLoadingInitial(false);
    }
  }, [userId, addLog, showToast, loadChartData]);

  useEffect(() => {
    if (userId) {
      loadInitialData();
    }
  }, [userId, loadInitialData]);

  // Supabase Realtime + Polling híbrido para atualizar campanhas
  useEffect(() => {
    if (!userId) return;

    let interval: NodeJS.Timeout | null = null;
    let subscription: any = null;

    const updateCampaigns = async () => {
      try {
        const res = await fetch(`/api/campaigns?limit=500`, { headers: { 'X-User-Id': userId } });
        const json = await res.json();

        // API retorna métricas recalculadas de campaign_contacts (processados/falhas corretos)
        if (json?.success && json?.data?.campaigns) {
          const raw = json.data.campaigns as Campaign[];
          const normalized = raw.map((c) => ({
            ...c,
            processed_contacts: Number(c.processed_contacts ?? 0),
            failed_contacts: Number(c.failed_contacts ?? 0),
            total_contacts: Number(c.total_contacts ?? 0),
          }));
          setCampaigns(normalized);
        }
      } catch (error: any) {
        const errorMsg = error?.message || String(error);
        console.error('Erro ao atualizar campanhas:', error);
        
        // Se for um erro de conexão fechada, não mostra toast para não spammar,
        // mas loga de forma mais clara
        if (errorMsg.includes('fetch') || errorMsg.includes('connection')) {
          console.warn('Conexão com Supabase instável ou fechada. Tentando reconectar no próximo ciclo...');
        } else {
          // showToast('Erro ao atualizar campanhas', 'error'); // Comentado para evitar spam
        }
      }
    };

    // Inicia atualização imediatamente
    updateCampaigns();

    // Configura Supabase Realtime para campanhas
    try {
      subscription = supabase
        .channel(`campaigns:${userId}`)
        .on(
          'postgres_changes',
          {
            event: '*', // INSERT, UPDATE, DELETE
            schema: 'public',
            table: 'campaigns',
            filter: `user_id=eq.${userId}`,
          },
          () => {
            updateCampaigns();
          }
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'campaign_groups',
            filter: `user_id=eq.${userId}`,
          },
          () => {
            updateCampaigns();
          }
        )
        .subscribe();

      // Polling de fallback: 5s para garantir que adicionados, falhas e timer atualizem
      // (campaigns não está nas deps do effect, então não dá para variar por estado; 5s é seguro)
      interval = setInterval(updateCampaigns, 5000);
    } catch (error) {
      console.error('Erro ao configurar Realtime:', error);
      // Fallback para polling puro se Realtime falhar
      interval = setInterval(updateCampaigns, 5000);
    }

    // Limpa ao desmontar
    return () => {
      if (interval) clearInterval(interval);
      if (subscription) {
        supabase.removeChannel(subscription);
      }
    };
  }, [userId]); // Apenas userId como dependência

  return {
    userId,
    loadingInitial,
    instances,
    contacts,
    dbGroups,
    availableGroups,
    campaigns,
    kpiSent,
    kpiAdded,
    kpiPending,
    kpiConnected,
    kpiFailedSends,
    kpiFailedAdds,
    chartData,
    logs,
    toasts,
    setToasts,
    showToast,
    addLog,
    setInstances,
    setContacts,
    setDbGroups,
    setAvailableGroups,
    setCampaigns,
    loadInitialData,
  };
};

