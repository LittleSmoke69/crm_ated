'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  X,
  Loader2,
  Save,
  Users,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  MessageSquare,
  Settings2,
  Trash2,
  Plus,
  Tag,
} from 'lucide-react';
import { postGroupFetchAndResolve } from '@/lib/utils/group-fetch-client';

interface WhatsAppInstance {
  id: string;
  instance_name: string;
  status: string;
  is_master: boolean;
}

interface WhatsAppGroup {
  group_id: string;
  group_subject: string;
}

interface BancaInfo {
  id?: string;
  name: string;
  url: string | null;
}

interface RandomPickerNode {
  id: string;
  type: string;
  data: {
    label: string;
    config: {
      messages: string[];
    };
  };
}

interface FlowInstanceModalProps {
  show: boolean;
  userId: string;
  selectedFlow: any;
  selectedFlowInstance: any | null;
  existingInstances: any[];
  instances: WhatsAppInstance[];
  onClose: () => void;
  onSaved: () => void;
}

const VARIABLES = [
  { label: '{{banca}}', description: 'Nome da banca' },
  { label: '{{nome}}', description: 'Seu nome' },
  { label: '{{numero}}', description: 'Número do novo membro' },
];

const MIN_VARIANTS = 3;
const MAX_VARIANTS = 10;

const DRAG_VAR = 'application/x-zaploto-variable';

function findVariables(text: string): Array<{ variable: string; start: number; end: number }> {
  const variableRegex = /\{\{[^}]+\}\}/g;
  const variables: Array<{ variable: string; start: number; end: number }> = [];
  let match;
  while ((match = variableRegex.exec(text)) !== null) {
    variables.push({ variable: match[0], start: match.index, end: match.index + match[0].length });
  }
  return variables;
}

function removeVariableAtPosition(text: string, start: number, end: number): string {
  return text.slice(0, start) + text.slice(end);
}

function insertVariableAtPosition(text: string, position: number, variable: string): string {
  return text.slice(0, position) + variable + text.slice(position);
}

function moveVariable(text: string, fromStart: number, fromEnd: number, toPosition: number): string {
  const variable = text.slice(fromStart, fromEnd);
  const withoutVariable = removeVariableAtPosition(text, fromStart, fromEnd);
  const adjustedPosition = toPosition > fromStart ? toPosition - (fromEnd - fromStart) : toPosition;
  return withoutVariable.slice(0, adjustedPosition) + variable + withoutVariable.slice(adjustedPosition);
}

/** Prévia da mensagem com variáveis em verde; duplo clique remove, arrastar move */
function MessagePreviewWithVariables({
  text,
  onDeleteVariable,
  onValueChange,
}: {
  text: string;
  onDeleteVariable: (start: number, end: number) => void;
  onValueChange: (newValue: string) => void;
}) {
  if (!text) return <span className="text-gray-500 dark:text-gray-400 italic">Digite a mensagem acima.</span>;
  const variables = findVariables(text);
  const parts: Array<{ text: string; isVariable: boolean; start?: number; end?: number }> = [];
  let lastIndex = 0;
  variables.forEach(({ variable, start, end }) => {
    if (start > lastIndex) parts.push({ text: text.slice(lastIndex, start), isVariable: false });
    parts.push({ text: variable, isVariable: true, start, end });
    lastIndex = end;
  });
  if (lastIndex < text.length) parts.push({ text: text.slice(lastIndex), isVariable: false });
  if (parts.length === 0) return <span>{text}</span>;

  const handleDropInPreview = (e: React.DragEvent, dropStart: number) => {
    e.preventDefault();
    e.stopPropagation();
    const variableData = e.dataTransfer.getData('variable');
    const startData = e.dataTransfer.getData('start');
    const endData = e.dataTransfer.getData('end');
    if (variableData && startData !== undefined && endData !== undefined) {
      const fromStart = parseInt(startData, 10);
      const fromEnd = parseInt(endData, 10);
      if (dropStart >= fromStart && dropStart <= fromEnd) return;
      const newValue = moveVariable(text, fromStart, fromEnd, dropStart);
      onValueChange(newValue);
    }
  };

  return (
    <span className="whitespace-pre-wrap break-words">
      {parts.map((part, index) => {
        if (part.isVariable && part.start !== undefined && part.end !== undefined) {
          return (
            <span
              key={index}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('variable', part.text);
                e.dataTransfer.setData('start', String(part.start));
                e.dataTransfer.setData('end', String(part.end));
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDoubleClick={() => onDeleteVariable(part.start!, part.end!)}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
              onDrop={(e) => handleDropInPreview(e, part.start!)}
              className="text-[#5a8a2a] dark:text-[#8CD955] font-mono font-semibold bg-[#8CD955]/20 dark:bg-[#8CD955]/30 px-1 py-0.5 rounded cursor-pointer hover:bg-[#8CD955]/30 dark:hover:bg-[#8CD955]/40 select-none"
              title="Duplo clique para remover | Arraste para reposicionar"
            >
              {part.text}
            </span>
          );
        }
        return <span key={index}>{part.text}</span>;
      })}
    </span>
  );
}

export default function FlowInstanceModal({
  show,
  userId,
  selectedFlow,
  selectedFlowInstance,
  existingInstances,
  instances,
  onClose,
  onSaved,
}: FlowInstanceModalProps) {
  const [instanceName, setInstanceName] = useState('');
  const [groupJids, setGroupJids] = useState<string[]>([]);
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);

  const [availableGroups, setAvailableGroups] = useState<WhatsAppGroup[]>([]);
  const [savedGroups, setSavedGroups] = useState<WhatsAppGroup[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [fetchingGroups, setFetchingGroups] = useState(false);
  const [savingAllGroups, setSavingAllGroups] = useState(false);
  const [groupsPage, setGroupsPage] = useState(1);
  const groupsPerPage = 5;

  // Bancas
  const [bancas, setBancas] = useState<BancaInfo[]>([]);
  const [selectedBanca, setSelectedBanca] = useState('');

  // Mensagens customizadas: { [nodeId]: (string | null)[] }
  const [customMessages, setCustomMessages] = useState<Record<string, (string | null)[]>>({});
  /** Número de variações de mensagem a usar (3 a 10). O flow tem até 10; o usuário pode usar apenas 3, 4, etc. */
  const [numberOfVariants, setNumberOfVariants] = useState(10);

  // Tab ativa do modal
  const [activeTab, setActiveTab] = useState<'config' | 'messages'>('config');

  // Textarea refs para inserir variáveis
  const textareaRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});

  // Nós RandomPicker do flow
  const randomPickerNodes: RandomPickerNode[] = selectedFlow?.graph_json?.nodes?.filter(
    (n: any) => n.type === 'randomPicker'
  ) || [];

  const hasRandomPicker = randomPickerNodes.length > 0;

  // Inicializa estado quando o modal abre ou selectedFlowInstance muda
  useEffect(() => {
    if (!show) return;

    if (selectedFlowInstance) {
      setInstanceName(selectedFlowInstance.instance_name || '');
      const sameGroup = existingInstances.filter(
        (fi) => fi.flow_id === selectedFlowInstance.flow_id && fi.instance_name === selectedFlowInstance.instance_name
      );
      const jids = [...new Set(sameGroup.map((fi: any) => fi.group_jid).filter(Boolean))];
      setGroupJids(jids as string[]);
      setIsActive(selectedFlowInstance.is_active ?? true);

      // Carrega settings do primeiro registro (todos têm os mesmos settings)
      const settings = selectedFlowInstance.settings_json || {};
      setSelectedBanca(settings.selectedBanca || '');
      setCustomMessages(settings.customMessages || {});
      const n = settings.numberOfVariants;
      setNumberOfVariants(
        typeof n === 'number' && n >= MIN_VARIANTS && n <= MAX_VARIANTS ? n : 10
      );
    } else {
      setInstanceName(instances[0]?.instance_name || '');
      setGroupJids([]);
      setIsActive(true);
      setSelectedBanca('');
      setCustomMessages({});
      setNumberOfVariants(10);
    }
    setGroupsPage(1);
    setActiveTab('config');
  }, [show, selectedFlowInstance]);

  // Inicializa customMessages quando o flow muda (garante que cada nó tenha slots corretos)
  useEffect(() => {
    if (!show || randomPickerNodes.length === 0) return;

    setCustomMessages((prev) => {
      const next = { ...prev };
      for (const node of randomPickerNodes) {
        const count = node.data.config.messages.length;
        if (!next[node.id]) {
          next[node.id] = Array(count).fill(null);
        } else if (next[node.id].length !== count) {
          const arr = Array(count).fill(null);
          for (let i = 0; i < Math.min(next[node.id].length, count); i++) {
            arr[i] = next[node.id][i];
          }
          next[node.id] = arr;
        }
      }
      return next;
    });
  }, [show, selectedFlow?.id]);

  // Carrega bancas do usuário
  useEffect(() => {
    if (!show || !userId) return;
    fetch('/api/user/bancas', { headers: { 'X-User-Id': userId } })
      .then((r) => r.json())
      .then((result) => {
        if (result.success) {
          setBancas(result.data || []);
          // Se não tem banca selecionada ainda, pré-seleciona a primeira
          if (!selectedBanca && result.data?.length > 0) {
            setSelectedBanca(result.data[0].name);
          }
        }
      })
      .catch(() => {});
  }, [show, userId]);

  const loadSavedGroups = useCallback(
    async (instName: string) => {
      if (!userId || !instName) return;
      try {
        const r = await fetch(`/api/groups?instanceName=${encodeURIComponent(instName)}`, {
          headers: { 'X-User-Id': userId },
        });
        if (r.ok) {
          const result = await r.json();
          if (result.success) {
            const saved = (result.data || []).map((g: any) => ({
              group_id: g.group_id,
              group_subject: g.group_subject || g.group_id,
            }));
            setSavedGroups(saved);
            setAvailableGroups(saved);
          }
        }
      } catch {}
    },
    [userId]
  );

  const loadGroups = useCallback(
    async (instName: string) => {
      setLoadingGroups(true);
      setSavedGroups([]);
      setAvailableGroups([]);
      await loadSavedGroups(instName);
      setLoadingGroups(false);
    },
    [loadSavedGroups]
  );

  // Carrega grupos quando instância muda
  useEffect(() => {
    if (!show || !instanceName) return;
    loadGroups(instanceName);
  }, [show, instanceName]);

  const fetchNewGroups = async () => {
    if (!userId || !instanceName) return;
    try {
      setFetchingGroups(true);
      const { groups: raw } = await postGroupFetchAndResolve(userId, instanceName);
      const fetched = raw.map((g) => ({
        group_id: g.id,
        group_subject: g.subject || g.id || 'Sem nome',
      }));
      const savedIds = new Set(savedGroups.map((g) => g.group_id));
      const newGroups = fetched.filter((g) => !savedIds.has(g.group_id));
      setAvailableGroups([...savedGroups, ...newGroups]);
    } catch {
      alert('Erro ao buscar grupos da instância');
    } finally {
      setFetchingGroups(false);
    }
  };

  const handleSaveAllGroups = async () => {
    if (!userId || !instanceName || availableGroups.length === 0) return;
    setSavingAllGroups(true);
    try {
      const groups = availableGroups.map((g) => ({
        id: g.group_id,
        subject: g.group_subject || null,
      }));
      const r = await fetch('/api/groups/sync', {
        method: 'POST',
        headers: { 'X-User-Id': userId, 'Content-Type': 'application/json' },
        body: JSON.stringify({ instanceName, groups }),
      });
      const result = await r.json();
      if (r.ok && result.success) {
        const { inserted = 0, updated = 0 } = result.data || {};
        alert(`${inserted + updated} grupo(s) salvos/sincronizados (sem duplicar existentes).`);
        await loadSavedGroups(instanceName);
      } else {
        alert(result.error || 'Erro ao salvar grupos');
      }
    } catch {
      alert('Erro ao salvar todos os grupos');
    } finally {
      setSavingAllGroups(false);
    }
  };

  const handleInstanceChange = (name: string) => {
    setInstanceName(name);
    setGroupJids([]);
    setGroupsPage(1);
  };

  const toggleGroup = (gid: string) => {
    setGroupJids((prev) =>
      prev.includes(gid) ? prev.filter((id) => id !== gid) : [...prev, gid]
    );
  };

  // Atualiza mensagem customizada de um slot
  const setSlotMessage = (nodeId: string, idx: number, value: string | null) => {
    setCustomMessages((prev) => {
      const arr = [...(prev[nodeId] || [])];
      arr[idx] = value;
      return { ...prev, [nodeId]: arr };
    });
  };

  // Insere variável na posição do cursor (ou em position se passado)
  const insertVariable = (nodeId: string, idx: number, variable: string, position?: number) => {
    const key = `${nodeId}-${idx}`;
    const textarea = textareaRefs.current[key];
    const current = customMessages[nodeId]?.[idx] ?? '';
    const pos = position ?? (textarea ? textarea.selectionStart : current.length);
    const newValue = insertVariableAtPosition(current, pos, variable);
    setSlotMessage(nodeId, idx, newValue);
    if (textarea) {
      setTimeout(() => {
        textarea.focus();
        const newPos = pos + variable.length;
        textarea.setSelectionRange(newPos, newPos);
      }, 0);
    }
  };

  // Drop de variável no textarea (chip arrastado)
  const handleTextareaDrop = (e: React.DragEvent<HTMLTextAreaElement>, nodeId: string, idx: number) => {
    e.preventDefault();
    e.stopPropagation();
    const ta = e.currentTarget;
    const dropPosition = ta.selectionStart ?? ta.value.length;
    const variable = e.dataTransfer.getData(DRAG_VAR) || e.dataTransfer.getData('text/plain');
    if (variable && /^\{\{[^}]+\}\}$/.test(variable)) {
      insertVariable(nodeId, idx, variable, dropPosition);
      setTimeout(() => {
        ta.focus();
        ta.setSelectionRange(dropPosition + variable.length, dropPosition + variable.length);
      }, 0);
    }
  };

  const handleTextareaDragOver = (e: React.DragEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes(DRAG_VAR) || e.dataTransfer.types.includes('text/plain')) {
      e.dataTransfer.dropEffect = 'copy';
    }
  };

  const buildSettingsJson = () => ({
    selectedBanca,
    customMessages,
    numberOfVariants: numberOfVariants,
  });

  const handleSave = async () => {
    if (!userId || !selectedFlow) return;
    if (!instanceName) {
      alert('Selecione a instância.');
      return;
    }
    if (groupJids.length === 0) {
      alert('Selecione ao menos um grupo.');
      return;
    }

    setSaving(true);
    try {
      const flow_id = selectedFlow.id;
      const settings_json = buildSettingsJson();

      // Grupos atuais para a combinação flow+instance
      const current = selectedFlowInstance
        ? existingInstances
            .filter((fi) => fi.flow_id === flow_id && fi.instance_name === instanceName)
            .map((fi) => fi.group_jid)
        : [];

      const toAdd = groupJids.filter((g) => !current.includes(g));
      const toRemove = current.filter((g) => !groupJids.includes(g));

      for (const group_jid of toAdd) {
        const res = await fetch('/api/flow-instances', {
          method: 'POST',
          headers: { 'X-User-Id': userId, 'Content-Type': 'application/json' },
          body: JSON.stringify({ flow_id, instance_name: instanceName, group_jid, is_active: isActive, settings_json }),
        });
        if (!res.ok) {
          const data = await res.json();
          alert(data.error || `Erro ao adicionar grupo ${group_jid}`);
          return;
        }
      }

      for (const group_jid of toRemove) {
        const fi = existingInstances.find(
          (f) => f.flow_id === flow_id && f.instance_name === instanceName && f.group_jid === group_jid
        );
        if (!fi) continue;
        const res = await fetch(`/api/flow-instances/${fi.id}`, {
          method: 'DELETE',
          headers: { 'X-User-Id': userId },
        });
        if (!res.ok) {
          const data = await res.json();
          alert(data.error || 'Erro ao remover grupo');
          return;
        }
      }

      // Atualiza is_active e settings_json nos grupos mantidos
      const remaining = existingInstances.filter(
        (f) => f.flow_id === flow_id && f.instance_name === instanceName && groupJids.includes(f.group_jid)
      );
      for (const fi of remaining) {
        const res = await fetch(`/api/flow-instances/${fi.id}`, {
          method: 'PUT',
          headers: { 'X-User-Id': userId, 'Content-Type': 'application/json' },
          body: JSON.stringify({ is_active: isActive, settings_json }),
        });
        if (!res.ok) {
          const data = await res.json();
          alert(data.error || 'Erro ao atualizar ativação');
          return;
        }
      }

      onSaved();
    } catch (err) {
      console.error('Erro ao salvar automação:', err);
      alert('Erro ao salvar automação');
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    setInstanceName('');
    setGroupJids([]);
    setIsActive(true);
    setAvailableGroups([]);
    setSavedGroups([]);
    setCustomMessages({});
    setSelectedBanca('');
    setNumberOfVariants(10);
    setGroupsPage(1);
    setActiveTab('config');
    onClose();
  };

  if (!show || !selectedFlow) return null;

  // Cálculo para paginação de grupos
  const ids = new Set(availableGroups.map((g) => g.group_id));
  const extra = groupJids.filter((gid) => !ids.has(gid)).map((gid) => ({ group_id: gid, group_subject: gid }));
  const allGroups = [...availableGroups, ...extra];
  const totalGroupPages = Math.ceil(allGroups.length / groupsPerPage);
  const groupStart = (groupsPage - 1) * groupsPerPage;
  const currentGroups = allGroups.slice(groupStart, groupStart + groupsPerPage);

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-[#2a2a2a] rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col border border-gray-200 dark:border-[#404040]">
        {/* Header */}
        <div className="px-6 py-5 border-b border-gray-200 dark:border-[#404040] flex items-center justify-between bg-gray-50 dark:bg-[#333] rounded-t-xl">
          <div>
            <h3 className="text-xl font-bold text-gray-900 dark:text-white">
              {selectedFlowInstance ? 'Editar' : 'Configurar'} Automação
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">{selectedFlow.name}</p>
          </div>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-[#404040] rounded-lg p-1.5 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        {hasRandomPicker && (
          <div className="flex border-b border-gray-200 dark:border-[#404040] px-6 bg-white dark:bg-[#2a2a2a]">
            <button
              onClick={() => setActiveTab('config')}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors -mb-px ${
                activeTab === 'config'
                  ? 'border-[#8CD955] text-[#8CD955]'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              <Settings2 className="w-4 h-4" />
              Configuração
            </button>
            <button
              onClick={() => setActiveTab('messages')}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors -mb-px ${
                activeTab === 'messages'
                  ? 'border-[#8CD955] text-[#8CD955]'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              <MessageSquare className="w-4 h-4" />
              Mensagens
            </button>
          </div>
        )}

        {/* Body */}
        <div className="p-6 space-y-5 overflow-y-auto flex-1">
          {activeTab === 'config' && (
            <>
              {/* Instância */}
              <div>
                <label className="block text-sm font-semibold text-gray-900 dark:text-white mb-2">
                  Instância Mestre <span className="text-red-500">*</span>
                </label>
                <select
                  value={instanceName}
                  onChange={(e) => handleInstanceChange(e.target.value)}
                  className="w-full px-4 py-2.5 border-2 border-gray-300 dark:border-[#555] rounded-lg text-gray-700 dark:text-white bg-white dark:bg-[#333] focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] transition-colors shadow-sm"
                >
                  <option value="">Selecione uma instância</option>
                  {instances.map((inst) => (
                    <option key={inst.instance_name} value={inst.instance_name}>
                      {inst.instance_name} ({inst.status})
                    </option>
                  ))}
                </select>
              </div>

              {/* Grupos */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <label className="block text-sm font-semibold text-gray-900 dark:text-white">
                      Grupos <span className="text-red-500">*</span>
                    </label>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      Selecione um ou mais. A automação rodará em todos.
                    </p>
                  </div>
                  {instanceName && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        type="button"
                        onClick={fetchNewGroups}
                        disabled={fetchingGroups}
                        className="text-xs text-[#8CD955] hover:text-[#7BC84A] font-semibold flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-[#8CD955]/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {fetchingGroups ? (
                          <><Loader2 className="w-3.5 h-3.5 animate-spin" />Buscando...</>
                        ) : (
                          <>
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                            Buscar grupos novos
                          </>
                        )}
                      </button>
                      {availableGroups.length > 0 && (
                        <button
                          type="button"
                          onClick={handleSaveAllGroups}
                          disabled={savingAllGroups}
                          className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-semibold flex items-center gap-1.5 px-2 py-1 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {savingAllGroups ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                          Salvar todos os grupos
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {loadingGroups ? (
                  <div className="flex items-center justify-center p-4">
                    <Loader2 className="w-5 h-5 animate-spin text-[#8CD955]" />
                  </div>
                ) : allGroups.length === 0 ? (
                  <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                    <Users className="w-12 h-12 mx-auto mb-2 text-gray-400 dark:text-gray-500" />
                    <p className="text-sm">Nenhum grupo encontrado</p>
                    <p className="text-xs mt-1">Clique em "Buscar grupos novos" para extrair grupos da instância</p>
                  </div>
                ) : (
                  <div className="border border-gray-200 dark:border-[#404040] rounded-lg">
                    <div className="p-2 space-y-1">
                      {currentGroups.map((group) => {
                        const isSaved = savedGroups.some((sg) => sg.group_id === group.group_id);
                        const gid = group.group_id;
                        const isSelected = groupJids.includes(gid);
                        return (
                          <div
                            key={gid}
                            role="button"
                            tabIndex={0}
                            onClick={() => toggleGroup(gid)}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleGroup(gid); } }}
                            className={`p-3 rounded-lg border-2 cursor-pointer transition-all ${
                              isSelected
                                ? 'border-[#8CD955] bg-[#8CD955]/10 dark:bg-[#8CD955]/20 shadow-sm'
                                : 'border-gray-200 dark:border-[#404040] hover:border-gray-300 dark:hover:border-[#555] hover:bg-gray-50 dark:hover:bg-[#333]'
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                                isSaved ? 'bg-green-100 dark:bg-[#8CD955]/20 text-green-600 dark:text-[#8CD955]' : 'bg-blue-100 dark:bg-[#8CD955]/20 text-blue-600 dark:text-[#8CD955]'
                              }`}>
                                <Users className="w-5 h-5" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <p className={`font-medium text-sm truncate ${isSelected ? 'text-[#8CD955]' : 'text-gray-900 dark:text-white'}`}>
                                    {group.group_subject || group.group_id}
                                  </p>
                                  {isSaved && (
                                    <span className="flex-shrink-0 px-1.5 py-0.5 text-xs font-medium bg-green-100 dark:bg-[#8CD955]/20 text-green-700 dark:text-[#8CD955] rounded">
                                      Salvo
                                    </span>
                                  )}
                                </div>
                                <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">{group.group_id}</p>
                              </div>
                              {isSelected && <CheckCircle2 className="w-5 h-5 text-[#8CD955] flex-shrink-0" />}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Paginação de grupos — compacta (evita dezenas de botões) */}
                    {totalGroupPages > 1 && (
                      <div className="border-t border-gray-200 dark:border-[#404040] px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <p className="text-sm text-gray-700 dark:text-gray-300">
                          {groupStart + 1}–{Math.min(groupStart + groupsPerPage, allGroups.length)} de {allGroups.length} grupo(s)
                        </p>
                        <nav className="isolate inline-flex -space-x-px rounded-md shadow-sm flex-wrap justify-center sm:justify-end">
                          <button
                            onClick={() => setGroupsPage(Math.max(1, groupsPage - 1))}
                            disabled={groupsPage === 1}
                            className="relative inline-flex items-center rounded-l-md px-2 py-2 text-gray-400 ring-1 ring-inset ring-gray-300 dark:ring-[#555] hover:bg-gray-50 dark:hover:bg-[#404040] disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <ChevronLeft className="h-4 w-4" />
                          </button>
                          {Array.from({ length: totalGroupPages }, (_, i) => i + 1)
                            .filter((page) => {
                              if (totalGroupPages <= 7) return true;
                              if (groupsPage <= 3) return page <= 5 || page === totalGroupPages;
                              if (groupsPage >= totalGroupPages - 2) return page === 1 || page >= totalGroupPages - 4;
                              return page === 1 || page === totalGroupPages || (page >= groupsPage - 1 && page <= groupsPage + 1);
                            })
                            .map((page, index, arr) => (
                              <React.Fragment key={page}>
                                {index > 0 && arr[index - 1] !== page - 1 && (
                                  <span className="relative inline-flex items-center px-2 py-2 text-sm font-semibold text-gray-500 dark:text-gray-400 ring-1 ring-inset ring-gray-300 dark:ring-[#555]">
                                    …
                                  </span>
                                )}
                                <button
                                  onClick={() => setGroupsPage(page)}
                                  className={`relative inline-flex items-center px-3 py-2 text-sm font-semibold ${
                                    groupsPage === page
                                      ? 'z-10 bg-[#8CD955] text-white'
                                      : 'text-gray-900 dark:text-gray-300 ring-1 ring-inset ring-gray-300 dark:ring-[#555] hover:bg-gray-50 dark:hover:bg-[#404040]'
                                  }`}
                                >
                                  {page}
                                </button>
                              </React.Fragment>
                            ))}
                          <button
                            onClick={() => setGroupsPage(Math.min(totalGroupPages, groupsPage + 1))}
                            disabled={groupsPage === totalGroupPages}
                            className="relative inline-flex items-center rounded-r-md px-2 py-2 text-gray-400 ring-1 ring-inset ring-gray-300 dark:ring-[#555] hover:bg-gray-50 dark:hover:bg-[#404040] disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <ChevronRight className="h-4 w-4" />
                          </button>
                        </nav>
                      </div>
                    )}

                    {savedGroups.length > 0 && (
                      <p className="text-xs text-gray-500 flex items-center gap-1 px-4 pb-2">
                        <CheckCircle2 className="w-3 h-3 text-green-600" />
                        {savedGroups.length} grupo(s) salvo(s)
                      </p>
                    )}
                  </div>
                )}
              </div>

              {groupJids.length > 0 && (
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  <span className="font-medium">{groupJids.length}</span> grupo(s) selecionado(s).
                </p>
              )}

              {/* Ativo */}
              <div className="flex items-center gap-3 p-4 bg-gray-50 dark:bg-[#333] rounded-lg border border-gray-200 dark:border-[#404040]">
                <input
                  type="checkbox"
                  id="is_active_fi"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="w-5 h-5 text-[#8CD955] border-gray-300 dark:border-[#555] rounded focus:ring-2 focus:ring-[#8CD955]"
                />
                <label htmlFor="is_active_fi" className="text-sm font-medium text-gray-900 dark:text-white cursor-pointer">
                  Automação ativa nos grupos selecionados
                </label>
              </div>
            </>
          )}

          {activeTab === 'messages' && hasRandomPicker && (
            <div className="space-y-6">
              {/* Número de variações de mensagem (3 a 10) */}
              {(() => {
                const maxAvailable = Math.min(MAX_VARIANTS, randomPickerNodes[0]?.data?.config?.messages?.length ?? 10);
                const options = Array.from({ length: maxAvailable - MIN_VARIANTS + 1 }, (_, i) => MIN_VARIANTS + i);
                return (
                  <div className="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/50 rounded-lg">
                    <label className="block text-sm font-semibold text-amber-900 dark:text-amber-200 mb-2">
                      Número de variações de mensagem
                    </label>
                    <p className="text-xs text-amber-800 dark:text-amber-300 mb-3">
                      A automação escolherá uma mensagem aleatória entre as que você ativar. Você pode usar de 3 a {maxAvailable} variações.
                    </p>
                    <select
                      value={numberOfVariants}
                      onChange={(e) => setNumberOfVariants(Number(e.target.value))}
                      className="w-full px-3 py-2 border border-amber-300 dark:border-amber-600 rounded-lg text-gray-700 dark:text-white bg-white dark:bg-[#333] focus:ring-2 focus:ring-amber-400 text-sm"
                    >
                      {options.map((n) => (
                        <option key={n} value={n}>{n} variações</option>
                      ))}
                    </select>
                  </div>
                );
              })()}

              {/* Selector de banca */}
              {bancas.length > 1 && (
                <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700/50 rounded-lg">
                  <label className="block text-sm font-semibold text-blue-900 dark:text-blue-200 mb-2">
                    Banca para usar na variável <code className="bg-blue-100 dark:bg-blue-800 px-1 rounded text-xs">{'{{banca}}'}</code>
                  </label>
                  <p className="text-xs text-blue-700 dark:text-blue-300 mb-3">
                    Você faz parte de múltiplas bancas. Escolha qual nome será exibido nas mensagens de boas-vindas deste grupo.
                  </p>
                  <select
                    value={selectedBanca}
                    onChange={(e) => setSelectedBanca(e.target.value)}
                    className="w-full px-3 py-2 border border-blue-300 dark:border-blue-600 rounded-lg text-gray-700 dark:text-white bg-white dark:bg-[#333] focus:ring-2 focus:ring-blue-400 text-sm"
                  >
                    {bancas.map((b) => (
                      <option key={b.name} value={b.name}>{b.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Variáveis disponíveis */}
              <div className="p-3 bg-gray-50 dark:bg-[#333] border border-gray-200 dark:border-[#404040] rounded-lg">
                <p className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-2 flex items-center gap-1.5">
                  <Tag className="w-3.5 h-3.5" />
                  Variáveis disponíveis — clique para inserir no campo focado:
                </p>
                <div className="flex flex-wrap gap-2">
                  {VARIABLES.map((v) => (
                    <span
                      key={v.label}
                      title={v.description}
                      className="px-2 py-1 text-xs bg-[#8CD955]/20 dark:bg-[#8CD955]/30 text-[#5a8a2a] dark:text-[#8CD955] border border-[#8CD955]/40 rounded-md cursor-default font-mono select-all"
                    >
                      {v.label}
                    </span>
                  ))}
                </div>
              </div>

              {/* Nós RandomPicker — exibe apenas as primeiras numberOfVariants mensagens */}
              {randomPickerNodes.map((node) => {
                const systemMessages = node.data.config.messages;
                const nodeCustom = customMessages[node.id] || Array(systemMessages.length).fill(null);
                const messagesToShow = systemMessages.slice(0, numberOfVariants);

                return (
                  <div key={node.id} className="space-y-3">
                    {randomPickerNodes.length > 1 && (
                      <h4 className="font-semibold text-sm text-gray-700 dark:text-gray-300">{node.data.label}</h4>
                    )}

                    {messagesToShow.map((sysMsg, idx) => {
                      const customVal = nodeCustom[idx];
                      const hasCustom = customVal !== null && customVal !== undefined;
                      const refKey = `${node.id}-${idx}`;

                      return (
                        <div key={idx} className="border border-gray-200 dark:border-[#404040] rounded-lg overflow-hidden">
                          {/* Cabeçalho do slot */}
                          <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 dark:bg-[#333] border-b border-gray-200 dark:border-[#404040]">
                            <span className="text-xs font-semibold text-gray-600 dark:text-gray-400">
                              Mensagem {idx + 1}
                            </span>
                            <div className="flex items-center gap-2">
                              {hasCustom ? (
                                <>
                                  <span className="text-xs px-2 py-0.5 bg-[#8CD955]/20 text-[#5a8a2a] dark:text-[#8CD955] rounded font-medium">
                                    Personalizada
                                  </span>
                                  <button
                                    onClick={() => setSlotMessage(node.id, idx, null)}
                                    title="Remover personalização (usar mensagem do sistema)"
                                    className="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 rounded transition-colors"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </>
                              ) : (
                                <>
                                  <span className="text-xs px-2 py-0.5 bg-gray-200 dark:bg-[#404040] text-gray-500 dark:text-gray-400 rounded">
                                    Sistema
                                  </span>
                                  <button
                                    onClick={() => setSlotMessage(node.id, idx, sysMsg)}
                                    title="Criar mensagem personalizada para este slot"
                                    className="flex items-center gap-1 text-xs text-[#8CD955] hover:text-[#7BC84A] hover:bg-[#8CD955]/10 px-2 py-0.5 rounded transition-colors"
                                  >
                                    <Plus className="w-3 h-3" />
                                    Personalizar
                                  </button>
                                </>
                              )}
                            </div>
                          </div>

                          {/* Conteúdo do slot */}
                          <div className="p-3">
                            {hasCustom ? (
                              <div className="space-y-3">
                                {/* Chips arrastáveis — arraste para o texto ou clique para inserir no cursor */}
                                <div className="flex flex-wrap gap-1.5">
                                  {VARIABLES.map((v) => (
                                    <span
                                      key={v.label}
                                      draggable
                                      onDragStart={(e) => {
                                        e.dataTransfer.setData(DRAG_VAR, v.label);
                                        e.dataTransfer.setData('text/plain', v.label);
                                        e.dataTransfer.effectAllowed = 'copy';
                                      }}
                                      onClick={() => insertVariable(node.id, idx, v.label)}
                                      title={`Arraste para o texto ou clique para inserir: ${v.label}`}
                                      className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-[#8CD955]/20 dark:bg-[#8CD955]/30 text-[#5a8a2a] dark:text-[#8CD955] border border-[#8CD955]/40 rounded-md hover:bg-[#8CD955]/40 cursor-grab active:cursor-grabbing transition-colors font-mono select-none"
                                    >
                                      {v.label}
                                    </span>
                                  ))}
                                </div>
                                <textarea
                                  ref={(el) => { textareaRefs.current[refKey] = el; }}
                                  value={customVal ?? ''}
                                  onChange={(e) => setSlotMessage(node.id, idx, e.target.value)}
                                  onDragOver={handleTextareaDragOver}
                                  onDrop={(e) => handleTextareaDrop(e, node.id, idx)}
                                  rows={3}
                                  placeholder="Digite sua mensagem ou arraste as variáveis para cá..."
                                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-[#555] rounded-lg bg-white dark:bg-[#2a2a2a] text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] resize-none"
                                />
                                {/* Prévia: variáveis em verde; duplo clique remove, arraste move */}
                                <div className="mt-2 px-3 py-2.5 border border-gray-200 dark:border-[#404040] rounded-lg bg-gray-50 dark:bg-[#1f1f1f] min-h-[52px]">
                                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-1.5">
                                    Prévia da mensagem — duplo clique na variável para remover · arraste para reposicionar
                                  </p>
                                  <div className="text-sm text-gray-900 dark:text-gray-200">
                                    <MessagePreviewWithVariables
                                      text={customVal ?? ''}
                                      onDeleteVariable={(start, end) => {
                                        const newValue = removeVariableAtPosition(customVal ?? '', start, end);
                                        setSlotMessage(node.id, idx, newValue);
                                      }}
                                      onValueChange={(newValue) => setSlotMessage(node.id, idx, newValue)}
                                    />
                                  </div>
                                </div>
                              </div>
                            ) : (
                              <p className="text-sm text-gray-500 dark:text-gray-400 italic leading-relaxed">
                                {sysMsg}
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 dark:border-[#404040] bg-gray-50 dark:bg-[#333] rounded-b-xl flex justify-end gap-3">
          <button
            onClick={handleClose}
            className="px-5 py-2.5 bg-white dark:bg-[#2a2a2a] border border-gray-300 dark:border-[#555] text-gray-700 dark:text-white hover:bg-gray-50 dark:hover:bg-[#404040] rounded-lg text-sm font-medium transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !instanceName || groupJids.length === 0}
            className="px-5 py-2.5 bg-[#8CD955] text-white rounded-lg hover:bg-[#7BC84A] transition font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-sm"
          >
            {saving ? (
              <><Loader2 className="w-4 h-4 animate-spin" />Salvando...</>
            ) : (
              <><Save className="w-4 h-4" />Salvar</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
