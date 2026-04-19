'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import Layout from '@/components/Layout';
import { useRequireAuth } from '@/utils/useRequireAuth';
import { useToast } from '@/hooks/useToast';
import ToastContainer from '@/components/Toast/ToastContainer';
import { ArrowRightLeft, Loader2, CheckSquare, RefreshCw } from 'lucide-react';

type Banca = { id: string; name?: string | null; url?: string | null };
type LeadRow = Record<string, unknown> & {
  id?: string | number;
  stock_meta?: { deadline_days: number; received_at: string; transfer_type: string; lead_id: string; transfer_log_id: string };
};
type StockMetaCounts = { all: number; '10': number; '20': number; '30': number; other: number };
type StockMeta = { counts: StockMetaCounts; expected_in_crm: number; matched_in_crm: number; deadline_filter: string };

function authHeaders(userId: string | null) {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (userId) h['X-User-Id'] = userId;
  return h;
}

export default function GerenteLeadStockTransferPage() {
  const { checking, userId } = useRequireAuth();
  const { showToast, toasts, removeToast } = useToast();
  const [bancas, setBancas] = useState<Banca[]>([]);
  const [bancaId, setBancaId] = useState('');
  const [poolEmail, setPoolEmail] = useState<string | null>(null);
  const [stockOk, setStockOk] = useState(false);
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [loadingLeads, setLoadingLeads] = useState(false);
  const [consultores, setConsultores] = useState<{ id: string; email: string; full_name: string | null }[]>([]);
  const [targetEmail, setTargetEmail] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [transferType, setTransferType] = useState<'TF' | 'TF1' | 'TF2' | 'TF3'>('TF');
  const [deadlineDays, setDeadlineDays] = useState(10);
  const [transferring, setTransferring] = useState(false);
  const [deadlineFilter, setDeadlineFilter] = useState<'all' | '10' | '20' | '30' | 'other'>('all');
  const [stockMeta, setStockMeta] = useState<StockMeta | null>(null);

  const loadBancas = useCallback(async () => {
    if (!userId) return;
    const res = await fetch('/api/crm/bancas', { headers: authHeaders(userId) });
    const json = await res.json();
    if (res.ok && json.success && Array.isArray(json.data)) {
      setBancas(json.data);
      if (!bancaId && json.data[0]?.id) setBancaId(json.data[0].id);
    }
  }, [userId, bancaId]);

  const loadContext = useCallback(async () => {
    if (!userId || !bancaId) {
      setPoolEmail(null);
      setStockOk(false);
      return;
    }
    const res = await fetch(`/api/gerente/crm/lead-stock/context?banca_id=${encodeURIComponent(bancaId)}`, {
      headers: authHeaders(userId),
    });
    const json = await res.json();
    if (res.ok && json.success && json.data) {
      setPoolEmail(json.data.pool_consultant_email ?? null);
      setStockOk(!!json.data.stock_configured);
    } else {
      setPoolEmail(null);
      setStockOk(false);
    }
  }, [userId, bancaId]);

  const loadLeads = useCallback(async () => {
    if (!userId || !bancaId || !stockOk) {
      setLeads([]);
      setStockMeta(null);
      return;
    }
    setLoadingLeads(true);
    try {
      const res = await fetch(
        `/api/gerente/crm/lead-stock/indicateds?banca_id=${encodeURIComponent(
          bancaId
        )}&transferred_filter=no&deadline_days=${encodeURIComponent(deadlineFilter)}`,
        { headers: authHeaders(userId) }
      );
      const json = await res.json();
      if (res.ok && json.success && Array.isArray(json.data?.data)) {
        setLeads(json.data.data as LeadRow[]);
        const sm = json.data?.stock_meta;
        if (sm && typeof sm === 'object' && sm.counts) {
          setStockMeta({
            counts: sm.counts as StockMetaCounts,
            expected_in_crm: Number(sm.expected_in_crm) || 0,
            matched_in_crm: Number(sm.matched_in_crm) || 0,
            deadline_filter: String(sm.deadline_filter ?? 'all'),
          });
        } else setStockMeta(null);
      } else {
        setLeads([]);
        setStockMeta(null);
        showToast(json?.error ?? 'Erro ao carregar leads do estoque', 'error');
      }
    } catch {
      setLeads([]);
      setStockMeta(null);
      showToast('Erro ao carregar leads', 'error');
    } finally {
      setLoadingLeads(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- showToast estável o suficiente para UX
  }, [userId, bancaId, stockOk, deadlineFilter]);

  const loadConsultores = useCallback(async () => {
    if (!userId || !bancaId) {
      setConsultores([]);
      return;
    }
    const res = await fetch(`/api/gerente/consultores?banca_id=${encodeURIComponent(bancaId)}`, {
      headers: authHeaders(userId),
    });
    const json = await res.json();
    if (res.ok && json.success && Array.isArray(json.data)) {
      const list = json.data.map((row: { email?: string; full_name?: string | null; id?: string }) => ({
        id: row.id ?? '',
        email: (row.email ?? '').trim(),
        full_name: row.full_name ?? null,
      })).filter((c: { email: string }) => c.email);
      setConsultores(list);
    } else {
      setConsultores([]);
    }
  }, [userId, bancaId]);

  useEffect(() => {
    if (!checking && userId) void loadBancas();
  }, [checking, userId, loadBancas]);

  useEffect(() => {
    void loadContext();
  }, [loadContext]);

  useEffect(() => {
    void loadConsultores();
  }, [loadConsultores]);

  useEffect(() => {
    void loadLeads();
  }, [loadLeads]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const toggleAll = () => {
    if (selected.size === leads.length) setSelected(new Set());
    else setSelected(new Set(leads.map((l) => String(l.id ?? '')).filter(Boolean)));
  };

  const transfer = async () => {
    if (!userId || !bancaId || !targetEmail.trim() || selected.size === 0) {
      showToast('Selecione leads e o consultor destino.', 'error');
      return;
    }
    setTransferring(true);
    try {
      const leadIds = Array.from(selected);
      const lead_snapshots = leadIds.map((idStr) => {
        const lead = leads.find((l) => String(l.id) === idStr);
        const balance = lead?.balance != null ? Number(lead.balance) : (lead?.saldo != null ? Number(lead.saldo) : null);
        return {
          lead_id: idStr,
          name: [lead?.name, lead?.last_name].filter(Boolean).join(' ').trim() || null,
          phone: (lead?.phone as string | null) ?? null,
          balance: Number.isFinite(balance as number) ? (balance as number) : null,
          last_interaction: (lead?.last_interaction ?? lead?.last_deposit_at ?? lead?.created_at ?? null) as string | null,
          total_depositado: lead?.total_depositado != null ? Number(lead.total_depositado) : null,
          total_apostado: lead?.total_apostado != null ? Number(lead.total_apostado) : null,
          total_ganho: lead?.total_ganho != null ? Number(lead.total_ganho) : null,
        };
      });
      const res = await fetch('/api/gerente/crm/redistribute-leads', {
        method: 'POST',
        headers: authHeaders(userId),
        body: JSON.stringify({
          banca_id: bancaId,
          target_consultant_email: targetEmail.trim(),
          leads_ids: leadIds,
          transfer_type: transferType,
          transfer_deadline_days: deadlineDays,
          lead_snapshots,
          filters_snapshot: { gerente_ui: true },
        }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        showToast(json?.message ?? `${json?.data?.count ?? selected.size} lead(s) transferido(s).`, 'success');
        setSelected(new Set());
        await loadLeads();
      } else {
        showToast(json?.error ?? 'Erro na transferência', 'error');
      }
    } catch {
      showToast('Erro na transferência', 'error');
    } finally {
      setTransferring(false);
    }
  };

  if (checking || !userId) {
    return (
      <Layout>
        <div className="flex justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-[#8CD955]" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <ToastContainer toasts={toasts} onClose={removeToast} />
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <ArrowRightLeft className="w-6 h-6 text-[#8CD955]" />
              Transferir do estoque
            </h1>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              Somente leads que o admin enviou ao seu estoque CRM nesta banca (na conta pool do estoque). Repasse para consultores da sua equipe — aparecem no CRM do consultor em Transferidos, como nas transferências do admin.
            </p>
          </div>
          <Link href="/gerente" className="text-sm text-[#8CD955] hover:underline">
            ← Gestão de consultores
          </Link>
        </div>

        <div className="grid gap-4 md:grid-cols-2 mb-6">
          <div className="bg-white dark:bg-[#2a2a2a] rounded-xl border border-gray-200 dark:border-[#404040] p-4">
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1">Banca</label>
            <select
              value={bancaId}
              onChange={(e) => {
                setBancaId(e.target.value);
                setSelected(new Set());
                setTargetEmail('');
                setDeadlineFilter('all');
              }}
              className="w-full border border-gray-300 dark:border-[#555] dark:bg-[#333] dark:text-white rounded-lg px-3 py-2 text-sm"
            >
              <option value="">Selecione</option>
              {bancas.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name || b.url || b.id}
                </option>
              ))}
            </select>
          </div>
          <div className="bg-white dark:bg-[#2a2a2a] rounded-xl border border-gray-200 dark:border-[#404040] p-4">
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1">E-mail do estoque (CRM)</label>
            <p className="text-sm font-mono text-gray-800 dark:text-gray-200 break-all">
              {stockOk && poolEmail ? poolEmail : <span className="text-amber-600">Não configurado — fale com o admin.</span>}
            </p>
            <button
              type="button"
              onClick={() => void loadContext().then(() => loadLeads())}
              className="mt-2 inline-flex items-center gap-1 text-xs text-[#8CD955] hover:underline"
            >
              <RefreshCw className="w-3 h-3" /> Atualizar
            </button>
          </div>
        </div>

        {stockOk && (
          <div className="bg-white dark:bg-[#2a2a2a] rounded-xl border border-gray-200 dark:border-[#404040] p-4 mb-4 flex flex-wrap gap-4 items-end">
            <div className="min-w-[200px] flex-1">
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1">Consultor destino</label>
              <select
                value={targetEmail}
                onChange={(e) => setTargetEmail(e.target.value)}
                className="w-full border border-gray-300 dark:border-[#555] dark:bg-[#333] dark:text-white rounded-lg px-3 py-2 text-sm"
              >
                <option value="">Selecione</option>
                {consultores.map((c) => (
                  <option key={c.id} value={c.email}>
                    {c.full_name || c.email}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1">Tipo</label>
              <select
                value={transferType}
                onChange={(e) => setTransferType(e.target.value as 'TF' | 'TF1' | 'TF2' | 'TF3')}
                className="border border-gray-300 dark:border-[#555] dark:bg-[#333] dark:text-white rounded-lg px-3 py-2 text-sm"
              >
                <option value="TF">TF</option>
                <option value="TF1">TF1</option>
                <option value="TF2">TF2</option>
                <option value="TF3">TF3</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1">Prazo (dias)</label>
              <select
                value={deadlineDays}
                onChange={(e) => setDeadlineDays(Number(e.target.value))}
                className="border border-gray-300 dark:border-[#555] dark:bg-[#333] dark:text-white rounded-lg px-3 py-2 text-sm"
              >
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={30}>30</option>
              </select>
            </div>
            <button
              type="button"
              onClick={() => void transfer()}
              disabled={transferring || selected.size === 0 || !targetEmail}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#8CD955] text-white font-medium hover:bg-[#7BC84A] disabled:opacity-50"
            >
              {transferring ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckSquare className="w-4 h-4" />}
              Transferir ({selected.size})
            </button>
          </div>
        )}

        {stockOk && (
          <div className="bg-white dark:bg-[#2a2a2a] rounded-xl border border-gray-200 dark:border-[#404040] overflow-hidden">
            <div className="p-3 border-b border-gray-100 dark:border-[#404040] flex flex-col gap-3">
              <div className="flex flex-wrap justify-between items-center gap-2">
                <span className="text-sm font-semibold text-gray-800 dark:text-white">
                  Estoque recebido do admin (por prazo do pacote)
                </span>
                <button type="button" onClick={toggleAll} className="text-xs text-[#8CD955] hover:underline shrink-0">
                  {selected.size === leads.length && leads.length > 0 ? 'Desmarcar todos' : 'Marcar todos'}
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    { key: 'all' as const, label: 'Todos' },
                    { key: '10' as const, label: '10 dias' },
                    { key: '20' as const, label: '20 dias' },
                    { key: '30' as const, label: '30 dias' },
                    { key: 'other' as const, label: 'Outros prazos' },
                  ] as const
                ).map(({ key, label }) => {
                  const n = key === 'all' ? stockMeta?.counts?.all ?? null : stockMeta?.counts?.[key] ?? null;
                  const countLabel = n != null ? ` (${n})` : '';
                  const active = deadlineFilter === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setDeadlineFilter(key)}
                      className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                        active
                          ? 'bg-[#8CD955] border-[#8CD955] text-white'
                          : 'border-gray-300 dark:border-[#555] text-gray-700 dark:text-gray-300 hover:border-[#8CD955]'
                      }`}
                    >
                      {label}
                      {countLabel}
                    </button>
                  );
                })}
              </div>
              {stockMeta && stockMeta.matched_in_crm < stockMeta.expected_in_crm && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Alguns leads constam no sistema mas ainda não foram encontrados na listagem do CRM ({stockMeta.matched_in_crm}/
                  {stockMeta.expected_in_crm}). Confira no CRM ou aguarde sincronização.
                </p>
              )}
            </div>
            {loadingLeads ? (
              <div className="p-8 flex justify-center">
                <Loader2 className="w-6 h-6 animate-spin text-[#8CD955]" />
              </div>
            ) : leads.length === 0 ? (
              <p className="p-6 text-sm text-gray-500 text-center">
                Nenhum lead neste filtro. Quando o admin enviar leads ao seu estoque, eles aparecem aqui por prazo (10 / 20 / 30 dias ou
                outros).
              </p>
            ) : (
              <div className="overflow-x-auto max-h-[520px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-gray-50 dark:bg-[#333] z-10">
                    <tr>
                      <th className="p-2 w-10" />
                      <th className="p-2 text-left">ID</th>
                      <th className="p-2 text-left">Nome</th>
                      <th className="p-2 text-left">Saldo</th>
                      <th className="p-2 text-left">Prazo</th>
                      <th className="p-2 text-left">Recebido</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leads.map((l) => {
                      const id = String(l.id ?? '');
                      if (!id) return null;
                      const name = [l.name, l.last_name].filter(Boolean).join(' ') || '—';
                      const bal = l.balance ?? l.saldo;
                      const sm = l.stock_meta;
                      const prazo = sm?.deadline_days != null ? `${sm.deadline_days} dias` : '—';
                      let recebido = '—';
                      if (sm?.received_at) {
                        try {
                          recebido = new Date(sm.received_at).toLocaleString('pt-BR', {
                            dateStyle: 'short',
                            timeStyle: 'short',
                          });
                        } catch {
                          recebido = sm.received_at;
                        }
                      }
                      return (
                        <tr key={id} className="border-t border-gray-100 dark:border-[#404040]">
                          <td className="p-2">
                            <input type="checkbox" checked={selected.has(id)} onChange={() => toggle(id)} className="rounded" />
                          </td>
                          <td className="p-2 font-mono text-xs">{id}</td>
                          <td className="p-2">{name}</td>
                          <td className="p-2">{bal != null ? String(bal) : '—'}</td>
                          <td className="p-2 whitespace-nowrap">{prazo}</td>
                          <td className="p-2 whitespace-nowrap text-xs text-gray-600 dark:text-gray-400">{recebido}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}
