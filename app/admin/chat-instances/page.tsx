'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { 
  Plus, 
  Settings, 
  Trash2, 
  RefreshCw, 
  CheckCircle2, 
  X,
  XCircle,
  AlertTriangle,
  QrCode
} from 'lucide-react';
import QRCodeModal from '@/components/QRCodeModal';

interface EvolutionApi {
  id: string;
  name: string;
}

interface ChatInstance {
  id: string;
  instance_name: string;
  phone_number: string;
  status: string;
  webhook_configured: boolean;
  created_at: string;
  evolution_apis: {
    name: string;
  };
}

export default function ChatInstancesAdmin() {
  const router = useRouter();
  const [instances, setInstances] = useState<ChatInstance[]>([]);
  const [evolutionApis, setEvolutionApis] = useState<EvolutionApi[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [isDeletingDisconnected, setIsDeletingDisconnected] = useState(false);
  const [isDeletingAllInstances, setIsDeletingAllInstances] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  
  // Form state
  const [newInstance, setNewInstance] = useState({
    evolution_api_id: '',
    instance_name: '',
    workspace_id: ''
  });

  const [qrCodeData, setQrCodeData] = useState<{ isOpen: boolean; qrCode: string | null; instanceName: string }>({
    isOpen: false,
    qrCode: null,
    instanceName: ''
  });

  const userId = typeof window !== 'undefined' ? (sessionStorage.getItem('user_id') || localStorage.getItem('profile_id')) : null;

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [instRes, apiRes] = await Promise.all([
        fetch('/api/admin/chat/instances', { headers: { 'X-User-Id': userId || '' } }),
        fetch('/api/admin/evolution-apis', { headers: { 'X-User-Id': userId || '' } })
      ]);

      const instData = await instRes.json();
      const apiData = await apiRes.json();

      if (instData.success) setInstances(instData.data);
      if (apiData.success) {
        setEvolutionApis(apiData.data);
        if (apiData.data.length > 0) {
          setNewInstance(prev => ({ ...prev, evolution_api_id: apiData.data[0].id }));
        }
      }
    } catch (error) {
      console.error('Erro ao carregar dados:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsCreating(true);
    try {
      const response = await fetch('/api/instances/create', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-User-Id': userId || ''
        },
        body: JSON.stringify(newInstance)
      });

      const result = await response.json();
      if (result.success) {
        if (result.data?.warning) {
          alert(result.data.warning);
        } else {
          alert('Instância criada com sucesso!');
        }
        setNewInstance({ ...newInstance, instance_name: '' });
        fetchData();
        
        // Se retornou QR code, mostrar
        const qrMaybe =
          result.data?.qr_code ||
          result.data?.evolution_data?.qrcode?.base64 ||
          result.data?.evolution_data?.qrcode;
        if (qrMaybe) {
          const qr = qrMaybe;
          setQrCodeData({
            isOpen: true,
            qrCode: qr,
            instanceName: result.data.instance.instance_name
          });
        }
      } else {
        alert('Erro: ' + (result.message || result.error || 'Erro desconhecido'));
      }
    } catch (error) {
      console.error('Erro ao criar instância:', error);
      alert('Erro ao criar instância');
    } finally {
      setIsCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Tem certeza que deseja deletar esta instância de chat?')) return;
    
    // Implementar DELETE se necessário, por ora apenas alerta
    alert('Funcionalidade de exclusão em desenvolvimento');
  };

  const handleDeleteDisconnected = async () => {
    const disconnectedInstances = instances.filter((inst) => inst.status !== 'ok');
    if (disconnectedInstances.length === 0) {
      alert('Não há instâncias desconectadas para deletar.');
      return;
    }

    const confirmed = confirm(
      `Tem certeza que deseja deletar ${disconnectedInstances.length} instância(s) desconectada(s)? Esta ação não pode ser desfeita.`
    );
    if (!confirmed) return;

    setIsDeletingDisconnected(true);
    let deletedCount = 0;
    let errorCount = 0;

    try {
      for (const instance of disconnectedInstances) {
        try {
          const response = await fetch(`/api/instances/${encodeURIComponent(instance.instance_name)}`, {
            method: 'DELETE',
            headers: { 'X-User-Id': userId || '' },
          });

          const result = await response.json();
          if (response.ok && result?.success) {
            deletedCount += 1;
          } else {
            errorCount += 1;
          }
        } catch {
          errorCount += 1;
        }
      }

      if (deletedCount > 0 && errorCount === 0) {
        alert(`${deletedCount} instância(s) desconectada(s) deletada(s) com sucesso.`);
      } else if (deletedCount > 0) {
        alert(`${deletedCount} instância(s) deletada(s) e ${errorCount} falha(s) ao deletar.`);
      } else {
        alert('Não foi possível deletar as instâncias desconectadas.');
      }

      fetchData();
    } finally {
      setIsDeletingDisconnected(false);
    }
  };

  const handleDeleteAllInstances = async () => {
    if (instances.length === 0) {
      alert('Não há instâncias para deletar.');
      return;
    }

    const confirmed = confirm(
      `Tem certeza que deseja deletar TODAS as ${instances.length} instância(s) da lista? Esta ação não pode ser desfeita.`
    );
    if (!confirmed) return;

    setIsDeletingAllInstances(true);
    let deletedCount = 0;
    let errorCount = 0;

    try {
      for (const instance of instances) {
        try {
          const response = await fetch(`/api/instances/${encodeURIComponent(instance.instance_name)}`, {
            method: 'DELETE',
            headers: { 'X-User-Id': userId || '' },
          });

          const result = await response.json();
          if (response.ok && result?.success) {
            deletedCount += 1;
          } else {
            errorCount += 1;
          }
        } catch {
          errorCount += 1;
        }
      }

      if (deletedCount > 0 && errorCount === 0) {
        alert(`${deletedCount} instância(s) deletada(s) com sucesso.`);
      } else if (deletedCount > 0) {
        alert(`${deletedCount} instância(s) deletada(s) e ${errorCount} falha(s) ao deletar.`);
      } else {
        alert('Não foi possível deletar as instâncias da lista.');
      }

      fetchData();
    } finally {
      setIsDeletingAllInstances(false);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Instâncias de Chat</h1>
          <p className="text-gray-500">Gerencie as instâncias exclusivas para o chat interno.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => router.push('/admin')}
            className="p-2 text-gray-500 hover:text-gray-800 transition"
            title="Voltar para o Admin"
            type="button"
          >
            <X className="w-5 h-5" />
          </button>
          <button 
            onClick={() => fetchData()}
            className="p-2 text-gray-500 hover:text-emerald-500 transition"
            title="Atualizar"
            type="button"
          >
            <RefreshCw className={`w-5 h-5 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Formulário de Criação */}
        <div className="lg:col-span-1">
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Plus className="w-5 h-5 text-emerald-500" />
              Nova Instância
            </h2>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">API Evolution</label>
                <select 
                  className="w-full p-2 border border-gray-200 rounded-lg text-sm focus:ring-emerald-500"
                  value={newInstance.evolution_api_id}
                  onChange={(e) => setNewInstance({ ...newInstance, evolution_api_id: e.target.value })}
                  required
                >
                  {evolutionApis.map(api => (
                    <option key={api.id} value={api.id}>{api.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nome da Instância</label>
                <input 
                  type="text" 
                  className="w-full p-2 border border-gray-200 rounded-lg text-sm focus:ring-emerald-500"
                  placeholder="ex: chat-suporte-01"
                  value={newInstance.instance_name}
                  onChange={(e) => setNewInstance({ ...newInstance, instance_name: e.target.value })}
                  required
                />
              </div>
              <button 
                type="submit" 
                disabled={isCreating || evolutionApis.length === 0}
                className="w-full py-2 bg-emerald-500 text-white rounded-lg font-medium hover:bg-emerald-600 transition disabled:bg-gray-300"
              >
                {isCreating ? 'Criando...' : 'Criar Instância'}
              </button>
            </form>
          </div>
        </div>

        {/* Lista de Instâncias */}
        <div className="lg:col-span-2">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
              <p className="text-sm text-gray-500">
                Desconectadas: {instances.filter((inst) => inst.status !== 'ok').length}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleDeleteDisconnected}
                  disabled={isDeletingDisconnected || isDeletingAllInstances || isLoading || instances.every((inst) => inst.status === 'ok')}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500 text-white text-sm font-medium hover:bg-red-600 transition disabled:bg-gray-300 disabled:cursor-not-allowed"
                >
                  <Trash2 className="w-4 h-4" />
                  {isDeletingDisconnected ? 'Deletando desconectadas...' : 'Deletar desconectadas'}
                </button>
                <button
                  type="button"
                  onClick={handleDeleteAllInstances}
                  disabled={isDeletingAllInstances || isDeletingDisconnected || isLoading || instances.length === 0}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-red-700 text-white text-sm font-medium hover:bg-red-800 transition disabled:bg-gray-300 disabled:cursor-not-allowed"
                >
                  <Trash2 className="w-4 h-4" />
                  {isDeletingAllInstances ? 'Deletando todas...' : 'Deletar todas'}
                </button>
              </div>
            </div>
            <table className="w-full text-left">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase">Instância</th>
                  <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase">Status</th>
                  <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase">Webhook</th>
                  <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {instances.map(inst => (
                  <tr key={inst.id} className="hover:bg-gray-50 transition">
                    <td className="px-6 py-4">
                      <div className="font-medium text-gray-900">{inst.instance_name}</div>
                      <div className="text-xs text-gray-500">{inst.evolution_apis?.name}</div>
                    </td>
                    <td className="px-6 py-4">
                      {inst.status === 'ok' ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">
                          <CheckCircle2 className="w-3 h-3" /> Conectado
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                          <AlertTriangle className="w-3 h-3" /> {inst.status || 'Desconectado'}
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {inst.webhook_configured ? (
                        <span className="text-emerald-500 flex items-center gap-1 text-sm">
                          <CheckCircle2 className="w-4 h-4" /> Ativo
                        </span>
                      ) : (
                        <span className="text-red-500 flex items-center gap-1 text-sm">
                          <XCircle className="w-4 h-4" /> Inativo
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <button 
                          onClick={() => setQrCodeData({ isOpen: true, qrCode: null, instanceName: inst.instance_name })}
                          className="p-1 text-gray-400 hover:text-emerald-500"
                          title="Ver QR Code"
                        >
                          <QrCode className="w-5 h-5" />
                        </button>
                        <button className="p-1 text-gray-400 hover:text-blue-500" title="Configurar">
                          <Settings className="w-5 h-5" />
                        </button>
                        <button 
                          onClick={() => handleDelete(inst.id)}
                          className="p-1 text-gray-400 hover:text-red-500" 
                          title="Excluir"
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {instances.length === 0 && !isLoading && (
                  <tr>
                    <td colSpan={4} className="px-6 py-8 text-center text-gray-500">
                      Nenhuma instância de chat configurada.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <QRCodeModal 
        isOpen={qrCodeData.isOpen}
        onClose={() => setQrCodeData({ ...qrCodeData, isOpen: false })}
        qrCode={qrCodeData.qrCode || ''}
        qrTimer={30}
        qrExpired={false}
      />
    </div>
  );
}

