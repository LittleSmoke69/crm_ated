'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { BarChart3, Calendar, RefreshCw, Tag } from 'lucide-react';
import { Banner, Button, EmptyState, Skeleton, TableSkeletonRows } from '@/components/ui';
import {
  zapInput,
  zapStatCard,
  zapTableHead,
  zapTableRow,
  zapTableWrap,
} from '@/lib/zap-card-styles';

interface TagCount {
  tag: string;
  count: number;
}

interface TaggedConversation {
  id: string;
  contact: string;
  remote_jid: string;
  tags: string[];
  last_message_at: string | null;
  attendance_status: string;
  attendant_id: string | null;
  attendant_name: string | null;
}

interface ReportData {
  summary: {
    totalConversations: number;
    byTag: TagCount[];
  };
  conversations: TaggedConversation[];
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

function statusLabel(status: string): string {
  const s = status.toLowerCase();
  if (s === 'resolvido') return 'Resolvido';
  if (s === 'pendente') return 'Pendente';
  return status;
}

export default function ChatGestaoTagsReport({
  userId,
  availableTags,
}: {
  userId: string;
  availableTags: string[];
}) {
  const [report, setReport] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [tagFilter, setTagFilter] = useState('');

  const fetchReport = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      if (tagFilter) params.set('tag', tagFilter);
      const res = await fetch(`/api/admin/chat-tags/report?${params}`, {
        headers: { 'X-User-Id': userId },
      });
      const json = await res.json();
      if (json.success && json.data) setReport(json.data);
      else setReport(null);
    } catch {
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [userId, from, to, tagFilter]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  const tagOptions = [
    ...new Set([...availableTags, ...(report?.summary.byTag.map((t) => t.tag) || [])]),
  ].sort((a, b) => a.localeCompare(b, 'pt-BR'));

  return (
    <div className="mt-8 space-y-5 border-t border-[#404040] pt-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#E86A24]/15">
            <BarChart3 className="h-5 w-5 text-[#E86A24]" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-white">
              Relatório de conversas etiquetadas
            </h3>
            <p className="text-xs text-gray-400">
              Conversas do chat que possuem pelo menos uma etiqueta vinculada.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={tagFilter}
            onChange={(e) => setTagFilter(e.target.value)}
            aria-label="Filtrar por etiqueta"
            className={`px-2 py-1.5 text-sm ${zapInput}`}
          >
            <option value="">Todas as etiquetas</option>
            {tagOptions.map((tag) => (
              <option key={tag} value={tag}>
                {tag}
              </option>
            ))}
          </select>
          <Calendar className="w-4 h-4 text-gray-500 shrink-0" aria-hidden="true" />
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            aria-label="Data inicial"
            className={`px-2 py-1.5 text-sm ${zapInput}`}
          />
          <span className="text-sm text-gray-500">até</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            aria-label="Data final"
            className={`px-2 py-1.5 text-sm ${zapInput}`}
          />
          <Button
            size="sm"
            onClick={() => fetchReport()}
            loading={loading}
            icon={<RefreshCw className="w-4 h-4" />}
          >
            Atualizar
          </Button>
        </div>
      </div>

      {loading && !report ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className={zapStatCard}>
                <Skeleton className="mb-2 h-3 w-24" />
                <Skeleton className="h-6 w-12" />
              </div>
            ))}
          </div>
          <div className={zapTableWrap}>
            <table className="w-full min-w-[680px] text-sm">
              <tbody>
                <TableSkeletonRows rows={5} cols={5} />
              </tbody>
            </table>
          </div>
        </>
      ) : report ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className={zapStatCard}>
              <p className="text-xs text-gray-400">Conversas etiquetadas</p>
              <p className="text-xl font-semibold text-white">
                {report.summary.totalConversations}
              </p>
            </div>
            {report.summary.byTag.slice(0, 3).map((item) => (
              <div key={item.tag} className={zapStatCard}>
                <p className="truncate text-xs text-gray-400" title={item.tag}>
                  {item.tag}
                </p>
                <p className="text-xl font-semibold text-[#E86A24]">{item.count}</p>
              </div>
            ))}
          </div>

          {report.summary.byTag.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {report.summary.byTag.map((item) => (
                <button
                  key={item.tag}
                  type="button"
                  onClick={() => setTagFilter(item.tag === tagFilter ? '' : item.tag)}
                  aria-pressed={tagFilter === item.tag}
                  className={`min-h-[32px] rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    tagFilter === item.tag
                      ? 'border-[#E86A24] bg-[#E86A24] text-white'
                      : 'border-[#404040] bg-[#333] text-gray-300 hover:border-[#E86A24]'
                  }`}
                >
                  {item.tag} ({item.count})
                </button>
              ))}
            </div>
          )}

          {report.conversations.length === 0 ? (
            <EmptyState
              compact
              icon={<Tag className="w-5 h-5" />}
              title="Nenhuma conversa com etiqueta encontrada no período"
              description="Ajuste o período ou o filtro de etiqueta, ou marque conversas no chat para vê-las aqui."
            />
          ) : (
            <div className={zapTableWrap}>
              <table className="w-full min-w-[680px] text-sm">
                <thead>
                  <tr className={zapTableHead}>
                    <th className="py-3 px-4 font-medium">Contato</th>
                    <th className="py-3 px-4 font-medium">Etiquetas</th>
                    <th className="py-3 px-4 font-medium">Atendente</th>
                    <th className="py-3 px-4 font-medium">Status</th>
                    <th className="py-3 px-4 font-medium">Última mensagem</th>
                  </tr>
                </thead>
                <tbody>
                  {report.conversations.map((conv) => (
                    <tr key={conv.id} className={zapTableRow}>
                      <td className="px-4 py-3">
                        <span className="font-medium text-white">{conv.contact}</span>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex flex-wrap gap-1">
                          {conv.tags.map((tag) => (
                            <span
                              key={`${conv.id}-${tag}`}
                              className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#E86A24]/15 text-[#E86A24]"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-gray-300">
                        {conv.attendant_name || '—'}
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                            conv.attendance_status === 'resolvido'
                              ? 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300'
                              : 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
                          }`}
                        >
                          {statusLabel(conv.attendance_status)}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-gray-300 whitespace-nowrap">
                        {formatDateTime(conv.last_message_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        <Banner
          variant="error"
          title="Não foi possível carregar o relatório."
          action={
            <Button
              size="sm"
              variant="secondary"
              onClick={() => fetchReport()}
              icon={<RefreshCw className="w-4 h-4" />}
            >
              Tentar novamente
            </Button>
          }
        >
          Verifique sua conexão e tente novamente.
        </Banner>
      )}
    </div>
  );
}
