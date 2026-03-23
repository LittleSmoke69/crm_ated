'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { BarChart3, Loader2, RefreshCw, Calendar, ChevronDown, ChevronUp, Headphones } from 'lucide-react';

interface InstanceRow {
  assignment_id: string;
  instance_id: string;
  instance_name: string;
  instance_status: string;
  consultor_id: string | null;
  consultor_name: string | null;
  consultores?: { id: string; name: string }[];
  conversations_total: number;
  conversations_resolved: number;
  conversations_open: number;
  messages_in_period: number;
}

interface GerenteBlock {
  gerente_id: string;
  gerente_name: string;
  instances: InstanceRow[];
}

interface BancaBlock {
  banca_id: string;
  banca_name: string;
  gerentes: GerenteBlock[];
}

interface OperationsData {
  period: { from: string; to: string };
  byBanca: BancaBlock[];
  summary: {
    assignments: number;
    instances: number;
    conversationsTotal: number;
    conversationsResolved: number;
    messagesInPeriod: number;
  };
}

interface AttendanceRow {
  user_id: string | null;
  name: string;
  resolved_count: number;
  total_seconds: number;
}

interface AttendanceData {
  byUser: AttendanceRow[];
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

type Props = {
  userId: string;
  /** Exibe bloco extra de resolução WhatsApp Oficial + link admin para vínculos */
  isAdminFull: boolean;
};

export default function ChatGestaoReportSection({ userId, isAdminFull }: Props) {
  const [ops, setOps] = useState<OperationsData | null>(null);
  const [opsLoading, setOpsLoading] = useState(true);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const [attendance, setAttendance] = useState<AttendanceData | null>(null);
  const [attLoading, setAttLoading] = useState(false);
  const [attOpen, setAttOpen] = useState(false);
  const [attFrom, setAttFrom] = useState('');
  const [attTo, setAttTo] = useState('');

  const fetchOps = useCallback(async () => {
    setOpsLoading(true);
    try {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const res = await fetch(`/api/admin/chat-operations-report?${params}`, {
        headers: { 'X-User-Id': userId },
      });
      const json = await res.json();
      if (json.success && json.data) setOps(json.data);
      else setOps(null);
    } catch {
      setOps(null);
    } finally {
      setOpsLoading(false);
    }
  }, [userId, from, to]);

  useEffect(() => {
    fetchOps();
  }, [fetchOps]);

  const fetchAttendance = useCallback(async () => {
    if (!isAdminFull) return;
    setAttLoading(true);
    try {
      const params = new URLSearchParams();
      if (attFrom) params.set('from', attFrom);
      if (attTo) params.set('to', attTo);
      const res = await fetch(`/api/admin/chat-attendance-report?${params}`, {
        headers: { 'X-User-Id': userId },
      });
      const json = await res.json();
      if (json.success && json.data) setAttendance(json.data);
      else setAttendance(null);
    } catch {
      setAttendance(null);
    } finally {
      setAttLoading(false);
    }
  }, [userId, attFrom, attTo, isAdminFull]);

  useEffect(() => {
    if (attOpen && isAdminFull) fetchAttendance();
  }, [attOpen, isAdminFull, fetchAttendance]);

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <BarChart3 className="w-8 h-8 text-[#8CD955]" />
          <div>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Relatório operacional</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Por banca (via gerente), gerente responsável, instância Evolution e consultor vinculado. O consultor enxerga no
              chat apenas as instâncias às quais o gerente o atribuiu.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Calendar className="w-4 h-4 text-gray-500 shrink-0" />
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="px-2 py-1.5 text-sm border border-gray-300 dark:border-[#404040] rounded-lg bg-white dark:bg-[#2a2a2a]"
          />
          <span className="text-gray-500 text-sm">até</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="px-2 py-1.5 text-sm border border-gray-300 dark:border-[#404040] rounded-lg bg-white dark:bg-[#2a2a2a]"
          />
          <button
            type="button"
            onClick={() => fetchOps()}
            disabled={opsLoading}
            className="px-3 py-1.5 text-sm font-medium rounded-lg flex items-center gap-2 bg-[#8CD955] text-white disabled:opacity-60"
          >
            {opsLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Atualizar
          </button>
        </div>
      </div>

      <p className="text-xs text-gray-500 dark:text-gray-400">
        O volume de mensagens usa o período acima (padrão: últimos 30 dias se as datas estiverem vazias). Execute a migração{' '}
        <code className="text-gray-600 dark:text-gray-300">chat_message_counts_by_instance_fn.sql</code> no banco para
        habilitar a contagem agregada; sem ela, a coluna pode aparecer como 0.
      </p>

      {opsLoading && !ops ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-gray-500" />
        </div>
      ) : ops ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div className="p-3 rounded-lg bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-[#404040]">
              <p className="text-xs text-gray-500">Vínculos</p>
              <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">{ops.summary.assignments}</p>
            </div>
            <div className="p-3 rounded-lg bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-[#404040]">
              <p className="text-xs text-gray-500">Instâncias</p>
              <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">{ops.summary.instances}</p>
            </div>
            <div className="p-3 rounded-lg bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-[#404040]">
              <p className="text-xs text-gray-500">Conversas</p>
              <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">{ops.summary.conversationsTotal}</p>
            </div>
            <div className="p-3 rounded-lg bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-[#404040]">
              <p className="text-xs text-gray-500">Resolvidas</p>
              <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">{ops.summary.conversationsResolved}</p>
            </div>
            <div className="p-3 rounded-lg bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-[#404040] col-span-2 sm:col-span-1">
              <p className="text-xs text-gray-500">Mensagens (período)</p>
              <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">{ops.summary.messagesInPeriod}</p>
            </div>
          </div>

          {ops.byBanca.length === 0 ? (
            <p className="text-center text-gray-500 py-8 text-sm">Nenhum vínculo de instância de atendimento encontrado.</p>
          ) : (
            <div className="space-y-8">
              {ops.byBanca.map((banca) => (
                <div
                  key={banca.banca_id}
                  className="rounded-xl border border-gray-200 dark:border-[#404040] overflow-hidden bg-white dark:bg-[#2a2a2a]"
                >
                  <div className="px-4 py-3 bg-gray-50 dark:bg-[#333] border-b border-gray-200 dark:border-[#404040]">
                    <h3 className="font-semibold text-gray-900 dark:text-gray-100">{banca.banca_name}</h3>
                  </div>
                  <div className="divide-y divide-gray-100 dark:divide-[#404040]">
                    {banca.gerentes.map((g) => (
                      <div key={g.gerente_id} className="p-4">
                        <p className="text-sm font-medium text-gray-800 dark:text-gray-200 mb-3">
                          Gerente: {g.gerente_name}
                        </p>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-[#404040]">
                                <th className="pb-2 pr-3 font-medium">Instância</th>
                                <th className="pb-2 pr-3 font-medium">Status</th>
                                <th className="pb-2 pr-3 font-medium">Consultor</th>
                                <th className="pb-2 pr-3 font-medium text-right">Conversas</th>
                                <th className="pb-2 pr-3 font-medium text-right">Abertas</th>
                                <th className="pb-2 pr-3 font-medium text-right">Resolvidas</th>
                                <th className="pb-2 font-medium text-right">Msgs período</th>
                              </tr>
                            </thead>
                            <tbody>
                              {g.instances.map((row) => (
                                <tr key={row.assignment_id} className="border-b border-gray-50 dark:border-[#333]">
                                  <td className="py-2 pr-3 text-gray-900 dark:text-gray-100 font-medium">
                                    {row.instance_name}
                                  </td>
                                  <td className="py-2 pr-3 text-gray-600 dark:text-gray-300">{row.instance_status}</td>
                                  <td className="py-2 pr-3 text-gray-700 dark:text-gray-200">
                                    {row.consultores && row.consultores.length > 0
                                      ? row.consultores.map((c) => c.name).join(', ')
                                      : row.consultor_name || (
                                          <span className="text-amber-600 dark:text-amber-400">Sem consultor</span>
                                        )}
                                  </td>
                                  <td className="py-2 pr-3 text-right">{row.conversations_total}</td>
                                  <td className="py-2 pr-3 text-right">{row.conversations_open}</td>
                                  <td className="py-2 pr-3 text-right">{row.conversations_resolved}</td>
                                  <td className="py-2 text-right font-medium">{row.messages_in_period}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <p className="text-center text-gray-500 py-8">Não foi possível carregar o relatório.</p>
      )}

      <div className="rounded-lg border border-gray-200 dark:border-[#404040] bg-gray-50 dark:bg-[#252525] p-4 text-sm text-gray-600 dark:text-gray-400 space-y-2">
        <p className="font-medium text-gray-800 dark:text-gray-200">Onde configurar instâncias e consultores</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <strong>Gerente:</strong>{' '}
            <Link href="/gerente/atendimento-chat" className="text-[#8CD955] underline">
              Instâncias de atendimento (Evolution)
            </Link>{' '}
            — criar instância e atribuir consultor ao vínculo.
          </li>
          {isAdminFull && (
            <li>
              <strong>Admin / super admin:</strong>{' '}
              <Link href="/admin/chat-atendimento-instancias" className="text-[#8CD955] underline">
                Gerir instâncias em nome dos gerentes
              </Link>{' '}
              (escolha o gerente responsável ao criar).
            </li>
          )}
        </ul>
      </div>

      {isAdminFull && (
        <div className="rounded-xl border border-gray-200 dark:border-[#404040] overflow-hidden">
          <button
            type="button"
            onClick={() => setAttOpen((o) => !o)}
            className="w-full flex items-center justify-between px-4 py-3 bg-white dark:bg-[#2a2a2a] hover:bg-gray-50 dark:hover:bg-[#333] text-left"
          >
            <span className="flex items-center gap-2 font-medium text-gray-900 dark:text-gray-100">
              <Headphones className="w-5 h-5 text-[#8CD955]" />
              Resolução por atendente (WhatsApp Oficial)
            </span>
            {attOpen ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
          </button>
          {attOpen && (
            <div className="p-4 border-t border-gray-200 dark:border-[#404040] space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="date"
                  value={attFrom}
                  onChange={(e) => setAttFrom(e.target.value)}
                  className="px-2 py-1.5 text-sm border border-gray-300 dark:border-[#404040] rounded-lg bg-white dark:bg-[#2a2a2a]"
                />
                <span className="text-gray-500">até</span>
                <input
                  type="date"
                  value={attTo}
                  onChange={(e) => setAttTo(e.target.value)}
                  className="px-2 py-1.5 text-sm border border-gray-300 dark:border-[#404040] rounded-lg bg-white dark:bg-[#2a2a2a]"
                />
                <button
                  type="button"
                  onClick={() => fetchAttendance()}
                  disabled={attLoading}
                  className="px-3 py-1.5 text-sm rounded-lg bg-[#8CD955] text-white disabled:opacity-60"
                >
                  {attLoading ? '...' : 'Carregar'}
                </button>
              </div>
              {attLoading ? (
                <Loader2 className="w-6 h-6 animate-spin text-gray-500" />
              ) : attendance ? (
                <div className="overflow-x-auto">
                  <p className="text-xs text-gray-500 mb-2">
                    Baseado em conversas com canal WhatsApp Oficial (não Evolution). Total resolvidas:{' '}
                    {attendance.totalResolved}
                  </p>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 dark:border-[#404040] text-left">
                        <th className="py-2 font-medium">Atendente</th>
                        <th className="py-2 font-medium text-right">Resolvidas</th>
                        <th className="py-2 font-medium text-right">Tempo total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {attendance.byUser.map((row) => (
                        <tr key={row.user_id ?? 'x'} className="border-b border-gray-100 dark:border-[#333]">
                          <td className="py-2">{row.name}</td>
                          <td className="py-2 text-right">{row.resolved_count}</td>
                          <td className="py-2 text-right">{formatDuration(row.total_seconds)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-gray-500">Sem dados.</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
