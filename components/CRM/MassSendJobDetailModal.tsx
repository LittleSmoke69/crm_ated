'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { X, Loader2, RotateCcw, Users } from 'lucide-react';
import { sanitizeMassSendErrorMessage } from '@/lib/utils/activation-send-errors';

export type MassSendGroupOutcome = {
  groupId: string;
  success: boolean;
  error?: string;
};

export type MassSendJobDetail = {
  id: string;
  message_id: string;
  message_title: string | null;
  instance_name: string;
  status: string;
  total_groups: number;
  sent_count: number;
  failed_count: number;
  processed_index?: number;
  last_error: string | null;
  /** Preferencial: linhas em activation_mass_send_job_groups (API GET). */
  group_outcomes?: MassSendGroupOutcome[] | null;
  /** Legado / redundante: jsonb na própria campanha. */
  group_results?: MassSendGroupOutcome[] | null;
  group_ids?: string[] | null;
  created_at: string;
};

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

function normalizeOutcomes(raw: unknown): MassSendGroupOutcome[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((o) => {
      const r = o as Record<string, unknown>;
      const groupId = String(r.groupId ?? r.group_id ?? '').trim();
      if (!groupId) return null;
      return {
        groupId,
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

  if (!isOpen) return null;

  const outcomes = normalizeOutcomes(job?.group_outcomes ?? job?.group_results);
  const okList = outcomes.filter((o) => o.success);
  const failList = outcomes.filter((o) => !o.success);
  const failedIds = failList.map((o) => o.groupId);
  const noPerGroupDetail =
    job &&
    outcomes.length === 0 &&
    (job.sent_count > 0 || job.failed_count > 0) &&
    ['completed', 'failed', 'processing', 'pending'].includes(job.status);

  const handleRetryFailures = async () => {
    if (!userId || !job || failedIds.length === 0) return;
    setRetrying(true);
    try {
      const res = await fetch('/api/crm/activations/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': userId,
        },
        body: JSON.stringify({
          messageId: job.message_id,
          groupIds: failedIds,
          instanceName: job.instance_name,
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

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50" role="dialog" aria-modal="true">
      <div className="bg-white dark:bg-[#2a2a2a] rounded-xl shadow-xl border border-gray-200 dark:border-[#404040] w-full max-w-3xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between gap-3 p-4 border-b border-gray-200 dark:border-[#404040]">
          <div className="flex items-center gap-2 min-w-0">
            <Users className="w-5 h-5 text-[#8CD955] shrink-0" />
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white truncate">Grupos da campanha</h2>
              {job && (
                <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                  {job.message_title || job.message_id?.slice(0, 8)} · {job.instance_name}
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

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {loading && (
            <div className="flex flex-col items-center justify-center py-16 text-gray-500 dark:text-gray-400">
              <Loader2 className="w-8 h-8 animate-spin mb-2 text-[#8CD955]" />
              <p className="text-sm">Carregando resultados por grupo…</p>
            </div>
          )}

          {!loading && job && (
            <>
              {job.status === 'paused' && (
                <p className="text-sm text-violet-800 dark:text-violet-200 bg-violet-50 dark:bg-violet-900/30 border border-violet-200 dark:border-violet-800 rounded-lg px-3 py-2">
                  Campanha pausada. Retome na lista de campanhas (botão play) para continuar o envio.
                </p>
              )}

              {job.status !== 'completed' && job.status !== 'paused' && (
                <p className="text-sm text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
                  {job.status === 'processing' || job.status === 'pending'
                    ? 'Campanha em andamento. A lista abaixo reflete apenas os grupos já processados até agora.'
                    : `Status: ${job.status}. Confira os totais e a lista registrada.`}
                </p>
              )}

              {noPerGroupDetail && (
                <p className="text-sm text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-[#333] border border-gray-200 dark:border-[#404040] rounded-lg px-3 py-2">
                  Não há detalhe por grupo para esta campanha (registrado antes da atualização ou dados indisponíveis).
                  Você ainda vê os totais na tabela: {job.sent_count} sucesso(s), {job.failed_count} falha(s).
                </p>
              )}

              {outcomes.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="rounded-lg border border-green-200 dark:border-green-900/50 bg-green-50/80 dark:bg-green-950/20 p-3 min-h-[120px]">
                    <h3 className="text-sm font-semibold text-green-800 dark:text-green-200 mb-2">
                      Enviados com sucesso ({okList.length})
                    </h3>
                    <ul className="text-xs space-y-1.5 max-h-48 overflow-y-auto font-mono text-green-900 dark:text-green-100 break-all">
                      {okList.length === 0 ? (
                        <li className="text-green-700/70 dark:text-green-300/70">Nenhum ainda nesta lista.</li>
                      ) : (
                        okList.map((o) => <li key={o.groupId}>{o.groupId}</li>)
                      )}
                    </ul>
                  </div>
                  <div className="rounded-lg border border-red-200 dark:border-red-900/50 bg-red-50/80 dark:bg-red-950/20 p-3 min-h-[120px]">
                    <h3 className="text-sm font-semibold text-red-800 dark:text-red-200 mb-2">
                      Falhas ({failList.length})
                    </h3>
                    <ul className="text-xs space-y-2 max-h-56 overflow-y-auto">
                      {failList.length === 0 ? (
                        <li className="text-red-700/70 dark:text-red-300/70 font-mono">Nenhuma falha registrada.</li>
                      ) : (
                        failList.map((o) => (
                          <li key={o.groupId} className="font-mono break-all border-b border-red-200/50 dark:border-red-900/30 pb-2 last:border-0">
                            <span className="text-red-900 dark:text-red-100">{o.groupId}</span>
                            {o.error && (
                              <span className="block text-red-700 dark:text-red-300 mt-0.5 whitespace-pre-wrap">
                                {sanitizeMassSendErrorMessage(o.error) || o.error}
                              </span>
                            )}
                          </li>
                        ))
                      )}
                    </ul>
                  </div>
                </div>
              )}

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

        <div className="p-4 border-t border-gray-200 dark:border-[#404040] flex flex-col sm:flex-row gap-2 sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-lg border border-gray-300 dark:border-[#505050] text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-[#404040] text-sm font-medium"
          >
            Fechar
          </button>
          <button
            type="button"
            disabled={retrying || failedIds.length === 0 || !userId || loading}
            onClick={handleRetryFailures}
            className="px-4 py-2.5 rounded-lg bg-[#8CD955] hover:bg-[#7BC84A] disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium flex items-center justify-center gap-2"
          >
            {retrying ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
            Nova campanha só com falhas ({failedIds.length})
          </button>
        </div>
      </div>
    </div>
  );
};

export default MassSendJobDetailModal;
