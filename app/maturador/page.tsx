'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRequireAuth } from '@/utils/useRequireAuth';
import { useRouter } from 'next/navigation';
import Layout from '@/components/Layout';
import {
  Play,
  Pause,
  Square,
  Clock,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Loader2,
  AlertTriangle,
  Wifi,
  WifiOff,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

interface MaturationJob {
  id: string;
  plan: {
    id: string;
    name: string;
    description?: string;
  };
  instance_name: string | null;
  target_chat_id: string;
  status: 'queued' | 'running' | 'paused' | 'finished' | 'failed' | 'aborted';
  progress_total: number;
  progress_done: number;
  progress_percent: number;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
}

interface MaturationPlan {
  id: string;
  name: string;
  description?: string;
  default_target_chat_id?: string;
}

interface MasterInstance {
  id: string | null;
  evolution_instance_id: string | null;
  instance_name: string;
  phone_number: string | null;
  status: string | null;
  is_master?: boolean;
  is_locked: boolean;
  available: boolean;
}

export default function MaturadorPage() {
  const { userId, checking } = useRequireAuth();
  const router = useRouter();
  const [canAccess, setCanAccess] = useState(false);
  const [jobs, setJobs] = useState<MaturationJob[]>([]);
  const [plans, setPlans] = useState<MaturationPlan[]>([]);
  const [masterInstances, setMasterInstances] = useState<MasterInstance[]>([]);
  const [virginMessagesCount, setVirginMessagesCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState<string>('');
  const [targetChatIdInput, setTargetChatIdInput] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  
  /** Valor especial no select para usar mensagens do Auto maturador. */
  const VIRGIN_MESSAGES_OPTION = '__virgin_messages__';
  /** ID do plano fixo "Mensagens do Auto maturador" (insert_auto_matador_plan.sql). Ocultamos da lista para não duplicar a opção. */
  const PLAN_ID_VIRGIN_MESSAGES = 'a0000000-0000-0000-0000-000000000001';
  const useVirginMessages = selectedPlanId === VIRGIN_MESSAGES_OPTION;
  const plansFiltered = plans.filter((p) => p.id !== PLAN_ID_VIRGIN_MESSAGES);
  const [checkingConnection, setCheckingConnection] = useState<string | null>(null);
  /** IDs (evolution_instance_id) das instâncias selecionadas para o Start. Vazio = qualquer disponível. */
  const [selectedInstanceIds, setSelectedInstanceIds] = useState<Set<string>>(new Set());
  /** Intervalo em segundos entre uma mensagem e a próxima (override do plano). Vazio = usar do plano. */
  const [delaySecondsOverride, setDelaySecondsOverride] = useState<string>('');
  
  // Paginação das instâncias
  const [instancesPage, setInstancesPage] = useState(1);
  const instancesPerPage = 8;
  const [mounted, setMounted] = useState(false);
  const loadDataRef = useRef<() => Promise<void>>(() => Promise.resolve());

  useEffect(() => {
    setMounted(true);
  }, []);

  // Verifica se é admin
  useEffect(() => {
    if (!userId && !checking) {
      router.push('/admin/login');
      return;
    }

    if (userId) {
      checkAccess();
    }
  }, [userId, checking, router]);

  // Carrega dados quando confirmado que pode acessar
  useEffect(() => {
    if (canAccess && userId) {
      loadData();
    }
  }, [canAccess, userId, statusFilter]);

  // Polling: atualiza a lista de jobs enquanto houver algum rodando (para refletir steps e conclusão)
  const hasRunningJobs = jobs.some((j) => j.status === 'running');
  useEffect(() => {
    loadDataRef.current = loadData;
  });
  useEffect(() => {
    if (!canAccess || !userId || !hasRunningJobs) return;
    const interval = setInterval(() => loadDataRef.current?.(), 3500);
    return () => clearInterval(interval);
  }, [canAccess, userId, hasRunningJobs]);

  async function checkAccess() {
    try {
      const response = await fetch('/api/maturation/can-access', {
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': userId || '',
        },
      });

      const result = await response.json();

      if (!result.success || !result.data?.canAccess) {
        setCanAccess(false);
        setLoading(false);
        setTimeout(() => router.push('/'), 2000);
        return;
      }

      setCanAccess(true);
    } catch (error) {
      console.error('Erro ao verificar acesso ao Maturador:', error);
      setCanAccess(false);
      setLoading(false);
      setTimeout(() => router.push('/'), 2000);
    }
  }

  async function loadData() {
    try {
      setLoading(true);

      const [jobsRes, plansRes, instancesRes, virginCountRes] = await Promise.all([
        fetch(`/api/maturation/jobs?status=${statusFilter === 'all' ? '' : statusFilter}`, {
          headers: { 'X-User-Id': userId || '' },
        }),
        fetch('/api/maturation/plans', {
          headers: { 'X-User-Id': userId || '' },
        }),
        fetch('/api/maturation/master-instances', {
          headers: { 'X-User-Id': userId || '' },
        }),
        fetch('/api/maturation/virgin-messages-count', {
          headers: { 'X-User-Id': userId || '' },
        }),
      ]);

      const [jobsData, plansData, instancesData, virginCountData] = await Promise.all([
        jobsRes.json(),
        plansRes.json(),
        instancesRes.json(),
        virginCountRes.json(),
      ]);

      setJobs(jobsData.jobs || []);
      setPlans(plansData.plans || []);
      setMasterInstances(instancesData.instances || []);
      setVirginMessagesCount(typeof virginCountData?.count === 'number' ? virginCountData.count : 0);
    } catch (error) {
      console.error('Erro ao carregar dados:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleCheckConnection(instanceName: string) {
    try {
      setCheckingConnection(instanceName);
      
      const res = await fetch(`/api/instances/${encodeURIComponent(instanceName)}/status`, {
        headers: { 'X-User-Id': userId || '' },
      });
      
      const data = await res.json();
      
      // A API retorna o estado em data.data.status (successResponse) ou data.status
      const state = data.data?.status ?? data.status ?? data.state;
      const isConnected = state === 'connected' || state === 'connecting';
      
      // Refaz o carregamento da lista para trazer o status atualizado do banco (API já atualizou para 'ok')
      await loadData();
      
      if (isConnected) {
        alert(`✅ ${instanceName} está conectada!`);
      } else {
        alert(`❌ ${instanceName} está desconectada`);
      }
    } catch (error) {
      console.error('Erro ao verificar conexão:', error);
      alert('Erro ao verificar conexão da instância');
    } finally {
      setCheckingConnection(null);
    }
  }

  async function handleStartJob() {
    if (!selectedPlanId) {
      alert('Selecione um plano ou "Mensagens do Auto maturador"');
      return;
    }

    const useVirgin = selectedPlanId === VIRGIN_MESSAGES_OPTION;
    if (useVirgin && virginMessagesCount === 0) {
      alert('Nenhuma mensagem configurada no Auto maturador. Configure em Admin > Maturador (fluxo Auto maturador).');
      return;
    }
    const plan = useVirgin ? null : plans.find((p) => p.id === selectedPlanId);
    const targetChatId = useVirgin ? (targetChatIdInput || '').trim() : (plan?.default_target_chat_id || '');
    // Target Chat ID é opcional: o job pode ter destino padrão; steps podem ter "Enviar para grupo" no fluxo

    const availableInstance = masterInstances.find((i) => i.available);
    if (!availableInstance) {
      alert('Nenhuma instância disponível para maturação. Configure o phone_number das instâncias em Admin.');
      return;
    }

    try {
      setStarting(true);
      const preferredIds = selectedInstanceIds.size > 0
        ? Array.from(selectedInstanceIds)
        : undefined;
      const delayOverride = delaySecondsOverride.trim() !== ''
        ? parseInt(delaySecondsOverride, 10)
        : undefined;
      const body: Record<string, unknown> = useVirgin
        ? { use_virgin_messages: true, target_chat_id: targetChatId }
        : { plan_id: selectedPlanId, target_chat_id: targetChatId };
      if (preferredIds?.length) body.preferred_evolution_instance_ids = preferredIds;
      if (typeof delayOverride === 'number' && delayOverride >= 0) body.delay_seconds_override = delayOverride;
      const res = await fetch('/api/maturation/jobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': userId || '',
        },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (res.ok && data.job_id) {
        await loadData();
        setSelectedPlanId('');
        const count = data.job_ids?.length ?? 1;
        if (count > 1) {
          alert(`${count} jobs iniciados. O processamento está em andamento (a lista será atualizada automaticamente).`);
        } else {
          alert('Job iniciado. O processamento está em andamento (a lista será atualizada automaticamente).');
        }
        fetch('/api/maturation/process-now', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-User-Id': userId || '' },
        }).catch(() => {
          // process-now em segundo plano; falhas não bloqueiam a UI
        });
      } else {
        alert(data.error || 'Erro ao iniciar job');
      }
    } catch (error) {
      console.error('Erro ao iniciar job:', error);
      alert('Erro ao iniciar job');
    } finally {
      setStarting(false);
    }
  }

  async function handlePauseJob(jobId: string) {
    try {
      await fetch(`/api/maturation/jobs/${jobId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': userId || '',
        },
        body: JSON.stringify({ status: 'paused' }),
      });
      await loadData();
    } catch (error) {
      console.error('Erro ao pausar job:', error);
    }
  }

  async function handleResumeJob(jobId: string) {
    try {
      await fetch(`/api/maturation/jobs/${jobId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': userId || '',
        },
        body: JSON.stringify({ status: 'running' }),
      });
      await loadData();
    } catch (error) {
      console.error('Erro ao retomar job:', error);
    }
  }

  async function handleAbortJob(jobId: string) {
    if (!confirm('Tem certeza que deseja abortar este job?')) {
      return;
    }

    try {
      await fetch(`/api/maturation/jobs/${jobId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': userId || '',
        },
        body: JSON.stringify({ status: 'aborted' }),
      });
      await loadData();
    } catch (error) {
      console.error('Erro ao abortar job:', error);
    }
  }

  // Verifica se a instância está OK (conectada)
  function isInstanceOk(status: string | null): boolean {
    return status === 'ok' || status === 'open' || status === 'connected';
  }

  function getStatusIcon(status: string) {
    switch (status) {
      case 'running':
        return <RefreshCw className="w-4 h-4 text-[#8CD955] animate-spin" />;
      case 'finished':
        return <CheckCircle2 className="w-4 h-4 text-green-500" />;
      case 'failed':
      case 'aborted':
        return <XCircle className="w-4 h-4 text-red-500" />;
      case 'paused':
        return <Pause className="w-4 h-4 text-yellow-500" />;
      default:
        return <Clock className="w-4 h-4 text-gray-500" />;
    }
  }

  function getStatusBadge(status: string) {
    const styles: Record<string, string> = {
      running: 'bg-[#8CD955]/20 dark:bg-[#8CD955]/30 text-[#8CD955] dark:text-[#8CD955]',
      finished: 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400',
      failed: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400',
      aborted: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400',
      paused: 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-400',
      queued: 'bg-gray-100 dark:bg-[#404040] text-gray-700 dark:text-[#aaa]',
    };
    return styles[status] || 'bg-gray-100 dark:bg-[#404040] text-gray-700 dark:text-[#aaa]';
  }

  function formatDate(dateString: string | null) {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  // Sem permissão (nem admin nem cargo com Maturador na sidebar): acesso negado
  if (!canAccess && !loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <AlertTriangle className="w-16 h-16 text-yellow-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-gray-700 dark:text-gray-200 mb-2">Acesso negado</h2>
            <p className="text-gray-500 dark:text-gray-400">Você não tem permissão para acessar o Maturador.</p>
            <p className="text-gray-400 dark:text-gray-500 text-sm mt-2">Redirecionando...</p>
          </div>
        </div>
      </Layout>
    );
  }

  // Contagem de instâncias disponíveis para job de maturação (todas as conectadas com phone_number, não precisa ser mestre)
  const availableMasters = masterInstances.filter(
    (i) => i.available && !!(i as any).phone_number
  );
  const availableInstancesCount = availableMasters.length;

  function toggleInstanceSelection(evolutionInstanceId: string) {
    if (!evolutionInstanceId) return;
    setSelectedInstanceIds((prev) => {
      const next = new Set(prev);
      if (next.has(evolutionInstanceId)) next.delete(evolutionInstanceId);
      else next.add(evolutionInstanceId);
      return next;
    });
  }

  function selectAllAvailable() {
    setSelectedInstanceIds(new Set(availableMasters.map((i) => i.evolution_instance_id).filter(Boolean) as string[]));
  }

  function deselectAllInstances() {
    setSelectedInstanceIds(new Set());
  }

  // Paginação
  const totalPages = Math.ceil(masterInstances.length / instancesPerPage);
  const paginatedInstances = masterInstances.slice(
    (instancesPage - 1) * instancesPerPage,
    instancesPage * instancesPerPage
  );

  return (
    <Layout>
      <div className="min-h-full bg-slate-50/60 dark:bg-[#1a1a1a] p-4 md:p-6">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl md:text-3xl font-bold text-slate-800 dark:text-white tracking-tight">
            Maturador
          </h1>
          <p className="text-slate-500 dark:text-[#aaa] text-sm mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-medium text-slate-700 dark:text-[#ccc]">{masterInstances.length} instância(s) conectada(s)</span>
            <span className="text-slate-400 dark:text-[#666]">·</span>
            <span className="font-semibold text-[#8CD955] dark:text-[#8CD955]">{availableInstancesCount} disponível(is) para maturação</span>
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
          {/* Coluna Esquerda - Instâncias */}
          <div className="lg:col-span-1">
            <div className="bg-white dark:bg-[#2a2a2a] rounded-xl shadow-sm border border-slate-200 dark:border-[#404040] overflow-hidden">
              <div className="p-4 border-b border-slate-100 dark:border-[#404040] bg-white dark:bg-[#2a2a2a]">
                <h2 className="text-base font-semibold text-slate-800 dark:text-white">Instâncias conectadas</h2>
                <p className="text-xs text-slate-500 dark:text-[#aaa] mt-0.5">Selecione quais vão rodar no Start (ou deixe vazio = qualquer)</p>
                {availableMasters.length > 0 && (
                  <div className="flex gap-2 mt-3">
                    <button
                      type="button"
                      onClick={selectAllAvailable}
                      className="text-xs font-medium text-[#8CD955] hover:text-[#7BC84A] dark:hover:text-[#9ae066] hover:underline"
                    >
                      Selecionar todas
                    </button>
                    <span className="text-slate-300 dark:text-[#555]">|</span>
                    <button
                      type="button"
                      onClick={deselectAllInstances}
                      className="text-xs font-medium text-slate-500 dark:text-[#aaa] hover:text-slate-700 dark:hover:text-white hover:underline"
                    >
                      Desmarcar
                    </button>
                  </div>
                )}
              </div>
              <div className="p-3 max-h-[420px] overflow-y-auto">
                {loading ? (
                  <div className="py-10 text-center">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto text-slate-400 dark:text-[#888]" />
                  </div>
                ) : masterInstances.length === 0 ? (
                  <div className="py-10 text-center text-slate-400 dark:text-[#888]">
                    <WifiOff className="w-10 h-10 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">Nenhuma instância conectada</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {paginatedInstances.map((instance) => {
                      const isOk = isInstanceOk(instance.status);
                      const isMaster = instance.is_master === true;
                      const hasPhone = !!(instance as any).phone_number;
                      const canSelect = isOk && !instance.is_locked && hasPhone;
                      const evId = instance.evolution_instance_id ?? '';
                      const isSelected = evId && selectedInstanceIds.has(evId);
                      return (
                        <div
                          key={instance.instance_name + evId}
                          className={`p-3 rounded-lg border transition-all ${
                            isOk ? 'bg-emerald-50/80 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800' : 'bg-slate-50 dark:bg-[#333] border-slate-200 dark:border-[#404040]'
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            {canSelect && (
                              <input
                                type="checkbox"
                                checked={Boolean(isSelected)}
                                onChange={() => toggleInstanceSelection(evId)}
                                className="mt-1 h-4 w-4 rounded border-slate-300 dark:border-[#555] text-[#8CD955] focus:ring-[#8CD955] dark:focus:ring-[#8CD955]"
                              />
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className={`w-2 h-2 rounded-full shrink-0 ${isOk ? 'bg-emerald-500' : 'bg-slate-400 dark:bg-[#666]'}`} />
                                <p className={`font-medium text-sm ${isOk ? 'text-slate-800 dark:text-white' : 'text-slate-600 dark:text-[#aaa]'}`}>
                                  {instance.instance_name}
                                </p>
                                <span className={`text-xs px-1.5 py-0.5 rounded ${isMaster ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300' : 'bg-slate-100 dark:bg-[#404040] text-slate-600 dark:text-[#aaa]'}`}>
                                  {isMaster ? 'Mestre' : 'Normal'}
                                </span>
                                {(instance as any).phone_number && (
                                  <span className="text-xs text-slate-600 dark:text-[#aaa] font-mono">
                                    {(instance as any).phone_number}
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-slate-500 dark:text-[#888] mt-0.5">
                                {isOk ? 'OK - Conectada' : instance.status || 'Desconectada'}
                                {instance.is_locked && ' · Em uso'}
                                {!canSelect && !hasPhone && ' · Sem telefone (configure na instância)'}
                              </p>
                            </div>
                            <button
                              onClick={() => handleCheckConnection(instance.instance_name)}
                              disabled={checkingConnection === instance.instance_name}
                              className="p-1.5 rounded-lg text-slate-500 dark:text-[#888] hover:bg-slate-100 dark:hover:bg-[#404040] transition-colors shrink-0"
                              title="Verificar conexão"
                            >
                              {checkingConnection === instance.instance_name ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Wifi className="w-4 h-4" />
                              )}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-3 py-2 border-t border-slate-100 dark:border-[#404040] bg-slate-50/50 dark:bg-[#333]">
                  <button
                    onClick={() => setInstancesPage((p) => Math.max(1, p - 1))}
                    disabled={instancesPage === 1}
                    className="p-2 rounded-lg text-slate-600 dark:text-[#aaa] hover:bg-slate-100 dark:hover:bg-[#404040] disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="text-xs text-slate-500 dark:text-[#888]">{instancesPage} de {totalPages}</span>
                  <button
                    onClick={() => setInstancesPage((p) => Math.min(totalPages, p + 1))}
                    disabled={instancesPage === totalPages}
                    className="p-2 rounded-lg text-slate-600 dark:text-[#aaa] hover:bg-slate-100 dark:hover:bg-[#404040] disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Coluna Direita - Iniciar e Jobs */}
          <div className="lg:col-span-2 space-y-4 md:space-y-6">
            {/* Card Iniciar Maturação */}
            <div className="bg-white dark:bg-[#2a2a2a] rounded-xl shadow-sm border border-slate-200 dark:border-[#404040] p-4 md:p-6">
              <h2 className="text-base font-semibold text-slate-800 dark:text-white mb-4">Iniciar Maturação</h2>
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
                  <div className="flex-1 min-w-0">
                    <label className="block text-xs font-medium text-slate-500 dark:text-[#aaa] mb-1">Plano</label>
                    <select
                      value={selectedPlanId}
                      onChange={(e) => setSelectedPlanId(e.target.value)}
                      className="w-full px-4 py-2.5 border border-slate-300 dark:border-[#555] rounded-lg text-slate-800 dark:text-white bg-white dark:bg-[#333] focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955]"
                    >
                      <option value="">Selecione um plano</option>
                      <option value={VIRGIN_MESSAGES_OPTION}>
                        Mensagens do Auto maturador{virginMessagesCount >= 0 ? ` (${virginMessagesCount} msg)` : ''}
                      </option>
                      {plansFiltered.map((plan) => (
                        <option key={plan.id} value={plan.id}>{plan.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="w-full sm:w-28">
                    <label className="block text-xs font-medium text-slate-500 dark:text-[#aaa] mb-1">Intervalo (s)</label>
                    <input
                      type="number"
                      min={1}
                      placeholder="Plano"
                      value={delaySecondsOverride}
                      onChange={(e) => setDelaySecondsOverride(e.target.value)}
                      className="w-full px-3 py-2.5 border border-slate-300 dark:border-[#555] rounded-lg text-slate-800 dark:text-white bg-white dark:bg-[#333] focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955]"
                      title="Segundos entre uma mensagem e a próxima (deixe vazio para usar o do plano)"
                    />
                  </div>
                  <button
                    onClick={handleStartJob}
                    disabled={
                      starting ||
                      !selectedPlanId ||
                      availableInstancesCount === 0 ||
                      (useVirginMessages && virginMessagesCount === 0)
                    }
                    className="px-5 py-2.5 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 bg-[#8CD955] text-white hover:bg-[#7BC84A] disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                    title={
                      mounted
                        ? availableInstancesCount === 0
                          ? 'Configure o phone_number das instâncias em Admin'
                          : useVirginMessages && virginMessagesCount === 0
                            ? 'Configure as mensagens do Auto maturador em Admin'
                            : ''
                        : undefined
                    }
                  >
                    {starting ? (
                      <><Loader2 className="w-5 h-5 animate-spin" /> Iniciando...</>
                    ) : (
                      <><Play className="w-5 h-5" /> Start</>
                    )}
                  </button>
                </div>
                {useVirginMessages && (
                  <div>
                    <label htmlFor="target-chat-id" className="block text-xs font-medium text-slate-500 dark:text-[#aaa] mb-1">Target Chat ID (opcional)</label>
                    <input
                      id="target-chat-id"
                      type="text"
                      value={targetChatIdInput}
                      onChange={(e) => setTargetChatIdInput(e.target.value)}
                      placeholder="Ex: 120363...@g.us"
                      className="w-full px-3 py-2 border border-slate-300 dark:border-[#555] rounded-lg text-slate-800 dark:text-white bg-white dark:bg-[#333] focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955]"
                    />
                  </div>
                )}
                {selectedInstanceIds.size > 0 && (
                  <p className="text-xs text-slate-500 dark:text-[#aaa]">
                    {selectedInstanceIds.size} instância(s) selecionada(s) para este job. Sem seleção = qualquer disponível.
                  </p>
                )}
              </div>
              {availableInstancesCount === 0 && (
                <p className="text-sm text-red-600 mt-2">Nenhuma instância disponível para maturação. Configure o phone_number das instâncias em Admin.</p>
              )}
              {useVirginMessages && virginMessagesCount === 0 && (
                <p className="text-sm text-amber-600 mt-2">Configure mensagens em Admin &gt; Maturador (Auto maturador).</p>
              )}
            </div>

            {/* Filtros e Lista de Jobs */}
            <div className="flex gap-2 flex-wrap">
              {[
                { value: 'all', label: 'Todos' },
                { value: 'running', label: 'Rodando' },
                { value: 'finished', label: 'Finalizados' },
                { value: 'failed', label: 'Falhas' },
              ].map((f) => (
                <button
                  key={f.value}
                  onClick={() => setStatusFilter(f.value)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    statusFilter === f.value
                      ? 'bg-[#8CD955] text-white hover:bg-[#7BC84A]'
                      : 'bg-slate-100 dark:bg-[#333] text-slate-600 dark:text-[#aaa] hover:bg-slate-200 dark:hover:bg-[#404040]'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <div className="bg-white dark:bg-[#2a2a2a] rounded-xl shadow-sm border border-slate-200 dark:border-[#404040] overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 dark:border-[#404040]">
                <h3 className="text-sm font-semibold text-slate-800 dark:text-white">Mensagens do Auto maturador</h3>
              </div>
              {loading ? (
                <div className="p-8 text-center">
                  <Loader2 className="w-8 h-8 animate-spin mx-auto text-slate-400 dark:text-[#888]" />
                  <p className="text-slate-500 dark:text-[#aaa] mt-2 text-sm">Carregando...</p>
                </div>
              ) : jobs.length === 0 ? (
                <div className="p-8 text-center text-slate-400 dark:text-[#888] text-sm">
                  Nenhum job encontrado
                </div>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-[#404040]">
                  {jobs.map((job) => (
                    <div key={job.id} className="p-4 hover:bg-slate-50/50 dark:hover:bg-[#333]/80 transition-colors">
                      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-3 flex-wrap">
                            {getStatusIcon(job.status)}
                            <div>
                              <p className="font-medium text-slate-800 dark:text-white">{job.plan.name}</p>
                              <p className="text-sm text-slate-500 dark:text-[#aaa]">{job.instance_name || 'Aguardando instância'}</p>
                            </div>
                            <span className={`px-2 py-0.5 rounded text-xs font-medium ${getStatusBadge(job.status)}`}>
                              {job.status}
                            </span>
                            <span className="text-xs text-slate-400 dark:text-[#888]">{formatDate(job.created_at)}</span>
                          </div>
                          {/* Visualização de steps: indicadores 1..N */}
                          <div className="mt-3 flex items-center gap-1 flex-wrap">
                            <span className="text-xs text-slate-500 dark:text-[#888] mr-1">Steps:</span>
                            {Array.from({ length: job.progress_total }, (_, i) => {
                              const stepNum = i + 1;
                              const done = stepNum <= job.progress_done;
                              const current = job.status === 'running' && stepNum === job.progress_done + 1;
                              return (
                                <span
                                  key={stepNum}
                                  className={`inline-flex items-center justify-center w-6 h-6 rounded text-xs font-medium ${
                                    done
                                      ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400'
                                      : current
                                        ? 'bg-[#8CD955]/20 dark:bg-[#8CD955]/30 text-[#8CD955] ring-1 ring-[#8CD955]/50 dark:ring-[#8CD955]/60'
                                        : 'bg-slate-100 dark:bg-[#404040] text-slate-400 dark:text-[#888]'
                                  }`}
                                  title={done ? `Step ${stepNum} concluído` : current ? `Step ${stepNum} em andamento` : `Step ${stepNum}`}
                                >
                                  {done ? '✓' : stepNum}
                                </span>
                              );
                            })}
                            <span className="text-xs text-slate-400 dark:text-[#888] ml-1">
                              {job.progress_done}/{job.progress_total}
                            </span>
                          </div>
                          <div className="mt-2 w-full bg-slate-200 dark:bg-[#404040] rounded-full h-1.5">
                            <div
                              className="bg-[#8CD955] h-1.5 rounded-full transition-all duration-300"
                              style={{ width: `${job.progress_percent}%` }}
                            />
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {job.status === 'running' && (
                            <button onClick={() => handlePauseJob(job.id)} className="p-2 text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/30 rounded-lg" title="Pausar">
                              <Pause className="w-5 h-5" />
                            </button>
                          )}
                          {job.status === 'paused' && (
                            <button onClick={() => handleResumeJob(job.id)} className="p-2 text-[#8CD955] hover:bg-[#8CD955]/20 dark:hover:bg-[#8CD955]/30 rounded-lg" title="Retomar">
                              <Play className="w-5 h-5" />
                            </button>
                          )}
                          {(job.status === 'running' || job.status === 'paused') && (
                            <button onClick={() => handleAbortJob(job.id)} className="p-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg" title="Abortar">
                              <Square className="w-5 h-5" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
