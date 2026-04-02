'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { X, Loader2, RotateCcw, Users, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { sanitizeMassSendErrorMessage } from '@/lib/utils/activation-send-errors';
import { normalizeActivationMassSendInstanceNames } from '@/lib/crm/mass-send-instance-names';
import { MassSendJobCountdownCell } from '@/components/CRM/MassSendJobCountdownCell';

export type MassSendGroupOutcome = {
  groupId: string;
  groupName?: string | null;
  success: boolean;
  error?: string;
};

export type MassSendJobDetail = {
  id: string;
  message_id: string;
  message_title: string | null;
  instance_name: string;
  instance_names?: string[] | null;
  status: string;
  total_groups: number;
  sent_count: number;
  failed_count: number;
  processed_index?: number;
  inter_group_delay_ms?: number | null;
  updated_at?: string | null;
  last_error: string | null;
  group_outcomes?: MassSendGroupOutcome[] | null;
  group_results?: MassSendGroupOutcome[] | null;
  group_ids?: string[] | null;
  groupNameMap?: Record<string, string> | null;
  created_at: string;
};

type GroupEntry = {
  groupId: string;
  groupName: string | null;
  status: 'success' | 'failed' | 'pending';
  error?: string;
};

type FilterTab = 'all' | 'success' | 'failed' | 'pending';

async function safeResponseJson(response: Response): Promise<{
  success?: boolean;
  data?: MassSendJobDetail;
  error?: string;
  message?: string;
}> {
  const text = await response.text();
  if (!text?.trim()) {
    return { success: false, error: `Resposta vazia (HTTP ${response.status})` };
  }
  try {
    return JSON.parse(text);
  } catch {
    return { success: false, error: 'Resposta inválida do servidor' };
  }
}

function normalizeOutcomes(raw: unknown, nameMap?: Record<string, string> | null): MassSendGroupOutcome[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((o) => {
      const r = o as Record<string, unknown>;
      const groupId = String(r.groupId ?? r.group_id ?? '').trim();
      if (!groupId) return null;
      const groupName = (r.groupName as string) || nameMap?.[groupId] || null;
      return {
        groupId,
        ...(groupName ? { groupName } : {}),
        success: r.success === true,
        ...(r.error ? { error: String(r.error) } : {}),
      } as MassSendGroupOutcome;
    })
    .filter(Boolean) as MassSendGroupOutcome[];
}

type ToastFn = (message: string, type: 'success' | 'error' | 'info') => void;

interface MassSendJobDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  jobId: string | null;
  userId: string | null;
  onRetryQueued: () => void;
  showToast: ToastFn;
}

const MassSendJobDetailModal: React.FC<MassSendJobDetailModalProps> = ({
  isOpen,
  onClose,
  jobId,
  userId,
  onRetryQueued,
  showToast,
}) => {
  const [loading, setLoading] = useState(false);
  const [job, setJob] = useState<MassSendJobDetail | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [filter, setFilter] = useState<FilterTab>('all');

  const load = useCallback(async () => {
    if (!userId || !jobId) return;
    setLoading(true);
    setJob(null);
    try {
      const res = await fetch(`/api/crm/activations/mass-send/jobs/${jobId}`, {
        headers: { 'X-User-Id': userId },
      });
      const data = await safeResponseJson(res);
      if (res.ok && data.success && data.data) {
        setJob(data.data);
      } else {
        showToast(data.error || 'Não foi possível carregar a campanha.', 'error');
        onClose();
      }
    } catch {
      showToast('Erro de rede ao carregar detalhes.', 'error');
      onClose();
    } finally {
      setLoading(false);
    }
  }, [userId, jobId, showToast, onClose]);

  useEffect(() => {
    if (isOpen && jobId && userId) {
      load();
    }
  }, [isOpen, jobId, userId, load]);

  // Build unified group list
  const { allGroups, counts } = useMemo(() => {
    if (!job) return { allGroups: [] as GroupEntry[], counts: { success: 0, failed: 0, pending: 0 } };

    const outcomes = normalizeOutcomes(job.group_outcomes ?? job.group_results, job.groupNameMap);
    const outcomeMap = new Map<string, MassSendGroupOutcome>();
    for (const o of outcomes) {
      outcomeMap.set(o.groupId, o);
    }

    const nameMap = job.groupNameMap ?? {};
    const allIds = Array.isArray(job.group_ids) ? (job.group_ids as string[]) : [];

    // If no group_ids, fall back to outcomes only
    const ids = allIds.length > 0 ? allIds : outcomes.map((o) => o.groupId);

    const entries: GroupEntry[] = ids.map((gid) => {
      const outcome = outcomeMap.get(gid);
      if (outcome) {
        return {
          groupId: gid,
          groupName: outcome.groupName || nameMap[gid] || null,
          status: outcome.success ? 'success' : 'failed',
          ...(outcome.error ? { error: outcome.error } : {}),
        } as GroupEntry;
      }
      return {
        groupId: gid,
        groupName: nameMap[gid] || null,
        status: 'pending',
      } as GroupEntry;
    });

    const c = { success: 0, failed: 0, pending: 0 };
    for (const e of entries) c[e.status]++;

    return { allGroups: entries, counts: c };
  }, [job]);

  const filtered = useMemo(() => {
    if (filter === 'all') return allGroups;
    return allGroups.filter((g) => g.status === filter);
  }, [allGroups, filter]);

  const failedIds = useMemo(
    () => allGroups.filter((g) => g.status === 'failed').map((g) => g.groupId),
    [allGroups]
  );

  if (!isOpen) return null;

  const total = allGroups.length || job?.total_groups || 0;
  const pctSuccess = total > 0 ? (counts.success / total) * 100 : 0;
  const pctFailed = total > 0 ? (counts.failed / total) * 100 : 0;

  const handleRetryFailures = async () => {
    if (!userId || !job || failedIds.length === 0) return;
    setRetrying(true);
    try {
      const instanceNames = normalizeActivationMassSendInstanceNames(
        job.instance_names,
        job.instance_name
      );
      const res = await fetch('/api/crm/activations/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': userId,
        },
        body: JSON.stringify({
          messageId: job.message_id,
          groupIds: failedIds,
          instanceNames,
          ...(failedIds.length > 10 ? { forceMassSend: true } : {}),
        }),
      });
      const data = await safeResponseJson(res);
      if (res.ok && data.success) {
        showToast(
          data.message ||
            (res.status === 202
              ? 'Nova campanha criada para reenviar aos grupos com falha.'
              : 'Reenvio concluído.'),
          'success'
        );
        onRetryQueued();
        onClose();
        return;
      }
      showToast(data.error || 'Erro ao criar reenvio.', 'error');
    } catch {
      showToast('Erro de rede ao solicitar reenvio.', 'error');
    } finally {
      setRetrying(false);
    }
  };

  const filterTabs: { key: FilterTab; label: string; count: number; color: string }[] = [
    { key: 'all', label: 'Todos', count: total, color: 'text-gray-700 dark:text-gray-200' },
    { key: 'success', label: 'Enviados', count: counts.success, color: 'text-green-700 dark:text-green-300' },
    { key: 'failed', label: 'Falhas', count: counts.failed, color: 'text-red-700 dark:text-red-300' },
    { key: 'pending', label: 'Pendentes', count: counts.pending, color: 'text-amber-700 dark:text-amber-300' },
  ];

  const statusIcon = (s: GroupEntry['status']) => {
    switch (s) {
      case 'success':
        return <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />;
      case 'failed':
        return <XCircle className="w-4 h-4 text-red-500 shrink-0" />;
      case 'pending':
        return <Clock className="w-4 h-4 text-amber-400 shrink-0" />;
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-2 sm:p-4 bg-black/50" role="dialog" aria-modal="true">
      <div className="bg-white dark:bg-[#2a2a2a] rounded-xl shadow-xl border border-gray-200 dark:border-[#404040] w-full max-w-3xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 p-3 sm:p-4 border-b border-gray-200 dark:border-[#404040]">
          <div className="flex items-center gap-2 min-w-0">
            <Users className="w-5 h-5 text-[#8CD955] shrink-0" />
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white truncate">Grupos da campanha</h2>
              {job && (
                <p className="text-xs text-gray-500 dark:text-gray-400 truncate" title={normalizeActivationMassSendInstanceNames(job.instance_names, job.instance_name).join(', ')}>
                  {job.message_title || job.message_id?.slice(0, 8)} ·{' '}
                  {normalizeActivationMassSendInstanceNames(job.instance_names, job.instance_name).join(', ')}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-[#404040] transition-colors"
            aria-label="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3">
          {loading && (
            <div className="flex flex-col items-center justify-center py-16 text-gray-500 dark:text-gray-400">
              <Loader2 className="w-8 h-8 animate-spin mb-2 text-[#8CD955]" />
              <p className="text-sm">Carregando resultados por grupo…</p>
            </div>
          )}

          {!loading && job && (
            <>
              {/* Status banner */}
              {job.status === 'paused' && (
                <p className="text-sm text-violet-800 dark:text-violet-200 bg-violet-50 dark:bg-violet-900/30 border border-violet-200 dark:border-violet-800 rounded-lg px-3 py-2">
                  Campanha pausada. Retome na lista de campanhas (botão play) para continuar o envio.
                </p>
              )}
              {(job.status === 'processing' || job.status === 'pending') && (
                <p className="text-sm text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
                  Campanha em andamento. A lista atualiza conforme os grupos são processados.
                </p>
              )}

              <div className="rounded-lg border border-gray-200 dark:border-[#404040] bg-gray-50 dark:bg-[#333]/50 px-3 py-2">
                <MassSendJobCountdownCell job={job} />
              </div>

              {/* Progress bar */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-400">
                  <span>Progresso: {counts.success + counts.failed} de {total} grupos</span>
                  <span>{total > 0 ? Math.round(((counts.success + counts.failed) / total) * 100) : 0}%</span>
                </div>
                <div className="w-full h-2.5 bg-gray-200 dark:bg-[#404040] rounded-full overflow-hidden flex">
                  {pctSuccess > 0 && (
                    <div
                      className="h-full bg-green-500 transition-all duration-300"
                      style={{ width: `${pctSuccess}%` }}
                    />
                  )}
                  {pctFailed > 0 && (
                    <div
                      className="h-full bg-red-500 transition-all duration-300"
                      style={{ width: `${pctFailed}%` }}
                    />
                  )}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  <span className="flex items-center gap-1 text-green-700 dark:text-green-300">
                    <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
                    {counts.success} enviado{counts.success !== 1 ? 's' : ''}
                  </span>
                  <span className="flex items-center gap-1 text-red-700 dark:text-red-300">
                    <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />
                    {counts.failed} falha{counts.failed !== 1 ? 's' : ''}
                  </span>
                  <span className="flex items-center gap-1 text-amber-700 dark:text-amber-300">
                    <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />
                    {counts.pending} pendente{counts.pending !== 1 ? 's' : ''}
                  </span>
                </div>
              </div>

              {/* Filter tabs */}
              <div className="flex gap-1 overflow-x-auto pb-1 -mx-1 px-1">
                {filterTabs.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setFilter(tab.key)}
                    className={`
                      px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors
                      ${
                        filter === tab.key
                          ? 'bg-[#8CD955]/20 text-[#5a9a2a] dark:text-[#8CD955] border border-[#8CD955]/40'
                          : 'bg-gray-100 dark:bg-[#333] text-gray-600 dark:text-gray-400 border border-transparent hover:bg-gray-200 dark:hover:bg-[#3a3a3a]'
                      }
                    `}
                  >
                    {tab.label} ({tab.count})
                  </button>
                ))}
              </div>

              {/* Group list */}
              <div className="rounded-lg border border-gray-200 dark:border-[#404040] overflow-hidden">
                {filtered.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-8">
                    Nenhum grupo nesta categoria.
                  </p>
                ) : (
                  <ul className="divide-y divide-gray-100 dark:divide-[#383838] max-h-[40vh] overflow-y-auto">
                    {filtered.map((g, idx) => (
                      <li
                        key={g.groupId}
                        className="flex items-start gap-2.5 px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-[#333] transition-colors"
                      >
                        <span className="text-[11px] text-gray-400 dark:text-gray-500 w-6 text-right shrink-0 pt-0.5 tabular-nums">
                          {idx + 1}
                        </span>
                        <span className="pt-0.5">{statusIcon(g.status)}</span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-gray-900 dark:text-white break-all leading-snug">
                            {g.groupName || g.groupId}
                          </p>
                          {g.error && (
                            <p className="text-xs text-red-600 dark:text-red-400 mt-0.5 break-all font-mono leading-relaxed">
                              {sanitizeMassSendErrorMessage(g.error) || g.error}
                            </p>
                          )}
                        </div>
                        <span
                          className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0 ${
                            g.status === 'success'
                              ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                              : g.status === 'failed'
                                ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                                : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
                          }`}
                        >
                          {g.status === 'success' ? 'Enviado' : g.status === 'failed' ? 'Falha' : 'Pendente'}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {job.last_error && (
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  Último erro do lote:{' '}
                  <span className="text-red-600 dark:text-red-400">
                    {sanitizeMassSendErrorMessage(job.last_error) || job.last_error}
                  </span>
                </p>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 sm:p-4 border-t border-gray-200 dark:border-[#404040] flex flex-col sm:flex-row gap-2 sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-lg border border-gray-300 dark:border-[#505050] text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-[#404040] text-sm font-medium"
          >
            Fechar
          </button>
          {failedIds.length > 0 && (
            <button
              type="button"
              disabled={retrying || !userId || loading}
              onClick={handleRetryFailures}
              className="px-4 py-2.5 rounded-lg bg-[#8CD955] hover:bg-[#7BC84A] disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium flex items-center justify-center gap-2"
            >
              {retrying ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
              Nova campanha só com falhas ({failedIds.length})
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default MassSendJobDetailModal;
