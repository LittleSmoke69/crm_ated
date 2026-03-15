'use client';

import React, { useState, useEffect } from 'react';
import { X, Search, Check, Calendar, Clock, ArrowLeft, ArrowRight, Loader2, Plus, CheckCircle2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { deduplicateGroupsById } from '@/lib/utils/group-utils';
import { useToast } from '@/hooks/useToast';
import ToastContainer from '@/components/Toast/ToastContainer';

interface Group {
  id: string;
  subject: string;
}

interface ScheduleMessageModalProps {
  isOpen: boolean;
  onClose: () => void;
  messageId: string;
  messageTitle: string;
  userId: string;
}

type ScheduleType = 'once' | 'recurring';
type Step = 1 | 2 | 3 | 4;

const ScheduleMessageModal: React.FC<ScheduleMessageModalProps> = ({
  isOpen,
  onClose,
  messageId,
  messageTitle,
  userId,
}) => {
  const [currentStep, setCurrentStep] = useState<Step>(1);
  const [scheduleType, setScheduleType] = useState<ScheduleType>('once');
  
  // Step 1: Action selection
  const [selectedAction, setSelectedAction] = useState<'send' | null>(null);
  
  // Step 2: Date and time
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedTime, setSelectedTime] = useState('');
  const [recurringDays, setRecurringDays] = useState<Set<string>>(new Set());
  const [recurringTime, setRecurringTime] = useState('');
  const [timezone, setTimezone] = useState('America/Sao_Paulo');
  
  // Step 3: Groups
  const [groups, setGroups] = useState<Group[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
  const [instances, setInstances] = useState<any[]>([]);
  const [selectedInstance, setSelectedInstance] = useState<string>('');
  const [fetchingAll, setFetchingAll] = useState(false);
  const [savingAllGroups, setSavingAllGroups] = useState(false);
  const [loading, setLoading] = useState(false);
  
  // Step 4: Confirm
  const [saving, setSaving] = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(false);
  
  const { toasts, showToast, removeToast } = useToast();

  const daysOfWeek = [
    { value: 'monday', label: 'Segunda-feira' },
    { value: 'tuesday', label: 'Terça-feira' },
    { value: 'wednesday', label: 'Quarta-feira' },
    { value: 'thursday', label: 'Quinta-feira' },
    { value: 'friday', label: 'Sexta-feira' },
    { value: 'saturday', label: 'Sábado' },
    { value: 'sunday', label: 'Domingo' },
  ];

  // Carrega grupos do banco de dados filtrados pela instância selecionada
  const fetchDbGroups = async (instanceName?: string) => {
    const instance = instanceName ?? selectedInstance;
    if (!instance) {
      setGroups([]);
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('whatsapp_groups')
        .select('group_id, group_subject')
        .eq('user_id', userId)
        .eq('instance_name', instance)
        .order('group_subject', { ascending: true });

      if (error) throw error;

      const formattedGroups = (data || []).map(g => ({
        id: g.group_id,
        subject: g.group_subject
      }));
      setGroups(formattedGroups);
    } catch (error) {
      console.error('Erro ao buscar grupos do banco:', error);
    } finally {
      setLoading(false);
    }
  };

  // Carrega grupos da Evolution
  const fetchEvolutionGroups = async () => {
    if (!selectedInstance) {
      showToast('Selecione uma instância primeiro', 'error');
      return;
    }
    setFetchingAll(true);
    try {
      const response = await fetch('/api/groups/fetch', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-User-Id': userId 
        },
        body: JSON.stringify({ instanceName: selectedInstance }),
      });
      const data = await response.json();
      if (data.success) {
        const evoGroups = (data.data || []).map((g: any) => ({
          id: g.id || g.remoteJid,
          subject: g.subject
        }));
        
        setGroups(prev => {
          const existingIds = new Set(prev.map(p => p.id));
          const newOnes = evoGroups.filter((g: any) => !existingIds.has(g.id));
          return [...prev, ...newOnes].sort((a, b) => a.subject.localeCompare(b.subject));
        });
        showToast(`${evoGroups.length} grupos sincronizados da instância!`, 'success');
      } else {
        showToast(`Erro ao buscar grupos: ${data.error}`, 'error');
      }
    } catch (error) {
      console.error('Erro ao buscar grupos:', error);
      showToast('Erro inesperado ao buscar grupos', 'error');
    } finally {
      setFetchingAll(false);
    }
  };

  const handleSaveAllGroups = async () => {
    if (!selectedInstance || groups.length === 0) {
      showToast('Extraia os grupos primeiro', 'error');
      return;
    }
    setSavingAllGroups(true);
    try {
      const payload = groups.map((g) => ({ id: g.id, subject: g.subject || null }));
      const r = await fetch('/api/groups/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
        body: JSON.stringify({ instanceName: selectedInstance, groups: payload }),
      });
      const data = await r.json();
      if (r.ok && data.success) {
        const { inserted = 0, updated = 0 } = data.data || {};
        showToast(`${inserted + updated} grupo(s) salvos no banco (sem duplicar existentes)`, 'success');
        await fetchDbGroups(selectedInstance);
      } else {
        showToast(data.error || 'Erro ao salvar grupos', 'error');
      }
    } catch {
      showToast('Erro ao salvar todos os grupos', 'error');
    } finally {
      setSavingAllGroups(false);
    }
  };

  // Inicialização: busca instâncias ao abrir
  useEffect(() => {
    if (isOpen && userId) {
      fetch('/api/instances', {
        headers: { 'X-User-Id': userId },
      })
        .then(res => res.json())
        .then(data => {
          if (data.success) {
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
    }
  }, [isOpen, userId]);

  // Carrega grupos quando a instância selecionada muda (step 3)
  useEffect(() => {
    if (isOpen && selectedInstance) {
      fetchDbGroups(selectedInstance);
    } else if (isOpen && !selectedInstance) {
      setGroups([]);
    }
  }, [isOpen, selectedInstance]);

  // Reset ao fechar
  useEffect(() => {
    if (!isOpen) {
      setCurrentStep(1);
      setScheduleType('once');
      setSelectedAction(null);
      setSelectedDate('');
      setSelectedTime('');
      setRecurringDays(new Set());
      setRecurringTime('');
      setSelectedGroups(new Set());
      setSearchQuery('');
    }
  }, [isOpen]);

  const filteredGroups = groups.filter(g => 
    g.subject.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleSelectAll = () => {
    if (selectedGroups.size === filteredGroups.length) {
      setSelectedGroups(new Set());
    } else {
      setSelectedGroups(new Set(filteredGroups.map(g => g.id)));
    }
  };

  const toggleGroup = (groupId: string) => {
    const newSelected = new Set(selectedGroups);
    if (newSelected.has(groupId)) {
      newSelected.delete(groupId);
    } else {
      newSelected.add(groupId);
    }
    setSelectedGroups(newSelected);
  };

  const toggleDay = (day: string) => {
    const newDays = new Set(recurringDays);
    if (newDays.has(day)) {
      newDays.delete(day);
    } else {
      newDays.add(day);
    }
    setRecurringDays(newDays);
  };

  const canGoToNextStep = () => {
    if (currentStep === 1) return selectedAction === 'send';
    if (currentStep === 2) {
      if (scheduleType === 'once') {
        // Verifica se ambos têm valores válidos (não vazios)
        const hasDate = selectedDate && selectedDate.length > 0;
        const hasTime = selectedTime && selectedTime.length > 0;
        return hasDate && hasTime;
      } else {
        return recurringDays.size > 0 && recurringTime && recurringTime.length > 0;
      }
    }
    if (currentStep === 3) {
      return selectedGroups.size > 0 && selectedInstance && selectedInstance.length > 0;
    }
    return true;
  };

  const handleNext = () => {
    if (canGoToNextStep() && currentStep < 4) {
      setCurrentStep((currentStep + 1) as Step);
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep((currentStep - 1) as Step);
    }
  };

  // Converte data/hora local para UTC
  const convertToUTC = (date: string, time: string, tz: string): string => {
    if (!date || !time) return '';
    
    // Cria data no timezone especificado
    const localDateTime = `${date}T${time}`;
    const dateObj = new Date(localDateTime);
    
    // Retorna em ISO (já está em UTC)
    return dateObj.toISOString();
  };

  // Calcula próximo horário para agendamento recorrente
  const calculateNextRecurringRun = (days: string[], time: string, tz: string): string => {
    if (days.length === 0 || !time) return '';
    
    const now = new Date();
    const [hours, minutes] = time.split(':').map(Number);
    
    // Encontra o próximo dia da semana
    const dayMap: Record<string, number> = {
      'sunday': 0,
      'monday': 1,
      'tuesday': 2,
      'wednesday': 3,
      'thursday': 4,
      'friday': 5,
      'saturday': 6,
    };
    
    const selectedDayNumbers = days.map(d => dayMap[d]).filter(d => d !== undefined).sort((a, b) => a - b);
    if (selectedDayNumbers.length === 0) return '';
    
    const currentDay = now.getDay();
    
    // Cria uma cópia da data atual
    const nextDate = new Date(now);
    nextDate.setHours(hours, minutes, 0, 0);
    
    // Encontra o próximo dia válido
    let nextDay = selectedDayNumbers.find(d => d > currentDay);
    if (!nextDay) {
      // Se não encontrou um dia depois de hoje, pega o primeiro da lista (próxima semana)
      nextDay = selectedDayNumbers[0];
      const daysUntilNext = (7 - currentDay + nextDay) % 7 || 7;
      nextDate.setDate(nextDate.getDate() + daysUntilNext);
    } else {
      // Encontrou um dia depois de hoje
      const daysUntilNext = nextDay - currentDay;
      nextDate.setDate(nextDate.getDate() + daysUntilNext);
    }
    
    // Se o horário já passou hoje e é um dos dias selecionados: sequencial (ex: seg → ter = +1)
    if (selectedDayNumbers.includes(currentDay) && nextDate < now) {
      const nextDayInWeek = selectedDayNumbers.find(d => d > currentDay);
      const daysToAdd = nextDayInWeek !== undefined
        ? nextDayInWeek - currentDay
        : (7 - currentDay + selectedDayNumbers[0]) % 7 || 7;
      nextDate.setDate(nextDate.getDate() + daysToAdd);
    }

    return nextDate.toISOString();
  };

  const handleSave = async () => {
    if (!canGoToNextStep()) return;
    
    setSaving(true);
    try {
      let scheduledAtUTC = '';
      let cronExpr = null;
      
      if (scheduleType === 'once') {
        scheduledAtUTC = convertToUTC(selectedDate, selectedTime, timezone);
      } else {
        scheduledAtUTC = calculateNextRecurringRun(
          Array.from(recurringDays),
          recurringTime,
          timezone
        );
        
        // Cria expressão cron (minuto hora * * dia-da-semana)
        // 0 = domingo, 1 = segunda, etc.
        const dayMap: Record<string, number> = {
          'sunday': 0,
          'monday': 1,
          'tuesday': 2,
          'wednesday': 3,
          'thursday': 4,
          'friday': 5,
          'saturday': 6,
        };
        const cronDays = Array.from(recurringDays).map(d => dayMap[d]).join(',');
        const [hours, minutes] = recurringTime.split(':');
        cronExpr = `${minutes} ${hours} * * ${cronDays}`;
      }

      const response = await fetch('/api/crm/activations/schedule', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': userId,
        },
        body: JSON.stringify({
          messageId,
          groupIds: Array.from(selectedGroups),
          instanceName: selectedInstance,
          scheduleType,
          scheduledAtUTC,
          cronExpr,
          timezone,
          recurringDays: scheduleType === 'recurring' ? Array.from(recurringDays) : null,
          recurringTime: scheduleType === 'recurring' ? recurringTime : null,
        }),
      });

      const data = await response.json();
      if (data.success) {
        showToast('Agendamento criado com sucesso! Você também pode criar campanhas de disparo em massa em Ativações > Campanhas de disparo.', 'success');
        onClose();
      } else {
        showToast(`Erro ao criar agendamento: ${data.error || 'Erro desconhecido'}`, 'error');
      }
    } catch (error: any) {
      console.error('Erro ao criar agendamento:', error);
      showToast(`Erro ao criar agendamento: ${error.message || 'Erro desconhecido'}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const formatRecurringSchedule = () => {
    if (recurringDays.size === 0 || !recurringTime) return '';
    
    const dayLabels: Record<string, string> = {
      'monday': 'Segunda-feira',
      'tuesday': 'Terça-feira',
      'wednesday': 'Quarta-feira',
      'thursday': 'Quinta-feira',
      'friday': 'Sexta-feira',
      'saturday': 'Sábado',
      'sunday': 'Domingo',
    };
    
    const sortedDays = Array.from(recurringDays)
      .map(d => dayLabels[d])
      .sort((a, b) => {
        const order = ['Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado', 'Domingo'];
        return order.indexOf(a) - order.indexOf(b);
      });
    
    return `${sortedDays.join(', ')} às ${recurringTime}`;
  };

  if (!isOpen) return null;

  return (
    <>
      <ToastContainer toasts={toasts} onClose={removeToast} />
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
      <div className="bg-gray-100 dark:bg-[#2a2a2a] border border-gray-200 dark:border-[#404040] rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-6 border-b border-gray-200 dark:border-[#404040] flex items-center justify-between bg-white dark:bg-[#333]">
          <div>
            <h2 className="text-gray-800 dark:text-white font-bold text-lg">Selecione os grupos para agendamento</h2>
          </div>
          <button 
            onClick={onClose}
            className="p-2 hover:bg-gray-200 dark:hover:bg-[#404040] rounded-full text-gray-600 dark:text-gray-400 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Progress Steps */}
        <div className="p-6 bg-white dark:bg-[#333] border-b border-gray-200 dark:border-[#404040]">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${
                currentStep >= 1 ? 'bg-[#8CD955] text-white' : 'bg-gray-300 dark:bg-[#404040] text-gray-600 dark:text-gray-400'
              }`}>
                {currentStep > 1 ? <CheckCircle2 className="w-5 h-5" /> : '1'}
              </div>
              <span className={`text-xs font-medium ${currentStep >= 1 ? 'text-[#8CD955]' : 'text-gray-500 dark:text-gray-400'}`}>
                Escolha
              </span>
            </div>
            <div className="flex-1 h-0.5 bg-gray-300 dark:bg-[#404040] mx-2">
              <div className={`h-full transition-all ${currentStep >= 2 ? 'bg-[#8CD955]' : ''}`} style={{ width: currentStep >= 2 ? '100%' : '0%' }}></div>
            </div>
            <div className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${
                currentStep >= 2 ? 'bg-[#8CD955] text-white' : 'bg-gray-300 dark:bg-[#404040] text-gray-600 dark:text-gray-400'
              }`}>
                {currentStep > 2 ? <CheckCircle2 className="w-5 h-5" /> : '2'}
              </div>
              <span className={`text-xs font-medium ${currentStep >= 2 ? 'text-[#8CD955]' : 'text-gray-500 dark:text-gray-400'}`}>
                Data e Hora
              </span>
            </div>
            <div className="flex-1 h-0.5 bg-gray-300 dark:bg-[#404040] mx-2">
              <div className={`h-full transition-all ${currentStep >= 3 ? 'bg-[#8CD955]' : ''}`} style={{ width: currentStep >= 3 ? '100%' : '0%' }}></div>
            </div>
            <div className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${
                currentStep >= 3 ? 'bg-[#8CD955] text-white' : 'bg-gray-300 dark:bg-[#404040] text-gray-600 dark:text-gray-400'
              }`}>
                {currentStep > 3 ? <CheckCircle2 className="w-5 h-5" /> : '3'}
              </div>
              <span className={`text-xs font-medium ${currentStep >= 3 ? 'text-[#8CD955]' : 'text-gray-500 dark:text-gray-400'}`}>
                Grupos
              </span>
            </div>
            <div className="flex-1 h-0.5 bg-gray-300 dark:bg-[#404040] mx-2">
              <div className={`h-full transition-all ${currentStep >= 4 ? 'bg-[#8CD955]' : ''}`} style={{ width: currentStep >= 4 ? '100%' : '0%' }}></div>
            </div>
            <div className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${
                currentStep >= 4 ? 'bg-[#8CD955] text-white' : 'bg-gray-300 dark:bg-[#404040] text-gray-600 dark:text-gray-400'
              }`}>
                4
              </div>
              <span className={`text-xs font-medium ${currentStep >= 4 ? 'text-[#8CD955]' : 'text-gray-500 dark:text-gray-400'}`}>
                Confirmar
              </span>
            </div>
          </div>
          <div className="text-center text-xs text-gray-600 dark:text-gray-400">
            {currentStep} de 4
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 bg-white dark:bg-[#2a2a2a]">
          {/* Step 1: Action Selection */}
          {currentStep === 1 && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-gray-800 dark:text-white mb-4">Selecionar ação</h3>
              <button
                onClick={() => setSelectedAction('send')}
                className={`w-full p-4 rounded-xl border-2 transition-all text-left ${
                  selectedAction === 'send'
                    ? 'border-[#8CD955] bg-[#8CD955]/10'
                    : 'border-gray-300 dark:border-[#555] hover:border-[#8CD955]/50'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-5 h-5 rounded border-2 flex items-center justify-center ${
                    selectedAction === 'send'
                      ? 'bg-[#8CD955] border-[#8CD955]'
                      : 'border-gray-300 dark:border-[#555]'
                  }`}>
                    {selectedAction === 'send' && <Check className="w-3.5 h-3.5 text-white stroke-[3]" />}
                  </div>
                  <span className="font-medium text-gray-800 dark:text-white">Enviar mensagem</span>
                </div>
              </button>
            </div>
          )}

          {/* Step 2: Date and Time */}
          {currentStep === 2 && (
            <div className="space-y-6">
              <h3 className="text-lg font-semibold text-gray-800 dark:text-white mb-4">Configurar agendamento</h3>
              
              {/* Schedule Type */}
              <div className="flex gap-4">
                <button
                  onClick={() => setScheduleType('once')}
                  className={`flex-1 p-3 rounded-xl border-2 transition-all ${
                    scheduleType === 'once'
                      ? 'border-[#8CD955] bg-[#8CD955]/10'
                      : 'border-gray-300 dark:border-[#555]'
                  }`}
                >
                  <span className="font-medium text-gray-800 dark:text-white">Pontual</span>
                </button>
                <button
                  onClick={() => setScheduleType('recurring')}
                  className={`flex-1 p-3 rounded-xl border-2 transition-all ${
                    scheduleType === 'recurring'
                      ? 'border-[#8CD955] bg-[#8CD955]/10'
                      : 'border-gray-300 dark:border-[#555]'
                  }`}
                >
                  <span className="font-medium text-gray-800 dark:text-white">Recorrente</span>
                </button>
              </div>

              {scheduleType === 'once' ? (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Data e hora</label>
                    <input
                      type="datetime-local"
                      value={selectedDate && selectedTime ? `${selectedDate}T${selectedTime}` : ''}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v) {
                          const [d, t] = v.split('T');
                          setSelectedDate(d || '');
                          setSelectedTime(t ? t.slice(0, 5) : '');
                        } else {
                          setSelectedDate('');
                          setSelectedTime('');
                        }
                      }}
                      min={(() => {
                        const n = new Date();
                        const y = n.getFullYear();
                        const m = String(n.getMonth() + 1).padStart(2, '0');
                        const d = String(n.getDate()).padStart(2, '0');
                        const h = String(n.getHours()).padStart(2, '0');
                        const min = String(n.getMinutes()).padStart(2, '0');
                        return `${y}-${m}-${d}T${h}:${min}`;
                      })()}
                      step="300"
                      className="w-full px-4 py-3 text-base border border-gray-300 dark:border-[#555] rounded-xl focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] text-gray-800 dark:text-white bg-white dark:bg-[#333] [color-scheme:light] dark:[color-scheme:dark]"
                    />
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Um único campo para escolher data e hora</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Dias da semana</label>
                    <div className="grid grid-cols-2 gap-2">
                      {daysOfWeek.map(day => (
                        <button
                          key={day.value}
                          onClick={() => toggleDay(day.value)}
                          className={`p-3 rounded-xl border-2 transition-all text-left ${
                            recurringDays.has(day.value)
                              ? 'border-[#8CD955] bg-[#8CD955]/10'
                              : 'border-gray-300 dark:border-[#555]'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <div className={`w-4 h-4 rounded border flex items-center justify-center ${
                              recurringDays.has(day.value)
                                ? 'bg-[#8CD955] border-[#8CD955]'
                                : 'border-gray-300 dark:border-[#555]'
                            }`}>
                              {recurringDays.has(day.value) && <Check className="w-3 h-3 text-white stroke-[3]" />}
                            </div>
                            <span className="text-sm font-medium text-gray-800 dark:text-white">{day.label}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Hora</label>
                    <div className="flex flex-wrap gap-2 mb-2">
                      {['08:00', '12:00', '14:00', '18:00'].map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setRecurringTime(t)}
                          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                            recurringTime === t
                              ? 'bg-[#8CD955] text-white border-2 border-[#8CD955]'
                              : 'bg-white dark:bg-[#333] text-gray-700 dark:text-gray-300 border-2 border-gray-300 dark:border-[#555] hover:border-[#8CD955]/50'
                          }`}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                    <input
                      type="time"
                      value={recurringTime}
                      onChange={(e) => setRecurringTime(e.target.value)}
                      step="300"
                      className="w-full px-4 py-3 text-base border border-gray-300 dark:border-[#555] rounded-xl focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] text-gray-800 dark:text-white bg-white dark:bg-[#333] [color-scheme:light] dark:[color-scheme:dark]"
                    />
                  </div>
                  
                  {recurringDays.size > 0 && recurringTime && (
                    <div className="bg-orange-50 dark:bg-orange-900/30 border border-orange-200 dark:border-orange-800 rounded-xl p-4">
                      <p className="text-sm font-semibold text-orange-800 dark:text-orange-300 mb-1">AGENDAMENTO RECORRENTE</p>
                      <p className="text-sm text-orange-700 dark:text-orange-400">{formatRecurringSchedule()}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Step 3: Groups */}
          {currentStep === 3 && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-gray-800 dark:text-white mb-4">Selecionar grupos</h3>
              
              {/* Instance Select */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Instância *</label>
                <select
                  value={selectedInstance}
                  onChange={(e) => setSelectedInstance(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-[#555] rounded-xl focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] bg-white dark:bg-[#333] text-gray-800 dark:text-white"
                >
                  {instances.length === 0 ? (
                    <option value="" className="text-gray-800">Nenhuma instância conectada</option>
                  ) : (
                    instances.map((inst) => (
                      <option key={inst.id} value={inst.instance_name} className="text-gray-800">
                        {inst.instance_name}
                      </option>
                    ))
                  )}
                </select>
              </div>

              {/* Recurring Schedule Info */}
              {scheduleType === 'recurring' && recurringDays.size > 0 && recurringTime && (
                <div className="bg-orange-50 dark:bg-orange-900/30 border border-orange-200 dark:border-orange-800 rounded-xl p-4">
                  <p className="text-sm font-semibold text-orange-800 dark:text-orange-300 mb-1">AGENDAMENTO RECORRENTE</p>
                  <p className="text-sm text-orange-700 dark:text-orange-400">{formatRecurringSchedule()}</p>
                </div>
              )}

              {/* Search and Select All */}
              <div className="flex items-center justify-between flex-wrap gap-2">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Grupos disponíveis *</span>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={fetchEvolutionGroups}
                    disabled={fetchingAll || !selectedInstance}
                    className="text-[#8CD955] hover:text-[#7BC84A] flex items-center gap-1.5 font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
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
                      disabled={savingAllGroups || !selectedInstance}
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
                  className="w-full bg-gray-100 dark:bg-[#333] border border-gray-200 dark:border-[#404040] rounded-xl pl-10 pr-4 py-2.5 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] placeholder:text-gray-500 dark:placeholder:text-gray-400"
                />
              </div>

              <div className="flex items-center justify-between">
                <label className="flex items-center gap-3 cursor-pointer">
                  <div className={`w-5 h-5 rounded border flex items-center justify-center ${
                    selectedGroups.size === filteredGroups.length && filteredGroups.length > 0
                      ? 'bg-[#8CD955] border-[#8CD955]'
                      : 'bg-white dark:bg-[#333] border-gray-300 dark:border-[#555]'
                  }`}>
                    {selectedGroups.size === filteredGroups.length && filteredGroups.length > 0 && (
                      <Check className="w-3.5 h-3.5 text-white stroke-[3]" />
                    )}
                  </div>
                  <span className="text-sm text-gray-700 dark:text-gray-300 font-medium">Selecionar todos os grupos</span>
                </label>
                <span className="text-[#8CD955] font-bold text-sm">
                  {selectedGroups.size} grupo{selectedGroups.size !== 1 ? 's' : ''} selecionado{selectedGroups.size !== 1 ? 's' : ''}
                </span>
              </div>

              {/* Groups List */}
              <div className="max-h-64 overflow-y-auto space-y-1 border border-gray-200 dark:border-[#404040] rounded-xl p-2">
                {loading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 text-[#8CD955] animate-spin" />
                  </div>
                ) : filteredGroups.length === 0 ? (
                  <div className="text-center py-8 text-gray-500 dark:text-gray-400 text-sm">Nenhum grupo encontrado</div>
                ) : (
                  filteredGroups.map((group) => (
                    <button
                      key={group.id}
                      onClick={() => toggleGroup(group.id)}
                      className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all ${
                        selectedGroups.has(group.id)
                          ? 'bg-[#8CD955]/10 border border-[#8CD955]/40'
                          : 'hover:bg-[#8CD955]/5 border border-transparent'
                      }`}
                    >
                      <div className={`w-5 h-5 rounded border flex items-center justify-center ${
                        selectedGroups.has(group.id)
                          ? 'bg-[#8CD955] border-[#8CD955]'
                          : 'bg-white dark:bg-[#333] border-gray-300 dark:border-[#555]'
                      }`}>
                        {selectedGroups.has(group.id) && <Check className="w-3.5 h-3.5 text-white stroke-[3]" />}
                      </div>
                      <span className={`text-sm font-medium truncate ${
                        selectedGroups.has(group.id) ? 'text-[#6AB83D]' : 'text-gray-700 dark:text-gray-300'
                      }`}>
                        {group.subject}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Step 4: Confirm */}
          {currentStep === 4 && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-gray-800 dark:text-white mb-4">Revisar e executar</h3>
              
              <div className="bg-white dark:bg-[#333] rounded-xl p-4 border border-gray-200 dark:border-[#404040] space-y-3">
                <div>
                  <span className="text-sm font-medium text-gray-600 dark:text-gray-400">Mensagem:</span>
                  <p className="text-gray-800 dark:text-white font-semibold">{messageTitle}</p>
                </div>
                <div>
                  <span className="text-sm font-medium text-gray-600 dark:text-gray-400">Tipo:</span>
                  <p className="text-gray-800 dark:text-white">{scheduleType === 'once' ? 'Pontual' : 'Recorrente'}</p>
                </div>
                {scheduleType === 'once' ? (
                  <>
                    <div>
                      <span className="text-sm font-medium text-gray-600 dark:text-gray-400">Data:</span>
                      <p className="text-gray-800 dark:text-white">{new Date(selectedDate).toLocaleDateString('pt-BR')}</p>
                    </div>
                    <div>
                      <span className="text-sm font-medium text-gray-600 dark:text-gray-400">Hora:</span>
                      <p className="text-gray-800 dark:text-white">{selectedTime}</p>
                    </div>
                  </>
                ) : (
                  <div>
                    <span className="text-sm font-medium text-gray-600 dark:text-gray-400">Agendamento:</span>
                    <p className="text-gray-800 dark:text-white">{formatRecurringSchedule()}</p>
                  </div>
                )}
                <div>
                  <span className="text-sm font-medium text-gray-600 dark:text-gray-400">Grupos:</span>
                  <p className="text-gray-800 dark:text-white">{selectedGroups.size} grupo(s) selecionado(s)</p>
                </div>
                <div>
                  <span className="text-sm font-medium text-gray-600 dark:text-gray-400">Instância:</span>
                  <p className="text-gray-800 dark:text-white">{selectedInstance}</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-gray-200 dark:border-[#404040] bg-white dark:bg-[#333] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="dontShowAgain"
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
              className="w-4 h-4 text-[#8CD955] rounded focus:ring-[#8CD955]"
            />
            <label htmlFor="dontShowAgain" className="text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
              Não mostrar novamente
            </label>
          </div>
          
          <div className="flex gap-3">
            {currentStep > 1 && (
              <button
                onClick={handleBack}
                className="px-4 py-2 bg-gray-200 dark:bg-[#404040] hover:bg-gray-300 dark:hover:bg-[#505050] text-gray-800 dark:text-white font-medium rounded-xl transition-colors flex items-center gap-2"
              >
                <ArrowLeft className="w-4 h-4" />
                Voltar
              </button>
            )}
            {currentStep < 4 ? (
              <button
                onClick={handleNext}
                disabled={!canGoToNextStep()}
                className="px-6 py-2 bg-[#8CD955] hover:bg-[#7BC84A] disabled:opacity-50 disabled:hover:bg-[#8CD955] text-white font-bold rounded-xl transition-all flex items-center gap-2"
              >
                Continuar
                <ArrowRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                onClick={handleSave}
                disabled={saving || !canGoToNextStep()}
                className="px-6 py-2 bg-[#8CD955] hover:bg-[#7BC84A] disabled:opacity-50 disabled:hover:bg-[#8CD955] text-white font-bold rounded-xl transition-all flex items-center gap-2"
              >
                {saving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Salvando...
                  </>
                ) : (
                  <>
                    Confirmar
                    <CheckCircle2 className="w-4 h-4" />
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
      </div>
    </>
  );
};

export default ScheduleMessageModal;

