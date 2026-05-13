'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { getWlSlugHeadersForApi, withTenantSlug } from '@/lib/utils/tenant-href';
import { useRequireAuth } from '@/utils/useRequireAuth';
import Layout from '@/components/Layout';
import { useDashboardData, DbGroup, EvolutionGroup, Contact } from '@/hooks/useDashboardData';
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
  Download,
} from 'lucide-react';
import { useSidebar } from '@/contexts/SidebarContext';
import { postGroupFetchAndResolve } from '@/lib/utils/group-fetch-client';

/** Evita SyntaxError quando a API retorna HTML (404, 500, etc.) em vez de JSON. */
async function parseJsonFromResponse(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? '';
  const text = await response.text();
  if (!contentType.includes('application/json')) {
    console.warn('[groups] Resposta não é JSON:', text.substring(0, 150));
    throw new Error('Resposta inválida do servidor. Verifique se está logado e tente novamente.');
  }
  if (!text || !text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Resposta inválida do servidor. Tente novamente.');
  }
}

function normalizeSearchText(value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function slugifyFileName(value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s-]+/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 80);
}

const GroupsPage = () => {
  const { checking, userStatus } = useRequireAuth();
  const canExtractContactsCsv = userStatus === 'admin' || userStatus === 'super_admin';
  const { isCollapsed, setIsCollapsed, isMobileOpen, setIsMobileOpen } = useSidebar();
  const {
    userId,
    instances,
    contacts,
    availableGroups,
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
  const [savingAllGroups, setSavingAllGroups] = useState(false);
  
  // Busca e paginação
  const [savedGroupsSearch, setSavedGroupsSearch] = useState('');
  const [savedGroupsPage, setSavedGroupsPage] = useState(1);
  const [savedGroupsPerPage, setSavedGroupsPerPage] = useState(10);
  const [availGroupsSearch, setAvailGroupsSearch] = useState('');
  const [availGroupsPage, setAvailGroupsPage] = useState(1);
  const [availGroupsPerPage, setAvailGroupsPerPage] = useState(10);

  /** Grupos salvos no banco só da instância selecionada (evita sobrescrita por loadInitialData do hook). */
  const [instanceDbGroups, setInstanceDbGroups] = useState<DbGroup[]>([]);

  /** Extrair contatos → CSV (GET Evolution `/group/participants/{instance}`) */
  const [extractLoading, setExtractLoading] = useState(false);
  const [extractGroupId, setExtractGroupId] = useState('');
  const [extractGroupSearch, setExtractGroupSearch] = useState('');

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
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': userId,
          ...getWlSlugHeadersForApi(),
        },
        body: JSON.stringify({
          instanceName: selectedInstanceForCreate,
          subject: subject.trim(),
          description: description.trim() || '',
          participants: participants,
        }),
      });

      const result = (await parseJsonFromResponse(response)) as { success?: boolean; message?: string };

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

  const handleLoadGroups = async () => {
    if (!userId || !selectedInstance) {
      showToast('Selecione uma instância', 'error');
      return;
    }
    if (groupsLoading) {
      showToast('Aguarde a busca atual terminar.', 'info');
      return;
    }

    setGroupsLoading(true);
    try {
      showToast('Buscando grupos... Pode levar alguns minutos se houver muitos grupos.', 'info');

      const { groups, message } = await postGroupFetchAndResolve(userId, selectedInstance);
      setAvailableGroups(groups as EvolutionGroup[]);
      showToast(message || `${groups.length} grupo(s) carregado(s) e sincronizado(s)`, 'success');
      await loadDbGroups();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Erro ao carregar grupos', 'error');
    } finally {
      setGroupsLoading(false);
    }
  };

  const handleSaveGroup = async (group: EvolutionGroup) => {
    if (!userId || !selectedInstance) return;
    try {
      const response = await fetch('/api/groups', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId, ...getWlSlugHeadersForApi() },
        body: JSON.stringify({
          instanceName: selectedInstance,
          groupId: group.id,
          groupSubject: group.subject,
          pictureUrl: group.pictureUrl,
          size: group.size,
        }),
      });
      const data = (await parseJsonFromResponse(response)) as { error?: string; message?: string };
      if (response.ok) {
        showToast(data.message || 'Grupo salvo com sucesso', 'success');
        await loadDbGroups();
        setExtractGroupSearch('');
        setExtractGroupId(group.id || '');
      } else {
        showToast(data.error || 'Erro ao salvar grupo', 'error');
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Erro ao salvar grupo', 'error');
    }
  };

  const handleSaveAllGroups = async () => {
    if (!userId || !selectedInstance || availableGroups.length === 0) {
      showToast('Carregue os grupos da instância primeiro', 'error');
      return;
    }
    setSavingAllGroups(true);
    try {
      const groups = availableGroups.map((g: EvolutionGroup) => ({
        id: g.id,
        subject: g.subject,
        pictureUrl: g.pictureUrl ?? null,
        size: g.size ?? null,
      }));
      const response = await fetch('/api/groups/sync', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId, ...getWlSlugHeadersForApi() },
        body: JSON.stringify({ instanceName: selectedInstance, groups }),
      });
      const data = (await parseJsonFromResponse(response)) as {
        success?: boolean;
        data?: { inserted?: number; updated?: number };
        error?: string;
      };
      if (response.ok && data.success) {
        const { inserted = 0, updated = 0 } = data.data || {};
        showToast(`${inserted + updated} grupo(s) salvos/sincronizados (sem duplicar existentes)`, 'success');
        await loadDbGroups();
        await loadInitialData();
      } else {
        showToast(data.error || 'Erro ao salvar grupos', 'error');
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Erro ao salvar todos os grupos', 'error');
    } finally {
      setSavingAllGroups(false);
    }
  };

  const loadDbGroups = useCallback(async () => {
    if (!selectedInstance || !userId) {
      setInstanceDbGroups([]);
      return;
    }

    try {
      const response = await fetch(`/api/groups?instanceName=${encodeURIComponent(selectedInstance)}`, {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': userId,
          ...getWlSlugHeadersForApi(),
        },
      });

      const payload = (await parseJsonFromResponse(response)) as {
        success?: boolean;
        data?: DbGroup[];
        error?: string;
      };

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Erro ao carregar grupos salvos');
      }

      setInstanceDbGroups(Array.isArray(payload.data) ? payload.data : []);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Erro ao carregar grupos salvos';
      addLog(`Erro ao carregar grupos: ${msg}`, 'error');
      showToast(msg, 'error');
      setInstanceDbGroups([]);
    }
  }, [selectedInstance, userId, addLog, showToast]);

  useEffect(() => {
    loadDbGroups();
  }, [loadDbGroups]);

  useEffect(() => {
    setExtractGroupId('');
    setExtractGroupSearch('');
  }, [selectedInstance]);

  const filteredExtractDbGroups = instanceDbGroups.filter((g) => {
    const q = normalizeSearchText(extractGroupSearch);
    if (!q) return true;
    const subject = normalizeSearchText(g.group_subject || '');
    const id = normalizeSearchText(g.group_id || '');
    return subject.includes(q) || id.includes(q);
  });

  const handleExtractContactsCsv = async () => {
    if (!userId) {
      showToast('Sessão inválida', 'error');
      return;
    }
    if (!selectedInstance) {
      showToast('Selecione uma instância', 'error');
      return;
    }
    if (!extractGroupId.trim()) {
      showToast('Selecione um grupo salvo no banco para esta instância', 'error');
      return;
    }

    setExtractLoading(true);
    try {
      const response = await fetch('/api/groups/extract-contacts', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': userId,
          ...getWlSlugHeadersForApi(),
        },
        body: JSON.stringify({
          instanceName: selectedInstance,
          groupId: extractGroupId.trim(),
        }),
      });

      const result = (await parseJsonFromResponse(response)) as {
        success?: boolean;
        data?: Array<{ telefone: string }>;
        message?: string;
        error?: string;
      };

      if (!response.ok || !result.success) {
        showToast(result.error || 'Erro ao extrair contatos do grupo', 'error');
        return;
      }

      const rows = Array.isArray(result.data) ? result.data : [];
      const phones = rows.map(r => r.telefone).filter(Boolean);
      if (phones.length === 0) {
        showToast('Nenhum telefone encontrado nos participantes', 'info');
        return;
      }

      const BOM = '\uFEFF';
      const csvBody = phones.map(p => `"${String(p).replace(/"/g, '""')}"`).join('\n');
      const csv = `${BOM}telefone\n${csvBody}`;
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const selectedGroup = instanceDbGroups.find((g) => g.group_id === extractGroupId);
      const groupNameForFile =
        selectedGroup?.group_subject || selectedGroup?.group_id || extractGroupId.trim();
      const safeSlug = slugifyFileName(groupNameForFile) || 'grupo';
      a.href = url;
      a.download = `contatos-${safeSlug}-${Date.now()}.csv`;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      showToast(result.message || `${phones.length} contato(s) no CSV`, 'success');
    } catch (error) {
      console.error('Erro ao extrair contatos:', error);
      showToast(error instanceof Error ? error.message : 'Erro ao gerar CSV', 'error');
    } finally {
      setExtractLoading(false);
    }
  };

  // Filtros e paginação (deduplica por group_id para evitar keys duplicadas no React)
  const rawFilteredSaved = instanceDbGroups.filter(g => {
    const q = normalizeSearchText(savedGroupsSearch);
    if (!q) return true;
    const subject = normalizeSearchText(g.group_subject || '');
    const id = normalizeSearchText(g.group_id || '');
    return subject.includes(q) || id.includes(q);
  });
  const seenGroupIds = new Set<string>();
  const filteredSavedGroups = rawFilteredSaved.filter(g => {
    if (seenGroupIds.has(g.group_id)) return false;
    seenGroupIds.add(g.group_id);
    return true;
  });

  const filteredAvailGroups = availableGroups.filter(g => {
    const q = normalizeSearchText(availGroupsSearch);
    if (!q) return true;
    const subject = normalizeSearchText(g.subject || '');
    const id = normalizeSearchText(g.id || '');
    return subject.includes(q) || id.includes(q);
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
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 dark:text-white mb-2">Gestão de Grupos</h1>
            <p className="text-sm sm:text-base text-gray-600 dark:text-gray-400">Crie e gerencie grupos do WhatsApp</p>
          </div>
          {/* Botão Toggle da Sidebar - Apenas no mobile, no topo direito */}
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

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:items-stretch">
          {/* Coluna Esquerda */}
          <div className="flex flex-col gap-6">
            {/* Criar Novo Grupo */}
            <div className="bg-gray-100 dark:bg-[#2a2a2a] rounded-xl shadow-md p-6 border border-gray-200 dark:border-[#404040]">
              <h2 className="text-lg font-semibold text-gray-800 dark:text-white mb-4">Criar Novo Grupo</h2>

              <div className="space-y-4">
                {/* Seleção de Instância */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Instância *
                  </label>
                  <select
                    value={selectedInstanceForCreate}
                    onChange={(e) => setSelectedInstanceForCreate(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-200 dark:border-[#555] rounded-lg focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] outline-none text-gray-700 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500 bg-white dark:bg-[#333]"
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
                    <p className="mt-1 text-sm text-amber-600 dark:text-amber-400">
                      Nenhuma instância conectada disponível
                    </p>
                  )}
                </div>

                {/* Nome do Grupo */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Nome do Grupo (Subject) *
                  </label>
                  <input
                    type="text"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="Ex: Grupo de Vendas"
                    className="w-full px-4 py-2 border border-gray-200 dark:border-[#555] rounded-lg focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] outline-none text-gray-700 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500 bg-white dark:bg-[#333]"
                    disabled={loadingCreate}
                  />
                </div>

                {/* Descrição */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Descrição (Opcional)
                  </label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Descrição do grupo..."
                    rows={3}
                    className="w-full px-4 py-2 border border-gray-200 dark:border-[#555] rounded-lg focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] outline-none resize-none text-gray-700 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500 bg-white dark:bg-[#333]"
                    disabled={loadingCreate}
                  />
                </div>

                {/* Participantes */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
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
                          className="flex items-center justify-between px-4 py-2 bg-gray-50 dark:bg-[#333] rounded-lg border border-gray-200 dark:border-[#404040]"
                        >
                          <span className="text-sm text-gray-700 dark:text-gray-300 font-mono">{phone}</span>
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
                    <div className="px-4 py-3 bg-gray-50 dark:bg-[#333] rounded-lg border border-gray-200 dark:border-[#404040] text-sm text-gray-500 dark:text-gray-400 text-center">
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
            <div className="bg-gray-100 dark:bg-[#2a2a2a] rounded-xl shadow-md p-6 border border-gray-200 dark:border-[#404040]">
              <h2 className="text-lg font-semibold text-gray-800 dark:text-white mb-4">Gerenciar Grupos da Instância</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Escolha a Instância*
                  </label>
                  <select
                    value={selectedInstance}
                    onChange={e => setSelectedInstance(e.target.value)}
                    className="w-full px-4 py-3 border-2 border-gray-200 dark:border-[#555] rounded-lg focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] text-gray-700 dark:text-white bg-white dark:bg-[#333]"
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

            {/* Extrair contatos (CSV): apenas admin / super_admin */}
            {canExtractContactsCsv && (
              <div className="bg-gray-100 dark:bg-[#2a2a2a] rounded-xl shadow-md p-6 border border-gray-200 dark:border-[#404040]">
                <h2 className="text-lg font-semibold text-gray-800 dark:text-white mb-1 flex items-center gap-2">
                  <Download className="w-5 h-5 text-[#6AB83D]" aria-hidden />
                  Extrair contatos (CSV)
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                  Busca participantes via Evolution{' '}
                  <code className="text-xs bg-gray-200 dark:bg-[#333] px-1 rounded">GET /group/participants/&#123;instância&#125;</code>
                  {' '}e gera um arquivo com a coluna <span className="font-medium text-gray-700 dark:text-gray-300">telefone</span>.
                </p>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Instância *
                    </label>
                    <select
                      value={selectedInstance}
                      onChange={e => setSelectedInstance(e.target.value)}
                      className="w-full px-4 py-3 border-2 border-gray-200 dark:border-[#555] rounded-lg focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] text-gray-700 dark:text-white bg-white dark:bg-[#333]"
                    >
                      <option value="">Selecione uma instância</option>
                      {instances.map(inst => (
                        <option key={inst.id || inst.instance_name} value={inst.instance_name}>
                          {inst.instance_name} ({inst.status})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Grupo salvo no banco
                    </label>
                    <div className="relative mb-2">
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-500 dark:text-gray-400" />
                      <input
                        type="text"
                        value={extractGroupSearch}
                        onChange={e => setExtractGroupSearch(e.target.value)}
                        placeholder="Pesquisar grupo salvo..."
                        disabled={!selectedInstance || instanceDbGroups.length === 0}
                        className="w-full pl-10 pr-4 py-2 border border-gray-200 dark:border-[#555] rounded-lg focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] text-sm text-gray-700 dark:text-white bg-white dark:bg-[#333] placeholder:text-gray-400 disabled:opacity-50"
                      />
                    </div>
                    <select
                      value={extractGroupId}
                      onChange={e => setExtractGroupId(e.target.value)}
                      disabled={!selectedInstance || instanceDbGroups.length === 0}
                      className="w-full px-4 py-3 border-2 border-gray-200 dark:border-[#555] rounded-lg focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] text-gray-700 dark:text-white bg-white dark:bg-[#333] disabled:opacity-50"
                    >
                      <option value="">
                        {!selectedInstance
                          ? 'Selecione a instância'
                          : instanceDbGroups.length === 0
                            ? 'Nenhum grupo salvo — carregue e salve grupos antes'
                            : filteredExtractDbGroups.length === 0
                              ? 'Nenhum grupo encontrado para essa busca'
                              : 'Selecione um grupo'}
                      </option>
                      {filteredExtractDbGroups.map(g => (
                        <option key={g.group_id} value={g.group_id}>
                          {(g.group_subject || 'Sem nome').slice(0, 80)}
                          {g.group_subject && g.group_subject.length > 80 ? '…' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="button"
                    onClick={handleExtractContactsCsv}
                    disabled={extractLoading || !selectedInstance || !extractGroupId.trim()}
                    className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium transition disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {extractLoading ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin shrink-0" />
                        Extraindo…
                      </>
                    ) : (
                      <>
                        <Download className="w-5 h-5 shrink-0" />
                        Baixar CSV com telefones
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Coluna Direita - preenche a altura da coluna esquerda */}
          <div className="flex flex-col gap-6 min-h-0">
            {/* Grupos da API (Evolution) - Extrair grupos no topo, lista expande para preencher espaço */}
            <div className="bg-gray-100 dark:bg-[#2a2a2a] rounded-xl shadow-md p-6 border border-gray-200 dark:border-[#404040] flex flex-col flex-1 min-h-[400px]">
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-gray-800 dark:text-white">Grupos da API (Evolution)</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">Extraia, pesquise e salve no banco</p>
              </div>
              <div className="space-y-3 mb-4">
                {/* Instância + Carregar Grupos no topo */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Instância *</label>
                  <select
                    value={selectedInstance}
                    onChange={e => setSelectedInstance(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-200 dark:border-[#555] rounded-lg focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] text-gray-700 dark:text-white bg-white dark:bg-[#333] mb-2"
                  >
                    <option value="">Selecione uma instância</option>
                    {instances.map(inst => (
                      <option key={inst.id || inst.instance_name} value={inst.instance_name}>
                        {inst.instance_name} ({inst.status})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <button
                    onClick={handleLoadGroups}
                    disabled={!selectedInstance || groupsLoading}
                    className="flex-1 py-3 bg-[#8CD955] hover:bg-[#7BC84A] text-white rounded-lg font-medium transition disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {groupsLoading ? (
                      <span className="inline-flex items-center gap-2">
                        <Loader2 className="w-5 h-5 animate-spin shrink-0" />
                        Carregando grupos…
                      </span>
                    ) : (
                      'Carregar Grupos da instância'
                    )}
                  </button>
                  {availableGroups.length > 0 && (
                    <button
                      onClick={handleSaveAllGroups}
                      disabled={savingAllGroups || !selectedInstance}
                      className="py-3 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium transition disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {savingAllGroups ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                      Salvar todos os grupos
                    </button>
                  )}
                </div>
                {/* Pesquisa abaixo do botão extrair */}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-500 dark:text-gray-400" />
                  <input
                    type="text"
                    value={availGroupsSearch}
                    onChange={e => setAvailGroupsSearch(e.target.value)}
                    placeholder="Pesquisar nos grupos da API..."
                    className="w-full pl-10 pr-4 py-2 bg-gray-100 dark:bg-[#333] border border-gray-200 dark:border-[#404040] rounded-lg text-sm focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] text-gray-900 dark:text-white placeholder:text-gray-500 dark:placeholder:text-gray-400"
                  />
                </div>
              </div>
              <div className="flex-1 min-h-[240px] overflow-y-auto space-y-2">
                {pagedAvailGroups.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-8 flex items-center justify-center min-h-[200px]">
                    {availableGroups.length === 0 ? 'Nenhum grupo carregado. Selecione uma instância e clique em "Carregar Grupos da instância".' : 'Nenhum grupo encontrado na busca'}
                  </p>
                ) : (
                  pagedAvailGroups.map(group => (
                    <div
                      key={group.id}
                      className="p-3 border border-gray-200 dark:border-[#404040] rounded-lg flex justify-between items-center bg-white dark:bg-[#333]"
                    >
                      <div className="flex-1">
                        <p className="font-medium text-gray-800 dark:text-white">{group.subject || 'Sem nome'}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 font-mono">{group.id}</p>
                        {group.size && <p className="text-xs text-gray-500 dark:text-gray-400">{group.size} membros</p>}
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
                    className="px-3 py-1 border border-gray-300 dark:border-[#555] rounded disabled:opacity-50 text-gray-700 dark:text-white bg-white dark:bg-[#333] hover:bg-gray-50 dark:hover:bg-[#404040]"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="text-sm text-gray-600 dark:text-gray-400">
                    Página {availGroupsPage} de {Math.ceil(filteredAvailGroups.length / availGroupsPerPage)}
                  </span>
                  <button
                    onClick={() => setAvailGroupsPage(p => Math.min(Math.ceil(filteredAvailGroups.length / availGroupsPerPage), p + 1))}
                    disabled={availGroupsPage >= Math.ceil(filteredAvailGroups.length / availGroupsPerPage)}
                    className="px-3 py-1 border border-gray-300 dark:border-[#555] rounded disabled:opacity-50 text-gray-700 dark:text-white bg-white dark:bg-[#333] hover:bg-gray-50 dark:hover:bg-[#404040]"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>

            {/* Grupos Salvos no Banco - na coluna direita para equilibrar o layout */}
            <div className="bg-gray-100 dark:bg-[#2a2a2a] rounded-xl shadow-md p-6 border border-gray-200 dark:border-[#404040] flex-1 min-h-[280px] flex flex-col">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4">
                <div className="flex-1 min-w-0">
                  <h2 className="text-lg font-semibold text-gray-800 dark:text-white break-words">Grupos Salvos no Banco</h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Selecione um para usar no envio</p>
                </div>
                <div className="flex gap-2 w-full sm:w-auto">
                  <div className="relative flex-1 sm:flex-none">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-500 dark:text-gray-400" />
                    <input
                      type="text"
                      value={savedGroupsSearch}
                      onChange={e => setSavedGroupsSearch(e.target.value)}
                      placeholder="Pesquisar..."
                      className="w-full sm:w-auto pl-10 pr-4 py-2 bg-gray-100 dark:bg-[#333] border border-gray-200 dark:border-[#404040] rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 text-gray-900 dark:text-white placeholder:text-gray-500 dark:placeholder:text-gray-400"
                    />
                  </div>
                </div>
              </div>
              <div className="space-y-2 flex-1 min-h-[160px] overflow-y-auto">
                {pagedSavedGroups.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-6">Nenhum grupo salvo</p>
                ) : (
                  pagedSavedGroups.map(group => (
                    <div
                      key={group.group_id}
                      className="p-3 border rounded-lg cursor-pointer transition border-gray-200 dark:border-[#404040] hover:border-[#8CD95540] dark:hover:border-[#8CD955]/50 hover:bg-[#8CD95515] dark:hover:bg-[#8CD955]/10"
                    >
                      <p className="font-medium text-gray-800 dark:text-white">{group.group_subject || 'Sem nome'}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 font-mono">{group.group_id}</p>
                    </div>
                  ))
                )}
              </div>
              {filteredSavedGroups.length > savedGroupsPerPage && (
                <div className="flex justify-between items-center mt-4">
                  <button
                    onClick={() => setSavedGroupsPage(p => Math.max(1, p - 1))}
                    disabled={savedGroupsPage === 1}
                    className="px-3 py-1 border border-gray-300 dark:border-[#555] rounded disabled:opacity-50 text-gray-700 dark:text-white bg-white dark:bg-[#333] hover:bg-gray-50 dark:hover:bg-[#404040]"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="text-sm text-gray-600 dark:text-gray-400">
                    Página {savedGroupsPage} de {Math.ceil(filteredSavedGroups.length / savedGroupsPerPage)}
                  </span>
                  <button
                    onClick={() => setSavedGroupsPage(p => Math.min(Math.ceil(filteredSavedGroups.length / savedGroupsPerPage), p + 1))}
                    disabled={savedGroupsPage >= Math.ceil(filteredSavedGroups.length / savedGroupsPerPage)}
                    className="px-3 py-1 border border-gray-300 dark:border-[#555] rounded disabled:opacity-50 text-gray-700 dark:text-white bg-white dark:bg-[#333] hover:bg-gray-50 dark:hover:bg-[#404040]"
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

