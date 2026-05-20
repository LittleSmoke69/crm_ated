'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, Calendar, Loader2, RefreshCw, Send } from 'lucide-react';

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

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <Send className="w-8 h-8 text-[#8CD955]" />
          <div>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Disparo em Massa — Chat</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Total de disparos (jobs e mensagens enviadas) por usuário e por instância Evolution. Inclui todos os status.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-300 select-none">
            <input
              type="checkbox"
              checked={showAll}
              onChange={(e) => setShowAll(e.target.checked)}
              className="rounded border-gray-300 dark:border-[#404040]"
            />
            Tudo (sem filtro)
          </label>
          <Calendar className="w-4 h-4 text-gray-500 shrink-0" />
          <input
            type="date"
            value={from}
            disabled={showAll}
            onChange={(e) => setFrom(e.target.value)}
            className="px-2 py-1.5 text-sm border border-gray-300 dark:border-[#404040] rounded-lg bg-white dark:bg-[#2a2a2a] disabled:opacity-50"
          />
          <span className="text-gray-500 text-sm">até</span>
          <input
            type="date"
            value={to}
            disabled={showAll}
            onChange={(e) => setTo(e.target.value)}
            className="px-2 py-1.5 text-sm border border-gray-300 dark:border-[#404040] rounded-lg bg-white dark:bg-[#2a2a2a] disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => fetchReport()}
            disabled={loading}
            className="px-3 py-1.5 text-sm font-medium rounded-lg flex items-center gap-2 bg-[#8CD955] text-white disabled:opacity-60"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Atualizar
          </button>
        </div>
      </div>

      <p className="text-xs text-gray-500 dark:text-gray-400">
        Mensagens enviadas = contatos concluídos × passos da sequência, somando os passos parciais do contato corrente.
        Quando o job usa rotação de instâncias, as mensagens são distribuídas proporcionalmente entre elas.
      </p>

      {loading && !data ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-gray-500" />
        </div>
      ) : data ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <SummaryCard label="Disparos (jobs)" value={data.summary.totalJobs} />
            <SummaryCard label="Mensagens enviadas" value={data.summary.totalMessagesSent} />
            <SummaryCard label="Contatos" value={data.summary.totalContacts} />
            <SummaryCard label="Usuários" value={data.summary.usersCount} />
            <SummaryCard label="Instâncias" value={data.summary.instancesCount} />
          </div>

          {statusBreakdownEntries.length > 0 && (
            <div className="rounded-xl border border-gray-200 dark:border-[#404040] bg-white dark:bg-[#2a2a2a] p-4">
              <div className="flex items-center gap-2 mb-3">
                <BarChart3 className="w-4 h-4 text-gray-500" />
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Por status</h3>
              </div>
              <div className="flex flex-wrap gap-2">
                {statusBreakdownEntries.map(({ key, label, count }) => (
                  <span
                    key={key}
                    className="px-2.5 py-1 text-xs rounded-full bg-gray-100 dark:bg-[#333] text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-[#404040]"
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
        <p className="text-center text-gray-500 py-8">Não foi possível carregar o relatório.</p>
      )}
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="p-3 rounded-lg bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-[#404040]">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">{value}</p>
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
  headers,
  rows,
}: {
  title: string;
  emptyMessage: string;
  headers: string[];
  rows: Row[];
}) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-[#404040] bg-white dark:bg-[#2a2a2a] overflow-hidden">
      <div className="px-4 py-3 bg-gray-50 dark:bg-[#333] border-b border-gray-200 dark:border-[#404040]">
        <h3 className="font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
      </div>
      {rows.length === 0 ? (
        <p className="text-center text-gray-500 py-6 text-sm">{emptyMessage}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-[#404040]">
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
                <tr key={r.key} className="border-b border-gray-50 dark:border-[#333]">
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
