'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Campaign } from '@/hooks/useDashboardData';
import { WhatsAppInstance } from '@/hooks/useDashboardData';
import { instanceListUiStatusIsConnected } from '@/lib/utils/evolution-instance-status';
import EditCampaignModal, { CampaignUpdates } from './EditCampaignModal';
import { 
  Pause, 
  Play, 
  Trash2, 
  Clock, 
  CheckCircle2, 
  XCircle, 
  AlertCircle,
  Timer,
  RefreshCw,
  Edit2,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react';

interface CampaignsTableProps {
  campaigns: Campaign[];
  instances: WhatsAppInstance[];
  onPause?: (campaignId: string) => void;
  onResume?: (campaignId: string) => void;
  onDelete?: (campaignId: string) => void;
  onUpdateCampaign?: (campaignId: string, updates: CampaignUpdates) => Promise<void>;
  onReactivate?: (campaignId: string) => Promise<void>;
  onCheckInstances?: (campaignId: string) => Promise<any>;
  showToast?: (message: string, type: 'success' | 'error' | 'info') => void;
}

interface InstanceStatus {
  instance_name: string;
  exists: boolean;
  connected: boolean;
  has_proxy: boolean;
  status: string;
  error?: string;
}

const CampaignsTable: React.FC<CampaignsTableProps> = ({
  campaigns,
  instances,
  onPause,
  onResume,
  onDelete,
  onUpdateCampaign,
  onReactivate,
  onCheckInstances,
  showToast,
}) => {
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(10);
  const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null);
  const [checkingInstances, setCheckingInstances] = useState<string | null>(null);
  const [instanceStatuses, setInstanceStatuses] = useState<Record<string, InstanceStatus[]>>({});

  // Ordena campanhas: ativas primeiro (running, paused, pending), depois por data de criação (mais recentes primeiro)
  const sortedCampaigns = [...campaigns].sort((a, b) => {
    const activeStatuses = ['running', 'paused', 'pending'];
    const aIsActive = activeStatuses.includes(a.status);
    const bIsActive = activeStatuses.includes(b.status);

    if (aIsActive && !bIsActive) return -1;
    if (!aIsActive && bIsActive) return 1;
    if (aIsActive && bIsActive) {
      // Dentro das ativas, ordena por status (running primeiro)
      const statusOrder = { running: 0, paused: 1, pending: 2 };
      const aOrder = statusOrder[a.status as keyof typeof statusOrder] ?? 99;
      const bOrder = statusOrder[b.status as keyof typeof statusOrder] ?? 99;
      if (aOrder !== bOrder) return aOrder - bOrder;
    }

    // Ordena por data de criação (mais recentes primeiro)
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  const totalPages = Math.ceil(sortedCampaigns.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedCampaigns = sortedCampaigns.slice(startIndex, endIndex);

  // Timer component
  const TimerComponent: React.FC<{ campaign: Campaign }> = ({ campaign }) => {
    const [timeRemaining, setTimeRemaining] = useState<string>('');
    const [delayTime, setDelayTime] = useState<string>('00:00:00');

    // Extrai delay config da strategy
    useEffect(() => {
      const strategy = campaign.strategy || {};
      const delayConfig = strategy.delayConfig || {};
      
      if (campaign.status === 'paused' || campaign.status === 'failed') {
        setDelayTime('00:00:00');
        return;
      }

      if (delayConfig.delayMode === 'fixed' && delayConfig.delayValue) {
        const value = delayConfig.delayValue;
        const unit = delayConfig.delayUnit || 'minutes';
        
        let totalSeconds = 0;
        if (unit === 'minutes') {
          totalSeconds = value * 60;
        } else if (unit === 'seconds') {
          totalSeconds = value;
        }

        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;

        setDelayTime(
          `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
        );
      } else if (delayConfig.delayMode === 'random') {
        // Para random, mostra o intervalo min - max
        const minSec = delayConfig.randomMinSeconds || 5;
        const maxSec = delayConfig.randomMaxSeconds || 300;

        const formatRange = (sec: number) => {
          if (sec >= 60) {
            const m = Math.floor(sec / 60);
            const s = sec % 60;
            return s > 0 ? `${m}min${s}s` : `${m}min`;
          }
          return `${sec}s`;
        };

        setDelayTime(`${formatRange(minSec)} - ${formatRange(maxSec)}`);
      } else {
        setDelayTime('00:00:00');
      }
    }, [campaign.strategy, campaign.status]);

    useEffect(() => {
      // Só mostra timer se campanha estiver running e tiver next_request_at
      if (campaign.status !== 'running' || !campaign.next_request_at) {
        setTimeRemaining('');
        return;
      }

      const updateTimer = () => {
        const now = new Date().getTime();
        const nextRequest = new Date(campaign.next_request_at!).getTime();
        const diff = nextRequest - now;

        if (diff <= 0) {
          setTimeRemaining('');
          return;
        }

        const totalSeconds = Math.floor(diff / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;

        setTimeRemaining(
          `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
        );
      };

      updateTimer();
      const interval = setInterval(updateTimer, 1000);

      return () => clearInterval(interval);
    }, [campaign.next_request_at, campaign.status]);

    return (
      <div className="flex flex-col gap-1">
        {/* Timer até próximo lead */}
        {timeRemaining && campaign.status === 'running' ? (
          <div className="flex items-center gap-1 text-xs text-blue-600">
            <Timer className="w-3 h-3" />
            <span className="font-medium">{timeRemaining}</span>
          </div>
        ) : (
          <div className="flex items-center gap-1 text-xs text-gray-400">
            <Timer className="w-3 h-3" />
            <span className="font-medium">00:00:00</span>
          </div>
        )}
        {/* Delay configurado */}
        <div className="text-xs text-gray-500 dark:text-gray-400">
          Intervalo: <span className="font-medium text-gray-700 dark:text-gray-300">{delayTime}</span>
        </div>
      </div>
    );
  };

  // Get instances info for a campaign
  const getCampaignInstancesInfo = (campaign: Campaign) => {
    if (!campaign.instances || !Array.isArray(campaign.instances) || campaign.instances.length === 0) {
      return [];
    }
    
    return campaign.instances.map((instanceName: string) => {
      const instance = instances.find(inst => inst.instance_name === instanceName);
      return {
        name: instanceName,
        instance,
        hasProxy: !!instance?.proxy_id || !!instance?.proxy,
        status: instance?.status || 'unknown',
      };
    });
  };

  // Check instances connection
  const handleCheckInstances = async (campaignId: string) => {
    setCheckingInstances(campaignId);
    try {
      const userId = typeof window !== 'undefined' 
        ? (localStorage.getItem('user_id') || sessionStorage.getItem('user_id') || sessionStorage.getItem('profile_id') || '')
        : '';
      
      const response = await fetch(`/api/campaigns/${campaignId}/check-instances`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(userId ? { 'X-User-Id': userId } : {}),
        },
      });

      const data = await response.json();
      
      if (data.success && data.data) {
        setInstanceStatuses(prev => ({
          ...prev,
          [campaignId]: data.data.instances || [],
        }));
        
        if (data.data.all_connected) {
          showToast?.('Todas as instâncias estão conectadas', 'success');
        } else {
          const connectedCount = data.data.connected_count;
          const totalCount = data.data.total_instances;
          showToast?.(`${connectedCount} de ${totalCount} instâncias conectadas`, 'info');
        }
      } else {
        showToast?.(data.message || 'Erro ao verificar instâncias', 'error');
      }
    } catch (error) {
      showToast?.('Erro ao verificar instâncias', 'error');
    } finally {
      setCheckingInstances(null);
    }
  };

  // Handle edit campaign
  const handleEditCampaign = (campaign: Campaign) => {
    setEditingCampaign(campaign);
  };

  // Handle close modal
  const handleCloseModal = () => {
    setEditingCampaign(null);
  };

  // Handle save campaign
  const handleSaveCampaign = async (campaignId: string, updates: CampaignUpdates) => {
    if (!onUpdateCampaign) {
      showToast?.('Função de atualização não disponível', 'error');
      return;
    }

    try {
      await onUpdateCampaign(campaignId, updates);
      showToast?.('Campanha atualizada com sucesso', 'success');
      setEditingCampaign(null);
    } catch (error: any) {
      showToast?.(error.message || 'Erro ao atualizar campanha', 'error');
      throw error;
    }
  };

  // Handle check instances for modal
  const handleCheckInstancesForModal = async (campaignId: string) => {
    if (!onCheckInstances) return null;
    
    setCheckingInstances(campaignId);
    try {
      const result = await onCheckInstances(campaignId);
      
      if (result?.data?.instances) {
        setInstanceStatuses(prev => ({
          ...prev,
          [campaignId]: result.data.instances || [],
        }));
      }
      
      return result;
    } catch (error) {
      return null;
    } finally {
      setCheckingInstances(null);
    }
  };

  // Handle reactivate
  const handleReactivate = async (campaignId: string) => {
    if (onReactivate) {
      try {
        await onReactivate(campaignId);
        showToast?.('Campanha reativada com sucesso', 'success');
      } catch (error) {
        showToast?.('Erro ao reativar campanha', 'error');
      }
    } else if (onResume) {
      // Se não tem handler específico, usa onResume como fallback
      try {
        await onResume(campaignId);
        showToast?.('Campanha reativada com sucesso', 'success');
      } catch (error) {
        showToast?.('Erro ao reativar campanha', 'error');
      }
    }
  };

  // Handle toggle switch
  const handleToggleCampaign = async (campaign: Campaign) => {
    const isRunning = campaign.status === 'running';
    
    if (isRunning) {
      // Desativa: pausa a campanha
      if (onPause) {
        onPause(campaign.id);
      }
    } else {
      // Ativa: muda status para running
      if (campaign.status === 'failed') {
        // Campanha falhada: reativa
        await handleReactivate(campaign.id);
      } else if (campaign.status === 'paused') {
        // Campanha pausada: retoma
        if (onResume) {
          onResume(campaign.id);
        }
      } else if (campaign.status === 'pending') {
        // Já está iniciando, não faz nada
        return;
      } else {
        // Outros status: tenta reativar
        await handleReactivate(campaign.id);
      }
    }
  };

  // Get status badge
  const getStatusBadge = (campaign: Campaign) => {
    const statusConfig = {
      running: { bg: 'bg-blue-100 dark:bg-blue-900/40', text: 'text-blue-700 dark:text-blue-300', label: 'Ativa' },
      paused: { bg: 'bg-yellow-100 dark:bg-yellow-900/40', text: 'text-yellow-700 dark:text-yellow-300', label: 'Pausada' },
      pending: { bg: 'bg-gray-100 dark:bg-[#404040]', text: 'text-gray-700 dark:text-gray-300', label: 'Iniciando...' },
      completed: { bg: 'bg-green-100 dark:bg-[#E86A24]/20', text: 'text-green-700 dark:text-[#E86A24]', label: 'Concluída' },
      failed: { bg: 'bg-red-100 dark:bg-red-900/40', text: 'text-red-700 dark:text-red-300', label: 'Falhou' },
    };

    const config = statusConfig[campaign.status as keyof typeof statusConfig] || statusConfig.pending;

    return (
      <span className={`px-2 py-1 rounded text-xs font-medium ${config.bg} ${config.text}`}>
        {config.label}
      </span>
    );
  };

  if (sortedCampaigns.length === 0) {
    return (
      <div className="bg-white dark:bg-[#2a2a2a] rounded-lg border border-gray-200 dark:border-[#404040] p-8 text-center">
        <p className="text-gray-500 dark:text-gray-400">Nenhuma campanha encontrada</p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-[#2a2a2a] rounded-lg border border-gray-200 dark:border-[#404040] overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 dark:bg-[#333] border-b border-gray-200 dark:border-[#404040]">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                Nome da campanha
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                Status
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                Instâncias
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                Proxy
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                Resultados
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                Alcance
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                Próximo Lead
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                Ações
              </th>
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-[#2a2a2a] divide-y divide-gray-200 dark:divide-[#404040]">
            {paginatedCampaigns.map((campaign) => {
              const instancesInfo = getCampaignInstancesInfo(campaign);
              const isActive = ['running', 'paused', 'pending'].includes(campaign.status);
              const isFailed = campaign.status === 'failed';

              return (
                <tr key={campaign.id} className={isActive ? 'bg-blue-50/30 dark:bg-blue-900/20' : ''}>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="flex items-center gap-3">
                      {/* Toggle Switch */}
                      <button
                        onClick={() => handleToggleCampaign(campaign)}
                        disabled={campaign.status === 'completed'}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-[#E86A24] focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${
                          campaign.status === 'running'
                            ? 'bg-blue-500'
                            : 'bg-gray-300'
                        }`}
                        role="switch"
                        aria-checked={campaign.status === 'running'}
                        title={campaign.status === 'running' ? 'Desativar campanha' : 'Ativar campanha'}
                      >
                        <span
                          className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-lg transition-transform ${
                            campaign.status === 'running'
                              ? 'translate-x-6'
                              : 'translate-x-1'
                          }`}
                        />
                      </button>
                      <div className="flex-1">
                        <div className="text-sm font-medium text-gray-900 dark:text-white">
                          {campaign.group_subject || campaign.group_id}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 font-mono">{campaign.id.substring(0, 8)}...</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {getStatusBadge(campaign)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="space-y-1">
                      {instancesInfo.map((info, idx) => (
                        <div key={idx} className="text-xs text-gray-700 dark:text-gray-300">
                          {info.name}
                          {instanceListUiStatusIsConnected(info.status) && (
                            <CheckCircle2 className="inline w-3 h-3 text-green-500 ml-1" aria-hidden />
                          )}
                          {String(info.status ?? '')
                            .trim()
                            .toLowerCase() === 'disconnected' && (
                            <XCircle className="inline w-3 h-3 text-red-500 ml-1" aria-hidden />
                          )}
                        </div>
                      ))}
                      {instancesInfo.length === 0 && (
                        <span className="text-xs text-gray-400 dark:text-gray-500">Nenhuma instância</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="space-y-1">
                      {instancesInfo.map((info, idx) => (
                        <div key={idx} className="text-xs">
                          {info.hasProxy ? (
                            <span className="text-green-600">✓ Sim</span>
                          ) : (
                            <span className="text-gray-400 dark:text-gray-500">✗ Não</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-xs text-gray-700 dark:text-gray-300">
                      <div>Adicionados: <span className="font-semibold text-green-600 dark:text-[#E86A24]">{Number(campaign.processed_contacts ?? 0)}</span></div>
                      <div>Falhas: <span className="font-semibold text-red-600">{Number(campaign.failed_contacts ?? 0)}</span></div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-xs text-gray-700 dark:text-gray-300">
                      {(Number(campaign.processed_contacts ?? 0) + Number(campaign.failed_contacts ?? 0))} / {Number(campaign.total_contacts ?? 0)}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <TimerComponent campaign={campaign} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      {isFailed && (
                        <>
                          <button
                            onClick={() => handleCheckInstances(campaign.id)}
                            disabled={checkingInstances === campaign.id}
                            className="p-1.5 bg-blue-500 hover:bg-blue-600 text-white rounded transition disabled:opacity-50"
                            title="Verificar instâncias"
                          >
                            {checkingInstances === campaign.id ? (
                              <RefreshCw className="w-4 h-4 animate-spin" />
                            ) : (
                              <AlertCircle className="w-4 h-4" />
                            )}
                          </button>
                          {(instanceStatuses[campaign.id] || []).length > 0 && 
                           (instanceStatuses[campaign.id] || []).every(s => s.connected) && (
                            <button
                              onClick={() => handleReactivate(campaign.id)}
                              className="p-1.5 bg-green-500 hover:bg-green-600 text-white rounded transition"
                              title="Reativar campanha"
                            >
                              <Play className="w-4 h-4" />
                            </button>
                          )}
                        </>
                      )}
                      {!isFailed && (
                        <>
                          {campaign.status === 'running' ? (
                            <button
                              onClick={() => onPause?.(campaign.id)}
                              className="p-1.5 bg-yellow-500 hover:bg-yellow-600 text-white rounded transition"
                              title="Pausar"
                            >
                              <Pause className="w-4 h-4" />
                            </button>
                          ) : campaign.status === 'paused' ? (
                            <button
                              onClick={() => onResume?.(campaign.id)}
                              className="p-1.5 bg-green-500 hover:bg-green-600 text-white rounded transition"
                              title="Retomar"
                            >
                              <Play className="w-4 h-4" />
                            </button>
                          ) : null}
                        </>
                      )}
                      <button
                        onClick={() => handleEditCampaign(campaign)}
                        className="p-1.5 bg-gray-500 hover:bg-gray-600 text-white rounded transition"
                        title="Editar campanha"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => onDelete?.(campaign.id)}
                        className="p-1.5 bg-red-500 hover:bg-red-600 text-white rounded transition"
                        title="Excluir"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="bg-gray-50 dark:bg-[#333] px-4 py-3 border-t border-gray-200 dark:border-[#404040] flex items-center justify-between">
          <div className="text-sm text-gray-700 dark:text-gray-300">
            Mostrando {startIndex + 1} a {Math.min(endIndex, sortedCampaigns.length)} de {sortedCampaigns.length} campanhas
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setCurrentPage(1)}
              disabled={currentPage === 1}
              className="p-2 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-[#404040] rounded disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronsLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
              disabled={currentPage === 1}
              className="p-2 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-[#404040] rounded disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="px-3 py-2 text-sm text-gray-700 dark:text-gray-300">
              Página {currentPage} de {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
              disabled={currentPage === totalPages}
              className="p-2 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-[#404040] rounded disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <button
              onClick={() => setCurrentPage(totalPages)}
              disabled={currentPage === totalPages}
              className="p-2 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-[#404040] rounded disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronsRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Modal de Edição de Campanha */}
      {editingCampaign && (
        <EditCampaignModal
          campaign={editingCampaign}
          instances={instances}
          isOpen={!!editingCampaign}
          onClose={handleCloseModal}
          onSave={handleSaveCampaign}
          onCheckInstances={handleCheckInstancesForModal}
          showToast={showToast}
        />
      )}
    </div>
  );
};

export default CampaignsTable;

