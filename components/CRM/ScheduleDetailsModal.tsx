'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { X, Calendar, Clock, Users, MessageSquare, Edit2, ExternalLink, Save, Loader2, Plus, Trash2 } from 'lucide-react';
import { useToast } from '@/hooks/useToast';
import { supabase } from '@/lib/supabase';

interface ScheduleDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  schedule: any;
  groupSchedules?: any[];
  userId: string | null;
  onUpdate: () => void;
  onEditMessage: (messageId: string) => void;
}

const ScheduleDetailsModal: React.FC<ScheduleDetailsModalProps> = ({
  isOpen,
  onClose,
  schedule,
  groupSchedules = [],
  userId,
  onUpdate,
  onEditMessage,
}) => {
  const { showToast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showAddGroups, setShowAddGroups] = useState(false);
  const [addingGroups, setAddingGroups] = useState(false);
  const [selectedGroupIdsToAdd, setSelectedGroupIdsToAdd] = useState<string[]>([]);
  const [instances, setInstances] = useState<{ instance_name: string }[]>([]);
  const [groups, setGroups] = useState<{ group_id: string; group_subject: string }[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [formData, setFormData] = useState({
    selectedDate: '',
    selectedTime: '',
    instance_name: schedule?.instance_name || '',
    group_id: schedule?.group_id || '',
    group_subject: schedule?.group_subject || '',
  });

  const loadInstancesAndGroups = useCallback(async () => {
    if (!userId) return;
    setLoadingOptions(true);
    try {
      const [instRes, { data: groupsData }] = await Promise.all([
        fetch('/api/instances', { headers: { 'X-User-Id': userId } }),
        supabase.from('whatsapp_groups').select('group_id, group_subject').eq('user_id', userId).order('group_subject', { ascending: true }),
      ]);
      const instJson = await instRes.json();
      if (instRes.ok && instJson.data) setInstances(instJson.data);
      if (groupsData) setGroups(groupsData as { group_id: string; group_subject: string }[]);
    } catch (e) {
      console.error('Erro ao carregar instâncias/grupos:', e);
    } finally {
      setLoadingOptions(false);
    }
  }, [userId]);

  useEffect(() => {
    if (schedule) {
      const base = {
        instance_name: schedule.instance_name || '',
        group_id: schedule.group_id || '',
        group_subject: schedule.group_subject || '',
      };
      if (schedule.scheduled_at_utc) {
        const date = new Date(schedule.scheduled_at_utc);
        const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
        setFormData({
          selectedDate: localDate.toISOString().split('T')[0],
          selectedTime: localDate.toTimeString().slice(0, 5),
          ...base,
        });
      } else if (schedule.recurring_time) {
        setFormData({
          selectedDate: '',
          selectedTime: schedule.recurring_time || '',
          ...base,
        });
      } else {
        setFormData((prev) => ({ ...prev, ...base }));
      }
    }
  }, [schedule]);

  useEffect(() => {
    if (isOpen && userId && (isEditing || showAddGroups)) {
      loadInstancesAndGroups();
    }
  }, [isOpen, userId, isEditing, showAddGroups, loadInstancesAndGroups]);

  const currentGroupIds = groupSchedules.length > 0 ? groupSchedules.map((s) => s.group_id) : [schedule?.group_id ? [schedule.group_id] : []].flat();
  const availableGroupsToAdd = groups.filter((g) => !currentGroupIds.includes(g.group_id));

  const handleRemoveFromDisparo = async (scheduleId: string) => {
    if (!userId) return;
    try {
      const res = await fetch(`/api/crm/activations/schedules/${scheduleId}`, {
        method: 'DELETE',
        headers: { 'X-User-Id': userId },
      });
      const data = await res.json();
      if (res.ok) {
        showToast('Grupo removido do disparo.', 'success');
        onUpdate();
        onClose();
      } else {
        showToast(data?.error || 'Erro ao remover.', 'error');
      }
    } catch (e) {
      console.error(e);
      showToast('Erro ao remover grupo do disparo.', 'error');
    }
  };

  const handleAddGroupsToDisparo = async () => {
    if (!userId || !schedule?.id || selectedGroupIdsToAdd.length === 0) return;
    setAddingGroups(true);
    try {
      const res = await fetch('/api/crm/activations/schedules/add-groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
        body: JSON.stringify({ sourceScheduleId: schedule.id, groupIds: selectedGroupIdsToAdd }),
      });
      const data = await res.json();
      if (res.ok) {
        showToast(data?.message || 'Grupos adicionados.', 'success');
        setSelectedGroupIdsToAdd([]);
        setShowAddGroups(false);
        onUpdate();
      } else {
        showToast(data?.error || 'Erro ao adicionar grupos.', 'error');
      }
    } catch (e) {
      console.error(e);
      showToast('Erro ao adicionar grupos.', 'error');
    } finally {
      setAddingGroups(false);
    }
  };

  const instancesWithCurrent = schedule?.instance_name && !instances.some((i) => i.instance_name === schedule.instance_name)
    ? [{ instance_name: schedule.instance_name }, ...instances]
    : instances;
  const groupsWithCurrent = schedule?.group_id && !groups.some((g) => g.group_id === schedule.group_id)
    ? [{ group_id: schedule.group_id, group_subject: schedule.group_subject || schedule.group_id }, ...groups]
    : groups;

  if (!isOpen || !schedule) return null;

  const formatDate = (dateString: string) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const handleSave = async () => {
    if (!userId) return;

    setSaving(true);
    try {
      // Converter data/hora local para UTC
      let scheduled_at_utc = null;
      if (formData.selectedDate && formData.selectedTime) {
        const localDateTime = new Date(`${formData.selectedDate}T${formData.selectedTime}`);
        scheduled_at_utc = localDateTime.toISOString();
      }

      const response = await fetch(`/api/crm/activations/schedules/${schedule.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': userId,
        },
        body: JSON.stringify({
          scheduled_at_utc: scheduled_at_utc,
          instance_name: formData.instance_name || undefined,
          group_id: formData.group_id || undefined,
          group_subject: formData.group_subject || undefined,
        }),
      });

      const data = await response.json();
      if (response.ok) {
        showToast('Agendamento atualizado com sucesso', 'success');
        setIsEditing(false);
        onUpdate();
      } else {
        showToast(`Erro: ${data.error || 'Erro ao atualizar agendamento'}`, 'error');
      }
    } catch (error) {
      console.error('Erro ao atualizar agendamento:', error);
      showToast('Erro ao atualizar agendamento', 'error');
    } finally {
      setSaving(false);
    }
  };

  const isRecurring = schedule.schedule_type === 'recurring';
  const statusColors: Record<string, string> = {
    scheduled: 'bg-green-500',
    processing: 'bg-blue-500',
    sent: 'bg-gray-500',
    failed: 'bg-red-500',
    paused: 'bg-orange-500',
    canceled: 'bg-gray-500',
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
      <div className="bg-gray-100 dark:bg-[#2a2a2a] border border-gray-200 dark:border-[#404040] rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-gray-200 dark:border-[#404040] flex items-center justify-between bg-white dark:bg-[#333]">
          <div>
            <h2 className="text-gray-800 dark:text-white font-bold text-xl">Detalhes do Agendamento</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">ID: {schedule.id.slice(0, 8)}...</p>
          </div>
          <div className="flex items-center gap-2">
            {isEditing && (
              <button
                onClick={() => setIsEditing(false)}
                className="px-4 py-2 bg-gray-200 dark:bg-[#404040] hover:bg-gray-300 dark:hover:bg-[#505050] text-gray-800 dark:text-white font-medium rounded-lg transition-colors"
              >
                Cancelar
              </button>
            )}
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-200 dark:hover:bg-[#404040] rounded-full text-gray-600 dark:text-gray-400 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-white dark:bg-[#2a2a2a]">
          {/* Status Badge */}
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Status:</span>
            <span className={`px-3 py-1 rounded-full text-white text-sm font-medium ${statusColors[schedule.status] || 'bg-gray-500'}`}>
              {schedule.status === 'scheduled' ? 'Agendado' :
               schedule.status === 'processing' ? 'Processando' :
               schedule.status === 'sent' ? 'Enviado' :
               schedule.status === 'failed'
                 ? (schedule.last_error?.trim() || 'Falhou')
                 : schedule.status === 'paused' ? 'Pausado' :
               schedule.status === 'canceled' ? 'Cancelado' : schedule.status}
            </span>
            {(schedule.status === 'failed' || schedule.status === 'paused') && (
              <p className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/30 px-2 py-1 rounded w-full mt-1">
                Troque a instância e salve para reativar o disparo.
              </p>
            )}
          </div>

          {/* Tipo de Agendamento */}
          <div className="flex items-center gap-3">
            <Calendar className="w-5 h-5 text-gray-600 dark:text-gray-400" />
            <div>
              <span className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Tipo:</span>
              <span className="ml-2 px-2 py-1 bg-blue-500 text-white rounded-full text-xs font-medium">
                {isRecurring ? 'Recorrente' : 'Pontual'}
              </span>
            </div>
          </div>

          {/* Título da Mensagem */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <MessageSquare className="w-5 h-5 text-gray-600 dark:text-gray-400" />
              <span className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Mensagem:</span>
            </div>
            <div className="bg-white dark:bg-[#333] rounded-xl p-4 border border-gray-200 dark:border-[#404040]">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-bold text-gray-800 dark:text-white">
                    {schedule.messages?.title || schedule.message_title || 'N/A'}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">ID: {schedule.message_id?.slice(0, 8)}...</p>
                </div>
                <button
                  onClick={() => {
                    onEditMessage(schedule.message_id);
                    onClose();
                  }}
                  className="px-3 py-2 bg-[#8CD955] hover:bg-[#7BC84A] text-white rounded-lg font-medium transition-colors flex items-center gap-2"
                >
                  <ExternalLink className="w-4 h-4" />
                  Editar mensagem
                </button>
              </div>
            </div>
          </div>

          {/* Data e Hora Programada */}
          {!isEditing ? (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Clock className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                <span className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                  {isRecurring ? 'Horário Recorrente:' : 'Data Programada:'}
                </span>
              </div>
              <div className="bg-white dark:bg-[#333] rounded-xl p-4 border border-gray-200 dark:border-[#404040]">
                {isRecurring ? (
                  <div className="space-y-2">
                    <p className="text-gray-800 dark:text-white font-medium">
                      {schedule.recurring_days && Array.isArray(schedule.recurring_days) 
                        ? schedule.recurring_days.join(', ')
                        : schedule.recurring_days || 'N/A'}
                    </p>
                    <p className="text-gray-600 dark:text-gray-400 text-sm">{schedule.recurring_time || 'N/A'}</p>
                    {schedule.next_run_utc && (
                      <p className="text-gray-500 dark:text-gray-400 text-xs mt-2">
                        Próxima execução: {formatDate(schedule.next_run_utc)}
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-gray-800 dark:text-white font-medium">
                    {schedule.scheduled_at_utc ? formatDate(schedule.scheduled_at_utc) : 'N/A'}
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Clock className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                <span className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                  {isRecurring ? 'Horário Recorrente:' : 'Data Programada:'}
                </span>
              </div>
              <div className="bg-white dark:bg-[#333] rounded-xl p-4 border border-gray-200 dark:border-[#404040] space-y-4">
                {!isRecurring && (
                  <>
                    <div>
                      <label className="text-xs text-gray-600 dark:text-gray-400 font-semibold uppercase tracking-wider mb-1 block">
                        Data
                      </label>
                      <input
                        type="date"
                        value={formData.selectedDate}
                        onChange={(e) => setFormData({ ...formData, selectedDate: e.target.value })}
                        min={new Date().toISOString().split('T')[0]}
                        className="w-full px-4 py-2 border border-gray-300 dark:border-[#555] rounded-xl focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] text-gray-800 dark:text-white bg-white dark:bg-[#333]"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-600 dark:text-gray-400 font-semibold uppercase tracking-wider mb-1 block">
                        Hora
                      </label>
                      <input
                        type="time"
                        value={formData.selectedTime}
                        onChange={(e) => setFormData({ ...formData, selectedTime: e.target.value })}
                        className="w-full px-4 py-2 border border-gray-300 dark:border-[#555] rounded-xl focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] text-gray-800 dark:text-white bg-white dark:bg-[#333]"
                      />
                    </div>
                  </>
                )}
                {isRecurring && (
                  <div>
                    <label className="text-xs text-gray-600 dark:text-gray-400 font-semibold uppercase tracking-wider mb-1 block">
                      Horário
                    </label>
                    <input
                      type="time"
                      value={formData.selectedTime}
                      onChange={(e) => setFormData({ ...formData, selectedTime: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 dark:border-[#555] rounded-xl focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] text-gray-800 dark:text-white bg-white dark:bg-[#333]"
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Instância */}
          {!isEditing ? (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Users className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                <span className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Instância:</span>
              </div>
              <div className="bg-white dark:bg-[#333] rounded-xl p-4 border border-gray-200 dark:border-[#404040]">
                <p className="text-gray-800 dark:text-white font-medium">{schedule.instance_name || 'N/A'}</p>
              </div>
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Users className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                <span className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Instância:</span>
              </div>
              <div className="bg-white dark:bg-[#333] rounded-xl p-4 border border-gray-200 dark:border-[#404040]">
                {loadingOptions ? (
                  <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 text-sm">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Carregando instâncias...
                  </div>
                ) : (
                  <select
                    value={formData.instance_name}
                    onChange={(e) => setFormData({ ...formData, instance_name: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-[#555] rounded-xl focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] text-gray-800 dark:text-white bg-white dark:bg-[#333]"
                  >
                    <option value="">Selecione a instância</option>
                    {instancesWithCurrent.map((inst) => (
                      <option key={inst.instance_name} value={inst.instance_name}>
                        {inst.instance_name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>
          )}

          {/* Grupos neste disparo */}
          <div>
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                <span className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                  Grupos neste disparo {groupSchedules.length > 0 ? `(${groupSchedules.length})` : ''}
                </span>
              </div>
              {!isEditing && groupSchedules.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowAddGroups(true)}
                  className="px-3 py-1.5 bg-[#8CD955] hover:bg-[#7BC84A] text-white rounded-lg text-sm font-medium flex items-center gap-1"
                >
                  <Plus className="w-4 h-4" />
                  Adicionar grupos
                </button>
              )}
            </div>
            <div className="bg-white dark:bg-[#333] rounded-xl p-4 border border-gray-200 dark:border-[#404040] space-y-2">
              {groupSchedules.length > 0 ? (
                <ul className="space-y-2">
                  {groupSchedules.map((s) => (
                    <li
                      key={s.id}
                      className="flex items-center justify-between gap-2 py-2 border-b border-gray-100 dark:border-[#404040] last:border-0"
                    >
                      <span className="text-gray-800 dark:text-white font-medium truncate">
                        {s.group_subject || s.group_id}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleRemoveFromDisparo(s.id)}
                        className="shrink-0 px-2 py-1 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 rounded text-sm font-medium flex items-center gap-1"
                        title="Remover este grupo do disparo"
                      >
                        <Trash2 className="w-4 h-4" />
                        Remover
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <>
                  <p className="text-gray-800 dark:text-white font-medium">
                    {schedule.group_subject || schedule.group_id || 'N/A'}
                  </p>
                  {schedule.group_subject && schedule.group_id && schedule.group_subject !== schedule.group_id && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">ID: {schedule.group_id}</p>
                  )}
                </>
              )}
            </div>
            {showAddGroups && (
              <div className="mt-4 p-4 bg-gray-50 dark:bg-[#333] rounded-xl border border-gray-200 dark:border-[#404040]">
                <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Selecione os grupos a adicionar:</p>
                {loadingOptions ? (
                  <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 text-sm">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Carregando grupos...
                  </div>
                ) : availableGroupsToAdd.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">Todos os seus grupos já estão neste disparo.</p>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {availableGroupsToAdd.map((g) => (
                      <label key={g.group_id} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedGroupIdsToAdd.includes(g.group_id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedGroupIdsToAdd((prev) => [...prev, g.group_id]);
                            } else {
                              setSelectedGroupIdsToAdd((prev) => prev.filter((id) => id !== g.group_id));
                            }
                          }}
                          className="rounded border-gray-300 text-[#8CD955] focus:ring-[#8CD955]"
                        />
                        <span className="text-sm text-gray-800 dark:text-white">{g.group_subject || g.group_id}</span>
                      </label>
                    ))}
                  </div>
                )}
                <div className="flex gap-2 mt-3">
                  <button
                    type="button"
                    onClick={handleAddGroupsToDisparo}
                    disabled={addingGroups || selectedGroupIdsToAdd.length === 0}
                    className="px-4 py-2 bg-[#8CD955] hover:bg-[#7BC84A] disabled:opacity-50 text-white rounded-lg text-sm font-medium flex items-center gap-2"
                  >
                    {addingGroups ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    Adicionar selecionados
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowAddGroups(false); setSelectedGroupIdsToAdd([]); }}
                    className="px-4 py-2 bg-gray-200 dark:bg-[#404040] hover:bg-gray-300 dark:hover:bg-[#505050] text-gray-700 dark:text-white rounded-lg text-sm font-medium"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}
            {isEditing && groupSchedules.length === 0 && (
              <div className="mt-2">
                {loadingOptions ? (
                  <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 text-sm">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Carregando grupos...
                  </div>
                ) : (
                  <select
                    value={formData.group_id}
                    onChange={(e) => {
                      const g = groupsWithCurrent.find((gr) => gr.group_id === e.target.value);
                      setFormData({
                        ...formData,
                        group_id: e.target.value,
                        group_subject: g?.group_subject || '',
                      });
                    }}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-[#555] rounded-xl focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] text-gray-800 dark:text-white bg-white dark:bg-[#333]"
                  >
                    <option value="">Selecione o grupo</option>
                    {groupsWithCurrent.map((g) => (
                      <option key={g.group_id} value={g.group_id}>
                        {g.group_subject || g.group_id}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}
          </div>

          {/* Informações Adicionais */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <span className="text-xs text-gray-600 dark:text-gray-400 font-semibold uppercase tracking-wider block mb-2">
                Criação:
              </span>
              <div className="bg-white dark:bg-[#333] rounded-xl p-4 border border-gray-200 dark:border-[#404040]">
                <p className="text-gray-800 dark:text-white text-sm">{formatDate(schedule.created_at)}</p>
              </div>
            </div>
            <div>
              <span className="text-xs text-gray-600 dark:text-gray-400 font-semibold uppercase tracking-wider block mb-2">
                Última Execução:
              </span>
              <div className="bg-white dark:bg-[#333] rounded-xl p-4 border border-gray-200 dark:border-[#404040]">
                <p className="text-gray-800 dark:text-white text-sm">
                  {schedule.sent_at ? formatDate(schedule.sent_at) : 'Nunca executado'}
                </p>
              </div>
            </div>
          </div>

          {schedule.last_error && (
            <div>
              <span className="text-xs text-gray-600 dark:text-gray-400 font-semibold uppercase tracking-wider block mb-2">
                Último Erro:
              </span>
              <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-xl p-4">
                <p className="text-red-800 dark:text-red-300 text-sm">{schedule.last_error}</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-gray-200 dark:border-[#404040] bg-white dark:bg-[#333] flex gap-3">
          {!isEditing ? (
            <button
              onClick={() => setIsEditing(true)}
              className="flex-1 px-4 py-3 bg-[#8CD955] hover:bg-[#7BC84A] text-white font-bold rounded-xl transition-all flex items-center justify-center gap-2"
            >
              <Edit2 className="w-5 h-5" />
              Editar
            </button>
          ) : (
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 px-4 py-3 bg-[#8CD955] hover:bg-[#7BC84A] disabled:opacity-50 text-white font-bold rounded-xl transition-all flex items-center justify-center gap-2"
            >
              {saving ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <>
                  <Save className="w-5 h-5" />
                  Salvar alterações
                </>
              )}
            </button>
          )}
          <button
            onClick={onClose}
            className="px-4 py-3 bg-gray-200 dark:bg-[#404040] hover:bg-gray-300 dark:hover:bg-[#505050] text-gray-800 dark:text-white font-bold rounded-xl transition-colors"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};

export default ScheduleDetailsModal;

