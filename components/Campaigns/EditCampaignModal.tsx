'use client';

import React, { useState, useEffect } from 'react';
import { Campaign as DashboardCampaign } from '@/hooks/useDashboardData';

// Tipo flexível para campanha (pode vir de diferentes fontes)
type Campaign = Partial<DashboardCampaign> & {
  id: string;
  user_id: string;
  group_id: string;
  group_subject: string | null;
  status: string;
  total_contacts: number;
  processed_contacts: number;
  failed_contacts: number;
  strategy: any;
  instances?: string[];
  created_at: string;
  updated_at?: string;
  started_at?: string | null;
  completed_at?: string | null;
  observation?: string | null | undefined;
};
import { WhatsAppInstance } from '@/hooks/useDashboardData';
import { 
  X, 
  CheckCircle2, 
  XCircle, 
  Plus,
  Save,
  AlertCircle,
  Clock,
  RefreshCw,
  Pause,
} from 'lucide-react';

interface EditCampaignModalProps {
  campaign: Campaign | null;
  instances: WhatsAppInstance[];
  isOpen: boolean;
  onClose: () => void;
  onSave: (campaignId: string, updates: CampaignUpdates) => Promise<void>;
  onCheckInstances?: (campaignId: string) => Promise<any>;
  showToast?: (message: string, type: 'success' | 'error' | 'info') => void;
  onCampaignUpdated?: (campaignId: string, newStatus: string) => void;
}

export interface CampaignUpdates {
  status?: string;
  instances?: string[];
  strategy?: {
    delayConfig?: {
      delayMode?: 'random' | 'fixed';
      delayValue?: number;
      delayUnit?: 'seconds' | 'minutes';
      randomMinSeconds?: number;
      randomMaxSeconds?: number;
    };
    distributionMode?: 'sequential' | 'random';
    concurrency?: number;
    interval_minutes?: number;
  };
}

const EditCampaignModal: React.FC<EditCampaignModalProps> = ({
  campaign,
  instances,
  isOpen,
  onClose,
  onSave,
  onCheckInstances,
  showToast,
  onCampaignUpdated,
}) => {
  const [selectedInstances, setSelectedInstances] = useState<string[]>([]);
  const [delayMode, setDelayMode] = useState<'random' | 'fixed'>('fixed');
  const [delayValue, setDelayValue] = useState<number>(1);
  const [delayUnit, setDelayUnit] = useState<'seconds' | 'minutes'>('minutes');
  const [randomMinSeconds, setRandomMinSeconds] = useState<number>(550);
  const [randomMaxSeconds, setRandomMaxSeconds] = useState<number>(950);
  const [distributionMode, setDistributionMode] = useState<'sequential' | 'random'>('sequential');
  const [concurrency, setConcurrency] = useState<number>(2);
  const [checkingInstances, setCheckingInstances] = useState(false);
  const [instanceStatuses, setInstanceStatuses] = useState<any[]>([]);
  const [campaignStatus, setCampaignStatus] = useState<string>('pending');

  // Carrega dados da campanha quando o modal abre
  useEffect(() => {
    if (isOpen && campaign) {
      // Carrega status
      setCampaignStatus(campaign.status || 'pending');
      
      // Carrega instâncias
      setSelectedInstances(Array.isArray(campaign.instances) ? [...campaign.instances] : []);
      
      // Carrega estratégia
      const strategy = campaign.strategy || {};
      const delayConfig = strategy.delayConfig || {};
      
      setDelayMode(delayConfig.delayMode || 'fixed');
      setDelayValue(delayConfig.delayValue || 1);
      setDelayUnit(delayConfig.delayUnit || 'minutes');
      setRandomMinSeconds(delayConfig.randomMinSeconds || 550);
      setRandomMaxSeconds(delayConfig.randomMaxSeconds || 950);
      setDistributionMode(strategy.distributionMode || 'sequential');
      setConcurrency(strategy.concurrency || 2);
      setInstanceStatuses([]);
    }
  }, [isOpen, campaign]);

  if (!isOpen || !campaign) return null;

  // Toggle instance selection
  const toggleInstance = (instanceName: string) => {
    setSelectedInstances(prev =>
      prev.includes(instanceName)
        ? prev.filter(name => name !== instanceName)
        : [...prev, instanceName]
    );
  };

  // Handle check instances
  const handleCheckInstances = async () => {
    if (!onCheckInstances) return;
    
    setCheckingInstances(true);
    try {
      const result = await onCheckInstances(campaign.id);
      if (result?.data?.instances) {
        setInstanceStatuses(result.data.instances);
        if (result.data.all_connected) {
          showToast?.('Todas as instâncias estão conectadas', 'success');
        } else {
          const connectedCount = result.data.connected_count;
          const totalCount = result.data.total_instances;
          showToast?.(`${connectedCount} de ${totalCount} instâncias conectadas`, 'info');
        }
      }
    } catch (error) {
      showToast?.('Erro ao verificar instâncias', 'error');
    } finally {
      setCheckingInstances(false);
    }
  };

  // Handle save
  const handleSave = async () => {
    if (selectedInstances.length === 0) {
      showToast?.('Selecione pelo menos uma instância', 'error');
      return;
    }

    const updates: CampaignUpdates = {
      status: campaignStatus,
      instances: selectedInstances,
      strategy: {
        delayConfig: {
          delayMode,
          delayValue: delayMode === 'fixed' ? delayValue : undefined,
          delayUnit: delayMode === 'fixed' ? delayUnit : undefined,
          randomMinSeconds: delayMode === 'random' ? randomMinSeconds : undefined,
          randomMaxSeconds: delayMode === 'random' ? randomMaxSeconds : undefined,
        },
        distributionMode,
        concurrency,
        interval_minutes: delayMode === 'fixed' 
          ? (delayUnit === 'minutes' ? delayValue : Math.round(delayValue / 60))
          : undefined,
      },
    };

    try {
      await onSave(campaign.id, updates);
      onClose();
    } catch (error) {
      // Erro já tratado no onSave
    }
  };

  // Handle pause - atualiza imediatamente
  const handlePause = async () => {
    if (!campaign) return;
    
    // Atualiza o status local imediatamente para feedback visual instantâneo
    const previousStatus = campaignStatus;
    setCampaignStatus('paused');
    
    const updates: CampaignUpdates = {
      status: 'paused',
    };

    try {
      await onSave(campaign.id, updates);
      showToast?.('Campanha pausada com sucesso!', 'success');
      // Notifica o componente pai sobre a atualização
      onCampaignUpdated?.(campaign.id, 'paused');
      // Não fecha o modal para que o usuário veja a mudança
    } catch (error) {
      // Se der erro, reverte o status
      setCampaignStatus(previousStatus);
      showToast?.('Erro ao pausar campanha', 'error');
    }
  };

  // Get instance info
  const getInstanceInfo = (instanceName: string) => {
    const inst = instances.find(i => i.instance_name === instanceName);
    const statusInfo = instanceStatuses.find(s => s.instance_name === instanceName);
    
    return {
      instance: inst,
      isConnected: statusInfo ? statusInfo.connected : (inst?.status === 'connected'),
      hasProxy: statusInfo ? statusInfo.has_proxy : (!!inst?.proxy_id || !!inst?.proxy),
      status: statusInfo ? statusInfo.status : (inst?.status || 'unknown'),
    };
  };

  const campaignInstances = selectedInstances.map(name => ({
    name,
    ...getInstanceInfo(name),
  }));

  const availableConnected = instances.filter(
    inst => inst.status === 'connected' && !selectedInstances.includes(inst.instance_name)
  );

  const availableDisconnected = instances.filter(
    inst => inst.status !== 'connected' && !selectedInstances.includes(inst.instance_name)
  );

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-[#2a2a2a] rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col border border-gray-200 dark:border-[#404040]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-[#404040] flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-gray-800 dark:text-white">Editar Campanha</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {campaign.group_subject || campaign.group_id}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 dark:hover:bg-[#404040] rounded-lg transition"
          >
            <X className="w-5 h-5 text-gray-500 dark:text-gray-400" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Status da Campanha */}
          <div className="border border-gray-200 dark:border-[#404040] rounded-lg p-4">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4 flex items-center gap-2">
              <AlertCircle className="w-4 h-4" />
              Status da Campanha
            </h3>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Status
              </label>
              <select
                value={campaignStatus}
                onChange={(e) => setCampaignStatus(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-[#555] rounded-lg focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] text-gray-700 dark:text-white bg-white dark:bg-[#333]"
              >
                <option value="pending">Pendente</option>
                <option value="running">Em Execução</option>
                <option value="paused">Pausada</option>
                <option value="completed">Concluída</option>
                <option value="failed">Falhou</option>
              </select>
            </div>
          </div>

          {/* Estratégia de Delay */}
          <div className="border border-gray-200 dark:border-[#404040] rounded-lg p-4">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4 flex items-center gap-2">
              <Clock className="w-4 h-4" />
              Estratégia de Delay (Atraso entre inclusões)
            </h3>
            
            <div className="space-y-4">
              {/* Modo de Delay */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Modo de Delay
                </label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="delayMode"
                      value="fixed"
                      checked={delayMode === 'fixed'}
                      onChange={(e) => setDelayMode(e.target.value as 'fixed')}
                      className="w-4 h-4 text-[#8CD955] border-gray-300 focus:ring-[#8CD955]"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">Fixo</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="delayMode"
                      value="random"
                      checked={delayMode === 'random'}
                      onChange={(e) => setDelayMode(e.target.value as 'random')}
                      className="w-4 h-4 text-[#8CD955] border-gray-300 focus:ring-[#8CD955]"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">Aleatório</span>
                  </label>
                </div>
              </div>

              {/* Delay Fixo */}
              {delayMode === 'fixed' && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Valor
                    </label>
                    <input
                      type="number"
                      value={delayValue}
                      onChange={(e) => setDelayValue(Number(e.target.value))}
                      min="0"
                      className="w-full px-3 py-2 border border-gray-300 dark:border-[#555] rounded-lg focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] text-gray-700 dark:text-white bg-white dark:bg-[#333]"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Unidade
                    </label>
                    <select
                      value={delayUnit}
                      onChange={(e) => setDelayUnit(e.target.value as 'seconds' | 'minutes')}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-[#555] rounded-lg focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] text-gray-700 dark:text-white bg-white dark:bg-[#333]"
                    >
                      <option value="seconds">Segundos</option>
                      <option value="minutes">Minutos</option>
                    </select>
                  </div>
                </div>
              )}

              {/* Delay Aleatório */}
              {delayMode === 'random' && (
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Mínimo (segundos)
                    </label>
                    <input
                      type="number"
                      value={randomMinSeconds}
                      onChange={(e) => setRandomMinSeconds(Number(e.target.value))}
                      min="0"
                      className="w-full px-3 py-2 border border-gray-300 dark:border-[#555] rounded-lg focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] text-gray-700 dark:text-white bg-white dark:bg-[#333]"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Máximo (segundos)
                    </label>
                    <input
                      type="number"
                      value={randomMaxSeconds}
                      onChange={(e) => setRandomMaxSeconds(Number(e.target.value))}
                      min="0"
                      className="w-full px-3 py-2 border border-gray-300 dark:border-[#555] rounded-lg focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] text-gray-700 dark:text-white bg-white dark:bg-[#333]"
                    />
                  </div>
                  <div className="flex items-end">
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Dica: 550s=9min10s e 950s=15min50s
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Modo de Distribuição */}
          <div className="border border-gray-200 dark:border-[#404040] rounded-lg p-4">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">
              Modo de Distribuição de Instâncias
            </h3>
            
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="distributionMode"
                  value="sequential"
                  checked={distributionMode === 'sequential'}
                  onChange={(e) => setDistributionMode(e.target.value as 'sequential')}
                  className="w-4 h-4 text-[#8CD955] border-gray-300 focus:ring-[#8CD955]"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">Sequencial</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="distributionMode"
                  value="random"
                  checked={distributionMode === 'random'}
                  onChange={(e) => setDistributionMode(e.target.value as 'random')}
                  className="w-4 h-4 text-[#8CD955] border-gray-300 focus:ring-[#8CD955]"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">Aleatório</span>
              </label>
            </div>
          </div>

          {/* Concorrência */}
          <div className="border border-gray-200 dark:border-[#404040] rounded-lg p-4">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">
              Concorrência (Envios em Paralelo)
            </h3>
            
            <input
              type="number"
              value={concurrency}
              onChange={(e) => setConcurrency(Number(e.target.value))}
              min="1"
              max="10"
              className="w-full max-w-xs px-3 py-2 border border-gray-300 dark:border-[#555] rounded-lg focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] text-gray-700 dark:text-white bg-white dark:bg-[#333]"
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
              *Use com cautela para evitar rate-limit. Recomendado: 1-3
            </p>
          </div>

          {/* Instâncias */}
          <div className="border border-gray-200 dark:border-[#404040] rounded-lg p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
                <RefreshCw className="w-4 h-4" />
                Instâncias da Campanha
              </h3>
              <button
                onClick={handleCheckInstances}
                disabled={checkingInstances}
                className="px-3 py-1.5 bg-blue-500 hover:bg-blue-600 text-white text-xs font-medium rounded transition disabled:opacity-50 flex items-center gap-1.5"
              >
                {checkingInstances ? (
                  <>
                    <RefreshCw className="w-3 h-3 animate-spin" />
                    Verificando...
                  </>
                ) : (
                  <>
                    <AlertCircle className="w-3 h-3" />
                    Verificar Conexão
                  </>
                )}
              </button>
            </div>

            {/* Instâncias na campanha */}
            <div className="mb-4">
              <p className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">
                Instâncias selecionadas ({selectedInstances.length})
              </p>
              {campaignInstances.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {campaignInstances.map(({ name, isConnected, hasProxy }) => (
                    <div
                      key={name}
                      className={`px-3 py-2 rounded-md text-xs border-2 transition-all flex items-center gap-2 ${
                        isConnected
                          ? 'bg-green-50 dark:bg-[#8CD955]/20 border-green-400 dark:border-[#8CD955]/50 text-green-800 dark:text-[#8CD955]'
                          : 'bg-red-50 dark:bg-red-900/30 border-red-400 dark:border-red-600/50 text-red-800 dark:text-red-300'
                      }`}
                    >
                      {isConnected ? (
                        <CheckCircle2 className="w-4 h-4 text-green-600" />
                      ) : (
                        <XCircle className="w-4 h-4 text-red-600" />
                      )}
                      <span className="font-semibold">{name}</span>
                      {hasProxy && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-blue-200 dark:bg-blue-900/50 text-blue-800 dark:text-blue-300 rounded font-medium">
                          Proxy
                        </span>
                      )}
                      {!isConnected && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-red-200 dark:bg-red-900/50 text-red-900 dark:text-red-300 rounded font-medium">
                          Desconectada
                        </span>
                      )}
                      <button
                        onClick={() => toggleInstance(name)}
                        className="ml-1 p-0.5 hover:bg-red-200 dark:hover:bg-red-900/50 rounded transition"
                        title="Remover"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-400 dark:text-gray-500 italic">Nenhuma instância selecionada</p>
              )}
            </div>

            {/* Separador */}
            <div className="border-t border-gray-300 dark:border-[#404040] my-4"></div>

            {/* Instâncias conectadas disponíveis */}
            <div className="mb-4">
              <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">
                Instâncias conectadas disponíveis ({availableConnected.length})
              </p>
              {availableConnected.length > 0 ? (
                <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto p-2 bg-green-50 dark:bg-[#8CD955]/10 rounded border border-green-200 dark:border-[#8CD955]/30">
                  {availableConnected.map((inst) => {
                    const hasProxy = !!inst.proxy_id || !!inst.proxy;
                    return (
                      <button
                        key={inst.instance_name}
                        onClick={() => toggleInstance(inst.instance_name)}
                        className="px-3 py-1.5 rounded-md text-xs border-2 border-green-400 dark:border-[#8CD955]/50 bg-white dark:bg-[#333] text-green-700 dark:text-[#8CD955] hover:bg-green-100 dark:hover:bg-[#8CD955]/20 transition-all flex items-center gap-1.5"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
                        <span className="font-medium">{inst.instance_name}</span>
                        {hasProxy && (
                          <span className="text-[10px] px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 rounded">
                            Proxy
                          </span>
                        )}
                        <Plus className="w-3 h-3 ml-1" />
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-gray-500 dark:text-gray-400 italic">Todas as instâncias conectadas já estão na campanha</p>
              )}
            </div>

            {/* Instâncias desconectadas disponíveis */}
            {availableDisconnected.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">
                  Instâncias desconectadas ({availableDisconnected.length})
                </p>
                <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto p-2 bg-gray-50 dark:bg-[#333] rounded border border-gray-300 dark:border-[#404040]">
                  {availableDisconnected.map((inst) => {
                    const hasProxy = !!inst.proxy_id || !!inst.proxy;
                    return (
                      <button
                        key={inst.instance_name}
                        onClick={() => toggleInstance(inst.instance_name)}
                        className="px-3 py-1.5 rounded-md text-xs border-2 border-gray-300 dark:border-[#555] bg-white dark:bg-[#404040] text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#505050] transition-all flex items-center gap-1.5"
                      >
                        <XCircle className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" />
                        <span className="font-medium">{inst.instance_name}</span>
                        {hasProxy && (
                          <span className="text-[10px] px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 rounded">
                            Proxy
                          </span>
                        )}
                        <Plus className="w-3 h-3 ml-1" />
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 dark:border-[#404040] flex items-center justify-between">
          <div>
            {/* Botão de Pausar - só aparece se a campanha estiver em execução */}
            {(campaignStatus === 'running' || campaign?.status === 'running') && (
              <button
                onClick={handlePause}
                className="px-4 py-2 text-sm font-medium text-white bg-yellow-600 hover:bg-yellow-700 rounded-lg transition flex items-center gap-2"
                title="Pausar campanha imediatamente"
              >
                <Pause className="w-4 h-4" />
                Pausar Campanha
              </button>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-white bg-gray-100 dark:bg-[#333] hover:bg-gray-200 dark:hover:bg-[#404040] rounded-lg transition"
            >
              Cancelar
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-2 text-sm font-medium text-white bg-[#8CD955] hover:bg-[#7BC84A] rounded-lg transition flex items-center gap-2"
            >
              <Save className="w-4 h-4" />
              Salvar Alterações
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EditCampaignModal;

