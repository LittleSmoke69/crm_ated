'use client';

import React, { useState, useEffect } from 'react';
import { X, Search, Check, Send, Loader2, Plus } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import SendMessageChoiceModal from './SendMessageChoiceModal';
import ScheduleMessageModal from './ScheduleMessageModal';
import { useToast } from '@/hooks/useToast';
import ToastContainer from '@/components/Toast/ToastContainer';

interface Group {
  id: string;
  subject: string;
}

interface SendActivationsModalProps {
  isOpen: boolean;
  onClose: () => void;
  messageId: string;
  messageTitle: string;
  userId: string;
}

const SendActivationsModal: React.FC<SendActivationsModalProps> = ({
  isOpen,
  onClose,
  messageId,
  messageTitle,
  userId,
}) => {
  const [loading, setLoading] = useState(false);
  const [groups, setGroups] = useState<Group[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [instances, setInstances] = useState<any[]>([]);
  const [selectedInstance, setSelectedInstance] = useState<string>('');
  const [fetchingAll, setFetchingAll] = useState(false);
  const [showChoiceModal, setShowChoiceModal] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  
  const { toasts, showToast, removeToast } = useToast();

  // Carrega grupos do banco de dados (whatsapp_groups)
  const fetchDbGroups = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('whatsapp_groups')
        .select('group_id, group_subject')
        .eq('user_id', userId)
        .order('group_subject', { ascending: true });

      if (error) throw error;
      
      const formattedGroups = (data || []).map(g => ({
        id: g.group_id,
        subject: g.group_subject
      }));
      // Deduplica por id para evitar bugs de seleção (mesmo grupo listado 2x)
      const byId = new Map<string, Group>();
      formattedGroups.forEach(g => { if (!byId.has(g.id)) byId.set(g.id, g); });
      setGroups(Array.from(byId.values()).sort((a, b) => a.subject.localeCompare(b.subject)));
    } catch (error) {
      console.error('Erro ao buscar grupos do banco:', error);
    } finally {
      setLoading(false);
    }
  };

  // Carrega grupos da Evolution (fetchAllGroups)
  const fetchEvolutionGroups = async () => {
    if (!selectedInstance) {
      showToast('Selecione uma instância primeiro', 'error');
      return;
    }
    setFetchingAll(true);
    try {
      // Timeout de 50 segundos para buscar grupos
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
        console.warn('⏱️ [FETCH GROUPS] Timeout de 50s atingido ao buscar grupos');
      }, 50000);

      let response: Response;
      try {
        response = await fetch('/api/groups/fetch', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'X-User-Id': userId 
          },
          body: JSON.stringify({ instanceName: selectedInstance }),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
      } catch (fetchError: any) {
        clearTimeout(timeoutId);
        
        // Se foi abortado por timeout, relança com mensagem específica
        if (fetchError.name === 'AbortError' || controller.signal.aborted) {
          throw new Error('Timeout: A busca de grupos demorou muito. Tente novamente.');
        }
        
        // Outros erros de rede
        throw new Error(`Erro de conexão: ${fetchError.message || 'Erro desconhecido'}`);
      }

      // Verifica se a resposta é JSON antes de tentar parsear
      const contentType = response.headers.get('content-type');
      let data: any;
      
      if (!contentType || !contentType.includes('application/json')) {
        const text = await response.text();
        console.error('❌ [FETCH GROUPS] Resposta não é JSON:', text.substring(0, 200));
        
        // Se for erro 504 (Gateway Timeout), mensagem específica
        if (response.status === 504) {
          throw new Error('Timeout do servidor: A busca de grupos demorou muito. Tente novamente.');
        }
        
        throw new Error(`Servidor retornou erro (${response.status}). Tente novamente.`);
      }

      try {
        data = await response.json();
      } catch (parseError: any) {
        console.error('❌ [FETCH GROUPS] Erro ao parsear JSON:', parseError);
        throw new Error('Erro ao processar resposta do servidor. Tente novamente.');
      }

      if (data.success) {
        // Combina com os grupos existentes sem duplicar por id
        const evoGroups = (data.data || []).map((g: any) => ({
          id: g.id || g.remoteJid,
          subject: g.subject
        }));
        
        setGroups(prev => {
          const byId = new Map<string, Group>(prev.map(p => [p.id, p]));
          evoGroups.forEach((g: Group) => { if (!byId.has(g.id)) byId.set(g.id, g); });
          return Array.from(byId.values()).sort((a, b) => a.subject.localeCompare(b.subject));
        });
        showToast(`${evoGroups.length} grupos sincronizados da instância!`, 'success');
      } else {
        showToast(`Erro ao buscar grupos: ${data.error || 'Erro desconhecido'}`, 'error');
      }
    } catch (error: any) {
      console.error('❌ [FETCH GROUPS] Erro ao buscar grupos:', error);
      
      // Mensagens de erro mais específicas
      if (error.name === 'AbortError' || error.message?.includes('Timeout')) {
        showToast('Timeout: A busca de grupos demorou muito. Tente novamente ou selecione outra instância.', 'error');
      } else if (error.message) {
        showToast(`Erro ao buscar grupos: ${error.message}`, 'error');
      } else {
        showToast('Erro ao buscar grupos da Evolution. Tente novamente.', 'error');
      }
    } finally {
      setFetchingAll(false);
    }
  };

  // Quando o modal abre, mostra primeiro o modal de escolha
  useEffect(() => {
    if (isOpen && userId) {
      // Só mostra o modal de escolha se ainda não foi mostrado
      if (!showChoiceModal && !showScheduleModal) {
        setShowChoiceModal(true);
      }
    } else {
      setShowChoiceModal(false);
      setShowScheduleModal(false);
    }
  }, [isOpen, userId]);

  // Carrega instâncias e grupos do banco ao abrir (apenas quando for enviar agora)
  useEffect(() => {
    const init = async () => {
      // 1. Busca instâncias
      try {
        const response = await fetch('/api/instances', {
          headers: { 'X-User-Id': userId },
        });
        const data = await response.json();
        if (data.success) {
          // Filtra apenas instâncias mestres conectadas para ativações
          const masterConnected = data.data.filter((i: any) => 
            i.status === 'connected' && i.is_master === true
          );
          setInstances(masterConnected);
          if (masterConnected.length > 0) {
            setSelectedInstance(masterConnected[0].instance_name);
          }
        }
      } catch (error) {
        console.error('Erro ao buscar instâncias:', error);
      }

      // 2. Busca grupos do banco
      fetchDbGroups();
    };

    // Carrega quando o modal está aberto e não está mostrando os modais de escolha/agendamento
    if (isOpen && userId && !showChoiceModal && !showScheduleModal) {
      init();
    }
  }, [isOpen, userId, showChoiceModal, showScheduleModal]);

  const filteredGroups = groups.filter(g => 
    g.subject.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // IDs únicos dos grupos filtrados (evita bug quando há duplicatas na lista)
  const filteredGroupIds = React.useMemo(
    () => [...new Set(filteredGroups.map(g => g.id))],
    [filteredGroups]
  );
  const allFilteredSelected = filteredGroupIds.length > 0 && filteredGroupIds.every(id => selectedGroups.has(id));

  const handleSelectAll = () => {
    if (allFilteredSelected) {
      setSelectedGroups(new Set());
    } else {
      setSelectedGroups(new Set(filteredGroupIds));
    }
  };

  const toggleGroup = (groupId: string) => {
    setSelectedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  const handleSend = async () => {
    if (selectedGroups.size === 0) {
      showToast('Selecione pelo menos um grupo', 'error');
      return;
    }

    if (!selectedInstance) {
      showToast('Selecione uma instância', 'error');
      return;
    }

    setSending(true);
    try {
      // Timeout de 60 segundos para envio de mensagens (pode demorar mais)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
        console.warn('⏱️ [SEND] Timeout de 60s atingido ao enviar mensagens');
      }, 60000);

      let response: Response;
      try {
        response = await fetch('/api/crm/activations/send', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-User-Id': userId,
          },
          body: JSON.stringify({
            messageId,
            groupIds: Array.from(selectedGroups),
            instanceName: selectedInstance,
          }),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
      } catch (fetchError: any) {
        clearTimeout(timeoutId);
        
        // Se foi abortado por timeout, relança com mensagem específica
        if (fetchError.name === 'AbortError' || controller.signal.aborted) {
          throw new Error('Timeout: A requisição demorou mais de 60 segundos. Tente novamente.');
        }
        
        // Outros erros de rede
        throw new Error(`Erro de conexão: ${fetchError.message || 'Erro desconhecido'}`);
      }

      // Verifica se a resposta é JSON antes de tentar parsear
      const contentType = response.headers.get('content-type');
      let data: any;
      
      if (!contentType || !contentType.includes('application/json')) {
        const text = await response.text();
        console.error('❌ [SEND] Resposta não é JSON:', text.substring(0, 200));
        
        // Se for erro 504 (Gateway Timeout), mensagem específica
        if (response.status === 504) {
          throw new Error('Timeout do servidor: A requisição demorou muito. Tente novamente com menos grupos.');
        }
        
        throw new Error(`Servidor retornou erro (${response.status}). Tente novamente.`);
      }

      try {
        data = await response.json();
      } catch (parseError: any) {
        console.error('❌ [SEND] Erro ao parsear JSON:', parseError);
        throw new Error('Erro ao processar resposta do servidor. Tente novamente.');
      }

      if (data.success) {
        const successMsg = data.data.success > 0 
          ? `Mensagem enviada com sucesso para ${data.data.success} grupo(s)!`
          : 'Nenhuma mensagem foi enviada.';
        const failMsg = data.data.failed > 0 
          ? ` ${data.data.failed} falha(s).` 
          : '';
        showToast(successMsg + failMsg, data.data.failed > 0 ? 'error' : 'success');
        onClose();
      } else {
        showToast(`Erro ao enviar mensagens: ${data.error || 'Erro desconhecido'}`, 'error');
      }
    } catch (error: any) {
      console.error('❌ [SEND] Erro ao enviar mensagens:', error);
      
      // Mensagens de erro mais específicas
      if (error.name === 'AbortError' || error.message?.includes('Timeout')) {
        showToast('Timeout: A requisição demorou muito. Tente novamente com menos grupos ou verifique sua conexão.', 'error');
      } else if (error.message) {
        showToast(`Erro ao enviar mensagens: ${error.message}`, 'error');
      } else {
        showToast('Erro ao enviar mensagens: Erro desconhecido. Tente novamente.', 'error');
      }
    } finally {
      setSending(false);
    }
  };

  // Mostra modal de escolha primeiro
  if (showChoiceModal) {
    return (
      <SendMessageChoiceModal
        isOpen={showChoiceModal}
        onClose={() => {
          setShowChoiceModal(false);
          onClose();
        }}
        onSendNow={() => {
          setShowChoiceModal(false);
          // Continua com o fluxo normal de envio (o modal principal já está aberto)
          // Carrega dados se ainda não foram carregados
          if (instances.length === 0) {
            fetch('/api/instances', {
              headers: { 'X-User-Id': userId },
            })
              .then(res => res.json())
              .then(data => {
                if (data.success) {
                  // Filtra apenas instâncias mestres conectadas para ativações
                  const masterConnected = data.data.filter((i: any) => 
                    i.status === 'connected' && i.is_master === true
                  );
                  setInstances(masterConnected);
                  if (masterConnected.length > 0) {
                    setSelectedInstance(masterConnected[0].instance_name);
                  }
                }
              })
              .catch(err => console.error('Erro ao buscar instâncias:', err));
            fetchDbGroups();
          }
        }}
        onSchedule={() => {
          setShowChoiceModal(false);
          setShowScheduleModal(true);
        }}
        messageTitle={messageTitle}
      />
    );
  }

  // Mostra modal de agendamento se foi escolhido
  if (showScheduleModal) {
    return (
      <ScheduleMessageModal
        isOpen={showScheduleModal}
        onClose={() => {
          setShowScheduleModal(false);
          onClose();
        }}
        messageId={messageId}
        messageTitle={messageTitle}
        userId={userId}
      />
    );
  }

  if (!isOpen) return null;

  return (
    <>
      <ToastContainer toasts={toasts} onClose={removeToast} />
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100] p-3 sm:p-4 overflow-y-auto">
        <div className="bg-gray-100 border border-gray-200 rounded-2xl w-full max-w-md sm:max-w-lg shadow-2xl flex flex-col min-h-0 max-h-[calc(100vh-2rem)] my-auto overflow-y-auto overflow-x-hidden">
        {/* Header */}
        <div className="p-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
          <div className="flex-1 pr-2">
            <h2 className="text-gray-800 font-bold text-lg">Escolha os grupos nos quais deseja enviar a mensagem selecionada agora</h2>
          </div>
          <button 
            onClick={onClose}
            className="p-2 hover:bg-gray-200 rounded-full text-gray-600 transition-colors flex-shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Instância Select */}
        <div className="p-4 border-b border-gray-200 flex-shrink-0">
          <label className="text-gray-700 text-xs font-semibold mb-2 block uppercase tracking-wider">
            Instância *
          </label>
          <select
            value={selectedInstance}
            onChange={(e) => setSelectedInstance(e.target.value)}
            className="w-full bg-white border border-gray-300 rounded-xl px-4 py-2.5 text-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955]"
          >
            {instances.length === 0 ? (
              <option value="">Nenhuma instância conectada</option>
            ) : (
              instances.map((inst) => (
                <option key={inst.id} value={inst.instance_name}>
                  {inst.instance_name}
                </option>
              ))
            )}
          </select>
        </div>

        {/* Filtros e Seleção */}
        <div className="p-4 space-y-4 flex-shrink-0 border-b border-gray-200">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-700 font-medium">Grupos disponíveis *</span>
            <button 
              onClick={fetchEvolutionGroups}
              disabled={fetchingAll || !selectedInstance}
              className="text-[#8CD955] hover:text-[#7BC84A] flex items-center gap-1.5 font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {fetchingAll ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Plus className="w-3.5 h-3.5" />
              )}
              Extrair todos os grupos
            </button>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input 
              type="text" 
              placeholder="Pesquisar grupos..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-gray-100 border border-gray-200 rounded-xl pl-10 pr-4 py-2.5 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] placeholder:text-gray-500"
            />
          </div>

          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={handleSelectAll}
              className="flex items-center gap-3 cursor-pointer group text-left"
            >
              <div className={`w-5 h-5 rounded border flex items-center justify-center transition-all flex-shrink-0 ${
                allFilteredSelected
                  ? 'bg-[#8CD955] border-[#8CD955] shadow-[0_0_10px_rgba(140,217,85,0.3)]' 
                  : 'bg-white border-gray-300 group-hover:border-[#8CD955]'
              }`}>
                {allFilteredSelected && <Check className="w-3.5 h-3.5 text-white stroke-[3]" />}
              </div>
              <span className="text-sm text-gray-700 font-medium">Selecione todos os grupos</span>
            </button>
            <span className="text-[#8CD955] font-bold text-sm">Total: {filteredGroupIds.length}</span>
          </div>
        </div>

        {/* Lista de Grupos - scroll interno; altura limitada para o footer ficar sempre visível */}
        <div className="flex-1 min-h-[100px] overflow-y-auto overflow-x-hidden px-2 py-2 custom-scrollbar" style={{ maxHeight: '220px' }}>
          {loading ? (
            <div className="flex flex-col items-center justify-center min-h-[200px] py-12 gap-3">
              <Loader2 className="w-8 h-8 text-[#8CD955] animate-spin" />
              <span className="text-gray-500 text-sm inline-flex items-center">
                Isso pode demorar um pouco
                <span className="inline-flex ml-1 gap-0">
                  <span className="wave-dot-1">.</span>
                  <span className="wave-dot-2">.</span>
                  <span className="wave-dot-3">.</span>
                </span>
              </span>
            </div>
          ) : filteredGroups.length === 0 ? (
            <div className="flex flex-col items-center justify-center min-h-[200px] py-12 text-center">
              <span className="text-gray-500 text-sm">Nenhum grupo encontrado</span>
            </div>
          ) : (
            <div className="space-y-1.5 pb-1">
              {filteredGroups.map((group, index) => (
                <button
                  key={`${group.id}-${index}`}
                  type="button"
                  onClick={() => toggleGroup(group.id)}
                  className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all group text-left ${
                    selectedGroups.has(group.id) ? 'bg-[#8CD955]/10 border border-[#8CD955]/40' : 'hover:bg-[#8CD955]/5 border border-transparent hover:border-[#8CD955]/20'
                  }`}
                >
                  <div className={`w-5 h-5 rounded border flex items-center justify-center transition-all flex-shrink-0 mt-0.5 ${
                    selectedGroups.has(group.id) 
                      ? 'bg-[#8CD955] border-[#8CD955] shadow-[0_0_10px_rgba(140,217,85,0.3)]' 
                      : 'bg-white border-gray-300 group-hover:border-[#8CD955]'
                  }`}>
                    {selectedGroups.has(group.id) && <Check className="w-3.5 h-3.5 text-white stroke-[3]" />}
                  </div>
                  <span className={`text-sm font-medium text-left break-words line-clamp-2 ${selectedGroups.has(group.id) ? 'text-[#6AB83D]' : 'text-gray-700 group-hover:text-[#8CD955]'}`} title={group.subject}>
                    {group.subject}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer Actions - sempre visível */}
        <div className="p-4 border-t border-gray-200 bg-white flex gap-3 flex-shrink-0">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-3 bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold rounded-xl transition-all"
          >
            Cancelar
          </button>
          <button
            onClick={handleSend}
            disabled={sending || selectedGroups.size === 0}
            className="flex-1 px-4 py-3 bg-[#8CD955] hover:bg-[#7BC84A] disabled:opacity-50 disabled:hover:bg-[#8CD955] text-white font-bold rounded-xl transition-all shadow-lg shadow-[#8CD955]/20 flex items-center justify-center gap-2"
          >
            {sending ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <>
                <Send className="w-5 h-5" />
                Enviar
              </>
            )}
          </button>
        </div>
        </div>
      </div>
    </>
  );
};

export default SendActivationsModal;

// Simple ChevronDown icon since it's not in the imports
const ChevronDown = ({ className }: { className?: string }) => (
  <svg 
    xmlns="http://www.w3.org/2000/svg" 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth="2" 
    strokeLinecap="round" 
    strokeLinejoin="round" 
    className={className}
  >
    <path d="m6 9 6 6 6-6"/>
  </svg>
);

