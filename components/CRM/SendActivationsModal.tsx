'use client';

import React, { useState, useEffect, useRef } from 'react';
import { X, Search, Check, Send, Loader2, Plus, Shuffle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { deduplicateGroupsById } from '@/lib/utils/group-utils';
import { postGroupFetchAndResolve } from '@/lib/utils/group-fetch-client';
import SendMessageChoiceModal from './SendMessageChoiceModal';
import ScheduleMessageModal from './ScheduleMessageModal';
import { selectInstancesForActivationSend } from '@/lib/crm/select-instances-for-activation-send';
import { useToast } from '@/hooks/useToast';
import ToastContainer from '@/components/Toast/ToastContainer';
import { sanitizeMassSendErrorMessage } from '@/lib/utils/activation-send-errors';
import { getWlSlugHeadersForApi } from '@/lib/utils/tenant-href';

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
  /** Quando true, pula o modal de escolha e abre direto em modo campanha em massa */
  defaultToMassSend?: boolean;
  /** Repetir campanha: pré-seleciona grupos; instância(s) vêm do seed salvo, exceto se `reselectInstances`. */
  repeatCampaignSeed?: {
    instanceName?: string;
    instanceNames?: string[];
    groupIds: string[];
    /** true = não pré-preenche instância; usuário escolhe antes de enviar (repetir com outra instância). */
    reselectInstances?: boolean;
  } | null;
  /** Após criar campanha em massa (ou reutilizar job existente), atualiza lista na aba Campanhas */
  onMassSendComplete?: () => void;
}

const SendActivationsModal: React.FC<SendActivationsModalProps> = ({
  isOpen,
  onClose,
  messageId,
  messageTitle,
  userId,
  defaultToMassSend = false,
  repeatCampaignSeed = null,
  onMassSendComplete,
}) => {
  const [loading, setLoading] = useState(false);
  const [groups, setGroups] = useState<Group[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [instanceSearchQuery, setInstanceSearchQuery] = useState('');
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [instances, setInstances] = useState<any[]>([]);
  /** Uma ou mais instâncias: rotação por grupo (1º grupo → 1ª inst., 2º → 2ª, …). */
  const [selectedInstanceNames, setSelectedInstanceNames] = useState<Set<string>>(new Set());
  const [fetchingAll, setFetchingAll] = useState(false);
  const [savingAllGroups, setSavingAllGroups] = useState(false);
  const [showChoiceModal, setShowChoiceModal] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  /** Inicializa a partir da prop para o primeiro paint já enfileirar em massa (evita fluxo síncrono ≤10 grupos antes do effect). */
  const [forceMassSend, setForceMassSend] = useState(() => defaultToMassSend);
  /** Segundos entre cada grupo na fila (campanha). 0 = API/worker usam padrão 1 s. */
  const [massSendInterGroupDelaySec, setMassSendInterGroupDelaySec] = useState(0);
  /** Evita duplo clique antes do React aplicar sending=true (segundo job / envio duplicado). */
  const sendLockedRef = useRef(false);
  /** Aplica seleção do seed uma vez por abertura (não sobrescreve se o usuário trocar instância). */
  const repeatSeedAppliedRef = useRef(false);

  const { toasts, showToast, removeToast } = useToast();

  // Carrega grupos do banco (whatsapp_groups) filtrados pela instância selecionada
  const fetchDbGroups = async (names?: string[] | null) => {
    const list = names ?? Array.from(selectedInstanceNames).map((n) => n.trim()).filter(Boolean);
    if (list.length === 0) {
      setGroups([]);
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('whatsapp_groups')
        .select('group_id, group_subject')
        .eq('user_id', userId)
        .in('instance_name', list)
        .order('group_subject', { ascending: true });

      if (error) throw error;

      const withGroupId = (data || []).map((g: { group_id: string; group_subject: string | null }) => ({
        group_id: g.group_id,
        subject: g.group_subject,
      }));
      const deduped = deduplicateGroupsById(withGroupId);
      const formattedGroups: Group[] = deduped.map((d) => ({ id: d.group_id, subject: d.subject || '' }));
      const byId = new Map<string, Group>();
      for (const g of formattedGroups) {
        if (!byId.has(g.id)) byId.set(g.id, g);
      }
      setGroups(Array.from(byId.values()).sort((a, b) => (a.subject || '').localeCompare(b.subject || '')));
    } catch (error) {
      console.error('Erro ao buscar grupos do banco:', error);
      setGroups([]);
    } finally {
      setLoading(false);
    }
  };

  // Carrega grupos da Evolution (fetchAllGroups) com retry em segundo plano
  const fetchEvolutionGroups = async () => {
    const list = Array.from(selectedInstanceNames).filter(Boolean);
    if (list.length === 0) {
      showToast('Selecione pelo menos uma instância', 'error');
      return;
    }
    setFetchingAll(true);
    try {
      let merged = 0;
      let lastMsg = '';
      for (const instName of list) {
        const { groups: evoRaw, message } = await postGroupFetchAndResolve(userId, instName);
        lastMsg = message || lastMsg;
        const evoGroups = evoRaw.map((g) => ({ id: g.id, subject: g.subject || '' }));
        merged += evoGroups.length;
        setGroups((prev) => {
          const byId = new Map<string, Group>(prev.map((p) => [p.id, p]));
          evoGroups.forEach((g: Group) => {
            if (!byId.has(g.id)) byId.set(g.id, g);
          });
          return Array.from(byId.values()).sort((a, b) => a.subject.localeCompare(b.subject));
        });
      }
      showToast(lastMsg || `${merged} grupos sincronizados (${list.length} instância(s))!`, 'success');
    } catch (error: unknown) {
      showToast(error instanceof Error ? error.message : 'Erro ao buscar grupos da Evolution. Tente novamente.', 'error');
    } finally {
      setFetchingAll(false);
    }
  };

  const handleSaveAllGroups = async () => {
    const list = Array.from(selectedInstanceNames).filter(Boolean);
    if (list.length === 0 || groups.length === 0) {
      showToast('Extraia os grupos primeiro', 'error');
      return;
    }
    setSavingAllGroups(true);
    try {
      const payload = groups.map((g) => ({ id: g.id, subject: g.subject || null }));
      let totalIns = 0;
      let totalUp = 0;
      for (const instanceName of list) {
        const r = await fetch('/api/groups/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
          body: JSON.stringify({ instanceName, groups: payload }),
        });
        const data = await r.json();
        if (!r.ok || !data.success) {
          showToast(data.error || `Erro ao salvar grupos (${instanceName})`, 'error');
          return;
        }
        const { inserted = 0, updated = 0 } = data.data || {};
        totalIns += inserted;
        totalUp += updated;
      }
      showToast(`${totalIns + totalUp} grupo(s) salvos no banco em ${list.length} instância(s)`, 'success');
      await fetchDbGroups(list);
    } catch {
      showToast('Erro ao salvar todos os grupos', 'error');
    } finally {
      setSavingAllGroups(false);
    }
  };

  // Quando o modal abre: defaultToMassSend pula escolha e força campanha em massa
  useEffect(() => {
    if (isOpen && userId) {
      if (defaultToMassSend) {
        setForceMassSend(true);
        setShowChoiceModal(false);
        setShowScheduleModal(false);
      } else {
        setForceMassSend(false);
        if (!showChoiceModal && !showScheduleModal) {
          setShowChoiceModal(true);
        }
      }
    } else {
      setShowChoiceModal(false);
      setShowScheduleModal(false);
    }
    if (!isOpen) {
      repeatSeedAppliedRef.current = false;
      setInstanceSearchQuery('');
    }
  }, [isOpen, userId, defaultToMassSend]);

  // Carrega instâncias e grupos do banco ao abrir (apenas quando for enviar agora)
  useEffect(() => {
    const init = async () => {
      // 1. Busca instâncias
      try {
        const response = await fetch('/api/instances', {
          headers: { 'X-User-Id': userId, ...getWlSlugHeadersForApi() },
        });
        const data = await response.json();
        if (data.success) {
          const pool = selectInstancesForActivationSend(data.data) as any[];
          setInstances(pool);
          const reselect = repeatCampaignSeed?.reselectInstances === true;
          const seedMulti = (repeatCampaignSeed?.instanceNames || [])
            .map((x) => String(x ?? '').trim())
            .filter(Boolean);
          const seedName = repeatCampaignSeed?.instanceName?.trim();
          const poolNames = new Set(pool.map((i: { instance_name?: string }) => i.instance_name).filter(Boolean));
          if (reselect) {
            setSelectedInstanceNames(new Set());
          } else if (seedMulti.length > 0) {
            const valid = seedMulti.filter((n) => poolNames.has(n));
            setSelectedInstanceNames(new Set(valid.length ? valid : seedMulti));
          } else if (seedName) {
            const found = pool.find((i: { instance_name?: string }) => i.instance_name === seedName);
            setSelectedInstanceNames(new Set([found ? found.instance_name : seedName]));
          } else {
            setSelectedInstanceNames(new Set());
          }
        } else {
          setInstances([]);
          setSelectedInstanceNames(new Set());
          setGroups([]);
        }
      } catch (error) {
        console.error('Erro ao buscar instâncias:', error);
        setGroups([]);
      }
    };

    if (isOpen && userId && !showChoiceModal && !showScheduleModal) {
      init();
    }
  }, [
    isOpen,
    userId,
    showChoiceModal,
    showScheduleModal,
    repeatCampaignSeed?.instanceName,
    repeatCampaignSeed?.instanceNames,
    repeatCampaignSeed?.reselectInstances,
  ]);

  // Repetir campanha: marca os mesmos group_ids após carregar lista do banco (uma vez por abertura)
  useEffect(() => {
    if (!isOpen || !userId || showChoiceModal || showScheduleModal) return;
    if (!repeatCampaignSeed?.groupIds?.length || loading) return;
    if (repeatSeedAppliedRef.current) return;
    const ids = [
      ...new Set(repeatCampaignSeed.groupIds.map((id) => String(id ?? '').trim()).filter(Boolean)),
    ];
    if (ids.length) {
      setSelectedGroups(new Set(ids));
      repeatSeedAppliedRef.current = true;
    }
  }, [isOpen, userId, repeatCampaignSeed, loading, showChoiceModal, showScheduleModal]);

  const selectedInstancesKey = [...selectedInstanceNames].sort().join('\0');

  // Carrega grupos do banco para todas as instâncias marcadas (união, sem duplicar group_id)
  useEffect(() => {
    if (!isOpen || !userId || showChoiceModal || showScheduleModal) return;
    if (selectedInstanceNames.size > 0) {
      fetchDbGroups(Array.from(selectedInstanceNames));
    } else {
      setGroups([]);
    }
  }, [isOpen, userId, selectedInstancesKey, showChoiceModal, showScheduleModal]);

  const filteredInstances = React.useMemo(() => {
    const q = instanceSearchQuery.trim().toLowerCase();
    if (!q) return instances;
    return instances.filter((inst: { instance_name?: string }) =>
      String(inst.instance_name || '').toLowerCase().includes(q)
    );
  }, [instances, instanceSearchQuery]);

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

  const MAX_INTER_GROUP_DELAY_SEC = 985;

  const toggleInstanceName = (name: string) => {
    setSelectedInstanceNames((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const pickRandomInterGroupDelay = () => {
    setMassSendInterGroupDelaySec(Math.floor(Math.random() * MAX_INTER_GROUP_DELAY_SEC) + 1);
  };

  const handleSend = async () => {
    if (sendLockedRef.current || sending) {
      return;
    }

    if (selectedGroups.size === 0) {
      showToast('Selecione pelo menos um grupo', 'error');
      return;
    }

    if (selectedInstanceNames.size === 0) {
      showToast('Selecione pelo menos uma instância', 'error');
      return;
    }
    const instanceNamesPayload = Array.from(selectedInstanceNames);

    sendLockedRef.current = true;
    setSending(true);
    try {
      // Timeout generoso: para mass send a resposta é 202 imediato; para sync direto até ~5 grupos.
      const clientTimeoutMs = 60_000;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
        console.warn(`⏱️ [SEND] Timeout de ${clientTimeoutMs}ms atingido ao enviar mensagens`);
      }, clientTimeoutMs);

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
            instanceNames: instanceNamesPayload,
            ...(forceMassSend && { forceMassSend: true }),
            ...((forceMassSend || selectedGroups.size > 10) &&
              massSendInterGroupDelaySec > 0 && { interGroupDelaySec: massSendInterGroupDelaySec }),
          }),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
      } catch (fetchError: any) {
        clearTimeout(timeoutId);
        
        // Se foi abortado por timeout, relança com mensagem específica
        if (fetchError.name === 'AbortError' || controller.signal.aborted) {
          throw new Error(
            'Timeout: a requisição demorou mais que o limite. Reduza grupos, pausa entre disparos ou tente de novo.'
          );
        }
        
        // Outros erros de rede
        throw new Error(fetchError.message || 'Erro de conexão');
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

      // Disparo em massa: API usa 202, mas alguns ambientes normalizam para 200 — confiar em `mass_send`, não só no status.
      if (data.mass_send === true && response.ok) {
        showToast(
          data.message ||
            (data.reused_existing_job
              ? 'Já existe campanha ativa para esta mensagem; acompanhe o job em Campanhas de disparo.'
              : 'Campanha de disparo em massa criada. O envio continuará em segundo plano. Acompanhe em Ativações > Campanhas de disparo.'),
          data.reused_existing_job ? 'info' : 'success'
        );
        onMassSendComplete?.();
        onClose();
        return;
      }

      // Envio síncrono (poucos grupos): formato successResponse com data.success / data.failed
      const sync = data.data;
      if (
        data.success &&
        sync &&
        typeof sync === 'object' &&
        typeof sync.success === 'number'
      ) {
        const okCount = sync.success;
        const failCount = typeof sync.failed === 'number' ? sync.failed : 0;
        const successMsg =
          okCount > 0
            ? `Mensagem enviada com sucesso para ${okCount} grupo(s)!`
            : 'Nenhuma mensagem foi enviada.';
        const failMsg = failCount > 0 ? ` ${failCount} falha(s).` : '';
        showToast(successMsg + failMsg, failCount > 0 ? 'error' : 'success');
        onClose();
        return;
      }

      if (data.success) {
        console.warn('[SEND] success sem mass_send nem payload síncrono — possível inconsistência de API', {
          status: response.status,
          data,
        });
        showToast(
          'Resposta incompleta do servidor. Confira a aba Campanhas de disparo; se não aparecer campanha, tente de novo.',
          'info'
        );
        onMassSendComplete?.();
        return;
      }

      {
        const raw = data.error || 'Erro desconhecido';
        const friendly = sanitizeMassSendErrorMessage(raw);
        showToast(
          friendly && friendly !== raw ? friendly : `Erro ao enviar mensagens: ${raw}`,
          'error'
        );
      }
    } catch (error: any) {
      console.error('❌ [SEND] Erro ao enviar mensagens:', error);
      
      // Mensagens de erro mais específicas
      if (error.name === 'AbortError' || error.message?.includes('Timeout')) {
        showToast('Timeout: A requisição demorou muito. Tente novamente com menos grupos ou verifique sua conexão.', 'error');
      } else if (error.message) {
        const friendly = sanitizeMassSendErrorMessage(error.message);
        showToast(
          friendly && friendly !== error.message ? friendly : `Erro ao enviar mensagens: ${error.message}`,
          'error'
        );
      } else {
        showToast('Erro ao enviar mensagens: Erro desconhecido. Tente novamente.', 'error');
      }
    } finally {
      sendLockedRef.current = false;
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
          setForceMassSend(false);
          setShowChoiceModal(false);
          // useEffect carrega grupos quando há instância(ns) selecionada(s)
          if (instances.length === 0) {
            fetch('/api/instances', {
              headers: { 'X-User-Id': userId, ...getWlSlugHeadersForApi() },
            })
              .then(res => res.json())
              .then(data => {
                if (data.success) {
                  const pool = selectInstancesForActivationSend(data.data) as any[];
                  setInstances(pool);
                }
              })
              .catch(err => console.error('Erro ao buscar instâncias:', err));
          }
        }}
        onSchedule={() => {
          setShowChoiceModal(false);
          setShowScheduleModal(true);
        }}
        onMassCampaign={() => {
          setForceMassSend(true);
          setShowChoiceModal(false);
          if (instances.length === 0) {
            fetch('/api/instances', { headers: { 'X-User-Id': userId, ...getWlSlugHeadersForApi() } })
              .then(res => res.json())
              .then(data => {
                if (data.success) {
                  const pool = selectInstancesForActivationSend(data.data) as any[];
                  setInstances(pool);
                }
              })
              .catch(err => console.error('Erro ao buscar instâncias:', err));
          }
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
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100] p-3 sm:p-4 overflow-y-auto overscroll-contain">
        <div className="bg-gray-100 dark:bg-[#2a2a2a] border border-gray-200 dark:border-[#404040] rounded-2xl w-full max-w-lg sm:max-w-2xl shadow-2xl flex flex-col h-[min(calc(100dvh-1.5rem),920px)] max-h-[min(calc(100dvh-1.5rem),920px)] my-auto overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-gray-200 dark:border-[#404040] flex items-center justify-between flex-shrink-0">
          <div className="flex-1 pr-2">
            <h2 className="text-gray-800 dark:text-white font-bold text-lg">Escolha os grupos nos quais deseja enviar a mensagem selecionada agora</h2>
          </div>
          <button 
            onClick={onClose}
            className="p-2 hover:bg-gray-200 dark:hover:bg-[#404040] rounded-full text-gray-600 dark:text-gray-400 transition-colors flex-shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Instâncias (uma ou mais; rotação por grupo na campanha) */}
        <div className="p-4 border-b border-gray-200 dark:border-[#404040] flex-shrink-0">
          {repeatCampaignSeed?.reselectInstances && (
            <p className="mb-3 text-xs text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-900/25 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
              Troca de instância: marque abaixo qual(is) número(s) usar neste disparo. Os mesmos grupos da campanha
              continuam selecionados ({selectedGroups.size}); a lista de nomes aparece após escolher a(s)
              instância(s) e carregar do banco.
            </p>
          )}
          <label className="text-gray-700 dark:text-gray-300 text-xs font-semibold mb-2 block uppercase tracking-wider">
            Instância(s) *
          </label>
          {instances.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400 py-2">Nenhuma instância conectada</p>
          ) : (
            <>
              <div className="relative mb-2">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
                <input
                  type="text"
                  value={instanceSearchQuery}
                  onChange={(e) => setInstanceSearchQuery(e.target.value)}
                  placeholder="Pesquisar instâncias..."
                  className="w-full bg-white dark:bg-[#333] border border-gray-300 dark:border-[#555] rounded-xl pl-10 pr-4 py-2 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#E86A24] focus:border-[#E86A24] placeholder:text-gray-500 dark:placeholder:text-gray-400"
                  aria-label="Pesquisar instâncias"
                />
              </div>
              <div className="max-h-36 overflow-y-auto space-y-2 rounded-xl border border-gray-300 dark:border-[#555] bg-white dark:bg-[#333] p-2">
                {filteredInstances.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400 px-2 py-3 text-center">
                    Nenhuma instância corresponde à pesquisa
                  </p>
                ) : (
                  filteredInstances.map((inst: { id: string; instance_name: string }) => (
                    <label
                      key={inst.id}
                      className="flex items-center gap-2 cursor-pointer rounded-lg px-2 py-1.5 hover:bg-gray-100 dark:hover:bg-[#404040]"
                    >
                      <input
                        type="checkbox"
                        className="rounded border-gray-400 text-[#E86A24] focus:ring-[#E86A24]"
                        checked={selectedInstanceNames.has(inst.instance_name)}
                        onChange={() => toggleInstanceName(inst.instance_name)}
                      />
                      <span className="text-sm text-gray-800 dark:text-white break-all">{inst.instance_name}</span>
                    </label>
                  ))
                )}
              </div>
            </>
          )}
        </div>

        {/* Filtros e Seleção */}
        <div className="p-4 space-y-4 flex-shrink-0 border-b border-gray-200 dark:border-[#404040]">
          <div className="flex items-center justify-between text-sm flex-wrap gap-2">
            <span className="text-gray-700 dark:text-gray-300 font-medium">Grupos disponíveis *</span>
            <div className="flex items-center gap-2">
              <button 
                onClick={fetchEvolutionGroups}
                disabled={fetchingAll || selectedInstanceNames.size === 0}
                className="text-[#E86A24] hover:text-[#D95E1B] flex items-center gap-1.5 font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {fetchingAll ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Plus className="w-3.5 h-3.5" />
                )}
                Extrair todos os grupos
              </button>
              {groups.length > 0 && (
                <button 
                  onClick={handleSaveAllGroups}
                  disabled={savingAllGroups || selectedInstanceNames.size === 0}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1.5 font-bold px-2 py-1 rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {savingAllGroups ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                  Salvar todos os grupos
                </button>
              )}
            </div>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input 
              type="text" 
              placeholder="Pesquisar grupos..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-gray-100 dark:bg-[#333] border border-gray-200 dark:border-[#404040] rounded-xl pl-10 pr-4 py-2.5 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#E86A24] focus:border-[#E86A24] placeholder:text-gray-500 dark:placeholder:text-gray-400"
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
                  ? 'bg-[#E86A24] border-[#E86A24] shadow-[0_0_10px_rgba(140,217,85,0.3)]' 
                  : 'bg-white dark:bg-[#333] border-gray-300 dark:border-[#555] group-hover:border-[#E86A24]'
              }`}>
                {allFilteredSelected && <Check className="w-3.5 h-3.5 text-white stroke-[3]" />}
              </div>
              <span className="text-sm text-gray-700 dark:text-gray-300 font-medium">Selecione todos os grupos</span>
            </button>
            <span className="text-[#E86A24] font-bold text-sm">Total: {filteredGroupIds.length}</span>
          </div>
        </div>

        {/* Lista de Grupos — única área com scroll; header/filtros/rodapé permanecem fixos no card */}
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-2 py-2 custom-scrollbar">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3 min-h-[10rem]">
              <Loader2 className="w-8 h-8 text-[#E86A24] animate-spin" />
              <span className="text-gray-500 dark:text-gray-400 text-sm inline-flex items-center">
                Isso pode demorar um pouco
                <span className="inline-flex ml-1 gap-0">
                  <span className="wave-dot-1">.</span>
                  <span className="wave-dot-2">.</span>
                  <span className="wave-dot-3">.</span>
                </span>
              </span>
            </div>
          ) : filteredGroups.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center min-h-[10rem]">
              <span className="text-gray-500 dark:text-gray-400 text-sm">Nenhum grupo encontrado</span>
            </div>
          ) : (
            <div className="space-y-1.5 pb-1">
              {filteredGroups.map((group, index) => (
                <button
                  key={`${group.id}-${index}`}
                  type="button"
                  onClick={() => toggleGroup(group.id)}
                  className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all group text-left ${
                    selectedGroups.has(group.id) ? 'bg-[#E86A24]/10 dark:bg-[#E86A24]/20 border border-[#E86A24]/40 dark:border-[#E86A24]/50' : 'hover:bg-[#E86A24]/5 dark:hover:bg-[#E86A24]/10 border border-transparent hover:border-[#E86A24]/20 dark:hover:border-[#E86A24]/30'
                  }`}
                >
                  <div className={`w-5 h-5 rounded border flex items-center justify-center transition-all flex-shrink-0 mt-0.5 ${
                    selectedGroups.has(group.id) 
                      ? 'bg-[#E86A24] border-[#E86A24] shadow-[0_0_10px_rgba(140,217,85,0.3)]' 
                      : 'bg-white dark:bg-[#333] border-gray-300 dark:border-[#555] group-hover:border-[#E86A24]'
                  }`}>
                    {selectedGroups.has(group.id) && <Check className="w-3.5 h-3.5 text-white stroke-[3]" />}
                  </div>
                  <span className={`text-sm font-medium text-left break-words line-clamp-2 ${selectedGroups.has(group.id) ? 'text-[#C9531A]' : 'text-gray-700 dark:text-gray-300 group-hover:text-[#E86A24]'}`} title={group.subject}>
                    {group.subject}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {(forceMassSend || selectedGroups.size > 10) && (
          <div className="px-4 py-3 border-t border-gray-200 dark:border-[#404040] flex-shrink-0 bg-white/80 dark:bg-[#2a2a2a]/80">
            <label
              htmlFor="mass-send-inter-delay"
              className="text-gray-700 dark:text-gray-300 text-xs font-semibold mb-1.5 block uppercase tracking-wider"
            >
              Pausa entre grupos (fila)
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <input
                id="mass-send-inter-delay"
                type="number"
                min={0}
                max={MAX_INTER_GROUP_DELAY_SEC}
                step={1}
                value={massSendInterGroupDelaySec}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  setMassSendInterGroupDelaySec(
                    Number.isFinite(n)
                      ? Math.min(MAX_INTER_GROUP_DELAY_SEC, Math.max(0, n))
                      : 0
                  );
                }}
                className="w-24 bg-white dark:bg-[#333] border border-gray-300 dark:border-[#555] rounded-lg px-2 py-1.5 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#E86A24]"
              />
              <button
                type="button"
                onClick={pickRandomInterGroupDelay}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#E86A24]/60 bg-[#E86A24]/10 px-2.5 py-1.5 text-xs font-semibold text-[#C9531A] dark:text-[#E86A24] hover:bg-[#E86A24]/20 transition-colors"
              >
                <Shuffle className="w-3.5 h-3.5" />
                Aleatório 1–985s
              </button>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                segundos (0 = padrão 1 s entre cada disparo)
              </span>
            </div>
          </div>
        )}

        {/* Rodapé fixo ao fundo do card — não entra no scroll da lista */}
        <div className="p-4 border-t border-gray-200 dark:border-[#404040] bg-white dark:bg-[#333] flex gap-3 flex-shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 px-4 py-3 bg-gray-200 dark:bg-[#404040] hover:bg-gray-300 dark:hover:bg-[#505050] text-gray-800 dark:text-white font-bold rounded-xl transition-all"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSend}
            disabled={sending || selectedGroups.size === 0 || selectedInstanceNames.size === 0}
            className="flex-1 px-4 py-3 bg-[#E86A24] hover:bg-[#D95E1B] disabled:opacity-50 disabled:hover:bg-[#E86A24] text-white font-bold rounded-xl transition-all shadow-lg shadow-[#E86A24]/20 flex items-center justify-center gap-2"
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

