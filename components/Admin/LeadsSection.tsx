'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Copy,
  Download,
  Eye,
  FileUp,
  Loader2,
  MessageCircle,
  Pencil,
  Search,
  Trash2,
  Upload,
  UserPlus,
  X,
} from 'lucide-react';
import { Button, EmptyState, TableSkeletonRows } from '@/components/ui';
import {
  assignNamePhoneEmail,
  parseCrmImportContacts,
} from '@/lib/utils/crm-import-contacts';

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
  { value: 'pendente', label: 'Pendente', cls: 'border-[#E86A24]/50 text-[#E86A24] bg-[#E86A24]/10' },
  { value: 'em_contato', label: 'Em contato', cls: 'border-sky-500/40 text-sky-700 dark:text-sky-300 bg-sky-500/10' },
  { value: 'convertido', label: 'Convertido', cls: 'border-emerald-500/40 text-emerald-700 dark:text-emerald-300 bg-emerald-500/10' },
  { value: 'descartado', label: 'Descartado', cls: 'border-stone-400/50 text-stone-600 dark:text-stone-300 bg-stone-500/10' },
];

const statusCls = (v: string) => STATUS_OPTIONS.find((s) => s.value === v)?.cls || STATUS_OPTIONS[0].cls;

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200] as const;
const SELECT_ALL_PAGE_SIZE = 200;
const SELECT_ALL_MAX = 5000;
const PAGE_SIZE_MAX = 200;

const inputClass =
  'w-full px-3 py-2 min-h-[44px] border border-stone-200 dark:border-white/10 rounded-xl text-sm text-stone-900 dark:text-stone-100 bg-white dark:bg-[#2a221c] placeholder:text-stone-400 dark:placeholder:text-stone-500 focus:outline-none focus:ring-2 focus:ring-[#E86A24]/30 focus:border-[#E86A24] transition-colors';

const surfaceClass =
  'rounded-2xl border border-stone-200/80 dark:border-white/10 bg-white dark:bg-[#241e19] shadow-sm';

const badgeGerente =
  'px-2 py-1 rounded-md text-xs font-semibold border border-[#E86A24]/35 text-[#C45A1A] dark:text-[#EF9057] bg-[#E86A24]/10';
const badgeCaptador =
  'px-2 py-1 rounded-md text-xs font-semibold border border-stone-300/80 dark:border-white/15 text-stone-700 dark:text-stone-200 bg-stone-100 dark:bg-white/5';

function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    return `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  } catch {
    return '';
  }
}

type ImportLead = {
  name: string;
  phone: string;
  email: string;
  status: string;
  gerente: string;
  captador: string;
  created_at: string;
};

function parseCsvRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      row.push(cell.trim());
      cell = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = '';
    } else cell += char;
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function detectLeadsDelimiter(firstLine: string): string {
  const tabs = (firstLine.match(/\t/g) || []).length;
  const semis = (firstLine.match(/;/g) || []).length;
  const commas = (firstLine.match(/,/g) || []).length;
  if (tabs >= semis && tabs >= commas && tabs > 0) return '\t';
  if (semis >= commas) return ';';
  return ',';
}

/** Parser CSV/TXT: com cabeçalho ou detecção automática de nome/telefone. */
function parseLeadsCsv(text: string): ImportLead[] {
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const delim = detectLeadsDelimiter(firstLine);
  const parsed = parseCsvRows(text, delim);
  if (parsed.length === 0) return [];
  const header = parsed[0].map((h) => h.replace(/^\uFEFF/, '').toLowerCase());
  const findIdx = (...keys: string[]) => header.findIndex((h) => keys.some((k) => h.includes(k)));
  const nameIdx = findIdx('nome', 'name');
  const phoneIdx = findIdx('telefone', 'phone', 'whatsapp', 'celular', 'fone');
  const emailIdx = findIdx('email', 'e-mail');
  const statusIdx = findIdx('status', 'situação', 'situacao');
  const gerenteIdx = findIdx('gerente', 'manager');
  const captadorIdx = findIdx('captador', 'consultor');
  const createdAtIdx = findIdx('data/hora', 'data hora', 'created_at', 'criado em');

  // Sem cabeçalho: detecta nome/telefone (tab, vírgula ou telefone formatado no fim da linha)
  if (nameIdx < 0 && phoneIdx < 0 && emailIdx < 0) {
    return parseCrmImportContacts(text).map((c) => ({
      name: c.name,
      phone: c.phone,
      email: c.email,
      status: '',
      gerente: '',
      captador: '',
      created_at: '',
    }));
  }

  return parsed.slice(1).map((cols) => {
    let name = nameIdx >= 0 ? cols[nameIdx] || '' : '';
    let phone = phoneIdx >= 0 ? cols[phoneIdx] || '' : '';
    let email = emailIdx >= 0 ? cols[emailIdx] || '' : '';
    if (!phone && name) {
      const fixed = assignNamePhoneEmail([name]);
      if (fixed.phone) {
        name = fixed.name || name;
        phone = fixed.phone;
        email = email || fixed.email;
      }
    }
    return {
      name,
      phone,
      email,
      status: statusIdx >= 0 ? cols[statusIdx] || '' : '',
      gerente: gerenteIdx >= 0 ? cols[gerenteIdx] || '' : '',
      captador: captadorIdx >= 0 ? cols[captadorIdx] || '' : '',
      created_at: createdAtIdx >= 0 ? cols[createdAtIdx] || '' : '',
    };
  });
}

export default function LeadsSection({
  userId,
  userRole = 'admin',
}: {
  userId: string;
  userRole?: 'admin' | 'gerente';
}) {
  const isGerente = userRole === 'gerente';
  const [leads, setLeads] = useState<CapturedLead[]>([]);
  const [gerentes, setGerentes] = useState<PersonOption[]>([]);
  const [captadores, setCaptadores] = useState<PersonOption[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(50);
  const [pageSizeMode, setPageSizeMode] = useState<'preset' | 'custom'>('preset');
  const [customPageSizeInput, setCustomPageSizeInput] = useState('50');
  const [customSelectInput, setCustomSelectInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selectingAll, setSelectingAll] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  // Filtros
  const [q, setQ] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [fGerente, setFGerente] = useState('');
  const [fCaptador, setFCaptador] = useState('');
  const [fPeriod, setFPeriod] = useState('todos');
  const [onlyDuplicates, setOnlyDuplicates] = useState(false);

  // Seleção persistente entre páginas (Map id → lead)
  const [selectedMap, setSelectedMap] = useState<Map<string, CapturedLead>>(new Map());

  // Modais
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', phone: '', email: '', gerente_id: '', captador_id: '' });
  const [showImport, setShowImport] = useState(false);
  const [importRows, setImportRows] = useState<ImportLead[]>([]);
  const [importError, setImportError] = useState<string | null>(null);
  const [importDest, setImportDest] = useState({ gerente_id: '' });
  const [assignLeads, setAssignLeads] = useState<CapturedLead[] | null>(null);
  const [assignForm, setAssignForm] = useState({ gerente_id: '', captador_id: '' });
  const [viewLead, setViewLead] = useState<CapturedLead | null>(null);
  const [editingLeadInfo, setEditingLeadInfo] = useState(false);
  const [editLeadForm, setEditLeadForm] = useState({ name: '', phone: '', email: '' });
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

  const loadLeads = useCallback(async (targetPage = 1, opts?: { preserveSelection?: boolean; size?: number }) => {
    setLoading(true);
    const size = opts?.size ?? pageSize;
    try {
      const res = await fetch(
        `/api/admin/crm/leads?${buildQuery({ page: String(targetPage), page_size: String(size) })}`,
        { headers: headers() }
      );
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || json.error || 'Erro ao carregar leads');
      const nextLeads: CapturedLead[] = json.data.leads || [];
      setLeads(nextLeads);
      setTotal(json.data.total || 0);
      setPage(json.data.page || targetPage);
      setGerentes(json.data.gerentes || []);
      setCaptadores(json.data.captadores || []);
      if (!opts?.preserveSelection) {
        setSelectedMap(new Map());
      } else {
        // Atualiza objetos já selecionados com dados frescos da página
        setSelectedMap((prev) => {
          if (prev.size === 0) return prev;
          const next = new Map(prev);
          for (const l of nextLeads) {
            if (next.has(l.id)) next.set(l.id, l);
          }
          return next;
        });
      }
    } catch (e: any) {
      showToast(e?.message || 'Erro ao carregar leads', 'error');
    } finally {
      setLoading(false);
    }
  }, [buildQuery, headers, pageSize]);

  useEffect(() => {
    setSelectedMap(new Map());
    loadLeads(1, { preserveSelection: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onlyDuplicates, fStatus, fGerente, fCaptador, fPeriod, pageSize]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const selected = useMemo(() => new Set(selectedMap.keys()), [selectedMap]);
  const selectedLeadObjs = useMemo(() => Array.from(selectedMap.values()), [selectedMap]);

  const toggleSelect = (lead: CapturedLead) => {
    setSelectedMap((prev) => {
      const next = new Map(prev);
      if (next.has(lead.id)) next.delete(lead.id);
      else next.set(lead.id, lead);
      return next;
    });
  };

  const allPageSelected = leads.length > 0 && leads.every((l) => selectedMap.has(l.id));
  const somePageSelected = leads.some((l) => selectedMap.has(l.id));
  const selectAllPageRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (selectAllPageRef.current) {
      selectAllPageRef.current.indeterminate = somePageSelected && !allPageSelected;
    }
  }, [somePageSelected, allPageSelected]);

  const toggleSelectAllPage = () => {
    setSelectedMap((prev) => {
      const next = new Map(prev);
      if (allPageSelected) leads.forEach((l) => next.delete(l.id));
      else leads.forEach((l) => next.set(l.id, l));
      return next;
    });
  };

  const selectFirstN = async (count: number) => {
    if (total <= 0) {
      showToast('Nenhum lead no filtro atual.', 'error');
      return;
    }
    const n = Math.floor(count);
    if (!Number.isFinite(n) || n < 1) {
      showToast('Informe um número válido (mínimo 1).', 'error');
      return;
    }
    const target = Math.min(n, SELECT_ALL_MAX, total);
    if (n > SELECT_ALL_MAX) {
      showToast(`Limite de ${SELECT_ALL_MAX} leads por seleção. Selecionando ${target}.`, 'error');
    }
    setSelectingAll(true);
    try {
      const next = new Map<string, CapturedLead>();
      let p = 1;
      const maxPages = Math.ceil(target / SELECT_ALL_PAGE_SIZE);
      while (next.size < target && p <= maxPages) {
        const res = await fetch(
          `/api/admin/crm/leads?${buildQuery({ page: String(p), page_size: String(SELECT_ALL_PAGE_SIZE) })}`,
          { headers: headers() }
        );
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.message || json.error || 'Erro ao selecionar leads');
        for (const l of (json.data.leads || []) as CapturedLead[]) {
          next.set(l.id, l);
          if (next.size >= target) break;
        }
        if ((json.data.leads || []).length === 0) break;
        p += 1;
      }
      setSelectedMap(next);
      showToast(`${next.size} lead(s) selecionado(s).`, 'success');
    } catch (e: any) {
      showToast(e?.message || 'Erro ao selecionar leads', 'error');
    } finally {
      setSelectingAll(false);
    }
  };

  const selectAllFiltered = async () => {
    await selectFirstN(total);
  };

  const applyCustomSelect = () => {
    const n = parseInt(customSelectInput.replace(/\D/g, ''), 10);
    void selectFirstN(n);
  };

  const applyCustomPageSize = () => {
    const n = parseInt(customPageSizeInput.replace(/\D/g, ''), 10);
    if (!Number.isFinite(n) || n < 1) {
      showToast('Informe um valor válido para por página (mín. 1).', 'error');
      return;
    }
    const size = Math.min(PAGE_SIZE_MAX, n);
    if (n > PAGE_SIZE_MAX) {
      showToast(`Máximo ${PAGE_SIZE_MAX} por página. Usando ${PAGE_SIZE_MAX}.`, 'error');
    }
    setCustomPageSizeInput(String(size));
    setPageSize(size);
  };

  const clearSelection = () => setSelectedMap(new Map());

  // ----- Mutations -----

  const patchLeads = async (ids: string[], body: Record<string, unknown>, successMsg: string): Promise<boolean> => {
    setBusy(true);
    try {
      const ASSIGN_CHUNK = 100;
      // Atribuição em massa: processa em lotes para evitar timeout
      if (ids.length > ASSIGN_CHUNK && (body.captador_id !== undefined || body.gerente_id !== undefined)) {
        let done = 0;
        for (let i = 0; i < ids.length; i += ASSIGN_CHUNK) {
          const chunk = ids.slice(i, i + ASSIGN_CHUNK);
          const res = await fetch('/api/admin/crm/leads', {
            method: 'PATCH',
            headers: headers(),
            body: JSON.stringify({ ids: chunk, ...body }),
          });
          const json = await res.json();
          if (!res.ok || !json.success) throw new Error(json.message || json.error || 'Erro ao salvar');
          done += chunk.length;
          if (ids.length > ASSIGN_CHUNK) {
            showToast(`Atribuindo… ${done}/${ids.length}`, 'success');
          }
        }
        showToast(successMsg, 'success');
        await loadLeads(page, { preserveSelection: true });
        return true;
      }

      const res = await fetch('/api/admin/crm/leads', {
        method: 'PATCH',
        headers: headers(),
        body: JSON.stringify({ ids, ...body }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || json.error || 'Erro ao salvar');
      showToast(successMsg, 'success');
      await loadLeads(page, { preserveSelection: true });
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

  const openEditLeadInfo = (lead: CapturedLead) => {
    setEditLeadForm({ name: lead.name || '', phone: lead.phone || '', email: lead.email || '' });
    setEditingLeadInfo(true);
  };

  const saveLeadInfo = async () => {
    if (!viewLead || !editLeadForm.name.trim()) return;
    const ok = await patchLeads(
      [viewLead.id],
      { name: editLeadForm.name.trim(), phone: editLeadForm.phone.trim(), email: editLeadForm.email.trim() },
      'Informações do cliente atualizadas.'
    );
    if (ok) {
      setViewLead({ ...viewLead, name: editLeadForm.name.trim(), phone: editLeadForm.phone.trim(), email: editLeadForm.email.trim() });
      setEditingLeadInfo(false);
    }
  };

  const submitCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isGerente && !createForm.gerente_id) {
      showToast('Selecione o gerente para vincular o lead.', 'error');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/admin/crm/leads', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          name: createForm.name,
          phone: createForm.phone,
          email: createForm.email || undefined,
          gerente_id: isGerente ? userId : (createForm.gerente_id || undefined),
          captador_id: isGerente ? (createForm.captador_id || undefined) : undefined,
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
    const lower = file.name.toLowerCase();
    if (!lower.endsWith('.csv') && !lower.endsWith('.txt')) {
      setImportError('Envie um arquivo .csv ou .txt');
      setImportRows([]);
      return;
    }
    try {
      const text = await file.text();
      const rows = parseLeadsCsv(text);
      if (rows.length === 0) {
        setImportError('Arquivo vazio ou formato não reconhecido. Use CSV/TXT com colunas nome, telefone, email.');
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
    if (!isGerente && !importDest.gerente_id) {
      showToast('Selecione o gerente para vincular os contatos.', 'error');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/admin/crm/leads/import', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          leads: importRows,
          gerente_id: isGerente ? undefined : importDest.gerente_id,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || json.error || 'Erro ao importar');
      showToast(json.message || 'Base importada com sucesso!', 'success');
      setShowImport(false);
      setImportRows([]);
      setImportDest({ gerente_id: '' });
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
    if (!isGerente && !assignForm.gerente_id) {
      showToast('Selecione o gerente.', 'error');
      return;
    }
    if (isGerente && !assignForm.captador_id) {
      showToast('Selecione um captador da sua equipe.', 'error');
      return;
    }
    const body: Record<string, unknown> = {};
    if (isGerente) {
      body.gerente_id = userId;
      body.captador_id = assignForm.captador_id;
    } else {
      body.gerente_id = assignForm.gerente_id;
    }
    const ok = await patchLeads(
      assignLeads.map((l) => l.id),
      body,
      isGerente
        ? 'Lead(s) atribuído(s) — já disponíveis no kanban do captador!'
        : 'Lead(s) vinculado(s) ao gerente. O captador será atribuído pelo gerente.'
    );
    if (ok) {
      const assignedIds = new Set(assignLeads.map((l) => l.id));
      setSelectedMap((prev) => {
        const next = new Map(prev);
        assignedIds.forEach((id) => next.delete(id));
        return next;
      });
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
      const deletedIds = new Set(deleteLeads.map((l) => l.id));
      setSelectedMap((prev) => {
        const next = new Map(prev);
        deletedIds.forEach((id) => next.delete(id));
        return next;
      });
      setDeleteLeads(null);
      await loadLeads(page, { preserveSelection: true });
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

  const teamCaptadores = useMemo(() => {
    if (!isGerente) return captadores;
    return captadores.filter((c) => c.enroller === userId);
  }, [captadores, isGerente, userId]);

  const captadoresForGerente = useMemo(() => {
    if (isGerente) return teamCaptadores;
    if (!assignForm.gerente_id) return captadores;
    const team = captadores.filter((c) => c.enroller === assignForm.gerente_id);
    return team.length > 0 ? team : captadores;
  }, [captadores, assignForm.gerente_id, isGerente, teamCaptadores]);

  const modalShell = (title: string, onClose: () => void, children: React.ReactNode, wide = false) => (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className={`bg-white dark:bg-[#2a221c] rounded-2xl shadow-2xl w-full ${wide ? 'max-w-lg' : 'max-w-md'} overflow-hidden border border-stone-200 dark:border-white/10 max-h-[90vh] flex flex-col`}>
        <div className="p-5 border-b border-stone-200 dark:border-white/10 flex items-center justify-between flex-shrink-0">
          <h2 className="text-lg font-bold text-stone-900 dark:text-stone-50">{title}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-stone-500 hover:bg-stone-100 dark:hover:bg-white/10 transition-colors" aria-label="Fechar">
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
      {!isGerente && (
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Gerente {required ? '' : '(obrigatório)'}</label>
          <select value={value.gerente_id} onChange={(e) => onChange({ gerente_id: e.target.value, captador_id: '' })} className={inputClass} required>
            <option value="">Selecione o gerente...</option>
            {gerentes.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
          <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">O captador só pode ser vinculado pelo gerente.</p>
        </div>
      )}
      {isGerente && (
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Captador (opcional — o lead entra no kanban dele)</label>
          <select value={value.captador_id} onChange={(e) => onChange({ ...value, captador_id: e.target.value })} className={inputClass}>
            <option value="">Sem captador ainda</option>
            {teamCaptadores.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      )}
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
          <h1 className="text-3xl font-bold text-stone-900 dark:text-stone-50">Leads</h1>
          <p className="text-stone-600 dark:text-stone-400 mt-1">Gerenciamento de leads capturados</p>
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
      <div className={`${surfaceClass} p-4 sm:p-5 space-y-4`}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div>
            <label className="block text-xs font-medium text-stone-600 dark:text-stone-400 mb-1.5">Buscar</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
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
            <label className="block text-xs font-medium text-stone-600 dark:text-stone-400 mb-1.5">Status</label>
            <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className={inputClass}>
              <option value="">Todos</option>
              {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          {!isGerente && (
          <div>
            <label className="block text-xs font-medium text-stone-600 dark:text-stone-400 mb-1.5">Gerente</label>
            <select value={fGerente} onChange={(e) => setFGerente(e.target.value)} className={inputClass}>
              <option value="">Todos</option>
              {gerentes.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
          )}
          <div>
            <label className="block text-xs font-medium text-stone-600 dark:text-stone-400 mb-1.5">Captador</label>
            <select value={fCaptador} onChange={(e) => setFCaptador(e.target.value)} className={inputClass}>
              <option value="">Todos</option>
              {(isGerente ? teamCaptadores : captadores).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-600 dark:text-stone-400 mb-1.5">Período</label>
            <select value={fPeriod} onChange={(e) => setFPeriod(e.target.value)} className={inputClass}>
              <option value="todos">Todos</option>
              <option value="hoje">Hoje</option>
              <option value="7d">Últimos 7 dias</option>
              <option value="30d">Últimos 30 dias</option>
            </select>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
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
                ? 'border-[#E86A24]/50 text-[#E86A24] bg-[#E86A24]/10'
                : 'border-stone-300 dark:border-white/15 text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-white/5'
            }`}
          >
            <Copy className="w-4 h-4" /> Duplicados
          </button>
          <div className="flex flex-wrap items-center gap-3 ml-auto">
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-stone-500 dark:text-stone-400 whitespace-nowrap">Selecionar</label>
              <input
                type="number"
                min={1}
                max={SELECT_ALL_MAX}
                value={customSelectInput}
                onChange={(e) => setCustomSelectInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') applyCustomSelect(); }}
                placeholder="Ex: 80"
                className="w-[5.5rem] px-2.5 py-2 min-h-[40px] rounded-xl text-sm border border-stone-200 dark:border-white/10 bg-white dark:bg-[#2a221c] text-stone-800 dark:text-stone-100"
              />
              <button
                type="button"
                onClick={applyCustomSelect}
                disabled={selectingAll || busy || total === 0 || !customSelectInput.trim()}
                className="px-3 py-2 min-h-[40px] rounded-xl text-xs font-bold text-white bg-[#E86A24] hover:bg-[#D95E1B] disabled:opacity-50"
              >
                {selectingAll ? '…' : 'OK'}
              </button>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-stone-500 dark:text-stone-400 whitespace-nowrap">Por página</label>
              <select
                value={pageSizeMode === 'custom' ? 'custom' : String(pageSize)}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === 'custom') {
                    setPageSizeMode('custom');
                    setCustomPageSizeInput(String(pageSize));
                    return;
                  }
                  setPageSizeMode('preset');
                  setPageSize(Number(v));
                }}
                className="px-2.5 py-2 min-h-[40px] rounded-xl text-sm border border-stone-200 dark:border-white/10 bg-white dark:bg-[#2a221c] text-stone-800 dark:text-stone-100"
              >
                {PAGE_SIZE_OPTIONS.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
                <option value="custom">Personalizado</option>
              </select>
              {pageSizeMode === 'custom' && (
                <>
                  <input
                    type="number"
                    min={1}
                    max={PAGE_SIZE_MAX}
                    value={customPageSizeInput}
                    onChange={(e) => setCustomPageSizeInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') applyCustomPageSize(); }}
                    className="w-[4.5rem] px-2.5 py-2 min-h-[40px] rounded-xl text-sm border border-stone-200 dark:border-white/10 bg-white dark:bg-[#2a221c] text-stone-800 dark:text-stone-100"
                  />
                  <button
                    type="button"
                    onClick={applyCustomPageSize}
                    className="px-3 py-2 min-h-[40px] rounded-xl text-xs font-bold border border-stone-300 dark:border-white/15 text-stone-700 dark:text-stone-200 hover:bg-stone-100 dark:hover:bg-white/5"
                  >
                    Aplicar
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Barra de ações em massa */}
      {(selected.size > 0 || (total > leads.length && !loading)) && (
        <div className="rounded-xl border border-[#E86A24]/30 bg-[#E86A24]/10 px-4 py-3 flex flex-wrap items-center gap-3">
          {selected.size > 0 ? (
            <>
              <span className="text-sm font-bold text-[#C45A1A] dark:text-[#EF9057]">{selected.size} selecionado(s)</span>
              {selected.size < total && (
                <button
                  type="button"
                  onClick={selectAllFiltered}
                  disabled={selectingAll || busy}
                  className="text-xs font-semibold text-[#E86A24] hover:underline disabled:opacity-60"
                >
                  {selectingAll ? 'Selecionando…' : `Selecionar todos os ${total} resultados`}
                </button>
              )}
              <button type="button" onClick={clearSelection} className="text-xs font-medium text-stone-500 dark:text-stone-400 hover:underline">
                Limpar
              </button>
              <button
                onClick={() => { setAssignLeads(selectedLeadObjs); setAssignForm({ gerente_id: isGerente ? userId : '', captador_id: '' }); }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-[#E86A24]/45 text-[#C45A1A] dark:text-[#EF9057] hover:bg-[#E86A24]/15"
              >
                <UserPlus className="w-3.5 h-3.5" /> Atribuir
              </button>
              {!isGerente && (
              <button
                onClick={() => setDeleteLeads(selectedLeadObjs)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-red-500/50 text-red-600 dark:text-red-400 hover:bg-red-500/10"
              >
                <Trash2 className="w-3.5 h-3.5" /> Excluir
              </button>
              )}
            </>
          ) : (
            <button
              type="button"
              onClick={selectAllFiltered}
              disabled={selectingAll || busy || total === 0}
              className="text-sm font-semibold text-[#C45A1A] dark:text-[#EF9057] hover:underline disabled:opacity-60"
            >
              {selectingAll ? 'Selecionando…' : `Selecionar todos os ${total} resultados do filtro`}
            </button>
          )}
        </div>
      )}

      {/* Tabela */}
      <div className={`${surfaceClass} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-200 dark:border-white/10 text-left text-xs uppercase tracking-wider text-stone-500 dark:text-stone-400 bg-stone-50/80 dark:bg-black/20">
                <th className="px-4 py-3.5 w-10">
                  <input
                    ref={selectAllPageRef}
                    type="checkbox"
                    checked={allPageSelected}
                    onChange={toggleSelectAllPage}
                    className="w-4 h-4 rounded accent-[#E86A24]"
                    title="Selecionar página"
                  />
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
            <tbody className="divide-y divide-stone-100 dark:divide-white/5">
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
                  <tr key={l.id} className={`hover:bg-stone-50 dark:hover:bg-white/[0.04] ${selected.has(l.id) ? 'bg-[#E86A24]/5 dark:bg-[#E86A24]/10' : ''}`}>
                    <td className="px-4 py-3">
                      <input type="checkbox" checked={selected.has(l.id)} onChange={() => toggleSelect(l)} className="w-4 h-4 rounded accent-[#E86A24]" />
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={l.capture_status}
                        onChange={(e) => changeStatus(l, e.target.value)}
                        disabled={busy}
                        className={`px-2.5 py-1.5 rounded-lg text-xs font-bold border bg-transparent cursor-pointer ${statusCls(l.capture_status)}`}
                      >
                        {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value} className="bg-white dark:bg-[#2a221c] text-stone-800 dark:text-stone-100">{s.label}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-stone-900 dark:text-stone-50">{l.name || '—'}</span>
                        <span className="text-[11px] text-stone-400">(#{l.external_id.slice(-6)})</span>
                        {l.occurrence > 1 && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#E86A24]/15 text-[#E86A24] border border-[#E86A24]/35">
                            {l.occurrence}ª vez
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-medium text-stone-800 dark:text-stone-200">{l.phone || '—'}</td>
                    <td className="px-4 py-3">
                      {l.gerente_name ? (
                        <span className={badgeGerente}>{l.gerente_name}</span>
                      ) : (
                        <button
                          onClick={() => { setAssignLeads([l]); setAssignForm({ gerente_id: '', captador_id: '' }); }}
                          className="px-3 py-1 rounded-md text-xs font-medium border border-stone-300 dark:border-white/15 text-stone-500 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-white/5"
                        >
                          Atribuir
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {l.captador_name ? (
                        <span className={badgeCaptador}>{l.captador_name}</span>
                      ) : (
                        <span className="text-stone-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-stone-600 dark:text-stone-300 whitespace-nowrap">{formatDateTime(l.created_at)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        {l.phone && (
                          <a
                            href={`https://wa.me/${l.phone.startsWith('55') ? l.phone : `55${l.phone}`}`}
                            target="_blank"
                            rel="noreferrer"
                            className="p-2 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10"
                            title="Abrir WhatsApp"
                          >
                            <MessageCircle className="w-4 h-4" />
                          </a>
                        )}
                        <button
                          onClick={() => { setAssignLeads([l]); setAssignForm({ gerente_id: isGerente ? userId : (l.gerente_id || ''), captador_id: '' }); }}
                          className="p-2 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-[#E86A24] hover:bg-[#E86A24]/10"
                          title={isGerente ? 'Atribuir captador' : 'Vincular ao gerente'}
                        >
                          <UserPlus className="w-4 h-4" />
                        </button>
                        <button onClick={() => { setViewLead(l); setEditingLeadInfo(false); }} className="p-2 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-stone-500 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-white/5" title="Ver detalhes">
                          <Eye className="w-4 h-4" />
                        </button>
                        {!isGerente && (
                        <button onClick={() => setDeleteLeads([l])} className="p-2 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-red-500 hover:bg-red-500/10" title="Excluir">
                          <Trash2 className="w-4 h-4" />
                        </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {/* Paginação */}
        {(totalPages > 1 || total > 0) && (
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 py-3 border-t border-stone-200 dark:border-white/10 text-sm">
            <span className="text-stone-500 dark:text-stone-400">
              {total} lead(s){totalPages > 1 ? ` — página ${page} de ${totalPages}` : ''}
              {selected.size > 0 ? ` · ${selected.size} selecionado(s)` : ''}
            </span>
            {totalPages > 1 && (
              <div className="flex gap-2">
                <button
                  onClick={() => loadLeads(page - 1, { preserveSelection: true })}
                  disabled={page <= 1 || loading}
                  className="px-3 py-1.5 rounded-lg border border-stone-300 dark:border-white/15 text-stone-700 dark:text-stone-300 disabled:opacity-40 hover:bg-stone-100 dark:hover:bg-white/5"
                >
                  Anterior
                </button>
                <button
                  onClick={() => loadLeads(page + 1, { preserveSelection: true })}
                  disabled={page >= totalPages || loading}
                  className="px-3 py-1.5 rounded-lg border border-stone-300 dark:border-white/15 text-stone-700 dark:text-stone-300 disabled:opacity-40 hover:bg-stone-100 dark:hover:bg-white/5"
                >
                  Próxima
                </button>
              </div>
            )}
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
      {showImport && modalShell('Importar base de leads (CSV / TXT)', () => setShowImport(false), (
        <div className="p-5 space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Arquivo <strong>.csv</strong> ou <strong>.txt</strong>. Com cabeçalho:{' '}
            <code className="bg-gray-100 dark:bg-[#333] px-1 rounded">Nome</code>,{' '}
            <code className="bg-gray-100 dark:bg-[#333] px-1 rounded">WhatsApp</code>, e-mail, status, gerente.
            Sem cabeçalho, detecta automaticamente nome e telefone (ex.: <code className="bg-gray-100 dark:bg-[#333] px-1 rounded">Leandro	41992074020</code> ou{' '}
            <code className="bg-gray-100 dark:bg-[#333] px-1 rounded">Guilherme (11) 99149-7158</code>).
            Máximo 5000 linhas. Contatos vão para o gerente; Captador fica vazio até atribuição.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.txt,text/csv,text/plain"
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
              {!isGerente && (
                <div className="space-y-4 border-t border-gray-200 dark:border-gray-600 pt-4">
                  <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Vincular ao gerente</p>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Gerente</label>
                    <select
                      value={importDest.gerente_id}
                      onChange={(e) => setImportDest({ gerente_id: e.target.value })}
                      className={inputClass}
                      required
                    >
                      <option value="">Selecione o gerente...</option>
                      {gerentes.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                    </select>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Sem captador: o gerente recebe os leads na tabela e atribui aos captadores depois.
                    Se o CSV trouxer a coluna Gerente, ela prevalece por linha.
                  </p>
                </div>
              )}
            </>
          )}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setShowImport(false)} className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-white/5">Cancelar</button>
            <button
              onClick={submitImport}
              disabled={busy || importRows.length === 0 || (!isGerente && !importDest.gerente_id)}
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
            {!isGerente && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Gerente</label>
              <select value={assignForm.gerente_id} onChange={(e) => setAssignForm({ gerente_id: e.target.value, captador_id: '' })} className={inputClass} required>
                <option value="">Selecione o gerente...</option>
                {gerentes.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
              <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">Somente o gerente vincula o lead a um captador.</p>
            </div>
            )}
            {isGerente && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Captador</label>
              <select value={assignForm.captador_id} onChange={(e) => setAssignForm({ ...assignForm, captador_id: e.target.value })} className={inputClass} required>
                <option value="">Selecione o captador...</option>
                {captadoresForGerente.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">Ao escolher um captador, o lead entra na coluna inicial do kanban dele.</p>
            </div>
            )}
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
        editingLeadInfo ? (
          <div className="p-5 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Nome</label>
              <input value={editLeadForm.name} onChange={(e) => setEditLeadForm((f) => ({ ...f, name: e.target.value }))} className={inputClass} placeholder="Nome do cliente" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">WhatsApp</label>
              <input value={editLeadForm.phone} onChange={(e) => setEditLeadForm((f) => ({ ...f, phone: e.target.value }))} className={inputClass} placeholder="DDD + número" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Email</label>
              <input type="email" value={editLeadForm.email} onChange={(e) => setEditLeadForm((f) => ({ ...f, email: e.target.value }))} className={inputClass} />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setEditingLeadInfo(false)} className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-white/5">Cancelar</button>
              <button onClick={saveLeadInfo} disabled={busy || !editLeadForm.name.trim()} className="px-5 py-2 rounded-lg bg-[#E86A24] text-white font-bold hover:bg-[#D95E1B] disabled:opacity-60 flex items-center gap-2">
                {busy && <Loader2 className="w-4 h-4 animate-spin" />} Salvar
              </button>
            </div>
          </div>
        ) : (
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
            <div className="flex items-center gap-4 pt-1">
              <button
                onClick={() => openEditLeadInfo(viewLead)}
                className="inline-flex items-center gap-2 text-[#E86A24] hover:underline font-medium"
              >
                <Pencil className="w-4 h-4" /> Editar informações do cliente
              </button>
            </div>
          </div>
        )
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
