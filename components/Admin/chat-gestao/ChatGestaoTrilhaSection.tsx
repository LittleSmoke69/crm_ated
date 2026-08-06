'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { GitBranch, RefreshCw, Calendar, Check } from 'lucide-react';
import ZapCard from '@/components/ui/ZapCard';
import { Button, Banner, EmptyState, Skeleton, TableSkeletonRows } from '@/components/ui';
import {
  zapInput,
  zapStatCard,
  zapStatCardAccent,
  zapTableHead,
  zapTableRow,
  zapTableWrap,
} from '@/lib/zap-card-styles';

type TrailStage = 'novo' | 'gerente' | 'captador' | 'resolvido';

interface TrailStep {
  key: string;
  label: string;
  done: boolean;
  active: boolean;
  actor: string | null;
}

interface TrailRow {
  conversation_id: string;
  title: string;
  phone: string;
  stage: TrailStage;
  stage_label: string;
  passed_first_stage: boolean;
  admin_name: string | null;
  gerente_name: string | null;
  captador_name: string | null;
  assigned_at: string | null;
  last_message_at: string | null;
  steps: TrailStep[];
}

interface TrailData {
  funnel: { novo: number; gerente: number; captador: number; resolvido: number; total: number };
  funnel_labels: Record<string, string>;
  recent: TrailRow[];
  totals: { passed_first_stage: number; with_captador: number };
}

function todayLocalISODate(): string {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 10);
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

function TrailPills({ steps }: { steps: TrailStep[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {steps.map((step, idx) => (
        <React.Fragment key={step.key}>
          {idx > 0 && <span className="text-gray-600 text-xs">→</span>}
          <span
            className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium border ${
              step.active
                ? 'border-[#E86A24]/50 bg-[#E86A24]/15 text-[#E86A24]'
                : step.done
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                  : 'border-white/10 bg-white/5 text-gray-500'
            }`}
            title={step.actor || undefined}
          >
            {step.done && !step.active ? <Check className="h-3 w-3" /> : null}
            {step.label}
            {step.actor ? <span className="opacity-80">· {step.actor.split(' ')[0]}</span> : null}
          </span>
        </React.Fragment>
      ))}
    </div>
  );
}

export default function ChatGestaoTrilhaSection({ userId }: { userId: string }) {
  const [data, setData] = useState<TrailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState(() => todayLocalISODate());
  const [to, setTo] = useState(() => todayLocalISODate());

  const fetchTrail = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '50' });
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const res = await fetch(`/api/admin/chat-customer-trail?${params}`, {
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
  }, [userId, from, to]);

  useEffect(() => {
    fetchTrail();
  }, [fetchTrail]);

  return (
    <ZapCard className="mb-8">
      <section className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#E86A24]/15">
              <GitBranch className="h-5 w-5 text-[#E86A24]" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">Trilha do cliente</h2>
              <p className="text-sm text-gray-400">
                Funil Admin → Gerente → Captador. Se já tem captador, a 1ª etapa foi concluída.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Calendar className="h-4 w-4 text-gray-500" aria-hidden="true" />
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              aria-label="Data inicial"
              className={`px-2 py-1.5 text-sm ${zapInput}`}
            />
            <span className="text-gray-500">até</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              aria-label="Data final"
              className={`px-2 py-1.5 text-sm ${zapInput}`}
            />
            <Button
              size="sm"
              onClick={fetchTrail}
              loading={loading}
              icon={<RefreshCw className="h-4 w-4" />}
            >
              Atualizar
            </Button>
          </div>
        </div>

        {loading && !data ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className={zapStatCard}>
                <Skeleton className="mb-2 h-3 w-24" />
                <Skeleton className="h-7 w-12" />
              </div>
            ))}
          </div>
        ) : data ? (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <div className={zapStatCard}>
                <p className="text-xs text-gray-400">1ª etapa (novo)</p>
                <p className="text-2xl font-semibold text-white">{data.funnel.novo}</p>
              </div>
              <div className={zapStatCard}>
                <p className="text-xs text-gray-400">Com gerente</p>
                <p className="text-2xl font-semibold text-amber-300">{data.funnel.gerente}</p>
              </div>
              <div className={`${zapStatCardAccent} col-span-2 sm:col-span-1`}>
                <p className="text-xs font-medium text-[#E86A24]">Com captador</p>
                <p className="text-2xl font-bold text-[#E86A24]">{data.funnel.captador}</p>
              </div>
              <div className={zapStatCard}>
                <p className="text-xs text-gray-400">Passou 1ª etapa</p>
                <p className="text-2xl font-semibold text-emerald-300">{data.totals.passed_first_stage}</p>
              </div>
              <div className={zapStatCard}>
                <p className="text-xs text-gray-400">Resolvidos</p>
                <p className="text-2xl font-semibold text-white">{data.funnel.resolvido}</p>
              </div>
            </div>

            <p className="text-xs text-gray-400">
              Conversas no período pela última mensagem. Atribuição ao captador = já saiu da fila inicial do admin.
            </p>

            {data.recent.length === 0 ? (
              <EmptyState
                compact
                icon={<GitBranch className="w-5 h-5" />}
                title="Nenhuma conversa no período"
                description="Ajuste as datas ou aguarde novos atendimentos."
              />
            ) : (
              <div className={zapTableWrap}>
                <table className="w-full min-w-[880px] text-sm">
                  <thead>
                    <tr className={zapTableHead}>
                      <th className="px-4 py-3 font-medium">Cliente</th>
                      <th className="px-4 py-3 font-medium">Trilha</th>
                      <th className="px-4 py-3 font-medium">Admin</th>
                      <th className="px-4 py-3 font-medium">Gerente</th>
                      <th className="px-4 py-3 font-medium">Captador</th>
                      <th className="px-4 py-3 font-medium">Atribuído em</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <TableSkeletonRows rows={6} cols={6} />
                    ) : (
                      data.recent.map((row) => (
                        <tr key={row.conversation_id} className={zapTableRow}>
                          <td className="px-4 py-3">
                            <div className="font-medium text-white">{row.title}</div>
                            <div className="text-xs text-gray-500 tabular-nums">{row.phone || '—'}</div>
                          </td>
                          <td className="px-4 py-3">
                            <TrailPills steps={row.steps} />
                          </td>
                          <td className="px-4 py-3 text-gray-300">{row.admin_name || '—'}</td>
                          <td className="px-4 py-3 text-gray-300">{row.gerente_name || '—'}</td>
                          <td className="px-4 py-3 text-gray-300">{row.captador_name || '—'}</td>
                          <td className="px-4 py-3 text-gray-400">{formatDateTime(row.assigned_at)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : (
          <Banner
            variant="error"
            title="Não foi possível carregar a trilha."
            action={
              <Button
                size="sm"
                variant="secondary"
                onClick={fetchTrail}
                icon={<RefreshCw className="h-4 w-4" />}
              >
                Tentar novamente
              </Button>
            }
          >
            Verifique sua conexão e tente novamente.
          </Banner>
        )}
      </section>
    </ZapCard>
  );
}
