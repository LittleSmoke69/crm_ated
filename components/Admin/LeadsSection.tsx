'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Copy,
  Download,
  Eye,
  FileUp,
  Loader2,
  MessageCircle,
  Search,
  Trash2,
  Upload,
  UserPlus,
  X,
} from 'lucide-react';
import { Button, EmptyState, TableSkeletonRows } from '@/components/ui';

/** Tela Admin > CRM > Leads: gerenciamento de leads capturados, interligada ao kanban (atribuição via crm_move_lead). */

type CapturedLead = {
  id: string;
  external_id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  capture_status: string;
  source: string | null;
  created_at: string;
  captador_id: string | null;
  captador_name: string | null;
  gerente_id: string | null;
  gerente_name: string | null;
  occurrence: number;
  occurrence_total: number;
};

type PersonOption = { id: string; name: string; enroller?: string | null };

const STATUS_OPTIONS = [
  { value: 'pendente', label: 'Pendente', cls: 'border-amber-500/60 text-amber-500 bg-amber-500/10' },
  { value: 'em_contato', label: 'Em contato', cls: 'border-blue-500/60 text-blue-500 bg-blue-500/10' },
  { value: 'convertido', label: 'Convertido', cls: 'border-emerald-500/60 text-emerald-500 bg-emerald-500/10' },
  { value: 'descartado', label: 'Descartado', cls: 'border-red-500/60 text-red-500 bg-red-500/10' },
];

const statusCls = (v: string) => STATUS_OPTIONS.find((s) => s.value === v)?.cls || STATUS_OPTIONS[0].cls;

const inputClass =
  'w-full px-3 py-2 min-h-[44px] border border-gray-200 dark:border-gray-600 rounded-xl text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-[#333] placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-[#E86A24]/30 focus:border-[#E86A24] transition-colors';

function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    return `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  } catch {
    return '';
  }
}

/** Parser simples de CSV (detecta ; ou , e colunas nome/telefone/email por cabeçalho). */
function parseLeadsCsv(text: string): { name: string; phone: string; email: string }[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  const delim = (lines[0].match(/;/g)?.length || 0) >= (lines[0].match(/,/g)?.length || 0) ? ';' : ',';
  const split = (l: string) => l.split(delim).map((c) => c.trim().replace(/^"|"$/g, ''));

  const header = split(lines[0]).map((h) => h.toLowerCase());
  const findIdx = (...keys: string[]) => header.findIndex((h) => keys.some((k) => h.includes(k)));
  let nameIdx = findIdx('nome', 'name');
  let phoneIdx = findIdx('telefone', 'phone', 'whatsapp', 'celular', 'fone');
  let emailIdx = findIdx('email', 'e-mail');
  let rows = lines.slice(1);

  // Sem cabeçalho reconhecível: assume nome;telefone;email
  if (nameIdx < 0 && phoneIdx < 0 && emailIdx < 0) {
    nameIdx = 0;
    phoneIdx = 1;
    emailIdx = 2;
    rows = lines;
  }

  return rows.map((l) => {
    const cols = split(l);
    return {
      name: nameIdx >= 0 ? cols[nameIdx] || '' : '',
      phone: phoneIdx >= 0 ? cols[phoneIdx] || '' : '',
      email: emailIdx >= 0 ? cols[emailIdx] || '' : '',
    };
  });
}

export default function LeadsSection({ userId }: { userId: string }) {
  const [leads, setLeads] = useState<CapturedLead[]>([]);
  const [gerentes, setGerentes] = useState<PersonOption[]>([]);
  const [captadores, setCaptadores] = useState<PersonOption[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  // Filtros
  const [q, setQ] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [fGerente, setFGerente] = useState('');
  const [fCaptador, setFCaptador] = useState('');
  const [fPeriod, setFPeriod] = useState('todos');
  const [onlyDuplicates, setOnlyDuplicates] = useState(false);

  // Seleção
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Modais
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', phone: '', email: '', gerente_id: '', captador_id: '' });
  const [showImport, setShowImport] = useState(false);
  const [importRows, setImportRows] = useState<{ name: string; phone: string; email: string }[]>([]);
  const [importError, setImportError] = useState<string | null>(null);
  const [importDest, setImportDest] = useState({ gerente_id: '', captador_id: '' });
  const [assignLeads, setAssignLeads] = useState<CapturedLead[] | null>(null);
  const [assignForm, setAssignForm] = useState({ gerente_id: '', captador_id: '' });
  const [viewLead, setViewLead] = useState<CapturedLead | null>(null);
  const [deleteLeads, setDeleteLeads] = useState<CapturedLead[] | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const showToast = (msg: string, type: 'success' | 'error') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4500);
  };

  const headers = useCallback((): Record<string, string> => ({
    'Content-Type': 'application/json',
    'X-User-Id': userId,
  }), [userId]);

  const buildQuery = useCallback((extra: Record<string, string> = {}) => {
    const sp = new URLSearchParams();
    if (q.trim()) sp.set('q', q.trim());
    if (fStatus) sp.set('capture_status', fStatus);
    if (fGerente) sp.set('gerente_id', fGerente);
    if (fCaptador) sp.set('captador_id', fCaptador);
    if (fPeriod !== 'todos') sp.set('period', fPeriod);
    if (onlyDuplicates) sp.set('duplicates', '1');
    Object.entries(extra).forEach(([k, v]) => sp.set(k, v));
    return sp.toString();
  }, [q, fStatus, fGerente, fCaptador, fPeriod, onlyDuplicates]);

  const loadLeads = useCallback(async (targetPage = 1) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/crm/leads?${buildQuery({ page: String(targetPage), page_size: String(pageSize) })}`, { headers: headers() });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || json.error || 'Erro ao carregar leads');
      setLeads(json.data.leads || []);
      setTotal(json.data.total || 0);
      setPage(json.data.page || targetPage);
      setGerentes(json.data.gerentes || []);
      setCaptadores(json.data.captadores || []);
      setSelected(new Set());
    } catch (e: any) {
      showToast(e?.message || 'Erro ao carregar leads', 'error');
    } finally {
      setLoading(false);
    }
  }, [buildQuery, headers]);

  useEffect(() => {
    loadLeads(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onlyDuplicates, fStatus, fGerente, fCaptador, fPeriod]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allPageSelected = leads.length > 0 && leads.every((l) => selected.has(l.id));
  const toggleSelectAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allPageSelected) leads.forEach((l) => next.delete(l.id));
      else leads.forEach((l) => next.add(l.id));
      return next;
    });
  };

  // ----- Mutations -----

  const patchLeads = async (ids: string[], body: Record<string, unknown>, successMsg: string): Promise<boolean> => {
    setBusy(true);
    try {
      const res = await fetch('/api/admin/crm/leads', {
        method: 'PATCH',
        headers: headers(),
        body: JSON.stringify({ ids, ...body }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || json.error || 'Erro ao salvar');
      showToast(successMsg, 'success');
      loadLeads(page);
      return true;
    } catch (e: any) {
      showToast(e?.message || 'Erro ao salvar', 'error');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const changeStatus = (lead: CapturedLead, status: string) => {
    patchLeads([lead.id], { capture_status: status }, 'Status atualizado.');
  };

  const submitCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch('/api/admin/crm/leads', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          name: createForm.name,
          phone: createForm.phone,
          email: createForm.email || undefined,
          gerente_id: createForm.gerente_id || undefined,
          captador_id: createForm.captador_id || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || json.error || 'Erro ao cadastrar');
      showToast('Lead cadastrado com sucesso!', 'success');
      setShowCreate(false);
      setCreateForm({ name: '', phone: '', email: '', gerente_id: '', captador_id: '' });
      loadLeads(1);
    } catch (e: any) {
      showToast(e?.message || 'Erro ao cadastrar', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleImportFile = async (file: File) => {
    setImportError(null);
    try {
      const text = await file.text();
      const rows = parseLeadsCsv(text);
      if (rows.length === 0) {
        setImportError('Arquivo vazio ou formato não reconhecido. Use CSV com colunas nome, telefone, email.');
        setImportRows([]);
        return;
      }
      if (rows.length > 5000) {
        setImportError(`O arquivo tem ${rows.length} linhas — o máximo é 5000 por importação. Divida o arquivo.`);
        setImportRows([]);
        return;
      }
      setImportRows(rows);
    } catch {
      setImportError('Não foi possível ler o arquivo.');
    }
  };

  const submitImport = async () => {
    if (importRows.length === 0) return;
    setBusy(true);
    try {
      const res = await fetch('/api/admin/crm/leads/import', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          leads: importRows,
          gerente_id: importDest.gerente_id || undefined,
          captador_id: importDest.captador_id || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || json.error || 'Erro ao importar');
      showToast(json.message || 'Base importada com sucesso!', 'success');
      setShowImport(false);
      setImportRows([]);
      setImportDest({ gerente_id: '', captador_id: '' });
      loadLeads(1);
    } catch (e: any) {
      showToast(e?.message || 'Erro ao importar', 'error');
    } finally {
      setBusy(false);
    }
  };

  const submitAssign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assignLeads) return;
    if (!assignForm.gerente_id && !assignForm.captador_id) {
      showToast('Selecione um gerente e/ou um captador.', 'error');
      return;
    }
    const body: Record<string, unknown> = {};
    if (assignForm.gerente_id) body.gerente_id = assignForm.gerente_id;
    if (assignForm.captador_id) body.captador_id = assignForm.captador_id;
    const ok = await patchLeads(
      assignLeads.map((l) => l.id),
      body,
      assignForm.captador_id
        ? 'Lead(s) atribuído(s) — já disponíveis no kanban do captador!'
        : 'Gerente atribuído.'
    );
    if (ok) {
      setAssignLeads(null);
      setAssignForm({ gerente_id: '', captador_id: '' });
    }
  };

  const submitDelete = async () => {
    if (!deleteLeads) return;
    setBusy(true);
    try {
      const res = await fetch('/api/admin/crm/leads', {
        method: 'DELETE',
        headers: headers(),
        body: JSON.stringify({ ids: deleteLeads.map((l) => l.id) }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || json.error || 'Erro ao excluir');
      showToast('Lead(s) excluído(s).', 'success');
      setDeleteLeads(null);
      loadLeads(page);
    } catch (e: any) {
      showToast(e?.message || 'Erro ao excluir', 'error');
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/crm/leads?${buildQuery({ all: '1' })}`, { headers: headers() });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || 'Erro ao exportar');
      const all: CapturedLead[] = json.data.leads || [];
      const header = ['ID', 'Nome', 'WhatsApp', 'Email', 'Status', 'Gerente', 'Captador', 'Origem', 'Ocorrência', 'Data/Hora'];
      const lines = all.map((l) =>
        [
          l.external_id,
          l.name || '',
          l.phone || '',
          l.email || '',
          STATUS_OPTIONS.find((s) => s.value === l.capture_status)?.label || l.capture_status,
          l.gerente_name || '',
          l.captador_name || '',
          l.source || '',
          l.occurrence_total > 1 ? `${l.occurrence}ª vez` : '',
          formatDateTime(l.created_at),
        ]
          .map((c) => `"${String(c).replace(/"/g, '""')}"`)
          .join(';')
      );
      const csv = '﻿' + [header.join(';'), ...lines].join('\r\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `leads_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      showToast(e?.message || 'Erro ao exportar', 'error');
    } finally {
      setBusy(false);
    }
  };

  const captadoresForGerente = useMemo(() => {
    if (!assignForm.gerente_id) return captadores;
    const team = captadores.filter((c) => c.enroller === assignForm.gerente_id);
    return team.length > 0 ? team : captadores;
  }, [captadores, assignForm.gerente_id]);

  const selectedLeadObjs = leads.filter((l) => selected.has(l.id));

  const modalShell = (title: string, onClose: () => void, children: React.ReactNode, wide = false) => (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className={`bg-white dark:bg-[#2a2a2a] rounded-2xl shadow-2xl w-full ${wide ? 'max-w-lg' : 'max-w-md'} overflow-hidden border border-gray-200 dark:border-gray-600 max-h-[90vh] flex flex-col`}>
        <div className="p-5 border-b border-gray-200 dark:border-gray-600 flex items-center justify-between flex-shrink-0">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">{title}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors" aria-label="Fechar">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="overflow-y-auto">{children}</div>
      </div>
    </div>
  );

  const gerenteCaptadorFields = (
    value: { gerente_id: string; captador_id: string },
    onChange: (v: { gerente_id: string; captador_id: string }) => void,
    required = false
  ) => (
    <>
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Gerente {required ? '' : '(opcional)'}</label>
        <select value={value.gerente_id} onChange={(e) => onChange({ gerente_id: e.target.value, captador_id: '' })} className={inputClass}>
          <option value="">Selecione...</option>
          {gerentes.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Captador {required ? '' : '(opcional — o lead entra no kanban dele)'}</label>
        <select value={value.captador_id} onChange={(e) => onChange({ ...value, captador_id: e.target.value })} className={inputClass}>
          <option value="">Selecione...</option>
          {(value.gerente_id ? captadores.filter((c) => c.enroller === value.gerente_id) : captadores).map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>
    </>
  );

  return (
    <div className="space-y-6">
      {toast && (
        <div className={`fixed top-4 right-4 z-[60] px-4 py-3 rounded-xl shadow-lg text-sm font-medium text-white ${toast.type === 'success' ? 'bg-emerald-600' : 'bg-red-600'}`}>
          {toast.msg}
        </div>
      )}

      {/* Cabeçalho */}
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Leads</h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">Gerenciamento de leads capturados</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button onClick={() => setShowCreate(true)} icon={<UserPlus className="w-4 h-4" />}>
            Cadastrar
          </Button>
          <Button
            variant="secondary"
            onClick={() => { setShowImport(true); setImportRows([]); setImportError(null); }}
            icon={<Upload className="w-4 h-4" />}
          >
            Importar
          </Button>
          <Button variant="secondary" onClick={exportCsv} disabled={busy} icon={<Download className="w-4 h-4" />}>
            Exportar CSV
          </Button>
        </div>
      </div>

      {/* Filtros */}
      <div className="rounded-2xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-[#2a2a2a] p-4 sm:p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">Buscar</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') loadLeads(1); }}
                placeholder="Email, WhatsApp ou Nome"
                className={`${inputClass} pl-9`}
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">Status</label>
            <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className={inputClass}>
              <option value="">Todos</option>
              {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">Gerente</label>
            <select value={fGerente} onChange={(e) => setFGerente(e.target.value)} className={inputClass}>
              <option value="">Todos</option>
              {gerentes.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">Captador</label>
            <select value={fCaptador} onChange={(e) => setFCaptador(e.target.value)} className={inputClass}>
              <option value="">Todos</option>
              {captadores.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">Período</label>
            <select value={fPeriod} onChange={(e) => setFPeriod(e.target.value)} className={inputClass}>
              <option value="todos">Todos</option>
              <option value="hoje">Hoje</option>
              <option value="7d">Últimos 7 dias</option>
              <option value="30d">Últimos 30 dias</option>
            </select>
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => loadLeads(1)}
            disabled={loading}
            className="flex items-center gap-2 px-6 py-2.5 min-h-[44px] rounded-xl text-sm font-bold text-white bg-[#E86A24] hover:bg-[#D95E1B] transition-colors disabled:opacity-60"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />} Buscar
          </button>
          <button
            onClick={() => setOnlyDuplicates((v) => !v)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold border transition-colors ${
              onlyDuplicates
                ? 'border-amber-500/70 text-amber-600 dark:text-amber-300 bg-amber-500/10'
                : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5'
            }`}
          >
            <Copy className="w-4 h-4" /> Duplicados
          </button>
        </div>
      </div>

      {/* Barra de ações em massa */}
      {selected.size > 0 && (
        <div className="rounded-xl border border-blue-500/40 bg-blue-500/10 px-4 py-3 flex flex-wrap items-center gap-3">
          <span className="text-sm font-bold text-blue-700 dark:text-blue-300">{selected.size} selecionado(s)</span>
          <button
            onClick={() => { setAssignLeads(selectedLeadObjs); setAssignForm({ gerente_id: '', captador_id: '' }); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-emerald-500/60 text-emerald-600 dark:text-emerald-300 hover:bg-emerald-500/10"
          >
            <UserPlus className="w-3.5 h-3.5" /> Atribuir
          </button>
          <button
            onClick={() => setDeleteLeads(selectedLeadObjs)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-red-500/60 text-red-600 dark:text-red-400 hover:bg-red-500/10"
          >
            <Trash2 className="w-3.5 h-3.5" /> Excluir
          </button>
        </div>
      )}

      {/* Tabela */}
      <div className="rounded-2xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-[#2a2a2a] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-600 text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                <th className="px-4 py-3.5 w-10">
                  <input type="checkbox" checked={allPageSelected} onChange={toggleSelectAll} className="w-4 h-4 rounded accent-[#E86A24]" />
                </th>
                <th className="px-4 py-3.5">Status</th>
                <th className="px-4 py-3.5">Nome</th>
                <th className="px-4 py-3.5">WhatsApp</th>
                <th className="px-4 py-3.5">Gerente</th>
                <th className="px-4 py-3.5">Captador</th>
                <th className="px-4 py-3.5">Data / Hora</th>
                <th className="px-4 py-3.5 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {loading ? (
                <TableSkeletonRows rows={6} cols={8} />
              ) : leads.length === 0 ? (
                <tr>
                  <td colSpan={8}>
                    <EmptyState
                      icon={<UserPlus className="w-7 h-7" />}
                      title="Nenhum lead encontrado"
                      description="Use Cadastrar ou Importar para subir sua base."
                      action={
                        <Button size="sm" onClick={() => setShowCreate(true)} icon={<UserPlus className="w-4 h-4" />}>
                          Cadastrar
                        </Button>
                      }
                    />
                  </td>
                </tr>
              ) : (
                leads.map((l) => (
                  <tr key={l.id} className="hover:bg-gray-50 dark:hover:bg-white/[0.03]">
                    <td className="px-4 py-3">
                      <input type="checkbox" checked={selected.has(l.id)} onChange={() => toggleSelect(l.id)} className="w-4 h-4 rounded accent-[#E86A24]" />
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={l.capture_status}
                        onChange={(e) => changeStatus(l, e.target.value)}
                        disabled={busy}
                        className={`px-2.5 py-1.5 rounded-lg text-xs font-bold border bg-transparent cursor-pointer ${statusCls(l.capture_status)}`}
                      >
                        {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value} className="bg-white dark:bg-[#333] text-gray-800 dark:text-white">{s.label}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-gray-900 dark:text-white">{l.name || '—'}</span>
                        <span className="text-[11px] text-gray-400">(#{l.external_id.slice(-6)})</span>
                        {l.occurrence > 1 && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/40">
                            {l.occurrence}ª vez
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-800 dark:text-gray-200">{l.phone || '—'}</td>
                    <td className="px-4 py-3">
                      {l.gerente_name ? (
                        <span className="px-2 py-1 rounded-md text-xs font-semibold border border-emerald-500/50 text-emerald-600 dark:text-emerald-300 bg-emerald-500/10">
                          {l.gerente_name}
                        </span>
                      ) : (
                        <button
                          onClick={() => { setAssignLeads([l]); setAssignForm({ gerente_id: '', captador_id: '' }); }}
                          className="px-3 py-1 rounded-md text-xs font-medium border border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/5"
                        >
                          Atribuir
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {l.captador_name ? (
                        <span className="px-2 py-1 rounded-md text-xs font-semibold border border-violet-500/50 text-violet-600 dark:text-violet-300 bg-violet-500/10">
                          {l.captador_name}
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-300 whitespace-nowrap">{formatDateTime(l.created_at)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        {l.phone && (
                          <a
                            href={`https://wa.me/${l.phone.startsWith('55') ? l.phone : `55${l.phone}`}`}
                            target="_blank"
                            rel="noreferrer"
                            className="p-2 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-emerald-500 hover:bg-emerald-500/10"
                            title="Abrir WhatsApp"
                          >
                            <MessageCircle className="w-4 h-4" />
                          </a>
                        )}
                        <button
                          onClick={() => { setAssignLeads([l]); setAssignForm({ gerente_id: l.gerente_id || '', captador_id: '' }); }}
                          className="p-2 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-blue-500 hover:bg-blue-500/10"
                          title="Atribuir gerente/captador"
                        >
                          <UserPlus className="w-4 h-4" />
                        </button>
                        <button onClick={() => setViewLead(l)} className="p-2 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-sky-500 hover:bg-sky-500/10" title="Ver detalhes">
                          <Eye className="w-4 h-4" />
                        </button>
                        <button onClick={() => setDeleteLeads([l])} className="p-2 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-red-500 hover:bg-red-500/10" title="Excluir">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {/* Paginação */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-gray-600 text-sm">
            <span className="text-gray-500 dark:text-gray-400">{total} lead(s) — página {page} de {totalPages}</span>
            <div className="flex gap-2">
              <button
                onClick={() => loadLeads(page - 1)}
                disabled={page <= 1 || loading}
                className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 disabled:opacity-40 hover:bg-gray-100 dark:hover:bg-white/5"
              >
                Anterior
              </button>
              <button
                onClick={() => loadLeads(page + 1)}
                disabled={page >= totalPages || loading}
                className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 disabled:opacity-40 hover:bg-gray-100 dark:hover:bg-white/5"
              >
                Próxima
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modal: cadastrar */}
      {showCreate && modalShell('Cadastrar lead', () => setShowCreate(false), (
        <form onSubmit={submitCreate} className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Nome</label>
            <input type="text" value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} className={inputClass} placeholder="Nome do lead" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">WhatsApp</label>
            <input type="text" value={createForm.phone} onChange={(e) => setCreateForm({ ...createForm, phone: e.target.value })} className={inputClass} placeholder="DDD + número" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Email (opcional)</label>
            <input type="email" value={createForm.email} onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })} className={inputClass} />
          </div>
          {gerenteCaptadorFields(
            { gerente_id: createForm.gerente_id, captador_id: createForm.captador_id },
            (v) => setCreateForm({ ...createForm, gerente_id: v.gerente_id, captador_id: v.captador_id })
          )}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setShowCreate(false)} className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-white/5">Cancelar</button>
            <button type="submit" disabled={busy} className="px-5 py-2 rounded-lg bg-[#E86A24] text-white font-bold hover:bg-[#D95E1B] disabled:opacity-60 flex items-center gap-2">
              {busy && <Loader2 className="w-4 h-4 animate-spin" />} Cadastrar
            </button>
          </div>
        </form>
      ))}

      {/* Modal: importar base */}
      {showImport && modalShell('Importar base de leads (CSV)', () => setShowImport(false), (
        <div className="p-5 space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            CSV com colunas <code className="bg-gray-100 dark:bg-[#333] px-1 rounded">nome</code>,{' '}
            <code className="bg-gray-100 dark:bg-[#333] px-1 rounded">telefone</code>,{' '}
            <code className="bg-gray-100 dark:bg-[#333] px-1 rounded">email</code> (separador ; ou ,). Máximo 5000 linhas por arquivo.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.txt"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImportFile(f); }}
            className="w-full text-sm text-gray-600 dark:text-gray-400 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-[#E86A24] file:text-white file:font-bold file:cursor-pointer"
          />
          {importError && (
            <div className="rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 p-3 text-sm text-red-700 dark:text-red-300">{importError}</div>
          )}
          {importRows.length > 0 && (
            <>
              <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 p-3 text-sm text-emerald-700 dark:text-emerald-300">
                {importRows.length} lead(s) prontos para importar. Prévia: {importRows.slice(0, 3).map((r) => r.name || r.phone).filter(Boolean).join(', ')}...
              </div>
              <div className="space-y-4 border-t border-gray-200 dark:border-gray-600 pt-4">
                <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Destino (opcional)</p>
                {gerenteCaptadorFields(importDest, setImportDest)}
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Sem destino, os leads entram como <strong>Pendentes</strong> para atribuição posterior. Com captador, já entram no kanban dele.
                </p>
              </div>
            </>
          )}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setShowImport(false)} className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-white/5">Cancelar</button>
            <button
              onClick={submitImport}
              disabled={busy || importRows.length === 0}
              className="px-5 py-2 rounded-lg bg-[#E86A24] text-white font-bold hover:bg-[#D95E1B] disabled:opacity-60 flex items-center gap-2"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileUp className="w-4 h-4" />} Importar {importRows.length > 0 ? `(${importRows.length})` : ''}
            </button>
          </div>
        </div>
      ), true)}

      {/* Modal: atribuir */}
      {assignLeads && modalShell(
        assignLeads.length === 1 ? `Atribuir — ${assignLeads[0].name || assignLeads[0].phone || 'lead'}` : `Atribuir ${assignLeads.length} leads`,
        () => setAssignLeads(null),
        (
          <form onSubmit={submitAssign} className="p-5 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Gerente</label>
              <select value={assignForm.gerente_id} onChange={(e) => setAssignForm({ gerente_id: e.target.value, captador_id: '' })} className={inputClass}>
                <option value="">Selecione...</option>
                {gerentes.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Captador</label>
              <select value={assignForm.captador_id} onChange={(e) => setAssignForm({ ...assignForm, captador_id: e.target.value })} className={inputClass}>
                <option value="">Somente gerente (sem captador)</option>
                {captadoresForGerente.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">Ao escolher um captador, o lead entra na coluna inicial do kanban dele.</p>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setAssignLeads(null)} className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-white/5">Cancelar</button>
              <button type="submit" disabled={busy} className="px-5 py-2 rounded-lg bg-emerald-600 text-white font-bold hover:bg-emerald-500 disabled:opacity-60 flex items-center gap-2">
                {busy && <Loader2 className="w-4 h-4 animate-spin" />} Atribuir
              </button>
            </div>
          </form>
        )
      )}

      {/* Modal: detalhes */}
      {viewLead && modalShell(`Lead #${viewLead.external_id.slice(-6)}`, () => setViewLead(null), (
        <div className="p-5 space-y-3 text-sm">
          {[
            ['Nome', viewLead.name || '—'],
            ['WhatsApp', viewLead.phone || '—'],
            ['Email', viewLead.email || '—'],
            ['Status', STATUS_OPTIONS.find((s) => s.value === viewLead.capture_status)?.label || viewLead.capture_status],
            ['Gerente', viewLead.gerente_name || '—'],
            ['Captador', viewLead.captador_name || '—'],
            ['Origem', viewLead.source || '—'],
            ['Ocorrência', viewLead.occurrence_total > 1 ? `${viewLead.occurrence}ª de ${viewLead.occurrence_total} capturas deste telefone` : 'Única captura'],
            ['Capturado em', formatDateTime(viewLead.created_at)],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 border-b border-gray-100 dark:border-gray-700 pb-2">
              <span className="text-gray-500 dark:text-gray-400 font-medium">{k}</span>
              <span className="text-gray-900 dark:text-white text-right">{v}</span>
            </div>
          ))}
          {viewLead.captador_id && (
            <a
              href="/crm/kanban"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 text-blue-600 dark:text-blue-400 hover:underline font-medium pt-1"
            >
              <Eye className="w-4 h-4" /> Ver no CRM Kanban
            </a>
          )}
        </div>
      ))}

      {/* Modal: excluir */}
      {deleteLeads && modalShell('Excluir lead(s)', () => setDeleteLeads(null), (
        <div className="p-5 space-y-4">
          <p className="text-sm text-gray-700 dark:text-gray-300">
            Tem certeza que deseja excluir <strong>{deleteLeads.length}</strong> lead(s)? Eles também saem do kanban dos captadores. Essa ação não pode ser desfeita.
          </p>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setDeleteLeads(null)} className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-white/5">Cancelar</button>
            <button onClick={submitDelete} disabled={busy} className="px-5 py-2 rounded-lg bg-red-600 text-white font-bold hover:bg-red-500 disabled:opacity-60 flex items-center gap-2">
              {busy && <Loader2 className="w-4 h-4 animate-spin" />} Excluir
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
