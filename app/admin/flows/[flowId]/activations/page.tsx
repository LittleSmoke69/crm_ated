'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRequireAuth } from '@/utils/useRequireAuth';
import { useRouter, useParams } from 'next/navigation';
import Layout from '@/components/Layout';
import { useSidebar } from '@/contexts/SidebarContext';
import {
  Loader2,
  ArrowLeft,
  Play,
  Pause,
  Trash2,
  Users,
  Zap,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

interface FlowInstance {
  id: string;
  flow_id: string;
  instance_name: string;
  group_jid: string;
  is_active: boolean;
  user_id: string;
  created_at: string;
  flows?: { id: string; name: string; description?: string } | null;
  profiles?: { id: string; email: string; full_name: string | null; status: string } | null;
}

const STATUS_LABEL: Record<string, string> = {
  dono_banca: 'Dono de Banca',
  gerente: 'Gerente',
  consultor: 'Consultor',
  admin: 'Admin',
};

export default function FlowActivationsPage() {
  const { checking, userId } = useRequireAuth();
  const router = useRouter();
  const params = useParams();
  const flowId = params?.flowId as string;
  const { isCollapsed, setIsCollapsed, isMobileOpen, setIsMobileOpen } = useSidebar();

  const [instances, setInstances] = useState<FlowInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [flowName, setFlowName] = useState<string>('');
  const [toggling, setToggling] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const PER_PAGE = 10;
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(instances.length / PER_PAGE));
  const startIndex = (page - 1) * PER_PAGE;
  const endIndex = startIndex + PER_PAGE;
  const pageInstances = instances.slice(startIndex, endIndex);

  const loadActivations = useCallback(async () => {
    if (!userId || !flowId) return;
    try {
      setLoading(true);
      const response = await fetch(`/api/admin/flow-instances/all?flow_id=${flowId}`, {
        headers: { 'X-User-Id': userId },
      });
      if (response.ok) {
        const result = await response.json();
        const data = result.data || [];
        setInstances(data);
        const first = data[0];
        if (first?.flows?.name) {
          setFlowName(first.flows.name);
        } else if (data.length === 0 && flowId) {
          const flowRes = await fetch(`/api/admin/flows/${flowId}`, {
            headers: { 'X-User-Id': userId },
          });
          if (flowRes.ok) {
            const flowData = await flowRes.json();
            if (flowData.success && flowData.data?.name) setFlowName(flowData.data.name);
            else setFlowName('Automação');
          } else {
            setFlowName('Automação');
          }
        } else {
          setFlowName('Automação');
        }
      } else {
        const err = await response.json();
        if (response.status === 403) {
          router.replace('/admin/flows');
          return;
        }
        console.error('Erro ao carregar ativações:', err);
      }
    } catch (err) {
      console.error('Erro ao carregar ativações:', err);
    } finally {
      setLoading(false);
    }
  }, [userId, flowId, router]);

  useEffect(() => {
    if (userId && !checking) loadActivations();
  }, [userId, checking, loadActivations]);

  useEffect(() => {
    if (page > totalPages && totalPages >= 1) setPage(totalPages);
  }, [page, totalPages]);

  const handleToggle = async (inst: FlowInstance) => {
    if (!userId) return;
    setToggling(inst.id);
    try {
      const res = await fetch(`/api/admin/flow-instances/${inst.id}`, {
        method: 'PUT',
        headers: { 'X-User-Id': userId, 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !inst.is_active }),
      });
      const result = await res.json();
      if (res.ok && result.success) {
        await loadActivations();
      } else {
        alert(result.error || 'Erro ao atualizar');
      }
    } catch (e) {
      console.error(e);
      alert('Erro ao atualizar');
    } finally {
      setToggling(null);
    }
  };

  const handleDelete = async (inst: FlowInstance) => {
    if (!userId || !confirm('Remover esta ativação? O usuário precisará ativar novamente.')) return;
    setDeleting(inst.id);
    try {
      const res = await fetch(`/api/admin/flow-instances/${inst.id}`, {
        method: 'DELETE',
        headers: { 'X-User-Id': userId },
      });
      const result = await res.json();
      if (res.ok && result.success) {
        await loadActivations();
      } else {
        alert(result.error || 'Erro ao remover');
      }
    } catch (e) {
      console.error(e);
      alert('Erro ao remover');
    } finally {
      setDeleting(null);
    }
  };

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
          <Loader2 className="w-8 h-8 animate-spin text-[#8CD955]" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout onSignOut={handleSignOut}>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Ativações da automação</h1>
            <p className="text-sm text-gray-600 mt-1">
              {flowName && <span className="font-medium">{flowName}</span>}
              {flowName && ' · '}
              Quem ativou, instância e grupo
            </p>
          </div>
          <button
            onClick={() => router.push(`/admin/flows/${flowId}`)}
            className="flex items-center gap-2 px-4 py-2 bg-gray-200 hover:bg-gray-300 rounded-lg text-sm font-medium"
          >
            <ArrowLeft className="w-4 h-4" />
            Voltar ao Flow
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center p-12">
            <Loader2 className="w-8 h-8 animate-spin text-[#8CD955]" />
          </div>
        ) : instances.length === 0 ? (
          <div className="bg-white rounded-lg shadow border border-gray-200 p-8 text-center">
            <Users className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-600 font-medium">Nenhuma ativação</p>
            <p className="text-sm text-gray-500 mt-1">
              Donos de banca, gerentes e consultores ativam nas suas áreas (ex.: Agentes IA) escolhendo instância mestre e grupo.
            </p>
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-600 uppercase">Usuário</th>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-600 uppercase">Perfil</th>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-600 uppercase">Instância</th>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-600 uppercase">Grupo</th>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-600 uppercase">Status</th>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-600 uppercase">Criado em</th>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-600 uppercase">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {pageInstances.map((inst) => (
                    <tr key={inst.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div>
                          <div className="font-medium text-gray-900">
                            {inst.profiles?.full_name || inst.profiles?.email || '-'}
                          </div>
                          {inst.profiles?.full_name && inst.profiles?.email && (
                            <div className="text-xs text-gray-500">{inst.profiles.email}</div>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-0.5 text-xs font-medium rounded bg-blue-100 text-blue-800">
                          {STATUS_LABEL[inst.profiles?.status || ''] || inst.profiles?.status || '-'}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-sm text-gray-700">{inst.instance_name}</td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-600 max-w-[180px] truncate" title={inst.group_jid}>
                        {inst.group_jid}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded ${
                            inst.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
                          }`}
                        >
                          <Zap className="w-3 h-3" />
                          {inst.is_active ? 'Ativo' : 'Inativo'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">
                        {new Date(inst.created_at).toLocaleString('pt-BR')}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleToggle(inst)}
                            disabled={toggling === inst.id}
                            className="p-2 rounded-lg transition disabled:opacity-50"
                            title={inst.is_active ? 'Desativar' : 'Ativar'}
                          >
                            {toggling === inst.id ? (
                              <Loader2 className="w-4 h-4 animate-spin text-gray-500" />
                            ) : inst.is_active ? (
                              <Pause className="w-4 h-4 text-amber-600 hover:text-amber-700" />
                            ) : (
                              <Play className="w-4 h-4 text-green-600 hover:text-green-700" />
                            )}
                          </button>
                          <button
                            onClick={() => handleDelete(inst)}
                            disabled={deleting === inst.id}
                            className="p-2 rounded-lg text-red-600 hover:bg-red-50 transition disabled:opacity-50"
                            title="Remover ativação"
                          >
                            {deleting === inst.id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Trash2 className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {instances.length > PER_PAGE && (
              <div className="flex items-center justify-between border-t border-gray-200 px-4 py-3">
                <p className="text-sm text-gray-600">
                  Mostrando <span className="font-medium">{startIndex + 1}</span> até{' '}
                  <span className="font-medium">{Math.min(endIndex, instances.length)}</span> de{' '}
                  <span className="font-medium">{instances.length}</span> ativações
                </p>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="p-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    aria-label="Página anterior"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="px-3 py-1 text-sm font-medium text-gray-700">
                    Página {page} de {totalPages}
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="p-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    aria-label="Próxima página"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}
