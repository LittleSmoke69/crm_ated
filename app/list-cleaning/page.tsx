'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useRequireAuth } from '@/utils/useRequireAuth';
import Layout from '@/components/Layout';
import { useSidebar } from '@/contexts/SidebarContext';
import {
  Upload,
  CheckCircle2,
  XCircle,
  Clock,
  Download,
  Play,
  Coffee,
  AlertTriangle,
  Loader2,
  Trash2,
  Users,
  CopyMinus,
  SearchCheck,
  History,
  Eye,
  RotateCw,
  ChevronLeft,
  ChevronRight,
  StopCircle,
} from 'lucide-react';
import { parsePhoneList } from '@/lib/utils/list-cleaning-parser';

const MAX_NUMBERS = 1000;
const COFFEE_PAUSE_SECONDS = 15 * 60;

interface JobDetail {
  id: string;
  status: string;
  total_raw: number;
  total_unique: number;
  duplicates_removed: number;
  verified_count: number;
  validated_count: number;
  not_validated_count: number;
  pending_count: number;
  next_run_at: string | null;
  error_message: string | null;
}

interface VerificationRun {
  id: string;
  total_numbers: number;
  processed_numbers: number;
  status: string;
  current_slot: number;
}

interface JobListItem {
  id: string;
  user_id?: string;
  created_at: string;
  updated_at: string;
  status: string;
  total_raw: number;
  total_unique: number;
  duplicates_removed: number;
  verified_count: number;
  validated_count: number;
  not_validated_count: number;
  pending_count: number;
  next_run_at: string | null;
  error_message: string | null;
  /** Preenchido apenas para admin (lista de todos) */
  profiles?: { full_name: string | null; email: string } | null;
}

interface RawRow {
  index: number;
  phone: string;
  status_raw: string;
}

interface CleanRow {
  index: number;
  phone: string;
  whatsapp_status: string;
  validated_at: string | null;
}

const ALLOWED_LIST_CLEANING_STATUSES = ['super_admin', 'admin', 'dono_banca', 'gerente'] as const;

const PROFILE_CHECK_TIMEOUT_MS = 12000;

export default function ListCleaningPage() {
  const router = useRouter();
  const { checking, userId } = useRequireAuth();
  const { isCollapsed, setIsCollapsed, isMobileOpen, setIsMobileOpen } = useSidebar();
  const [rawText, setRawText] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<JobDetail | null>(null);
  const [run, setRun] = useState<VerificationRun | null>(null);
  const [rawList, setRawList] = useState<RawRow[]>([]);
  const [cleanList, setCleanList] = useState<CleanRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [coffeeSecondsLeft, setCoffeeSecondsLeft] = useState<number | null>(null);
  const [pollInterval, setPollInterval] = useState<ReturnType<typeof setInterval> | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [accessChecked, setAccessChecked] = useState(false);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [accessCheckRetry, setAccessCheckRetry] = useState(0);
  const [jobsList, setJobsList] = useState<JobListItem[]>([]);
  const [jobsListLoading, setJobsListLoading] = useState(false);
  const [jobsListPage, setJobsListPage] = useState(1);
  const [jobsListTotal, setJobsListTotal] = useState(0);
  const [jobsListTotalPages, setJobsListTotalPages] = useState(1);
  const JOBS_PER_PAGE = 10;
  /** Resumo do último lote de verificação (para acompanhamento/log) */
  const [lastVerifySummary, setLastVerifySummary] = useState<{
    processed: number;
    validated: number;
    not_validated: number;
    invalid_phones: string[];
  } | null>(null);
  const [capabilities, setCapabilities] = useState<{ canDedup: boolean; canWhatsapp: boolean }>({
    canDedup: true,
    canWhatsapp: true,
  });

  const fetchJobsList = useCallback(async (page: number = 1) => {
    if (!userId) return;
    setJobsListLoading(true);
    try {
      const res = await fetch(
        `/api/list-cleaning?page=${page}&per_page=${JOBS_PER_PAGE}`,
        { headers: { 'X-User-Id': userId } }
      );
      if (!res.ok) return;
      const json = await res.json();
      if (json.success && json.data) {
        const payload = json.data;
        const list = Array.isArray(payload.data) ? payload.data : [];
        const totalPages = Math.max(1, payload.total_pages ?? 1);
        const resolvedPage = Math.min(payload.page ?? page, totalPages);
        setJobsList(list);
        setJobsListTotal(payload.total ?? list.length);
        setJobsListTotalPages(totalPages);
        setJobsListPage(resolvedPage);
      }
    } catch {
      setToast({ message: 'Erro ao carregar histórico de limpezas', type: 'error' });
    } finally {
      setJobsListLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (checking || !userId) return;
    setAccessError(null);
    let cancelled = false;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), PROFILE_CHECK_TIMEOUT_MS);

    (async () => {
      try {
        const res = await fetch('/api/user/profile', {
          headers: { 'X-User-Id': userId },
          signal: controller.signal,
        });
        if (cancelled) return;
        const json = await res.json().catch(() => ({}));
        const status = json?.data?.status;
        if (!status || !ALLOWED_LIST_CLEANING_STATUSES.includes(status)) {
          router.replace('/');
          return;
        }
        if (!cancelled) setAccessChecked(true);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof Error && err.name === 'AbortError') {
          setAccessError('A verificação de acesso demorou muito. Tente novamente.');
        } else {
          router.replace('/');
        }
      } finally {
        clearTimeout(timeoutId);
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, [checking, userId, router, accessCheckRetry]);

  useEffect(() => {
    if (accessChecked && userId) fetchJobsList(1);
  }, [accessChecked, userId, fetchJobsList]);

  useEffect(() => {
    if (!accessChecked || !userId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/list-cleaning/capabilities', {
          headers: { 'X-User-Id': userId },
        });
        if (cancelled) return;
        const json = await res.json().catch(() => ({}));
        if (json.success && json.data) {
          setCapabilities({
            canDedup: json.data.canDedup !== false,
            canWhatsapp: json.data.canWhatsapp !== false,
          });
        }
      } catch {
        // mantém defaults
      }
    })();
    return () => { cancelled = true; };
  }, [accessChecked, userId]);

  const phonesCount = rawText.trim()
    ? Math.min(MAX_NUMBERS, parsePhoneList(rawText.trim()).length)
    : 0;

  const fetchJobDetail = useCallback(async (id: string) => {
    if (!userId) return;
    try {
      const res = await fetch(`/api/list-cleaning/${id}`, {
        headers: { 'X-User-Id': userId },
      });
      if (!res.ok) return;
      const json = await res.json();
      if (json.success && json.data) {
        setJob(json.data.job);
        setRun(json.data.run ?? null);
        setRawList(json.data.rawList || []);
        setCleanList(json.data.cleanList || []);
        if (json.data.job?.next_run_at) {
          const next = new Date(json.data.job.next_run_at).getTime();
          const left = Math.max(0, Math.ceil((next - Date.now()) / 1000));
          setCoffeeSecondsLeft(left);
        } else {
          setCoffeeSecondsLeft(null);
        }
      }
    } catch {
      setToast({ message: 'Erro ao carregar job', type: 'error' });
    }
  }, [userId]);

  useEffect(() => {
    if (!jobId || !userId) return;
    fetchJobDetail(jobId);
  }, [jobId, userId, fetchJobDetail]);

  useEffect(() => {
    if (job?.status !== 'coffee_pause' || !job?.next_run_at) {
      setCoffeeSecondsLeft(null);
      return;
    }
    const next = new Date(job.next_run_at).getTime();
    const tick = () => {
      const left = Math.max(0, Math.ceil((next - Date.now()) / 1000));
      setCoffeeSecondsLeft(left);
      if (left <= 0) {
        fetchJobDetail(jobId!);
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [job?.status, job?.next_run_at, jobId, fetchJobDetail]);

  useEffect(() => {
    const shouldPoll = jobId && (job?.status === 'verifying' || verifying || (run?.status === 'running'));
    if (!shouldPoll) return;
    const id = setInterval(() => fetchJobDetail(jobId!), 1500);
    setPollInterval(id);
    return () => {
      clearInterval(id);
      setPollInterval(null);
    };
  }, [job?.status, jobId, verifying, run?.status, fetchJobDetail]);

  const handleDeduplicate = async () => {
    if (!rawText.trim()) {
      setToast({ message: 'Cole números ou envie um arquivo', type: 'error' });
      return;
    }
    const phones = parsePhoneList(rawText.trim());
    if (phones.length === 0) {
      setToast({ message: 'Nenhum número válido encontrado', type: 'error' });
      return;
    }
    if (phones.length > MAX_NUMBERS) {
      setToast({ message: `Máximo ${MAX_NUMBERS} números por upload`, type: 'error' });
      return;
    }
    setLoading(true);
    setToast(null);
    try {
      const res = await fetch('/api/list-cleaning', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId || '' },
        body: JSON.stringify({ rawText: rawText.trim() }),
      });
      const json = await res.json();
      if (!json.success) {
        setToast({ message: json.error || 'Erro ao deduplicar', type: 'error' });
        return;
      }
      setJobId(json.data.jobId);
      setToast({ message: `Deduplicação concluída. ${json.data.duplicates_removed} duplicado(s) removido(s).`, type: 'success' });
      await fetchJobDetail(json.data.jobId);
      fetchJobsList();
    } catch {
      setToast({ message: 'Erro de rede', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleStartVerify = async () => {
    if (!jobId) return;
    if (job?.status === 'paused_disconnected') {
      setToast({ message: 'Verificação desativada. Reconecte a sessão e tente novamente.', type: 'error' });
      return;
    }
    setVerifying(true);
    setToast(null);
    try {
      const res = await fetch(`/api/list-cleaning/${jobId}/verify`, {
        method: 'POST',
        headers: { 'X-User-Id': userId || '' },
      });
      const json = await res.json();
      if (json.success) {
        const d = json.data;
        setLastVerifySummary({
          processed: d?.processed ?? 0,
          validated: d?.validated ?? 0,
          not_validated: d?.not_validated ?? 0,
          invalid_phones: Array.isArray(d?.invalid_phones) ? d.invalid_phones : [],
        });
        if (d?.total_numbers != null && d?.processed_numbers != null && !d?.run_completed) {
          setRun({
            id: '',
            total_numbers: d.total_numbers,
            processed_numbers: d.processed_numbers,
            status: 'running',
            current_slot: 0,
          });
        }
        if (job) {
          setJob({
            ...job,
            status: 'verifying',
            verified_count: d?.processed_numbers ?? job.verified_count,
            validated_count: d?.validated ?? job.validated_count,
            not_validated_count: d?.not_validated ?? job.not_validated_count,
            pending_count: d?.pending ?? job.pending_count,
          });
        }
        const msg = d?.message || 'Verificação em andamento';
        if (msg !== 'Verificação concluída') setToast({ message: msg, type: 'success' });
        await fetchJobDetail(jobId);
        fetchJobsList(jobsListPage);
        if (d?.next_run_at) setCoffeeSecondsLeft(COFFEE_PAUSE_SECONDS);
      } else {
        setToast({ message: json.error || 'Erro ao iniciar verificação', type: 'error' });
        if (json.error?.includes('desativada')) await fetchJobDetail(jobId);
      }
    } catch {
      setToast({
        message:
          'Falha de conexão ou tempo esgotado. A verificação pode continuar em segundo plano — atualize a página para ver o progresso.',
        type: 'error',
      });
      await fetchJobDetail(jobId);
      fetchJobsList(jobsListPage);
    } finally {
      setVerifying(false);
    }
  };

  const handleDownload = (limit: number, id?: string) => {
    const targetId = id ?? jobId;
    if (!targetId) return;
    window.open(`/api/list-cleaning/${targetId}/download?limit=${limit}`, '_blank');
    setToast({ message: `Download iniciado (${limit} validados)`, type: 'success' });
  };

  const handleStopVerify = async (jobIdToStop: string) => {
    setStoppingId(jobIdToStop);
    setToast(null);
    try {
      const res = await fetch(`/api/list-cleaning/${jobIdToStop}/stop`, {
        method: 'POST',
        headers: { 'X-User-Id': userId || '' },
      });
      const json = await res.json();
      if (json.success) {
        setToast({
          message: json.data?.message ?? 'Verificação interrompida. Você já pode baixar o CSV dos números verificados.',
          type: 'success',
        });
        if (jobIdToStop === jobId) await fetchJobDetail(jobIdToStop);
        fetchJobsList(jobsListPage);
      } else {
        setToast({ message: json.error ?? 'Erro ao parar verificação', type: 'error' });
      }
    } catch {
      setToast({ message: 'Erro de rede ao parar verificação', type: 'error' });
    } finally {
      setStoppingId(null);
    }
  };

  const handleClearList = () => {
    setRawText('');
    setFileName(null);
    setJobId(null);
    setJob(null);
    setRun(null);
    setRawList([]);
    setCleanList([]);
    setLastVerifySummary(null);
    setToast({ message: 'Lista limpa. Você pode importar uma nova lista.', type: 'success' });
  };

  const openJob = (id: string) => {
    setJobId(id);
    setLastVerifySummary(null);
    setRun(null);
    fetchJobDetail(id);
  };

  const statusLabel: Record<string, string> = {
    draft: 'Rascunho',
    deduped: 'Deduplicado',
    verifying: 'Verificando',
    coffee_pause: 'Pausa café',
    paused_disconnected: 'Pausado (desconectado)',
    done: 'Concluído',
    error: 'Erro',
  };

  const readFileContent = (text: string, name?: string) => {
    setRawText(text);
    if (name) setFileName(name);
    const count = parsePhoneList(text).length;
    setToast({ message: `Arquivo carregado: ${count} número(s)`, type: 'success' });
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      readFileContent((reader.result as string) || '', file.name);
    };
    reader.readAsText(file, 'UTF-8');
    e.target.value = '';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    const ext = file.name.toLowerCase().slice(-4);
    if (!file.name.toLowerCase().endsWith('.csv') && !file.name.toLowerCase().endsWith('.txt')) {
      setToast({ message: 'Envie um arquivo .csv ou .txt', type: 'error' });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      readFileContent((reader.result as string) || '', file.name);
    };
    reader.readAsText(file, 'UTF-8');
  };

  const formatTimer = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  };

  const canStartVerification =
    Boolean(
      jobId &&
        job &&
        job.status !== 'verifying' &&
        job.status !== 'done' &&
        job.status !== 'paused_disconnected' &&
        !(job.status === 'coffee_pause' && (coffeeSecondsLeft ?? 0) > 0)
    );

  const isVerifying = verifying || job?.status === 'verifying';
  const verifyingPhrase = 'Verificando Números, Isso pode demorar um Pouco';

  const verifyButtonLabel = (() => {
    if (job?.status === 'verifying') return verifyingPhrase;
    if (job?.status === 'done') return 'Verificação concluída';
    if (job?.status === 'coffee_pause' && (coffeeSecondsLeft ?? 0) > 0) {
      return `Aguardar ${formatTimer(coffeeSecondsLeft || 0)}`;
    }
    if (job?.status === 'paused_disconnected') return 'Sessão desconectada';
    return 'Iniciar verificação';
  })();

  const nonValidRows = cleanList.filter(
    (r) => r.whatsapp_status === 'inactive' || r.whatsapp_status === 'unknown'
  );
  const invalidCount = nonValidRows.filter((r) => r.whatsapp_status === 'inactive').length;
  const unknownCount = nonValidRows.length - invalidCount;

  if (!checking && !userId) {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center min-h-[40vh] gap-4 p-4">
          <Loader2 className="w-8 h-8 animate-spin text-[#8CD955]" />
          <p className="text-gray-600">Redirecionando para login...</p>
        </div>
      </Layout>
    );
  }

  if (accessError) {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center min-h-[40vh] gap-4 p-4">
          <AlertTriangle className="w-12 h-12 text-amber-500" />
          <p className="text-center text-gray-700">{accessError}</p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => {
                setAccessError(null);
                setAccessChecked(false);
                setAccessCheckRetry((r) => r + 1);
              }}
              className="px-4 py-2 rounded-lg bg-[#8CD955] hover:bg-[#7BC84A] text-white font-medium"
            >
              Tentar novamente
            </button>
            <button
              type="button"
              onClick={() => router.push('/')}
              className="px-4 py-2 rounded-lg border border-[#404040] text-gray-300 font-medium hover:bg-[#404040]"
            >
              Ir para início
            </button>
          </div>
        </div>
      </Layout>
    );
  }

  if (checking || !accessChecked) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[40vh]">
          <Loader2 className="w-8 h-8 animate-spin text-[#8CD955]" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="-m-4 sm:-m-6 lg:-m-8 p-4 sm:p-6 lg:p-8 min-h-screen bg-[#1a1a1a]">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center gap-2">
          <Trash2 className="w-6 h-6 text-[#8CD955]" />
          <h1 className="text-2xl font-semibold text-gray-100">Limpeza de Lista</h1>
        </div>

        {toast && (
          <div
            className={`p-3 rounded-lg flex items-center justify-between ${
              toast.type === 'error' ? 'bg-red-900/30 text-red-200 border border-red-500/50' : 'bg-green-900/30 text-green-200 border border-green-500/50'
            }`}
          >
            <span>{toast.message}</span>
            <button onClick={() => setToast(null)} className="p-1">
              <XCircle className="w-4 h-4" />
            </button>
          </div>
        )}

        {job?.status === 'done' && (
          <div className="bg-green-900/20 border border-green-500/50 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-900/40">
                <CheckCircle2 className="w-6 h-6 text-green-400" />
              </div>
              <div>
                <p className="font-semibold text-green-200">Verificação concluída</p>
                <p className="text-sm text-green-300">
                  {job.validated_count > 0
                    ? `${job.validated_count} número(s) validado(s) disponível(is) para download.`
                    : 'Nenhum número validado nesta lista.'}
                </p>
              </div>
            </div>
            {job.validated_count > 0 && (
              <button
                onClick={() => handleDownload(Math.min(job.validated_count, 1000))}
                className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-[#8CD955] hover:bg-[#7BC84A] text-white font-medium transition shrink-0"
              >
                <Download className="w-5 h-5" />
                Baixar CSV com números validados
              </button>
            )}
          </div>
        )}

        {job?.status === 'paused_disconnected' && (
          <div className="bg-red-900/20 border border-red-500/50 text-red-200 p-4 rounded-lg flex items-center gap-3">
            <AlertTriangle className="w-6 h-6 flex-shrink-0" />
            <div>
              <p className="font-semibold">Verificação desativada temporariamente</p>
              <p className="text-sm">A sessão do WhatsApp não está ativa. Reconecte a sessão e tente novamente.</p>
            </div>
          </div>
        )}

        {(job?.status === 'verifying' || run?.status === 'running') && (
          <div className="bg-blue-900/20 border border-blue-500/50 text-blue-200 p-4 rounded-xl space-y-3">
            <div className="flex items-center gap-4">
              <Loader2 className="w-8 h-8 flex-shrink-0 animate-spin text-blue-600" />
              <div className="flex-1 min-w-0">
                <p className="font-semibold">Verificando números</p>
                <p className="text-sm">
                  {run && run.total_numbers > 0
                    ? `${run.processed_numbers} de ${run.total_numbers} já verificados — o processo continua em segundo plano.`
                    : 'O sistema está consultando a API para validar cada número. Aguarde a conclusão.'}
                </p>
              </div>
            </div>
            {run && run.total_numbers > 0 && (
              <div className="flex items-center gap-3">
                <div className="flex-1 h-2.5 bg-blue-900/50 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded-full transition-all duration-500 ease-out"
                    style={{ width: `${Math.min(100, (run.processed_numbers / run.total_numbers) * 100)}%` }}
                  />
                </div>
                <span className="text-sm font-medium tabular-nums shrink-0">
                  {Math.round((run.processed_numbers / run.total_numbers) * 100)}%
                </span>
              </div>
            )}
          </div>
        )}

        {lastVerifySummary && jobId && capabilities.canWhatsapp && (
          <div className="bg-slate-800/50 border border-slate-600 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-slate-200 mb-2">Resumo do último lote (acompanhamento)</h3>
            <div className="flex flex-wrap gap-4 text-sm">
              <span className="text-slate-400">Processados: <strong>{lastVerifySummary.processed}</strong></span>
              <span className="text-green-400">Validados: <strong>{lastVerifySummary.validated}</strong></span>
              <span className="text-red-400">Não validados: <strong>{lastVerifySummary.not_validated}</strong></span>
            </div>
            {lastVerifySummary.not_validated > 0 && (
              <p className="text-xs text-slate-500 mt-2">Para ver os números não válidos, consulte a tabela &quot;Números não válidos&quot; abaixo.</p>
            )}
          </div>
        )}

        {job && (
          <section className="space-y-4">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">
              {capabilities.canWhatsapp ? 'Resumo da limpeza' : 'Resumo da deduplicação'}
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              <div className="bg-[#2a2a2a] border border-[#404040] rounded-xl p-4 shadow-sm flex items-start gap-3">
                <div className="p-2 rounded-lg bg-[#404040]">
                  <Users className="w-5 h-5 text-gray-400" />
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-0.5">Total enviados</p>
                  <p className="text-2xl font-bold text-gray-200">{job.total_raw}</p>
                </div>
              </div>
              <div className="bg-amber-900/20 border border-amber-500/50 rounded-xl p-4 shadow-sm flex items-start gap-3">
                <div className="p-2 rounded-lg bg-amber-900/40">
                  <CopyMinus className="w-5 h-5 text-amber-400" />
                </div>
                <div>
                  <p className="text-xs font-medium text-amber-400 uppercase tracking-wide mb-0.5">Duplicados removidos</p>
                  <p className="text-2xl font-bold text-amber-400">{job.duplicates_removed}</p>
                </div>
              </div>
              {capabilities.canWhatsapp && (
              <div className="bg-[#2a2a2a] border border-[#404040] rounded-xl p-4 shadow-sm flex items-start gap-3">
                <div className="p-2 rounded-lg bg-blue-900/40">
                  <SearchCheck className="w-5 h-5 text-blue-400" />
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-0.5">Verificados</p>
                  <p className="text-2xl font-bold text-gray-200">{job.verified_count}</p>
                </div>
              </div>
              )}
              {capabilities.canWhatsapp && (
              <div className="bg-green-900/20 border border-green-500/50 rounded-xl p-4 shadow-sm flex items-start gap-3">
                <div className="p-2 rounded-lg bg-green-900/40">
                  <CheckCircle2 className="w-5 h-5 text-green-400" />
                </div>
                <div>
                  <p className="text-xs font-medium text-green-400 uppercase tracking-wide mb-0.5">Validados</p>
                  <p className="text-2xl font-bold text-green-400">{job.validated_count}</p>
                </div>
              </div>
              )}
              {capabilities.canWhatsapp && (
              <div className="bg-red-900/20 border border-red-500/50 rounded-xl p-4 shadow-sm flex items-start gap-3">
                <div className="p-2 rounded-lg bg-red-900/40">
                  <XCircle className="w-5 h-5 text-red-400" />
                </div>
                <div>
                  <p className="text-xs font-medium text-red-400 uppercase tracking-wide mb-0.5">Não validados</p>
                  <p className="text-2xl font-bold text-red-400">{job.not_validated_count}</p>
                </div>
              </div>
              )}
              {capabilities.canWhatsapp && (
              <div className="bg-[#2a2a2a] border border-[#404040] rounded-xl p-4 shadow-sm flex items-start gap-3">
                <div className="p-2 rounded-lg bg-[#404040]">
                  <Clock className="w-5 h-5 text-gray-400" />
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-0.5">Pendentes</p>
                  <p className="text-2xl font-bold text-gray-200">{job.pending_count}</p>
                </div>
              </div>
              )}
            </div>
          </section>
        )}

        {/* Ações em destaque: importar lista e botões (acima das tabelas) */}
        <section className="border border-[#404040] rounded-xl bg-[#2a2a2a] shadow-sm p-4 lg:p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-gray-200">Importar e processar</h2>
            <button
              onClick={handleClearList}
              type="button"
              className="inline-flex items-center gap-1.5 rounded-full border border-[#404040] px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400 hover:bg-[#404040] transition"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Limpar lista
            </button>
          </div>
          <div className="grid gap-4 lg:grid-cols-[1fr_minmax(260px,320px)] lg:items-start">
            <div className="space-y-3">
              <label className="block w-full">
                <div
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  className={`cursor-pointer flex flex-col items-center justify-center gap-2 px-4 py-5 bg-[#1a1a1a] border-2 border-dashed rounded-lg transition text-center ${
                    isDragging ? 'border-[#8CD955] bg-[#8CD95520]' : 'border-[#404040] hover:border-[#8CD95560] hover:bg-[#8CD95510]'
                  }`}
                >
                  <Upload className="w-6 h-6 text-[#8CD955]" />
                  <span className="text-sm text-[#8CD955] font-medium">Clique ou arraste arquivo</span>
                  <span className="text-xs text-gray-500">CSV/TXT, coluna phone, até 1000 números</span>
                  {fileName && <span className="text-xs text-gray-400 truncate max-w-full">Arquivo: {fileName}</span>}
                </div>
                <input type="file" accept=".csv,.txt" onChange={handleFileSelect} className="hidden" />
              </label>
              <div>
                <p className="text-xs font-medium text-gray-400 mb-1">Ou cole os números (um por linha)</p>
                <textarea
                  value={rawText}
                  onChange={(e) => { setRawText(e.target.value); if (fileName) setFileName(null); }}
                  placeholder="559876543210&#10;559876543211"
                  className="w-full h-20 border border-[#404040] rounded-lg p-2.5 text-sm font-mono text-gray-200 bg-[#1a1a1a] placeholder-gray-500"
                  maxLength={MAX_NUMBERS * 20}
                />
                <p className="mt-1 text-xs text-gray-500">{phonesCount}/1000</p>
              </div>
              {phonesCount > 0 && (
                <p className="text-sm text-gray-400"><strong>{phonesCount}</strong> número(s) prontos para deduplicar</p>
              )}
            </div>
            <div className="flex flex-col gap-3">
              <div className="rounded-2xl border border-[#404040] bg-[#2a2a2a] p-4 shadow-sm space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-[#8CD955]">Etapa 1</p>
                    <p className="text-lg font-semibold text-gray-200">Preparar lista</p>
                    <p className="text-sm text-gray-500">Envie um CSV/TXT ou cole os números e remova duplicidades antes da validação.</p>
                  </div>
                  <div className="text-right">
                    <span className="inline-flex items-center gap-1 rounded-full bg-[#404040] px-2 py-0.5 text-[11px] font-semibold text-gray-400">
                      Prontos
                    </span>
                    <p className="text-2xl font-bold text-gray-200">{phonesCount}</p>
                    <p className="text-xs text-gray-500">de 1000</p>
                  </div>
                </div>
                <button
                  onClick={handleDeduplicate}
                  disabled={loading || !rawText.trim()}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#8CD955] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#7BC84A] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  Deduplicar agora
                </button>
              </div>
              {jobId && capabilities.canWhatsapp ? (
                <div className="rounded-2xl border border-[#404040] bg-[#2a2a2a] p-4 shadow-sm space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-blue-400">Etapa 2</p>
                      <p className="text-lg font-semibold text-gray-200">Verificar no WhatsApp</p>
                      <p className="text-sm text-gray-500">O sistema processa até 500 números por rodada e pausa automaticamente.</p>
                    </div>
                    {job && (
                      <div className="text-right">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                            job.status === 'done'
                              ? 'bg-green-900/40 text-green-400'
                              : job.status === 'verifying'
                                ? 'bg-blue-900/40 text-blue-400'
                                : job.status === 'coffee_pause'
                                  ? 'bg-amber-900/40 text-amber-400'
                                  : job.status === 'paused_disconnected' || job.status === 'error'
                                    ? 'bg-red-900/40 text-red-400'
                                    : 'bg-[#404040] text-gray-400'
                          }`}
                        >
                          {job.status === 'verifying' && <Loader2 className="w-3 h-3 animate-spin" />}
                          {statusLabel[job.status] ?? job.status}
                        </span>
                        {job.status === 'coffee_pause' && (coffeeSecondsLeft ?? 0) > 0 && (
                          <p className="mt-1 text-xs font-semibold text-amber-400">
                            Próxima rodada em {formatTimer(coffeeSecondsLeft || 0)}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col gap-2">
                    <button
                      onClick={handleStartVerify}
                      disabled={!canStartVerification || verifying}
                      className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isVerifying ? <Loader2 className="w-4 h-4 flex-shrink-0 animate-spin" /> : <Play className="w-4 h-4 flex-shrink-0" />}
                      {isVerifying ? (
                        <span className="verify-marquee-wrap">
                          <span className="verify-marquee-text">
                            {verifyingPhrase}
                            {' · '}
                            {verifyingPhrase}
                          </span>
                        </span>
                      ) : (
                        verifyButtonLabel
                      )}
                    </button>
                    {(job?.status === 'verifying' || job?.status === 'coffee_pause') && (
                      <button
                        type="button"
                        onClick={() => handleStopVerify(jobId!)}
                        disabled={stoppingId === jobId}
                        className="flex w-full items-center justify-center gap-2 rounded-xl border border-red-500/50 bg-red-900/30 px-4 py-3 text-sm font-semibold text-red-300 transition hover:bg-red-900/50 disabled:opacity-50"
                      >
                        {stoppingId === jobId ? <Loader2 className="w-4 h-4 animate-spin" /> : <StopCircle className="w-4 h-4" />}
                        Parar verificação
                      </button>
                    )}
                  </div>
                  {job?.validated_count !== undefined && job.validated_count > 0 && (
                    <button
                      onClick={() => handleDownload(Math.min(job.validated_count, 1000))}
                      className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#404040] px-4 py-3 text-sm font-semibold text-gray-300 transition hover:bg-[#404040]"
                    >
                      <Download className="w-4 h-4" />
                      Baixar CSV ({job.validated_count})
                    </button>
                  )}
                </div>
              ) : jobId && !capabilities.canWhatsapp ? (
                <div className="rounded-2xl border border-[#404040] bg-[#2a2a2a] p-4 text-center text-sm text-gray-400">
                  <p className="font-medium text-gray-300">Deduplicação concluída</p>
                  <p className="mt-1">Sua lista está pronta. A verificação no WhatsApp não está disponível para seu cargo.</p>
                    {job && job.total_unique > 0 && (
                    <button
                      onClick={() => {
                        window.open(`/api/list-cleaning/${jobId}/download?limit=${job.total_unique}&mode=dedup`, '_blank');
                        setToast({ message: `Download iniciado (${job.total_unique} deduplicados)`, type: 'success' });
                      }}
                      className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-[#404040] px-4 py-3 text-sm font-semibold text-gray-300 transition hover:bg-[#404040]"
                    >
                      <Download className="w-4 h-4" />
                      Baixar lista deduplicada ({job.total_unique} números)
                    </button>
                  )}
                </div>
              ) : (
                <div className="rounded-2xl border-2 border-dashed border-[#404040] bg-[#2a2a2a] p-4 text-center text-sm text-gray-500">
                  <p className="font-medium text-gray-400">Deduplicação pendente</p>
                  <p className="mt-1">Assim que concluir a etapa 1, os botões para iniciar a limpeza aparecerão aqui.</p>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Tabelas: Lista Bruta e Lista Limpa */}
        <section className="space-y-4">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">Listas</h2>
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="border border-[#404040] rounded-lg overflow-hidden shadow-sm">
              <div className="bg-[#2a2a2a] px-4 py-2 font-medium text-gray-200">Lista Bruta</div>
              <div className="overflow-x-auto max-h-96 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-[#2a2a2a] sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left text-gray-400">#</th>
                    <th className="px-3 py-2 text-left text-gray-400">phone</th>
                    <th className="px-3 py-2 text-left text-gray-400">status</th>
                  </tr>
                </thead>
                <tbody className="text-gray-300">
                  {rawList.slice(0, 100).map((r) => (
                    <tr key={r.index} className="border-t border-[#404040]">
                      <td className="px-3 py-1">{r.index}</td>
                      <td className="px-3 py-1 font-mono">{r.phone}</td>
                      <td className="px-3 py-1">{r.status_raw}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rawList.length > 100 && (
                <p className="px-3 py-2 text-xs text-gray-500">Exibindo 100 de {rawList.length}</p>
              )}
            </div>
          </div>

          {capabilities.canWhatsapp && (
          <div className="border border-[#404040] rounded-lg overflow-hidden shadow-sm">
            <div className="bg-[#2a2a2a] px-4 py-2 font-medium text-gray-200">Lista Limpa</div>
            <div className="overflow-x-auto max-h-96 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-[#2a2a2a] sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left text-gray-400">#</th>
                    <th className="px-3 py-2 text-left text-gray-400">phone</th>
                    <th className="px-3 py-2 text-left text-gray-400">whatsapp_status</th>
                    <th className="px-3 py-2 text-left text-gray-400">validated_at</th>
                  </tr>
                </thead>
                <tbody className="text-gray-300">
                  {cleanList.slice(0, 100).map((r) => {
                    const isPending = r.whatsapp_status === 'pendente';
                    const isVerifying = job?.status === 'verifying';
                    const showVerifying = isPending && isVerifying;
                    return (
                      <tr
                        key={r.index}
                        className={`border-t border-[#404040] transition-colors duration-300 ${
                          showVerifying ? 'bg-blue-900/30 animate-pulse' : ''
                        } ${r.whatsapp_status === 'active' ? 'bg-green-900/20' : ''} ${
                          r.whatsapp_status === 'inactive' || r.whatsapp_status === 'unknown' ? 'bg-red-900/20' : ''
                        }`}
                      >
                        <td className="px-3 py-1.5">{r.index}</td>
                        <td className="px-3 py-1.5 font-mono">{r.phone}</td>
                        <td className="px-3 py-1.5">
                          {showVerifying ? (
                            <span className="inline-flex items-center gap-1.5 text-blue-400">
                              <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" />
                              <span className="animate-pulse">Verificando...</span>
                            </span>
                          ) : r.whatsapp_status === 'active' ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-green-900/40 px-2 py-0.5 text-xs font-medium text-green-400">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Validado
                            </span>
                          ) : r.whatsapp_status === 'inactive' ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-red-900/40 px-2 py-0.5 text-xs font-medium text-red-400">
                              <XCircle className="w-3.5 h-3.5" />
                              Não validado
                            </span>
                          ) : r.whatsapp_status === 'unknown' ? (
                            <span className="inline-flex items-center rounded-full bg-[#404040] px-2 py-0.5 text-xs font-medium text-gray-500">
                              Indefinido
                            </span>
                          ) : (
                            <span className="text-gray-500">{r.whatsapp_status}</span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-gray-400">
                          {r.validated_at ? new Date(r.validated_at).toLocaleString() : (showVerifying ? '...' : '-')}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {cleanList.length > 100 && (
                <p className="px-3 py-2 text-xs text-gray-500">Exibindo 100 de {cleanList.length}</p>
              )}
            </div>
          </div>
          )}

          {/* Números não válidos e indefinidos - ocupa toda a largura abaixo das duas listas, altura fixa */}
          {capabilities.canWhatsapp && (
          <div className="w-full lg:col-span-2 border border-red-500/50 rounded-lg overflow-hidden shadow-sm mt-4 flex flex-col bg-[#2a2a2a]">
            <div className="w-full bg-red-900/30 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-left font-medium text-red-300">
              <span className="flex items-center gap-2">
                <XCircle className="w-5 h-5" />
                Números não válidos (não estão no WhatsApp)
              </span>
              <div className="flex items-center gap-2 text-xs font-semibold">
                <span className="inline-flex items-center gap-1 rounded-full bg-red-900/50 px-2 py-0.5 text-red-200">
                  {invalidCount} não válido(s)
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-[#404040] px-2 py-0.5 text-gray-300">
                  {unknownCount} indefinido(s)
                </span>
              </div>
            </div>
            <div className="h-64 overflow-auto bg-[#1a1a1a] border-t border-red-500/30 shrink-0">
              {nonValidRows.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-gray-500">
                  <CheckCircle2 className="w-6 h-6 text-green-500" />
                  <p>Todos os números limpos desta lista estão ativos no WhatsApp.</p>
                </div>
              ) : (
                <>
                  <table className="w-full text-sm">
                    <thead className="bg-[#2a2a2a] sticky top-0 z-10">
                      <tr>
                        <th className="px-3 py-2 text-left text-gray-400">#</th>
                        <th className="px-3 py-2 text-left text-gray-400">phone</th>
                        <th className="px-3 py-2 text-left text-gray-400">status</th>
                        <th className="px-3 py-2 text-left text-gray-400">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="text-gray-300">
                      {nonValidRows.map((r) => {
                        const phoneDigits = String(r.phone).replace(/\D/g, '');
                        const waLink = phoneDigits ? `https://wa.me/${phoneDigits}` : '#';
                        const isInactive = r.whatsapp_status === 'inactive';
                        return (
                          <tr key={r.index} className="border-t border-[#404040]">
                            <td className="px-3 py-1.5">{r.index}</td>
                            <td className="px-3 py-1.5 font-mono">{r.phone}</td>
                            <td className="px-3 py-1.5">
                              {isInactive ? (
                                <span className="inline-flex items-center gap-1 rounded-full bg-red-900/40 px-2 py-0.5 text-xs font-medium text-red-400">
                                  <XCircle className="w-3.5 h-3.5" />
                                  Não validado
                                </span>
                              ) : (
                                <span className="inline-flex items-center rounded-full bg-[#404040] px-2 py-0.5 text-xs font-medium text-gray-500">
                                  Indefinido
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-1.5">
                              <a
                                href={waLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-[#25D366] hover:bg-[#20BD5A] text-white transition"
                                title="Abrir no WhatsApp"
                              >
                                WhatsApp
                              </a>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <p className="px-3 py-2 text-xs text-gray-500">
                    Total: {invalidCount} não válido(s), {unknownCount} indefinido(s).
                  </p>
                </>
              )}
            </div>
          </div>
          )}
          </div>
        </section>

        {/* Histórico de limpezas: feitas ou paradas; continuar com pendentes */}
        <section className="border border-[#404040] rounded-xl bg-[#2a2a2a] shadow-sm overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 bg-[#1a1a1a] border-b border-[#404040]">
            <History className="w-5 h-5 text-gray-400" />
            <h2 className="text-base font-semibold text-gray-200">Histórico de limpezas</h2>
          </div>
          <div className="overflow-x-auto">
            {jobsListLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-[#8CD955]" />
              </div>
            ) : jobsList.length === 0 ? (
              <p className="px-4 py-8 text-sm text-gray-500 text-center">Nenhuma limpeza ainda. Deduplique uma lista para começar.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-[#1a1a1a]">
                  <tr>
                    <th className="px-3 py-2.5 text-left text-gray-400 font-medium">Data</th>
                    {jobsList.some((j) => j.profiles != null) && (
                      <th className="px-3 py-2.5 text-left text-gray-400 font-medium">Usuário</th>
                    )}
                    <th className="px-3 py-2.5 text-left text-gray-400 font-medium">Status</th>
                    <th className="px-3 py-2.5 text-right text-gray-400 font-medium">Total</th>
                    <th className="px-3 py-2.5 text-right text-gray-400 font-medium">Validados</th>
                    <th className="px-3 py-2.5 text-right text-gray-400 font-medium">Pendentes</th>
                    <th className="px-3 py-2.5 text-right text-gray-400 font-medium">Ações</th>
                  </tr>
                </thead>
                <tbody className="text-gray-300 divide-y divide-[#404040]">
                  {jobsList.map((j) => {
                    const isCurrent = j.id === jobId;
                    const canContinue = j.pending_count > 0 && j.status !== 'done';
                    const showOwner = jobsList.some((x) => x.profiles != null);
                    return (
                      <tr
                        key={j.id}
                        className={`hover:bg-[#404040]/50 ${isCurrent ? 'bg-[#8CD955]/20' : ''}`}
                      >
                        <td className="px-3 py-2 whitespace-nowrap">
                          {new Date(j.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                        </td>
                        {showOwner && (
                          <td className="px-3 py-2 text-gray-600">
                            {j.profiles?.full_name || j.profiles?.email || (j.user_id ? String(j.user_id).slice(0, 8) + '…' : '-')}
                          </td>
                        )}
                        <td className="px-3 py-2">
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                              j.status === 'done'
                                ? 'bg-green-900/40 text-green-400'
                                : j.status === 'verifying'
                                  ? 'bg-blue-900/40 text-blue-400'
                                  : j.status === 'coffee_pause'
                                    ? 'bg-amber-900/40 text-amber-400'
                                    : j.status === 'paused_disconnected' || j.status === 'error'
                                      ? 'bg-red-900/40 text-red-400'
                                      : 'bg-[#404040] text-gray-400'
                            }`}
                          >
                            {j.status === 'verifying' && <Loader2 className="w-3 h-3 animate-spin" />}
                            {statusLabel[j.status] ?? j.status}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right">{j.total_unique}</td>
                        <td className="px-3 py-2 text-right">{j.validated_count}</td>
                        <td className="px-3 py-2 text-right">{j.pending_count}</td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex items-center justify-end gap-1 flex-wrap">
                            <button
                              type="button"
                              onClick={() => openJob(j.id)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded border border-[#404040] text-gray-300 text-xs font-medium hover:bg-[#404040] transition"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              Ver
                            </button>
                            {(j.status === 'verifying' || j.status === 'coffee_pause') && (
                              <button
                                type="button"
                                onClick={() => handleStopVerify(j.id)}
                                disabled={stoppingId === j.id}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded border border-red-500/50 text-red-400 text-xs font-medium hover:bg-red-900/30 disabled:opacity-50 transition"
                              >
                                {stoppingId === j.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <StopCircle className="w-3.5 h-3.5" />}
                                Parar
                              </button>
                            )}
                            {canContinue && (
                              <button
                                type="button"
                                onClick={() => openJob(j.id)}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[#8CD955] text-white text-xs font-medium hover:bg-[#7BC84A] transition"
                              >
                                <RotateCw className="w-3.5 h-3.5" />
                                Continuar
                              </button>
                            )}
                            {j.validated_count != null && j.validated_count > 0 && (
                              <button
                                type="button"
                                onClick={() => handleDownload(Math.min(j.validated_count, 1000), j.id)}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded border border-[#404040] text-gray-300 text-xs font-medium hover:bg-[#404040] transition"
                              >
                                <Download className="w-3.5 h-3.5" />
                                CSV
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            {!jobsListLoading && jobsList.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-[#404040] bg-[#1a1a1a]">
                <p className="text-sm text-gray-400">
                  Página <strong>{jobsListPage}</strong> de <strong>{jobsListTotalPages}</strong>
                  {jobsListTotal > 0 && (
                    <span className="ml-1">({jobsListTotal} registro{jobsListTotal !== 1 ? 's' : ''} no total)</span>
                  )}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => fetchJobsList(jobsListPage - 1)}
                    disabled={jobsListPage <= 1}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[#404040] text-gray-300 text-sm font-medium hover:bg-[#404040] disabled:opacity-50 disabled:cursor-not-allowed transition"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    Anterior
                  </button>
                  <button
                    type="button"
                    onClick={() => fetchJobsList(jobsListPage + 1)}
                    disabled={jobsListPage >= jobsListTotalPages}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[#404040] text-gray-300 text-sm font-medium hover:bg-[#404040] disabled:opacity-50 disabled:cursor-not-allowed transition"
                  >
                    Próxima
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>

        {job?.status === 'coffee_pause' && coffeeSecondsLeft !== null && coffeeSecondsLeft > 0 && (
          <div className="border-2 border-amber-500/50 bg-amber-900/20 rounded-xl p-6 text-center">
            <Coffee className="w-12 h-12 text-amber-400 mx-auto mb-2" />
            <p className="text-lg font-semibold text-amber-300">Pausa para o café ☕</p>
            <p className="text-3xl font-mono font-bold text-amber-400 mt-2">{formatTimer(coffeeSecondsLeft)}</p>
            <p className="text-sm text-amber-500 mt-1">O sistema continuará automaticamente após o timer.</p>
          </div>
        )}
      </div>
      </div>
    </Layout>
  );
}
