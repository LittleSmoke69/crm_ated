'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRequireAuth } from '@/utils/useRequireAuth';
import { useRouter } from 'next/navigation';
import Layout from '@/components/Layout';
import { useSidebar } from '@/contexts/SidebarContext';
import FlowInstanceModal from '@/components/Automations/FlowInstanceModal';
import {
  Bot,
  Power,
  PowerOff,
  Settings,
  Loader2,
  Save,
  X,
  Trash2,
  Workflow,
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
  // Grupos para o modal de agentes tradicionais (showConfigModal)
  const [availableGroups, setAvailableGroups] = useState<WhatsAppGroup[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(false);

  const [showFlowInstanceModal, setShowFlowInstanceModal] = useState(false);
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

  // Carrega grupos para o modal de agentes tradicionais
  const loadGroups = async (instanceName: string) => {
    if (!userId || !instanceName) return;
    setLoadingGroups(true);
    try {
      const response = await fetch(`/api/groups?instanceName=${encodeURIComponent(instanceName)}`, {
        headers: { 'X-User-Id': userId! },
      });
      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          setAvailableGroups(
            (result.data || []).map((g: any) => ({
              group_id: g.group_id,
              group_subject: g.group_subject || g.group_id,
            }))
          );
        }
      }
    } catch (err) {
      console.error('Erro ao carregar grupos:', err);
    } finally {
      setLoadingGroups(false);
    }
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

  // Quando muda a instância no modal tradicional (agentes de flow)
  const handleInstanceChange = (instanceId: string) => {
    setConfigForm({ ...configForm, instance_id: instanceId, group_jid: '' });
    const instance = instances.find(i => i.id === instanceId);
    if (instance) {
      setAvailableGroups([]);
      loadGroups(instance.instance_name);
    } else {
      setAvailableGroups([]);
    }
  };

  // Abre modal para configurar flow-instance
  const handleAddFlowInstance = (flow: any) => {
    setSelectedFlow(flow);
    setSelectedFlowInstance(null);
    setShowFlowInstanceModal(true);
  };

  // Abre modal para editar flow-instance
  const handleEditFlowInstance = (flowInstance: any) => {
    setSelectedFlow(flowInstance.flows);
    setSelectedFlowInstance(flowInstance);
    setShowFlowInstanceModal(true);
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
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Agentes IA</h1>
        </div>

        {loading ? (
          <div className="flex items-center justify-center p-8">
            <Loader2 className="w-8 h-8 animate-spin text-[#8CD955]" />
          </div>
        ) : agents.length === 0 && flows.length === 0 ? (
          <div className="bg-white dark:bg-[#2a2a2a] rounded-lg shadow-md dark:border dark:border-[#404040] p-8 text-center text-gray-500 dark:text-gray-400">
            Nenhum agente IA disponível no momento. Os agentes são criados pelo administrador.
          </div>
        ) : (
          <>
            {/* Automações (Flow-Instances) */}
            {flows.length > 0 && (
              <div className="mb-8">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Automações</h2>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
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
                        className="flex items-center gap-2 px-4 py-2 bg-[#8CD955] text-white rounded-lg hover:bg-[#7BC84A] transition font-medium disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
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
                      className="flex items-center gap-2 px-4 py-2 bg-[#8CD955] text-white rounded-lg hover:bg-[#7BC84A] transition font-medium disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                    >
                      <Plus className="w-4 h-4" />
                      Adicionar Automação
                    </button>
                  )}
                </div>
                
                {instances.length === 0 && (
                  <div className="bg-yellow-50 dark:bg-amber-900/20 border border-yellow-200 dark:border-amber-700/50 rounded-lg p-4 mb-6">
                    <p className="text-yellow-800 dark:text-amber-200 text-sm">
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
                                <div key={inst.id} className="bg-white dark:bg-[#2a2a2a] rounded-lg shadow-md border border-gray-200 dark:border-[#404040] p-6 hover:shadow-lg transition-all">
                                  {/* Header do card */}
                                  <div className="flex items-start justify-between mb-4">
                                    <div className="flex items-center gap-3 flex-1 min-w-0">
                                      <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-sm flex-shrink-0">
                                        <Workflow className="w-6 h-6 text-white" />
                                      </div>
                                      <div className="flex-1 min-w-0">
                                        <h3 className="font-semibold text-lg text-gray-900 dark:text-white mb-1.5">
                                          {flow?.name || 'Automação'}
                                        </h3>
                                        <div className="flex items-center gap-2">
                                          <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
                                            inst.is_active
                                              ? 'bg-green-100 dark:bg-[#8CD955]/20 text-green-700 dark:text-[#8CD955]'
                                              : 'bg-gray-100 dark:bg-[#333] text-gray-600 dark:text-gray-400'
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
                                            ? 'bg-green-100 dark:bg-[#8CD955]/20 text-green-700 dark:text-[#8CD955] hover:bg-green-200 dark:hover:bg-[#8CD955]/30'
                                            : 'bg-gray-100 dark:bg-[#333] text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-[#404040]'
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
                                        className="p-1.5 text-[#8CD955] hover:text-[#7BC84A] hover:bg-[#8CD955]/10 dark:hover:bg-[#8CD955]/20 rounded-lg transition"
                                        title="Editar"
                                      >
                                        <Settings className="w-4 h-4" />
                                      </button>
                                      <button
                                        onClick={() => handleDeleteFlowInstance(inst.id)}
                                        className="p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition"
                                        title="Remover"
                                      >
                                        <Trash2 className="w-4 h-4" />
                                      </button>
                                    </div>
                                  </div>

                                  {/* Informações do card */}
                                  <div className="space-y-2.5 mb-4">
                                    <div className="flex items-center gap-2 text-sm">
                                      <span className="font-medium text-gray-700 dark:text-gray-400">Instância:</span>
                                      <span className="text-gray-900 dark:text-white font-semibold">{inst.instance_name || 'N/A'}</span>
                                    </div>
                                    <div className="flex items-center gap-2 text-sm">
                                      <span className="font-medium text-gray-700 dark:text-gray-400">Grupo:</span>
                                      <span className="text-gray-900 dark:text-white font-semibold truncate" title={inst.group_jid || undefined}>
                                        {inst.group_subject || inst.group_jid?.split('@')[0] || '—'}
                                      </span>
                                    </div>
                                  </div>

                                  {/* Descrição */}
                                  {flow?.description && (
                                    <div className="pt-4 border-t border-gray-100 dark:border-[#404040]">
                                      <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
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
                            <div className="flex items-center justify-between border-t border-gray-200 dark:border-[#404040] pt-4">
                              <p className="text-sm text-gray-700 dark:text-gray-300">
                                Mostrando <span className="font-medium">{startIndex + 1}</span> até{' '}
                                <span className="font-medium">{Math.min(endIndex, flowInstances.length)}</span> de{' '}
                                <span className="font-medium">{flowInstances.length}</span> configurações
                              </p>
                              <nav className="isolate inline-flex -space-x-px rounded-md shadow-sm" aria-label="Pagination">
                                <button
                                  onClick={() => setAutomationsCurrentPage(Math.max(1, automationsCurrentPage - 1))}
                                  disabled={automationsCurrentPage === 1}
                                  className="relative inline-flex items-center rounded-l-md px-2 py-2 text-gray-400 dark:text-gray-500 ring-1 ring-inset ring-gray-300 dark:ring-[#555] hover:bg-gray-50 dark:hover:bg-[#404040] focus:z-20 focus:outline-offset-0 disabled:opacity-50 disabled:cursor-not-allowed"
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
                                            ? 'z-10 bg-[#8CD955] text-white focus:z-20'
                                            : 'text-gray-900 dark:text-gray-300 ring-1 ring-inset ring-gray-300 dark:ring-[#555] hover:bg-gray-50 dark:hover:bg-[#404040] focus:z-20'
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
                  <div className="bg-gray-50 dark:bg-[#2a2a2a] border border-gray-200 dark:border-[#404040] rounded-lg p-8 text-center">
                    <Workflow className="w-16 h-16 mx-auto mb-4 text-gray-400 dark:text-gray-500" />
                    <p className="text-gray-700 dark:text-gray-200 font-medium mb-2">Nenhuma automação configurada</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Clique em "Adicionar Automação" para configurar uma instância e grupo</p>
                  </div>
                )}
              </div>
            )}

            {/* Agentes Tradicionais */}
            {agents.length > 0 && (
              <div className={flows.length > 0 ? 'mt-8' : ''}>
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">Agentes IA</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {agents.map((agent) => (
                    <div key={agent.id} className="bg-white dark:bg-[#2a2a2a] rounded-lg shadow-md border border-gray-200 dark:border-[#404040] p-6 hover:shadow-lg transition-shadow">
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex items-center gap-3 flex-1">
                          <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-[#8CD955] to-[#7CC845] flex items-center justify-center shadow-sm flex-shrink-0">
                            <Bot className="w-6 h-6 text-white" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <h3 className="font-semibold text-lg text-gray-900 dark:text-white mb-1">{agent.name}</h3>
                            {agent.description && (
                              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 leading-relaxed">{agent.description}</p>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Configurações existentes */}
                      {agent.user_configs && agent.user_configs.length > 0 && (
                        <div className="mb-4 space-y-2">
                          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Configurações:</p>
                          {agent.user_configs.map((config) => {
                            const instance = instances.find(i => i.id === config.instance_id);
                            const group = availableGroups.find(g => g.group_id === config.group_jid);
                            
                            return (
                              <div key={config.id} className="bg-gray-50 dark:bg-[#333] p-3 rounded-lg">
                                <div className="flex items-center justify-between mb-2">
                                  <div className="flex items-center gap-2">
                                    <button
                                      onClick={() => handleToggleActive(agent, config)}
                                      disabled={saving}
                                      className={`p-1.5 rounded transition ${
                                        config.is_active
                                          ? 'bg-green-100 dark:bg-[#8CD955]/20 text-green-700 dark:text-[#8CD955]'
                                          : 'bg-gray-200 dark:bg-[#404040] text-gray-500 dark:text-gray-400'
                                      }`}
                                    >
                                      {config.is_active ? (
                                        <Power className="w-4 h-4" />
                                      ) : (
                                        <PowerOff className="w-4 h-4" />
                                      )}
                                    </button>
                                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
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
                                <div className="text-xs text-gray-600 dark:text-gray-400 space-y-1">
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
          <div className="bg-white dark:bg-[#2a2a2a] rounded-lg shadow-xl max-w-md w-full border border-gray-200 dark:border-[#404040]">
            <div className="p-6 border-b border-gray-200 dark:border-[#404040] flex items-center justify-between">
              <h3 className="text-xl font-semibold text-gray-900 dark:text-white">
                {selectedFlowAgent
                  ? `Configurar ${selectedFlowAgent.agent_name}`
                  : selectedAgent
                  ? `Configurar ${selectedAgent.name}`
                  : 'Configurar Agente'}
              </h3>
              <button
                onClick={handleCloseModal}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-white"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Instância Mestre *
                </label>
                <select
                  value={configForm.instance_id}
                  onChange={(e) => handleInstanceChange(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-[#555] rounded-lg text-gray-600 dark:text-white bg-white dark:bg-[#333] focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955]"
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
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
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
                    className="w-full px-3 py-2 border border-gray-300 dark:border-[#555] rounded-lg text-gray-600 dark:text-white bg-white dark:bg-[#333] focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] disabled:bg-gray-100 dark:disabled:bg-[#333] disabled:text-gray-400 dark:disabled:text-gray-500"
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
                  className="w-4 h-4 text-[#8CD955] border-gray-300 dark:border-[#555] rounded"
                />
                <label htmlFor="is_active" className="text-sm text-gray-700 dark:text-gray-300">
                  Ativar agente neste grupo
                </label>
              </div>
            </div>

            <div className="p-6 border-t border-gray-200 dark:border-[#404040] flex justify-end gap-4">
              <button
                onClick={handleCloseModal}
                className="px-4 py-2 bg-gray-200 dark:bg-[#333] hover:bg-gray-300 dark:hover:bg-[#404040] rounded-lg text-sm font-medium text-gray-700 dark:text-white"
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
      {userId && (
        <FlowInstanceModal
          show={showFlowInstanceModal && !!selectedFlow}
          userId={userId}
          selectedFlow={selectedFlow}
          selectedFlowInstance={selectedFlowInstance}
          existingInstances={flowInstances}
          instances={instances}
          onClose={() => {
            setShowFlowInstanceModal(false);
            setSelectedFlow(null);
            setSelectedFlowInstance(null);
          }}
          onSaved={async () => {
            setShowFlowInstanceModal(false);
            setSelectedFlow(null);
            setSelectedFlowInstance(null);
            await loadData();
          }}
        />
      )}

    </Layout>
  );
}
