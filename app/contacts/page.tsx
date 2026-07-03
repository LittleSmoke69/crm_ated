'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { withTenantSlug } from '@/lib/utils/tenant-href';
import { useRequireAuth } from '@/utils/useRequireAuth';
import Layout from '@/components/Layout';
import { useDashboardData, Contact } from '@/hooks/useDashboardData';
import {
  Eye,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Info,
  X,
  Download,
  RefreshCw,
  Eraser,
  Users,
  List,
  Plus,
  Save,
  Menu,
  Loader2,
} from 'lucide-react';
import { useSidebar } from '@/contexts/SidebarContext';
import { supabase } from '@/lib/supabase';

const ContactsPage = () => {
  const { checking } = useRequireAuth();
  const { isCollapsed, setIsCollapsed, isMobileOpen, setIsMobileOpen } = useSidebar();
  const debugLists = process.env.NEXT_PUBLIC_DEBUG_LISTS === 'true';
  const {
    userId,
    contacts,
    loadingInitial,
    showToast,
    addLog,
    toasts,
    setToasts,
    loadInitialData,
  } = useDashboardData();

  const [itemsPerPage, setItemsPerPage] = useState<number>(10);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [selectedContacts, setSelectedContacts] = useState<Set<string>>(new Set());
  const [dbGroups, setDbGroups] = useState<Array<{ group_id: string; group_subject: string }>>([]);
  const [customListName, setCustomListName] = useState('');
  const [showCustomListModal, setShowCustomListModal] = useState(false);
  const [customLists, setCustomLists] = useState<any[]>([]);
  const [loadingLists, setLoadingLists] = useState(false);
  const [listContactCount, setListContactCount] = useState<number>(0);
  const [listSelectedGroup, setListSelectedGroup] = useState<string>('');
  const [isEditingList, setIsEditingList] = useState<string | null>(null);
  const [creatingList, setCreatingList] = useState<boolean>(false);

  /**
   * Normaliza UUIDs para string de forma consistente
   * Lida com UUIDs que vêm como objetos do Supabase ou como strings
   */
  const normalizeUuid = (id: any): string | null => {
    if (id === null || id === undefined) return null;
    
    // Se já é string, retorna trimada
    if (typeof id === 'string') {
      const trimmed = id.trim();
      if (trimmed === '' || trimmed.toLowerCase() === 'null') return null;
      return trimmed;
    }
    
    // Se for objeto (UUID object do Supabase), tenta extrair o valor
    if (typeof id === 'object' && id !== null) {
      // Tenta propriedades comuns de objetos UUID
      if ('value' in id && typeof id.value === 'string') {
        const trimmed = id.value.trim();
        if (trimmed === '' || trimmed.toLowerCase() === 'null') return null;
        return trimmed;
      }
      // Tenta toString() se disponível
      if (typeof id.toString === 'function') {
        const str = id.toString();
        // UUID objects geralmente retornam a string do UUID no toString()
        if (str && str !== '[object Object]' && str.trim() !== '') {
          const trimmed = str.trim();
          if (trimmed.toLowerCase() !== 'null') return trimmed;
        }
      }
      // Última tentativa: JSON.stringify (pode funcionar para alguns objetos)
      try {
        const jsonStr = JSON.stringify(id);
        if (jsonStr && jsonStr !== 'null' && jsonStr !== '{}' && jsonStr.startsWith('"')) {
          // Remove aspas se for string JSON
          const parsed = JSON.parse(jsonStr);
          if (typeof parsed === 'string') {
            const trimmed = parsed.trim();
            if (trimmed !== '' && trimmed.toLowerCase() !== 'null') return trimmed;
          }
        }
      } catch (e) {
        // Ignora erros de JSON
      }
      // Fallback: String() direto
      const str = String(id);
      if (str && str !== '[object Object]' && str.trim() !== '') {
        const trimmed = str.trim();
        if (trimmed.toLowerCase() !== 'null') return trimmed;
      }
      return null;
    }
    
    // Para outros tipos (number, boolean, etc), converte para string
    const str = String(id);
    const trimmed = str.trim();
    if (trimmed === '' || trimmed.toLowerCase() === 'null') return null;
    return trimmed;
  };

  /**
   * IDs bloqueados (já vinculados a qualquer lista)
   * Agora usa EXCLUSIVAMENTE a coluna block_list da tabela searches
   */
  const lockedContactsInfo = useMemo(() => {
    const lockedIds = new Set<string>();
    
    contacts.forEach(contact => {
      // Solução Definitiva: !!block_list captura true, 1 ou qualquer valor truthy
      if (!!(contact as any).block_list) {
        const contactId = normalizeUuid(contact.id);
        if (!contactId) return;
        
        // Se estiver editando, não bloqueia o próprio contato da lista
        if (isEditingList) {
          const list = customLists.find(l => String(l.id) === String(isEditingList));
          if (list && Array.isArray(list.contact_ids)) {
            const isInEditingList = list.contact_ids.some((lid: any) => 
              normalizeUuid(lid) === contactId
            );
            if (isInEditingList) return;
          }
        }
        
        lockedIds.add(contactId);
      }
    });

    return { lockedIds };
  }, [contacts, customLists, isEditingList, normalizeUuid]);

  // Extrai o Set de IDs bloqueados diretamente do useMemo
  const usedContactIds = lockedContactsInfo.lockedIds;
  

  const availableContactsCount = useMemo(() => {
    // Contagem definitiva: se block_list for false (!!block_list === false), está disponível
    if (isEditingList) {
      const list = customLists.find(l => String(l.id) === String(isEditingList));
      const available = contacts.filter(c => {
        const isBlocked = !!(c as any).block_list;
        if (list && Array.isArray(list.contact_ids)) {
          const contactId = normalizeUuid(c.id);
          const isInEditingList = list.contact_ids.some((lid: any) => 
            normalizeUuid(lid) === contactId
          );
          if (isInEditingList) return true;
        }
        return !isBlocked;
      });
      return available.length;
    }
    return contacts.filter(c => !(c as any).block_list).length;
  }, [contacts, customLists, isEditingList, normalizeUuid]);

    // Efeito para atualizar logs e contador do modal
  useEffect(() => {
    if (!showCustomListModal) return;

    const blockedCount = contacts.filter(c => !!(c as any).block_list).length;
    const availableCount = contacts.filter(c => !(c as any).block_list).length;

    console.log('[ContactsPage] Log do Modal:', {
      totalGeral: contacts.length,
      contatosDisponiveisNoBanco: availableCount,
      contatosBloqueadosNoBanco: blockedCount,
      valorNoContador: availableContactsCount
    });

    if (!isEditingList) {
      setListContactCount(availableCount);
    }
  }, [showCustomListModal, contacts, availableContactsCount, isEditingList]);

  const loadCustomLists = useCallback(async () => {
    if (!userId) return;
    setLoadingLists(true);
    try {
      const response = await fetch('/api/contacts/custom-lists', {
        headers: { 'X-User-Id': userId },
      });
      const data = await response.json();
      if (response.ok) {
        setCustomLists(data.data || []);
      }
    } catch (error) {
      console.error('Erro ao carregar listas:', error);
    } finally {
      setLoadingLists(false);
    }
  }, [userId]);

  useEffect(() => {
    if (userId) {
      loadCustomLists();
    }
  }, [userId, loadCustomLists]);

  // Atualiza o contador quando o modal é aberto para criar nova lista
  useEffect(() => {
    if (showCustomListModal && !isEditingList && userId) {
      // Recarrega as listas e contatos para garantir que os dados estejam atualizados
      // Isso garante que a contagem de disponíveis considere block_list atualizado
      const reloadData = async () => {
        await Promise.all([
          loadCustomLists(),
          loadInitialData()
        ]);
        // Aguarda um pouco para garantir que os dados foram atualizados
        await new Promise(resolve => setTimeout(resolve, 200));
      };
      reloadData();
      setSelectedContacts(new Set());
    }
  }, [showCustomListModal, isEditingList, userId, loadCustomLists, loadInitialData]);

  // Atualiza o contador quando os contatos são carregados e o modal está aberto
  useEffect(() => {
    if (showCustomListModal && !isEditingList) {
      // Solução definitiva: conta apenas quem tem block_list = false
      const availableCount = contacts.filter(c => (c as any).block_list === false).length;
      setListContactCount(availableCount);
    }
  }, [contacts, showCustomListModal, isEditingList]);

  // Quando uma lista é selecionada para edição, marca automaticamente os contatos atribuídos a ela
  useEffect(() => {
    if (isEditingList && customLists.length > 0) {
      const editingList = customLists.find(l => String(l.id) === String(isEditingList));
      if (editingList && Array.isArray(editingList.contact_ids) && editingList.contact_ids.length > 0) {
        // Cria um Set com os IDs dos contatos da lista
        const listContactIds = new Set<string>(editingList.contact_ids.map((id: any) => String(id)));
        
        // Atualiza a seleção para marcar os contatos da lista
        // Usa uma função de atualização para evitar dependência circular
        setSelectedContacts(prev => {
          const prevArray = Array.from(prev);
          const listIdsArray = Array.from(listContactIds);
          
          // Compara se são iguais (mesma quantidade e mesmos IDs)
          const areEqual = prevArray.length === listIdsArray.length &&
            prevArray.every((id: string) => listContactIds.has(String(id))) &&
            listIdsArray.every((id: string) => prev.has(String(id)));
          
          // Se não forem iguais, retorna o novo Set, caso contrário mantém o anterior
          return areEqual ? prev : listContactIds;
        });
      } else if (editingList && (!editingList.contact_ids || editingList.contact_ids.length === 0)) {
        // Se a lista não tem contatos, limpa a seleção
        setSelectedContacts(prev => prev.size > 0 ? new Set() : prev);
      }
    }
    // Não precisa limpar quando não está editando, pois o botão já faz isso
  }, [isEditingList, customLists]); // Dependências: quando lista de edição muda ou listas são carregadas

  const handleSignOut = async () => {
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('user_id');
      sessionStorage.removeItem('profile_id');
      window.localStorage.removeItem('profile_id');
      document.cookie = 'user_id=; Path=/; Max-Age=0; SameSite=Lax';
    }
    window.location.href = withTenantSlug('/login');
  };

  const handleDeleteContact = async (contactId: string) => {
    if (!userId) return;
    if (!confirm('Tem certeza que deseja excluir este contato?')) return;

    try {
      const { error } = await supabase
        .from('searches')
        .delete()
        .eq('id', contactId)
        .eq('user_id', userId);

      if (error) {
        showToast('Erro ao excluir contato', 'error');
      } else {
        showToast('Contato excluído com sucesso', 'success');
        await loadInitialData();
      }
    } catch (error) {
      showToast('Erro ao excluir contato', 'error');
    }
  };

  const handleToggleStatus = async (contact: Contact) => {
    if (!userId) return;
    try {
      const newStatus = contact.status === 'active' ? 'inactive' : 'active';
      const { error } = await supabase
        .from('searches')
        .update({ status: newStatus })
        .eq('id', contact.id)
        .eq('user_id', userId);

      if (error) {
        showToast('Erro ao atualizar status', 'error');
      } else {
        showToast('Status atualizado', 'success');
        await loadInitialData();
      }
    } catch (error) {
      showToast('Erro ao atualizar status', 'error');
    }
  };

  const loadDbGroups = useCallback(async () => {
    if (!userId) return;
    try {
      const res = await fetch('/api/groups', { headers: { 'X-User-Id': userId } });
      const json = await res.json();
      if (res.ok && json.data) {
        setDbGroups(json.data);
      } else {
        setDbGroups([]);
      }
    } catch {
      setDbGroups([]);
    }
  }, [userId]);

  useEffect(() => {
    if (showCustomListModal && userId) loadDbGroups();
  }, [showCustomListModal, userId, loadDbGroups]);

  const handleClearList = () => {
    if (!confirm('Tem certeza que deseja limpar a lista de contatos? (Isso não exclui do banco de dados)')) return;
    setSelectedContacts(new Set());
    setSearchTerm('');
    setFilterStatus('all');
    setCurrentPage(1);
    showToast('Lista limpa com sucesso', 'success');
  };

  const handleDeleteAllContacts = async () => {
    if (!userId) return;
    if (!confirm('Tem certeza que deseja deletar TODOS os contatos? Esta ação não pode ser desfeita!')) return;

    try {
      const response = await fetch('/api/contacts', {
        method: 'DELETE',
        headers: { 'X-User-Id': userId },
      });

      const data = await response.json();
      if (response.ok) {
        showToast(`${data.data?.deleted || 0} contato(s) deletado(s) com sucesso`, 'success');
        await loadInitialData();
      } else {
        showToast(data.error || 'Erro ao deletar contatos', 'error');
      }
    } catch (error) {
      showToast('Erro ao deletar contatos', 'error');
    }
  };

  const handleExportCSV = () => {
    const contactsToExport = selectedContacts.size > 0
      ? contacts.filter(c => selectedContacts.has(c.id))
      : contacts;

    if (contactsToExport.length === 0) {
      showToast('Não há contatos para exportar', 'error');
      return;
    }

    const headers = ['Nome', 'Telefone', 'Status', 'Status_Disparo', 'Status_Add_GP'];
    const rows = contactsToExport.map(c => [
      c.name || '',
      c.telefone || '',
      c.status || '',
      c.status_disparo ? 'Sim' : 'Não',
      c.status_add_gp ? 'Sim' : 'Não',
    ]);

    const csvContent = [headers, ...rows].map(row => row.join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `contatos_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    showToast('CSV exportado com sucesso!', 'success');
  };

  const handleToggleSelectContact = (contactId: string) => {
    // Verifica se o contato já está bloqueado (block_list = true)
    const contact = contacts.find(c => c.id === contactId);
    if (contact && !!(contact as any).block_list) {
      // Se não estiver editando, bloqueia (contato já está em outra lista)
      if (!isEditingList) {
        showToast(`Este contato já está em outra lista e não pode ser adicionado.`, 'error');
        return;
      }
      
      // Se estiver editando, verifica se o contato está na lista sendo editada
      const list = customLists.find(l => String(l.id) === String(isEditingList));
      if (list && Array.isArray(list.contact_ids)) {
        const isInEditingList = list.contact_ids.some((lid: any) => 
          normalizeUuid(lid) === normalizeUuid(contactId)
        );
        // Se não está na lista sendo editada, bloqueia
        if (!isInEditingList) {
          showToast(`Este contato já está em outra lista e não pode ser adicionado.`, 'error');
          return;
        }
      } else {
        // Se não encontrou a lista, bloqueia por segurança
        showToast(`Este contato já está em outra lista e não pode ser adicionado.`, 'error');
        return;
      }
    }
    
    setSelectedContacts(prev => {
      const newSet = new Set(prev);
      if (newSet.has(contactId)) {
        newSet.delete(contactId);
      } else {
        newSet.add(contactId);
      }
      return newSet;
    });
  };

  const handleSelectAll = () => {
    // Filtra apenas contatos disponíveis (block_list = false)
    const selectableContacts = paginatedContacts.filter(c => (c as any).block_list === false);
    
    if (selectedContacts.size >= selectableContacts.length && selectableContacts.length > 0) {
      setSelectedContacts(new Set());
    } else {
      setSelectedContacts(new Set(selectableContacts.map(c => c.id)));
    }
  };

  const handleCreateCustomList = async () => {
    if (!userId || !customListName.trim()) {
      showToast('Digite um nome para a lista', 'error');
      return;
    }

    // Previne múltiplos cliques
    if (creatingList) {
      return;
    }

    const selectedGroupInfo = dbGroups.find(g => g.group_id === listSelectedGroup);

    setCreatingList(true);
    try {
      const isEditing = !!isEditingList;
      const url = '/api/contacts/custom-lists';
      const method = isEditing ? 'PATCH' : 'POST';
      
      // VALIDAÇÃO NO FRONTEND: Prepara e valida os contatos antes de enviar
      let contactIdsToSend: string[] = [];
      let validationWarnings: string[] = [];

      if (isEditing) {
        // Se houve seleção de contatos
        if (selectedContacts.size > 0) {
          contactIdsToSend = Array.from(selectedContacts);
        }
      } else {
        // Se houver contatos selecionados manualmente, usa eles
        if (selectedContacts.size > 0) {
          // FILTRO CRUCIAL: Remove qualquer contato que esteja bloqueado (block_list === true)
          contactIdsToSend = Array.from(selectedContacts).filter(id => {
            const contact = contacts.find(c => c.id === id);
            return !contact?.block_list; // Apenas os NÃO bloqueados
          });
          
          if (contactIdsToSend.length < selectedContacts.size) {
            validationWarnings.push(`${selectedContacts.size - contactIdsToSend.length} contato(s) bloqueado(s) foram removido(s) da seleção.`);
          }
        } else if (listContactCount > 0) {
          // Se usar contagem, a API cuidará de pegar apenas os disponíveis
        } else {
          showToast('Selecione contatos ou defina uma quantidade', 'error');
          return;
        }
      }

      // Validação: Remove duplicatas no frontend
      const uniqueIds = Array.from(new Set(contactIdsToSend));
      if (uniqueIds.length !== contactIdsToSend.length) {
        const duplicatesCount = contactIdsToSend.length - uniqueIds.length;
        validationWarnings.push(`${duplicatesCount} duplicata(s) será(ão) removida(s)`);
        contactIdsToSend = uniqueIds;
      }

      // Validação: Verifica se algum contato já está bloqueado (block_list = true)
      const unavailableContacts: string[] = [];
      contactIdsToSend.forEach(contactId => {
        const contact = contacts.find(c => c.id === contactId);
        if (contact && (contact as any).block_list === true) {
          // Se estiver editando, permite contatos da própria lista
          if (!isEditing) {
            unavailableContacts.push(contactId);
          } else {
            // Verifica se o contato está na lista sendo editada
            const list = customLists.find(l => String(l.id) === String(isEditingList));
            if (list && Array.isArray(list.contact_ids)) {
              const isInEditingList = list.contact_ids.some((lid: any) => 
                normalizeUuid(lid) === normalizeUuid(contactId)
              );
              if (!isInEditingList) {
                unavailableContacts.push(contactId);
              }
            } else {
              unavailableContacts.push(contactId);
            }
          }
        }
      });

      if (unavailableContacts.length > 0) {
        const unavailableCount = unavailableContacts.length;
        const availableAfterFilter = contactIdsToSend.filter(id => !unavailableContacts.includes(id));
        
        if (availableAfterFilter.length === 0) {
          showToast('Todos os contatos selecionados já estão em outras listas. Selecione outros contatos.', 'error');
          return;
        }

        validationWarnings.push(`${unavailableCount} contato(s) já está(ão) em outra(s) lista(s) e será(ão) removido(s)`);
        contactIdsToSend = availableAfterFilter;
      }

      // Mostra avisos se houver
      if (validationWarnings.length > 0 && contactIdsToSend.length > 0) {
        const confirmMessage = `Atenção:\n${validationWarnings.join('\n')}\n\nDeseja continuar?`;
        if (!confirm(confirmMessage)) {
          return;
        }
      }

      const payload: any = {
        name: customListName.trim(),
        groupId: listSelectedGroup || null,
        groupSubject: selectedGroupInfo?.group_subject || null,
      };

      if (isEditing) {
        payload.id = isEditingList;
        if (contactIdsToSend.length > 0) {
          payload.contactIds = contactIdsToSend;
        }
      } else {
        if (contactIdsToSend.length > 0) {
          payload.contactIds = contactIdsToSend;
        } else {
          payload.count = listContactCount;
        }
      }

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      if (response.ok) {
        // Recarrega as listas e os contatos para atualizar os dados (incluindo block_list)
        // Aguarda o carregamento completo antes de continuar
        await loadCustomLists();
        await loadInitialData();
        
        // Força uma atualização do estado para garantir que o availableContactsCount seja recalculado
        // Aguarda um pouco para garantir que os dados foram atualizados
        await new Promise(resolve => setTimeout(resolve, 300));
        
        // Mostra mensagem de sucesso (a API já retorna informações sobre contatos removidos)
        const finalCount = data.data?.contact_ids?.length || 0;
        let message = data.message || `Lista ${isEditing ? 'atualizada' : 'criada'} com sucesso`;
        
        // Adiciona informação sobre a quantidade final de contatos
        if (finalCount > 0) {
          message += ` com ${finalCount} contato(s) único(s)`;
        }
        
        showToast(message, 'success');
        
        // Fecha o modal e limpa os estados apenas após sucesso
        setCustomListName('');
        setShowCustomListModal(false);
        setSelectedContacts(new Set());
        setListContactCount(0);
        setListSelectedGroup('');
        setIsEditingList(null);
      } else {
        if (debugLists) {
          console.error('[contacts][lists][debug] create/update list failed', {
            status: response.status,
            data,
          });
        }
        showToast(data.error || 'Erro ao processar lista', 'error');
      }
    } catch (error) {
      if (debugLists) console.error('[contacts][lists][debug] request error', error);
      showToast('Erro ao processar lista personalizada', 'error');
    } finally {
      setCreatingList(false);
    }
  };

  const handleDeleteCustomList = async (listId: string) => {
    if (!userId || !confirm('Tem certeza que deseja excluir esta lista?')) return;

    try {
      const response = await fetch(`/api/contacts/custom-lists?id=${listId}`, {
        method: 'DELETE',
        headers: { 'X-User-Id': userId },
      });

      if (response.ok) {
        // Recarrega listas e contatos para atualizar id_list
        await Promise.all([
          loadCustomLists(),
          loadInitialData()
        ]);
        showToast('Lista excluída com sucesso', 'success');
      } else {
        const data = await response.json();
        showToast(data.error || 'Erro ao excluir lista', 'error');
      }
    } catch (error) {
      showToast('Erro ao excluir lista', 'error');
    }
  };

  const filteredContacts = useMemo(() => {
    // Identifica contatos da lista atual para priorizar no filtro e na ordenação
    let contactIdsInList = new Set<string>();
    if (isEditingList) {
      const editingList = customLists.find(l => String(l.id) === String(isEditingList));
      if (editingList && Array.isArray(editingList.contact_ids)) {
        contactIdsInList = new Set(editingList.contact_ids.map((id: any) => normalizeUuid(id)));
      }
    }

    let list: Contact[] = contacts.filter(contact => {
      const contactId = normalizeUuid(contact.id);
      const isInCurrentList = contactId ? contactIdsInList.has(contactId) : false;

      // Se o contato está na lista sendo editada, ele SEMPRE passa no filtro de status
      // para garantir que o usuário sempre o veja para poder remover se quiser.
      const matchesFilter = isInCurrentList || (
        filterStatus === 'all' ||
        (filterStatus === 'active' && contact.status === 'active') ||
        (filterStatus === 'pending' && contact.status === 'pending') ||
        (filterStatus === 'added' && contact.status_add_gp) ||
        (filterStatus === 'sent' && contact.status_disparo)
      );

      const matchesSearch = !searchTerm || 
        (contact.name?.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (contact.telefone?.includes(searchTerm));

      return matchesSearch && matchesFilter;
    });

    // Se estiver editando uma lista, move os contatos dessa lista para o topo
    if (isEditingList && contactIdsInList.size > 0) {
      return [...list].sort((a, b) => {
        const aInList = contactIdsInList.has(normalizeUuid(a.id) || '');
        const bInList = contactIdsInList.has(normalizeUuid(b.id) || '');
        
        if (aInList && !bInList) return -1;
        if (!aInList && bInList) return 1;
        return 0;
      });
    }

    return list;
  }, [contacts, searchTerm, filterStatus, isEditingList, customLists, normalizeUuid]);

  const totalPages = Math.ceil(filteredContacts.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedContacts = filteredContacts.slice(startIndex, startIndex + itemsPerPage);

  if (checking || userId === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#1a1a1a]">
        <div className="bg-[#2a2a2a] rounded-xl shadow-lg p-6 border border-[#404040] text-center">
          <p className="text-gray-300 font-medium">Carregando...</p>
        </div>
      </div>
    );
  }

  return (
    <Layout onSignOut={handleSignOut}>
      <div className="-m-4 sm:-m-6 lg:-m-8 p-4 sm:p-6 lg:p-8 min-h-screen bg-[#1a1a1a]">
      {/* Toasts */}
      <div className="fixed top-4 left-4 right-4 sm:left-auto sm:right-4 z-50 space-y-2 max-w-sm sm:max-w-none">
        {toasts.map(toast => (
          <div
            key={toast.id}
            className={`flex items-center gap-3 w-full sm:min-w-[320px] px-4 sm:px-6 py-4 rounded-lg shadow-lg text-white ${
              toast.type === 'success' ? 'bg-[#E86A24]' : toast.type === 'error' ? 'bg-red-600' : 'bg-amber-500'
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

      <div className="space-y-4 sm:space-y-6 px-4 sm:px-0">
        <div className="flex items-center justify-between gap-4">
          <div className="flex-1">
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-100 mb-1 sm:mb-2">Contatos Ativos</h1>
            <p className="text-sm sm:text-base text-gray-400">Gerencie seus contatos ({contacts.length} total)</p>
          </div>
          <div className="flex flex-wrap gap-2 items-center flex-shrink-0">
            {/* Botão Toggle da Sidebar - Apenas no mobile, no topo direito */}
            <div className="lg:hidden">
              <button
                onClick={() => setIsMobileOpen(!isMobileOpen)}
                className="flex items-center justify-center w-10 h-10 rounded-lg hover:bg-[#404040] transition text-gray-400 shadow-md bg-[#2a2a2a] border border-[#404040]"
                aria-label="Toggle sidebar"
              >
                <Menu className="w-5 h-5" />
              </button>
            </div>
            <button
              onClick={handleExportCSV}
              className="flex-1 sm:flex-none px-3 sm:px-4 py-2 border-2 border-[#E86A24] text-[#E86A24] rounded-lg hover:bg-[#E86A2415] transition flex items-center justify-center gap-2 text-sm sm:text-base"
            >
              <Download className="w-4 h-4 sm:w-5 sm:h-5" />
              <span className="hidden sm:inline">Exportar CSV</span>
              <span className="sm:hidden">CSV</span>
            </button>
            <button
              onClick={handleClearList}
              className="flex-1 sm:flex-none px-3 sm:px-4 py-2 border-2 border-amber-600 text-amber-600 rounded-lg hover:bg-amber-50 transition flex items-center justify-center gap-2 text-sm sm:text-base"
            >
              <Eraser className="w-4 h-4 sm:w-5 sm:h-5" />
              <span className="hidden sm:inline">Limpar Lista</span>
              <span className="sm:hidden">Limpar</span>
            </button>
            <button
              onClick={handleDeleteAllContacts}
              className="flex-1 sm:flex-none px-3 sm:px-4 py-2 border-2 border-red-600 text-red-600 rounded-lg hover:bg-red-50 transition flex items-center justify-center gap-2 text-sm sm:text-base"
            >
              <Trash2 className="w-4 h-4 sm:w-5 sm:h-5" />
              <span className="hidden sm:inline">Deletar Contatos</span>
              <span className="sm:hidden">Deletar</span>
            </button>
            <button
              onClick={() => {
                setIsEditingList(null);
                setCustomListName('');
                setListSelectedGroup('');
                setSelectedContacts(new Set());
                setShowCustomListModal(true);
              }}
              className="flex-1 sm:flex-none px-3 sm:px-4 py-2 border-2 border-[#E86A24] text-[#E86A24] rounded-lg hover:bg-[#E86A2415] transition flex items-center justify-center gap-2 text-sm sm:text-base"
            >
              <Plus className="w-4 h-4 sm:w-5 sm:h-5" />
              <span className="hidden sm:inline">Criar Lista</span>
              <span className="sm:hidden">Lista</span>
            </button>
            <button
              onClick={loadInitialData}
              className="flex-1 sm:flex-none px-3 sm:px-4 py-2 bg-[#E86A24] hover:bg-[#D95E1B] text-white rounded-lg transition flex items-center justify-center gap-2 text-sm sm:text-base"
            >
              <RefreshCw className="w-4 h-4 sm:w-5 sm:h-5" />
              <span className="hidden sm:inline">Atualizar</span>
              <span className="sm:hidden">Atualizar</span>
            </button>
          </div>
        </div>

        {/* Filtros */}
        <div className="bg-[#2a2a2a] rounded-xl shadow-md p-4 sm:p-6 border border-[#404040]">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Buscar</label>
              <input
                type="text"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                placeholder="Nome ou telefone..."
                className="w-full px-4 py-2 border-2 border-[#404040] rounded-lg focus:ring-2 focus:ring-[#E86A24] focus:border-[#E86A24] placeholder:text-gray-500 text-gray-200 bg-[#333]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Filtrar por Status</label>
              <select
                value={filterStatus}
                onChange={e => setFilterStatus(e.target.value)}
                className="w-full px-4 py-2 border-2 border-[#404040] rounded-lg focus:ring-2 focus:ring-[#E86A24] focus:border-[#E86A24] text-gray-200 bg-[#333]"
              >
                <option value="all">Todos</option>
                <option value="active">Ativos</option>
                <option value="pending">Pendentes</option>
                <option value="added">Adicionados</option>
                <option value="sent">Enviados</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Itens por página</label>
              <select
                value={itemsPerPage}
                onChange={e => {
                  setItemsPerPage(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="w-full px-4 py-2 border-2 border-[#404040] rounded-lg focus:ring-2 focus:ring-[#E86A24] focus:border-[#E86A24] text-gray-200 bg-[#333]"
              >
                <option value="10">10</option>
                <option value="25">25</option>
                <option value="50">50</option>
                <option value="100">100</option>
              </select>
            </div>
          </div>
        </div>

        {/* Lista de Contatos */}
        <div className="bg-[#2a2a2a] rounded-xl shadow-md p-4 sm:p-6 overflow-x-hidden border border-[#404040]" data-tour-id="contatos-lista">
          {/* Banner de Edição de Lista */}
          {isEditingList && (() => {
            const editingList = customLists.find(l => l.id === isEditingList);
            return (
              <div className="mb-4 p-4 bg-blue-900/20 border-2 border-blue-600/50 rounded-lg flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="flex-1">
                  <p className="text-sm font-semibold text-blue-300 mb-1">
                    Editando contatos da lista: <span className="font-bold">{editingList?.name || 'Lista'}</span>
                  </p>
                  <p className="text-xs text-blue-400">
                    Selecione ou desmarque os contatos que deseja adicionar ou remover desta lista.
                  </p>
                </div>
                <button
                  onClick={() => {
                    setIsEditingList(null);
                    setSelectedContacts(new Set());
                    showToast('Edição da lista cancelada', 'info');
                  }}
                  className="px-4 py-2 bg-[#333] hover:bg-blue-900/30 border-2 border-blue-500/50 text-blue-300 rounded-lg transition flex items-center justify-center gap-2 text-sm font-medium whitespace-nowrap"
                >
                  <X className="w-4 h-4" />
                  Cancelar Edição
                </button>
              </div>
            );
          })()}
          
          {loadingInitial ? (
            <div className="flex flex-col items-center justify-center py-16 gap-4" data-tour-id="contatos-loading">
              <Loader2 className="w-12 h-12 text-[#E86A24] animate-spin" aria-hidden />
              <p className="text-gray-400 font-medium">Carregando contatos...</p>
            </div>
          ) : paginatedContacts.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-400">Nenhum contato encontrado</p>
            </div>
          ) : (
            <>
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4">
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={selectedContacts.size === paginatedContacts.length && paginatedContacts.length > 0}
                    onChange={handleSelectAll}
                    className="w-5 h-5 text-[#E86A24] rounded focus:ring-[#E86A24]"
                  />
                  <span className="text-sm text-gray-400">
                    {selectedContacts.size > 0 ? `${selectedContacts.size} selecionado(s)` : 'Selecionar todos'}
                  </span>
                </div>
                <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                  {selectedContacts.size > 0 && (
                    <button
                      onClick={() => setShowCustomListModal(true)}
                      className="w-full sm:w-auto px-4 py-2 bg-[#E86A24] hover:bg-[#D95E1B] text-white rounded-lg transition flex items-center justify-center gap-2 text-sm sm:text-base"
                    >
                      <Plus className="w-4 h-4" />
                      <span className="hidden sm:inline">Criar Lista Personalizada</span>
                      <span className="sm:hidden">Criar Lista</span>
                    </button>
                  )}
                  {isEditingList && selectedContacts.size > 0 && (
                    <button
                      onClick={handleCreateCustomList}
                      className="w-full sm:w-auto px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition flex items-center justify-center gap-2 text-sm sm:text-base"
                    >
                      <Save className="w-4 h-4" />
                      <span className="hidden sm:inline">Salvar Alterações</span>
                      <span className="sm:hidden">Salvar</span>
                    </button>
                  )}
                </div>
              </div>
              <div className="space-y-3">
                {paginatedContacts.map(contact => {
                  const isBlocked = !!(contact as any).block_list;
                  
                  // Se estiver editando, o contato da própria lista não aparece como bloqueado
                  let displayAsBlocked = isBlocked;
                  if (isBlocked && isEditingList) {
                    const currentList = customLists.find(l => String(l.id) === String(isEditingList));
                    if (currentList?.contact_ids?.some((id: any) => normalizeUuid(id) === normalizeUuid(contact.id))) {
                      displayAsBlocked = false;
                    }
                  }
                  
                  return (
                    <div
                      key={contact.id}
                      className={`flex flex-col sm:flex-row items-start sm:items-center justify-between p-3 sm:p-4 border-2 rounded-lg transition ${
                        displayAsBlocked
                          ? 'border-blue-900/50 bg-blue-900/20 opacity-80'
                          : selectedContacts.has(contact.id)
                          ? 'border-[#E86A24] bg-[#E86A2415]'
                          : 'border-[#404040] hover:border-[#E86A2440] bg-[#333]'
                      }`}
                    >
                    <div className="flex items-start sm:items-center gap-3 flex-1 w-full sm:w-auto min-w-0">
                      <input
                        type="checkbox"
                        checked={selectedContacts.has(contact.id)}
                        onChange={() => handleToggleSelectContact(contact.id)}
                        disabled={displayAsBlocked}
                        className="w-5 h-5 text-[#E86A24] rounded focus:ring-[#E86A24] flex-shrink-0 mt-1 sm:mt-0 disabled:bg-gray-200 disabled:cursor-not-allowed"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                          <h3 className="font-semibold text-gray-200 text-sm sm:text-base truncate">
                            {contact.name || `Contato ${contact.id.slice(0, 8)}`}
                          </h3>
                          <span
                            className={`px-2 py-1 rounded text-xs font-medium flex-shrink-0 ${
                              contact.status === 'active'
                                ? 'bg-[#E86A2415] text-[#C9531A]'
                                : contact.status === 'pending'
                                ? 'bg-yellow-900/30 text-yellow-400'
                                : 'bg-[#404040] text-gray-400'
                            }`}
                          >
                            {contact.status || 'N/A'}
                          </span>
                          {displayAsBlocked && (
                            <span className="px-2 py-0.5 rounded-full bg-blue-600 text-white text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 shadow-sm">
                              <List className="w-3 h-3" />
                              Bloqueado (Em Lista)
                            </span>
                          )}
                        </div>
                        <p className="text-xs sm:text-sm text-gray-400 mt-1 break-all sm:break-normal">
                          {contact.telefone ? `+55 ${contact.telefone}` : 'Sem telefone'}
                        </p>
                        <div className="flex flex-wrap gap-2 sm:gap-4 mt-2 text-xs text-gray-500 dark:text-gray-400">
                          {contact.status_disparo && (
                            <span className="flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3" />
                              Mensagem enviada
                            </span>
                          )}
                          {contact.status_add_gp && (
                            <span className="flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3" />
                              Adicionado ao grupo
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mt-3 sm:mt-0 w-full sm:w-auto justify-end sm:justify-start">
                      <button
                        onClick={() => handleToggleStatus(contact)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition flex-shrink-0 ${
                          contact.status === 'active' ? 'bg-[#E86A24]' : 'bg-gray-300'
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
                            contact.status === 'active' ? 'translate-x-6' : 'translate-x-1'
                          }`}
                        />
                      </button>
                      <button
                        onClick={() => handleDeleteContact(contact.id)}
                        className="p-2 text-red-500 hover:bg-red-900/20 rounded-lg transition"
                        title="Excluir"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                    </div>
                  );
                })}
              </div>

              {/* Paginação */}
              {totalPages > 1 && (
                <div className="flex flex-col sm:flex-row justify-between items-center gap-3 mt-6 pt-4 border-t border-[#404040]">
                  <button
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="w-full sm:w-auto px-4 py-2 border-2 border-[#404040] text-gray-200 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#404040] hover:border-[#555] transition font-medium bg-[#333]"
                  >
                    Anterior
                  </button>
                  <span className="text-sm font-medium text-gray-300 text-center">
                    Página {currentPage} de {totalPages} ({filteredContacts.length} contatos)
                  </span>
                  <button
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    className="w-full sm:w-auto px-4 py-2 border-2 border-[#404040] text-gray-200 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#404040] hover:border-[#555] transition font-medium bg-[#333]"
                  >
                    Próxima
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Seção: Listas Personalizadas */}
        <div className="bg-[#2a2a2a] rounded-xl shadow-md p-4 sm:p-6 border border-[#404040]">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-100">Suas Listas Personalizadas</h2>
            <span className="text-sm text-gray-500">{customLists.length} listas</span>
          </div>
          
          {loadingLists ? (
            <div className="text-center py-8">
              <RefreshCw className="w-6 h-6 animate-spin mx-auto text-[#E86A24] mb-2" />
              <p className="text-gray-500">Carregando listas...</p>
            </div>
          ) : customLists.length === 0 ? (
            <div className="text-center py-8 border-2 border-dashed border-[#404040] rounded-xl">
              <List className="w-8 h-8 mx-auto text-gray-500 mb-2" />
              <p className="text-gray-500">Nenhuma lista criada ainda</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {customLists.map(list => (
                <div key={list.id} className="p-4 border-2 border-[#404040] rounded-xl hover:border-[#E86A2440] hover:bg-[#E86A2410] transition bg-[#333]">
                  <div className="flex justify-between items-start mb-2">
                    <h3 className="font-bold text-gray-200 truncate pr-2">{list.name}</h3>
                    <div className="flex gap-1">
                      <button
                        onClick={() => {
                          setIsEditingList(list.id);
                          setCustomListName(list.name);
                          setListSelectedGroup(list.group_id || '');
                          setShowCustomListModal(true);
                        }}
                        className="p-1.5 text-blue-400 hover:bg-blue-900/20 rounded transition"
                        title="Editar Nome/Grupo"
                      >
                        <Save className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => {
                          // Marca os contatos da lista como selecionados
                          const listContactIds = list.contact_ids || [];
                          const listContacts = new Set<string>(listContactIds);
                          
                          // Define o estado de edição e seleciona os contatos
                          setIsEditingList(list.id);
                          setSelectedContacts(listContacts);
                          setCustomListName(list.name);
                          setListSelectedGroup(list.group_id || '');
                          
                          // Mostra feedback ao usuário
                          const contactCount = listContactIds.length;
                          showToast(
                            `${contactCount} contato(s) da lista "${list.name}" ${contactCount === 1 ? 'foi' : 'foram'} selecionado(s) e marcado(s) para edição`,
                            'info'
                          );
                          
                          // Scroll para o topo para ver os contatos marcados
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        className="p-1.5 text-[#E86A24] hover:bg-[#E86A2415] rounded transition"
                        title="Editar Contatos da Lista"
                      >
                        <Users className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDeleteCustomList(list.id)}
                        className="p-1.5 text-red-500 hover:bg-red-900/20 rounded transition"
                        title="Excluir Lista"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-gray-400 flex items-center gap-2">
                      <Users className="w-3.5 h-3.5" />
                      {list.contact_ids?.length || 0} contatos
                    </p>
                    {list.group_subject && (
                      <p className="text-xs text-gray-500 flex items-center gap-2 truncate">
                        <Info className="w-3.5 h-3.5" />
                        Grupo: {list.group_subject}
                      </p>
                    )}
                    <p className="text-[10px] text-gray-400 mt-2">
                      Criada em: {new Date(list.created_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>

      {/* Modal: Criar/Editar Lista Personalizada */}
      {showCustomListModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-50 p-4">
          <div className="bg-[#2a2a2a] rounded-2xl shadow-2xl p-4 sm:p-6 max-w-md w-full max-h-[90vh] overflow-y-auto border border-[#404040]">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg sm:text-xl font-semibold text-gray-100">
                {isEditingList ? 'Editar Lista' : 'Criar Lista Personalizada'}
              </h3>
              <button
                onClick={() => {
                  if (creatingList) return; // Previne fechar durante criação
                  setShowCustomListModal(false);
                  setCustomListName('');
                  setListContactCount(0);
                  setIsEditingList(null);
                  setSelectedContacts(new Set());
                  setCreatingList(false); // Reset loading ao fechar
                }}
                disabled={creatingList}
                className={`text-gray-400 hover:text-gray-200 flex-shrink-0 ${creatingList ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Nome da Lista*
                </label>
                <input
                  type="text"
                  value={customListName}
                  onChange={e => setCustomListName(e.target.value)}
                  placeholder="Ex: Lista de Vendas"
                  className="w-full px-4 py-2 border-2 border-[#404040] rounded-lg focus:ring-2 focus:ring-[#E86A24] focus:border-[#E86A24] placeholder:text-gray-500 text-gray-200 bg-[#333]"
                />
              </div>

              {!isEditingList && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Quantidade de Contatos
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        value={listContactCount}
                        onChange={e => setListContactCount(Number(e.target.value))}
                        className="flex-1 px-4 py-2 border-2 border-[#404040] rounded-lg focus:ring-2 focus:ring-[#E86A24] focus:border-[#E86A24] text-gray-200 bg-[#333]"
                        min="0"
                        max={availableContactsCount}
                      />
                      <button
                        onClick={() => setListContactCount(availableContactsCount)}
                        className="px-3 py-2 bg-[#404040] hover:bg-[#555] text-gray-200 rounded-lg transition text-sm font-medium"
                      >
                        Todos Disp.
                      </button>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      Disponíveis: {availableContactsCount} de {contacts.length} contatos
                    </p>
                  </div>

                  {selectedContacts.size > 0 && (
                    <div className="p-3 bg-[#E86A2415] border border-[#E86A2440] rounded-lg">
                      <p className="text-sm text-[#C9531A] font-medium">
                        {selectedContacts.size} contato(s) selecionado(s) manualmente serão priorizados.
                      </p>
                    </div>
                  )}
                </>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Grupo Associado (Opcional)
                </label>
                <select
                  value={listSelectedGroup}
                  onChange={e => setListSelectedGroup(e.target.value)}
                  className="w-full px-4 py-2 border-2 border-[#404040] rounded-lg focus:ring-2 focus:ring-[#E86A24] focus:border-[#E86A24] text-gray-200 bg-[#333]"
                >
                  <option value="">Nenhum Grupo</option>
                  {dbGroups.map(group => (
                    <option key={group.group_id} value={group.group_id}>
                      {group.group_subject || group.group_id}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 pt-2">
                <button
                  onClick={() => {
                    if (creatingList) return; // Previne fechar durante criação
                    setShowCustomListModal(false);
                    setCustomListName('');
                    setListContactCount(0);
                    setIsEditingList(null);
                    setSelectedContacts(new Set());
                    setCreatingList(false); // Reset loading ao cancelar
                  }}
                  disabled={creatingList}
                  className={`flex-1 px-4 py-2 border-2 border-[#404040] text-gray-200 rounded-lg hover:bg-[#404040] transition font-medium bg-[#333] ${creatingList ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  Cancelar
                </button>
                <button
                  onClick={handleCreateCustomList}
                  disabled={creatingList}
                  className={`flex-1 px-4 py-2 bg-[#E86A24] hover:bg-[#D95E1B] text-white rounded-lg transition flex items-center justify-center gap-2 font-medium ${creatingList ? 'opacity-70 cursor-not-allowed' : ''}`}
                >
                  {creatingList ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      {isEditingList ? 'Salvando...' : 'Criando...'}
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4" />
                      {isEditingList ? 'Salvar Alterações' : 'Criar Lista'}
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      </div>
    </Layout>
  );
};

export default ContactsPage;

