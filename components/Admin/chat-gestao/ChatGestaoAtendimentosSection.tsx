'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Users, Loader2, RefreshCw, Calendar } from 'lucide-react';
import ZapCard from '@/components/ui/ZapCard';
import {
  zapInput,
  zapStatCard,
  zapStatCardAccent,
  zapTableHead,
  zapTableRow,
  zapTableWrap,
} from '@/lib/zap-card-styles';

interface SupportRow {
  user_id: string;
  name: string;
  email: string | null;
  online: boolean;
  last_seen_at: string | null;
  atendimentos_periodo: number;
  fora_janela: number;
  em_atendimento: number;
  mensagens_periodo: number;
}

interface SupportData {
  byUser: SupportRow[];
  summary: {
    totalSupport: number;
    onlineNow: number;
    atendimentosPeriodo: number;
    foraJanelaPeriodo: number;
    mensagensPeriodo: number;
  };
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

function todayLocalISODate(): string {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 10);
}

export default function ChatGestaoAtendimentosSection({ userId }: { userId: string }) {
  const [support, setSupport] = useState<SupportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState(() => todayLocalISODate());
  const [to, setTo] = useState(() => todayLocalISODate());

  const fetchSupport = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const res = await fetch(`/api/admin/chat-support-activity?${params}`, {
        headers: { 'X-User-Id': userId },
      });
      const json = await res.json();
      if (json.success && json.data) setSupport(json.data);
      else setSupport(null);
    } catch {
      setSupport(null);
    } finally {
      setLoading(false);
    }
  }, [userId, from, to]);

  useEffect(() => {
    fetchSupport();
  }, [fetchSupport]);

  return (
    <ZapCard className="mb-8">
      <section className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#E86A24]/15">
              <Users className="h-5 w-5 text-[#E86A24]" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">Atendimentos realizados</h2>
              <p className="text-sm text-gray-400">
                Métricas da equipe de atendimento no período selecionado.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Calendar className="h-4 w-4 text-gray-500" />
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className={`px-2 py-1.5 text-sm ${zapInput}`}
            />
            <span className="text-gray-500">até</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className={`px-2 py-1.5 text-sm ${zapInput}`}
            />
            <button
              type="button"
              onClick={fetchSupport}
              disabled={loading}
              className="flex items-center gap-2 rounded-lg bg-[#E86A24] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Atualizar
            </button>
          </div>
        </div>

        <p className="text-xs text-gray-400">
          Usuários com cargo <strong className="text-gray-300">Atendente</strong>. &quot;Online&quot; = heartbeat nos últimos 2 minutos.
          &quot;Atendimentos&quot; = conversas distintas em que o atendente enviou mensagem no período.
        </p>

        {loading && !support ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-gray-500" />
          </div>
        ) : support ? (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <div className={zapStatCard}>
                <p className="text-xs text-gray-400">Atendentes</p>
                <p className="text-2xl font-semibold text-white">{support.summary.totalSupport}</p>
              </div>
              <div className={zapStatCard}>
                <p className="text-xs text-gray-400">Online agora</p>
                <p className="text-2xl font-semibold text-green-400">{support.summary.onlineNow}</p>
              </div>
              <div className={`${zapStatCardAccent} col-span-2 sm:col-span-1`}>
                <p className="text-xs font-medium text-[#E86A24]">Atendimentos (período)</p>
                <p className="text-2xl font-bold text-[#E86A24]">{support.summary.atendimentosPeriodo}</p>
              </div>
              <div className={zapStatCard}>
                <p className="text-xs text-gray-400">Mensagens (período)</p>
                <p className="text-2xl font-semibold text-white">{support.summary.mensagensPeriodo}</p>
              </div>
              <div className={zapStatCard}>
                <p className="text-xs text-gray-400">Fora da janela 24h</p>
                <p className="text-2xl font-semibold text-white">{support.summary.foraJanelaPeriodo}</p>
              </div>
            </div>

            {support.byUser.length === 0 ? (
              <p className="py-8 text-center text-sm text-gray-500">
                Nenhum atendente encontrado.
              </p>
            ) : (
              <div className={zapTableWrap}>
                <table className="w-full text-sm">
                  <thead>
                    <tr className={zapTableHead}>
                      <th className="px-4 py-3 font-medium">Atendente</th>
                      <th className="px-4 py-3 font-medium">Situação</th>
                      <th className="px-4 py-3 font-medium">Último acesso</th>
                      <th className="px-4 py-3 text-right font-medium">Em atendimento</th>
                      <th className="px-4 py-3 text-right font-medium">Atendimentos</th>
                      <th className="px-4 py-3 text-right font-medium">Mensagens</th>
                      <th className="px-4 py-3 text-right font-medium">Fora janela</th>
                    </tr>
                  </thead>
                  <tbody>
                    {support.byUser.map((row) => (
                      <tr key={row.user_id} className={zapTableRow}>
                        <td className="px-4 py-3">
                          <div className="font-medium text-white">{row.name}</div>
                          {row.email && <div className="text-xs text-gray-500">{row.email}</div>}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <div
                              className={`h-2 w-2 rounded-full ${
                                row.online ? 'animate-pulse bg-green-500' : 'bg-gray-600'
                              }`}
                            />
                            <span className={row.online ? 'text-xs font-bold text-green-400' : 'text-xs text-gray-500'}>
                              {row.online ? 'Online' : 'Offline'}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-gray-400">{formatDateTime(row.last_seen_at)}</td>
                        <td className="px-4 py-3 text-right text-white">{row.em_atendimento}</td>
                        <td className="px-4 py-3 text-right font-medium text-[#E86A24]">{row.atendimentos_periodo}</td>
                        <td className="px-4 py-3 text-right text-white">{row.mensagens_periodo}</td>
                        <td className="px-4 py-3 text-right text-white">{row.fora_janela}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : (
          <p className="py-8 text-center text-sm text-gray-500">Não foi possível carregar os dados.</p>
        )}
      </section>
    </ZapCard>
  );
}
