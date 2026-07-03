'use client';

import React, { useState, useEffect } from 'react';
import { Pause, Play, Trash2, Clock, CheckCircle2, XCircle, History, ChevronDown, ChevronUp, Timer } from 'lucide-react';
import { Campaign } from '@/hooks/useDashboardData';

interface ActiveCampaignsProps {
  campaigns: Campaign[];
  onPause?: (campaignId: string) => void;
  onResume?: (campaignId: string) => void;
  onDelete?: (campaignId: string) => void;
}

// Componente separado para cada campanha (permite usar hooks)
interface CampaignCardProps {
  campaign: Campaign;
  showActions: boolean;
  onPause?: (campaignId: string) => void;
  onResume?: (campaignId: string) => void;
  onDelete?: (campaignId: string) => void;
}

const CampaignCard: React.FC<CampaignCardProps> = ({
  campaign,
  showActions,
  onPause,
  onResume,
  onDelete,
}) => {
  const total = campaign.total_contacts || 1;
  const processed = campaign.processed_contacts || 0;
  const failed = campaign.failed_contacts || 0;
  const observation = campaign.observation || '';
  const completed = processed + failed;
  const progressPercentage = Math.round((completed / total) * 100);
  const successPercentage = completed > 0 ? Math.round((processed / completed) * 100) : 0;
  const failedPercentage = completed > 0 ? Math.round((failed / completed) * 100) : 0;
  const isPaused = campaign.status === 'paused';
  const isCompleted = campaign.status === 'completed';
  const isFailed = campaign.status === 'failed';
  const isPending = campaign.status === 'pending';
  const isRunning = campaign.status === 'running';
  
  // Timer para próximo request (hooks agora estão no nível do componente)
  const [timeRemaining, setTimeRemaining] = useState<string>('');
  
  useEffect(() => {
    if (!isRunning || isPaused || !campaign.next_request_at) {
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
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      
      if (minutes > 0) {
        setTimeRemaining(`${minutes}min ${seconds}s`);
      } else {
        setTimeRemaining(`${seconds}s`);
      }
    };
    
    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    
    return () => clearInterval(interval);
  }, [campaign.next_request_at, isRunning, isPaused]);

  return (
    <div
      className={`p-4 border-2 rounded-lg transition relative ${
        isFailed
          ? 'border-red-200 bg-red-50/50'
          : isCompleted
          ? 'border-gray-200 bg-gray-50/50'
          : 'border-gray-200 hover:border-gray-300 bg-gray-100'
      }`}
    >
        {/* Overlay de loading para campanhas pendentes */}
        {isPending && (
          <div className="absolute inset-0 backdrop-blur-sm rounded-lg flex items-center justify-center z-10" style={{ backgroundColor: '#E86A2433' }}>
            <div className="flex flex-col items-center gap-3">
              <div className="w-12 h-12 border-4 border-t-transparent rounded-full animate-spin" style={{ borderColor: '#E86A24' }}></div>
              <p className="text-sm font-medium" style={{ color: '#C9531A' }}>Iniciando campanha...</p>
            </div>
          </div>
        )}
        <div className="flex justify-between items-start mb-3">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <h3 className="font-semibold text-gray-800">
                {campaign.group_subject || campaign.group_id}
              </h3>
              <span
                className={`px-2 py-1 rounded text-xs font-medium ${
                  isPending
                    ? 'bg-gray-100 text-gray-700'
                    : isPaused
                    ? 'bg-yellow-100 text-yellow-700'
                    : isFailed
                    ? 'bg-red-100 text-red-700'
                    : isCompleted
                    ? 'bg-gray-100 text-gray-700'
                    : 'bg-blue-100 text-blue-700'
                }`}
              >
                {isPending ? 'Iniciando...' : isPaused ? 'Pausada' : isCompleted ? 'Concluída' : isFailed ? `Falhou: ${observation}` : 'Em Execução'}
              </span>
            </div>
            <p className="text-xs text-gray-500 font-mono mb-2">{campaign.id}</p>
          </div>
          {showActions && (
            <div className="flex gap-2">
              {isPaused ? (
                <button
                  onClick={() => onResume?.(campaign.id)}
                  className="p-2 bg-[#E86A24] hover:bg-[#D95E1B] text-white rounded transition"
                  title="Retomar"
                >
                  <Play className="w-4 h-4" />
                </button>
              ) : !isCompleted && !isFailed ? (
                <button
                  onClick={() => onPause?.(campaign.id)}
                  className="p-2 bg-yellow-500 hover:bg-yellow-600 text-white rounded transition"
                  title="Pausar"
                >
                  <Pause className="w-4 h-4" />
                </button>
              ) : null}
              <button
                onClick={() => onDelete?.(campaign.id)}
                className="p-2 bg-red-600 hover:bg-red-700 text-white rounded transition"
                title="Excluir"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* Estatísticas */}
        <div className="grid grid-cols-3 gap-4 mb-3">
          <div className="text-center">
            <p className="text-xs text-gray-500 mb-1">Total</p>
            <p className="text-lg font-bold text-gray-800">{total}</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-gray-500 mb-1">Adicionados</p>
            <p className="text-lg font-bold text-[#E86A24]">{processed}</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-gray-500 mb-1">Falhas</p>
            <p className="text-lg font-bold text-red-600">{failed}</p>
          </div>
        </div>

        {/* Percentuais */}
        <div className="mb-3">
          <div className="flex justify-between items-center mb-1">
            <span className="text-xs text-gray-600">Progresso</span>
            <span className="text-xs font-medium text-gray-800">{progressPercentage}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2.5">
            <div
              className={`h-2.5 rounded-full transition-all ${
                isFailed ? 'bg-red-600' : 'bg-[#E86A24]'
              }`}
              style={{ width: `${progressPercentage}%` }}
            />
          </div>
        </div>

        {/* Taxa de sucesso e falha */}
        <div className="grid grid-cols-2 gap-3">
          <div className="p-2 bg-gray-100 rounded">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle2 className="w-4 h-4 text-[#E86A24]" />
              <span className="text-xs text-gray-600">Taxa de Sucesso</span>
            </div>
            <p className="text-sm font-bold text-[#E86A24]">{successPercentage}%</p>
          </div>
          <div className="p-2 bg-red-50 rounded">
            <div className="flex items-center gap-2 mb-1">
              <XCircle className="w-4 h-4 text-red-600" />
              <span className="text-xs text-gray-600">Taxa de Falha</span>
            </div>
            <p className="text-sm font-bold text-red-600">{failedPercentage}%</p>
          </div>
        </div>

        {/* Timer para próximo request */}
        {isRunning && !isPaused && timeRemaining && (
          <div className="mt-3 p-2 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex items-center gap-2 text-sm">
              <Timer className="w-4 h-4 text-blue-600 animate-pulse" />
              <span className="text-blue-700 font-medium">
                Próximo request em: <span className="font-bold">{timeRemaining}</span>
              </span>
            </div>
          </div>
        )}

        {/* Tempo */}
        <div className="mt-3 pt-3 border-t border-gray-200">
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <Clock className="w-3 h-3" />
            <span>
              Criada em: {new Date(campaign.created_at).toLocaleString('pt-BR')}
            </span>
          </div>
          {campaign.completed_at && (
            <div className="flex items-center gap-2 text-xs text-gray-500 mt-1">
              <CheckCircle2 className="w-3 h-3" />
              <span>
                Finalizada em: {new Date(campaign.completed_at).toLocaleString('pt-BR')}
              </span>
            </div>
          )}
        </div>
      </div>
  );
};

const ActiveCampaigns: React.FC<ActiveCampaignsProps> = ({
  campaigns,
  onPause,
  onResume,
  onDelete,
}) => {
  const [showHistory, setShowHistory] = useState(false);

  const activeCampaigns = campaigns.filter(
    c => c.status === 'running' || c.status === 'paused' || c.status === 'pending'
  );

  const completedCampaigns = campaigns.filter(
    c => c.status === 'completed' || c.status === 'failed'
  ).sort((a, b) => {
    // Ordena por data de conclusão (completed_at) ou created_at se não tiver completed_at
    const dateA = a.completed_at ? new Date(a.completed_at).getTime() : new Date(a.created_at).getTime();
    const dateB = b.completed_at ? new Date(b.completed_at).getTime() : new Date(b.created_at).getTime();
    return dateB - dateA; // Mais recentes primeiro
  });

  return (
    <div className="space-y-6">
      {/* Campanhas Ativas */}
      <div className="bg-gray-100 rounded-xl shadow-md p-6 border border-gray-200">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">Campanhas Ativas</h2>
        {activeCampaigns.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-4">Nenhuma campanha ativa no momento</p>
        ) : (
          <div className="space-y-4">
            {activeCampaigns.map(campaign => (
              <CampaignCard
                key={campaign.id}
                campaign={campaign}
                showActions={true}
                onPause={onPause}
                onResume={onResume}
                onDelete={onDelete}
              />
            ))}
          </div>
        )}
      </div>

      {/* Histórico de Campanhas */}
      {completedCampaigns.length > 0 && (
        <div className="bg-gray-100 rounded-xl shadow-md p-6 border border-gray-200">
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="w-full flex items-center justify-between text-lg font-semibold text-gray-800 mb-4 hover:text-[#E86A24] transition"
          >
            <div className="flex items-center gap-2">
              <History className="w-5 h-5" />
              <span>Histórico de Campanhas ({completedCampaigns.length})</span>
            </div>
            {showHistory ? (
              <ChevronUp className="w-5 h-5" />
            ) : (
              <ChevronDown className="w-5 h-5" />
            )}
          </button>
          
          {showHistory && (
            <div className="space-y-4">
              {completedCampaigns.map(campaign => (
                <CampaignCard
                  key={campaign.id}
                  campaign={campaign}
                  showActions={false}
                  onPause={onPause}
                  onResume={onResume}
                  onDelete={onDelete}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ActiveCampaigns;

