'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRequireAuth } from '@/utils/useRequireAuth';
import Layout from '@/components/Layout';
import { useDashboardData, Contact, WhatsAppInstance, DbGroup, Campaign } from '@/hooks/useDashboardData';
import CampaignsTable from '@/components/Campaigns/CampaignsTable';
import { Plus, Pause, Play, CheckCircle2, AlertCircle, Info, X, Clock, XCircle, Menu, } from 'lucide-react';
import { useSidebar } from '@/contexts/SidebarContext';
import { supabase } from '@/lib/supabase';

type DelayUnit = 'seconds' | 'minutes';
type DistributionMode = 'sequential' | 'random';


type GroupForAdd = {
  jid: string;
  subject: string;
};


function AddToGroupPage() {
  const { checking } = useRequireAuth();
  const { isCollapsed, setIsCollapsed, isMobileOpen, setIsMobileOpen } = useSidebar();
  const { userId, instances, contacts, campaigns, showToast, addLog, toasts, setToasts, loadInitialData, } = useDashboardData();

  const [selectedInstance, setSelectedInstance] = useState('');
  const [selectedGroupJid, setSelectedGroupJid] = useState('');
  const [dbGroups, setDbGroups] = useState<DbGroup[]>([]);
  const [selectedGroupSubject, setSelectedGroupSubject] = useState('');
  const [multiInstancesMode, setMultiInstancesMode] = useState(false);
  const [multiGroupsMode, setMultiGroupsMode] = useState(false);
  const [instancesForAdd, setInstancesForAdd] = useState<string[]>([]);
  const [groupsForAdd, setGroupsForAdd] = useState<GroupForAdd[]>([]);
  const [distributionMode, setDistributionMode] = useState<DistributionMode>('sequential');
  const [distributionGpMode, setDistributionGpMode] = useState<DistributionMode>('sequential');
  const [addLimit, setAddLimit] = useState<number>(10);
  const [addDelayValue, setAddDelayValue] = useState<number>(1);
  const [addDelayUnit, setAddDelayUnit] = useState<DelayUnit>('minutes');
  const [addRandom, setAddRandom] = useState<boolean>(false);
  const [randomMinSeconds, setRandomMinSeconds] = useState<number>(550);
  const [randomMaxSeconds, setRandomMaxSeconds] = useState<number>(950);
  const [addingToGroup, setAddingToGroup] = useState<boolean>(false);
  const [addPaused, setAddPaused] = useState<boolean>(false);
  const [customLists, setCustomLists] = useState<any[]>([]);
  const [selectedListId, setSelectedListId] = useState<string>('');
  const [loadingLists, setLoadingLists] = useState(false);

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

  const activeCampaignsRef = useRef<HTMLDivElement>(null);

  const toggleInstanceForAdd = (name: string) => {
    setInstancesForAdd(prev =>
      prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]
    );
  };

  const toggleGroupForAdd = (group: GroupForAdd) => {
    setGroupsForAdd(prev => {
      const exists = prev.some(g => g.jid === group.jid);

      return exists
        ? prev.filter(g => g.jid !== group.jid)
        : [...prev, group];
    });
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

  const handleAddToGroup = async () => {
    if (!userId) {
      showToast('Sessão inválida', 'error');
      return;
    }

    const groupsToUse = selectedGroupJid ? [{ jid: selectedGroupJid, subject: selectedGroupSubject }] : groupsForAdd;

    if (!multiGroupsMode && groupsToUse.length === 0) {
      showToast('Selecione pelo menos um grupo', 'error');
      return;
    }

    if (multiGroupsMode && groupsForAdd.length === 0) {
      showToast('Selecione pelo menos um grupo', 'error');
      return;
    }

    if (!multiInstancesMode && !selectedInstance) {
      showToast('Selecione uma instância', 'error');
      return;
    }

    if (multiInstancesMode && instancesForAdd.length === 0) {
      showToast('Selecione pelo menos uma instância', 'error');
      return;
    }

    console.log(groupsForAdd);

    let contactsToUse: Contact[] = [];

    if (selectedListId) {
      // Usa contatos da lista personalizada
      const selectedList = customLists.find(l => l.id === selectedListId);
      if (!selectedList || !selectedList.contact_ids) {
        showToast('Lista personalizada não encontrada ou vazia', 'error');
        return;
      }

      const listIds = new Set(selectedList.contact_ids);
      // Filtra contatos que estão na lista E não falharam E não foram adicionados ainda
      contactsToUse = contacts.filter(c =>
        listIds.has(c.id) &&
        c.status !== 'failed' &&
        !c.status_add_gp
      );

      if (contactsToUse.length === 0) {
        showToast('Nenhum contato da lista está disponível para adição', 'error');
        return;
      }

      // Aplica o limite se definido
      contactsToUse = contactsToUse.slice(0, addLimit);
    } else {
      // Usa lógica padrão de contatos globais
      const availableContacts = contacts.filter(c => c.status !== 'failed' && !c.status_add_gp);
      if (availableContacts.length === 0) {
        showToast('Nenhum contato disponível para adicionar', 'error');
        return;
      }
      contactsToUse = availableContacts.slice(0, addLimit);
    }

    if (contactsToUse.length === 0) {
      showToast('Nenhum contato selecionado', 'error');
      return;
    }

    setAddingToGroup(true);
    addLog(`Iniciando adição de ${contactsToUse.length} contato(s) ao grupo...`, 'info');

    try {
      // Usa novo endpoint que cria campanha e jobs na fila
      const instancesToUse = multiInstancesMode ? instancesForAdd : [selectedInstance];


      const basePerGroup = Math.floor(contactsToUse.length / groupsToUse.length);
      const remainder = contactsToUse.length % groupsToUse.length;
      const groups = groupsToUse.map((g, idx) => ({
        jid: g.jid,
        subject: g.subject || '',
        target_contacts: basePerGroup + (idx < remainder ? 1 : 0),
      }));

      // Prepara contatos
      const contacts = contactsToUse.map(c => ({
        contactId: c.id,
        phone: c.telefone || '',
      }));

      // Prepara strategy
      const strategy = {
        delayConfig: {
          delayMode: addRandom ? 'random' : 'fixed',
          delayValue: addDelayValue,
          delayUnit: addDelayUnit,
          randomMinSeconds,
          randomMaxSeconds,
        },
        distributionMode,
        concurrency: 1,
        max_retries: 3,
        retry_backoff_minutes: [1, 5, 15],
      };

      addLog(`Iniciando campanha com ${contacts.length} contato(s)...`, 'info');

      const resp = await fetch('/api/campaigns/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': userId, // CRÍTICO: Header necessário para autenticação
        },
        body: JSON.stringify({
          groups,
          contacts,
          strategy,
          instances: instancesToUse,
          customListId: selectedListId || null,
        }),
      });

      const data = await resp.json().catch(() => ({} as any));

      if (!resp.ok) {
        const errorMsg = data?.error || data?.message || 'Erro ao iniciar campanha';
        console.error('Erro ao iniciar campanha:', errorMsg, data);
        throw new Error(errorMsg);
      }

      const campaign = data.data?.campaign;

      // Log para debug
      console.log('Campanha iniciada com sucesso:', {
        campaignId: campaign?.id,
        totalJobs: data.data?.total_jobs,
        groups: data.data?.groups?.length,
        message: data.message
      });

      showToast(`Campanha iniciada! ${contacts.length} contato(s) serão processados pela fila...`, 'success');
      addLog(`Campanha ${campaign?.id} criada e iniciada! Jobs serão processados pelo worker.`, 'success');

      // Recarrega dados imediatamente para mostrar a campanha ativa
      await loadInitialData();

      // Faz scroll para a seção de campanhas ativas
      setTimeout(() => {
        activeCampaignsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);

      // Aguarda um pouco e recarrega novamente para pegar status atualizado
      setTimeout(async () => {
        await loadInitialData();
      }, 2000);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      addLog(`Erro ao adicionar ao grupo: ${msg}`, 'error');
      showToast(`Erro: ${msg}`, 'error');
    } finally {
      setAddingToGroup(false);
      setAddPaused(false);
    }
  };

  const handleSignOut = async () => {
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('user_id');
      sessionStorage.removeItem('profile_id');
      window.localStorage.removeItem('profile_id');
      document.cookie = 'user_id=; Path=/; Max-Age=0; SameSite=Lax';
    }
    window.location.href = '/login';
  };

  if (checking || userId === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-[#1a1a1a]">
        <div className="bg-white dark:bg-[#2a2a2a] rounded-xl shadow-lg p-6 border border-gray-200 dark:border-[#404040] text-center">
          <p className="text-gray-700 dark:text-gray-200 font-medium">Carregando...</p>
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
            className={`flex items-center gap-3 min-w-[320px] px-6 py-4 rounded-lg shadow-lg text-white ${toast.type === 'success' ? 'bg-[#8CD955]' : toast.type === 'error' ? 'bg-red-600' : 'bg-amber-500'
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
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 dark:text-white mb-2">Adição em Grupo</h1>
            <p className="text-sm sm:text-base text-gray-600 dark:text-gray-400">Configure e inicie a adição de contatos aos grupos</p>
          </div>
          {/* Botão Toggle da Sidebar - Apenas no mobile, no topo direito */}
          <div className="lg:hidden flex-shrink-0">
            <button
              onClick={() => setIsMobileOpen(!isMobileOpen)}
              className="flex items-center justify-center w-10 h-10 rounded-lg hover:bg-gray-100 dark:hover:bg-[#404040] transition text-gray-600 dark:text-gray-300 shadow-md bg-white dark:bg-[#2a2a2a]"
              aria-label="Toggle sidebar"
            >
              <Menu className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="bg-gray-100 dark:bg-[#2a2a2a] rounded-xl shadow-md p-6 space-y-6 border border-gray-200 dark:border-[#404040]" data-tour-id="adicao-configuracao">
          {/* Instância base */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Instância base:
            </label>
            <select
              value={selectedInstance}
              onChange={e => setSelectedInstance(e.target.value)}
              disabled={multiInstancesMode}
              className="w-full px-4 py-3 border-2 border-gray-200 dark:border-[#555] rounded-lg focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] disabled:opacity-50 text-gray-700 dark:text-white bg-white dark:bg-[#333]"
            >
              <option value="">Selecione uma Instância</option>
              {instances.map(inst => (
                <option key={inst.id || inst.instance_name} value={inst.instance_name}>
                  {inst.instance_name} ({inst.status})
                </option>
              ))}
            </select>
            <div className="mt-3 flex items-center gap-3">
              <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
                <input
                  type="checkbox"
                  id="multiInstances"
                  checked={multiInstancesMode}
                  onChange={e => setMultiInstancesMode(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-[#8CD955]/30 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#8CD955]"></div>
              </label>
              <label htmlFor="multiInstances" className="text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer">
                Usar múltiplas instâncias em rodízio para adicionar ao grupo
              </label>
            </div>
          </div>

          {/* Múltiplas instâncias */}
          {multiInstancesMode && (
            <div className="border border-blue-200 rounded-lg p-4 bg-blue-50/30" data-tour-id="adicao-multiplas-instancias">
              <label className="block text-sm font-medium text-gray-700 mb-3">
                Selecionar Instâncias:
              </label>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {instances.map(inst => (
                  <button
                    key={inst.id || inst.instance_name}
                    onClick={() => toggleInstanceForAdd(inst.instance_name)}
                    className={`px-4 py-3 rounded-lg border-2 transition font-medium ${instancesForAdd.includes(inst.instance_name)
                        ? 'border-[#8CD955] bg-[#8CD955]/25 dark:bg-[#8CD955]/20 text-[#1a4d0d] dark:text-[#8CD955] ring-2 ring-[#8CD955] ring-offset-2 shadow-sm'
                        : 'border-gray-200 dark:border-[#555] text-gray-600 dark:text-gray-300 hover:border-[#8CD955]/50 hover:bg-gray-50 dark:hover:bg-[#404040]'
                      }`}
                  >
                    {inst.instance_name}
                  </button>
                ))}
              </div>
              <div className="mt-3">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Modo de rodízio</label>
                <select
                  value={distributionMode}
                  onChange={e => setDistributionMode(e.target.value as DistributionMode)}
                  className="w-full px-4 py-2 border border-gray-200 dark:border-[#555] rounded-lg text-gray-700 dark:text-white bg-white dark:bg-[#333]"
                >
                  <option value="sequential">Sequencial</option>
                  <option value="random">Aleatório</option>
                </select>
              </div>
            </div>
          )}

          {/* Grupo salvo no banco */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Grupo salvo no banco:
            </label>
            <select
              value={selectedGroupJid}
              disabled={multiGroupsMode}
              onChange={e => {
                const group = dbGroups.find(g => g.group_id === e.target.value);
                setSelectedGroupJid(e.target.value);
                setSelectedGroupSubject(group?.group_subject || '');
              }}
              className="w-full px-4 py-3 border-2 border-gray-200 dark:border-[#555] rounded-lg focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] disabled:opacity-50 text-gray-700 dark:text-white bg-white dark:bg-[#333]"
            >
              <option value="">Selecione um Grupo</option>
              {dbGroups.map(group => (
                <option key={group.group_id} value={group.group_id}>
                  {group.group_subject || group.group_id}
                </option>
              ))}
            </select>
            <div className="mt-3 flex items-center gap-3">
              <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
                <input
                  type="checkbox"
                  id="multiGroups"
                  checked={multiGroupsMode}
                  onChange={e => setMultiGroupsMode(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-[#8CD955]/30 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#8CD955]"></div>
              </label>
              <label htmlFor="multiGroups" className="text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer">
                Adicionar mais de um grupo
              </label>
            </div>
          </div>


          {multiGroupsMode && (
            <div className="border border-blue-200 dark:border-blue-800/50 rounded-lg p-4 bg-blue-50/30 dark:bg-blue-900/20" data-tour-id="adicao-multiplas-instancias">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                Selecionar Grupos:
              </label>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {dbGroups.map(inst => (
                  <button
                    key={inst.group_id || inst.group_subject}
                    onClick={() => toggleGroupForAdd({ jid: inst.group_id, subject: inst.group_subject })}
                    className={`px-4 py-3 rounded-lg border-2 transition font-medium ${groupsForAdd.some(g => g.jid === inst.group_id)
                        ? 'border-[#8CD955] bg-[#8CD955]/25 dark:bg-[#8CD955]/20 text-[#1a4d0d] dark:text-[#8CD955] ring-2 ring-[#8CD955] ring-offset-2 shadow-sm'
                        : 'border-gray-200 dark:border-[#555] text-gray-600 dark:text-gray-300 hover:border-[#8CD955]/50 hover:bg-gray-50 dark:hover:bg-[#404040]'
                      }`}
                  >
                    {inst.group_subject}
                  </button>
                ))}
              </div>
              <div className="mt-3">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Modo de rodízio</label>
                <select
                  value={distributionGpMode}
                  onChange={e => setDistributionGpMode(e.target.value as DistributionMode)}
                  className="w-full px-4 py-2 border border-gray-200 dark:border-[#555] rounded-lg text-gray-700 dark:text-white bg-white dark:bg-[#333]"
                >
                  <option value="sequential">Sequencial</option>
                  <option value="random">Aleatório</option>
                </select>
              </div>
            </div>
          )}

          {/* Seleção de Lista Personalizada */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Lista de Contatos (Opcional)
            </label>
            <select
              value={selectedListId}
              onChange={e => {
                setSelectedListId(e.target.value);
                // Se selecionar uma lista, atualiza o limite para o tamanho da lista por padrão
                if (e.target.value) {
                  const list = customLists.find(l => l.id === e.target.value);
                  if (list && list.contact_ids) {
                    setAddLimit(list.contact_ids.length);
                  }
                }
              }}
              className="w-full px-4 py-3 border-2 border-gray-200 dark:border-[#555] rounded-lg focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] text-gray-700 dark:text-white bg-white dark:bg-[#333]"
            >
              <option value="">Todos os contatos disponíveis</option>
              {customLists.map(list => (
                <option key={list.id} value={list.id}>
                  {list.name} ({list.contact_ids?.length || 0} contatos)
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Selecione uma lista para adicionar apenas os contatos dela.
            </p>
          </div>

          {/* Quantidade de Leads */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Quantidade de Leads
            </label>
            <input
              type="number"
              value={addLimit}
              onChange={e => setAddLimit(Number(e.target.value))}
              placeholder="Digite uma Quantidade*"
              min="1"
              className="w-full px-4 py-3 border-2 border-gray-200 dark:border-[#555] rounded-lg focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] text-gray-700 dark:text-white bg-white dark:bg-[#333] placeholder:text-gray-400 dark:placeholder-gray-500"
            />
          </div>

          {/* Atraso entre inclusões */}
          <div data-tour-id="adicao-tempo-random">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Atraso entre inclusões
            </label>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="number"
                value={addDelayValue}
                onChange={e => setAddDelayValue(Number(e.target.value))}
                placeholder="Digite uma Quantidade*"
                min="0"
                disabled={addRandom}
                className="flex-1 min-w-0 px-4 py-3 border-2 border-gray-200 dark:border-[#555] rounded-lg focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] disabled:opacity-50 text-gray-700 dark:text-white bg-white dark:bg-[#333] placeholder:text-gray-400 dark:placeholder-gray-500"
              />
              <select
                value={addDelayUnit}
                onChange={e => setAddDelayUnit(e.target.value as DelayUnit)}
                disabled={addRandom}
                className="w-full sm:w-auto px-4 py-3 border-2 border-gray-200 dark:border-[#555] rounded-lg focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] disabled:opacity-50 text-gray-700 dark:text-white bg-white dark:bg-[#333]"
              >
                <option value="seconds">Segundos</option>
                <option value="minutes">Minutos</option>
              </select>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
                <input
                  type="checkbox"
                  id="randomTime"
                  checked={addRandom}
                  onChange={e => setAddRandom(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-[#8CD955]/30 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#8CD955]"></div>
              </label>
              <label htmlFor="randomTime" className="text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer">
                Random Time
              </label>
            </div>
            {addRandom && (
              <div className="mt-3 flex gap-2 items-center">
                <input
                  type="number"
                  value={randomMinSeconds}
                  onChange={e => setRandomMinSeconds(Number(e.target.value))}
                  className="w-24 px-3 py-2 border border-gray-200 dark:border-[#555] rounded-lg text-sm text-gray-700 dark:text-white bg-white dark:bg-[#333]"
                  min="0"
                />
                <span className="text-gray-600 dark:text-gray-400">a</span>
                <input
                  type="number"
                  value={randomMaxSeconds}
                  onChange={e => setRandomMaxSeconds(Number(e.target.value))}
                  className="w-24 px-3 py-2 border border-gray-200 dark:border-[#555] rounded-lg text-sm text-gray-700 dark:text-white bg-white dark:bg-[#333]"
                  min="0"
                />
                <span className="text-xs text-gray-500 dark:text-gray-400">segundos</span>
              </div>
            )}
            {addRandom && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                Dica: 550s=9min10s e 950s=15min50s. Defina 0 para sem espera (não recomendado).
              </p>
            )}
          </div>

          {/* Botões de ação */}
          <div className="flex flex-col sm:flex-row gap-4 pt-4" data-tour-id="adicao-controle-campanha">
            <button
              onClick={handleAddToGroup}
              disabled={addingToGroup || (!multiInstancesMode ? !selectedInstance : instancesForAdd.length === 0) || (!multiGroupsMode ? !selectedGroupJid : groupsForAdd.length === 0)}
              className="w-full sm:flex-1 py-3 bg-[#8CD955] hover:bg-[#7BC84A] text-white rounded-lg font-medium transition disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <Plus className="w-5 h-5" />
              <span className="whitespace-nowrap">{addingToGroup ? 'Iniciando...' : 'Iniciar Inclusão'}</span>
            </button>
            <button
              onClick={() => setAddPaused(!addPaused)}
              disabled={!addingToGroup}
              className="w-full sm:w-auto px-6 py-3 border-2 border-[#8CD955] text-[#8CD955] dark:text-[#8CD955] rounded-lg font-medium hover:bg-[#8CD955]/10 dark:hover:bg-[#8CD955]/20 transition disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {addPaused ? (
                <>
                  <Play className="w-5 h-5" />
                  <span className="whitespace-nowrap">Retomar Inclusão</span>
                </>
              ) : (
                <>
                  <Pause className="w-5 h-5" />
                  <span className="whitespace-nowrap">Pausar Inclusão</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Tabela de Campanhas */}
        <div ref={activeCampaignsRef} data-tour-id="adicao-campanhas-ativas">
          <div className="bg-gray-100 dark:bg-[#2a2a2a] rounded-xl shadow-md p-6 border border-gray-200 dark:border-[#404040]">
            <h2 className="text-lg font-semibold text-gray-800 dark:text-white mb-4">Campanhas</h2>
            <CampaignsTable
              campaigns={campaigns}
              instances={instances}
              onPause={async (campaignId: string) => {
                try {
                  const response = await fetch(`/api/campaigns/${campaignId}`, {
                    method: 'PATCH',
                    headers: {
                      'Content-Type': 'application/json',
                      'X-User-Id': userId || '',
                    },
                    body: JSON.stringify({ status: 'paused' }),
                  });
                  const data = await response.json();
                  if (data.success) {
                    showToast('Campanha pausada com sucesso', 'success');
                    loadInitialData();
                  } else {
                    showToast(data.message || 'Erro ao pausar campanha', 'error');
                  }
                } catch (error) {
                  showToast('Erro ao pausar campanha', 'error');
                }
              }}
              onResume={async (campaignId: string) => {
                try {
                  const response = await fetch(`/api/campaigns/${campaignId}`, {
                    method: 'PATCH',
                    headers: {
                      'Content-Type': 'application/json',
                      'X-User-Id': userId || '',
                    },
                    body: JSON.stringify({ status: 'running' }),
                  });
                  const data = await response.json();
                  if (data.success) {
                    showToast('Campanha retomada com sucesso', 'success');
                    // Recarrega dados imediatamente e depois novamente após um delay
                    await loadInitialData();
                    setTimeout(async () => {
                      await loadInitialData();
                    }, 1000);
                  } else {
                    showToast(data.message || 'Erro ao retomar campanha', 'error');
                  }
                } catch (error) {
                  showToast('Erro ao retomar campanha', 'error');
                }
              }}
              onDelete={async (campaignId: string) => {
                if (!confirm('Tem certeza que deseja excluir esta campanha? O processamento continuará em background, mas a campanha será removida da lista.')) return;
                if (!userId) {
                  showToast('Sessão inválida', 'error');
                  return;
                }
                try {
                  const response = await fetch(`/api/campaigns/${campaignId}`, {
                    method: 'DELETE',
                    headers: {
                      'X-User-Id': userId,
                    },
                  });
                  const data = await response.json();
                  if (data.success) {
                    showToast('Campanha excluída com sucesso. O processamento continuará em background.', 'success');
                    await loadInitialData();
                    setTimeout(async () => {
                      await loadInitialData();
                    }, 1000);
                  } else {
                    showToast(data.message || 'Erro ao excluir campanha', 'error');
                    await loadInitialData();
                  }
                } catch (error) {
                  showToast('Erro ao excluir campanha', 'error');
                  await loadInitialData();
                }
              }}
              onUpdateCampaign={async (campaignId: string, updates: any) => {
                if (!userId) {
                  throw new Error('Sessão inválida');
                }
                const response = await fetch(`/api/campaigns/${campaignId}`, {
                  method: 'PATCH',
                  headers: {
                    'Content-Type': 'application/json',
                    'X-User-Id': userId,
                  },
                  body: JSON.stringify(updates),
                });
                const data = await response.json();
                if (!data.success) {
                  throw new Error(data.message || 'Erro ao atualizar campanha');
                }
                await loadInitialData();
              }}
              onCheckInstances={async (campaignId: string) => {
                if (!userId) return null;

                const response = await fetch(`/api/campaigns/${campaignId}/check-instances`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'X-User-Id': userId,
                  },
                });
                const data = await response.json();
                return data;
              }}
              onReactivate={async (campaignId: string) => {
                if (!userId) {
                  throw new Error('Sessão inválida');
                }
                const response = await fetch(`/api/campaigns/${campaignId}`, {
                  method: 'PATCH',
                  headers: {
                    'Content-Type': 'application/json',
                    'X-User-Id': userId,
                  },
                  body: JSON.stringify({ status: 'running' }),
                });
                const data = await response.json();
                if (!data.success) {
                  throw new Error(data.message || 'Erro ao reativar campanha');
                }
                // Recarrega dados imediatamente e depois novamente após um delay
                await loadInitialData();
                setTimeout(async () => {
                  await loadInitialData();
                }, 1000);
              }}
              showToast={showToast}
            />
          </div>
        </div>
      </div>
    </Layout>
  );
}

export default AddToGroupPage;

