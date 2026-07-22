'use client';

import React, { useState, useEffect } from 'react';
import { withTenantSlug } from '@/lib/utils/tenant-href';
import Layout from '@/components/Layout';
import { useRequireAuth } from '@/utils/useRequireAuth';
import { useDashboardData, Campaign, WhatsAppInstance } from '@/hooks/useDashboardData';
import CampaignsTable from '@/components/Campaigns/CampaignsTable';
import { CampaignUpdates } from '@/components/Campaigns/EditCampaignModal';
import { 
  Rocket, 
  Menu, 
  RefreshCw, 
  AlertCircle,
  CheckCircle2,
  XCircle,
  Info,
  X,
} from 'lucide-react';
import { useSidebar } from '@/contexts/SidebarContext';

const EditCampaignsPage = () => {
  const { checking, userId } = useRequireAuth();
  const { isCollapsed, setIsCollapsed, isMobileOpen, setIsMobileOpen } = useSidebar();
  const {
    campaigns,
    instances,
    showToast,
    loadInitialData,
    toasts,
    setToasts,
  } = useDashboardData();

  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (userId) {
      loadInitialData();
    }
  }, [userId, loadInitialData]);

  // Verifica se o usuário é admin (antigo cargo "suporte" foi absorvido por admin)
  useEffect(() => {
    const checkUserStatus = async () => {
      if (!userId) return;

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
          if (result.success && !['admin', 'super_admin'].includes(result.data?.status)) {
            // Redireciona se não for admin/super_admin
            window.location.href = withTenantSlug('/');
          }
        }
      } catch (error) {
        console.error('Erro ao verificar status do usuário:', error);
      }
    };

    checkUserStatus();
  }, [userId]);

  const handleSignOut = async () => {
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('user_id');
      sessionStorage.removeItem('profile_id');
      window.localStorage.removeItem('profile_id');
      document.cookie = 'user_id=; Path=/; Max-Age=0; SameSite=Lax';
      window.location.href = withTenantSlug('/login');
    }
  };

  const handlePauseCampaign = async (campaignId: string) => {
    if (!userId) {
      showToast('Usuário não autenticado. Por favor, faça login novamente.', 'error');
      return;
    }

    try {
      setLoading(true);
      
      // Envia userId tanto no header quanto no body como fallback
      const requestBody = { 
        status: 'paused',
        userId: userId // Fallback caso o header não funcione
      };
      
      const response = await fetch(`/api/campaigns/${campaignId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': userId,
        },
        credentials: 'include', // Garante que cookies sejam enviados
        body: JSON.stringify(requestBody),
      });

      const data = await response.json();
      if (data.success) {
        showToast('Campanha pausada com sucesso!', 'success');
        await loadInitialData();
      } else {
        showToast(data.error || 'Erro ao pausar campanha', 'error');
      }
    } catch (error: any) {
      showToast('Erro ao pausar campanha: ' + error.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleResumeCampaign = async (campaignId: string) => {
    // Verifica userId de múltiplas fontes para debug
    const sessionUserId = typeof window !== 'undefined' ? sessionStorage.getItem('user_id') : null;
    const sessionProfileId = typeof window !== 'undefined' ? sessionStorage.getItem('profile_id') : null;
    const localProfileId = typeof window !== 'undefined' ? localStorage.getItem('profile_id') : null;
    
    console.log('[handleResumeCampaign] Debug userId:', {
      userId,
      sessionUserId,
      sessionProfileId,
      localProfileId,
    });

    if (!userId) {
      showToast('Usuário não autenticado. Por favor, faça login novamente.', 'error');
      return;
    }

    try {
      setLoading(true);
      console.log('[handleResumeCampaign] Enviando requisição com userId:', userId);
      
      // Envia userId tanto no header quanto no body como fallback
      const requestBody = { 
        status: 'running',
        userId: userId // Fallback caso o header não funcione
      };
      
      const response = await fetch(`/api/campaigns/${campaignId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': userId,
        },
        credentials: 'include', // Garante que cookies sejam enviados
        body: JSON.stringify(requestBody),
      });

      console.log('[handleResumeCampaign] Response status:', response.status);

      const data = await response.json();
      if (data.success) {
        showToast('Campanha retomada com sucesso!', 'success');
        await loadInitialData();
      } else {
        showToast(data.error || 'Erro ao retomar campanha', 'error');
      }
    } catch (error: any) {
      showToast('Erro ao retomar campanha: ' + error.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateCampaign = async (campaignId: string, updates: CampaignUpdates) => {
    if (!userId) {
      showToast('Usuário não autenticado. Por favor, faça login novamente.', 'error');
      return;
    }

    try {
      setLoading(true);
      
      // Envia userId tanto no header quanto no body como fallback
      const requestBody = {
        ...updates,
        userId: userId // Fallback caso o header não funcione
      };
      
      const response = await fetch(`/api/campaigns/${campaignId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': userId,
        },
        credentials: 'include', // Garante que cookies sejam enviados
        body: JSON.stringify(requestBody),
      });

      const data = await response.json();
      if (data.success) {
        showToast('Campanha atualizada com sucesso!', 'success');
        await loadInitialData();
      } else {
        showToast(data.error || 'Erro ao atualizar campanha', 'error');
      }
    } catch (error: any) {
      showToast('Erro ao atualizar campanha: ' + error.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleCheckInstances = async (campaignId: string) => {
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/check-instances`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': userId || '',
        },
      });

      const data = await response.json();
      if (data.success) {
        showToast('Verificação de instâncias concluída!', 'success');
        return data.data;
      } else {
        showToast(data.error || 'Erro ao verificar instâncias', 'error');
        return null;
      }
    } catch (error: any) {
      showToast('Erro ao verificar instâncias: ' + error.message, 'error');
      return null;
    }
  };

  if (checking || !userId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white rounded-xl shadow-lg p-6 border border-gray-200 text-center">
          <RefreshCw className="w-8 h-8 animate-spin text-[#E86A24] mx-auto mb-4" />
          <p className="text-gray-700 font-medium">Carregando...</p>
        </div>
      </div>
    );
  }

  return (
    <Layout onSignOut={handleSignOut}>
      {/* Toasts */}
      <div className="fixed top-4 right-4 z-50 space-y-2 flex flex-col items-end">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`flex items-center gap-3 min-w-[320px] px-6 py-4 rounded-lg shadow-lg text-white ${
              toast.type === 'success' ? 'bg-emerald-600' : toast.type === 'error' ? 'bg-red-600' : 'bg-amber-500'
            }`}
          >
            {toast.type === 'success' && <CheckCircle2 className="w-5 h-5 flex-shrink-0" />}
            {toast.type === 'error' && <XCircle className="w-5 h-5 flex-shrink-0" />}
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

      <div className="space-y-6 w-full">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex-1">
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 dark:text-white mb-2">Editar Campanhas</h1>
            <p className="text-sm sm:text-base text-gray-600 dark:text-gray-400">Visualize informações, pause, verifique e gerencie instâncias das campanhas</p>
          </div>
          <div className="lg:hidden flex-shrink-0">
            <button
              onClick={() => setIsMobileOpen(!isMobileOpen)}
              className="flex items-center justify-center w-10 h-10 rounded-lg hover:bg-gray-100 dark:hover:bg-[#404040] transition text-gray-600 dark:text-gray-400 shadow-md bg-white dark:bg-[#2a2a2a]"
              aria-label="Toggle sidebar"
            >
              <Menu className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Aviso sobre permissões */}
        <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-300 p-4 rounded-xl flex items-start gap-3">
          <Info className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="font-semibold text-lg mb-1">Permissões de Administração</h3>
            <p className="text-sm dark:text-blue-200/90">
              Como administrador, você pode visualizar informações das campanhas, pausar/retomar campanhas,
              verificar instâncias e editar configurações das campanhas.
            </p>
          </div>
        </div>

        {/* Lista de Campanhas */}
        <div className="bg-gray-100 dark:bg-[#2a2a2a] rounded-xl shadow-md p-6 border border-gray-200 dark:border-[#404040]">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-800 dark:text-white">Todas as Campanhas</h2>
            <button
              onClick={() => loadInitialData()}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 bg-[#E86A24] hover:bg-[#D95E1B] text-white rounded-lg font-medium transition disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Atualizar
            </button>
          </div>

          {campaigns.length === 0 ? (
            <div className="text-center py-12">
              <Rocket className="w-16 h-16 text-gray-300 dark:text-gray-500 mx-auto mb-4" />
              <p className="text-gray-500 dark:text-gray-400 text-lg font-medium mb-2">Nenhuma campanha encontrada</p>
              <p className="text-gray-400 dark:text-gray-500 text-sm">As campanhas aparecerão aqui quando forem criadas</p>
            </div>
          ) : (
            <CampaignsTable
              campaigns={campaigns}
              instances={instances}
              onPause={handlePauseCampaign}
              onResume={handleResumeCampaign}
              onUpdateCampaign={handleUpdateCampaign}
              onCheckInstances={handleCheckInstances}
              showToast={showToast}
            />
          )}
        </div>
      </div>
    </Layout>
  );
};

export default EditCampaignsPage;

