'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useRequireAuth } from '@/utils/useRequireAuth';
import { useTenantRouter } from '@/lib/utils/tenant-href';
import Layout from '@/components/Layout';
import {
  Play,
  Pause,
  Square,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertTriangle,
  Wifi,
  WifiOff,
  ChevronLeft,
  ChevronRight,
  Plus,
  Edit,
  Trash2,
  Save,
  X,
  FileText,
  ChevronDown,
  ChevronUp,
  Info,
} from 'lucide-react';
import { clampMaturationStepDelaySec, MATURATION_MIN_STEP_DELAY_SEC } from '@/lib/maturation/min-step-delay';

type MaturationStepStatus = 'pending' | 'processing' | 'sent' | 'failed';

interface MaturationJob {
  id: string;
  /** Mesmo UUID em todos os jobs de uma campanha malha (2+ instâncias). */
  campaign_id?: string | null;
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
  /** Status por step (API); fallback na UI se ausente */
  step_statuses?: MaturationStepStatus[];
  steps_sent?: number;
  steps_failed?: number;
  steps_pending?: number;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
  /** ISO string do próximo step pendente (para timer em tempo real) */
  next_scheduled_at: string | null;
  /** Job de outro dono mas instância bloqueada: mostrar campanha sem pausar/remover. */
  readonly_controls?: boolean;
}

interface PlanStepJson {
  index?: number;
  type: 'text' | 'video' | 'image' | 'audio';
  delaySec: number;
  /** Alias eventual em JSON legado */
  delay_seconds?: number;
  target_chat_id?: string | null;
  payload: { text?: string; media_url?: string; caption?: string };
}

interface MaturationPlan {
  id: string;
  name: string;
  description?: string | null;
  default_target_chat_id?: string | null;
  created_by?: string | null;
  steps_json?: PlanStepJson[];
}

interface PlanStepForm {
  type: 'text' | 'video' | 'image' | 'audio';
  delay_seconds: number;
  target_chat_id?: string;
  payload: { text?: string; media_url?: string; caption?: string };
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
  blocked_from_maturation?: boolean;
  campaign_id?: string | null;
  campaign_status_label?: 'em_campanha' | 'sem_campanha';
}

type JobsDisplayItem =
  | { kind: 'campaign'; campaign_id: string; jobs: MaturationJob[] }
  | { kind: 'job'; job: MaturationJob };

const MATURATION_JOBS_LIST_PAGE_SIZE = 5;

function aggregateMaturationCampaign(campaignJobs: MaturationJob[]) {
  const sorted = [...campaignJobs].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
  const progress_total = sorted.reduce((s, j) => s + (j.progress_total || 0), 0);
  const steps_sent = sorted.reduce((s, j) => s + (j.steps_sent ?? j.progress_done), 0);
  const steps_failed = sorted.reduce((s, j) => s + (j.steps_failed ?? 0), 0);
  const steps_pending = sorted.reduce((s, j) => s + (j.steps_pending ?? 0), 0);
  let status: MaturationJob['status'] = 'finished';
  if (sorted.some((j) => j.status === 'running')) status = 'running';
  else if (sorted.some((j) => j.status === 'paused')) status = 'paused';
  else if (sorted.some((j) => j.status === 'failed' || j.status === 'aborted')) status = 'failed';
  const nextTimes = sorted.map((j) => j.next_scheduled_at).filter(Boolean) as string[];
  const next_scheduled_at =
    nextTimes.length > 0
      ? nextTimes.reduce((a, b) => (new Date(a).getTime() <= new Date(b).getTime() ? a : b))
      : null;
  const progress_percent =
    progress_total > 0 ? Math.round((steps_sent / progress_total) * 100) : 0;
  return {
    plan: sorted[0].plan,
    instance_names: sorted.map((j) => j.instance_name).filter(Boolean) as string[],
    status,
    progress_total,
    steps_sent,
    steps_failed,
    steps_pending,
    next_scheduled_at,
    created_at: sorted[0].created_at,
    jobs: sorted,
    progress_percent,
  };
}

export default function MaturadorPage() {
  const { userId, checking, userStatus } = useRequireAuth();
  const router = useTenantRouter();
  const canUseAllMaturationPlans = userStatus === 'super_admin' || userStatus === 'admin';
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
  /** Paginação da lista "Mensagens do Auto maturador" */
  const [jobsListPage, setJobsListPage] = useState(1);
  
  /** Valor especial no select para usar mensagens do Auto maturador. */
  const VIRGIN_MESSAGES_OPTION = '__virgin_messages__';
  /** ID do plano fixo "Mensagens do Auto maturador" (insert_auto_matador_plan.sql). Ocultamos da lista para não duplicar a opção. */
  const PLAN_ID_VIRGIN_MESSAGES = 'a0000000-0000-0000-0000-000000000001';
  const useVirginMessages = selectedPlanId === VIRGIN_MESSAGES_OPTION;
  const plansFiltered = plans.filter((p) => p.id !== PLAN_ID_VIRGIN_MESSAGES);
  const myPlans = canUseAllMaturationPlans
    ? plansFiltered
    : plansFiltered.filter((p) => p.created_by === userId);
  const suggestedPlans = canUseAllMaturationPlans
    ? []
    : plansFiltered.filter((p) => p.created_by !== userId);
  const [checkingConnection, setCheckingConnection] = useState<string | null>(null);
  /** IDs (evolution_instance_id) das instâncias selecionadas para o Start. Vazio = qualquer disponível. */
  const [selectedInstanceIds, setSelectedInstanceIds] = useState<Set<string>>(new Set());
  /** Por job: resultado do último processamento em lote (atrasados) */
  const [catchUpResults, setCatchUpResults] = useState<Record<string, { sent: number; failed: number; results: Array<{ step_index: number; status: string }> }>>({});
  const [catchUpLoading, setCatchUpLoading] = useState<string | null>(null);
  const [expandedMeshCampaignId, setExpandedMeshCampaignId] = useState<string | null>(null);
  
  // Configurar plano (no próprio maturador, sem admin)
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [editingPlan, setEditingPlan] = useState<MaturationPlan | null>(null);
  const [planFormName, setPlanFormName] = useState('');
  const [planFormDescription, setPlanFormDescription] = useState('');
  const [planFormSteps, setPlanFormSteps] = useState<PlanStepForm[]>([]);
  const [planSaving, setPlanSaving] = useState(false);
  const [expandedPlanConfig, setExpandedPlanConfig] = useState<string | null>(null);
  
  // Paginação das instâncias
  const [instancesPage, setInstancesPage] = useState(1);
  const instancesPerPage = 8;
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const tp = Math.max(1, Math.ceil(masterInstances.length / instancesPerPage) || 1);
    setInstancesPage((p) => (p > tp ? tp : p));
  }, [masterInstances.length, instancesPerPage]);
  const loadDataRef = useRef<(opts?: { background?: boolean }) => Promise<void>>(() => Promise.resolve());
  /** Após o primeiro GET bem-sucedido, recarregamentos usam modo silencioso (sem trocar a lista inteira por “Carregando…”). */
  const dataReadyRef = useRef(false);

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
      loadData({ background: dataReadyRef.current });
    }
  }, [canAccess, userId, statusFilter]);

  useEffect(() => {
    setJobsListPage(1);
  }, [statusFilter]);

  // Polling: atualiza a lista de jobs enquanto houver algum rodando (para refletir steps e conclusão)
  const hasRunningJobs = jobs.some((j) => j.status === 'running');
  /** Ref que espelha o estado jobs — permite acesso correto dentro do setInterval */
  const jobsRef = useRef<MaturationJob[]>(jobs);
  useEffect(() => { jobsRef.current = jobs; }, [jobs]);
  /** Ref para evitar múltiplos process-now simultâneos */
  const processingNowRef = useRef(false);
  useEffect(() => {
    loadDataRef.current = loadData;
  });
  useEffect(() => {
    if (!canAccess || !userId || !hasRunningJobs) return;
    const interval = setInterval(async () => {
      await loadDataRef.current?.({ background: true });

      // Auto-dispara process-now se algum job running tiver steps atrasados ou pendentes
      // Garante continuidade mesmo que o cron de 1 min não esteja ativo ou o tick anterior tenha encadeado
      if (processingNowRef.current) return;
      const currentJobs = jobsRef.current;
      const hasWorkToDo = currentJobs.some((j) => {
        if (j.status !== 'running') return false;
        const pending =
          typeof j.steps_pending === 'number'
            ? j.steps_pending > 0
            : j.progress_done < j.progress_total;
        return (
          pending &&
          (j.next_scheduled_at == null ||
            new Date(j.next_scheduled_at).getTime() <= Date.now() + 5000)
        );
      });
      if (hasWorkToDo) {
        processingNowRef.current = true;
        fetch('/api/maturation/process-now', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-User-Id': userId || '' },
        })
          .catch(() => {})
          .finally(() => {
            setTimeout(() => { processingNowRef.current = false; }, 8000); // cooldown de 8s
          });
      }
    }, 3500);
    return () => clearInterval(interval);
  }, [canAccess, userId, hasRunningJobs]);

  // Timer em tempo real: atualiza a cada 1s para o countdown do próximo envio
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!hasRunningJobs) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [hasRunningJobs]);

  function getNextSendCountdown(nextScheduledAt: string | null): string | null {
    if (!nextScheduledAt) return null;
    const next = new Date(nextScheduledAt).getTime();
    const diff = Math.max(0, Math.floor((next - now) / 1000));
    if (diff === 0) return 'Agora';
    const m = Math.floor(diff / 60);
    const s = diff % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  function isNextStepOverdue(nextScheduledAt: string | null): boolean {
    return !!nextScheduledAt && new Date(nextScheduledAt).getTime() <= now;
  }

  async function handleProcessCatchUp(jobId: string) {
    setCatchUpLoading(jobId);
    try {
      const res = await fetch(`/api/maturation/jobs/${jobId}/process-catch-up`, {
        method: 'POST',
        headers: { 'X-User-Id': userId || '' },
      });
      const data = await res.json();
      if (res.ok && data.results) {
        setCatchUpResults((prev) => ({
          ...prev,
          [jobId]: {
            sent: data.sent ?? 0,
            failed: data.failed ?? 0,
            results: data.results ?? [],
          },
        }));
        await loadData({ background: true });
      } else {
        alert(data.error || 'Erro ao processar atrasados');
      }
    } catch (e) {
      console.error(e);
      alert('Erro ao processar atrasados');
    } finally {
      setCatchUpLoading(null);
    }
  }

  function openCreatePlanModal() {
    setEditingPlan(null);
    setPlanFormName('');
    setPlanFormDescription('');
    setPlanFormSteps([{ type: 'text', delay_seconds: 5, payload: { text: '' } }]);
    setShowPlanModal(true);
  }

  function openCreatePlanFromSuggestion(plan: MaturationPlan) {
    setEditingPlan(null);
    setPlanFormName(`${plan.name} (cópia)`);
    setPlanFormDescription(plan.description ?? '');
    const steps = plan.steps_json?.length
      ? plan.steps_json
      : [{ type: 'text' as const, delaySec: MATURATION_MIN_STEP_DELAY_SEC, payload: { text: '' } }];
    setPlanFormSteps(
      steps.map((s) => ({
        type: s.type,
        delay_seconds: clampMaturationStepDelaySec(s.delaySec ?? s.delay_seconds),
        target_chat_id: s.target_chat_id ?? '',
        payload: s.payload || { text: '', media_url: '', caption: '' },
      }))
    );
    setShowPlanModal(true);
  }

  function openEditPlanModal(plan: MaturationPlan) {
    setEditingPlan(plan);
    setPlanFormName(plan.name);
    setPlanFormDescription(plan.description ?? '');
    const steps = plan.steps_json?.length ? plan.steps_json : [{ type: 'text' as const, delaySec: MATURATION_MIN_STEP_DELAY_SEC, payload: { text: '' } }];
    setPlanFormSteps(
      steps.map((s) => ({
        type: s.type,
        delay_seconds: clampMaturationStepDelaySec(s.delaySec ?? s.delay_seconds),
        target_chat_id: s.target_chat_id ?? '',
        payload: s.payload || { text: '', media_url: '', caption: '' },
      }))
    );
    setShowPlanModal(true);
  }

  function addPlanStep() {
    setPlanFormSteps([...planFormSteps, { type: 'text', delay_seconds: MATURATION_MIN_STEP_DELAY_SEC, payload: { text: '' } }]);
  }

  function removePlanStep(index: number) {
    if (planFormSteps.length <= 1) return;
    setPlanFormSteps(planFormSteps.filter((_, i) => i !== index));
  }

  function updatePlanStep(index: number, field: string, value: string | number) {
    const next = [...planFormSteps];
    if (field === 'type') {
      next[index] = { ...next[index], type: value as PlanStepForm['type'], payload: value === 'text' ? { text: '' } : { media_url: '', caption: '' } };
    } else if (field === 'delay_seconds') {
      next[index] = {
        ...next[index],
        delay_seconds: clampMaturationStepDelaySec(typeof value === 'number' ? value : Number(value)),
      };
    } else if (field === 'target_chat_id') {
      next[index] = { ...next[index], target_chat_id: String(value) };
    } else {
      next[index] = { ...next[index], payload: { ...next[index].payload, [field]: value } };
    }
    setPlanFormSteps(next);
  }

  async function handleSavePlan() {
    if (!planFormName.trim()) {
      alert('Nome do plano é obrigatório');
      return;
    }
    for (let i = 0; i < planFormSteps.length; i++) {
      const s = planFormSteps[i];
      if (s.type === 'text' && !s.payload.text?.trim()) {
        alert(`Step ${i + 1}: texto é obrigatório`);
        return;
      }
      if (['video', 'image', 'audio'].includes(s.type) && !s.payload.media_url?.trim()) {
        alert(`Step ${i + 1}: URL da mídia é obrigatória`);
        return;
      }
    }
    setPlanSaving(true);
    try {
      const url = editingPlan ? `/api/maturation/plans/${editingPlan.id}` : '/api/maturation/plans';
      const method = editingPlan ? 'PUT' : 'POST';
      const body = {
        name: planFormName.trim(),
        description: planFormDescription.trim() || null,
        /** Destino do chat não é mais configurado no plano; use o campo na tela ao iniciar ou malha entre instâncias. */
        default_target_chat_id: null,
        steps: planFormSteps.map((s) => ({
          type: s.type,
          delay_seconds: clampMaturationStepDelaySec(s.delay_seconds),
          target_chat_id: s.target_chat_id?.trim() || undefined,
          payload: s.payload,
        })),
      };
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId || '' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Erro ao salvar plano');
        return;
      }
      setShowPlanModal(false);
      await loadData({ background: true });
    } catch (e) {
      console.error(e);
      alert('Erro ao salvar plano');
    } finally {
      setPlanSaving(false);
    }
  }

  async function handleDeletePlan(planId: string) {
    if (!confirm('Tem certeza que deseja excluir este plano?')) return;
    try {
      const res = await fetch(`/api/maturation/plans/${planId}`, {
        method: 'DELETE',
        headers: { 'X-User-Id': userId || '' },
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Erro ao excluir');
        return;
      }
      await loadData({ background: true });
    } catch (e) {
      console.error(e);
      alert('Erro ao excluir plano');
    }
  }

  function canEditPlan(plan: MaturationPlan): boolean {
    if (canUseAllMaturationPlans) return true;
    return plan.created_by != null && plan.created_by === userId;
  }

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

  async function loadData(opts?: { background?: boolean }) {
    const background = opts?.background === true;
    try {
      if (!background) {
        setLoading(true);
      }

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
      const list: MasterInstance[] = instancesData.instances || [];
      setMasterInstances(list);
      setSelectedInstanceIds((prev) => {
        const next = new Set<string>();
        for (const id of prev) {
          const inst = list.find((i) => i.evolution_instance_id === id);
          const hasPhone = !!(inst?.phone_number && String(inst.phone_number).trim());
          if (
            inst &&
            hasPhone &&
            !inst.is_locked &&
            !inst.blocked_from_maturation &&
            isInstanceOk(inst.status)
          ) {
            next.add(id);
          }
        }
        return next;
      });
      setVirginMessagesCount(typeof virginCountData?.count === 'number' ? virginCountData.count : 0);
      dataReadyRef.current = true;
    } catch (error) {
      console.error('Erro ao carregar dados:', error);
    } finally {
      if (!background) {
        setLoading(false);
      }
    }
  }

  async function handleCheckConnection(instanceName: string) {
    try {
      setCheckingConnection(instanceName);
      
      const res = await fetch(`/api/instances/${encodeURIComponent(instanceName)}/status`, {
        headers: { 'X-User-Id': userId || '' },
      });
      
      const data = await res.json();
      
      // `status` = UI (connected | disconnected); `state` = Evolution (ex.: connecting para QR)
      const uiStatus = data.data?.status ?? data.status;
      const evoState = data.data?.state ?? data.data?.evolutionState;
      const isConnected = uiStatus === 'connected';
      
      // Refaz o carregamento da lista para trazer o status atualizado do banco (API já atualizou para 'ok')
      await loadData({ background: true });
      
      if (isConnected) {
        alert(`✅ ${instanceName} está conectada!`);
      } else if (evoState === 'connecting') {
        alert(`⏳ ${instanceName} está aguardando leitura do QR (ainda não conectada).`);
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
    if (!useVirgin && (!plan || (!canUseAllMaturationPlans && plan.created_by !== userId))) {
      alert('Para iniciar, crie e selecione um plano seu. Os planos do admin aparecem apenas como sugestão.');
      return;
    }
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
      const body: Record<string, unknown> = useVirgin
        ? { use_virgin_messages: true, target_chat_id: targetChatId }
        : { plan_id: selectedPlanId, target_chat_id: targetChatId };
      if (preferredIds?.length) body.preferred_evolution_instance_ids = preferredIds;
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
        await loadData({ background: true });
        setSelectedPlanId('');
        const count = data.job_ids?.length ?? 1;
        if (data.campaign_id && count > 1) {
          alert(
            `Campanha malha iniciada: uma campanha com ${count} instâncias (cada uma envia o plano completo às demais). A lista será atualizada automaticamente.`
          );
        } else if (count > 1) {
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
      await loadData({ background: true });
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
      await loadData({ background: true });
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
      await loadData({ background: true });
    } catch (error) {
      console.error('Erro ao abortar job:', error);
    }
  }

  async function handleRemoveMaturationJob(jobId: string) {
    if (!confirm('Remover este registro da lista? Ele será apagado permanentemente.')) return;
    try {
      const res = await fetch(`/api/maturation/jobs/${jobId}`, {
        method: 'DELETE',
        headers: { 'X-User-Id': userId || '' },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert((data as { error?: string }).error || 'Erro ao remover');
        return;
      }
      setCatchUpResults((prev) => {
        const next = { ...prev };
        delete next[jobId];
        return next;
      });
      await loadData({ background: true });
    } catch (e) {
      console.error(e);
      alert('Erro ao remover');
    }
  }

  async function handleRemoveMaturationCampaign(campaignJobs: MaturationJob[]) {
    const n = campaignJobs.length;
    if (!confirm(`Remover toda a campanha? Serão apagados ${n} job(s) permanentemente.`)) return;
    try {
      for (const j of campaignJobs) {
        const res = await fetch(`/api/maturation/jobs/${j.id}`, {
          method: 'DELETE',
          headers: { 'X-User-Id': userId || '' },
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          alert((data as { error?: string }).error || `Erro ao remover job ${j.instance_name || j.id}`);
          await loadData({ background: true });
          return;
        }
        setCatchUpResults((prev) => {
          const next = { ...prev };
          delete next[j.id];
          return next;
        });
      }
      await loadData({ background: true });
    } catch (e) {
      console.error(e);
      alert('Erro ao remover campanha');
    }
  }

  // Verifica se a instância está OK (conectada)
  function isInstanceOk(status: string | null): boolean {
    return status === 'ok' || status === 'open' || status === 'connected';
  }

  function getStatusIcon(status: string) {
    switch (status) {
      case 'running':
        return <Play className="w-4 h-4 text-[#8CD955]" />;
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

  /** Rótulo do status em português (evita “finished”, “running”, etc. na UI). */
  function getMaturationStatusLabelPt(status: string): string {
    const map: Record<string, string> = {
      finished: 'finalizado',
      running: 'rodando',
      paused: 'pausado',
      failed: 'falhou',
      aborted: 'cancelado',
      queued: 'na fila',
    };
    return map[status] ?? status;
  }

  /** Evita “finished” verde quando nenhuma mensagem foi enviada (ex.: sem destino). */
  function getJobHeaderPresentation(job: MaturationJob) {
    const total = job.progress_total || 0;
    const sent = job.steps_sent ?? job.progress_done;
    const failed = job.steps_failed ?? 0;
    if (job.status === 'finished' && total > 0 && sent === 0 && failed >= total) {
      return {
        icon: <XCircle className="w-4 h-4 text-amber-500" />,
        badge: 'finalizado sem envios',
        badgeClass: 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300',
      };
    }
    if (job.status === 'finished' && failed > 0 && sent > 0) {
      return {
        icon: <CheckCircle2 className="w-4 h-4 text-yellow-500" />,
        badge: 'concluído c/ falhas',
        badgeClass: 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-800 dark:text-yellow-300',
      };
    }
    return {
      icon: getStatusIcon(job.status),
      badge: getMaturationStatusLabelPt(job.status),
      badgeClass: getStatusBadge(job.status),
    };
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

  const jobsForList = useMemo(() => {
    if (statusFilter === 'all') return jobs;
    const campaignHasMatch = new Set<string>();
    for (const j of jobs) {
      if (j.campaign_id && j.status === statusFilter) campaignHasMatch.add(j.campaign_id);
    }
    return jobs.filter(
      (j) =>
        j.status === statusFilter ||
        (j.campaign_id != null && campaignHasMatch.has(j.campaign_id))
    );
  }, [jobs, statusFilter]);

  const jobsDisplayItems = useMemo((): JobsDisplayItem[] => {
    const list = jobsForList;
    const byCampaign = new Map<string, MaturationJob[]>();
    for (const j of list) {
      if (!j.campaign_id) continue;
      const arr = byCampaign.get(j.campaign_id) || [];
      arr.push(j);
      byCampaign.set(j.campaign_id, arr);
    }
    const sorted = [...list].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    const seen = new Set<string>();
    const out: JobsDisplayItem[] = [];
    for (const j of sorted) {
      if (j.campaign_id) {
        if (seen.has(j.campaign_id)) continue;
        seen.add(j.campaign_id);
        const group = [...(byCampaign.get(j.campaign_id) || [])].sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );
        out.push({ kind: 'campaign', campaign_id: j.campaign_id, jobs: group });
      } else {
        out.push({ kind: 'job', job: j });
      }
    }
    return out;
  }, [jobsForList]);

  const jobsListTotalPages = Math.max(1, Math.ceil(jobsDisplayItems.length / MATURATION_JOBS_LIST_PAGE_SIZE));

  const jobsDisplayPageItems = useMemo(() => {
    const start = (jobsListPage - 1) * MATURATION_JOBS_LIST_PAGE_SIZE;
    return jobsDisplayItems.slice(start, start + MATURATION_JOBS_LIST_PAGE_SIZE);
  }, [jobsDisplayItems, jobsListPage]);

  useEffect(() => {
    setJobsListPage((p) => (p > jobsListTotalPages ? jobsListTotalPages : p < 1 ? 1 : p));
  }, [jobsListTotalPages]);

  async function handlePauseCampaign(cj: MaturationJob[]) {
    for (const j of cj) {
      if (j.status !== 'running') continue;
      try {
        await fetch(`/api/maturation/jobs/${j.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'X-User-Id': userId || '' },
          body: JSON.stringify({ status: 'paused' }),
        });
      } catch (e) {
        console.error(e);
      }
    }
    await loadData({ background: true });
  }

  async function handleResumeCampaign(cj: MaturationJob[]) {
    for (const j of cj) {
      if (j.status !== 'paused') continue;
      try {
        await fetch(`/api/maturation/jobs/${j.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'X-User-Id': userId || '' },
          body: JSON.stringify({ status: 'running' }),
        });
      } catch (e) {
        console.error(e);
      }
    }
    await loadData({ background: true });
  }

  async function handleAbortCampaign(cj: MaturationJob[]) {
    if (!confirm('Abortar toda a campanha (todos os remetentes)?')) return;
    for (const j of cj) {
      if (j.status !== 'running' && j.status !== 'paused') continue;
      try {
        await fetch(`/api/maturation/jobs/${j.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'X-User-Id': userId || '' },
          body: JSON.stringify({ status: 'aborted' }),
        });
      } catch (e) {
        console.error(e);
      }
    }
    await loadData({ background: true });
  }

  /** Índice 0-based do step em `processing`, ou -1. */
  function findMaturationProcessingStepIndex(stepStatuses: MaturationStepStatus[] | undefined): number {
    if (!stepStatuses?.length) return -1;
    return stepStatuses.findIndex((s) => s === 'processing');
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

  function instanceHasPhone(inst: MasterInstance): boolean {
    return !!(inst.phone_number && String(inst.phone_number).trim());
  }

  function maturationSortRank(inst: MasterInstance): number {
    if (!instanceHasPhone(inst)) return 3;
    if (inst.blocked_from_maturation) return 2;
    if (isInstanceOk(inst.status) && !inst.is_locked) return 0;
    return 1;
  }

  const sortedMasterInstances = [...masterInstances].sort((a, b) => {
    const d = maturationSortRank(a) - maturationSortRank(b);
    if (d !== 0) return d;
    return a.instance_name.localeCompare(b.instance_name, 'pt-BR');
  });

  function toggleInstanceSelection(evolutionInstanceId: string) {
    if (!evolutionInstanceId) return;
    const inst = masterInstances.find((i) => i.evolution_instance_id === evolutionInstanceId);
    if (
      !inst ||
      !instanceHasPhone(inst) ||
      inst.is_locked ||
      inst.blocked_from_maturation ||
      !isInstanceOk(inst.status)
    )
      return;
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

  // Paginação (lista ordenada: com telefone e disponíveis para maturar primeiro)
  const totalPages = Math.ceil(sortedMasterInstances.length / instancesPerPage) || 1;
  const paginatedInstances = sortedMasterInstances.slice(
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
                      const hasPhone = instanceHasPhone(instance);
                      const blockedMat = instance.blocked_from_maturation === true;
                      const canSelect = isOk && !instance.is_locked && hasPhone && !blockedMat;
                      const evId = instance.evolution_instance_id ?? '';
                      const isSelected = evId && selectedInstanceIds.has(evId);
                      const cardClass = !hasPhone
                        ? 'bg-red-50/90 dark:bg-red-950/30 border-red-300 dark:border-red-800/80'
                        : blockedMat && hasPhone
                          ? 'bg-violet-50/80 dark:bg-violet-950/25 border-violet-200 dark:border-violet-800/60'
                          : isOk
                            ? instance.is_locked
                              ? 'bg-amber-50/70 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800/60'
                              : 'bg-emerald-50/80 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800'
                            : 'bg-slate-50 dark:bg-[#333] border-slate-200 dark:border-[#404040]';
                      return (
                        <div
                          key={instance.instance_name + evId}
                          className={`p-3 rounded-lg border transition-all ${cardClass}`}
                        >
                          <div className="flex items-start gap-3">
                            <div className="mt-1 w-4 h-4 shrink-0 flex items-center justify-center">
                              {canSelect ? (
                                <input
                                  type="checkbox"
                                  checked={Boolean(isSelected)}
                                  onChange={() => toggleInstanceSelection(evId)}
                                  className="h-4 w-4 rounded border-slate-300 dark:border-[#555] text-[#8CD955] focus:ring-[#8CD955] dark:focus:ring-[#8CD955]"
                                />
                              ) : null}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span
                                  className={`w-2 h-2 rounded-full shrink-0 ${
                                    !hasPhone ? 'bg-red-500' : isOk ? 'bg-emerald-500' : 'bg-slate-400 dark:bg-[#666]'
                                  }`}
                                />
                                <p
                                  className={`font-medium text-sm ${
                                    !hasPhone ? 'text-red-900 dark:text-red-200' : isOk ? 'text-slate-800 dark:text-white' : 'text-slate-600 dark:text-[#aaa]'
                                  }`}
                                >
                                  {instance.instance_name}
                                </p>
                                <span className={`text-xs px-1.5 py-0.5 rounded ${isMaster ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300' : 'bg-slate-100 dark:bg-[#404040] text-slate-600 dark:text-[#aaa]'}`}>
                                  {isMaster ? 'Mestre' : 'Normal'}
                                </span>
                                {hasPhone && (
                                  <span className="text-xs text-slate-600 dark:text-[#aaa] font-mono">{instance.phone_number}</span>
                                )}
                              </div>
                              {!hasPhone && (
                                <p className="text-xs font-medium text-red-600 dark:text-red-400 mt-1.5">
                                  Sem telefone configurado — não pode ser usada no maturador. Configure o número da instância em Admin.
                                </p>
                              )}
                              {hasPhone && blockedMat && (
                                <p className="text-xs font-medium text-violet-700 dark:text-violet-300 mt-1.5">
                                  Bloqueada para o maturador em Instâncias — não entra na seleção até você desbloquear.
                                </p>
                              )}
                              <p className="text-xs text-slate-500 dark:text-[#888] mt-0.5">
                                {isOk ? 'OK - Conectada' : instance.status || 'Desconectada'}
                                {instance.is_locked && hasPhone && ' · Em uso (bloqueada por outro job)'}
                                {hasPhone && ` · ${instance.campaign_status_label === 'em_campanha' ? 'Em campanha' : 'Sem campanha'}`}
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
              <div className="flex items-center justify-between gap-2 mb-4">
                <h2 className="text-base font-semibold text-slate-800 dark:text-white">Iniciar Maturação</h2>
                <button
                  type="button"
                  onClick={openCreatePlanModal}
                  className="text-xs font-medium text-[#8CD955] hover:text-[#7BC84A] dark:hover:text-[#9ae066] hover:underline"
                  title="Criar ou editar plano de conversas"
                >
                  Configurar plano
                </button>
              </div>
              <div className="space-y-4">
                <div className="space-y-2">
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
                        {myPlans.length > 0 && (
                          <optgroup label={canUseAllMaturationPlans ? 'Planos' : 'Meus planos'}>
                            {myPlans.map((plan) => (
                              <option key={plan.id} value={plan.id}>{plan.name}</option>
                            ))}
                          </optgroup>
                        )}
                        {suggestedPlans.length > 0 && (
                          <optgroup label="Sugestões do admin">
                            {suggestedPlans.map((plan) => (
                              <option key={plan.id} value={plan.id} disabled>
                                {plan.name} (sugestão)
                              </option>
                            ))}
                          </optgroup>
                        )}
                      </select>
                    </div>
                    <button
                      type="button"
                      onClick={handleStartJob}
                      disabled={
                        starting ||
                        !selectedPlanId ||
                        availableInstancesCount === 0 ||
                        (useVirginMessages && virginMessagesCount === 0)
                      }
                      className="w-full sm:w-auto px-5 py-2.5 rounded-lg font-medium transition-colors inline-flex items-center justify-center gap-2 bg-[#8CD955] text-white hover:bg-[#7BC84A] disabled:opacity-50 disabled:cursor-not-allowed shrink-0 sm:min-h-[42px]"
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
                  <p className="text-[11px] text-slate-500 dark:text-[#888]">
                    O tempo entre cada mensagem é o definido em cada passo do plano (Configurar plano). No Auto maturador, usa-se o intervalo padrão das mensagens configuradas no admin.
                  </p>
                </div>
                {useVirginMessages && (
                  <div>
                    <label htmlFor="target-chat-id" className="block text-xs font-medium text-slate-500 dark:text-[#aaa] mb-1">
                      Target Chat ID (opcional)
                    </label>
                    <input
                      id="target-chat-id"
                      type="text"
                      value={targetChatIdInput}
                      onChange={(e) => setTargetChatIdInput(e.target.value)}
                      placeholder="Número ou grupo, ex: 5511999999999 ou 120363...@g.us"
                      className="w-full px-3 py-2 border border-slate-300 dark:border-[#555] rounded-lg text-slate-800 dark:text-white bg-white dark:bg-[#333] focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955]"
                    />
                    <p className="text-xs text-slate-500 dark:text-[#888] mt-1">
                      Se vazio: use destino padrão do plano, &quot;Enviar para grupo&quot; em algum passo, ou selecione 2+ instâncias para malha entre elas.
                      Caso contrário, os envios sem destino resolvido falham no processamento com aviso no job.
                    </p>
                  </div>
                )}
                {!useVirginMessages && selectedPlanId && !myPlans.some((p) => p.id === selectedPlanId) && (
                  <p className="text-xs text-amber-600">
                    Planos do admin aparecem como sugestão. Para iniciar, crie seu plano com base em uma sugestão.
                  </p>
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

            {/* Configurar plano de conversas (no maturador, sem admin) */}
            <div className="bg-white dark:bg-[#2a2a2a] rounded-xl shadow-sm border border-slate-200 dark:border-[#404040] overflow-hidden">
              <div className="p-4 border-b border-slate-100 dark:border-[#404040] flex items-center justify-between flex-wrap gap-2">
                <h3 className="text-base font-semibold text-slate-800 dark:text-white">Configurar plano de conversas</h3>
                <button
                  type="button"
                  onClick={openCreatePlanModal}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-[#8CD955] text-white hover:bg-[#7BC84A]"
                >
                  <Plus className="w-4 h-4" /> Novo plano
                </button>
              </div>
              <div className="p-3 max-h-[280px] overflow-y-auto">
                {plansFiltered.length === 0 ? (
                  <p className="text-sm text-slate-500 dark:text-[#888] py-4 text-center">Nenhum plano. Clique em &quot;Novo plano&quot; para criar.</p>
                ) : (
                  <div className="space-y-3">
                    <div>
                      <p className="text-xs font-semibold text-slate-500 dark:text-[#aaa] mb-2">
                        {canUseAllMaturationPlans ? 'Todos os planos' : 'Meus planos'}
                      </p>
                      {myPlans.length === 0 ? (
                        <p className="text-xs text-slate-400 dark:text-[#888] px-1 py-1">
                          {canUseAllMaturationPlans ? 'Nenhum plano cadastrado.' : 'Você ainda não criou um plano.'}
                        </p>
                      ) : (
                        <ul className="space-y-2">
                          {myPlans.map((plan) => {
                            const stepsCount = Array.isArray(plan.steps_json) ? plan.steps_json.length : 0;
                            const isExpanded = expandedPlanConfig === plan.id;
                            const canEdit = canEditPlan(plan);
                            return (
                              <li key={plan.id} className="rounded-lg border border-slate-200 dark:border-[#404040] bg-slate-50/50 dark:bg-[#333]/50">
                                <div className="p-3 flex items-center justify-between gap-2">
                                  <button
                                    type="button"
                                    onClick={() => setExpandedPlanConfig(isExpanded ? null : plan.id)}
                                    className="flex-1 flex items-center gap-2 text-left min-w-0"
                                  >
                                    <FileText className="w-4 h-4 text-slate-500 shrink-0" />
                                    <span className="font-medium text-slate-800 dark:text-white truncate">{plan.name}</span>
                                    <span className="text-xs text-slate-500 shrink-0">{stepsCount} step(s)</span>
                                    {isExpanded ? <ChevronUp className="w-4 h-4 shrink-0" /> : <ChevronDown className="w-4 h-4 shrink-0" />}
                                  </button>
                                  {canEdit && (
                                    <div className="flex items-center gap-1 shrink-0">
                                      <button type="button" onClick={() => openEditPlanModal(plan)} className="p-1.5 text-slate-500 hover:text-[#8CD955] rounded" title="Editar">
                                        <Edit className="w-4 h-4" />
                                      </button>
                                      <button type="button" onClick={() => handleDeletePlan(plan.id)} className="p-1.5 text-slate-500 hover:text-red-500 rounded" title="Excluir">
                                        <Trash2 className="w-4 h-4" />
                                      </button>
                                    </div>
                                  )}
                                </div>
                                {isExpanded && (plan.steps_json?.length ?? 0) > 0 && (
                                  <div className="px-3 pb-3 pt-0 border-t border-slate-100 dark:border-[#404040]">
                                    <ul className="mt-2 space-y-1.5 text-xs text-slate-600 dark:text-[#aaa]">
                                      {(plan.steps_json ?? []).map((s, i) => (
                                        <li key={i} className="flex items-center gap-2">
                                          <span className="font-mono text-slate-400 w-5">{i + 1}.</span>
                                          <span>{s.type}</span>
                                          <span className="text-slate-400">{s.delaySec}s</span>
                                          {s.type === 'text' && s.payload?.text && <span className="truncate max-w-[180px]">{s.payload.text}</span>}
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                    {!canUseAllMaturationPlans && (
                    <div>
                      <p className="text-xs font-semibold text-slate-500 dark:text-[#aaa] mb-2">Sugestões do admin</p>
                      {suggestedPlans.length === 0 ? (
                        <p className="text-xs text-slate-400 dark:text-[#888] px-1 py-1">
                          Nenhuma sugestão disponível.
                        </p>
                      ) : (
                        <ul className="space-y-2">
                          {suggestedPlans.map((plan) => {
                            const stepsCount = Array.isArray(plan.steps_json) ? plan.steps_json.length : 0;
                            const isExpanded = expandedPlanConfig === plan.id;
                            return (
                              <li key={plan.id} className="rounded-lg border border-amber-200 dark:border-amber-800/60 bg-amber-50/50 dark:bg-amber-900/10">
                                <div className="p-3 flex items-center justify-between gap-2">
                                  <button
                                    type="button"
                                    onClick={() => setExpandedPlanConfig(isExpanded ? null : plan.id)}
                                    className="flex-1 flex items-center gap-2 text-left min-w-0"
                                  >
                                    <FileText className="w-4 h-4 text-amber-600 shrink-0" />
                                    <span className="font-medium text-slate-800 dark:text-white truncate">{plan.name}</span>
                                    <span className="text-xs text-amber-700 dark:text-amber-400 shrink-0">Sugestão</span>
                                    <span className="text-xs text-slate-500 shrink-0">{stepsCount} step(s)</span>
                                    {isExpanded ? <ChevronUp className="w-4 h-4 shrink-0" /> : <ChevronDown className="w-4 h-4 shrink-0" />}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => openCreatePlanFromSuggestion(plan)}
                                    className="px-2.5 py-1 rounded-lg text-xs font-medium bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-900/60"
                                    title="Criar meu plano com base nesta sugestão"
                                  >
                                    Usar como base
                                  </button>
                                </div>
                                {isExpanded && (plan.steps_json?.length ?? 0) > 0 && (
                                  <div className="px-3 pb-3 pt-0 border-t border-amber-100 dark:border-amber-800/40">
                                    <ul className="mt-2 space-y-1.5 text-xs text-slate-600 dark:text-[#aaa]">
                                      {(plan.steps_json ?? []).map((s, i) => (
                                        <li key={i} className="flex items-center gap-2">
                                          <span className="font-mono text-slate-400 w-5">{i + 1}.</span>
                                          <span>{s.type}</span>
                                          <span className="text-slate-400">{s.delaySec}s</span>
                                          {s.type === 'text' && s.payload?.text && <span className="truncate max-w-[180px]">{s.payload.text}</span>}
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                    )}
                  </div>
                )}
              </div>
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
              ) : jobsForList.length === 0 ? (
                <div className="p-8 text-center text-slate-400 dark:text-[#888] text-sm">
                  Nenhum job neste filtro
                </div>
              ) : (
                <>
                <div className="divide-y divide-slate-100 dark:divide-[#404040]">
                  {jobsDisplayPageItems.map((item) => {
                    if (item.kind === 'campaign') {
                      const agg = aggregateMaturationCampaign(item.jobs);
                      const pseudoJob: MaturationJob = {
                        id: item.campaign_id,
                        campaign_id: item.campaign_id,
                        plan: agg.plan,
                        instance_name: agg.instance_names.join(' · '),
                        target_chat_id: '',
                        status: agg.status,
                        progress_total: agg.progress_total,
                        progress_done: agg.steps_sent,
                        progress_percent: agg.progress_percent,
                        steps_sent: agg.steps_sent,
                        steps_failed: agg.steps_failed,
                        steps_pending: agg.steps_pending,
                        started_at: null,
                        ended_at: null,
                        created_at: agg.created_at,
                        next_scheduled_at: agg.next_scheduled_at,
                      };
                      const header = getJobHeaderPresentation(pseudoJob);
                      const expanded = expandedMeshCampaignId === item.campaign_id;
                      const anyRunning = item.jobs.some((j) => j.status === 'running');
                      const anyPaused = item.jobs.some((j) => j.status === 'paused');
                      const campaignReadonly = item.jobs.some((j) => j.readonly_controls === true);
                      const campaignProcessingLines = item.jobs
                        .filter((j) => j.status === 'running')
                        .map((j) => {
                          const pIdx = findMaturationProcessingStepIndex(j.step_statuses);
                          if (pIdx < 0) return null;
                          return {
                            jobId: j.id,
                            instanceLabel: j.instance_name || j.id.slice(0, 8),
                            stepNum: pIdx + 1,
                          };
                        })
                        .filter(Boolean) as { jobId: string; instanceLabel: string; stepNum: number }[];
                      return (
                        <div key={item.campaign_id} className="p-4 hover:bg-slate-50/50 dark:hover:bg-[#333]/80 transition-colors">
                          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-3 flex-wrap">
                                {header.icon}
                                <div>
                                  <p className="font-medium text-slate-800 dark:text-white">{agg.plan.name}</p>
                                  <p className="text-sm text-slate-500 dark:text-[#aaa]">
                                    Campanha malha · {item.jobs.length} instâncias · cada uma envia o plano completo às demais
                                  </p>
                                  {campaignReadonly && (
                                    <p className="text-xs text-amber-700 dark:text-amber-300/90 mt-1 max-w-xl">
                                      Sua instância está nesta campanha, mas o processo foi iniciado por outro usuário (ex.: administrador ou auto maturador). Pausar, abortar ou remover não está disponível aqui.
                                    </p>
                                  )}
                                </div>
                                <span className={`px-2 py-0.5 rounded text-xs font-medium ${header.badgeClass}`}>
                                  {header.badge}
                                </span>
                                <span className="text-xs text-slate-400 dark:text-[#888]">{formatDate(agg.created_at)}</span>
                              </div>
                              <p className="text-xs text-slate-600 dark:text-[#aaa] mt-2 break-words">
                                {agg.instance_names.join(' · ')}
                              </p>
                              <div className="mt-3 text-xs text-slate-500 dark:text-[#888]">
                                {agg.steps_sent}/{agg.progress_total} enviados no total
                                {agg.status === 'running' && agg.steps_pending > 0 ? ' · aguardando envios' : ''}
                                {agg.steps_failed > 0 ? ` · ${agg.steps_failed} falha(s)` : ''}
                              </div>
                              <div className="mt-2 w-full bg-slate-200 dark:bg-[#404040] rounded-full h-1.5">
                                <div
                                  className="bg-[#8CD955] h-1.5 rounded-full transition-all duration-300"
                                  style={{ width: `${agg.progress_percent}%` }}
                                />
                              </div>
                              {campaignProcessingLines.length > 0 && (
                                <div
                                  className="mt-2 rounded-lg border border-amber-200/90 dark:border-amber-800/55 bg-amber-50/90 dark:bg-amber-950/35 px-3 py-2 text-xs text-amber-950 dark:text-amber-100"
                                  role="status"
                                  aria-live="polite"
                                >
                                  <div className="flex items-start gap-2">
                                    <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0 mt-0.5 text-amber-700 dark:text-amber-300" aria-hidden />
                                    <div className="min-w-0 space-y-1">
                                      <p className="font-medium text-amber-900 dark:text-amber-50">Envio em andamento</p>
                                      {campaignProcessingLines.map((line) => (
                                        <p key={line.jobId} className="text-amber-900/95 dark:text-amber-100/95">
                                          Instância <span className="font-semibold">{line.instanceLabel}</span>
                                          {' · '}
                                          step <span className="font-mono font-semibold tabular-nums">{line.stepNum}</span>
                                        </p>
                                      ))}
                                    </div>
                                  </div>
                                </div>
                              )}
                              {agg.status === 'running' && agg.next_scheduled_at != null && (
                                <div className="mt-2 flex flex-wrap items-center gap-2">
                                  <span className="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-[#aaa]">
                                    <Clock className="w-3.5 h-3.5" />
                                    Próximo envio (campanha):{' '}
                                    <strong className="font-mono text-[#8CD955] tabular-nums">
                                      {getNextSendCountdown(agg.next_scheduled_at) ?? '—'}
                                    </strong>
                                  </span>
                                </div>
                              )}
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedMeshCampaignId(expanded ? null : item.campaign_id)
                                }
                                className="mt-2 text-xs font-medium text-[#8CD955] hover:underline"
                              >
                                {expanded ? 'Ocultar remetentes' : 'Ver progresso por instância'}
                              </button>
                              {expanded && (
                                <ul className="mt-2 space-y-2 border-t border-slate-100 dark:border-[#404040] pt-2">
                                  {item.jobs.map((sj) => {
                                    const meshProcIdx = findMaturationProcessingStepIndex(sj.step_statuses);
                                    return (
                                    <li
                                      key={sj.id}
                                      className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 dark:text-[#aaa]"
                                    >
                                      <span className="font-medium text-slate-700 dark:text-[#ccc]">
                                        {sj.instance_name || sj.id.slice(0, 8)}
                                      </span>
                                      <span className="flex flex-wrap items-center gap-1">
                                        {meshProcIdx >= 0 && (
                                          <span className="inline-flex items-center gap-1 text-amber-800 dark:text-amber-200 font-medium">
                                            <Loader2 className="w-3 h-3 animate-spin shrink-0" aria-hidden />
                                            enviando step {meshProcIdx + 1}
                                          </span>
                                        )}
                                        <span>
                                          {sj.steps_sent ?? sj.progress_done}/{sj.progress_total} enviados ·{' '}
                                          <span>{getMaturationStatusLabelPt(sj.status)}</span>
                                        </span>
                                      </span>
                                    </li>
                                    );
                                  })}
                                </ul>
                              )}
                            </div>
                            {!campaignReadonly && (
                              <div className="flex items-center gap-1 shrink-0 flex-wrap">
                                {anyRunning && (
                                  <button
                                    type="button"
                                    onClick={() => handlePauseCampaign(item.jobs)}
                                    className="p-2 text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/30 rounded-lg"
                                    title="Pausar campanha"
                                  >
                                    <Pause className="w-5 h-5" />
                                  </button>
                                )}
                                {anyPaused && (
                                  <button
                                    type="button"
                                    onClick={() => handleResumeCampaign(item.jobs)}
                                    className="p-2 text-[#8CD955] hover:bg-[#8CD955]/20 dark:hover:bg-[#8CD955]/30 rounded-lg"
                                    title="Retomar campanha"
                                  >
                                    <Play className="w-5 h-5" />
                                  </button>
                                )}
                                {(anyRunning || anyPaused) && (
                                  <button
                                    type="button"
                                    onClick={() => handleAbortCampaign(item.jobs)}
                                    className="p-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg"
                                    title="Abortar campanha"
                                  >
                                    <Square className="w-5 h-5" />
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => handleRemoveMaturationCampaign(item.jobs)}
                                  className="p-2 text-slate-500 dark:text-[#888] hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 dark:hover:text-red-400 rounded-lg"
                                  title="Remover campanha da lista"
                                >
                                  <Trash2 className="w-5 h-5" />
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    }
                    const job = item.job;
                    const header = getJobHeaderPresentation(job);
                    const stepStatuses = job.step_statuses ?? [];
                    let firstPendingIdx = -1;
                    for (let i = 0; i < job.progress_total; i++) {
                      const s = stepStatuses[i] ?? 'pending';
                      if (s === 'pending' || s === 'processing') {
                        firstPendingIdx = i;
                        break;
                      }
                    }
                    const sentCount = job.steps_sent ?? job.progress_done;
                    const pendingCount =
                      typeof job.steps_pending === 'number'
                        ? job.steps_pending
                        : Math.max(0, job.progress_total - sentCount - (job.steps_failed ?? 0));
                    const jobReadonly = job.readonly_controls === true;
                    const processingStepIdx = findMaturationProcessingStepIndex(stepStatuses);
                    const instanceLabel = job.instance_name || 'instância';

                    return (
                    <div key={job.id} className="p-4 hover:bg-slate-50/50 dark:hover:bg-[#333]/80 transition-colors">
                      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-3 flex-wrap">
                            {header.icon}
                            <div>
                              <p className="font-medium text-slate-800 dark:text-white">{job.plan.name}</p>
                              <p className="text-sm text-slate-500 dark:text-[#aaa]">{job.instance_name || 'Aguardando instância'}</p>
                              {jobReadonly && (
                                <p className="text-xs text-amber-700 dark:text-amber-300/90 mt-1 max-w-xl">
                                  Esta instância está em uso por um job iniciado por outro usuário. Pausar, abortar ou remover não está disponível aqui.
                                </p>
                              )}
                            </div>
                            <span className={`px-2 py-0.5 rounded text-xs font-medium ${header.badgeClass}`}>
                              {header.badge}
                            </span>
                            <span className="text-xs text-slate-400 dark:text-[#888]">{formatDate(job.created_at)}</span>
                          </div>
                          {/* Steps: verde=sent, vermelho=failed, destaque=próximo a enviar */}
                          <div className="mt-3 flex items-center gap-1 flex-wrap">
                            <span className="text-xs text-slate-500 dark:text-[#888] mr-1">Steps:</span>
                            {Array.from({ length: job.progress_total }, (_, i) => {
                              const stepNum = i + 1;
                              const st = (stepStatuses[i] ?? 'pending') as MaturationStepStatus;
                              const isNextToSend =
                                job.status === 'running' && st === 'pending' && i === firstPendingIdx;
                              const cls =
                                st === 'sent'
                                  ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400'
                                  : st === 'failed'
                                    ? 'bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400'
                                    : st === 'processing'
                                      ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 border border-amber-300/60'
                                      : isNextToSend
                                        ? 'bg-[#8CD955]/25 dark:bg-[#8CD955]/35 text-[#8CD955] border border-[#8CD955]/50'
                                        : 'bg-slate-100 dark:bg-[#404040] text-slate-400 dark:text-[#888]';
                              const title =
                                st === 'sent'
                                  ? `Step ${stepNum}: enviado`
                                  : st === 'failed'
                                    ? `Step ${stepNum}: falhou`
                                    : st === 'processing'
                                      ? `Step ${stepNum}: enviando agora (${instanceLabel})`
                                      : isNextToSend
                                        ? `Step ${stepNum}: aguardando horário de envio`
                                        : `Step ${stepNum}: pendente`;
                              return (
                                <span
                                  key={stepNum}
                                  className={`inline-flex items-center justify-center w-6 h-6 rounded text-xs font-medium ${cls}`}
                                  title={title}
                                >
                                  {st === 'sent' ? (
                                    '✓'
                                  ) : st === 'failed' ? (
                                    '✗'
                                  ) : st === 'processing' ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" aria-label={`Step ${stepNum} enviando`} />
                                  ) : (
                                    stepNum
                                  )}
                                </span>
                              );
                            })}
                            <span className="text-xs text-slate-400 dark:text-[#888] ml-1">
                              {sentCount}/{job.progress_total} enviados
                              {job.status === 'running' && pendingCount > 0 ? ' · aguardando envio' : ''}
                              {(job.steps_failed ?? 0) > 0 ? ` · ${job.steps_failed} falha(s)` : ''}
                            </span>
                          </div>
                          {job.status === 'running' && processingStepIdx >= 0 && (
                            <div
                              className="mt-2 rounded-lg border border-amber-200/90 dark:border-amber-800/55 bg-amber-50/90 dark:bg-amber-950/35 px-3 py-2 text-xs text-amber-950 dark:text-amber-100 flex items-start gap-2"
                              role="status"
                              aria-live="polite"
                            >
                              <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0 mt-0.5 text-amber-700 dark:text-amber-300" aria-hidden />
                              <p>
                                <span className="font-medium">Enviando agora</span>
                                {' · '}
                                step <span className="font-mono font-semibold tabular-nums">{processingStepIdx + 1}</span>
                                {' · '}
                                instância <span className="font-semibold">{instanceLabel}</span>
                              </p>
                            </div>
                          )}
                          <div className="mt-2 w-full bg-slate-200 dark:bg-[#404040] rounded-full h-1.5">
                            <div
                              className="bg-[#8CD955] h-1.5 rounded-full transition-all duration-300"
                              style={{ width: `${job.progress_percent}%` }}
                            />
                          </div>
                          {job.status === 'running' && (job.next_scheduled_at != null || (catchUpResults[job.id]?.results?.length ?? 0) > 0) && (
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              {job.next_scheduled_at != null && (
                                <span className="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-[#aaa]">
                                  <Clock className="w-3.5 h-3.5" />
                                  Próximo envio em: <strong className="font-mono text-[#8CD955] tabular-nums">{getNextSendCountdown(job.next_scheduled_at) ?? '—'}</strong>
                                </span>
                              )}
                              {!jobReadonly && isNextStepOverdue(job.next_scheduled_at) && pendingCount > 0 && (
                                <button
                                  type="button"
                                  onClick={() => handleProcessCatchUp(job.id)}
                                  disabled={catchUpLoading === job.id}
                                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-900/60 disabled:opacity-50"
                                >
                                  {catchUpLoading === job.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                                  Processar atrasados
                                </button>
                              )}
                              {catchUpResults[job.id] && (
                                <span className="text-xs text-slate-500 dark:text-[#888]">
                                  Lote: <span className="text-emerald-600 dark:text-emerald-400">{catchUpResults[job.id].sent} ok</span>
                                  {catchUpResults[job.id].failed > 0 && <span className="text-red-600 dark:text-red-400">, {catchUpResults[job.id].failed} falha(s)</span>}
                                </span>
                              )}
                            </div>
                          )}
                          {job.status === 'running' && catchUpResults[job.id]?.results?.length > 0 && (
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {catchUpResults[job.id].results.map((r) => (
                                <span
                                  key={r.step_index}
                                  className={`inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-medium ${
                                    r.status === 'sent' ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400' : r.status === 'failed' ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400' : 'bg-slate-100 dark:bg-[#404040] text-slate-500'
                                  }`}
                                  title={`Step ${r.step_index + 1}: ${r.status}`}
                                >
                                  {r.status === 'sent' ? '✓' : r.status === 'failed' ? '✗' : r.step_index + 1}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        {!jobReadonly && (
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
                            <button
                              type="button"
                              onClick={() => handleRemoveMaturationJob(job.id)}
                              className="p-2 text-slate-500 dark:text-[#888] hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 dark:hover:text-red-400 rounded-lg"
                              title="Remover da lista"
                            >
                              <Trash2 className="w-5 h-5" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                    );
                  })}
                </div>
                {jobsDisplayItems.length > 0 && (
                  <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-t border-slate-100 dark:border-[#404040] bg-slate-50/60 dark:bg-[#262626]">
                    <span className="text-xs text-slate-500 dark:text-[#888]">
                      {jobsDisplayItems.length <= MATURATION_JOBS_LIST_PAGE_SIZE
                        ? `${jobsDisplayItems.length} registro(s)`
                        : `${(jobsListPage - 1) * MATURATION_JOBS_LIST_PAGE_SIZE + 1}–${Math.min(jobsListPage * MATURATION_JOBS_LIST_PAGE_SIZE, jobsDisplayItems.length)} de ${jobsDisplayItems.length}`}
                    </span>
                    {jobsListTotalPages > 1 && (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setJobsListPage((p) => Math.max(1, p - 1))}
                          disabled={jobsListPage <= 1}
                          className="p-1.5 rounded-lg border border-slate-200 dark:border-[#404040] text-slate-600 dark:text-[#aaa] hover:bg-slate-100 dark:hover:bg-[#333] disabled:opacity-40 disabled:pointer-events-none"
                          aria-label="Página anterior"
                        >
                          <ChevronLeft className="w-4 h-4" />
                        </button>
                        <span className="text-xs text-slate-600 dark:text-[#aaa] tabular-nums min-w-[4.5rem] text-center">
                          {jobsListPage} de {jobsListTotalPages}
                        </span>
                        <button
                          type="button"
                          onClick={() => setJobsListPage((p) => Math.min(jobsListTotalPages, p + 1))}
                          disabled={jobsListPage >= jobsListTotalPages}
                          className="p-1.5 rounded-lg border border-slate-200 dark:border-[#404040] text-slate-600 dark:text-[#aaa] hover:bg-slate-100 dark:hover:bg-[#333] disabled:opacity-40 disabled:pointer-events-none"
                          aria-label="Próxima página"
                        >
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Modal Criar/Editar Plano */}
      {showPlanModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-[#2a2a2a] rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col border border-slate-200 dark:border-[#404040]">
            <div className="p-4 border-b border-slate-200 dark:border-[#404040] flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-800 dark:text-white">{editingPlan ? 'Editar plano' : 'Novo plano'}</h3>
              <button type="button" onClick={() => setShowPlanModal(false)} className="p-1.5 text-slate-500 hover:text-slate-700 dark:hover:text-white rounded">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div className="rounded-lg border border-slate-200 dark:border-[#404040] bg-slate-50/80 dark:bg-[#333]/80 p-3 flex gap-2.5">
                <Info className="w-5 h-5 text-[#8CD955] shrink-0 mt-0.5" aria-hidden />
                <div className="text-sm text-slate-600 dark:text-[#bbb] space-y-1.5">
                  <p className="font-medium text-slate-800 dark:text-[#e8e8e8]">O que é um plano de maturação?</p>
                  <p>
                    É uma <strong className="font-medium text-slate-700 dark:text-[#ddd]">fila de mensagens</strong> na ordem em que você montar.
                    Cada bloco abaixo é um envio: texto ou mídia. O número em &quot;Esperar&quot; é quantos segundos esperar desde o envio anterior até
                    disparar este passo (o primeiro passo também respeita esse tempo após o início do job).
                  </p>
                  <p>
                    <strong className="font-medium text-slate-700 dark:text-[#ddd]">Para quem envia?</strong> Na tela principal: com{' '}
                    <strong className="font-medium text-slate-700 dark:text-[#ddd]">várias instâncias</strong>, cada uma envia o plano às outras (malha).
                    Com <strong className="font-medium text-slate-700 dark:text-[#ddd]">uma instância</strong>, pode usar{' '}
                    <strong className="font-medium text-slate-700 dark:text-[#ddd]">Target Chat ID</strong> (opcional), destino padrão do plano ou destino por passo.
                  </p>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-[#ccc] mb-1">Nome do plano *</label>
                <input
                  type="text"
                  value={planFormName}
                  onChange={(e) => setPlanFormName(e.target.value)}
                  placeholder="Ex.: Boas-vindas em 3 mensagens"
                  className="w-full px-3 py-2 border border-slate-300 dark:border-[#555] rounded-lg text-slate-800 dark:text-white bg-white dark:bg-[#333] focus:ring-2 focus:ring-[#8CD955]"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-[#ccc] mb-1">Descrição</label>
                <textarea
                  value={planFormDescription}
                  onChange={(e) => setPlanFormDescription(e.target.value)}
                  placeholder="Opcional — anote para você o objetivo deste plano"
                  rows={2}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-[#555] rounded-lg text-slate-800 dark:text-white bg-white dark:bg-[#333] resize-none focus:ring-2 focus:ring-[#8CD955]"
                />
              </div>
              <div>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-[#ccc]">Sequência de mensagens *</label>
                    <p className="text-xs text-slate-500 dark:text-[#888] mt-0.5">
                      Ordene do primeiro ao último envio. Use &quot;Adicionar passo&quot; para mais mensagens na mesma sequência.
                    </p>
                  </div>
                  <button type="button" onClick={addPlanStep} className="text-sm text-[#8CD955] hover:underline flex items-center gap-1 shrink-0">
                    <Plus className="w-4 h-4" /> Adicionar passo
                  </button>
                </div>
                <div className="space-y-3">
                  {planFormSteps.map((step, index) => (
                    <div key={index} className="p-3 rounded-lg bg-slate-50 dark:bg-[#333] border border-slate-200 dark:border-[#404040]">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-slate-700 dark:text-[#ccc]">
                          Passo {index + 1} de {planFormSteps.length}
                        </span>
                        <button type="button" onClick={() => removePlanStep(index)} disabled={planFormSteps.length <= 1} className="text-red-500 hover:text-red-600 disabled:opacity-40 text-xs">
                          Remover
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-2 mb-2">
                        <div>
                          <label className="block text-xs text-slate-500 dark:text-[#aaa] mb-0.5">Tipo</label>
                          <select
                            value={step.type}
                            onChange={(e) => updatePlanStep(index, 'type', e.target.value)}
                            className="w-full px-2 py-1.5 border border-slate-300 dark:border-[#555] rounded text-slate-800 dark:text-white bg-white dark:bg-[#2a2a2a] text-sm"
                          >
                            <option value="text">Texto</option>
                            <option value="video">Vídeo</option>
                            <option value="image">Imagem</option>
                            <option value="audio">Áudio</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs text-slate-500 dark:text-[#aaa] mb-0.5">Esperar (s)</label>
                          <input
                            type="number"
                            min={MATURATION_MIN_STEP_DELAY_SEC}
                            value={step.delay_seconds}
                            onChange={(e) => updatePlanStep(index, 'delay_seconds', e.target.value)}
                            title="Segundos desde o envio anterior até este passo (mínimo 30)"
                            className="w-full px-2 py-1.5 border border-slate-300 dark:border-[#555] rounded text-slate-800 dark:text-white bg-white dark:bg-[#2a2a2a] text-sm"
                          />
                          <p className="text-[10px] text-slate-400 dark:text-[#777] mt-0.5 leading-tight">Intervalo após o passo anterior</p>
                        </div>
                      </div>
                      {step.type === 'text' ? (
                        <div>
                          <label className="block text-xs text-slate-500 dark:text-[#aaa] mb-0.5">Texto a enviar</label>
                          <textarea
                            value={step.payload.text || ''}
                            onChange={(e) => updatePlanStep(index, 'text', e.target.value)}
                            placeholder="Digite a mensagem que será enviada neste passo…"
                            rows={2}
                            className="w-full px-2 py-1.5 border border-slate-300 dark:border-[#555] rounded text-slate-800 dark:text-white bg-white dark:bg-[#2a2a2a] text-sm resize-none"
                          />
                        </div>
                      ) : (
                        <>
                          <div className="mb-2">
                            <label className="block text-xs text-slate-500 dark:text-[#aaa] mb-0.5">URL da mídia *</label>
                            <input
                              type="url"
                              value={step.payload.media_url || ''}
                              onChange={(e) => updatePlanStep(index, 'media_url', e.target.value)}
                              placeholder="https://..."
                              className="w-full px-2 py-1.5 border border-slate-300 dark:border-[#555] rounded text-slate-800 dark:text-white bg-white dark:bg-[#2a2a2a] text-sm"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-slate-500 dark:text-[#aaa] mb-0.5">Legenda</label>
                            <input
                              type="text"
                              value={step.payload.caption || ''}
                              onChange={(e) => updatePlanStep(index, 'caption', e.target.value)}
                              placeholder="Opcional"
                              className="w-full px-2 py-1.5 border border-slate-300 dark:border-[#555] rounded text-slate-800 dark:text-white bg-white dark:bg-[#2a2a2a] text-sm"
                            />
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="p-4 border-t border-slate-200 dark:border-[#404040] flex justify-end gap-2">
              <button type="button" onClick={() => setShowPlanModal(false)} className="px-4 py-2 rounded-lg border border-slate-300 dark:border-[#555] text-slate-700 dark:text-[#aaa] hover:bg-slate-50 dark:hover:bg-[#333]">
                Cancelar
              </button>
              <button type="button" onClick={handleSavePlan} disabled={planSaving} className="px-4 py-2 rounded-lg bg-[#8CD955] text-white hover:bg-[#7BC84A] disabled:opacity-50 flex items-center gap-2">
                {planSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {planSaving ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
