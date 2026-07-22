'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, Calendar, Inbox, RefreshCw, Send } from 'lucide-react';
import {
  Banner,
  Button,
  EmptyState,
  StatCard,
  StatCardSkeleton,
  TableSkeletonRows,
} from '@/components/ui';

type StatusBreakdown = Record<string, number>;

interface UserAgg {
  user_id: string;
  user_name: string;
  jobs_count: number;
  messages_sent: number;
  contacts_total: number;
  by_status: StatusBreakdown;
}

interface InstanceAgg {
  instance_id: string;
  instance_name: string;
  jobs_count: number;
  messages_sent: number;
}

interface ReportData {
  period: { from: string; to: string } | null;
  summary: {
    totalJobs: number;
    totalMessagesSent: number;
    totalContacts: number;
    usersCount: number;
    instancesCount: number;
    byStatus: StatusBreakdown;
  };
  byUser: UserAgg[];
  byInstance: InstanceAgg[];
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pendente',
  running: 'Em andamento',
  paused: 'Pausado',
  completed: 'Concluído',
  failed: 'Falhou',
  cancelled: 'Cancelado',
};

const STATUS_ORDER = ['running', 'pending', 'paused', 'completed', 'failed', 'cancelled'];

const STATUS_BADGE: Record<string, string> = {
  running: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/30',
  pending: 'bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-500/15 dark:text-gray-300 dark:border-gray-500/30',
  paused: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30',
  completed:
    'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30',
  failed: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-500/15 dark:text-red-300 dark:border-red-500/30',
  cancelled:
    'bg-gray-100 text-gray-500 border-gray-200 dark:bg-gray-500/10 dark:text-gray-400 dark:border-gray-500/20',
};

function formatStatusKey(s: string): string {
  return STATUS_LABEL[s] || s;
}

type Props = { userId: string };

export default function ChatGestaoBroadcastsSection({ userId }: Props) {
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [showAll, setShowAll] = useState(false);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (showAll) {
        params.set('all', '1');
      } else {
        if (from) params.set('from', from);
        if (to) params.set('to', to);
      }
      const res = await fetch(`/api/admin/chat-broadcast-report?${params}`, {
        headers: { 'X-User-Id': userId },
      });
      const json = await res.json();
      if (json.success && json.data) setData(json.data);
      else setData(null);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [userId, from, to, showAll]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  const statusBreakdownEntries = useMemo(() => {
    if (!data) return [] as { key: string; label: string; count: number }[];
    const entries = Object.entries(data.summary.byStatus);
    entries.sort(([a], [b]) => {
      const ai = STATUS_ORDER.indexOf(a);
      const bi = STATUS_ORDER.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
    return entries.map(([key, count]) => ({ key, label: formatStatusKey(key), count }));
  }, [data]);

  const dateInputClasses =
    'px-2 py-1.5 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-[#2a2a2a] text-gray-900 dark:text-gray-100 focus:border-[#E86A24] focus:ring-2 focus:ring-[#E86A24]/30 focus:outline-none disabled:opacity-50';

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <Send className="w-8 h-8 text-[#E86A24]" />
          <div>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Disparo em Massa — Chat</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Total de disparos (jobs e mensagens enviadas) por usuário e por instância Evolution. Inclui todos os status.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 min-h-[36px] text-sm text-gray-600 dark:text-gray-300 select-none cursor-pointer">
            <input
              type="checkbox"
              checked={showAll}
              onChange={(e) => setShowAll(e.target.checked)}
              className="rounded border-gray-300 dark:border-gray-600 accent-[#E86A24]"
            />
            Tudo (sem filtro)
          </label>
          <Calendar className="w-4 h-4 text-gray-500 shrink-0" aria-hidden="true" />
          <input
            type="date"
            value={from}
            disabled={showAll}
            onChange={(e) => setFrom(e.target.value)}
            aria-label="Data inicial"
            className={dateInputClasses}
          />
          <span className="text-gray-500 text-sm">até</span>
          <input
            type="date"
            value={to}
            disabled={showAll}
            onChange={(e) => setTo(e.target.value)}
            aria-label="Data final"
            className={dateInputClasses}
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

      <p className="text-xs text-gray-500 dark:text-gray-400">
        Mensagens enviadas = contatos concluídos × passos da sequência, somando os passos parciais do contato corrente.
        Quando o job usa rotação de instâncias, as mensagens são distribuídas proporcionalmente entre elas.
      </p>

      {loading && !data ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <StatCardSkeleton key={i} />
            ))}
          </div>
          <div className="rounded-2xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-[#2a2a2a] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px] text-sm">
                <tbody>
                  <TableSkeletonRows rows={5} cols={4} />
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : data ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <StatCard label="Disparos (jobs)" value={data.summary.totalJobs} />
            <StatCard label="Mensagens enviadas" value={data.summary.totalMessagesSent} />
            <StatCard label="Contatos" value={data.summary.totalContacts} />
            <StatCard label="Usuários" value={data.summary.usersCount} />
            <StatCard label="Instâncias" value={data.summary.instancesCount} />
          </div>

          {statusBreakdownEntries.length > 0 && (
            <div className="rounded-2xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-[#2a2a2a] p-4">
              <div className="flex items-center gap-2 mb-3">
                <BarChart3 className="w-4 h-4 text-gray-500" />
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Por status</h3>
              </div>
              <div className="flex flex-wrap gap-2">
                {statusBreakdownEntries.map(({ key, label, count }) => (
                  <span
                    key={key}
                    className={`px-2.5 py-1 text-xs rounded-full border ${
                      STATUS_BADGE[key] ||
                      'bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-500/15 dark:text-gray-300 dark:border-gray-500/30'
                    }`}
                  >
                    {label}: <strong>{count}</strong>
                  </span>
                ))}
              </div>
            </div>
          )}

          <SectionTable
            title="Por usuário"
            emptyMessage="Nenhum disparo no período."
            emptyDescription="Ajuste o período do filtro ou marque “Tudo (sem filtro)” para ver o histórico completo."
            headers={['Usuário', 'Disparos', 'Contatos', 'Mensagens enviadas']}
            rows={data.byUser.map((u) => ({
              key: u.user_id,
              cells: [
                <span key="n" className="font-medium text-gray-900 dark:text-gray-100">
                  {u.user_name}
                </span>,
                <span key="j" className="text-right">{u.jobs_count}</span>,
                <span key="c" className="text-right">{u.contacts_total}</span>,
                <span key="m" className="text-right font-medium">{u.messages_sent}</span>,
              ],
              align: ['left', 'right', 'right', 'right'],
            }))}
          />

          <SectionTable
            title="Por instância Evolution"
            emptyMessage="Nenhuma instância usada no período."
            emptyDescription="Ajuste o período do filtro ou marque “Tudo (sem filtro)” para ver o histórico completo."
            headers={['Instância', 'Disparos', 'Mensagens enviadas']}
            rows={data.byInstance.map((i) => ({
              key: i.instance_id,
              cells: [
                <span key="n" className="font-medium text-gray-900 dark:text-gray-100">
                  {i.instance_name}
                </span>,
                <span key="j" className="text-right">{i.jobs_count}</span>,
                <span key="m" className="text-right font-medium">{i.messages_sent}</span>,
              ],
              align: ['left', 'right', 'right'],
            }))}
          />
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

type Row = {
  key: string;
  cells: React.ReactNode[];
  align: ('left' | 'right' | 'center')[];
};

function SectionTable({
  title,
  emptyMessage,
  emptyDescription,
  headers,
  rows,
}: {
  title: string;
  emptyMessage: string;
  emptyDescription?: string;
  headers: string[];
  rows: Row[];
}) {
  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-[#2a2a2a] overflow-hidden">
      <div className="px-4 py-3 bg-gray-50 dark:bg-[#333] border-b border-gray-200 dark:border-gray-600">
        <h3 className="font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
      </div>
      {rows.length === 0 ? (
        <EmptyState
          compact
          icon={<Inbox className="w-5 h-5" />}
          title={emptyMessage}
          description={emptyDescription}
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <thead>
              <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-600">
                {headers.map((h, i) => (
                  <th
                    key={h}
                    className={`py-2 px-3 font-medium ${i > 0 ? 'text-right' : ''}`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-b border-gray-100 dark:border-gray-700">
                  {r.cells.map((c, i) => (
                    <td
                      key={i}
                      className={`py-2 px-3 text-gray-700 dark:text-gray-200 ${
                        r.align[i] === 'right' ? 'text-right' : ''
                      }`}
                    >
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
