'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRequireAuth } from '@/utils/useRequireAuth';
import { useRouter } from 'next/navigation';
import Layout from '@/components/Layout';
import { useSidebar } from '@/contexts/SidebarContext';
import {
  Bot,
  Power,
  PowerOff,
  Settings,
  Loader2,
  CheckCircle2,
  XCircle,
  Save,
  X,
  Trash2,
  Workflow,
  Users,
  ChevronLeft,
  ChevronRight,
  Plus,
} from 'lucide-react';

interface AIAgent {
  id: string;
  name: string;
  description: string | null;
  system_prompt: string;
  is_active: boolean;
  user_configs: UserAIConfig[];
}

interface FlowAgent {
  id: string;
  agent_name: string;
  system_prompt: string;
  persona_tone: string;
  persona_role: string;
  objective: string;
  is_active: boolean;
  group_jid: string | null;
  instance_id: string | null;
  flow_id: string;
  node_id: string;
  flows: {
    id: string;
    name: string;
    description: string | null;
    status: string;
  };
  evolution_instances: {
    id: string;
    instance_name: string;
    status: string;
  } | null;
}

interface UserAIConfig {
  id: string;
  instance_id: string;
  group_jid: string;
  is_active: boolean;
  evolution_instances: {
    id: string;
    instance_name: string;
    status: string;
  };
}

interface WhatsAppInstance {
  id: string;
  instance_name: string;
  status: string;
  is_master: boolean;
}

interface WhatsAppGroup {
  group_id: string;
  group_subject: string;
}

export default function AIAgentsPage() {
  const { checking, userId } = useRequireAuth();
  const router = useRouter();
  const { isCollapsed, setIsCollapsed, isMobileOpen, setIsMobileOpen } = useSidebar();
  
  const [agents, setAgents] = useState<AIAgent[]>([]);
  const [flowAgents, setFlowAgents] = useState<FlowAgent[]>([]);
  const [flows, setFlows] = useState<any[]>([]);
  const [flowInstances, setFlowInstances] = useState<any[]>([]);
  const [instances, setInstances] = useState<WhatsAppInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  
  // Modal de configuração
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<AIAgent | null>(null);
  const [selectedConfig, setSelectedConfig] = useState<UserAIConfig | null>(null);
  const [selectedFlowAgent, setSelectedFlowAgent] = useState<FlowAgent | null>(null);
  const [selectedFlow, setSelectedFlow] = useState<any>(null);
  const [selectedFlowInstance, setSelectedFlowInstance] = useState<any>(null);
  const [configForm, setConfigForm] = useState({
    instance_id: '',
    group_jid: '',
    is_active: false,
  });
  const [flowInstanceForm, setFlowInstanceForm] = useState<{
    flow_id: string;
    instance_name: string;
    group_jids: string[];
    is_active: boolean;
  }>({
    flow_id: '',
    instance_name: '',
    group_jids: [],
    is_active: true,
  });
  const [availableGroups, setAvailableGroups] = useState<WhatsAppGroup[]>([]);
  const [savedGroups, setSavedGroups] = useState<WhatsAppGroup[]>([]);
  const [fetchingGroups, setFetchingGroups] = useState(false);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [showFlowInstanceModal, setShowFlowInstanceModal] = useState(false);
  const [groupsCurrentPage, setGroupsCurrentPage] = useState(1);
  const [groupsPerPage] = useState(5);
  const [automationsCurrentPage, setAutomationsCurrentPage] = useState(1);
  const [automationsPerPage] = useState(6);

  // Carrega agentes e instâncias mestres
  const loadData = useCallback(async () => {
    if (!userId) return;
    try {
      setLoading(true);
      
      // Carrega agentes tradicionais
      const agentsResponse = await fetch('/api/ai-agents', {
        headers: { 'X-User-Id': userId },
      });
      if (agentsResponse.ok) {
        const agentsResult = await agentsResponse.json();
        if (agentsResult.success) {
          setAgents(agentsResult.data);
        }
      }

      // Carrega agentes de flows (apenas os criados por admin)
      const flowAgentsResponse = await fetch('/api/ai-agents/flow-agents', {
        headers: { 'X-User-Id': userId },
      });
      if (flowAgentsResponse.ok) {
        const flowAgentsResult = await flowAgentsResponse.json();
        console.log('📊 [AI AGENTS PAGE] Flow agents result:', flowAgentsResult);
        if (flowAgentsResult.success) {
          const agentsData = flowAgentsResult.data || [];
          console.log('✅ [AI AGENTS PAGE] Flow agents loaded:', agentsData.length);
          console.log('📋 [AI AGENTS PAGE] Flow agents data:', JSON.stringify(agentsData, null, 2));
          setFlowAgents(agentsData);
        } else {
          console.error('❌ [AI AGENTS PAGE] Flow agents error:', flowAgentsResult.error);
        }
      } else {
        const errorText = await flowAgentsResponse.text();
        console.error('❌ [AI AGENTS PAGE] Flow agents fetch failed:', flowAgentsResponse.status, errorText);
      }

      // Carrega instâncias mestres do usuário
      const instancesResponse = await fetch('/api/instances', {
        headers: { 'X-User-Id': userId },
      });
      if (instancesResponse.ok) {
        const instancesResult = await instancesResponse.json();
        if (instancesResult.success) {
          const allInstances = instancesResult.data || [];
          const masterInstances = allInstances.filter((inst: any) => 
            inst.is_master === true && inst.status === 'connected'
          );
          setInstances(masterInstances);
        }
      }

      // Carrega flows disponíveis (criados pelo admin)
      // Busca todos os flows ativos do sistema, não apenas os do usuário
      const flowsResponse = await fetch('/api/flows', {
        headers: { 'X-User-Id': userId },
      });
      if (flowsResponse.ok) {
        const flowsResult = await flowsResponse.json();
        if (flowsResult.success) {
          // Filtra apenas flows ativos
          const activeFlows = (flowsResult.data || []).filter((flow: any) => 
            flow.status === 'active'
          );
          console.log('✅ [AI AGENTS PAGE] Flows carregados:', activeFlows.length);
          setFlows(activeFlows);
        }
      } else {
        console.error('❌ [AI AGENTS PAGE] Erro ao carregar flows:', flowsResponse.status);
      }

      // Carrega flow-instances do usuário
      const flowInstancesResponse = await fetch('/api/flow-instances', {
        headers: { 'X-User-Id': userId },
      });
      if (flowInstancesResponse.ok) {
        const flowInstancesResult = await flowInstancesResponse.json();
        if (flowInstancesResult.success) {
          setFlowInstances(flowInstancesResult.data || []);
        }
      }
    } catch (err) {
      console.error('Erro ao carregar dados:', err);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (userId && !checking) {
      loadData();
    }
  }, [userId, checking, loadData]);

  // Carrega grupos salvos do usuário primeiro
  const loadSavedGroups = async (instanceName: string) => {
    if (!userId || !instanceName) return;
    try {
      const response = await fetch(`/api/groups?instanceName=${encodeURIComponent(instanceName)}`, {
        headers: { 'X-User-Id': userId! },
      });
      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          const saved = (result.data || []).map((g: any) => ({
            group_id: g.group_id,
            group_subject: g.group_subject || g.group_id,
          }));
          setSavedGroups(saved);
          // Inicialmente mostra apenas os salvos
          setAvailableGroups(saved);
        }
      }
    } catch (err) {
      console.error('Erro ao carregar grupos salvos:', err);
    }
  };

  // Extrai grupos novos da Evolution API
  const fetchNewGroups = async (instanceName: string) => {
    if (!userId || !instanceName) return;
    try {
      setFetchingGroups(true);
      const response = await fetch('/api/groups/fetch', {
        method: 'POST',
        headers: { 'X-User-Id': userId!, 'Content-Type': 'application/json' },
        body: JSON.stringify({ instanceName }),
      });
      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          const fetched = result.data || [];
          // Normaliza os grupos para o formato esperado
          const normalizedGroups = fetched.map((g: any) => ({
            group_id: g.group_id || g.id || g.jid || '',
            group_subject: g.group_subject || g.subject || g.name || g.group_id || g.id || 'Sem nome',
          }));
          // Combina grupos salvos (primeiro) com grupos novos (sem duplicatas)
          const savedIds = new Set(savedGroups.map(g => g.group_id));
          const newGroups = normalizedGroups.filter((g: any) => !savedIds.has(g.group_id));
          setAvailableGroups([...savedGroups, ...newGroups]);
        }
      }
    } catch (err) {
      console.error('Erro ao buscar grupos novos:', err);
      alert('Erro ao buscar grupos da instância');
    } finally {
      setFetchingGroups(false);
    }
  };

  // Carrega grupos (salvos primeiro)
  const loadGroups = async (instanceName: string) => {
    if (!userId || !instanceName) return;
    setLoadingGroups(true);
    await loadSavedGroups(instanceName);
    setLoadingGroups(false);
  };

  // Abre modal para configurar agente de flow
  const handleConfigureFlowAgent = (flowAgent: FlowAgent) => {
    setSelectedAgent(null);
    setSelectedConfig(null);
    setSelectedFlowAgent(flowAgent);
    
    setConfigForm({
      instance_id: flowAgent.instance_id || '',
      group_jid: flowAgent.group_jid || '',
      is_active: flowAgent.is_active || false,
    });
    
    // Carrega grupos se já tem instância
    if (flowAgent.instance_id) {
      const instance = instances.find(i => i.id === flowAgent.instance_id);
      if (instance) {
        loadGroups(instance.instance_name);
      }
    }
    
    setShowConfigModal(true);
  };

  // Abre modal para configurar
  const handleConfigure = (agent: AIAgent, config?: UserAIConfig) => {
    setSelectedFlowAgent(null);
    setSelectedAgent(agent);
    setSelectedConfig(config || null);
    
    if (config) {
      // Editando configuração existente
      setConfigForm({
        instance_id: config.instance_id,
        group_jid: config.group_jid,
        is_active: config.is_active,
      });
      // Carrega grupos da instância
      const instance = instances.find(i => i.id === config.instance_id);
      if (instance) {
        loadGroups(instance.instance_name);
      }
    } else {
      // Nova configuração
      setConfigForm({
        instance_id: instances[0]?.id || '',
        group_jid: '',
        is_active: false,
      });
      if (instances[0]) {
        loadGroups(instances[0].instance_name);
      }
    }
    
    setShowConfigModal(true);
  };

  // Quando muda a instância, recarrega grupos
  const handleInstanceChange = (instanceId: string) => {
    setConfigForm({ ...configForm, instance_id: instanceId, group_jid: '' });
    setGroupsCurrentPage(1); // Reset paginação
    const instance = instances.find(i => i.id === instanceId);
    if (instance) {
      setSavedGroups([]);
      setAvailableGroups([]);
      loadGroups(instance.instance_name);
    } else {
      setSavedGroups([]);
      setAvailableGroups([]);
    }
  };

  // Quando muda a instância no modal de flow-instance, recarrega grupos
  const handleFlowInstanceChange = (instanceName: string) => {
    setFlowInstanceForm({ ...flowInstanceForm, instance_name: instanceName, group_jids: [] });
    setGroupsCurrentPage(1); // Reset paginação
    if (instanceName) {
      setSavedGroups([]);
      setAvailableGroups([]);
      loadGroups(instanceName);
    } else {
      setSavedGroups([]);
      setAvailableGroups([]);
    }
  };

  // Abre modal para configurar flow-instance
  const handleAddFlowInstance = (flow: any) => {
    setSelectedFlow(flow);
    setSelectedFlowInstance(null);
    setFlowInstanceForm({
      flow_id: flow.id,
      instance_name: '',
      group_jids: [],
      is_active: true,
    });
    setAvailableGroups([]);
    setShowFlowInstanceModal(true);
  };

  // Abre modal para editar flow-instance (pode ter vários grupos: flow+instance iguais)
  const handleEditFlowInstance = (flowInstance: any) => {
    setSelectedFlow(flowInstance.flows);
    setSelectedFlowInstance(flowInstance);
    const sameFlowInstance = flowInstances.filter(
      (fi: any) => fi.flow_id === flowInstance.flow_id && fi.instance_name === flowInstance.instance_name
    );
    const groupJids = sameFlowInstance.map((fi: any) => fi.group_jid).filter(Boolean);
    setFlowInstanceForm({
      flow_id: flowInstance.flow_id,
      instance_name: flowInstance.instance_name,
      group_jids: [...new Set(groupJids)],
      is_active: flowInstance.is_active,
    });
    if (flowInstance.instance_name) {
      setSavedGroups([]);
      setAvailableGroups([]);
      loadGroups(flowInstance.instance_name);
    }
    setShowFlowInstanceModal(true);
  };

  // Salva flow-instances: cria uma por grupo selecionado, remove dos desmarcados
  const handleSaveFlowInstance = async () => {
    if (!userId) return;
    if (!flowInstanceForm.flow_id || !flowInstanceForm.instance_name) {
      alert('Selecione a instância.');
      return;
    }
    if (flowInstanceForm.group_jids.length === 0) {
      alert('Selecione ao menos um grupo.');
      return;
    }

    setSaving(true);
    try {
      const { flow_id, instance_name, group_jids, is_active } = flowInstanceForm;
      const current = selectedFlowInstance
        ? flowInstances
            .filter(
              (fi: any) => fi.flow_id === flow_id && fi.instance_name === instance_name
            )
            .map((fi: any) => fi.group_jid)
        : [];
      const toAdd = group_jids.filter((g) => !current.includes(g));
      const toRemove = current.filter((g) => !group_jids.includes(g));

      for (const group_jid of toAdd) {
        const res = await fetch('/api/flow-instances', {
          method: 'POST',
          headers: { 'X-User-Id': userId, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            flow_id,
            instance_name,
            group_jid,
            is_active,
          }),
        });
        if (!res.ok) {
          const data = await res.json();
          alert(data.error || `Erro ao adicionar grupo ${group_jid}`);
          return;
        }
      }

      for (const group_jid of toRemove) {
        const fi = flowInstances.find(
          (f: any) =>
            f.flow_id === flow_id &&
            f.instance_name === instance_name &&
            f.group_jid === group_jid
        );
        if (!fi) continue;
        const res = await fetch(`/api/flow-instances/${fi.id}`, {
          method: 'DELETE',
          headers: { 'X-User-Id': userId },
        });
        if (!res.ok) {
          const data = await res.json();
          alert(data.error || `Erro ao remover grupo`);
          return;
        }
      }

      const remaining = flowInstances.filter(
        (f: any) =>
          f.flow_id === flow_id &&
          f.instance_name === instance_name &&
          group_jids.includes(f.group_jid)
      );
      for (const fi of remaining) {
        const res = await fetch(`/api/flow-instances/${fi.id}`, {
          method: 'PUT',
          headers: { 'X-User-Id': userId, 'Content-Type': 'application/json' },
          body: JSON.stringify({ is_active }),
        });
        if (!res.ok) {
          const data = await res.json();
          alert(data.error || `Erro ao atualizar ativação`);
          return;
        }
      }

      setShowFlowInstanceModal(false);
      await loadData();
    } catch (err) {
      console.error('Erro ao salvar automação:', err);
      alert('Erro ao salvar automação');
    } finally {
      setSaving(false);
    }
  };

  // Remove flow-instance
  const handleDeleteFlowInstance = async (flowInstanceId: string) => {
    if (!userId) return;
    if (!confirm('Tem certeza que deseja remover esta configuração de automação?')) return;

    try {
      const response = await fetch(`/api/flow-instances/${flowInstanceId}`, {
        method: 'DELETE',
        headers: { 'X-User-Id': userId },
      });

      if (response.ok) {
        await loadData();
      } else {
        const result = await response.json();
        alert(result.error || 'Erro ao remover automação');
      }
    } catch (err) {
      console.error('Erro ao remover automação:', err);
      alert('Erro ao remover automação');
    }
  };

  // Toggle ativo/inativo flow-instance
  const handleToggleFlowInstance = async (flowInstance: any) => {
    if (!userId) return;

    setSaving(true);
    try {
      const response = await fetch(`/api/flow-instances/${flowInstance.id}`, {
        method: 'PUT',
        headers: { 'X-User-Id': userId, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          is_active: !flowInstance.is_active,
        }),
      });

      if (response.ok) {
        await loadData();
      } else {
        const result = await response.json();
        alert(result.error || 'Erro ao atualizar automação');
      }
    } catch (err) {
      console.error('Erro ao atualizar automação:', err);
      alert('Erro ao atualizar automação');
    } finally {
      setSaving(false);
    }
  };

  // Fecha modal e limpa estados
  const handleCloseModal = () => {
    setShowConfigModal(false);
    setSelectedAgent(null);
    setSelectedConfig(null);
    setSelectedFlowAgent(null);
    setConfigForm({
      instance_id: '',
      group_jid: '',
      is_active: false,
    });
    setAvailableGroups([]);
  };

  // Salva configuração
  const handleSaveConfig = async () => {
    if (!userId) return;
    
    // Se é um agente de flow
    if (selectedFlowAgent) {
      if (!configForm.instance_id || !configForm.group_jid) {
        alert('Selecione uma instância mestre e um grupo');
        return;
      }

      setSaving(true);
      try {
        const response = await fetch(`/api/ai-agents/flow-agents/${selectedFlowAgent.id}`, {
          method: 'PUT',
          headers: { 'X-User-Id': userId, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            instance_id: configForm.instance_id,
            group_jid: configForm.group_jid,
            is_active: configForm.is_active,
          }),
        });

        if (response.ok) {
          handleCloseModal();
          await loadData();
        } else {
          const result = await response.json();
          alert(result.error || 'Erro ao salvar configuração');
        }
      } catch (err) {
        console.error('Erro ao salvar configuração:', err);
        alert('Erro ao salvar configuração');
      } finally {
        setSaving(false);
      }
      return;
    }

    // Agente tradicional
    if (!selectedAgent) return;
    if (!configForm.instance_id || !configForm.group_jid) {
      alert('Selecione uma instância mestre e um grupo');
      return;
    }

    setSaving(true);
    try {
      const response = await fetch('/api/ai-agents/config', {
        method: 'POST',
        headers: { 'X-User-Id': userId, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ai_agent_id: selectedAgent.id,
          instance_id: configForm.instance_id,
          group_jid: configForm.group_jid,
          is_active: configForm.is_active,
        }),
      });

      if (response.ok) {
        handleCloseModal();
        await loadData();
      } else {
        const result = await response.json();
        alert(result.error || 'Erro ao salvar configuração');
      }
    } catch (err) {
      console.error('Erro ao salvar configuração:', err);
      alert('Erro ao salvar configuração');
    } finally {
      setSaving(false);
    }
  };

  // Remove configuração
  const handleDeleteConfig = async (configId: string) => {
    if (!userId) return;
    if (!confirm('Tem certeza que deseja remover esta configuração?')) return;

    try {
      const response = await fetch(`/api/ai-agents/config?id=${configId}`, {
        method: 'DELETE',
        headers: { 'X-User-Id': userId },
      });

      if (response.ok) {
        await loadData();
      } else {
        const result = await response.json();
        alert(result.error || 'Erro ao remover configuração');
      }
    } catch (err) {
      console.error('Erro ao remover configuração:', err);
      alert('Erro ao remover configuração');
    }
  };

  // Toggle ativo/inativo
  const handleToggleActive = async (agent: AIAgent, config: UserAIConfig) => {
    if (!userId) return;
    
    setSaving(true);
    try {
      const response = await fetch('/api/ai-agents/config', {
        method: 'POST',
        headers: { 'X-User-Id': userId, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ai_agent_id: agent.id,
          instance_id: config.instance_id,
          group_jid: config.group_jid,
          is_active: !config.is_active,
        }),
      });

      if (response.ok) {
        await loadData();
      } else {
        const result = await response.json();
        alert(result.error || 'Erro ao atualizar configuração');
      }
    } catch (err) {
      console.error('Erro ao atualizar configuração:', err);
      alert('Erro ao atualizar configuração');
    } finally {
      setSaving(false);
    }
  };

  // Logout
  const handleSignOut = async () => {
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('user_id');
      sessionStorage.removeItem('profile_id');
      localStorage.removeItem('profile_id');
      window.localStorage.removeItem('profile_id');
      document.cookie = 'user_id=; Path=/; Max-Age=0; SameSite=Lax';
    }
    router.push('/login');
  };

  if (checking) {
    return (
      <Layout onSignOut={handleSignOut}>
        <div className="flex items-center justify-center h-screen">
          <Loader2 className="w-8 h-8 animate-spin text-[#8CD955]" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout onSignOut={handleSignOut}>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold text-gray-900">Agentes IA</h1>
        </div>

        {loading ? (
          <div className="flex items-center justify-center p-8">
            <Loader2 className="w-8 h-8 animate-spin text-[#8CD955]" />
          </div>
        ) : agents.length === 0 && flows.length === 0 ? (
          <div className="bg-white rounded-lg shadow-md p-8 text-center text-gray-500">
            Nenhum agente IA disponível no momento. Os agentes são criados pelo administrador.
          </div>
        ) : (
          <>
            {/* Automações (Flow-Instances) */}
            {flows.length > 0 && (
              <div className="mb-8">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-xl font-semibold text-gray-900">Automações</h2>
                    <p className="text-sm text-gray-600 mt-1">
                      Escolha a instância mestre e o grupo para ativar automações (ex.: Boas-vindas ao entrar no grupo).
                      As variáveis nome, banca e numero personalizam a mensagem com seus dados.
                    </p>
                  </div>
                  {flows.length > 1 ? (
                    <div className="relative">
                      <button
                        onClick={() => {
                          // Se tem mais de um flow, abre o primeiro (o modal pode permitir mudar)
                          if (flows.length > 0) {
                            handleAddFlowInstance(flows[0]);
                          }
                        }}
                        disabled={instances.length === 0}
                        className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-medium disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                      >
                        <Plus className="w-4 h-4" />
                        Adicionar Automação
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => {
                        if (flows.length > 0) {
                          handleAddFlowInstance(flows[0]);
                        }
                      }}
                      disabled={instances.length === 0 || flows.length === 0}
                      className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-medium disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                    >
                      <Plus className="w-4 h-4" />
                      Adicionar Automação
                    </button>
                  )}
                </div>
                
                {instances.length === 0 && (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
                    <p className="text-yellow-800 text-sm">
                      ⚠️ Você precisa ter pelo menos uma instância mestre conectada para configurar as automações.
                    </p>
                  </div>
                )}

                {/* Lista todas as flow-instances como cards individuais */}
                {flowInstances.length > 0 ? (
                  <>
                    {(() => {
                      const startIndex = (automationsCurrentPage - 1) * automationsPerPage;
                      const endIndex = startIndex + automationsPerPage;
                      const currentInstances = flowInstances.slice(startIndex, endIndex);
                      const totalPages = Math.ceil(flowInstances.length / automationsPerPage);

                      return (
                        <>
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
                            {currentInstances.map((inst: any) => {
                              const flow = flows.find((f: any) => f.id === inst.flow_id);
                              const instance = instances.find((i: any) => i.instance_name === inst.instance_name);
                              
                              return (
                                <div key={inst.id} className="bg-white rounded-lg shadow-md border border-gray-200 p-6 hover:shadow-lg transition-all">
                                  {/* Header do card */}
                                  <div className="flex items-start justify-between mb-4">
                                    <div className="flex items-center gap-3 flex-1 min-w-0">
                                      <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-sm flex-shrink-0">
                                        <Workflow className="w-6 h-6 text-white" />
                                      </div>
                                      <div className="flex-1 min-w-0">
                                        <h3 className="font-semibold text-lg text-gray-900 mb-1.5">
                                          {flow?.name || 'Automação'}
                                        </h3>
                                        <div className="flex items-center gap-2">
                                          <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
                                            inst.is_active
                                              ? 'bg-green-100 text-green-700'
                                              : 'bg-gray-100 text-gray-600'
                                          }`}>
                                            {inst.is_active ? 'Ativo' : 'Inativo'}
                                          </span>
                                        </div>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-1 flex-shrink-0">
                                      <button
                                        onClick={() => handleToggleFlowInstance(inst)}
                                        disabled={saving}
                                        className={`p-1.5 rounded-lg transition ${
                                          inst.is_active
                                            ? 'bg-green-100 text-green-700 hover:bg-green-200'
                                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                        }`}
                                        title={inst.is_active ? 'Desativar' : 'Ativar'}
                                      >
                                        {inst.is_active ? (
                                          <Power className="w-4 h-4" />
                                        ) : (
                                          <PowerOff className="w-4 h-4" />
                                        )}
                                      </button>
                                      <button
                                        onClick={() => handleEditFlowInstance(inst)}
                                        className="p-1.5 text-blue-500 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition"
                                        title="Editar"
                                      >
                                        <Settings className="w-4 h-4" />
                                      </button>
                                      <button
                                        onClick={() => handleDeleteFlowInstance(inst.id)}
                                        className="p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition"
                                        title="Remover"
                                      >
                                        <Trash2 className="w-4 h-4" />
                                      </button>
                                    </div>
                                  </div>

                                  {/* Informações do card */}
                                  <div className="space-y-2.5 mb-4">
                                    <div className="flex items-center gap-2 text-sm">
                                      <span className="font-medium text-gray-700">Instância:</span>
                                      <span className="text-gray-900 font-semibold">{inst.instance_name || 'N/A'}</span>
                                    </div>
                                    <div className="flex items-center gap-2 text-sm">
                                      <span className="font-medium text-gray-700">Grupo:</span>
                                      <span className="text-gray-900 font-semibold truncate" title={inst.group_jid || undefined}>
                                        {inst.group_subject || inst.group_jid?.split('@')[0] || '—'}
                                      </span>
                                    </div>
                                  </div>

                                  {/* Descrição */}
                                  {flow?.description && (
                                    <div className="pt-4 border-t border-gray-100">
                                      <p className="text-sm text-gray-600 leading-relaxed">
                                        {flow.description}
                                      </p>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>

                          {/* Paginação dos cards */}
                          {totalPages > 1 && (
                            <div className="flex items-center justify-between border-t border-gray-200 pt-4">
                              <p className="text-sm text-gray-700">
                                Mostrando <span className="font-medium">{startIndex + 1}</span> até{' '}
                                <span className="font-medium">{Math.min(endIndex, flowInstances.length)}</span> de{' '}
                                <span className="font-medium">{flowInstances.length}</span> configurações
                              </p>
                              <nav className="isolate inline-flex -space-x-px rounded-md shadow-sm" aria-label="Pagination">
                                <button
                                  onClick={() => setAutomationsCurrentPage(Math.max(1, automationsCurrentPage - 1))}
                                  disabled={automationsCurrentPage === 1}
                                  className="relative inline-flex items-center rounded-l-md px-2 py-2 text-gray-400 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 focus:z-20 focus:outline-offset-0 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                  <ChevronLeft className="h-5 w-5" />
                                </button>
                                {Array.from({ length: totalPages }, (_, i) => i + 1)
                                  .filter(page => {
                                    if (totalPages <= 5) return true;
                                    if (automationsCurrentPage <= 3) return page <= 4 || page === totalPages;
                                    if (automationsCurrentPage >= totalPages - 2) return page === 1 || page >= totalPages - 3;
                                    return page === 1 || page === totalPages || (page >= automationsCurrentPage - 1 && page <= automationsCurrentPage + 1);
                                  })
                                  .map((page, index, arr) => (
                                    <React.Fragment key={page}>
                                      {index > 0 && arr[index - 1] !== page - 1 && (
                                        <span className="relative inline-flex items-center px-4 py-2 text-sm font-semibold text-gray-700 ring-1 ring-inset ring-gray-300">
                                          ...
                                        </span>
                                      )}
                                      <button
                                        onClick={() => setAutomationsCurrentPage(page)}
                                        className={`relative inline-flex items-center px-4 py-2 text-sm font-semibold ${
                                          automationsCurrentPage === page
                                            ? 'z-10 bg-blue-600 text-white focus:z-20'
                                            : 'text-gray-900 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 focus:z-20'
                                        }`}
                                      >
                                        {page}
                                      </button>
                                    </React.Fragment>
                                  ))}
                                <button
                                  onClick={() => setAutomationsCurrentPage(Math.min(totalPages, automationsCurrentPage + 1))}
                                  disabled={automationsCurrentPage === totalPages}
                                  className="relative inline-flex items-center rounded-r-md px-2 py-2 text-gray-400 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 focus:z-20 focus:outline-offset-0 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                  <ChevronRight className="h-5 w-5" />
                                </button>
                              </nav>
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </>
                ) : (
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
                    <Workflow className="w-16 h-16 mx-auto mb-4 text-gray-400" />
                    <p className="text-gray-700 font-medium mb-2">Nenhuma automação configurada</p>
                    <p className="text-sm text-gray-500 mb-4">Clique em "Adicionar Automação" para configurar uma instância e grupo</p>
                  </div>
                )}
              </div>
            )}

            {/* Agentes Tradicionais */}
            {agents.length > 0 && (
              <div className={flows.length > 0 ? 'mt-8' : ''}>
                <h2 className="text-xl font-semibold text-gray-900 mb-4">Agentes IA</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {agents.map((agent) => (
                    <div key={agent.id} className="bg-white rounded-lg shadow-md border border-gray-200 p-6 hover:shadow-lg transition-shadow">
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex items-center gap-3 flex-1">
                          <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-[#8CD955] to-[#7CC845] flex items-center justify-center shadow-sm flex-shrink-0">
                            <Bot className="w-6 h-6 text-white" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <h3 className="font-semibold text-lg text-gray-900 mb-1">{agent.name}</h3>
                            {agent.description && (
                              <p className="text-sm text-gray-600 mt-1 leading-relaxed">{agent.description}</p>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Configurações existentes */}
                      {agent.user_configs && agent.user_configs.length > 0 && (
                        <div className="mb-4 space-y-2">
                          <p className="text-xs font-medium text-gray-500 uppercase">Configurações:</p>
                          {agent.user_configs.map((config) => {
                            const instance = instances.find(i => i.id === config.instance_id);
                            const group = availableGroups.find(g => g.group_id === config.group_jid);
                            
                            return (
                              <div key={config.id} className="bg-gray-50 p-3 rounded-lg">
                                <div className="flex items-center justify-between mb-2">
                                  <div className="flex items-center gap-2">
                                    <button
                                      onClick={() => handleToggleActive(agent, config)}
                                      disabled={saving}
                                      className={`p-1.5 rounded transition ${
                                        config.is_active
                                          ? 'bg-green-100 text-green-700'
                                          : 'bg-gray-200 text-gray-500'
                                      }`}
                                    >
                                      {config.is_active ? (
                                        <Power className="w-4 h-4" />
                                      ) : (
                                        <PowerOff className="w-4 h-4" />
                                      )}
                                    </button>
                                    <span className="text-sm font-medium text-gray-700">
                                      {config.is_active ? 'Ativo' : 'Inativo'}
                                    </span>
                                  </div>
                                  <button
                                    onClick={() => handleDeleteConfig(config.id)}
                                    className="text-red-500 hover:text-red-700"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                                <div className="text-xs text-gray-600 space-y-1">
                                  <div>
                                    <span className="font-medium">Instância:</span>{' '}
                                    {instance?.instance_name || 'N/A'}
                                  </div>
                                  <div>
                                    <span className="font-medium">Grupo:</span>{' '}
                                    {group?.group_subject || config.group_jid}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      <button
                        onClick={() => handleConfigure(agent)}
                        className="w-full px-4 py-2.5 bg-gradient-to-r from-[#8CD955] to-[#7CC845] text-white rounded-lg hover:from-[#7CC845] hover:to-[#6CB835] transition font-medium flex items-center justify-center gap-2 shadow-sm hover:shadow-md"
                      >
                        <Settings className="w-4 h-4" />
                        {agent.user_configs && agent.user_configs.length > 0 ? 'Adicionar Configuração' : 'Configurar'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Modal de configuração */}
      {showConfigModal && (selectedAgent || selectedFlowAgent) && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
            <div className="p-6 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-xl font-semibold">
                {selectedFlowAgent
                  ? `Configurar ${selectedFlowAgent.agent_name}`
                  : selectedAgent
                  ? `Configurar ${selectedAgent.name}`
                  : 'Configurar Agente'}
              </h3>
              <button
                onClick={handleCloseModal}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Instância Mestre *
                </label>
                <select
                  value={configForm.instance_id}
                  onChange={(e) => handleInstanceChange(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-600 bg-white focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500"
                >
                  <option value="" className="text-gray-400">Selecione uma instância</option>
                  {instances.map((inst) => (
                    <option key={inst.id} value={inst.id} className="text-gray-700">
                      {inst.instance_name} ({inst.status})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Grupo *
                </label>
                {loadingGroups ? (
                  <div className="flex items-center justify-center p-4">
                    <Loader2 className="w-5 h-5 animate-spin text-[#8CD955]" />
                  </div>
                ) : (
                  <select
                    value={configForm.group_jid}
                    onChange={(e) => setConfigForm({ ...configForm, group_jid: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-600 bg-white focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 disabled:bg-gray-100 disabled:text-gray-400"
                    disabled={!configForm.instance_id || availableGroups.length === 0}
                  >
                    <option value="" className="text-gray-400">
                      {!configForm.instance_id 
                        ? 'Selecione uma instância primeiro'
                        : availableGroups.length === 0
                        ? 'Nenhum grupo encontrado'
                        : 'Selecione um grupo'}
                    </option>
                    {availableGroups.map((group) => (
                      <option key={group.group_id} value={group.group_id} className="text-gray-700">
                        {group.group_subject}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="is_active"
                  checked={configForm.is_active}
                  onChange={(e) => setConfigForm({ ...configForm, is_active: e.target.checked })}
                  className="w-4 h-4 text-[#8CD955] border-gray-300 rounded"
                />
                <label htmlFor="is_active" className="text-sm text-gray-700">
                  Ativar agente neste grupo
                </label>
              </div>
            </div>

            <div className="p-6 border-t border-gray-200 flex justify-end gap-4">
              <button
                onClick={handleCloseModal}
                className="px-4 py-2 bg-gray-200 hover:bg-gray-300 rounded-lg text-sm font-medium"
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveConfig}
                disabled={saving || !configForm.instance_id || !configForm.group_jid}
                className="px-4 py-2 bg-[#8CD955] text-white rounded-lg hover:bg-[#7CC845] transition font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {saving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Salvando...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    Salvar
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal para configurar flow-instance */}
      {showFlowInstanceModal && selectedFlow && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col">
            <div className="px-6 py-5 border-b border-gray-200 flex items-center justify-between bg-gray-50 rounded-t-xl">
              <div>
                <h3 className="text-xl font-bold text-gray-900">
                  {selectedFlowInstance ? 'Editar' : 'Configurar'} Automação
                </h3>
                <p className="text-sm text-gray-600 mt-0.5">{selectedFlow.name}</p>
              </div>
              <button
                onClick={() => {
                  setShowFlowInstanceModal(false);
                  setSelectedFlow(null);
                  setSelectedFlowInstance(null);
                  setFlowInstanceForm({
                    flow_id: '',
                    instance_name: '',
                    group_jids: [],
                    is_active: true,
                  });
                  setAvailableGroups([]);
                  setSavedGroups([]);
                  setGroupsCurrentPage(1);
                }}
                className="text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg p-1.5 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-6 space-y-5 overflow-y-auto flex-1">
              <div>
                <label className="block text-sm font-semibold text-gray-900 mb-2">
                  Instância Mestre <span className="text-red-500">*</span>
                </label>
                <select
                  value={flowInstanceForm.instance_name}
                  onChange={(e) => handleFlowInstanceChange(e.target.value)}
                  className="w-full px-4 py-2.5 border-2 border-gray-300 rounded-lg text-gray-700 bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors shadow-sm"
                >
                  <option value="" className="text-gray-400">Selecione uma instância</option>
                  {instances.map((inst) => (
                    <option key={inst.instance_name} value={inst.instance_name} className="text-gray-700">
                      {inst.instance_name} ({inst.status})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <label className="block text-sm font-semibold text-gray-900">
                      Grupos <span className="text-red-500">*</span>
                    </label>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Selecione um ou mais. A automação rodará em todos.
                    </p>
                  </div>
                  {flowInstanceForm.instance_name && (
                    <button
                      type="button"
                      onClick={() => fetchNewGroups(flowInstanceForm.instance_name)}
                      disabled={fetchingGroups}
                      className="text-xs text-blue-600 hover:text-blue-700 font-semibold flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-blue-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {fetchingGroups ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          Buscando...
                        </>
                      ) : (
                        <>
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                          Buscar grupos novos
                        </>
                      )}
                    </button>
                  )}
                </div>
                {loadingGroups ? (
                  <div className="flex items-center justify-center p-4">
                    <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
                  </div>
                ) : (() => {
                  const ids = new Set(availableGroups.map((g: any) => g.group_id || g.id));
                  const extra = flowInstanceForm.group_jids
                    .filter((gid) => !ids.has(gid))
                    .map((gid) => ({ group_id: gid, group_subject: gid }));
                  const allGroupsForSelect = [...availableGroups, ...extra];
                  return allGroupsForSelect.length === 0;
                })() ? (
                  <div className="text-center py-8 text-gray-500">
                    <Users className="w-12 h-12 mx-auto mb-2 text-gray-400" />
                    <p className="text-sm">Nenhum grupo encontrado</p>
                    <p className="text-xs mt-1">Clique em "Buscar grupos novos" para extrair grupos da instância</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {/* Lista de grupos com visualização em cards */}
                    <div className="border border-gray-200 rounded-lg">
                      {(() => {
                        const ids = new Set(availableGroups.map((g: any) => g.group_id || g.id));
                        const extra = flowInstanceForm.group_jids
                          .filter((gid) => !ids.has(gid))
                          .map((gid) => ({ group_id: gid, group_subject: gid }));
                        const allGroupsForSelect = [...availableGroups, ...extra];
                        const startIndex = (groupsCurrentPage - 1) * groupsPerPage;
                        const endIndex = startIndex + groupsPerPage;
                        const currentGroups = allGroupsForSelect.slice(startIndex, endIndex);
                        const totalPages = Math.ceil(allGroupsForSelect.length / groupsPerPage);

                        return (
                          <>
                            <div className="p-2 space-y-1">
                              {currentGroups.map((group) => {
                                const isSaved = savedGroups.some(sg => sg.group_id === group.group_id);
                                const gid = group.group_id || (group as any).id;
                                const isSelected = flowInstanceForm.group_jids.includes(gid);
                                const toggle = () => {
                                  setFlowInstanceForm((prev) => {
                                    if (prev.group_jids.includes(gid)) {
                                      return { ...prev, group_jids: prev.group_jids.filter((id) => id !== gid) };
                                    }
                                    return { ...prev, group_jids: [...prev.group_jids, gid] };
                                  });
                                };
                                return (
                                  <div
                                    key={gid}
                                    role="button"
                                    tabIndex={0}
                                    onClick={toggle}
                                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }}
                                    className={`p-3 rounded-lg border-2 cursor-pointer transition-all ${
                                      isSelected
                                        ? 'border-blue-500 bg-blue-50 shadow-sm'
                                        : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50 hover:shadow-sm'
                                    }`}
                                  >
                                    <div className="flex items-center gap-3">
                                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                                        isSaved
                                          ? 'bg-green-100 text-green-600'
                                          : 'bg-blue-100 text-blue-600'
                                      }`}>
                                        <Users className="w-5 h-5" />
                                      </div>
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                          <p className={`font-medium text-sm truncate ${
                                            isSelected ? 'text-blue-900' : 'text-gray-900'
                                          }`}>
                                            {group.group_subject || (group as any).subject || group.group_id || (group as any).id || 'Grupo sem nome'}
                                          </p>
                                          {isSaved && (
                                            <span className="flex-shrink-0 px-1.5 py-0.5 text-xs font-medium bg-green-100 text-green-700 rounded">
                                              Salvo
                                            </span>
                                          )}
                                        </div>
                                        <p className="text-xs text-gray-500 truncate mt-0.5">
                                          {group.group_id || (group as any).id || 'N/A'}
                                        </p>
                                      </div>
                                      {isSelected && (
                                        <div className="flex-shrink-0">
                                          <CheckCircle2 className="w-5 h-5 text-blue-600" />
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                            
                            {/* Paginação */}
                            {totalPages > 1 && (
                              <div className="border-t border-gray-200 px-4 py-3 space-y-3">
                                {/* Texto de informações */}
                                <div className="text-center sm:text-left">
                                  <p className="text-sm text-gray-700">
                                    Mostrando <span className="font-medium">{startIndex + 1}</span> até{' '}
                                    <span className="font-medium">{Math.min(endIndex, allGroupsForSelect.length)}</span> de{' '}
                                    <span className="font-medium">{allGroupsForSelect.length}</span> grupos
                                  </p>
                                </div>
                                
                                {/* Controles de paginação */}
                                <div className="flex items-center justify-between">
                                  {/* Mobile: botões simples */}
                                  <div className="flex-1 flex justify-between sm:hidden">
                                    <button
                                      onClick={() => setGroupsCurrentPage(Math.max(1, groupsCurrentPage - 1))}
                                      disabled={groupsCurrentPage === 1}
                                      className="relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                      Anterior
                                    </button>
                                    <button
                                      onClick={() => setGroupsCurrentPage(Math.min(totalPages, groupsCurrentPage + 1))}
                                      disabled={groupsCurrentPage === totalPages}
                                      className="ml-3 relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                      Próxima
                                    </button>
                                  </div>
                                  
                                  {/* Desktop: paginação completa */}
                                  <div className="hidden sm:flex sm:w-full sm:justify-center">
                                    <nav className="isolate inline-flex -space-x-px rounded-md shadow-sm" aria-label="Pagination">
                                      <button
                                        onClick={() => setGroupsCurrentPage(Math.max(1, groupsCurrentPage - 1))}
                                        disabled={groupsCurrentPage === 1}
                                        className="relative inline-flex items-center rounded-l-md px-2 py-2 text-gray-400 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 focus:z-20 focus:outline-offset-0 disabled:opacity-50 disabled:cursor-not-allowed"
                                      >
                                        <ChevronLeft className="h-5 w-5" />
                                      </button>
                                      {Array.from({ length: totalPages }, (_, i) => i + 1)
                                        .filter(page => {
                                          if (totalPages <= 5) return true;
                                          if (groupsCurrentPage <= 3) return page <= 4 || page === totalPages;
                                          if (groupsCurrentPage >= totalPages - 2) return page === 1 || page >= totalPages - 3;
                                          return page === 1 || page === totalPages || (page >= groupsCurrentPage - 1 && page <= groupsCurrentPage + 1);
                                        })
                                        .map((page, index, arr) => (
                                          <React.Fragment key={page}>
                                            {index > 0 && arr[index - 1] !== page - 1 && (
                                              <span className="relative inline-flex items-center px-4 py-2 text-sm font-semibold text-gray-700 ring-1 ring-inset ring-gray-300">
                                                ...
                                              </span>
                                            )}
                                            <button
                                              onClick={() => setGroupsCurrentPage(page)}
                                              className={`relative inline-flex items-center px-4 py-2 text-sm font-semibold ${
                                                groupsCurrentPage === page
                                                  ? 'z-10 bg-blue-600 text-white focus:z-20'
                                                  : 'text-gray-900 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 focus:z-20'
                                              }`}
                                            >
                                              {page}
                                            </button>
                                          </React.Fragment>
                                        ))}
                                      <button
                                        onClick={() => setGroupsCurrentPage(Math.min(totalPages, groupsCurrentPage + 1))}
                                        disabled={groupsCurrentPage === totalPages}
                                        className="relative inline-flex items-center rounded-r-md px-2 py-2 text-gray-400 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 focus:z-20 focus:outline-offset-0 disabled:opacity-50 disabled:cursor-not-allowed"
                                      >
                                        <ChevronRight className="h-5 w-5" />
                                      </button>
                                    </nav>
                                  </div>
                                </div>
                              </div>
                            )}
                            
                            {/* Contador de grupos salvos */}
                            {savedGroups.length > 0 && (
                              <p className="text-xs text-gray-500 flex items-center gap-1 px-2">
                                <svg className="w-3 h-3 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                </svg>
                                {savedGroups.length} grupo(s) salvo(s) encontrado(s)
                              </p>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  </div>
                )}
              </div>

              {flowInstanceForm.group_jids.length > 0 && (
                <p className="text-sm text-gray-600">
                  <span className="font-medium">{flowInstanceForm.group_jids.length}</span> grupo(s) selecionado(s).
                </p>
              )}
              <div className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg border border-gray-200">
                <input
                  type="checkbox"
                  id="is_active_flow_instance"
                  checked={flowInstanceForm.is_active}
                  onChange={(e) => setFlowInstanceForm({ ...flowInstanceForm, is_active: e.target.checked })}
                  className="w-5 h-5 text-blue-600 border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                />
                <label htmlFor="is_active_flow_instance" className="text-sm font-medium text-gray-900 cursor-pointer">
                  Automação ativa nos grupos selecionados
                </label>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-xl flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowFlowInstanceModal(false);
                  setSelectedFlow(null);
                  setSelectedFlowInstance(null);
                  setFlowInstanceForm({
                    flow_id: '',
                    instance_name: '',
                    group_jids: [],
                    is_active: true,
                  });
                  setAvailableGroups([]);
                  setSavedGroups([]);
                  setGroupsCurrentPage(1);
                }}
                className="px-5 py-2.5 bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 rounded-lg text-sm font-medium transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveFlowInstance}
                disabled={saving || !flowInstanceForm.instance_name || flowInstanceForm.group_jids.length === 0}
                className="px-5 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-sm hover:shadow-md"
              >
                {saving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Salvando...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    Salvar
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
