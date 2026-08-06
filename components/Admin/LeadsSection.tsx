'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  Eye,
  FileUp,
  Loader2,
  MessageCircle,
  Pencil,
  Search,
  Trash2,
  Trophy,
  Upload,
  UserCheck,
  UserPlus,
  X,
} from 'lucide-react';
import { Button, EmptyState, TableSkeletonRows } from '@/components/ui';
import {
  assignNamePhoneEmail,
  parseCrmImportContacts,
} from '@/lib/utils/crm-import-contacts';
import { ACQUISITION_TAG_LABELS, type AcquisitionTag } from '@/lib/crm/acquisition-tags';

/** Tela Admin > CRM > Leads: gerenciamento de leads capturados, interligada ao kanban (atribuição via crm_move_lead). */

type CapturedLead = {
  id: string;
  external_id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  capture_status: string;
  column_key: string | null;
  column_title: string | null;
  source: string | null;
  acquisition_tag?: 'ads' | 'disparo' | 'campanha' | null;
  created_at: string;
  captador_id: string | null;
  captador_name: string | null;
  gerente_id: string | null;
  gerente_name: string | null;
  occurrence: number;
  occurrence_total: number;
  unassigned?: boolean;
  assignment_status?: 'nao_atribuido' | 'com_gerente' | 'atribuido';
};

type PersonOption = { id: string; name: string; enroller?: string | null };
type KanbanColumnOption = { id: string; key: string; title: string };
type CaptadorSalesRow = {
  id: string;
  name: string;
  total_leads: number;
  vendas_fechadas: number;
  taxa_vendas: number;
};
type SalesSummary = {
  total_leads: number;
  total_vendas: number;
  taxa: number;
  total_nao_atribuidos: number;
  by_captador: CaptadorSalesRow[];
};

function localTodayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatPeriodLabel(period: string, date: string): string {
  if (period === 'todos') return 'Todo o período';
  if (period === '7d') return 'Últimos 7 dias';
  if (period === '30d') return 'Últimos 30 dias';
  if (period === 'dia' || period === 'hoje') {
    const [y, m, d] = date.split('-').map(Number);
    if (!y || !m || !d) return period === 'hoje' ? 'Hoje' : 'Dia';
    const label = new Date(y, m - 1, d).toLocaleDateString('pt-BR');
    return period === 'hoje' && date === localTodayYmd() ? `Hoje (${label})` : label;
  }
  return 'Período';
}

function columnSelectCls(key: string | null | undefined, title?: string | null): string {
  const n = `${key || ''} ${title || ''}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  if (n.includes('convert') || n.includes('ganho') || n.includes('venda')) {
    return 'border-emerald-500/45 text-emerald-700 dark:text-emerald-300 bg-emerald-500/10';
  }
  if (n.includes('lixo') || n.includes('perd') || n.includes('encerr') || n.includes('descart')) {
    return 'border-stone-400/50 text-stone-600 dark:text-stone-300 bg-stone-500/10';
  }
  if (n.includes('atend') || n.includes('contato') || n.includes('nao responde')) {
    return 'border-sky-500/40 text-sky-700 dark:text-sky-300 bg-sky-500/10';
  }
  if (n.includes('novo') || n.includes('pendente')) {
    return 'border-[#E86A24]/50 text-[#E86A24] bg-[#E86A24]/10';
  }
  return 'border-violet-500/40 text-violet-700 dark:text-violet-300 bg-violet-500/10';
}

/** Dropdown de coluna CRM com menu no body (não fica preso no overflow da tabela). */
function CrmColumnSelect({
  lead,
  columns,
  disabled,
  onChange,
  onNeedColumns,
}: {
  lead: CapturedLead;
  columns: KanbanColumnOption[];
  disabled?: boolean;
  onChange: (key: string) => void;
  onNeedColumns?: () => Promise<KanbanColumnOption[]>;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [localCols, setLocalCols] = useState<KanbanColumnOption[]>([]);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 240 });

  const options = useMemo(() => {
    const base = (columns.length > 0 ? columns : localCols).slice();
    if (lead.column_key && !base.some((c) => c.key === lead.column_key)) {
      base.unshift({
        id: `current-${lead.id}-${lead.column_key}`,
        key: lead.column_key,
        title: lead.column_title || lead.column_key,
      });
    }
    return base;
  }, [columns, localCols, lead.column_key, lead.column_title, lead.id]);

  const label = lead.column_title || options.find((c) => c.key === lead.column_key)?.title || lead.column_key || 'Escolher coluna';

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const r = btnRef.current?.getBoundingClientRect();
      if (!r) return;
      const width = Math.max(r.width, 240);
      const left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8);
      const below = r.bottom + 4;
      const spaceBelow = window.innerHeight - below;
      const top = spaceBelow < 220 && r.top > 220 ? r.top - Math.min(256, spaceBelow + r.height) - 4 : below;
      setPos({ top, left, width });
    };
    place();
    // Fecha só no próximo tick — evita o mesmo clique que abriu fechar na hora
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const t = window.setTimeout(() => document.addEventListener('mousedown', onDoc), 0);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  const toggle = async () => {
    if (disabled) return;
    const next = !open;
    setOpen(next);
    if (!next) return;
    if (columns.length > 0) {
      setLocalCols(columns);
      return;
    }
    if (!onNeedColumns) return;
    setLoading(true);
    try {
      const fetched = await onNeedColumns();
      setLocalCols(fetched);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        disabled={Boolean(disabled)}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void toggle();
        }}
        title="Trocar coluna do CRM"
        className={`relative z-20 w-full min-w-[15rem] max-w-[18rem] px-3 py-2.5 min-h-[48px] rounded-xl text-sm font-bold border shadow-sm inline-flex items-center justify-between gap-2 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${columnSelectCls(lead.column_key, lead.column_title)} bg-white dark:bg-[#2a221c]`}
      >
        <span className="truncate">{label}</span>
        <ChevronDown className={`w-4 h-4 shrink-0 opacity-80 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={menuRef}
            data-crm-column-menu
            className="fixed z-[99999] max-h-64 overflow-y-auto rounded-xl border border-stone-200 dark:border-white/15 bg-white dark:bg-[#2a221c] shadow-2xl py-1"
            style={{ top: pos.top, left: pos.left, width: pos.width }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {loading && (
              <div className="px-3 py-2.5 text-sm text-stone-500 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Carregando…
              </div>
            )}
            {!loading && options.length === 0 && (
              <div className="px-3 py-2.5 text-sm text-stone-500">Nenhuma coluna encontrada</div>
            )}
            {!loading &&
              options.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`w-full text-left px-3 py-2.5 text-sm font-semibold hover:bg-[#E86A24]/10 ${
                    c.key === lead.column_key ? 'text-[#E86A24] bg-[#E86A24]/5' : 'text-stone-800 dark:text-stone-100'
                  }`}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setOpen(false);
                    if (c.key !== lead.column_key) onChange(c.key);
                  }}
                >
                  {c.title}
                </button>
              ))}
          </div>,
          document.body
        )}
    </>
  );
}

const UNASSIGNED_COLUMN_FILTER = '__unassigned__';

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
  userRole?: 'admin' | 'gerente' | 'captador';
}) {
  const [viewerStatus, setViewerStatus] = useState(String(userRole || 'admin').toLowerCase());
  // Coluna CRM: sempre editável na UI (API valida escopo por cargo).
  const [canEditColumn, setCanEditColumn] = useState(true);
  const role = viewerStatus;
  const isGerente = role === 'gerente';
  const isCaptador = role === 'captador';
  const isAdmin = role === 'admin' || role === 'super_admin';
  const canManage = !isCaptador;
  const [leads, setLeads] = useState<CapturedLead[]>([]);
  const [gerentes, setGerentes] = useState<PersonOption[]>([]);
  const [captadores, setCaptadores] = useState<PersonOption[]>([]);
  const [columns, setColumns] = useState<KanbanColumnOption[]>([]);
  const [defaultColumnKey, setDefaultColumnKey] = useState('novo');
  const [sales, setSales] = useState<SalesSummary>({
    total_leads: 0,
    total_vendas: 0,
    taxa: 0,
    total_nao_atribuidos: 0,
    by_captador: [],
  });
  const [showSalesBreakdown, setShowSalesBreakdown] = useState(false);
  const [showAssignedBreakdown, setShowAssignedBreakdown] = useState(false);
  const [showZeroSalesCaptadores, setShowZeroSalesCaptadores] = useState(false);
  const [showZeroAssignedCaptadores, setShowZeroAssignedCaptadores] = useState(false);
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
  const [fColumn, setFColumn] = useState('');
  const [fGerente, setFGerente] = useState('');
  const [fCaptador, setFCaptador] = useState('');
  const [fPeriod, setFPeriod] = useState('todos');
  const [fDate, setFDate] = useState(localTodayYmd);
  const [fTag, setFTag] = useState('');
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
  const [bulkColumnKey, setBulkColumnKey] = useState('');
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

  // Fonte de verdade do cargo: profile + meta da API de leads (evita gerente cair como captador).
  useEffect(() => {
    let cancelled = false;
    const resolveRole = async () => {
      try {
        const res = await fetch('/api/user/profile', { headers: { 'X-User-Id': userId } });
        const json = await res.json();
        const status = String(json?.data?.status || userRole || '').toLowerCase().trim();
        if (cancelled || !status) return;
        setViewerStatus(status === 'super_admin' ? 'admin' : status);
        setCanEditColumn(true);
      } catch {
        /* ignore */
      }
    };
    void resolveRole();
    return () => {
      cancelled = true;
    };
  }, [userId, userRole]);

  const fetchKanbanColumns = useCallback(async (): Promise<KanbanColumnOption[]> => {
    try {
      const boardRes = await fetch('/api/crm/board', { headers: headers() });
      const boardJson = await boardRes.json();
      const boardCols = boardJson?.data?.columns;
      if (boardRes.ok && boardJson.success && Array.isArray(boardCols) && boardCols.length > 0) {
        const mapped = boardCols.map((c: { id: string; key: string; title?: string }) => ({
          id: c.id,
          key: c.key,
          title: c.title || c.key,
        }));
        setColumns(mapped);
        return mapped;
      }
    } catch {
      /* ignore */
    }
    return [];
  }, [headers]);

  const buildQuery = useCallback((extra: Record<string, string> = {}) => {
    const sp = new URLSearchParams();
    if (q.trim()) sp.set('q', q.trim());
    if (fColumn) sp.set('column_key', fColumn);
    if (fGerente) sp.set('gerente_id', fGerente);
    if (fCaptador) sp.set('captador_id', fCaptador);
    sp.set('period', fPeriod || 'hoje');
    if ((fPeriod === 'hoje' || fPeriod === 'dia') && fDate) sp.set('date', fDate);
    if (fTag) sp.set('acquisition_tag', fTag);
    if (onlyDuplicates) sp.set('duplicates', '1');
    Object.entries(extra).forEach(([k, v]) => sp.set(k, v));
    return sp.toString();
  }, [q, fColumn, fGerente, fCaptador, fPeriod, fDate, fTag, onlyDuplicates]);

  const loadSales = useCallback(async () => {
    try {
      const qs = buildQuery({ sales_only: '1', include_sales: '1' });
      const res = await fetch(`/api/admin/crm/leads?${qs}`, { headers: headers() });
      const json = await res.json();
      if (!res.ok || !json.success || !json.data?.sales) return;
      setSales({
        total_leads: json.data.sales.total_leads || 0,
        total_vendas: json.data.sales.total_vendas || 0,
        taxa: json.data.sales.taxa || 0,
        total_nao_atribuidos: json.data.sales.total_nao_atribuidos || 0,
        by_captador: Array.isArray(json.data.sales.by_captador) ? json.data.sales.by_captador : [],
      });
    } catch {
      /* card de vendas é secundário */
    }
  }, [headers, buildQuery]);

  const loadLeads = useCallback(async (targetPage = 1, opts?: { preserveSelection?: boolean; size?: number }) => {
    setLoading(true);
    const size = opts?.size ?? pageSize;
    try {
      // Tabela primeiro (sem vendas) — bem mais rápido
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
      setColumns(json.data.columns || []);
      if (json.data.default_column_key) setDefaultColumnKey(json.data.default_column_key);
      if (json.data.viewer) {
        const vs = String(json.data.viewer.status || '').toLowerCase().trim();
        if (vs) setViewerStatus(vs === 'super_admin' ? 'admin' : vs);
        setCanEditColumn(true);
      }
      const gs = json.data.gerentes;
      if (Array.isArray(gs) && gs.length === 1 && gs[0]?.id === userId) {
        setViewerStatus('gerente');
        setCanEditColumn(true);
      }
      if (!opts?.preserveSelection) {
        setSelectedMap(new Map());
      } else {
        setSelectedMap((prev) => {
          if (prev.size === 0) return prev;
          const next = new Map(prev);
          for (const l of nextLeads) {
            if (next.has(l.id)) next.set(l.id, l);
          }
          return next;
        });
      }
      // Vendas em background (não bloqueia a tabela)
      void loadSales();
    } catch (e: any) {
      showToast(e?.message || 'Erro ao carregar leads', 'error');
    } finally {
      setLoading(false);
    }
  }, [buildQuery, headers, pageSize, userId, loadSales]);

  useEffect(() => {
    // Captador não usa o filtro de pool; limpa se veio de sessão antiga
    if (isCaptador && fColumn === UNASSIGNED_COLUMN_FILTER) {
      setFColumn('');
    }
  }, [isCaptador, fColumn]);

  useEffect(() => {
    setSelectedMap(new Map());
    loadLeads(1, { preserveSelection: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onlyDuplicates, fColumn, fGerente, fCaptador, fPeriod, fDate, fTag, pageSize]);

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
      if (ids.length > ASSIGN_CHUNK && (body.captador_id !== undefined || body.gerente_id !== undefined || body.column_key !== undefined)) {
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

  const changeColumn = (lead: CapturedLead, columnKey: string) => {
    if (!columnKey) return;
    if (!lead.captador_id) {
      showToast('Atribua um captador antes de definir a coluna do CRM.', 'error');
      return;
    }
    if (lead.column_key === columnKey) return;
    patchLeads([lead.id], { column_key: columnKey }, 'Coluna do CRM atualizada.');
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

  const applyBulkColumn = async (columnKey: string) => {
    if (!columnKey) return;
    const withCaptador = selectedLeadObjs.filter((l) => l.captador_id);
    if (withCaptador.length === 0) {
      showToast('Selecione leads que já tenham captador atribuído.', 'error');
      setBulkColumnKey('');
      return;
    }
    const ok = await patchLeads(
      withCaptador.map((l) => l.id),
      { column_key: columnKey },
      `${withCaptador.length} lead(s) movido(s) de coluna no kanban.`
    );
    setBulkColumnKey('');
    if (!ok) return;
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
      const header = ['ID', 'Nome', 'WhatsApp', 'Email', 'Coluna CRM', 'Gerente', 'Captador', 'TAG', 'Origem', 'Ocorrência', 'Data/Hora'];
      const lines = all.map((l) =>
        [
          l.external_id,
          l.name || '',
          l.phone || '',
          l.email || '',
          l.column_title || l.column_key || '',
          l.gerente_name || '',
          l.captador_name || '',
          l.acquisition_tag
            ? ACQUISITION_TAG_LABELS[l.acquisition_tag as AcquisitionTag] || l.acquisition_tag
            : '',
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

  const salesByCaptadorSorted = useMemo(() => {
    return [...sales.by_captador].sort(
      (a, b) =>
        b.vendas_fechadas - a.vendas_fechadas ||
        b.taxa_vendas - a.taxa_vendas ||
        b.total_leads - a.total_leads ||
        a.name.localeCompare(b.name, 'pt-BR')
    );
  }, [sales.by_captador]);

  const assignedByCaptadorSorted = useMemo(() => {
    return [...sales.by_captador].sort(
      (a, b) =>
        b.total_leads - a.total_leads ||
        b.vendas_fechadas - a.vendas_fechadas ||
        a.name.localeCompare(b.name, 'pt-BR')
    );
  }, [sales.by_captador]);

  const salesWithVendas = useMemo(
    () => salesByCaptadorSorted.filter((c) => c.vendas_fechadas > 0),
    [salesByCaptadorSorted]
  );
  const salesWithoutVendas = useMemo(
    () => salesByCaptadorSorted.filter((c) => c.vendas_fechadas <= 0),
    [salesByCaptadorSorted]
  );
  const salesRowsVisible = showZeroSalesCaptadores
    ? salesByCaptadorSorted
    : salesWithVendas;

  const assignedWithLeads = useMemo(
    () => assignedByCaptadorSorted.filter((c) => c.total_leads > 0),
    [assignedByCaptadorSorted]
  );
  const assignedWithoutLeads = useMemo(
    () => assignedByCaptadorSorted.filter((c) => c.total_leads <= 0),
    [assignedByCaptadorSorted]
  );
  const assignedRowsVisible = showZeroAssignedCaptadores
    ? assignedByCaptadorSorted
    : assignedWithLeads;

  // Gerente: a API já devolve só a equipe. Re-filtrar por enroller esvazia o select
  // quando o campo vier nulo no payload (bug: modal Atribuir sem captadores).
  const teamCaptadores = useMemo(() => {
    if (!isGerente) return captadores;
    const team = captadores.filter((c) => !c.enroller || c.enroller === userId);
    return team.length > 0 ? team : captadores;
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
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-bold text-stone-900 dark:text-stone-50">Leads</h1>
            <span className="px-2.5 py-1 rounded-lg text-[11px] font-bold uppercase tracking-wide border border-[#E86A24]/40 text-[#E86A24] bg-[#E86A24]/10">
              {isGerente ? 'Gerente' : isCaptador ? 'Captador' : isAdmin ? 'Admin' : role || '—'}
            </span>
          </div>
          <p className="text-stone-600 dark:text-stone-400 mt-1">
            {isCaptador ? 'Seus leads atribuídos' : 'Gerenciamento de leads capturados'}
          </p>
        </div>
        {canManage && (
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
        )}
      </div>

      {/* Relatório: atribuídos + vendas (escopo por cargo) */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Card: leads atribuídos */}
        <div className="rounded-2xl border border-sky-500/25 bg-gradient-to-br from-sky-50 to-white dark:from-sky-950/40 dark:to-[#241e19] overflow-hidden">
          <div className="p-5 sm:p-6 flex flex-wrap items-center gap-5">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-sky-500/15 text-sky-700 dark:text-sky-300">
              <UserCheck className="w-6 h-6" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-sky-700/80 dark:text-sky-300/80">
                Leads atribuídos
              </p>
              <p className="text-3xl font-bold text-stone-900 dark:text-stone-50 tabular-nums">
                {sales.total_leads}
              </p>
              <p className="text-sm text-stone-600 dark:text-stone-400 mt-0.5">
                {formatPeriodLabel(fPeriod, fDate)}
                {' · '}
                {isCaptador
                  ? 'Leads com você como captador'
                  : isGerente
                    ? 'Captadores da sua equipe'
                    : 'Todos os captadores do tenant'}
              </p>
            </div>
            {!isCaptador && (
              <div className="flex gap-6 text-sm">
                <div>
                  <p className="text-xs text-stone-500 dark:text-stone-400">
                    {isGerente ? 'Aguardando captador' : 'Não atribuídos'}
                  </p>
                  <p className="text-lg font-bold text-amber-700 dark:text-amber-300 tabular-nums">
                    {sales.total_nao_atribuidos}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-stone-500 dark:text-stone-400">Captadores c/ lead</p>
                  <p className="text-lg font-bold text-stone-800 dark:text-stone-100 tabular-nums">
                    {assignedWithLeads.length}
                  </p>
                </div>
              </div>
            )}
            {!isCaptador && assignedWithLeads.length > 0 && (
              <button
                type="button"
                onClick={() => setShowAssignedBreakdown((v) => !v)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border border-sky-500/35 text-sky-800 dark:text-sky-300 hover:bg-sky-500/10 transition-colors"
              >
                {showAssignedBreakdown ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                Por captador ({assignedWithLeads.length})
              </button>
            )}
          </div>
          {!isCaptador && showAssignedBreakdown && assignedRowsVisible.length > 0 && (
            <div className="border-t border-sky-500/20">
              <div className="px-4 py-2 flex flex-wrap items-center justify-between gap-2 bg-sky-500/5 text-xs text-stone-500 dark:text-stone-400">
                <span>
                  Ordenado por leads · {assignedWithLeads.length} com lead
                  {assignedWithoutLeads.length > 0 ? ` · ${assignedWithoutLeads.length} sem lead` : ''}
                </span>
                {assignedWithoutLeads.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowZeroAssignedCaptadores((v) => !v)}
                    className="font-semibold text-sky-700 dark:text-sky-300 hover:underline"
                  >
                    {showZeroAssignedCaptadores ? 'Ocultar sem lead' : 'Mostrar sem lead'}
                  </button>
                )}
              </div>
              <div className="overflow-x-auto max-h-[28rem] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10">
                    <tr className="text-left text-[11px] uppercase tracking-wide text-stone-500 dark:text-stone-400 bg-sky-50 dark:bg-sky-950/60">
                      <th className="px-4 py-2.5 font-semibold w-10">#</th>
                      <th className="px-4 py-2.5 font-semibold">Captador</th>
                      <th className="px-4 py-2.5 font-semibold text-right">Atribuídos</th>
                      <th className="px-4 py-2.5 font-semibold text-right">Vendas</th>
                      <th className="px-4 py-2.5 font-semibold text-right">Taxa</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-sky-500/10">
                    {assignedRowsVisible.map((c, idx) => (
                      <tr
                        key={c.id}
                        className={`hover:bg-sky-500/5 ${c.total_leads > 0 ? '' : 'opacity-50'}`}
                      >
                        <td className="px-4 py-2.5 tabular-nums text-stone-400 text-xs">{idx + 1}</td>
                        <td className="px-4 py-2.5 font-semibold text-stone-900 dark:text-stone-50">{c.name}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-bold text-sky-700 dark:text-sky-300">
                          {c.total_leads}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-stone-700 dark:text-stone-300">
                          {c.vendas_fechadas}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-bold text-stone-800 dark:text-stone-100">
                          {c.taxa_vendas}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Card: vendas fechadas */}
        <div className="rounded-2xl border border-emerald-500/25 bg-gradient-to-br from-emerald-50 to-white dark:from-emerald-950/40 dark:to-[#241e19] overflow-hidden">
          <div className="p-5 sm:p-6 flex flex-wrap items-center gap-5">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
              <Trophy className="w-6 h-6" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700/80 dark:text-emerald-300/80">
                Vendas fechadas
              </p>
              <p className="text-3xl font-bold text-stone-900 dark:text-stone-50 tabular-nums">
                {sales.total_vendas}
              </p>
              <p className="text-sm text-stone-600 dark:text-stone-400 mt-0.5">
                {formatPeriodLabel(fPeriod, fDate)}
                {' · '}
                {isCaptador
                  ? 'Mesma contagem do seu kanban (Convertido ou venda fechada)'
                  : 'Paridade com o kanban — Convertido ou venda fechada por captador'}
              </p>
            </div>
            <div className="flex gap-6 text-sm">
              <div>
                <p className="text-xs text-stone-500 dark:text-stone-400">Base (atribuídos)</p>
                <p className="text-lg font-bold text-stone-800 dark:text-stone-100 tabular-nums">{sales.total_leads}</p>
              </div>
              <div>
                <p className="text-xs text-stone-500 dark:text-stone-400">Taxa</p>
                <p className="text-lg font-bold text-emerald-700 dark:text-emerald-300 tabular-nums">{sales.taxa}%</p>
              </div>
            </div>
            {!isCaptador && salesWithVendas.length > 0 && (
              <button
                type="button"
                onClick={() => setShowSalesBreakdown((v) => !v)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border border-emerald-500/35 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-500/10 transition-colors"
              >
                {showSalesBreakdown ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                Por captador ({salesWithVendas.length})
              </button>
            )}
          </div>
          {!isCaptador && showSalesBreakdown && salesRowsVisible.length > 0 && (
            <div className="border-t border-emerald-500/20">
              <div className="px-4 py-2 flex flex-wrap items-center justify-between gap-2 bg-emerald-500/5 text-xs text-stone-500 dark:text-stone-400">
                <span>
                  Ordenado por vendas · {salesWithVendas.length} com venda
                  {salesWithoutVendas.length > 0 ? ` · ${salesWithoutVendas.length} sem venda` : ''}
                </span>
                {salesWithoutVendas.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowZeroSalesCaptadores((v) => !v)}
                    className="font-semibold text-emerald-700 dark:text-emerald-300 hover:underline"
                  >
                    {showZeroSalesCaptadores ? 'Ocultar sem vendas' : 'Mostrar sem vendas'}
                  </button>
                )}
              </div>
              <div className="overflow-x-auto max-h-[28rem] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10">
                    <tr className="text-left text-[11px] uppercase tracking-wide text-stone-500 dark:text-stone-400 bg-emerald-50 dark:bg-emerald-950/60">
                      <th className="px-4 py-2.5 font-semibold w-10">#</th>
                      <th className="px-4 py-2.5 font-semibold">Captador</th>
                      <th className="px-4 py-2.5 font-semibold text-right">Leads</th>
                      <th className="px-4 py-2.5 font-semibold text-right">Vendas</th>
                      <th className="px-4 py-2.5 font-semibold text-right">Taxa</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-emerald-500/10">
                    {salesRowsVisible.map((c, idx) => (
                      <tr
                        key={c.id}
                        className={`hover:bg-emerald-500/5 ${c.vendas_fechadas > 0 ? '' : 'opacity-50'}`}
                      >
                        <td className="px-4 py-2.5 tabular-nums text-stone-400 text-xs">{idx + 1}</td>
                        <td className="px-4 py-2.5 font-semibold text-stone-900 dark:text-stone-50">{c.name}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-stone-700 dark:text-stone-300">{c.total_leads}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-bold text-emerald-700 dark:text-emerald-300">
                          {c.vendas_fechadas}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-bold text-stone-800 dark:text-stone-100">{c.taxa_vendas}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Filtros */}
      <div className={`${surfaceClass} p-4 sm:p-5 space-y-4`}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
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
            <label className="block text-xs font-medium text-stone-600 dark:text-stone-400 mb-1.5">Coluna CRM</label>
            <select value={fColumn} onChange={(e) => setFColumn(e.target.value)} className={`${inputClass} min-h-[44px]`}>
              <option value="">Todas</option>
              {!isCaptador && (
                <option value={UNASSIGNED_COLUMN_FILTER}>
                  {isGerente ? 'Aguardando captador' : 'Não atribuídos'}
                </option>
              )}
              {columns.map((c) => (
                <option key={c.id} value={c.key}>{c.title}</option>
              ))}
            </select>
          </div>
          {!isGerente && !isCaptador && (
          <div>
            <label className="block text-xs font-medium text-stone-600 dark:text-stone-400 mb-1.5">Gerente</label>
            <select value={fGerente} onChange={(e) => setFGerente(e.target.value)} className={inputClass}>
              <option value="">Todos</option>
              {gerentes.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
          )}
          {!isCaptador && (
          <div>
            <label className="block text-xs font-medium text-stone-600 dark:text-stone-400 mb-1.5">Captador</label>
            <select value={fCaptador} onChange={(e) => setFCaptador(e.target.value)} className={inputClass}>
              <option value="">Todos</option>
              {(isGerente ? teamCaptadores : captadores).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          )}
          <div>
            <label className="block text-xs font-medium text-stone-600 dark:text-stone-400 mb-1.5">Período</label>
            <select
              value={fPeriod}
              onChange={(e) => {
                const next = e.target.value;
                setFPeriod(next);
                if (next === 'hoje') setFDate(localTodayYmd());
                if (next === 'dia' && !fDate) setFDate(localTodayYmd());
              }}
              className={inputClass}
            >
              <option value="hoje">Hoje</option>
              <option value="dia">Dia específico</option>
              <option value="7d">Últimos 7 dias</option>
              <option value="30d">Últimos 30 dias</option>
              <option value="todos">Todos</option>
            </select>
          </div>
          {(fPeriod === 'hoje' || fPeriod === 'dia') && (
            <div>
              <label className="block text-xs font-medium text-stone-600 dark:text-stone-400 mb-1.5">Dia</label>
              <input
                type="date"
                value={fDate}
                max={localTodayYmd()}
                onChange={(e) => {
                  const v = e.target.value || localTodayYmd();
                  setFDate(v);
                  setFPeriod(v === localTodayYmd() ? 'hoje' : 'dia');
                }}
                className={inputClass}
              />
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-stone-600 dark:text-stone-400 mb-1.5">TAG</label>
            <select value={fTag} onChange={(e) => setFTag(e.target.value)} className={inputClass}>
              <option value="">Todas</option>
              <option value="ads">ADS</option>
              <option value="disparo">Disparo</option>
              <option value="campanha">Campanha</option>
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
              {canManage && (
              <button
                type="button"
                onClick={() => {
                  setAssignLeads(selectedLeadObjs);
                  setAssignForm({
                    gerente_id: isGerente ? userId : (selectedLeadObjs[0]?.gerente_id || ''),
                    captador_id: '',
                  });
                }}
                className="inline-flex items-center gap-2 px-6 py-3 min-h-[48px] rounded-xl text-base font-bold bg-[#E86A24] text-white hover:bg-[#D95E1B] shadow-sm"
              >
                <UserPlus className="w-5 h-5" /> {isGerente ? 'Atribuir captador' : 'Atribuir'}
              </button>
              )}
              {canEditColumn && selectedLeadObjs.some((l) => l.captador_id) && (
                <select
                  value={bulkColumnKey}
                  disabled={busy || columns.length === 0}
                  onChange={(e) => {
                    const key = e.target.value;
                    setBulkColumnKey(key);
                    if (key) void applyBulkColumn(key);
                  }}
                  className="min-h-[44px] min-w-[12rem] px-3 py-2 rounded-xl text-sm font-bold border border-sky-500/40 text-sky-700 dark:text-sky-300 bg-white dark:bg-[#2a221c]"
                  title="Trocar coluna dos selecionados"
                >
                  <option value="">Trocar coluna…</option>
                  {columns.map((c) => (
                    <option key={c.id} value={c.key}>{c.title}</option>
                  ))}
                </select>
              )}
              {!isGerente && !isCaptador && (
              <button
                type="button"
                onClick={() => setDeleteLeads(selectedLeadObjs)}
                className="inline-flex items-center gap-2 px-4 py-2.5 min-h-[44px] rounded-xl text-sm font-bold border border-red-500/50 text-red-600 dark:text-red-400 hover:bg-red-500/10"
              >
                <Trash2 className="w-4 h-4" /> Excluir
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
      <div className={`${surfaceClass}`}>
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
                <th className="px-4 py-3.5">Coluna CRM</th>
                <th className="px-4 py-3.5">TAG</th>
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
                  <td colSpan={9}>
                    <EmptyState
                      icon={<UserPlus className="w-7 h-7" />}
                      title="Nenhum lead encontrado"
                      description={isCaptador ? 'Ainda não há leads atribuídos a você.' : 'Use Cadastrar ou Importar para subir sua base.'}
                      action={
                        canManage ? (
                          <Button size="sm" onClick={() => setShowCreate(true)} icon={<UserPlus className="w-4 h-4" />}>
                            Cadastrar
                          </Button>
                        ) : undefined
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
                    <td className="px-4 py-3 min-w-[16rem] align-top">
                      {l.captador_id ? (
                        <CrmColumnSelect
                          lead={l}
                          columns={columns}
                          disabled={false}
                          onNeedColumns={fetchKanbanColumns}
                          onChange={(key) => {
                            if (busy) {
                              showToast('Aguarde a operação atual terminar.', 'error');
                              return;
                            }
                            changeColumn(l, key);
                          }}
                        />
                      ) : isGerente && canManage ? (
                        <span
                          className="inline-flex w-full min-w-[15rem] px-3.5 py-3 min-h-[48px] items-center rounded-xl text-sm font-bold border border-dashed border-amber-500/45 text-amber-800 dark:text-amber-200 bg-amber-500/10"
                          title="Lead no pool do gerente — use Atribuir captador"
                        >
                          {l.gerente_id ? 'Aguardando captador' : 'Não atribuído'}
                        </span>
                      ) : (
                        <span
                          className={`inline-flex px-3.5 py-3 min-h-[48px] items-center rounded-xl text-sm font-medium border border-dashed ${
                            l.gerente_id
                              ? 'border-amber-500/40 text-amber-800 dark:text-amber-200 bg-amber-500/10'
                              : 'border-stone-300 dark:border-white/15 text-stone-500'
                          }`}
                          title={
                            l.gerente_id
                              ? 'Já delegado ao gerente no chat — falta captador'
                              : 'Sem gerente e sem captador'
                          }
                        >
                          {l.gerente_id ? 'Aguardando captador' : 'Não atribuído'}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {l.acquisition_tag ? (
                        <span
                          className={`inline-flex px-2.5 py-1 rounded-lg text-[11px] font-bold uppercase tracking-wide border ${
                            l.acquisition_tag === 'ads'
                              ? 'border-sky-500/40 text-sky-800 dark:text-sky-200 bg-sky-500/10'
                              : l.acquisition_tag === 'disparo'
                                ? 'border-violet-500/40 text-violet-800 dark:text-violet-200 bg-violet-500/10'
                                : 'border-emerald-500/40 text-emerald-800 dark:text-emerald-200 bg-emerald-500/10'
                          }`}
                        >
                          {ACQUISITION_TAG_LABELS[l.acquisition_tag as AcquisitionTag] || l.acquisition_tag}
                        </span>
                      ) : (
                        <span className="text-stone-400">—</span>
                      )}
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
                    <td className="px-4 py-3 font-medium text-stone-800 dark:text-stone-200 tabular-nums">{l.phone || '—'}</td>
                    <td className="px-4 py-3">
                      {l.gerente_name ? (
                        <span className={badgeGerente}>{l.gerente_name}</span>
                      ) : canManage ? (
                        <button
                          type="button"
                          onClick={() => {
                            setAssignLeads([l]);
                            setAssignForm({
                              gerente_id: isGerente ? userId : '',
                              captador_id: '',
                            });
                          }}
                          className="inline-flex items-center gap-2 px-5 py-3 min-h-[48px] rounded-xl text-base font-bold bg-[#E86A24] text-white hover:bg-[#D95E1B] shadow-sm"
                        >
                          <UserPlus className="w-5 h-5" /> Atribuir
                        </button>
                      ) : (
                        <span className="text-stone-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {l.captador_name ? (
                        <span className={badgeCaptador}>{l.captador_name}</span>
                      ) : isGerente && canManage ? (
                        <button
                          type="button"
                          onClick={() => {
                            setAssignLeads([l]);
                            setAssignForm({ gerente_id: userId, captador_id: '' });
                          }}
                          className="inline-flex items-center gap-2 px-5 py-3 min-h-[48px] rounded-xl text-base font-bold border-2 border-[#E86A24] text-[#E86A24] hover:bg-[#E86A24]/10"
                        >
                          <UserPlus className="w-5 h-5" /> Atribuir captador
                        </button>
                      ) : (
                        <span className="text-stone-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-stone-600 dark:text-stone-300 whitespace-nowrap">{formatDateTime(l.created_at)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        {l.phone && (
                          <a
                            href={`https://wa.me/${l.phone.startsWith('55') ? l.phone : `55${l.phone}`}`}
                            target="_blank"
                            rel="noreferrer"
                            className="p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10"
                            title="Abrir WhatsApp"
                          >
                            <MessageCircle className="w-5 h-5" />
                          </a>
                        )}
                        {canManage && !isGerente && !!l.gerente_id && (
                        <button
                          type="button"
                          onClick={() => {
                            setAssignLeads([l]);
                            setAssignForm({
                              gerente_id: l.gerente_id || '',
                              captador_id: '',
                            });
                          }}
                          className="inline-flex items-center gap-2 px-5 py-3 min-h-[48px] rounded-xl text-base font-bold text-white bg-[#E86A24] hover:bg-[#D95E1B] shadow-sm"
                          title="Reatribuir gerente/captador"
                        >
                          <UserPlus className="w-5 h-5" />
                          <span className="hidden sm:inline">Atribuir</span>
                        </button>
                        )}
                        <button
                          type="button"
                          onClick={() => { setViewLead(l); setEditingLeadInfo(false); }}
                          className="p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl text-stone-500 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-white/5"
                          title="Ver detalhes"
                        >
                          <Eye className="w-5 h-5" />
                        </button>
                        {!isGerente && !isCaptador && (
                        <button
                          type="button"
                          onClick={() => setDeleteLeads([l])}
                          className="p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl text-red-500 hover:bg-red-500/10"
                          title="Excluir"
                        >
                          <Trash2 className="w-5 h-5" />
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
                    Sem captador: se só houver gerente, aparece como Aguardando captador; sem gerente fica Não atribuído. O kanban (Novo lead) só após atribuir o captador.
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
              <select
                value={assignForm.gerente_id}
                onChange={(e) => setAssignForm({ gerente_id: e.target.value, captador_id: '' })}
                className={`${inputClass} min-h-[48px] text-base`}
                required
              >
                <option value="">Selecione o gerente...</option>
                {gerentes.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
              <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">Somente o gerente vincula o lead a um captador.</p>
            </div>
            )}
            {isGerente && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Captador</label>
              <select
                value={assignForm.captador_id}
                onChange={(e) => setAssignForm({ ...assignForm, captador_id: e.target.value })}
                className={`${inputClass} min-h-[48px] text-base`}
                required
              >
                <option value="">Selecione o captador...</option>
                {captadoresForGerente.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                O lead entra no kanban (Novo lead) só após atribuir o captador. Com gerente e sem captador fica como Aguardando captador (não como Não atribuído).
              </p>
            </div>
            )}
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setAssignLeads(null)} className="px-5 py-3 min-h-[48px] rounded-xl border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-white/5 text-base">Cancelar</button>
              <button type="submit" disabled={busy} className="px-7 py-3 min-h-[48px] rounded-xl bg-[#E86A24] text-white text-base font-bold hover:bg-[#D95E1B] disabled:opacity-60 flex items-center gap-2">
                {busy && <Loader2 className="w-5 h-5 animate-spin" />} Atribuir
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
              ['Coluna CRM', viewLead.column_title || viewLead.column_key || '—'],
              ['Gerente', viewLead.gerente_name || '—'],
              ['Captador', viewLead.captador_name || '—'],
              [
                'TAG',
                viewLead.acquisition_tag
                  ? ACQUISITION_TAG_LABELS[viewLead.acquisition_tag as AcquisitionTag] || viewLead.acquisition_tag
                  : '—',
              ],
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
