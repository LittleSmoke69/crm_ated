'use client';

import React, { useState, useEffect } from 'react';
import { withTenantSlug } from '@/lib/utils/tenant-href';
import Layout from '@/components/Layout';
import { useRequireAuth } from '@/utils/useRequireAuth';
import { useDashboardData, WhatsAppInstance, Contact } from '@/hooks/useDashboardData';
import { Users, Plus, Loader2, CheckCircle2, XCircle, UserPlus, Menu, X, AlertCircle, Info } from 'lucide-react';
import { useSidebar } from '@/contexts/SidebarContext';

const GroupsPage = () => {
  const { checking } = useRequireAuth();
  const { isCollapsed, setIsCollapsed, isMobileOpen, setIsMobileOpen } = useSidebar();
  const {
    userId,
    instances,
    contacts,
    showToast,
    loadInitialData,
    toasts,
    setToasts,
  } = useDashboardData();

  const [selectedInstance, setSelectedInstance] = useState('');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [participants, setParticipants] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

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
      window.location.href = withTenantSlug('/login');
    }
  };

  // Função para normalizar telefone (formato esperado pela API: 558195421432)
  const normalizePhone = (phone: string | null): string => {
    if (!phone) return '';
    // Remove todos os caracteres não numéricos
    let cleaned = phone.replace(/\D/g, '');
    // Se começa com 55, retorna como está
    if (cleaned.startsWith('55')) {
      return cleaned;
    }
    // Se não começa com 55, adiciona
    return `55${cleaned}`;
  };

  // Adiciona um contato aleatório da lista
  const handleAddRandomContact = () => {
    if (!contacts || contacts.length === 0) {
      showToast('Nenhum contato disponível na lista', 'error');
      return;
    }

    // Filtra contatos com telefone válido
    const validContacts = contacts.filter(c => c.telefone && c.telefone.trim());
    
    if (validContacts.length === 0) {
      showToast('Nenhum contato com telefone válido encontrado', 'error');
      return;
    }

    // Seleciona um contato aleatório
    const randomIndex = Math.floor(Math.random() * validContacts.length);
    const randomContact = validContacts[randomIndex];
    const normalizedPhone = normalizePhone(randomContact.telefone);

    // Verifica se já não está na lista
    if (participants.includes(normalizedPhone)) {
      showToast('Este contato já foi adicionado. Tentando outro...', 'info');
      // Tenta outro contato
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

    if (!selectedInstance) {
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

    setLoading(true);
    setSuccess(false);

    try {
      const response = await fetch('/api/crm/groups/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': userId, // CRÍTICO: Header necessário para autenticação
        },
        body: JSON.stringify({
          instanceName: selectedInstance,
          subject: subject.trim(),
          description: description.trim() || '',
          participants: participants,
        }),
      });

      const result = await response.json();

      if (result.success) {
        setSuccess(true);
        showToast('Grupo criado com sucesso!', 'success');
        // Limpa o formulário após 2 segundos
        setTimeout(() => {
          setSubject('');
          setDescription('');
          setParticipants([]);
          setSelectedInstance('');
          setSuccess(false);
        }, 2000);
      } else {
        showToast(result.message || 'Erro ao criar grupo', 'error');
      }
    } catch (error) {
      console.error('Erro ao criar grupo:', error);
      showToast('Erro ao criar grupo. Tente novamente.', 'error');
    } finally {
      setLoading(false);
    }
  };

  if (checking || !userId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white rounded-xl shadow-lg p-6 border border-gray-200 text-center">
          <p className="text-gray-700 font-medium">Carregando...</p>
        </div>
      </div>
    );
  }

  // Filtra apenas instâncias conectadas
  const connectedInstances = instances.filter(i => i.status === 'connected');

  // Debug: verifica se o botão deve estar habilitado
  const isFormValid = selectedInstance && subject?.trim() && participants.length > 0;

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
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 mb-2">CRM - Grupos</h1>
            <p className="text-sm sm:text-base text-gray-600">Crie grupos via Evolution API</p>
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

        <div className="bg-gray-100 rounded-xl shadow-md p-6 border border-gray-200">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">Criar Novo Grupo</h2>

          <div className="space-y-4">
            {/* Seleção de Instância */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Instância *
              </label>
              <select
                value={selectedInstance}
                onChange={(e) => setSelectedInstance(e.target.value)}
                className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#E86A24] focus:border-[#E86A24] outline-none text-gray-700 placeholder:text-gray-400 bg-white"
                disabled={loading}
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
                className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#E86A24] focus:border-[#E86A24] outline-none text-gray-700 placeholder:text-gray-400 bg-white"
                disabled={loading}
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
                className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#E86A24] focus:border-[#E86A24] outline-none resize-none text-gray-700 placeholder:text-gray-400 bg-white"
                disabled={loading}
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
                  disabled={loading || !contacts || contacts.length === 0}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm bg-[#E86A2415] text-[#C9531A] border border-[#E86A2440] rounded-lg hover:bg-[#E86A2425] transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
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
                        disabled={loading}
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
                disabled={loading || !isFormValid}
                className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-[#E86A24] hover:bg-[#D95E1B] text-white rounded-lg font-medium transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (
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
      </div>
    </Layout>
  );
};

export default GroupsPage;

