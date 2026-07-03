'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { withTenantSlug } from '@/lib/utils/tenant-href';
import { useRequireAuth } from '@/utils/useRequireAuth';
import Layout from '@/components/Layout';
import { useDashboardData, Contact, DbGroup, Campaign } from '@/hooks/useDashboardData';
import CampaignsTable from '@/components/Campaigns/CampaignsTable';
import {
  Plus,
  Pause,
  Play,
  CheckCircle2,
  AlertCircle,
  Info,
  X,
  Menu,
  Search,
  ChevronDown,
  AlertTriangle,
} from 'lucide-react';
import { useSidebar } from '@/contexts/SidebarContext';
import { supabase } from '@/lib/supabase';

type DelayUnit = 'seconds' | 'minutes';
type DistributionMode = 'sequential' | 'random';


type GroupForAdd = {
  jid: string;
  subject: string;
};

type SearchableOption = {
  value: string;
  label: string;
  description?: string;
};

function SearchableSelect({
  value,
  onValueChange,
  options,
  placeholder,
  emptyLabel,
  disabled,
  searchPlaceholder,
  isLoading,
}: {
  value: string;
  onValueChange: (v: string, meta?: SearchableOption) => void;
  options: SearchableOption[];
  placeholder: string;
  emptyLabel?: string;
  disabled?: boolean;
  searchPlaceholder?: string;
  isLoading?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const fn = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, [open]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return options;
    return options.filter(
      o =>
        o.label.toLowerCase().includes(s) ||
        (o.description && o.description.toLowerCase().includes(s)) ||
        o.value.toLowerCase().includes(s)
    );
  }, [options, q]);

  const selected = options.find(o => o.value === value);

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        disabled={disabled || isLoading}
        onClick={() => {
          if (disabled || isLoading) return;
          setOpen(prev => {
            const next = !prev;
            if (next) setQ('');
            return next;
          });
        }}
        className="w-full px-4 py-3 border-2 border-gray-200 dark:border-[#555] rounded-lg focus:ring-2 focus:ring-[#E86A24] focus:border-[#E86A24] disabled:opacity-50 text-gray-700 dark:text-white bg-white dark:bg-[#333] flex items-center justify-between gap-2 text-left min-h-[52px]"
      >
        <span className={`truncate ${selected ? '' : 'text-gray-400 dark:text-gray-500'}`}>
          {isLoading ? 'Carregando…' : selected ? selected.label : placeholder}
        </span>
        <ChevronDown className={`w-5 h-5 shrink-0 opacity-60 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border-2 border-gray-200 dark:border-[#555] bg-white dark:bg-[#333] shadow-xl overflow-hidden">
          <div className="p-2 border-b border-gray-200 dark:border-[#555]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="search"
                autoComplete="off"
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder={searchPlaceholder || 'Pesquisar…'}
                className="w-full rounded-md border border-gray-200 dark:border-[#555] bg-gray-50 dark:bg-[#2a2a2a] py-2 pl-9 pr-3 text-sm text-gray-800 dark:text-gray-100 placeholder:text-gray-400 focus:border-[#E86A24] focus:outline-none focus:ring-1 focus:ring-[#E86A24]"
              />
            </div>
          </div>
          <ul className="max-h-56 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">{emptyLabel || 'Nenhum resultado'}</li>
            ) : (
              filtered.map(o => (
                <li key={o.value}>
                  <button
                    type="button"
                    className={`w-full px-4 py-2.5 text-left text-sm transition hover:bg-[#E86A24]/15 dark:hover:bg-[#E86A24]/10 ${
                      o.value === value ? 'bg-[#E86A24]/25 font-medium text-[#1a4d0d] dark:text-[#E86A24]' : 'text-gray-700 dark:text-gray-200'
                    }`}
                    onClick={() => {
                      onValueChange(o.value, o);
                      setOpen(false);
                      setQ('');
                    }}
                  >
                    <span className="block truncate">{o.label}</span>
                    {o.description && o.description !== o.label && (
                      <span className="block truncate text-xs text-gray-500 dark:text-gray-400 mt-0.5">{o.description}</span>
                    )}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

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
  const [randomMinSeconds, setRandomMinSeconds] = useState<number>(5);
  const [randomMaxSeconds, setRandomMaxSeconds] = useState<number>(300);
  const [addingToGroup, setAddingToGroup] = useState<boolean>(false);
  const [addPaused, setAddPaused] = useState<boolean>(false);
  const [customLists, setCustomLists] = useState<any[]>([]);
  const [selectedListId, setSelectedListId] = useState<string>('');
  const [loadingLists, setLoadingLists] = useState(false);
  const [loadingDbGroups, setLoadingDbGroups] = useState(false);
  const [instanceMultiSearch, setInstanceMultiSearch] = useState('');
  const [groupsMultiSearch, setGroupsMultiSearch] = useState('');

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

  const instanceSelectOptions = useMemo(
    () =>
      instances.map(inst => ({
        value: inst.instance_name,
        label: `${inst.instance_name} (${inst.status})`,
        description: inst.instance_name,
      })),
    [instances]
  );

  const groupSelectOptions = useMemo(
    () =>
      dbGroups.map(g => ({
        value: g.group_id,
        label: g.group_subject?.trim() ? g.group_subject : g.group_id,
        description: g.group_id,
      })),
    [dbGroups]
  );

  const filteredInstancesMulti = useMemo(() => {
    const s = instanceMultiSearch.trim().toLowerCase();
    if (!s) return instances;
    return instances.filter(
      inst =>
        inst.instance_name.toLowerCase().includes(s) || String(inst.status || '').toLowerCase().includes(s)
    );
  }, [instances, instanceMultiSearch]);

  const filteredGroupsMulti = useMemo(() => {
    const s = groupsMultiSearch.trim().toLowerCase();
    if (!s) return dbGroups;
    return dbGroups.filter(
      g =>
        (g.group_subject || '').toLowerCase().includes(s) || (g.group_id || '').toLowerCase().includes(s)
    );
  }, [dbGroups, groupsMultiSearch]);

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
    if (!userId) {
      setDbGroups([]);
      return;
    }

    if (multiInstancesMode) {
      if (instancesForAdd.length === 0) {
        setDbGroups([]);
        return;
      }
      setLoadingDbGroups(true);
      try {
        const { data, error } = await supabase
          .from('whatsapp_groups')
          .select('group_id, group_subject, instance_name')
          .eq('user_id', userId)
          .in('instance_name', instancesForAdd);

        if (error) {
          addLog(`Erro ao carregar grupos: ${error.message}`, 'error');
          setDbGroups([]);
          return;
        }

        const rows = data || [];
        const byGroup = new Map<string, Set<string>>();
        for (const row of rows) {
          const gid = row.group_id as string;
          if (!byGroup.has(gid)) byGroup.set(gid, new Set());
          byGroup.get(gid)!.add(row.instance_name as string);
        }

        const intersected: DbGroup[] = [];
        for (const [gid, instSet] of byGroup) {
          if (instancesForAdd.every(inst => instSet.has(inst))) {
            const row = rows.find(r => r.group_id === gid);
            intersected.push({
              group_id: gid,
              group_subject: row?.group_subject || gid,
            });
          }
        }
        intersected.sort((a, b) => (a.group_subject || '').localeCompare(b.group_subject || '', 'pt-BR'));
        setDbGroups(intersected);
      } finally {
        setLoadingDbGroups(false);
      }
      return;
    }

    if (!selectedInstance) {
      setDbGroups([]);
      return;
    }

    setLoadingDbGroups(true);
    try {
      const { data, error } = await supabase
        .from('whatsapp_groups')
        .select('group_id, group_subject')
        .eq('user_id', userId)
        .eq('instance_name', selectedInstance)
        .order('group_subject', { ascending: true });

      if (error) {
        addLog(`Erro ao carregar grupos: ${error.message}`, 'error');
        setDbGroups([]);
      } else {
        setDbGroups((data || []) as DbGroup[]);
      }
    } finally {
      setLoadingDbGroups(false);
    }
  }, [selectedInstance, userId, addLog, multiInstancesMode, instancesForAdd]);

  useEffect(() => {
    loadDbGroups();
  }, [loadDbGroups]);

  useEffect(() => {
    if (!selectedGroupJid) return;
    if (!dbGroups.some(g => g.group_id === selectedGroupJid)) {
      setSelectedGroupJid('');
      setSelectedGroupSubject('');
    }
  }, [dbGroups, selectedGroupJid]);

  useEffect(() => {
    setGroupsForAdd(prev => prev.filter(g => dbGroups.some(d => d.group_id === g.jid)));
  }, [dbGroups]);

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
    window.location.href = withTenantSlug('/login');
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
            className={`flex items-center gap-3 min-w-[320px] px-6 py-4 rounded-lg shadow-lg text-white ${toast.type === 'success' ? 'bg-[#E86A24]' : toast.type === 'error' ? 'bg-red-600' : 'bg-amber-500'
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
            <SearchableSelect
              value={selectedInstance}
              disabled={multiInstancesMode}
              placeholder="Selecione uma instância"
              searchPlaceholder="Pesquisar por nome ou status…"
              emptyLabel={instances.length === 0 ? 'Nenhuma instância disponível' : 'Nenhuma instância encontrada'}
              options={instanceSelectOptions}
              onValueChange={v => setSelectedInstance(v)}
            />
            <div className="mt-3 flex items-center gap-3">
              <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
                <input
                  type="checkbox"
                  id="multiInstances"
                  checked={multiInstancesMode}
                  onChange={e => {
                    const on = e.target.checked;
                    setMultiInstancesMode(on);
                    setInstanceMultiSearch('');
                    if (on) setSelectedInstance('');
                  }}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-[#E86A24]/30 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#E86A24]"></div>
              </label>
              <label htmlFor="multiInstances" className="text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer">
                Usar múltiplas instâncias em rodízio para adicionar ao grupo
              </label>
            </div>
          </div>

          {/* Múltiplas instâncias */}
          {multiInstancesMode && (
            <div className="border border-blue-200 dark:border-blue-800/50 rounded-lg p-4 bg-blue-50/30 dark:bg-blue-900/20" data-tour-id="adicao-multiplas-instancias">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                Selecionar instâncias:
              </label>
              <div className="relative mb-3">
                <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="search"
                  autoComplete="off"
                  value={instanceMultiSearch}
                  onChange={e => setInstanceMultiSearch(e.target.value)}
                  placeholder="Pesquisar instâncias…"
                  className="w-full rounded-lg border-2 border-gray-200 dark:border-[#555] bg-white dark:bg-[#333] py-2.5 pl-10 pr-3 text-sm text-gray-800 dark:text-gray-100 placeholder:text-gray-400 focus:border-[#E86A24] focus:outline-none focus:ring-2 focus:ring-[#E86A24]/30"
                />
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 max-h-64 overflow-y-auto pr-1">
                {filteredInstancesMulti.length === 0 ? (
                  <p className="col-span-full text-sm text-gray-500 dark:text-gray-400 py-4 text-center">
                    Nenhuma instância corresponde à pesquisa.
                  </p>
                ) : (
                  filteredInstancesMulti.map(inst => (
                    <button
                      key={inst.id || inst.instance_name}
                      type="button"
                      onClick={() => toggleInstanceForAdd(inst.instance_name)}
                      className={`px-4 py-3 rounded-lg border-2 transition font-medium text-left ${instancesForAdd.includes(inst.instance_name)
                          ? 'border-[#E86A24] bg-[#E86A24]/25 dark:bg-[#E86A24]/20 text-[#1a4d0d] dark:text-[#E86A24] ring-2 ring-[#E86A24] ring-offset-2 shadow-sm'
                          : 'border-gray-200 dark:border-[#555] text-gray-600 dark:text-gray-300 hover:border-[#E86A24]/50 hover:bg-gray-50 dark:hover:bg-[#404040]'
                        }`}
                    >
                      <span className="block truncate">{inst.instance_name}</span>
                      <span className="block truncate text-xs opacity-70 mt-0.5">{inst.status}</span>
                    </button>
                  ))
                )}
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
          <div className="space-y-3">
            <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50/90 dark:border-amber-700/60 dark:bg-amber-950/40 px-4 py-3 text-sm text-amber-950 dark:text-amber-100">
              <AlertTriangle className="w-5 h-5 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" aria-hidden />
              <div>
                <p className="font-semibold text-amber-900 dark:text-amber-50">Requisitos do WhatsApp</p>
                <p className="mt-1 leading-relaxed text-amber-900/90 dark:text-amber-100/90">
                  Cada instância usada precisa já estar <strong className="font-semibold">dentro do grupo</strong> e ser{' '}
                  <strong className="font-semibold">administradora</strong> dele. Caso contrário, a API pode falhar ao adicionar participantes.
                </p>
                {multiInstancesMode && instancesForAdd.length > 1 && (
                  <p className="mt-2 text-xs opacity-90">
                    Com várias instâncias, só aparecem grupos que existem no banco para <strong className="font-semibold">todas</strong> as instâncias marcadas (mesmo grupo sincronizado em cada uma).
                  </p>
                )}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Grupo salvo no banco:
              </label>
              {multiInstancesMode && instancesForAdd.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400 py-3 px-4 rounded-lg border-2 border-dashed border-gray-300 dark:border-[#555] bg-gray-50 dark:bg-[#2a2a2a]">
                  Marque ao menos uma instância acima para carregar os grupos compatíveis.
                </p>
              ) : (
                <SearchableSelect
                  value={selectedGroupJid}
                  disabled={multiGroupsMode}
                  isLoading={loadingDbGroups}
                  placeholder="Selecione um grupo"
                  searchPlaceholder="Pesquisar por nome ou ID do grupo…"
                  emptyLabel={
                    loadingDbGroups
                      ? 'Carregando grupos…'
                      : dbGroups.length === 0
                        ? multiInstancesMode
                          ? 'Nenhum grupo em comum para as instâncias selecionadas'
                          : 'Nenhum grupo salvo para esta instância'
                        : 'Nenhum grupo encontrado'
                  }
                  options={groupSelectOptions}
                  onValueChange={(v, meta) => {
                    setSelectedGroupJid(v);
                    const subject =
                      dbGroups.find(g => g.group_id === v)?.group_subject ||
                      meta?.label ||
                      '';
                    setSelectedGroupSubject(subject);
                  }}
                />
              )}
            </div>
            <div className="mt-1 flex items-center gap-3">
              <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
                <input
                  type="checkbox"
                  id="multiGroups"
                  checked={multiGroupsMode}
                  onChange={e => {
                    setMultiGroupsMode(e.target.checked);
                    setGroupsMultiSearch('');
                  }}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-[#E86A24]/30 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#E86A24]"></div>
              </label>
              <label htmlFor="multiGroups" className="text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer">
                Adicionar mais de um grupo
              </label>
            </div>
          </div>


          {multiGroupsMode && (
            <div className="border border-blue-200 dark:border-blue-800/50 rounded-lg p-4 bg-blue-50/30 dark:bg-blue-900/20" data-tour-id="adicao-multiplas-grupos">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                Selecionar grupos:
              </label>
              <div className="relative mb-3">
                <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="search"
                  autoComplete="off"
                  value={groupsMultiSearch}
                  onChange={e => setGroupsMultiSearch(e.target.value)}
                  placeholder="Pesquisar grupos…"
                  disabled={loadingDbGroups || dbGroups.length === 0}
                  className="w-full rounded-lg border-2 border-gray-200 dark:border-[#555] bg-white dark:bg-[#333] py-2.5 pl-10 pr-3 text-sm text-gray-800 dark:text-gray-100 placeholder:text-gray-400 focus:border-[#E86A24] focus:outline-none focus:ring-2 focus:ring-[#E86A24]/30 disabled:opacity-50"
                />
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 max-h-64 overflow-y-auto pr-1">
                {loadingDbGroups ? (
                  <p className="col-span-full text-sm text-gray-500 dark:text-gray-400 py-4 text-center">Carregando grupos…</p>
                ) : filteredGroupsMulti.length === 0 ? (
                  <p className="col-span-full text-sm text-gray-500 dark:text-gray-400 py-4 text-center">
                    {dbGroups.length === 0 ? 'Nenhum grupo disponível para seleção.' : 'Nenhum grupo corresponde à pesquisa.'}
                  </p>
                ) : (
                  filteredGroupsMulti.map(g => (
                    <button
                      key={g.group_id}
                      type="button"
                      onClick={() =>
                        toggleGroupForAdd({
                          jid: g.group_id,
                          subject: g.group_subject || g.group_id,
                        })
                      }
                      className={`px-4 py-3 rounded-lg border-2 transition font-medium text-left ${groupsForAdd.some(x => x.jid === g.group_id)
                          ? 'border-[#E86A24] bg-[#E86A24]/25 dark:bg-[#E86A24]/20 text-[#1a4d0d] dark:text-[#E86A24] ring-2 ring-[#E86A24] ring-offset-2 shadow-sm'
                          : 'border-gray-200 dark:border-[#555] text-gray-600 dark:text-gray-300 hover:border-[#E86A24]/50 hover:bg-gray-50 dark:hover:bg-[#404040]'
                        }`}
                    >
                      <span className="block truncate">{g.group_subject || g.group_id}</span>
                      <span className="block truncate text-xs opacity-70 mt-0.5 font-mono">{g.group_id}</span>
                    </button>
                  ))
                )}
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
              className="w-full px-4 py-3 border-2 border-gray-200 dark:border-[#555] rounded-lg focus:ring-2 focus:ring-[#E86A24] focus:border-[#E86A24] text-gray-700 dark:text-white bg-white dark:bg-[#333]"
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
              className="w-full px-4 py-3 border-2 border-gray-200 dark:border-[#555] rounded-lg focus:ring-2 focus:ring-[#E86A24] focus:border-[#E86A24] text-gray-700 dark:text-white bg-white dark:bg-[#333] placeholder:text-gray-400 dark:placeholder-gray-500"
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
                className="flex-1 min-w-0 px-4 py-3 border-2 border-gray-200 dark:border-[#555] rounded-lg focus:ring-2 focus:ring-[#E86A24] focus:border-[#E86A24] disabled:opacity-50 text-gray-700 dark:text-white bg-white dark:bg-[#333] placeholder:text-gray-400 dark:placeholder-gray-500"
              />
              <select
                value={addDelayUnit}
                onChange={e => setAddDelayUnit(e.target.value as DelayUnit)}
                disabled={addRandom}
                className="w-full sm:w-auto px-4 py-3 border-2 border-gray-200 dark:border-[#555] rounded-lg focus:ring-2 focus:ring-[#E86A24] focus:border-[#E86A24] disabled:opacity-50 text-gray-700 dark:text-white bg-white dark:bg-[#333]"
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
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-[#E86A24]/30 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#E86A24]"></div>
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
                Delay aleatório entre cada disparo. Ex: 5s a 300s (5min). Cada envio terá um tempo diferente dentro desse intervalo.
              </p>
            )}
          </div>

          {/* Botões de ação */}
          <div className="flex flex-col sm:flex-row gap-4 pt-4" data-tour-id="adicao-controle-campanha">
            <button
              onClick={handleAddToGroup}
              disabled={addingToGroup || (!multiInstancesMode ? !selectedInstance : instancesForAdd.length === 0) || (!multiGroupsMode ? !selectedGroupJid : groupsForAdd.length === 0)}
              className="w-full sm:flex-1 py-3 bg-[#E86A24] hover:bg-[#D95E1B] text-white rounded-lg font-medium transition disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <Plus className="w-5 h-5" />
              <span className="whitespace-nowrap">{addingToGroup ? 'Iniciando...' : 'Iniciar Inclusão'}</span>
            </button>
            <button
              onClick={() => setAddPaused(!addPaused)}
              disabled={!addingToGroup}
              className="w-full sm:w-auto px-6 py-3 border-2 border-[#E86A24] text-[#E86A24] dark:text-[#E86A24] rounded-lg font-medium hover:bg-[#E86A24]/10 dark:hover:bg-[#E86A24]/20 transition disabled:opacity-50 flex items-center justify-center gap-2"
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

