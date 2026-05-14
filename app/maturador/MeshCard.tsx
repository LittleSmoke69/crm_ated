'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Play, Pause, Square, Loader2, Network, Trash2 } from 'lucide-react';

type EligibleInstance = {
  evolution_instance_id: string;
  instance_name: string;
  phone_number: string | null;
  status: string | null;
  is_virgin?: boolean;
  is_owner?: boolean;
};

type MeshParticipant = {
  job_id: string;
  master_instance_id: string;
  instance_name: string | null;
  phone_number: string | null;
  status: string | null;
  job_status: string;
  started_at: string | null;
  is_controller: boolean;
  progress_done: number;
  progress_total: number;
  group_msg_next_at: string | null;
};

type MeshCampaign = {
  controller_job_id: string;
  campaign_id: string;
  status: 'queued' | 'running' | 'paused' | 'finished' | 'failed' | 'aborted';
  /** Dono do job controller tem perfil super_admin — remoção só para super_admin. */
  created_by_super_admin?: boolean;
  cycle_interval_sec: number | null;
  cycle_count: number | null;
  next_cycle_at: string | null;
  last_sender_master_ids: string[];
  started_at: string | null;
  ended_at: string | null;
  total_sent: number;
  total_scheduled: number;
  participants: MeshParticipant[];
};

type MeshCampaignActive = Omit<MeshCampaign, 'status'> & { status: 'running' | 'paused' };

function isMeshCampaignActive(c: MeshCampaign): c is MeshCampaignActive {
  return c.status === 'running' || c.status === 'paused';
}

function meshCampaignViewerCanDelete(
  c: MeshCampaign,
  viewerProfileStatus: string | null | undefined
): boolean {
  if (!c.created_by_super_admin) return true;
  return viewerProfileStatus === 'super_admin';
}

/** Pausar, encerrar mesh e editar intervalo — só admin / super_admin (alinhado ao PATCH /api/maturation/mesh/[id]). */
function meshViewerCanControlLifecycle(viewerProfileStatus: string | null | undefined): boolean {
  const s = String(viewerProfileStatus ?? '').toLowerCase();
  return s === 'admin' || s === 'super_admin';
}

interface Props {
  /** Lista de instâncias elegíveis (conectadas + telefone). */
  eligibleInstances: EligibleInstance[];
  apiHeaders: HeadersInit;
  /** Cargo do perfil (ex.: can-access); usado para exclusão de malha criada por super_admin e para Pausar/Encerrar/intervalo (só admin/super_admin). */
  viewerProfileStatus?: string | null;
}

const ANIM_MAX_CHIPS = 14;

export default function MeshCard({ eligibleInstances, apiHeaders, viewerProfileStatus }: Props) {
  const [starting, setStarting] = useState(false);
  const [campaigns, setCampaigns] = useState<MeshCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState<number>(Date.now());
  /** Timestamp do último process-now disparado — evita spam enquanto o tick ainda está rodando. */
  const lastTickRef = useRef<number>(0);

  const headersJson = useMemo(
    () => ({ ...apiHeaders, 'Content-Type': 'application/json' }),
    [apiHeaders]
  );

  const canControlMeshLifecycle = useMemo(
    () => meshViewerCanControlLifecycle(viewerProfileStatus),
    [viewerProfileStatus]
  );

  /**
   * Dispara process-now se uma campanha running tem o ciclo vencido e o último tick foi há
   * mais de 20s. Assim o MeshCard age como "cron embutido no frontend" quando não há cron externo.
   */
  const maybeTriggerTick = useCallback(
    (list: MeshCampaign[]) => {
      const t = Date.now();
      if (t - lastTickRef.current < 20_000) return; // cooldown
      const overdueRunning = list.some(
        (c) =>
          c.status === 'running' &&
          c.next_cycle_at != null &&
          new Date(c.next_cycle_at).getTime() <= t
      );
      if (!overdueRunning) return;
      lastTickRef.current = t;
      fetch('/api/maturation/process-now', { method: 'POST', headers: headersJson }).catch(() => {});
    },
    [headersJson]
  );

  const loadCampaigns = useCallback(async () => {
    try {
      const res = await fetch('/api/maturation/mesh', { headers: apiHeaders, cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || 'Falha ao listar campanhas mesh');
        return;
      }
      const list: MeshCampaign[] = Array.isArray(data?.campaigns) ? data.campaigns : [];
      setCampaigns(list);
      setError(null);
      maybeTriggerTick(list);
    } finally {
      setLoading(false);
    }
  }, [apiHeaders, maybeTriggerTick]);

  useEffect(() => {
    loadCampaigns();
  }, [loadCampaigns]);

  // Polling enquanto houver campanha rodando
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    const hasActive = campaigns.some((c) => c.status === 'running' || c.status === 'paused');
    if (pollingRef.current) clearInterval(pollingRef.current);
    if (hasActive) {
      pollingRef.current = setInterval(loadCampaigns, 5000);
    }
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [campaigns, loadCampaigns]);

  // Tick para countdown de próximo ciclo
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  async function handleStart() {
    setError(null);
    if (eligibleInstances.length < 2) {
      setError('A rede precisa de pelo menos 2 instâncias conectadas com telefone.');
      return;
    }
    setStarting(true);
    try {
      const res = await fetch('/api/maturation/mesh', {
        method: 'POST',
        headers: headersJson,
        body: JSON.stringify({
          // lista vazia = backend auto-seleciona toda a rede elegível
          participant_evolution_instance_ids: [],
          // intervalo definido pelo backend (aleatório 5–15 min por ciclo)
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || 'Falha ao iniciar mesh');
        return;
      }
      await loadCampaigns();
    } finally {
      setStarting(false);
    }
  }

  async function handleToggle(c: MeshCampaign) {
    const newStatus = c.status === 'running' ? 'paused' : 'running';
    const res = await fetch(`/api/maturation/mesh/${c.controller_job_id}`, {
      method: 'PATCH',
      headers: headersJson,
      body: JSON.stringify({ status: newStatus }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data?.error || 'Falha ao alterar status');
      return;
    }
    await loadCampaigns();
  }

  async function handleAbort(c: MeshCampaign) {
    if (!confirm('Encerrar esta campanha mesh? Os jobs serão interrompidos.')) return;
    const res = await fetch(`/api/maturation/mesh/${c.controller_job_id}`, {
      method: 'PATCH',
      headers: headersJson,
      body: JSON.stringify({ status: 'aborted' }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data?.error || 'Falha ao encerrar');
      return;
    }
    await loadCampaigns();
  }

  async function handleDelete(c: MeshCampaign) {
    if (!confirm('Remover esta campanha e todo seu histórico? Não dá para desfazer.')) return;
    const res = await fetch(`/api/maturation/mesh/${c.controller_job_id}`, {
      method: 'DELETE',
      headers: apiHeaders,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data?.error || 'Falha ao remover');
      return;
    }
    await loadCampaigns();
  }

  async function handleToggleParticipant(c: MeshCampaign, p: MeshParticipant) {
    const newStatus = p.job_status === 'running' ? 'paused' : 'running';
    const res = await fetch(`/api/maturation/mesh/${c.controller_job_id}/participant`, {
      method: 'PATCH',
      headers: headersJson,
      body: JSON.stringify({ job_id: p.job_id, status: newStatus }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data?.error || 'Falha ao alterar participação');
      return;
    }
    await loadCampaigns();
  }

  const activeCampaigns = campaigns.filter(isMeshCampaignActive);
  const finishedCampaigns = campaigns.filter((c) => c.status !== 'running' && c.status !== 'paused');
  const hasRunning = activeCampaigns.some((c) => c.status === 'running');

  // Chips visuais — quando rodando, usa participants da campanha; caso contrário usa elegíveis
  const animChips = useMemo(() => {
    const source: Array<{ id: string; name: string }> = activeCampaigns.length
      ? activeCampaigns[0].participants.map((p) => ({
          id: p.master_instance_id,
          name: p.instance_name || '?',
        }))
      : eligibleInstances.map((e) => ({
          id: e.evolution_instance_id,
          name: e.instance_name,
        }));
    return source.slice(0, ANIM_MAX_CHIPS);
  }, [activeCampaigns, eligibleInstances]);

  function formatNextCycle(c: MeshCampaign): string {
    if (c.status !== 'running') return '—';
    if (!c.next_cycle_at) return 'agora';
    const ms = new Date(c.next_cycle_at).getTime() - now;
    if (ms <= 0) return 'agora (próximo tick)';
    return `em ${Math.ceil(ms / 1000)}s`;
  }

  function formatGroupMsgCountdown(nextAt: string | null): string {
    if (!nextAt) return '—';
    const ms = new Date(nextAt).getTime() - now;
    if (ms <= 0) return 'agora';
    const totalSec = Math.ceil(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return min > 0 ? `${min}m ${sec}s` : `${sec}s`;
  }

  return (
    <div className="bg-white dark:bg-[#2a2a2a] rounded-xl shadow-sm border border-slate-200 dark:border-[#404040] p-4 md:p-6">
      <div className="flex items-center gap-2 mb-2">
        <Network className="w-5 h-5 text-[#8CD955]" />
        <h2 className="text-base font-semibold text-slate-800 dark:text-white">
          Maturador Mesh (auto-conversa contínua)
        </h2>
      </div>

      <p className="text-xs text-slate-500 dark:text-[#aaa] mb-4">
        Toda a rede entra automaticamente: a cada ciclo, 1–5 instâncias são sorteadas como
        remetentes e enviam mensagens do pool para todas as outras conectadas. Inclui virgens.
      </p>

      {error && (
        <div className="mb-3 rounded-lg border border-red-200 dark:border-red-800/50 bg-red-50/90 dark:bg-red-950/25 px-3 py-2 text-sm text-red-700 dark:text-red-200">
          {error}
        </div>
      )}

      {/* Animação da rede — Pausar/Cancelar só admin e super_admin */}
      <NetworkAnimation
        chips={animChips}
        active={hasRunning}
        cycleControls={
          canControlMeshLifecycle && activeCampaigns.length > 0
            ? {
                status: activeCampaigns[0].status,
                onToggle: () => {
                  void handleToggle(activeCampaigns[0]);
                },
                onAbort: () => {
                  void handleAbort(activeCampaigns[0]);
                },
              }
            : undefined
        }
      />

      {/* Controles abaixo da animação (só aparece quando NÃO tem campanha ativa) */}
      {activeCampaigns.length === 0 && (
        <div className="mt-4 flex items-end gap-3 flex-wrap justify-center">
          <button
            type="button"
            onClick={handleStart}
            disabled={starting || eligibleInstances.length < 2}
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg font-medium bg-[#8CD955] text-white hover:bg-[#7BC84A] disabled:opacity-50 disabled:cursor-not-allowed text-base"
            title={
              eligibleInstances.length < 2
                ? 'Pelo menos 2 instâncias conectadas com telefone são necessárias'
                : ''
            }
          >
            {starting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Play className="w-5 h-5" />}
            {starting ? 'Iniciando...' : 'Iniciar Mesh'}
          </button>
          <p className="text-xs text-slate-500 dark:text-[#888] basis-full text-center mt-1">
            {eligibleInstances.length} instância(s) elegível(is) na rede
          </p>
        </div>
      )}

      {/* Campanhas ativas */}
      {loading ? (
        <div className="py-6 text-center">
          <Loader2 className="w-5 h-5 animate-spin mx-auto text-slate-400" />
        </div>
      ) : (
        <>
          {activeCampaigns.length > 0 && (
            <div className="border-t border-slate-100 dark:border-[#404040] pt-4 mt-4">
              <div className="space-y-3">
                {activeCampaigns.map((c) => (
                  <CampaignRow
                    key={c.controller_job_id}
                    campaign={c}
                    nextCycleLabel={formatNextCycle(c)}
                    formatGroupMsgCountdown={formatGroupMsgCountdown}
                    canControlLifecycle={canControlMeshLifecycle}
                    canDelete={meshCampaignViewerCanDelete(c, viewerProfileStatus)}
                    onToggle={() => handleToggle(c)}
                    onAbort={() => handleAbort(c)}
                    onDelete={() => handleDelete(c)}
                    onToggleParticipant={(p) => handleToggleParticipant(c, p)}
                  />
                ))}
              </div>
            </div>
          )}

          {finishedCampaigns.length > 0 && (
            <details className="mt-4 border-t border-slate-100 dark:border-[#404040] pt-3">
              <summary className="text-xs font-medium text-slate-500 dark:text-[#888] cursor-pointer">
                Campanhas encerradas ({finishedCampaigns.length})
              </summary>
              <div className="mt-2 space-y-2">
                {finishedCampaigns.map((c) => (
                  <div
                    key={c.controller_job_id}
                    className="px-3 py-2 rounded-lg border border-slate-200 dark:border-[#404040] bg-slate-50 dark:bg-[#1f1f1f] text-xs text-slate-600 dark:text-[#aaa] flex items-center justify-between gap-2"
                  >
                    <span>
                      {c.campaign_id?.slice(0, 8)} · {c.participants.length} inst. · {c.cycle_count}{' '}
                      ciclo(s) · {c.total_sent}/{c.total_scheduled} enviadas · {c.status}
                    </span>
                    {meshCampaignViewerCanDelete(c, viewerProfileStatus) ? (
                      <button
                        onClick={() => handleDelete(c)}
                        className="text-red-500 hover:text-red-600"
                        title="Remover"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}

// ─── Animação da rede ────────────────────────────────────────────────────────

function NetworkAnimation({
  chips,
  active,
  cycleControls,
}: {
  chips: Array<{ id: string; name: string }>;
  active: boolean;
  /** Pausar / retomar / encerrar sobre a área visual do ciclo (mesma API que a linha de campanha). */
  cycleControls?: {
    status: 'running' | 'paused';
    onToggle: () => void;
    onAbort: () => void;
  };
}) {
  const VIEW_W = 600;
  const VIEW_H = 360;
  const CENTER_X = VIEW_W / 2;
  const CENTER_Y = VIEW_H / 2;
  const RADIUS = Math.min(VIEW_W, VIEW_H) * 0.38;

  const positions = useMemo(() => {
    if (chips.length === 0) return [] as Array<{ id: string; name: string; x: number; y: number }>;
    if (chips.length === 1)
      return [{ ...chips[0], x: CENTER_X, y: CENTER_Y }];
    return chips.map((chip, idx) => {
      const angle = (idx / chips.length) * 2 * Math.PI - Math.PI / 2;
      return {
        ...chip,
        x: CENTER_X + RADIUS * Math.cos(angle),
        y: CENTER_Y + RADIUS * Math.sin(angle),
      };
    });
  }, [chips]);

  const [messages, setMessages] = useState<
    Array<{ key: number; fromIdx: number; toIdx: number }>
  >([]);
  const keyRef = useRef(0);

  useEffect(() => {
    if (!active || positions.length < 2) {
      setMessages([]);
      return;
    }
    let alive = true;
    const fire = () => {
      if (!alive) return;
      const fromIdx = Math.floor(Math.random() * positions.length);
      let toIdx = Math.floor(Math.random() * positions.length);
      if (toIdx === fromIdx) toIdx = (toIdx + 1) % positions.length;
      const key = ++keyRef.current;
      setMessages((prev) => [...prev, { key, fromIdx, toIdx }]);
      window.setTimeout(() => {
        setMessages((prev) => prev.filter((m) => m.key !== key));
      }, 1600);
    };
    // Lança várias mensagens em paralelo para passar a sensação de rede ativa
    const interval = window.setInterval(() => {
      const burst = 1 + Math.floor(Math.random() * 3);
      for (let i = 0; i < burst; i++) window.setTimeout(fire, i * 80);
    }, 600);
    fire();
    return () => {
      alive = false;
      window.clearInterval(interval);
    };
  }, [active, positions.length]);

  if (positions.length === 0) {
    return (
      <div className="w-full rounded-xl border border-dashed border-slate-300 dark:border-[#404040] bg-slate-50/50 dark:bg-[#1a1a1a] py-12 text-center text-sm text-slate-500 dark:text-[#888]">
        Nenhuma instância conectada com telefone para formar a rede.
      </div>
    );
  }

  return (
    <div className="relative w-full rounded-xl bg-gradient-to-b from-slate-50 to-white dark:from-[#1a1a1a] dark:to-[#161616] border border-slate-200 dark:border-[#333] overflow-hidden">
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="w-full h-72 md:h-80"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <radialGradient id="chipGradActive" cx="50%" cy="40%" r="60%">
            <stop offset="0%" stopColor="#a8e878" />
            <stop offset="100%" stopColor="#8CD955" />
          </radialGradient>
          <radialGradient id="chipGradIdle" cx="50%" cy="40%" r="60%">
            <stop offset="0%" stopColor="#94a3b8" />
            <stop offset="100%" stopColor="#64748b" />
          </radialGradient>
          <filter id="chipShadow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="3" />
            <feOffset dx="0" dy="2" result="offset" />
            <feComponentTransfer>
              <feFuncA type="linear" slope="0.35" />
            </feComponentTransfer>
            <feMerge>
              <feMergeNode />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Linhas da rede (background) */}
        {active &&
          positions.map((from, i) =>
            positions.slice(i + 1).map((to, j) => (
              <line
                key={`l-${i}-${j}`}
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                stroke="#8CD955"
                strokeOpacity={0.08}
                strokeWidth={1}
              />
            ))
          )}

        {/* Caminhos invisíveis para animateMotion */}
        {messages.map((m) => {
          const from = positions[m.fromIdx];
          const to = positions[m.toIdx];
          if (!from || !to) return null;
          return (
            <path
              key={`path-${m.key}`}
              id={`mesh-path-${m.key}`}
              d={`M ${from.x} ${from.y} L ${to.x} ${to.y}`}
              fill="none"
              stroke="none"
            />
          );
        })}

        {/* Mensagens em movimento */}
        {messages.map((m) => {
          const from = positions[m.fromIdx];
          const to = positions[m.toIdx];
          if (!from || !to) return null;
          return (
            <g key={`msg-${m.key}`}>
              <line
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                stroke="#8CD955"
                strokeOpacity={0.25}
                strokeWidth={1.2}
              />
              <circle r={6} fill="#8CD955" opacity={0.95}>
                <animateMotion dur="1.4s" begin="0s" fill="freeze" repeatCount="1">
                  <mpath href={`#mesh-path-${m.key}`} />
                </animateMotion>
                <animate
                  attributeName="opacity"
                  values="0;1;1;0"
                  keyTimes="0;0.1;0.85;1"
                  dur="1.4s"
                  fill="freeze"
                />
              </circle>
            </g>
          );
        })}

        {/* Chips */}
        {positions.map((p) => {
          const initials = p.name
            .split(/\s+/)
            .map((s) => s[0])
            .filter(Boolean)
            .slice(0, 2)
            .join('')
            .toUpperCase() || '?';
          return (
            <g key={p.id} filter="url(#chipShadow)">
              {active && (
                <circle cx={p.x} cy={p.y} r={26} fill="#8CD955" opacity={0.18}>
                  <animate
                    attributeName="r"
                    values="22;30;22"
                    dur="2.6s"
                    repeatCount="indefinite"
                  />
                  <animate
                    attributeName="opacity"
                    values="0.25;0.05;0.25"
                    dur="2.6s"
                    repeatCount="indefinite"
                  />
                </circle>
              )}
              <circle
                cx={p.x}
                cy={p.y}
                r={20}
                fill={active ? 'url(#chipGradActive)' : 'url(#chipGradIdle)'}
                stroke="white"
                strokeWidth={2}
              />
              <text
                x={p.x}
                y={p.y}
                textAnchor="middle"
                dy=".34em"
                fontSize="11"
                fontWeight="600"
                fill="white"
                style={{ pointerEvents: 'none', userSelect: 'none' }}
              >
                {initials}
              </text>
              <text
                x={p.x}
                y={p.y + 36}
                textAnchor="middle"
                fontSize="9"
                fill="#64748b"
                style={{ pointerEvents: 'none', userSelect: 'none' }}
              >
                {p.name.length > 14 ? p.name.slice(0, 12) + '…' : p.name}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="absolute top-2 right-3 text-[10px] uppercase tracking-wider font-semibold">
        {active ? (
          <span className="inline-flex items-center gap-1 text-[#8CD955]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#8CD955] animate-pulse" />
            Maturando
          </span>
        ) : (
          <span className="text-slate-400 dark:text-[#666]">Em espera</span>
        )}
      </div>

      {cycleControls && (
        <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 flex-wrap items-center justify-center gap-2 px-2">
          <button
            type="button"
            onClick={cycleControls.onToggle}
            title={cycleControls.status === 'running' ? 'Pausar ciclos' : 'Retomar ciclos'}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200/90 bg-white/95 px-3 py-2 text-xs font-semibold text-slate-800 shadow-md backdrop-blur-sm hover:bg-slate-50 dark:border-[#404040] dark:bg-[#1f1f1f]/95 dark:text-[#eee] dark:hover:bg-[#2a2a2a]"
          >
            {cycleControls.status === 'running' ? (
              <>
                <Pause className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                Pausar
              </>
            ) : (
              <>
                <Play className="h-4 w-4 shrink-0 text-[#8CD955]" />
                Retomar
              </>
            )}
          </button>
          <button
            type="button"
            onClick={cycleControls.onAbort}
            title="Encerrar campanha mesh"
            className="inline-flex items-center gap-1.5 rounded-lg border border-red-200/90 bg-white/95 px-3 py-2 text-xs font-semibold text-red-700 shadow-md backdrop-blur-sm hover:bg-red-50 dark:border-red-900/50 dark:bg-[#1f1f1f]/95 dark:text-red-400 dark:hover:bg-red-950/40"
          >
            <Square className="h-4 w-4 shrink-0" />
            Cancelar
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Linha de campanha ativa ─────────────────────────────────────────────────

function CampaignRow({
  campaign,
  nextCycleLabel,
  formatGroupMsgCountdown,
  canControlLifecycle,
  canDelete,
  onToggle,
  onAbort,
  onDelete,
  onToggleParticipant,
}: {
  campaign: MeshCampaign;
  nextCycleLabel: string;
  formatGroupMsgCountdown: (nextAt: string | null) => string;
  canControlLifecycle: boolean;
  canDelete: boolean;
  onToggle: () => void;
  onAbort: () => void;
  onDelete: () => void;
  onToggleParticipant: (p: MeshParticipant) => void;
}) {
  const c = campaign;
  const lastSenderNames =
    c.participants
      .filter((p) => c.last_sender_master_ids.includes(p.master_instance_id))
      .map((p) => p.instance_name)
      .filter(Boolean)
      .join(', ') || '—';

  return (
    <div className="rounded-lg border border-slate-200 dark:border-[#404040] bg-white dark:bg-[#1f1f1f] p-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-xs text-slate-500 dark:text-[#888]">
              {c.campaign_id?.slice(0, 8)}
            </span>
            <span
              className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                c.status === 'running'
                  ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'
                  : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
              }`}
            >
              {c.status === 'running' ? 'rodando' : 'pausado'}
            </span>
            <span className="text-xs text-slate-500 dark:text-[#888]">
              {c.participants.length} instância(s)
            </span>
          </div>
          <div className="text-sm text-slate-700 dark:text-[#ddd] mt-1">
            Ciclo <strong>#{c.cycle_count ?? 0}</strong> · próximo {nextCycleLabel} ·{' '}
            <strong>{c.total_sent}</strong>/{c.total_scheduled} enviadas
          </div>
          <div className="text-xs text-slate-500 dark:text-[#888] mt-0.5">
            Último envio: {lastSenderNames}
          </div>
          <div className="text-xs text-slate-500 dark:text-[#888] mt-0.5">
            Intervalo: <strong>aleatório (5–15 min)</strong>
          </div>
        </div>
        {(canControlLifecycle || canDelete) && (
        <div className="flex items-center gap-1.5 shrink-0">
          {canControlLifecycle && (
            <>
              <button
                onClick={onToggle}
                title={c.status === 'running' ? 'Pausar ciclos' : 'Retomar ciclos'}
                className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-[#333] text-slate-600 dark:text-[#bbb]"
              >
                {c.status === 'running' ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              </button>
              <button
                onClick={onAbort}
                title="Encerrar campanha (stop)"
                className="p-2 rounded-lg hover:bg-amber-100 dark:hover:bg-amber-900/30 text-amber-600 dark:text-amber-400"
              >
                <Square className="w-4 h-4" />
              </button>
            </>
          )}
          {canDelete ? (
            <button
              onClick={onDelete}
              title="Remover campanha e histórico"
              className="p-2 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 text-red-500"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          ) : null}
        </div>
        )}
      </div>

      {/* Lista de participantes com start/stop individual */}
      {c.participants.filter((p) => !p.is_controller).length > 0 && (
        <div className="mt-3 border-t border-slate-100 dark:border-[#333] pt-2">
          <div className="flex flex-col gap-1">
            {c.participants
              .filter((p) => !p.is_controller)
              .map((p) => {
                const active = p.job_status === 'running';
                const warmingUp = active && p.started_at
                  ? Date.now() - new Date(p.started_at).getTime() < 15 * 60 * 1000
                  : false;
                return (
                  <div
                    key={p.job_id}
                    className="flex items-center justify-between gap-2 px-2 py-1 rounded-lg hover:bg-slate-50 dark:hover:bg-[#2a2a2a]"
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${
                          active ? 'bg-emerald-400' : 'bg-slate-300 dark:bg-[#555]'
                        }`}
                      />
                      <span className="text-xs text-slate-700 dark:text-[#ccc] truncate">
                        {p.instance_name || p.master_instance_id.slice(0, 8)}
                      </span>
                      {warmingUp && (
                        <span
                          className="text-xs text-amber-500 dark:text-amber-400 shrink-0"
                          title="Recebendo mensagens por 15 min antes de começar a enviar"
                        >
                          só recebe…
                        </span>
                      )}
                    </div>
                    {!p.is_controller && (
                      <span
                        className="text-[10px] font-mono tabular-nums shrink-0 text-slate-400 dark:text-[#666]"
                        title="Próximo envio ao grupo de maturação"
                      >
                        {(() => {
                          const label = formatGroupMsgCountdown(p.group_msg_next_at);
                          if (label === '—') return null;
                          return (
                            <span
                              className={
                                label === 'agora'
                                  ? 'text-[#8CD955]'
                                  : 'text-slate-400 dark:text-[#666]'
                              }
                            >
                              grupo {label}
                            </span>
                          );
                        })()}
                      </span>
                    )}
                    {canControlLifecycle && (
                      <button
                        onClick={() => onToggleParticipant(p)}
                        title={active ? 'Pausar esta instância' : 'Retomar esta instância'}
                        className={`p-1 rounded-md transition-colors shrink-0 ${
                          active
                            ? 'text-slate-500 hover:bg-amber-100 dark:hover:bg-amber-900/30 hover:text-amber-600'
                            : 'text-slate-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 hover:text-emerald-600'
                        }`}
                      >
                        {active ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                      </button>
                    )}
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}
