'use client';

import React from 'react';
import { MessageSquare, Lock } from 'lucide-react';

interface Instance {
  id?: string;
  instance_name: string;
  status: string;
  number?: string;
  is_blocked_for_instances?: boolean;
}

interface InstanceListProps {
  instances: Instance[];
  onViewAll?: () => void;
}

const InstanceList: React.FC<InstanceListProps> = ({ instances, onViewAll }) => {
  // Filtra apenas instâncias conectadas e pega as 5 primeiras
  const connectedInstances = instances.filter(inst => inst.status === 'connected');
  const displayInstances = connectedInstances.slice(0, 5);

  // Função para traduzir status
  const getStatusLabel = (status: string) => {
    const statusMap: Record<string, string> = {
      'connected': 'Conectada',
      'disconnected': 'Desconectada',
      'connecting': 'Conectando...',
      'error': 'Erro',
    };
    return statusMap[status] || status;
  };

  // Função para obter cor do status
  const getStatusColor = (status: string) => {
    if (status === 'connected') return '';
    if (status === 'connecting') return 'text-amber-600';
    if (status === 'disconnected') return 'text-gray-500';
    return 'text-red-600';
  };
  
  const getStatusStyle = (status: string) => {
    if (status === 'connected') return { color: 'var(--zaploto-green)' };
    return {};
  };

  return (
    <div className="bg-gray-100 dark:bg-[#2a2a2a] rounded-xl shadow-md p-6 border border-gray-200 dark:border-[#404040]">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold text-gray-800 dark:text-white">Instâncias Conectadas</h3>
        {connectedInstances.length > 5 && (
          <button
            onClick={onViewAll}
            className="text-sm font-medium text-[#8CD955] dark:text-[#00ff00] hover:text-[#7BC84A] dark:hover:text-[#00e600] transition-colors"
          >
            Ver todas
          </button>
        )}
      </div>
      <div className="space-y-3">
        {displayInstances.length === 0 ? (
          <p className="text-gray-500 dark:text-[#aaa] text-sm">Nenhuma instância conectada</p>
        ) : (
          displayInstances.map((instance, index) => (
            <div
              key={instance.id || index}
              className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-[#333] rounded-lg hover:bg-[#8CD95515] dark:hover:bg-[#00ff0015] hover:border-[#8CD95540] dark:hover:border-[#00ff0040] border border-transparent dark:border-[#404040] transition-all duration-200 cursor-pointer"
            >
              <MessageSquare className={`w-5 h-5 ${getStatusColor(instance.status)}`} style={getStatusStyle(instance.status)} />
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <p className="font-medium text-gray-800 dark:text-white">{instance.instance_name}</p>
                  {/* Badge de API Bloqueada - Mostra quando a API Evolution está bloqueada para criação de instâncias */}
                  {!!instance.is_blocked_for_instances && (
                    <span
                      className="px-1.5 py-0.5 rounded text-xs font-medium bg-orange-100 dark:bg-orange-900/40 text-orange-800 dark:text-orange-300 flex items-center gap-1"
                      title="API Evolution bloqueada para criação de novas instâncias. Esta instância ainda pode ser usada para adicionar pessoas em grupos e enviar mensagens."
                    >
                      <Lock className="w-3 h-3" />
                      BLOQUEADO
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500 dark:text-[#aaa]">
                  {instance.number || 'N/A'} • <span className={getStatusColor(instance.status)} style={getStatusStyle(instance.status)}>{getStatusLabel(instance.status)}</span>
                </p>
              </div>
            </div>
          ))
        )}
      </div>
      {connectedInstances.length === 0 && instances.length > 0 && (
        <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">
          Total de instâncias: {instances.length} (nenhuma conectada no momento)
        </p>
      )}
    </div>
  );
};

export default InstanceList;

