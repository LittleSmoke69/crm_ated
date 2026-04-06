'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import Layout from '@/components/Layout';
import { useRequireAuth } from '@/utils/useRequireAuth';
import { useToast } from '@/hooks/useToast';
import ToastContainer from '@/components/Toast/ToastContainer';
import { ArrowRightLeft, Loader2, CheckSquare, RefreshCw } from 'lucide-react';

type Banca = { id: string; name?: string | null; url?: string | null };
type LeadRow = Record<string, unknown> & { id?: string | number };

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
      return;
    }
    setLoadingLeads(true);
    try {
      const res = await fetch(
        `/api/gerente/crm/lead-stock/indicateds?banca_id=${encodeURIComponent(bancaId)}&transferred_filter=no&per_page=3000&page=1`,
        { headers: authHeaders(userId) }
      );
      const json = await res.json();
      if (res.ok && json.success && Array.isArray(json.data?.data)) {
        setLeads(json.data.data as LeadRow[]);
      } else {
        setLeads([]);
        showToast(json?.error ?? 'Erro ao carregar leads do estoque', 'error');
      }
    } catch {
      setLeads([]);
      showToast('Erro ao carregar leads', 'error');
    } finally {
      setLoadingLeads(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- showToast estável o suficiente para UX
  }, [userId, bancaId, stockOk]);

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
              Leads enviados pelo admin para o seu estoque CRM. Destino: apenas consultores da sua equipe nesta banca.
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
            <div className="p-3 border-b border-gray-100 dark:border-[#404040] flex justify-between items-center">
              <span className="text-sm font-semibold text-gray-800 dark:text-white">Leads no estoque (não transferidos no CRM)</span>
              <button type="button" onClick={toggleAll} className="text-xs text-[#8CD955] hover:underline">
                {selected.size === leads.length && leads.length > 0 ? 'Desmarcar todos' : 'Marcar todos'}
              </button>
            </div>
            {loadingLeads ? (
              <div className="p-8 flex justify-center">
                <Loader2 className="w-6 h-6 animate-spin text-[#8CD955]" />
              </div>
            ) : leads.length === 0 ? (
              <p className="p-6 text-sm text-gray-500 text-center">Nenhum lead listado. Verifique se há leads no e-mail de estoque no CRM.</p>
            ) : (
              <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-gray-50 dark:bg-[#333] z-10">
                    <tr>
                      <th className="p-2 w-10" />
                      <th className="p-2 text-left">ID</th>
                      <th className="p-2 text-left">Nome</th>
                      <th className="p-2 text-left">Saldo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leads.slice(0, 500).map((l) => {
                      const id = String(l.id ?? '');
                      if (!id) return null;
                      const name = [l.name, l.last_name].filter(Boolean).join(' ') || '—';
                      const bal = l.balance ?? l.saldo;
                      return (
                        <tr key={id} className="border-t border-gray-100 dark:border-[#404040]">
                          <td className="p-2">
                            <input type="checkbox" checked={selected.has(id)} onChange={() => toggle(id)} className="rounded" />
                          </td>
                          <td className="p-2 font-mono text-xs">{id}</td>
                          <td className="p-2">{name}</td>
                          <td className="p-2">{bal != null ? String(bal) : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {leads.length > 500 && (
                  <p className="text-xs text-gray-500 p-2 text-center">Mostrando 500 de {leads.length}. Reduza no CRM ou transfira em lotes.</p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}
