'use client';

import React, { useState, useEffect } from 'react';
import { X, Search, Check, Calendar, Clock, ArrowLeft, ArrowRight, Loader2, Plus, CheckCircle2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
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

  // Carrega grupos do banco de dados
  const fetchDbGroups = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('whatsapp_groups')
        .select('group_id, group_subject')
        .eq('user_id', userId)
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

  // Inicialização
  useEffect(() => {
    if (isOpen && userId) {
      // Busca instâncias
      fetch('/api/instances', {
        headers: { 'X-User-Id': userId },
      })
        .then(res => res.json())
        .then(data => {
          if (data.success) {
            // Filtra apenas instâncias mestres conectadas para ativações
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

      // Busca grupos
      fetchDbGroups();
    }
  }, [isOpen, userId]);

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
    
    // Se o horário já passou hoje e é um dos dias selecionados: se todos os dias estão marcados = amanhã; senão = próxima semana
    if (selectedDayNumbers.includes(currentDay) && nextDate < now) {
      const allDaysSelected = selectedDayNumbers.length === 7;
      nextDate.setDate(nextDate.getDate() + (allDaysSelected ? 1 : 7));
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
        showToast('Agendamento criado com sucesso!', 'success');
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
      <div className="bg-gray-100 border border-gray-200 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-6 border-b border-gray-200 flex items-center justify-between bg-white">
          <div>
            <h2 className="text-gray-800 font-bold text-lg">Selecione os grupos para agendamento</h2>
          </div>
          <button 
            onClick={onClose}
            className="p-2 hover:bg-gray-200 rounded-full text-gray-600 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Progress Steps */}
        <div className="p-6 bg-white border-b border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${
                currentStep >= 1 ? 'bg-[#8CD955] text-white' : 'bg-gray-300 text-gray-600'
              }`}>
                {currentStep > 1 ? <CheckCircle2 className="w-5 h-5" /> : '1'}
              </div>
              <span className={`text-xs font-medium ${currentStep >= 1 ? 'text-[#8CD955]' : 'text-gray-500'}`}>
                Escolha
              </span>
            </div>
            <div className="flex-1 h-0.5 bg-gray-300 mx-2">
              <div className={`h-full transition-all ${currentStep >= 2 ? 'bg-[#8CD955]' : ''}`} style={{ width: currentStep >= 2 ? '100%' : '0%' }}></div>
            </div>
            <div className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${
                currentStep >= 2 ? 'bg-[#8CD955] text-white' : 'bg-gray-300 text-gray-600'
              }`}>
                {currentStep > 2 ? <CheckCircle2 className="w-5 h-5" /> : '2'}
              </div>
              <span className={`text-xs font-medium ${currentStep >= 2 ? 'text-[#8CD955]' : 'text-gray-500'}`}>
                Data e Hora
              </span>
            </div>
            <div className="flex-1 h-0.5 bg-gray-300 mx-2">
              <div className={`h-full transition-all ${currentStep >= 3 ? 'bg-[#8CD955]' : ''}`} style={{ width: currentStep >= 3 ? '100%' : '0%' }}></div>
            </div>
            <div className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${
                currentStep >= 3 ? 'bg-[#8CD955] text-white' : 'bg-gray-300 text-gray-600'
              }`}>
                {currentStep > 3 ? <CheckCircle2 className="w-5 h-5" /> : '3'}
              </div>
              <span className={`text-xs font-medium ${currentStep >= 3 ? 'text-[#8CD955]' : 'text-gray-500'}`}>
                Grupos
              </span>
            </div>
            <div className="flex-1 h-0.5 bg-gray-300 mx-2">
              <div className={`h-full transition-all ${currentStep >= 4 ? 'bg-[#8CD955]' : ''}`} style={{ width: currentStep >= 4 ? '100%' : '0%' }}></div>
            </div>
            <div className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${
                currentStep >= 4 ? 'bg-[#8CD955] text-white' : 'bg-gray-300 text-gray-600'
              }`}>
                4
              </div>
              <span className={`text-xs font-medium ${currentStep >= 4 ? 'text-[#8CD955]' : 'text-gray-500'}`}>
                Confirmar
              </span>
            </div>
          </div>
          <div className="text-center text-xs text-gray-600">
            {currentStep} de 4
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Step 1: Action Selection */}
          {currentStep === 1 && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-gray-800 mb-4">Selecionar ação</h3>
              <button
                onClick={() => setSelectedAction('send')}
                className={`w-full p-4 rounded-xl border-2 transition-all text-left ${
                  selectedAction === 'send'
                    ? 'border-[#8CD955] bg-[#8CD955]/10'
                    : 'border-gray-300 hover:border-[#8CD955]/50'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-5 h-5 rounded border-2 flex items-center justify-center ${
                    selectedAction === 'send'
                      ? 'bg-[#8CD955] border-[#8CD955]'
                      : 'border-gray-300'
                  }`}>
                    {selectedAction === 'send' && <Check className="w-3.5 h-3.5 text-white stroke-[3]" />}
                  </div>
                  <span className="font-medium text-gray-800">Enviar mensagem</span>
                </div>
              </button>
            </div>
          )}

          {/* Step 2: Date and Time */}
          {currentStep === 2 && (
            <div className="space-y-6">
              <h3 className="text-lg font-semibold text-gray-800 mb-4">Configurar agendamento</h3>
              
              {/* Schedule Type */}
              <div className="flex gap-4">
                <button
                  onClick={() => setScheduleType('once')}
                  className={`flex-1 p-3 rounded-xl border-2 transition-all ${
                    scheduleType === 'once'
                      ? 'border-[#8CD955] bg-[#8CD955]/10'
                      : 'border-gray-300'
                  }`}
                >
                  <span className="font-medium text-gray-800">Pontual</span>
                </button>
                <button
                  onClick={() => setScheduleType('recurring')}
                  className={`flex-1 p-3 rounded-xl border-2 transition-all ${
                    scheduleType === 'recurring'
                      ? 'border-[#8CD955] bg-[#8CD955]/10'
                      : 'border-gray-300'
                  }`}
                >
                  <span className="font-medium text-gray-800">Recorrente</span>
                </button>
              </div>

              {scheduleType === 'once' ? (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Data</label>
                    <input
                      type="date"
                      value={selectedDate}
                      onChange={(e) => setSelectedDate(e.target.value)}
                      min={new Date().toISOString().split('T')[0]}
                      className="w-full px-4 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] text-gray-800"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Hora</label>
                      <input
                        type="time"
                        value={selectedTime}
                        onChange={(e) => setSelectedTime(e.target.value)}
                        className="w-full px-4 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] text-gray-800"
                      />
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Dias da semana</label>
                    <div className="grid grid-cols-2 gap-2">
                      {daysOfWeek.map(day => (
                        <button
                          key={day.value}
                          onClick={() => toggleDay(day.value)}
                          className={`p-3 rounded-xl border-2 transition-all text-left ${
                            recurringDays.has(day.value)
                              ? 'border-[#8CD955] bg-[#8CD955]/10'
                              : 'border-gray-300'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <div className={`w-4 h-4 rounded border flex items-center justify-center ${
                              recurringDays.has(day.value)
                                ? 'bg-[#8CD955] border-[#8CD955]'
                                : 'border-gray-300'
                            }`}>
                              {recurringDays.has(day.value) && <Check className="w-3 h-3 text-white stroke-[3]" />}
                            </div>
                            <span className="text-sm font-medium text-gray-800">{day.label}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Hora</label>
                    <input
                      type="time"
                      value={recurringTime}
                      onChange={(e) => setRecurringTime(e.target.value)}
                      className="w-full px-4 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] text-gray-800"
                    />
                  </div>
                  
                  {recurringDays.size > 0 && recurringTime && (
                    <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
                      <p className="text-sm font-semibold text-orange-800 mb-1">AGENDAMENTO RECORRENTE</p>
                      <p className="text-sm text-orange-700">{formatRecurringSchedule()}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Step 3: Groups */}
          {currentStep === 3 && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-gray-800 mb-4">Selecionar grupos</h3>
              
              {/* Instance Select */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Instância *</label>
                <select
                  value={selectedInstance}
                  onChange={(e) => setSelectedInstance(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] bg-white text-gray-800"
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
                <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
                  <p className="text-sm font-semibold text-orange-800 mb-1">AGENDAMENTO RECORRENTE</p>
                  <p className="text-sm text-orange-700">{formatRecurringSchedule()}</p>
                </div>
              )}

              {/* Search and Select All */}
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700">Grupos disponíveis *</span>
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
              </div>

              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <input 
                  type="text" 
                  placeholder="Pesquisar grupos..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-gray-100 border border-gray-200 rounded-xl pl-10 pr-4 py-2.5 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] placeholder:text-gray-500"
                />
              </div>

              <div className="flex items-center justify-between">
                <label className="flex items-center gap-3 cursor-pointer">
                  <div className={`w-5 h-5 rounded border flex items-center justify-center ${
                    selectedGroups.size === filteredGroups.length && filteredGroups.length > 0
                      ? 'bg-[#8CD955] border-[#8CD955]'
                      : 'bg-white border-gray-300'
                  }`}>
                    {selectedGroups.size === filteredGroups.length && filteredGroups.length > 0 && (
                      <Check className="w-3.5 h-3.5 text-white stroke-[3]" />
                    )}
                  </div>
                  <span className="text-sm text-gray-700 font-medium">Selecionar todos os grupos</span>
                </label>
                <span className="text-[#8CD955] font-bold text-sm">
                  {selectedGroups.size} grupo{selectedGroups.size !== 1 ? 's' : ''} selecionado{selectedGroups.size !== 1 ? 's' : ''}
                </span>
              </div>

              {/* Groups List */}
              <div className="max-h-64 overflow-y-auto space-y-1 border border-gray-200 rounded-xl p-2">
                {loading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 text-[#8CD955] animate-spin" />
                  </div>
                ) : filteredGroups.length === 0 ? (
                  <div className="text-center py-8 text-gray-500 text-sm">Nenhum grupo encontrado</div>
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
                          : 'bg-white border-gray-300'
                      }`}>
                        {selectedGroups.has(group.id) && <Check className="w-3.5 h-3.5 text-white stroke-[3]" />}
                      </div>
                      <span className={`text-sm font-medium truncate ${
                        selectedGroups.has(group.id) ? 'text-[#6AB83D]' : 'text-gray-700'
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
              <h3 className="text-lg font-semibold text-gray-800 mb-4">Revisar e executar</h3>
              
              <div className="bg-white rounded-xl p-4 border border-gray-200 space-y-3">
                <div>
                  <span className="text-sm font-medium text-gray-600">Mensagem:</span>
                  <p className="text-gray-800 font-semibold">{messageTitle}</p>
                </div>
                <div>
                  <span className="text-sm font-medium text-gray-600">Tipo:</span>
                  <p className="text-gray-800">{scheduleType === 'once' ? 'Pontual' : 'Recorrente'}</p>
                </div>
                {scheduleType === 'once' ? (
                  <>
                    <div>
                      <span className="text-sm font-medium text-gray-600">Data:</span>
                      <p className="text-gray-800">{new Date(selectedDate).toLocaleDateString('pt-BR')}</p>
                    </div>
                    <div>
                      <span className="text-sm font-medium text-gray-600">Hora:</span>
                      <p className="text-gray-800">{selectedTime}</p>
                    </div>
                  </>
                ) : (
                  <div>
                    <span className="text-sm font-medium text-gray-600">Agendamento:</span>
                    <p className="text-gray-800">{formatRecurringSchedule()}</p>
                  </div>
                )}
                <div>
                  <span className="text-sm font-medium text-gray-600">Grupos:</span>
                  <p className="text-gray-800">{selectedGroups.size} grupo(s) selecionado(s)</p>
                </div>
                <div>
                  <span className="text-sm font-medium text-gray-600">Instância:</span>
                  <p className="text-gray-800">{selectedInstance}</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-gray-200 bg-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="dontShowAgain"
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
              className="w-4 h-4 text-[#8CD955] rounded focus:ring-[#8CD955]"
            />
            <label htmlFor="dontShowAgain" className="text-sm text-gray-700 cursor-pointer">
              Não mostrar novamente
            </label>
          </div>
          
          <div className="flex gap-3">
            {currentStep > 1 && (
              <button
                onClick={handleBack}
                className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 font-medium rounded-xl transition-colors flex items-center gap-2"
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

