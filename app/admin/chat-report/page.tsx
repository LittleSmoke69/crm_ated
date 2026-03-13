'use client';

import React, { useState, useEffect } from 'react';
import { useRequireAuth } from '@/utils/useRequireAuth';
import Layout from '@/components/Layout';
import { Headphones, Loader2, RefreshCw, Calendar } from 'lucide-react';

interface ReportRow {
  user_id: string | null;
  name: string;
  resolved_count: number;
  total_seconds: number;
}

interface ReportData {
  byUser: ReportRow[];
  totalResolved: number;
  from: string | null;
  to: string | null;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}min ${s}s`;
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${h}h ${min}min`;
}

export default function ChatReportPage() {
  const { userId, userStatus, checking } = useRequireAuth();
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const isAdmin = userStatus === 'admin' || userStatus === 'super_admin';

  const fetchReport = async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const res = await fetch(`/api/admin/chat-attendance-report?${params}`, {
        headers: { 'X-User-Id': userId },
      });
      const json = await res.json();
      if (json.success && json.data) setData(json.data);
      else setData(null);
    } catch (e) {
      console.error(e);
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (userId && isAdmin) fetchReport();
  }, [userId, isAdmin]);

  if (checking || !userId) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[40vh]">
          <Loader2 className="w-8 h-8 animate-spin text-gray-500" />
        </div>
      </Layout>
    );
  }

  if (!isAdmin) {
    return (
      <Layout>
        <div className="p-6 text-center text-gray-600 dark:text-gray-400">
          Acesso negado. Apenas admin e super_admin podem ver o relatório de atendimento do chat.
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="p-6 max-w-4xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Headphones className="w-8 h-8 text-[#8CD955]" />
          <div>
            <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
              Relatório de Atendimento — Chat
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Desempenho do cargo suporte: conversas resolvidas e tempo de atendimento
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4 mb-6">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-gray-500" />
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="px-3 py-2 text-sm border border-gray-300 dark:border-[#404040] rounded-lg bg-white dark:bg-[#2a2a2a] text-gray-900 dark:text-gray-100"
            />
            <span className="text-gray-500">até</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="px-3 py-2 text-sm border border-gray-300 dark:border-[#404040] rounded-lg bg-white dark:bg-[#2a2a2a] text-gray-900 dark:text-gray-100"
            />
          </div>
          <button
            type="button"
            onClick={fetchReport}
            disabled={loading}
            className="px-4 py-2 text-sm font-medium rounded-lg flex items-center gap-2 bg-[#8CD955] text-white hover:opacity-90 disabled:opacity-60"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Atualizar
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-gray-500" />
          </div>
        ) : data ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
              <div className="p-4 rounded-lg bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-[#404040]">
                <p className="text-sm text-gray-500 dark:text-gray-400">Total de conversas resolvidas</p>
                <p className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
                  {data.totalResolved}
                </p>
              </div>
              <div className="p-4 rounded-lg bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-[#404040]">
                <p className="text-sm text-gray-500 dark:text-gray-400">Período</p>
                <p className="text-lg font-medium text-gray-900 dark:text-gray-100">
                  {data.from || data.to
                    ? `${data.from || '—'} a ${data.to || '—'}`
                    : 'Todo o período'}
                </p>
              </div>
            </div>

            <div className="rounded-lg border border-gray-200 dark:border-[#404040] overflow-hidden bg-white dark:bg-[#2a2a2a]">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-[#404040] bg-gray-50 dark:bg-[#333]">
                    <th className="text-left py-3 px-4 font-semibold text-gray-900 dark:text-gray-100">
                      Atendente
                    </th>
                    <th className="text-right py-3 px-4 font-semibold text-gray-900 dark:text-gray-100">
                      Conversas resolvidas
                    </th>
                    <th className="text-right py-3 px-4 font-semibold text-gray-900 dark:text-gray-100">
                      Tempo total de atendimento
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.byUser.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="py-8 text-center text-gray-500 dark:text-gray-400">
                        Nenhum dado no período.
                      </td>
                    </tr>
                  ) : (
                    data.byUser.map((row) => (
                      <tr
                        key={row.user_id ?? 'unassigned'}
                        className="border-b border-gray-100 dark:border-[#404040] hover:bg-gray-50 dark:hover:bg-[#333]"
                      >
                        <td className="py-3 px-4 text-gray-900 dark:text-gray-100">
                          {row.name}
                        </td>
                        <td className="py-3 px-4 text-right font-medium text-gray-900 dark:text-gray-100">
                          {row.resolved_count}
                        </td>
                        <td className="py-3 px-4 text-right text-gray-700 dark:text-gray-300">
                          {formatDuration(row.total_seconds)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <p className="mt-4 text-xs text-gray-500 dark:text-gray-400">
              Tempo de atendimento = soma do intervalo entre atribuição e resolução de cada conversa.
              Use o filtro de datas e clique em Atualizar para refinar o período.
            </p>
          </>
        ) : (
          <div className="py-12 text-center text-gray-500 dark:text-gray-400">
            Não foi possível carregar o relatório.
          </div>
        )}
      </div>
    </Layout>
  );
}
