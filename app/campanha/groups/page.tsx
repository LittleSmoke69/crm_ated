'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRequireAuth } from '@/utils/useRequireAuth';
import Layout from '@/components/Layout';
import { useDashboardData, WhatsAppInstance, DbGroup, EvolutionGroup, Contact } from '@/hooks/useDashboardData';
import {
  Users,
  Plus,
  Loader2,
  CheckCircle2,
  XCircle,
  UserPlus,
  Menu,
  X,
  AlertCircle,
  Info,
  Search,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { useSidebar } from '@/contexts/SidebarContext';
import { supabase } from '@/lib/supabase';

const GroupsPage = () => {
  const { checking } = useRequireAuth();
  const { isCollapsed, setIsCollapsed, isMobileOpen, setIsMobileOpen } = useSidebar();
  const {
    userId,
    instances,
    contacts,
    dbGroups,
    availableGroups,
    setDbGroups,
    setAvailableGroups,
    showToast,
    addLog,
    toasts,
    setToasts,
    loadInitialData,
  } = useDashboardData();

  // Estados para criação de grupos
  const [selectedInstanceForCreate, setSelectedInstanceForCreate] = useState('');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [participants, setParticipants] = useState<string[]>([]);
  const [loadingCreate, setLoadingCreate] = useState(false);
  const [success, setSuccess] = useState(false);

  // Estados para gestão de grupos
  const [selectedInstance, setSelectedInstance] = useState('');
  const [groupsLoading, setGroupsLoading] = useState(false);
  
  // Busca e paginação
  const [savedGroupsSearch, setSavedGroupsSearch] = useState('');
  const [savedGroupsPage, setSavedGroupsPage] = useState(1);
  const [savedGroupsPerPage, setSavedGroupsPerPage] = useState(10);
  const [availGroupsSearch, setAvailGroupsSearch] = useState('');
  const [availGroupsPage, setAvailGroupsPage] = useState(1);
  const [availGroupsPerPage, setAvailGroupsPerPage] = useState(10);

  useEffect(() => {
    if (userId) {
      loadInitialData();
    }
  }, [userId, loadInitialData]);

  const handleSignOut = () => {
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('user_id');
      sessionStorage.removeItem('profile_id');
      window.localStorage.removeItem('profile_id');
      document.cookie = 'user_id=; Path=/; Max-Age=0; SameSite=Lax';
      window.location.href = '/login';
    }
  };

  // Função para normalizar telefone (formato esperado pela API: 558195421432)
  const normalizePhone = (phone: string | null): string => {
    if (!phone) return '';
    let cleaned = phone.replace(/\D/g, '');
    if (cleaned.startsWith('55')) {
      return cleaned;
    }
    return `55${cleaned}`;
  };

  // Adiciona um contato aleatório da lista
  const handleAddRandomContact = () => {
    if (!contacts || contacts.length === 0) {
      showToast('Nenhum contato disponível na lista', 'error');
      return;
    }

    const validContacts = contacts.filter(c => c.telefone && c.telefone.trim());
    
    if (validContacts.length === 0) {
      showToast('Nenhum contato com telefone válido encontrado', 'error');
      return;
    }

    const randomIndex = Math.floor(Math.random() * validContacts.length);
    const randomContact = validContacts[randomIndex];
    const normalizedPhone = normalizePhone(randomContact.telefone);

    if (participants.includes(normalizedPhone)) {
      showToast('Este contato já foi adicionado. Tentando outro...', 'info');
      const otherContacts = validContacts.filter((_, idx) => idx !== randomIndex);
      if (otherContacts.length > 0) {
        const newRandomIndex = Math.floor(Math.random() * otherContacts.length);
        const newRandomContact = otherContacts[newRandomIndex];
        const newNormalizedPhone = normalizePhone(newRandomContact.telefone);
        if (!participants.includes(newNormalizedPhone)) {
          setParticipants([...participants, newNormalizedPhone]);
          showToast(`Contato ${newRandomContact.name || newNormalizedPhone} adicionado`, 'success');
        } else {
          showToast('Todos os contatos disponíveis já foram adicionados', 'info');
        }
      }
    } else {
      setParticipants([...participants, normalizedPhone]);
      showToast(`Contato ${randomContact.name || normalizedPhone} adicionado`, 'success');
    }
  };

  // Remove um participante
  const handleRemoveParticipant = (phone: string) => {
    setParticipants(participants.filter(p => p !== phone));
  };

  // Cria o grupo
  const handleCreateGroup = async () => {
    if (!userId) {
      showToast('Sessão inválida', 'error');
      return;
    }

    if (!selectedInstanceForCreate) {
      showToast('Selecione uma instância', 'error');
      return;
    }

    if (!subject || !subject.trim()) {
      showToast('Digite o nome do grupo', 'error');
      return;
    }

    if (participants.length === 0) {
      showToast('Adicione pelo menos um participante', 'error');
      return;
    }

    setLoadingCreate(true);
    setSuccess(false);

    try {
      const response = await fetch('/api/crm/groups/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': userId,
        },
        body: JSON.stringify({
          instanceName: selectedInstanceForCreate,
          subject: subject.trim(),
          description: description.trim() || '',
          participants: participants,
        }),
      });

      const result = await response.json();

      if (result.success) {
        setSuccess(true);
        showToast('Grupo criado com sucesso!', 'success');
        setTimeout(() => {
          setSubject('');
          setDescription('');
          setParticipants([]);
          setSelectedInstanceForCreate('');
          setSuccess(false);
        }, 2000);
        // Recarrega os grupos salvos
        await loadDbGroups();
      } else {
        showToast(result.message || 'Erro ao criar grupo', 'error');
      }
    } catch (error) {
      console.error('Erro ao criar grupo:', error);
      showToast('Erro ao criar grupo. Tente novamente.', 'error');
    } finally {
      setLoadingCreate(false);
    }
  };

  // Funções de gestão de grupos
  const handleLoadGroups = async () => {
    if (!userId || !selectedInstance) {
      showToast('Selecione uma instância', 'error');
      return;
    }

    setGroupsLoading(true);
    try {
      const response = await fetch('/api/groups/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
        body: JSON.stringify({ instanceName: selectedInstance }),
      });

      const data = await response.json();
      if (response.ok && data.data) {
        setAvailableGroups(data.data);
        showToast(`${data.data.length} grupo(s) carregado(s)`, 'success');
      } else {
        showToast(data.error || 'Erro ao carregar grupos', 'error');
      }
    } catch (error) {
      showToast('Erro ao carregar grupos', 'error');
    } finally {
      setGroupsLoading(false);
    }
  };

  const handleSaveGroup = async (group: EvolutionGroup) => {
    if (!userId || !selectedInstance) return;
    try {
      const response = await fetch('/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
        body: JSON.stringify({
          instanceName: selectedInstance,
          groupId: group.id,
          groupSubject: group.subject,
          pictureUrl: group.pictureUrl,
          size: group.size,
        }),
      });
      const data = await response.json();
      if (response.ok) {
        showToast('Grupo salvo com sucesso', 'success');
        await loadDbGroups();
      } else {
        showToast(data.error || 'Erro ao salvar grupo', 'error');
      }
    } catch (error) {
      showToast('Erro ao salvar grupo', 'error');
    }
  };

  const loadDbGroups = useCallback(async () => {
    if (!selectedInstance || !userId) {
      setDbGroups([]);
      return;
    }
    const { data, error } = await supabase
      .from('whatsapp_groups')
      .select('group_id, group_subject')
      .eq('user_id', userId)
      .eq('instance_name', selectedInstance)
      .order('group_subject', { ascending: true });

    if (error) {
      addLog(`Erro ao carregar grupos: ${error.message}`, 'error');
    } else {
      setDbGroups((data || []) as DbGroup[]);
    }
  }, [selectedInstance, userId, setDbGroups, addLog]);

  useEffect(() => {
    loadDbGroups();
  }, [loadDbGroups]);

  // Filtros e paginação
  const filteredSavedGroups = dbGroups.filter(g => {
    const q = savedGroupsSearch.toLowerCase().trim();
    if (!q) return true;
    return (g.group_subject || '').toLowerCase().includes(q) || (g.group_id || '').toLowerCase().includes(q);
  });

  const filteredAvailGroups = availableGroups.filter(g => {
    const q = availGroupsSearch.toLowerCase().trim();
    if (!q) return true;
    return (g.subject || '').toLowerCase().includes(q) || (g.id || '').toLowerCase().includes(q);
  });

  const pagedSavedGroups = filteredSavedGroups.slice(
    (savedGroupsPage - 1) * savedGroupsPerPage,
    savedGroupsPage * savedGroupsPerPage
  );

  const pagedAvailGroups = filteredAvailGroups.slice(
    (availGroupsPage - 1) * availGroupsPerPage,
    availGroupsPage * availGroupsPerPage
  );

  // Filtra apenas instâncias conectadas para criação
  const connectedInstances = instances.filter(i => i.status === 'connected' || i.status === 'ok');

  // Debug: verifica se o botão deve estar habilitado
  const isFormValid = selectedInstanceForCreate && subject?.trim() && participants.length > 0;

  if (checking || !userId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white rounded-xl shadow-lg p-6 border border-gray-200 text-center">
          <p className="text-gray-700 font-medium">Carregando...</p>
        </div>
      </div>
    );
  }

  return (
    <Layout onSignOut={handleSignOut}>
      {/* Toasts */}
      <div className="fixed top-4 right-4 z-50 space-y-2">
        {toasts.map(toast => (
          <div
            key={toast.id}
            className={`flex items-center gap-3 min-w-[320px] px-6 py-4 rounded-lg shadow-lg text-white ${
              toast.type === 'success' ? 'bg-emerald-600' : toast.type === 'error' ? 'bg-red-600' : 'bg-amber-500'
            }`}
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

      <div className="space-y-6 w-full">
        <div className="flex items-center justify-between gap-4">
          <div className="flex-1">
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 mb-2">Gestão de Grupos</h1>
            <p className="text-sm sm:text-base text-gray-600">Crie e gerencie grupos do WhatsApp</p>
          </div>
          {/* Botão Toggle da Sidebar - Apenas no mobile, no topo direito */}
          <div className="lg:hidden flex-shrink-0">
            <button
              onClick={() => setIsMobileOpen(!isMobileOpen)}
              className="flex items-center justify-center w-10 h-10 rounded-lg hover:bg-gray-100 transition text-gray-600 shadow-md bg-white"
              aria-label="Toggle sidebar"
            >
              <Menu className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Coluna Esquerda */}
          <div className="space-y-6">
            {/* Criar Novo Grupo */}
            <div className="bg-gray-100 rounded-xl shadow-md p-6 border border-gray-200">
              <h2 className="text-lg font-semibold text-gray-800 mb-4">Criar Novo Grupo</h2>

              <div className="space-y-4">
                {/* Seleção de Instância */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Instância *
                  </label>
                  <select
                    value={selectedInstanceForCreate}
                    onChange={(e) => setSelectedInstanceForCreate(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] outline-none text-gray-700 placeholder:text-gray-400 bg-white"
                    disabled={loadingCreate}
                  >
                    <option value="">Selecione uma instância</option>
                    {connectedInstances.map((instance) => (
                      <option key={instance.instance_name} value={instance.instance_name}>
                        {instance.instance_name} {instance.number ? `(${instance.number})` : ''}
                      </option>
                    ))}
                  </select>
                  {connectedInstances.length === 0 && (
                    <p className="mt-1 text-sm text-amber-600">
                      Nenhuma instância conectada disponível
                    </p>
                  )}
                </div>

                {/* Nome do Grupo */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Nome do Grupo (Subject) *
                  </label>
                  <input
                    type="text"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="Ex: Grupo de Vendas"
                    className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] outline-none text-gray-700 placeholder:text-gray-400 bg-white"
                    disabled={loadingCreate}
                  />
                </div>

                {/* Descrição */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Descrição (Opcional)
                  </label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Descrição do grupo..."
                    rows={3}
                    className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] outline-none resize-none text-gray-700 placeholder:text-gray-400 bg-white"
                    disabled={loadingCreate}
                  />
                </div>

                {/* Participantes */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-gray-700">
                      Participantes *
                    </label>
                    <button
                      type="button"
                      onClick={handleAddRandomContact}
                      disabled={loadingCreate || !contacts || contacts.length === 0}
                      className="flex items-center gap-2 px-3 py-1.5 text-sm bg-[#8CD95515] text-[#6AB83D] border border-[#8CD95540] rounded-lg hover:bg-[#8CD95525] transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                    >
                      <UserPlus className="w-4 h-4" />
                      + Adicionar Contato Aleatório
                    </button>
                  </div>

                  {participants.length > 0 ? (
                    <div className="space-y-2">
                      {participants.map((phone, index) => (
                        <div
                          key={index}
                          className="flex items-center justify-between px-4 py-2 bg-gray-50 rounded-lg border border-gray-200"
                        >
                          <span className="text-sm text-gray-700 font-mono">{phone}</span>
                          <button
                            type="button"
                            onClick={() => handleRemoveParticipant(phone)}
                            disabled={loadingCreate}
                            className="text-red-600 hover:text-red-700 disabled:opacity-50"
                          >
                            <XCircle className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="px-4 py-3 bg-gray-50 rounded-lg border border-gray-200 text-sm text-gray-500 text-center">
                      Nenhum participante adicionado. Clique em "Adicionar Contato Aleatório" para adicionar.
                    </div>
                  )}
                </div>

                {/* Botão de Criar */}
                <div className="pt-4">
                  <button
                    onClick={handleCreateGroup}
                    disabled={loadingCreate || !isFormValid}
                    className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-[#8CD955] hover:bg-[#7BC84A] text-white rounded-lg font-medium transition disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {loadingCreate ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        Criando grupo...
                      </>
                    ) : success ? (
                      <>
                        <CheckCircle2 className="w-5 h-5" />
                        Grupo criado!
                      </>
                    ) : (
                      <>
                        <Plus className="w-5 h-5" />
                        Criar Grupo
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* Gerenciar Grupos da Instância */}
            <div className="bg-gray-100 rounded-xl shadow-md p-6 border border-gray-200">
              <h2 className="text-lg font-semibold text-gray-800 mb-4">Gerenciar Grupos da Instância</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Escolha a Instância*
                  </label>
                  <select
                    value={selectedInstance}
                    onChange={e => setSelectedInstance(e.target.value)}
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] text-gray-700"
                  >
                    <option value="">Selecione uma Instância</option>
                    {instances.map(inst => (
                      <option key={inst.id || inst.instance_name} value={inst.instance_name}>
                        {inst.instance_name} ({inst.status})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Grupos Salvos no Banco */}
            <div className="bg-gray-100 rounded-xl shadow-md p-6 border border-gray-200">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4">
                <div className="flex-1 min-w-0">
                  <h2 className="text-lg font-semibold text-gray-800 break-words">Grupos Salvos no Banco</h2>
                  <p className="text-sm text-gray-500">Selecione um para usar no envio</p>
                </div>
                <div className="flex gap-2 w-full sm:w-auto">
                  <div className="relative flex-1 sm:flex-none">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      type="text"
                      value={savedGroupsSearch}
                      onChange={e => setSavedGroupsSearch(e.target.value)}
                      placeholder="Pesquisar..."
                      className="w-full sm:w-auto pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 text-gray-700 placeholder:text-gray-400"
                    />
                  </div>
                </div>
              </div>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {pagedSavedGroups.length === 0 ? (
                  <p className="text-sm text-gray-500 text-center py-4">Nenhum grupo salvo</p>
                ) : (
                  pagedSavedGroups.map(group => (
                    <div
                      key={group.group_id}
                      className="p-3 border rounded-lg cursor-pointer transition border-gray-200 hover:border-[#8CD95540] hover:bg-[#8CD95515]"
                    >
                      <p className="font-medium text-gray-800">{group.group_subject || 'Sem nome'}</p>
                      <p className="text-xs text-gray-500 font-mono">{group.group_id}</p>
                    </div>
                  ))
                )}
              </div>
              {filteredSavedGroups.length > savedGroupsPerPage && (
                <div className="flex justify-between items-center mt-4">
                  <button
                    onClick={() => setSavedGroupsPage(p => Math.max(1, p - 1))}
                    disabled={savedGroupsPage === 1}
                    className="px-3 py-1 border rounded disabled:opacity-50"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="text-sm text-gray-600">
                    Página {savedGroupsPage} de {Math.ceil(filteredSavedGroups.length / savedGroupsPerPage)}
                  </span>
                  <button
                    onClick={() => setSavedGroupsPage(p => Math.min(Math.ceil(filteredSavedGroups.length / savedGroupsPerPage), p + 1))}
                    disabled={savedGroupsPage >= Math.ceil(filteredSavedGroups.length / savedGroupsPerPage)}
                    className="px-3 py-1 border rounded disabled:opacity-50"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Coluna Direita */}
          <div className="space-y-6">
            {/* Grupos da API (Evolution) */}
            <div className="bg-gray-100 rounded-xl shadow-md p-6 border border-gray-200">
              <div className="flex justify-between items-center mb-4">
                <div>
                  <h2 className="text-lg font-semibold text-gray-800">Grupos da API (Evolution)</h2>
                  <p className="text-sm text-gray-500">Pesquise, págine e salve no banco</p>
                </div>
              </div>
              <div className="space-y-3 mb-4">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    value={availGroupsSearch}
                    onChange={e => setAvailGroupsSearch(e.target.value)}
                    placeholder="Pesquisar nos grupos da API..."
                    className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] text-gray-700 placeholder:text-gray-400"
                  />
                </div>
                <button
                  onClick={handleLoadGroups}
                  disabled={!selectedInstance || groupsLoading}
                  className="w-full py-2 bg-[#8CD955] hover:bg-[#7BC84A] text-white rounded-lg font-medium transition disabled:opacity-50"
                >
                  {groupsLoading ? (
                    <span className="inline-flex items-center">
                      Isso pode demorar um pouco
                      <span className="inline-flex ml-1 gap-0">
                        <span className="wave-dot-1">.</span>
                        <span className="wave-dot-2">.</span>
                        <span className="wave-dot-3">.</span>
                      </span>
                    </span>
                  ) : (
                    'Carregar Grupos da instância'
                  )}
                </button>
              </div>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {pagedAvailGroups.length === 0 ? (
                  <p className="text-sm text-gray-500 text-center py-4">
                    {availableGroups.length === 0 ? 'Nenhum grupo carregado' : 'Nenhum grupo encontrado na busca'}
                  </p>
                ) : (
                  pagedAvailGroups.map(group => (
                    <div
                      key={group.id}
                      className="p-3 border border-gray-200 rounded-lg flex justify-between items-center"
                    >
                      <div className="flex-1">
                        <p className="font-medium text-gray-800">{group.subject || 'Sem nome'}</p>
                        <p className="text-xs text-gray-500 font-mono">{group.id}</p>
                        {group.size && <p className="text-xs text-gray-500">{group.size} membros</p>}
                      </div>
                      <button
                        onClick={() => handleSaveGroup(group)}
                        className="px-3 py-1 bg-[#8CD955] hover:bg-[#7BC84A] text-white rounded text-sm transition"
                      >
                        Salvar
                      </button>
                    </div>
                  ))
                )}
              </div>
              {filteredAvailGroups.length > availGroupsPerPage && (
                <div className="flex justify-between items-center mt-4">
                  <button
                    onClick={() => setAvailGroupsPage(p => Math.max(1, p - 1))}
                    disabled={availGroupsPage === 1}
                    className="px-3 py-1 border rounded disabled:opacity-50"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="text-sm text-gray-600">
                    Página {availGroupsPage} de {Math.ceil(filteredAvailGroups.length / availGroupsPerPage)}
                  </span>
                  <button
                    onClick={() => setAvailGroupsPage(p => Math.min(Math.ceil(filteredAvailGroups.length / availGroupsPerPage), p + 1))}
                    disabled={availGroupsPage >= Math.ceil(filteredAvailGroups.length / availGroupsPerPage)}
                    className="px-3 py-1 border rounded disabled:opacity-50"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default GroupsPage;

