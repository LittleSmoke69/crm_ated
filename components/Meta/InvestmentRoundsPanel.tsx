'use client';

/**
 * Rodadas de Investimento de ADS (por consultor) — painel do /admin/meta.
 *
 * - Seletor de banca + consultor.
 * - Criação de rodada: janela (data_inicial..data_final) + meta de gasto (2k/4k/flex).
 * - Cada rodada mostra barra de progresso (gasto real Meta Ads ÷ meta) e o LTV do
 *   período (CRM dashboard-metrics): LTV médio, depósitos, lucro e ROAS.
 *
 * Endpoints:
 *   GET/POST   /api/admin/meta/investment-rounds
 *   PUT/DELETE /api/admin/meta/investment-rounds/[id]
 *   GET        /api/admin/meta/dash-metric?round_id=
 *   GET        /api/admin/meta/campaign-consultors?banca_id=  (dropdown de consultores)
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Target,
  Plus,
  Loader2,
  Trash2,
  TrendingUp,
  Wallet,
  Users,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';

interface BancaOption {
  id: string;
  name: string;
  url: string;
}

interface ConsultorOption {
  id: string;
  email: string;
  full_name: string | null;
}

interface RoundRow {
  id: string;
  banca_id: string;
  consultor_id: string;
  consultor_email: string;
  data_inicial: string;
  data_final: string;
  meta_gasto: number;
  label: string | null;
}

interface DashMetric {
  spend_real: number;
  meta_gasto: number;
  progress_pct: number;
  roas: number | null;
  metrics: {
    total_leads: number;
    total_deposited: number;
    total_deposits_count: number;
    ltv_avg: number;
    net_profit: number;
    conversion_rate: number;
  } | null;
  metrics_error: string | null;
}

const PRESET_GOALS = [2000, 4000, 6000, 10000];

function formatBRL(value: number, fractionDigits: 0 | 2 = 0): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(Number(value) || 0);
}

function formatDateBR(ymd: string): string {
  const [y, m, d] = String(ymd).slice(0, 10).split('-');
  if (!y || !m || !d) return ymd;
  return `${d}/${m}/${y}`;
}

function authHeaders(userId: string | null): Record<string, string> {
  return { 'Content-Type': 'application/json', ...(userId ? { 'X-User-Id': userId } : {}) };
}

/** Card de uma rodada: busca dash-metric e mostra a barra de progresso + LTV. */
function RoundCard({
  round,
  consultorName,
  userId,
  apiBase,
  onDelete,
}: {
  round: RoundRow;
  consultorName: string;
  userId: string | null;
  apiBase: string;
  onDelete: (id: string) => void;
}) {
  const [metric, setMetric] = useState<DashMetric | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadMetric = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/dash-metric?round_id=${encodeURIComponent(round.id)}`, {
        headers: authHeaders(userId),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || `Erro ${res.status}`);
      setMetric(json.data as DashMetric);
    } catch (e: any) {
      setError(e?.message || 'Falha ao carregar métricas');
    } finally {
      setLoading(false);
    }
  }, [round.id, userId, apiBase]);

  useEffect(() => {
    loadMetric();
  }, [loadMetric]);

  const handleDelete = async () => {
    if (!window.confirm('Remover esta rodada?')) return;
    setDeleting(true);
    try {
      const res = await fetch(`${apiBase}/investment-rounds/${round.id}`, {
        method: 'DELETE',
        headers: authHeaders(userId),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || `Erro ${res.status}`);
      onDelete(round.id);
    } catch (e: any) {
      setError(e?.message || 'Falha ao remover');
      setDeleting(false);
    }
  };

  const pct = metric?.progress_pct ?? 0;
  const pctClamped = Math.min(100, Math.max(0, pct));
  const over = pct > 100;
  const barColor = over ? 'bg-amber-500' : pct >= 80 ? 'bg-[#E86A24]' : 'bg-emerald-500';

  const m = metric?.metrics;

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#2a2a2a] p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {round.label || consultorName}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {consultorName} · {formatDateBR(round.data_inicial)} → {formatDateBR(round.data_final)}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={loadMetric}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
            title="Atualizar"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 disabled:opacity-50"
            title="Remover"
          >
            {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Barra de progresso de gasto */}
      <div>
        <div className="flex items-center justify-between text-xs mb-1">
          <span className="text-gray-600 dark:text-gray-400">
            Gasto {loading ? '…' : formatBRL(metric?.spend_real ?? 0)} de {formatBRL(round.meta_gasto)}
          </span>
          <span className={`font-semibold tabular-nums ${over ? 'text-amber-600 dark:text-amber-400' : 'text-gray-800 dark:text-gray-200'}`}>
            {loading ? '—' : `${pct.toFixed(1)}%`}
          </span>
        </div>
        <div className="h-2.5 w-full rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
          <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pctClamped}%` }} />
        </div>
      </div>

      {/* Métricas de LTV do período */}
      {error ? (
        <div className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400">
          <AlertCircle className="w-4 h-4 shrink-0" /> {error}
        </div>
      ) : metric?.metrics_error && !m ? (
        <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400">
          <AlertCircle className="w-4 h-4 shrink-0" /> LTV indisponível: {metric.metrics_error}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Stat label="LTV médio" value={loading ? '…' : formatBRL(m?.ltv_avg ?? 0, 2)} icon={<TrendingUp className="w-3.5 h-3.5" />} />
          <Stat label="Depositado" value={loading ? '…' : formatBRL(m?.total_deposited ?? 0)} sub={m ? `${m.total_deposits_count} dep.` : undefined} icon={<Wallet className="w-3.5 h-3.5" />} />
          <Stat label="Lucro líq." value={loading ? '…' : formatBRL(m?.net_profit ?? 0)} icon={<TrendingUp className="w-3.5 h-3.5" />} />
          <Stat label="ROAS" value={loading ? '…' : metric?.roas != null ? `${metric.roas.toFixed(2)}x` : '—'} icon={<Target className="w-3.5 h-3.5" />} />
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub, icon }: { label: string; value: string; sub?: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-gray-50 dark:bg-gray-800/60 px-2.5 py-2">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {icon}
        <span>{label}</span>
      </div>
      <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 tabular-nums">{value}</p>
      {sub ? <p className="text-[10px] text-gray-500 dark:text-gray-400">{sub}</p> : null}
    </div>
  );
}

export default function InvestmentRoundsPanel({
  bancas,
  userId,
  apiBase = '/api/admin/meta',
}: {
  bancas: BancaOption[];
  userId: string | null;
  /** Base dos endpoints: `/api/admin/meta` (admin) ou `/api/gestor-trafego/meta` (gestor). */
  apiBase?: string;
}) {
  const [bancaId, setBancaId] = useState<string>('');
  const [consultors, setConsultors] = useState<ConsultorOption[]>([]);
  const [loadingConsultors, setLoadingConsultors] = useState(false);
  const [rounds, setRounds] = useState<RoundRow[]>([]);
  const [loadingRounds, setLoadingRounds] = useState(false);
  const [filterConsultorId, setFilterConsultorId] = useState<string>('');

  // form
  const [showForm, setShowForm] = useState(false);
  const [formConsultorId, setFormConsultorId] = useState('');
  const [formStart, setFormStart] = useState('');
  const [formEnd, setFormEnd] = useState('');
  const [formGoal, setFormGoal] = useState<number | ''>(2000);
  const [formLabel, setFormLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!bancaId && bancas.length > 0) setBancaId(bancas[0].id);
  }, [bancas, bancaId]);

  const loadConsultors = useCallback(async () => {
    if (!bancaId) return;
    setLoadingConsultors(true);
    try {
      const res = await fetch(`${apiBase}/campaign-consultors?banca_id=${encodeURIComponent(bancaId)}`, {
        headers: authHeaders(userId),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setConsultors((json.data?.consultors ?? []) as ConsultorOption[]);
      } else {
        setConsultors([]);
      }
    } catch {
      setConsultors([]);
    } finally {
      setLoadingConsultors(false);
    }
  }, [bancaId, userId, apiBase]);

  const loadRounds = useCallback(async () => {
    if (!bancaId) return;
    setLoadingRounds(true);
    try {
      const params = new URLSearchParams({ banca_id: bancaId });
      if (filterConsultorId) params.set('consultor_id', filterConsultorId);
      const res = await fetch(`${apiBase}/investment-rounds?${params.toString()}`, {
        headers: authHeaders(userId),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setRounds((json.data?.rounds ?? []) as RoundRow[]);
      } else {
        setRounds([]);
      }
    } catch {
      setRounds([]);
    } finally {
      setLoadingRounds(false);
    }
  }, [bancaId, filterConsultorId, userId, apiBase]);

  useEffect(() => {
    loadConsultors();
  }, [loadConsultors]);
  useEffect(() => {
    loadRounds();
  }, [loadRounds]);

  const consultorNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of consultors) map.set(c.id, c.full_name || c.email);
    return map;
  }, [consultors]);

  const handleCreate = async () => {
    setFormError(null);
    if (!formConsultorId) return setFormError('Selecione o consultor.');
    if (!formStart || !formEnd) return setFormError('Informe data inicial e final.');
    if (!formGoal || Number(formGoal) <= 0) return setFormError('Informe a meta de gasto.');
    setSaving(true);
    try {
      const res = await fetch(`${apiBase}/investment-rounds`, {
        method: 'POST',
        headers: authHeaders(userId),
        body: JSON.stringify({
          banca_id: bancaId,
          consultor_id: formConsultorId,
          data_inicial: formStart,
          data_final: formEnd,
          meta_gasto: Number(formGoal),
          label: formLabel.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || `Erro ${res.status}`);
      setShowForm(false);
      setFormLabel('');
      setFormStart('');
      setFormEnd('');
      setFormGoal(2000);
      setFormConsultorId('');
      loadRounds();
    } catch (e: any) {
      setFormError(e?.message || 'Falha ao criar rodada');
    } finally {
      setSaving(false);
    }
  };

  const removeRound = (id: string) => setRounds((prev) => prev.filter((r) => r.id !== id));

  return (
    <div className="bg-white dark:bg-[#2a2a2a] rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-4 sm:p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-emerald-50 dark:bg-emerald-900/30 rounded-xl">
            <Target className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Rodadas de Investimento</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Meta de gasto de ADS por consultor + LTV do período
            </p>
          </div>
        </div>
        <button
          onClick={() => setShowForm((s) => !s)}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-[#E86A24] hover:bg-[#7bc548] text-gray-900 text-sm font-semibold transition-colors"
        >
          <Plus className="w-4 h-4" /> Nova rodada
        </button>
      </div>

      {/* Seletores */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-gray-600 dark:text-gray-400">
          <span>Banca</span>
          <select
            value={bancaId}
            onChange={(e) => {
              setBancaId(e.target.value);
              setFilterConsultorId('');
            }}
            className="min-w-[200px] rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100"
          >
            {bancas.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-gray-600 dark:text-gray-400">
          <span>Filtrar por consultor {loadingConsultors ? '(carregando…)' : ''}</span>
          <select
            value={filterConsultorId}
            onChange={(e) => setFilterConsultorId(e.target.value)}
            className="min-w-[220px] rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100"
          >
            <option value="">Todos os consultores</option>
            {consultors.map((c) => (
              <option key={c.id} value={c.id}>
                {c.full_name || c.email}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Formulário de criação */}
      {showForm && (
        <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/40 bg-emerald-50/40 dark:bg-emerald-900/10 p-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="flex flex-col gap-1 text-xs text-gray-600 dark:text-gray-400">
              <span>Consultor *</span>
              <select
                value={formConsultorId}
                onChange={(e) => setFormConsultorId(e.target.value)}
                className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100"
              >
                <option value="">Selecione…</option>
                {consultors.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.full_name || c.email}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-gray-600 dark:text-gray-400">
              <span>Data inicial *</span>
              <input
                type="date"
                value={formStart}
                onChange={(e) => setFormStart(e.target.value)}
                className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-gray-600 dark:text-gray-400">
              <span>Data final *</span>
              <input
                type="date"
                value={formEnd}
                onChange={(e) => setFormEnd(e.target.value)}
                className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-gray-600 dark:text-gray-400">
              <span>Meta de gasto (R$) *</span>
              <input
                type="number"
                min={1}
                step={100}
                value={formGoal}
                onChange={(e) => setFormGoal(e.target.value === '' ? '' : Number(e.target.value))}
                className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100"
              />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-gray-500 dark:text-gray-400">Presets:</span>
            {PRESET_GOALS.map((g) => (
              <button
                key={g}
                onClick={() => setFormGoal(g)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                  formGoal === g
                    ? 'bg-emerald-600 border-emerald-600 text-white'
                    : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                {formBRLShort(g)}
              </button>
            ))}
            <input
              type="text"
              placeholder="Rótulo (opcional)"
              value={formLabel}
              onChange={(e) => setFormLabel(e.target.value)}
              className="flex-1 min-w-[160px] rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100"
            />
          </div>
          {formError ? (
            <div className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400">
              <AlertCircle className="w-4 h-4 shrink-0" /> {formError}
            </div>
          ) : null}
          <div className="flex items-center gap-2">
            <button
              onClick={handleCreate}
              disabled={saving}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Salvar rodada
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="px-3 py-2 rounded-xl text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Lista de rodadas */}
      {loadingRounds ? (
        <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 py-6 justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-[#E86A24]" /> Carregando rodadas…
        </div>
      ) : rounds.length === 0 ? (
        <div className="flex flex-col items-center gap-2 text-sm text-gray-500 dark:text-gray-400 py-8">
          <Users className="w-6 h-6" />
          Nenhuma rodada cadastrada para esta banca.
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {rounds.map((r) => (
            <RoundCard
              key={r.id}
              round={r}
              consultorName={consultorNameById.get(r.consultor_id) || r.consultor_email}
              userId={userId}
              apiBase={apiBase}
              onDelete={removeRound}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function formBRLShort(value: number): string {
  if (value >= 1000) return `${value / 1000}k`;
  return String(value);
}
