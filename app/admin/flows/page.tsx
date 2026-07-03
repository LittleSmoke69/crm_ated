'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRequireAuth } from '@/utils/useRequireAuth';
import { useTenantRouter } from '@/lib/utils/tenant-href';
import Layout from '@/components/Layout';
import { useSidebar } from '@/contexts/SidebarContext';
import {
  Plus,
  Edit,
  Trash2,
  Play,
  Pause,
  Loader2,
  CheckCircle2,
  XCircle,
  Workflow,
  Eye,
  RefreshCw,
  Users,
  ListOrdered,
} from 'lucide-react';

interface Flow {
  id: string;
  name: string;
  description?: string;
  type: 'automation' | 'template';
  status: 'active' | 'inactive' | 'draft';
  created_at: string;
  updated_at: string;
}

export default function FlowsPage() {
  const { checking, userId } = useRequireAuth();
  const router = useTenantRouter();
  const { isCollapsed, setIsCollapsed, isMobileOpen, setIsMobileOpen } = useSidebar();

  const [flows, setFlows] = useState<Flow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  // Carrega flows
  const loadFlows = useCallback(async () => {
    if (!userId) return;
    try {
      setLoading(true);
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
      setLoading(false);
    }
  }, [userId]);

  // Apenas SuperAdmin pode acessar Flows
  useEffect(() => {
    if (!userId || checking) return;
    const check = async () => {
      try {
        const res = await fetch('/api/user/profile', { headers: { 'X-User-Id': userId } });
        const data = await res.json();
        if (data.success && data.data?.status !== 'super_admin') {
          router.replace('/');
          return;
        }
      } catch {
        router.replace('/');
      }
    };
    check();
  }, [userId, checking, router]);

  useEffect(() => {
    if (userId && !checking) {
      loadFlows();
    }
  }, [userId, checking, loadFlows]);

  // Ativa/desativa flow
  const toggleFlowStatus = async (flow: Flow) => {
    if (!userId) return;
    try {
      const newStatus = flow.status === 'active' ? 'inactive' : 'active';
      const response = await fetch(`/api/admin/flows/${flow.id}`, {
        method: 'PUT',
        headers: { 'X-User-Id': userId, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });

      if (response.ok) {
        await loadFlows();
      } else {
        const result = await response.json();
        alert(result.error || 'Erro ao atualizar status');
      }
    } catch (err) {
      console.error('Erro ao atualizar status:', err);
      alert('Erro ao atualizar status');
    }
  };

  // Sincroniza agentes de todos os flows
  const handleSyncAgents = async () => {
    if (!userId) return;
    if (!confirm('Isso irá sincronizar agentes para todos os flows criados por admin. Continuar?')) return;

    setSyncing(true);
    try {
      const response = await fetch('/api/admin/flows/sync-agents', {
        method: 'POST',
        headers: { 'X-User-Id': userId },
      });

      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          alert(result.data.message || 'Sincronização concluída!');
        } else {
          alert(result.error || 'Erro ao sincronizar');
        }
      } else {
        const result = await response.json();
        alert(result.error || 'Erro ao sincronizar');
      }
    } catch (err) {
      console.error('Erro ao sincronizar agentes:', err);
      alert('Erro ao sincronizar agentes');
    } finally {
      setSyncing(false);
    }
  };

  // Deleta flow
  const handleDelete = async (flow: Flow) => {
    if (!userId) return;
    if (!confirm(`Tem certeza que deseja deletar o flow "${flow.name}"?`)) return;

    try {
      const response = await fetch(`/api/admin/flows/${flow.id}`, {
        method: 'DELETE',
        headers: { 'X-User-Id': userId },
      });

      if (response.ok) {
        await loadFlows();
      } else {
        const result = await response.json();
        alert(result.error || 'Erro ao deletar flow');
      }
    } catch (err) {
      console.error('Erro ao deletar flow:', err);
      alert('Erro ao deletar flow');
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
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Flows (Automações)</h1>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              Crie e gerencie automações baseadas em eventos webhook
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleSyncAgents}
              disabled={syncing}
              className="flex items-center gap-2 px-4 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 transition disabled:opacity-50"
              title="Sincroniza agentes para flows existentes"
            >
              {syncing ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <RefreshCw className="w-5 h-5" />
              )}
              Sincronizar Agentes
            </button>
            <button
              onClick={async () => {
                if (!userId) return;
                try {
                  const response = await fetch('/api/admin/flows/templates/welcome', {
                    method: 'POST',
                    headers: { 'X-User-Id': userId },
                  });
                  if (response.ok) {
                    const result = await response.json();
                    if (result.success && result.data?.flow_id) {
                      if (result.data.already_existed) {
                        alert('Template de boas-vindas já existe. Abrindo para edição.');
                      }
                      router.push(`/admin/flows/${result.data.flow_id}`);
                    }
                  }
                } catch (err) {
                  console.error('Erro ao criar template:', err);
                  alert('Erro ao criar template');
                }
              }}
              className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition"
            >
              <Plus className="w-5 h-5" />
              Template: Boas-vindas
            </button>
            <button
              onClick={() => router.push('/admin/flows/new')}
              className="flex items-center gap-2 px-4 py-2 bg-[#E86A24] text-white rounded-lg hover:bg-[#7CC845] transition"
            >
              <Plus className="w-5 h-5" />
              Criar Flow
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center p-8">
            <Loader2 className="w-8 h-8 animate-spin text-[#E86A24]" />
          </div>
        ) : flows.length === 0 ? (
          <div className="bg-white dark:bg-[#2a2a2a] rounded-lg shadow-md p-8 text-center text-gray-500 dark:text-gray-400">
            <Workflow className="w-16 h-16 mx-auto mb-4 text-gray-400 dark:text-gray-500" />
            <p className="text-lg font-medium mb-2">Nenhum flow criado ainda</p>
            <p className="text-sm mb-4">Crie seu primeiro flow para começar a automatizar</p>
            <button
              onClick={() => router.push('/admin/flows/new')}
              className="px-4 py-2 bg-[#E86A24] text-white rounded-lg hover:bg-[#7CC845] transition"
            >
              Criar Primeiro Flow
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {flows.map((flow) => (
              <div key={flow.id} className="bg-white dark:bg-[#2a2a2a] rounded-lg shadow-md border border-gray-200 dark:border-[#404040] p-6 hover:shadow-lg transition-shadow">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1">
                    <h3 className="font-bold text-lg text-gray-900 dark:text-gray-100 mb-1">{flow.name}</h3>
                    {flow.description && (
                      <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">{flow.description}</p>
                    )}
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-1 text-xs font-medium rounded ${
                        flow.status === 'active'
                          ? 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-300'
                          : flow.status === 'inactive'
                          ? 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
                          : 'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-300'
                      }`}>
                        {flow.status === 'active' ? 'Ativo' : flow.status === 'inactive' ? 'Inativo' : 'Rascunho'}
                      </span>
                      <span className="px-2 py-1 text-xs font-medium rounded bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-300">
                        {flow.type === 'automation' ? 'Automação' : 'Template'}
                      </span>
                    </div>
                  </div>
                  <Workflow className="w-8 h-8 text-[#E86A24] flex-shrink-0" />
                </div>

                <div className="text-xs text-gray-500 dark:text-gray-400 mb-4">
                  Criado em: {new Date(flow.created_at).toLocaleDateString('pt-BR')}
                </div>

                <div className="flex flex-wrap gap-2 pt-4 border-t border-gray-100 dark:border-[#353535]">
                  <button
                    onClick={() => router.push(`/admin/flows/${flow.id}`)}
                    className="flex-1 min-w-[100px] px-3 py-2 bg-[#E86A24] hover:bg-[#7CC845] text-white rounded-lg font-medium text-sm transition flex items-center justify-center gap-2"
                  >
                    <Edit className="w-4 h-4" />
                    Editar
                  </button>
                  <button
                    onClick={() => router.push(`/admin/flows/${flow.id}/activations`)}
                    className="px-3 py-2 bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-900/50 text-blue-700 dark:text-blue-300 rounded-lg text-sm transition flex items-center gap-2"
                    title="Ver quem ativou (dono de banca, gerentes, consultores)"
                  >
                    <Users className="w-4 h-4" />
                    Ver ativações
                  </button>
                  <button
                    onClick={() => router.push(`/admin/flows/${flow.id}/executions`)}
                    className="px-3 py-2 bg-gray-100 dark:bg-[#383838] hover:bg-gray-200 dark:hover:bg-[#404040] text-gray-700 dark:text-gray-300 rounded-lg text-sm transition flex items-center gap-2"
                    title="Ver execuções"
                  >
                    <ListOrdered className="w-4 h-4" />
                    Execuções
                  </button>
                  <button
                    onClick={() => toggleFlowStatus(flow)}
                    className="px-3 py-2 bg-gray-100 dark:bg-[#383838] hover:bg-gray-200 dark:hover:bg-[#404040] text-gray-700 dark:text-gray-300 rounded-lg text-sm transition"
                    title={flow.status === 'active' ? 'Desativar' : 'Ativar'}
                  >
                    {flow.status === 'active' ? (
                      <Pause className="w-4 h-4" />
                    ) : (
                      <Play className="w-4 h-4" />
                    )}
                  </button>
                  <button
                    onClick={() => handleDelete(flow)}
                    className="px-3 py-2 bg-red-50 dark:bg-red-900/30 hover:bg-red-100 dark:hover:bg-red-900/50 text-red-600 dark:text-red-400 rounded-lg text-sm transition"
                    title="Deletar"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}

