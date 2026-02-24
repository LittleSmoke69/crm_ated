'use client';

import React, { useEffect, useState } from 'react';
import { useRequireAuth } from '@/utils/useRequireAuth';
import { useRouter } from 'next/navigation';
import Layout from '@/components/Layout';
import DashboardStats from '@/components/Dashboard/DashboardStats';
import InstanceList from '@/components/Dashboard/InstanceList';
import SuccessRate from '@/components/Dashboard/SuccessRate';
import GroupsCard from '@/components/Dashboard/GroupsCard';
import ChartCard from '@/components/Dashboard/ChartCard';
import CampaignsTable from '@/components/Campaigns/CampaignsTable';
import { useDashboardData, Campaign } from '@/hooks/useDashboardData';
import { CheckCircle2, AlertCircle, Info, X, Menu } from 'lucide-react';
import Link from 'next/link';
import { useSidebar } from '@/contexts/SidebarContext';

const Dashboard = () => {
  const { checking, userId } = useRequireAuth();
  const router = useRouter();
  const { isCollapsed, setIsCollapsed, isMobileOpen, setIsMobileOpen } = useSidebar();
  const [isCheckingStatus, setIsCheckingStatus] = useState(true);
  const {
    instances,
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
    toasts,
    showToast,
    setToasts,
    setCampaigns,
    loadInitialData,
  } = useDashboardData();

  // Verifica o status do usuário e redireciona consultores para o CRM
  useEffect(() => {
    const checkUserStatus = async () => {
      if (checking || !userId) {
        setIsCheckingStatus(true);
        return;
      }

      try {
        const response = await fetch('/api/user/profile', {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'X-User-Id': userId,
          },
          credentials: 'include',
        });

        if (response.ok) {
          const result = await response.json();
          if (result.success && result.data?.status === 'consultor') {
            // Redireciona consultores para o CRM Kanban
            router.replace('/crm/kanban');
            return;
          }
        }
      } catch (error) {
        console.error('Erro ao verificar status do usuário:', error);
      } finally {
        setIsCheckingStatus(false);
      }
    };

    checkUserStatus();
  }, [checking, userId, router]);

  const handleSignOut = async () => {
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('user_id');
      sessionStorage.removeItem('profile_id');
      window.localStorage.removeItem('profile_id');
      document.cookie = 'user_id=; Path=/; Max-Age=0; SameSite=Lax';
    }
    window.location.href = '/login';
  };

  if (checking || userId === null || isCheckingStatus) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-[#1a1a1a]">
        <div className="bg-gray-100 dark:bg-[#2a2a2a] rounded-xl shadow-lg p-6 border border-gray-200 dark:border-[#404040] text-center">
          <p className="text-gray-700 dark:text-white font-medium">Preparando seu ambiente...</p>
        </div>
      </div>
    );
  }

  // Calcular taxa de sucesso
  const successRate = kpiAdded + kpiFailedAdds > 0 
    ? Math.round((kpiAdded / (kpiAdded + kpiFailedAdds)) * 100) 
    : 0;

  // Contar grupos salvos
  const savedGroupsCount = dbGroups.length;

  // Funções para gerenciar campanhas
  const handlePauseCampaign = async (campaignId: string) => {
    try {
      const response = await fetch(`/api/campaigns/${campaignId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'paused' }),
      });
      const data = await response.json();
      if (data.success) {
        showToast('Campanha pausada com sucesso', 'success');
        loadInitialData();
      } else {
        showToast(data.message || 'Erro ao pausar campanha', 'error');
      }
    } catch (error) {
      showToast('Erro ao pausar campanha', 'error');
    }
  };

  const handleResumeCampaign = async (campaignId: string) => {
    try {
      const response = await fetch(`/api/campaigns/${campaignId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'running' }),
      });
      const data = await response.json();
      if (data.success) {
        showToast('Campanha retomada com sucesso', 'success');
        loadInitialData();
      } else {
        showToast(data.message || 'Erro ao retomar campanha', 'error');
      }
    } catch (error) {
      showToast('Erro ao retomar campanha', 'error');
    }
  };

  const handleDeleteCampaign = async (campaignId: string) => {
    if (!confirm('Tem certeza que deseja excluir esta campanha?')) return;
    if (!userId) {
      showToast('Sessão inválida', 'error');
      return;
    }
    try {
      const response = await fetch(`/api/campaigns/${campaignId}`, {
        method: 'DELETE',
        headers: {
          'X-User-Id': userId,
        },
      });
      const data = await response.json();
      if (data.success) {
        showToast('Campanha excluída com sucesso', 'success');
        loadInitialData();
      } else {
        showToast(data.message || 'Erro ao excluir campanha', 'error');
      }
    } catch (error) {
      showToast('Erro ao excluir campanha', 'error');
    }
  };

  return (
    <Layout onSignOut={handleSignOut}>
      {/* Toasts */}
      <div className="fixed top-4 right-4 z-50 space-y-2">
        {toasts.map(toast => (
          <div
            key={toast.id}
            className={`flex items-center gap-3 min-w-[320px] px-6 py-4 rounded-lg shadow-lg text-white transform transition-all duration-300 ease-out ${
              toast.type === 'success' ? 'bg-[#8CD955]' : toast.type === 'error' ? 'bg-red-600' : 'bg-amber-500'
            }`}
            style={{ animation: 'slideIn 0.3s ease-out' }}
          >
            {toast.type === 'success' && <CheckCircle2 className="w-5 h-5 flex-shrink-0" />}
            {toast.type === 'error' && <AlertCircle className="w-5 h-5 flex-shrink-0" />}
            {toast.type === 'info' && <Info className="w-5 h-5 flex-shrink-0" />}
            <p className="flex-1 font-medium">{toast.message}</p>
            <button
              onClick={() => setToasts(prev => prev.filter(t => t.id !== toast.id))}
              className="hover:bg-white/20 rounded p-1 transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>

      <style jsx>{`
        @keyframes slideIn { from { transform: translateX(400px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
      `}</style>

      <div className="space-y-8 w-full">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex-1">
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 dark:text-white mb-2">Dashboard</h1>
            <p className="text-sm sm:text-base text-gray-600 dark:text-[#aaa]">Visão geral do seu sistema</p>
          </div>
          {/* Botão Toggle da Sidebar - Apenas no mobile, no topo direito */}
          <div className="lg:hidden flex-shrink-0">
            <button
              onClick={() => setIsMobileOpen(!isMobileOpen)}
              className="flex items-center justify-center w-10 h-10 rounded-lg hover:bg-gray-100 dark:hover:bg-[#333] transition text-gray-600 dark:text-[#ccc] shadow-md bg-white dark:bg-[#2a2a2a]"
              aria-label="Toggle sidebar"
            >
              <Menu className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* KPIs */}
        <div data-tour-id="dashboard-resumo">
          <DashboardStats
            kpiSent={kpiSent}
            kpiAdded={kpiAdded}
            kpiPending={kpiPending}
            kpiConnected={kpiConnected}
            kpiFailedSends={kpiFailedSends}
            kpiFailedAdds={kpiFailedAdds}
          />
        </div>

        {/* Gráficos e Listas */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 w-full">
          <InstanceList 
            instances={instances} 
            onViewAll={() => window.location.href = '/instances'}
          />
          <ChartCard 
            title="Mensagens Enviadas e Adição aos Grupos"
            subtitle="(+5) mais em 2025"
            data={chartData}
          />
        </div>

        {/* Cards Inferiores */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full" data-tour-id="dashboard-instancias-sucesso">
          <SuccessRate rate={successRate} />
          <GroupsCard 
            title="Grupos Salvos no Banco" 
            count={savedGroupsCount}
            onViewAll={() => window.location.href = '/instances'}
          />
        </div>

        {/* Campanhas Ativas */}
        <div className="bg-gray-100 dark:bg-[#2a2a2a] rounded-xl shadow-md p-6 border border-gray-200 dark:border-[#404040]">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-white mb-4">Campanhas Ativas</h2>
          {(() => {
            // Filtra apenas campanhas ativas (running, paused, pending)
            const activeCampaigns = campaigns.filter(
              c => c.status === 'running' || c.status === 'paused' || c.status === 'pending'
            );
            
            if (activeCampaigns.length === 0) {
              return (
                <p className="text-sm text-gray-500 dark:text-[#aaa] text-center py-4">Nenhuma campanha ativa no momento</p>
              );
            }
            
            return (
              <CampaignsTable
                campaigns={activeCampaigns}
                instances={instances}
                onPause={handlePauseCampaign}
                onResume={handleResumeCampaign}
                onDelete={handleDeleteCampaign}
                onUpdateCampaign={async (campaignId: string, updates: any) => {
                  if (!userId) {
                    throw new Error('Sessão inválida');
                  }
                  const response = await fetch(`/api/campaigns/${campaignId}`, {
                    method: 'PATCH',
                    headers: {
                      'Content-Type': 'application/json',
                      'X-User-Id': userId,
                    },
                    body: JSON.stringify(updates),
                  });
                  const data = await response.json();
                  if (!data.success) {
                    throw new Error(data.message || 'Erro ao atualizar campanha');
                  }
                  await loadInitialData();
                }}
                onCheckInstances={async (campaignId: string) => {
                  if (!userId) return null;
                  
                  const response = await fetch(`/api/campaigns/${campaignId}/check-instances`, {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      'X-User-Id': userId,
                    },
                  });
                  const data = await response.json();
                  return data;
                }}
                onReactivate={async (campaignId: string) => {
                  if (!userId) {
                    throw new Error('Sessão inválida');
                  }
                  const response = await fetch(`/api/campaigns/${campaignId}`, {
                    method: 'PATCH',
                    headers: {
                      'Content-Type': 'application/json',
                      'X-User-Id': userId,
                    },
                    body: JSON.stringify({ status: 'running' }),
                  });
                  const data = await response.json();
                  if (!data.success) {
                    throw new Error(data.message || 'Erro ao reativar campanha');
                  }
                  await loadInitialData();
                }}
                showToast={showToast}
              />
            );
          })()}
        </div>

        {/* Quick Actions */}
        <div className="bg-gray-100 dark:bg-[#2a2a2a] rounded-xl shadow-md p-6 w-full border border-gray-200 dark:border-[#404040]" data-tour-id="dashboard-acoes-rapidas">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-white mb-4">Ações Rápidas</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 w-full">
            <Link
              href="/instances"
              className="p-4 border-2 border-gray-200 dark:border-[#404040] rounded-lg hover:border-[#8CD955] dark:hover:border-[#00ff00] hover:bg-[#8CD95515] dark:hover:bg-[#00ff0015] transition text-center"
            >
              <div className="text-2xl mb-2">📱</div>
              <div className="font-medium text-gray-800 dark:text-white">Gerenciar Instâncias</div>
            </Link>
            <Link
              href="/add-to-group"
              className="p-4 border-2 border-gray-200 dark:border-[#404040] rounded-lg hover:border-[#8CD955] dark:hover:border-[#00ff00] hover:bg-[#8CD95515] dark:hover:bg-[#00ff0015] transition text-center"
            >
              <div className="text-2xl mb-2">🚀</div>
              <div className="font-medium text-gray-800 dark:text-white">Adicionar ao Grupo</div>
            </Link>
            <Link
              href="/contacts"
              className="p-4 border-2 border-gray-200 dark:border-[#404040] rounded-lg hover:border-[#8CD955] dark:hover:border-[#00ff00] hover:bg-[#8CD95515] dark:hover:bg-[#00ff0015] transition text-center"
            >
              <div className="text-2xl mb-2">👥</div>
              <div className="font-medium text-gray-800 dark:text-white">Ver Contatos</div>
            </Link>
            <Link
              href="/import-contacts"
              className="p-4 border-2 border-gray-200 dark:border-[#404040] rounded-lg hover:border-[#8CD955] dark:hover:border-[#00ff00] hover:bg-[#8CD95515] dark:hover:bg-[#00ff0015] transition text-center"
            >
              <div className="text-2xl mb-2">➕</div>
              <div className="font-medium text-gray-800 dark:text-white">Importar Contatos</div>
            </Link>
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default Dashboard;
