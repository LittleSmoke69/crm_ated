'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRequireAuth } from '@/utils/useRequireAuth';
import { useTenantRouter } from '@/lib/utils/tenant-href';
import Link from '@/components/WhitelabelLink';
import Layout from '@/components/Layout';
import { useSidebar } from '@/contexts/SidebarContext';
import {
  Plus,
  Edit,
  Trash2,
  Save,
  X,
  Loader2,
  Bot,
  CheckCircle2,
  XCircle,
  Settings,
  Power,
  PowerOff,
  Workflow,
} from 'lucide-react';

interface AIAgent {
  id: string;
  name: string;
  description: string | null;
  system_prompt: string;
  is_active: boolean;
  tone?: 'amigavel' | 'neutro' | 'profissional' | 'agradavel' | 'technical' | null;
  persona?: string | null;
  prompt_template?: string | null;
  created_at: string;
  updated_at: string;
}

export default function AdminAIAgentsPage() {
  const { checking, userId } = useRequireAuth();
  const router = useTenantRouter();
  const { isCollapsed, setIsCollapsed, isMobileOpen, setIsMobileOpen } = useSidebar();
  
  const [agents, setAgents] = useState<AIAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Automações (Flows)
  const [flows, setFlows] = useState<any[]>([]);
  const [flowInstances, setFlowInstances] = useState<any[]>([]);
  const [loadingFlows, setLoadingFlows] = useState(true);
  // Modal de criação/edição (removido - admin não configura mais flow-instances)
  const [showModal, setShowModal] = useState(false);
  const [editingAgent, setEditingAgent] = useState<AIAgent | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    system_prompt: '',
    is_active: true,
    tone: '' as 'amigavel' | 'neutro' | 'profissional' | 'agradavel' | 'technical' | '',
    persona: '',
    prompt_template: '',
  });

  // Carrega agentes
  const loadAgents = useCallback(async () => {
    if (!userId) return;
    try {
      setLoading(true);
      const response = await fetch('/api/admin/ai-agents', {
        headers: { 'X-User-Id': userId },
      });
      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          // Mapeia 'instructions' para 'system_prompt' e 'enabled' para 'is_active'
          const mappedAgents = (result.data || []).map((agent: any) => ({
            ...agent,
            system_prompt: agent.instructions || agent.system_prompt || '',
            is_active: agent.enabled !== undefined ? agent.enabled : (agent.is_active !== undefined ? agent.is_active : true),
          }));
          setAgents(mappedAgents);
        }
      }
    } catch (err) {
      console.error('Erro ao carregar agentes:', err);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  // Carrega flows
  const loadFlows = useCallback(async () => {
    if (!userId) return;
    try {
      setLoadingFlows(true);
      const response = await fetch('/api/admin/flows', {
        headers: { 'X-User-Id': userId },
      });
      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          setFlows(result.data || []);
        }
      }
    } catch (err) {
      console.error('Erro ao carregar flows:', err);
    } finally {
      setLoadingFlows(false);
    }
  }, [userId]);

  // Carrega instâncias de flows de todos os usuários (admin pode ver tudo)
  const loadFlowInstances = useCallback(async () => {
    if (!userId) return;
    try {
      // Busca todas as flow-instances do sistema (admin vê todas)
      const response = await fetch('/api/admin/flow-instances/all', {
        headers: { 'X-User-Id': userId },
      });
      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          setFlowInstances(result.data || []);
        }
      } else {
        // Fallback: se o endpoint /all não existe, tenta buscar todas manualmente
        // Por enquanto, busca apenas as do admin até que o endpoint /all seja implementado
        const fallbackResponse = await fetch('/api/admin/flow-instances', {
          headers: { 'X-User-Id': userId },
        });
        if (fallbackResponse.ok) {
          const fallbackResult = await fallbackResponse.json();
          if (fallbackResult.success) {
            setFlowInstances(fallbackResult.data || []);
          }
        }
      }
    } catch (err) {
      console.error('Erro ao carregar instâncias de flows:', err);
    }
  }, [userId]);

  useEffect(() => {
    if (userId && !checking) {
      loadAgents();
      loadFlows();
      loadFlowInstances();
    }
  }, [userId, checking, loadAgents, loadFlows, loadFlowInstances]);


  // Admin não pode mais alterar/remover flow-instances criadas por outros usuários

  // Abre modal para criar
  const handleCreate = () => {
    setEditingAgent(null);
    setFormData({
      name: '',
      description: '',
      system_prompt: '',
      is_active: true,
      tone: '',
      persona: '',
      prompt_template: '',
    });
    setShowModal(true);
  };

  // Abre modal para editar
  const handleEdit = (agent: AIAgent) => {
    setEditingAgent(agent);
    setFormData({
      name: agent.name,
      description: agent.description || '',
      system_prompt: agent.system_prompt || (agent as any).instructions || '',
      is_active: agent.is_active !== undefined ? agent.is_active : ((agent as any).enabled !== undefined ? (agent as any).enabled : true),
      tone: agent.tone || '',
      persona: agent.persona || '',
      prompt_template: agent.prompt_template || '',
    });
    setShowModal(true);
  };

  // Salva agente
  const handleSave = async () => {
    if (!userId) return;
    if (!formData.name || !formData.system_prompt) {
      alert('Nome e Prompt do Sistema são obrigatórios');
      return;
    }

    setSaving(true);
    try {
      const url = editingAgent 
        ? `/api/admin/ai-agents/${editingAgent.id}`
        : '/api/admin/ai-agents';
      
      const method = editingAgent ? 'PUT' : 'POST';
      
      const response = await fetch(url, {
        method,
        headers: { 'X-User-Id': userId, 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (response.ok) {
        setShowModal(false);
        await loadAgents();
      } else {
        const result = await response.json();
        alert(result.error || 'Erro ao salvar agente');
      }
    } catch (err) {
      console.error('Erro ao salvar agente:', err);
      alert('Erro ao salvar agente');
    } finally {
      setSaving(false);
    }
  };

  // Deleta agente
  const handleDelete = async (agent: AIAgent) => {
    if (!userId) return;
    if (!confirm(`Tem certeza que deseja deletar o agente "${agent.name}"?`)) return;

    try {
      const response = await fetch(`/api/admin/ai-agents/${agent.id}`, {
        method: 'DELETE',
        headers: { 'X-User-Id': userId },
      });

      if (response.ok) {
        await loadAgents();
      } else {
        const result = await response.json();
        alert(result.error || 'Erro ao deletar agente');
      }
    } catch (err) {
      console.error('Erro ao deletar agente:', err);
      alert('Erro ao deletar agente');
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
    router.push('/admin/login');
  };

  if (checking) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-screen">
          <Loader2 className="w-8 h-8 animate-spin text-[#E86A24]" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout onSignOut={handleSignOut}>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold text-gray-900">Agentes IA</h1>
          <button
            onClick={handleCreate}
            className="flex items-center gap-2 px-4 py-2 bg-[#E86A24] text-white rounded-lg hover:bg-[#7CC845] transition"
          >
            <Plus className="w-5 h-5" />
            Criar Agente
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center p-8">
            <Loader2 className="w-8 h-8 animate-spin text-[#E86A24]" />
          </div>
        ) : agents.length === 0 ? (
          <div className="bg-white rounded-lg shadow-md p-8 text-center text-gray-500">
            Nenhum agente IA criado ainda
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {agents.map((agent) => (
              <div key={agent.id} className="bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow p-6 border border-gray-100">
                {/* Header com ícone e nome */}
                <div className="flex items-start gap-4 mb-5">
                  <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-[#E86A24] to-[#7CC845] flex items-center justify-center shadow-lg flex-shrink-0">
                    <Bot className="w-8 h-8 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-xl text-gray-900 mb-2 leading-tight">{agent.name}</h3>
                    <div className="flex items-center gap-2">
                      {(agent.is_active !== undefined ? agent.is_active : ((agent as any).enabled !== undefined ? (agent as any).enabled : false)) ? (
                        <span className="flex items-center gap-1.5 text-xs font-medium text-green-700 bg-green-50 px-2 py-1 rounded-full">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Ativo
                        </span>
                      ) : (
                        <span className="flex items-center gap-1.5 text-xs font-medium text-gray-500 bg-gray-50 px-2 py-1 rounded-full">
                          <XCircle className="w-3.5 h-3.5" />
                          Inativo
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                
                {/* Descrição */}
                {agent.description && (
                  <p className="text-sm text-gray-600 mb-4 leading-relaxed">{agent.description}</p>
                )}
                
                {/* Prompt do Sistema */}
                <div className="mb-5">
                  <p className="text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wide">Prompt do Sistema:</p>
                  <p className="text-sm text-gray-700 bg-gray-50 p-3 rounded-lg border border-gray-200 max-h-32 overflow-y-auto leading-relaxed">
                    {agent.system_prompt || (agent as any).instructions || ''}
                  </p>
                </div>

                {/* Botões de ação */}
                <div className="flex gap-2 pt-4 border-t border-gray-100">
                  <button
                    onClick={() => handleEdit(agent)}
                    className="flex-1 px-4 py-2.5 bg-[#E86A24] hover:bg-[#7CC845] text-white rounded-lg font-semibold text-sm transition-all shadow-sm hover:shadow-md flex items-center justify-center gap-2"
                  >
                    <Edit className="w-4 h-4" />
                    Editar
                  </button>
                  <button
                    onClick={() => handleDelete(agent)}
                    className="px-4 py-2.5 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg font-medium text-sm transition-all shadow-sm hover:shadow-md"
                    title="Deletar agente"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Seção de Automações */}
        <div className="mt-12">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-gray-900">Automações</h2>
          </div>

          {loadingFlows ? (
            <div className="flex items-center justify-center p-8">
              <Loader2 className="w-8 h-8 animate-spin text-[#E86A24]" />
            </div>
          ) : flows.length === 0 ? (
            <div className="bg-white rounded-lg shadow-md p-8 text-center text-gray-500">
              Nenhuma automação criada. Crie uma automação em <Link href="/admin/flows" className="text-[#E86A24] underline">Flows</Link> primeiro.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {flows.map((flow) => {
                const flowInsts = flowInstances.filter((fi: any) => fi.flow_id === flow.id);
                const activeInstances = flowInsts.filter((inst: any) => inst.is_active).length;
                return (
                  <div key={flow.id} className="bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow p-6 border border-gray-100">
                    {/* Header com ícone e nome */}
                    <div className="flex items-start gap-4 mb-5">
                      <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-lg flex-shrink-0">
                        <Workflow className="w-8 h-8 text-white" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-bold text-xl text-gray-900 mb-2 leading-tight">{flow.name}</h3>
                        <div className="flex items-center gap-2">
                          {flow.status === 'active' ? (
                            <span className="flex items-center gap-1.5 text-xs font-medium text-green-700 bg-green-50 px-2 py-1 rounded-full">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Ativo
                            </span>
                          ) : (
                            <span className="flex items-center gap-1.5 text-xs font-medium text-gray-500 bg-gray-50 px-2 py-1 rounded-full">
                              <XCircle className="w-3.5 h-3.5" />
                              Inativo
                            </span>
                          )}
                          {flowInsts.length > 0 && (
                            <span className="text-xs text-gray-600">
                              {activeInstances}/{flowInsts.length} grupos ativos
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    
                    {/* Descrição */}
                    {flow.description && (
                      <p className="text-sm text-gray-600 mb-4 leading-relaxed">{flow.description}</p>
                    )}
                    
                    {/* Instâncias configuradas */}
                    {flowInsts.length === 0 ? (
                      <div className="mb-5">
                        <p className="text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wide">Instâncias:</p>
                        <p className="text-sm text-gray-500 italic bg-gray-50 p-3 rounded-lg border border-gray-200">
                          Nenhuma instância configurada ainda
                        </p>
                      </div>
                    ) : (
                      <div className="mb-5">
                        <p className="text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wide">
                          Instâncias Configuradas ({flowInsts.length}):
                        </p>
                        <div className="space-y-2 max-h-48 overflow-y-auto">
                          {flowInsts.map((inst: any) => {
                            // Busca informações do usuário que configurou
                            const configUser = inst.user_id ? `ID: ${inst.user_id.substring(0, 8)}...` : 'N/A';
                            return (
                              <div key={inst.id} className="text-xs bg-gray-50 p-3 rounded border border-gray-200">
                                <div className="flex items-start justify-between mb-1">
                                  <div className="flex-1 min-w-0">
                                    <p className="font-medium text-gray-900 truncate">
                                      Instância: {inst.instance_name}
                                    </p>
                                    <p className="text-gray-600 truncate text-xs mt-0.5">
                                      Grupo: {inst.group_jid.split('@')[0]}
                                    </p>
                                    <p className="text-gray-500 truncate text-xs mt-0.5">
                                      Configurado por: {configUser}
                                    </p>
                                  </div>
                                  <div className="ml-2">
                                    <span className={`px-2 py-1 rounded text-xs font-medium ${
                                      inst.is_active
                                        ? 'bg-green-100 text-green-700'
                                        : 'bg-gray-200 text-gray-600'
                                    }`}>
                                      {inst.is_active ? 'Ativo' : 'Inativo'}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Botões de ação */}
                    <div className="flex gap-2 pt-4 border-t border-gray-100">
                      <button
                        onClick={() => router.push(`/admin/flows/${flow.id}`)}
                        className="flex-1 px-4 py-2.5 bg-blue-50 hover:bg-blue-100 text-blue-600 rounded-lg font-medium text-sm transition-all shadow-sm hover:shadow-md flex items-center justify-center gap-2"
                        title="Editar flow"
                      >
                        <Edit className="w-4 h-4" />
                        Editar Flow
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>


      {/* Modal de criação/edição */}
      {showModal && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col">
            <div className="p-6 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-xl font-semibold">
                {editingAgent ? 'Editar Agente IA' : 'Criar Agente IA'}
              </h3>
              <button
                onClick={() => setShowModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            
            <div className="p-6 overflow-auto flex-1 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Nome *
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-700"
                  placeholder="Ex: Assistente de Vendas"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Descrição
                </label>
                <input
                  type="text"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-700"
                  placeholder="Breve descrição do que o agente faz"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Prompt do Sistema *
                </label>
                <textarea
                  value={formData.system_prompt}
                  onChange={(e) => setFormData({ ...formData, system_prompt: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg h-40 text-gray-700"
                  placeholder="Instruções para o agente IA..."
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="is_active"
                  checked={formData.is_active}
                  onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                  className="w-4 h-4 text-[#E86A24] border-gray-300 rounded"
                />
                <label htmlFor="is_active" className="text-sm text-gray-700">
                  Agente ativo (disponível para usuários)
                </label>
              </div>
            </div>

            <div className="p-6 border-t border-gray-200 flex justify-end gap-4">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 bg-gray-200 hover:bg-gray-300 rounded-lg text-sm font-medium"
              >
                Cancelar
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 bg-[#E86A24] text-white rounded-lg hover:bg-[#7CC845] transition font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
                    Salvando...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4 inline mr-2" />
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
