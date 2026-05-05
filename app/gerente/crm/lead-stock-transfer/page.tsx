'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from '@/components/WhitelabelLink';
import Layout from '@/components/Layout';
import { useRequireAuth } from '@/utils/useRequireAuth';
import { useToast } from '@/hooks/useToast';
import ToastContainer from '@/components/Toast/ToastContainer';
import {
  Package,
  Loader2,
  CheckSquare,
  ArrowLeft,
  RefreshCw,
  Clock,
  Users,
  Search,
  AlertTriangle,
  DollarSign,
  Inbox,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Layers,
  UserCheck,
  Calendar,
  History,
  ArrowRightLeft,
  ArrowDownToLine,
  XCircle,
  CheckCircle2,
} from 'lucide-react';

type Banca = { id: string; name?: string | null; url?: string | null };

type StockPackage = {
  transfer_log_id: string;
  banca_id: string;
  created_at: string;
  transfer_type: 'TF' | 'TF1' | 'TF2' | 'TF3' | string;
  deadline_days: number;
  performed_by_user_id: string | null;
  performed_by_name: string | null;
  total_leads: number;
  pending_leads: number;
  distributed_leads: number;
  canceled_leads: number;
  /** Preenchido quando admin visualiza vários gerentes ou filtro explícito */
  stock_gerente_user_id?: string | null;
  gerente_name?: string | null;
};

type StockLead = {
  lead_id: string;
  transfer_log_id: string;
  banca_id: string;
  original_source_consultant_email: string | null;
  stock_status: 'em_estoque' | 'repassado' | 'cancelado';
  received_at: string;
  deadline_days: number;
  transfer_type: string;
  lead_name: string | null;
  lead_phone: string | null;
  saldo_snapshot: number | null;
  last_interaction_snapshot: string | null;
  total_depositado_snapshot: number | null;
  total_apostado_snapshot: number | null;
};

type Consultor = { id: string; email: string; full_name: string | null };

type HistoryItem = {
  id: string;
  created_at: string | null;
  kind: 'reserved' | 'distributed';
  transfer_kind: 'admin_to_gerente_stock' | 'gerente_stock_to_consultant';
  transfer_type: string;
  deadline_days: number;
  performed_by_user_id: string | null;
  performed_by_name: string | null;
  source_consultant_email: string | null;
  source_consultant_name: string | null;
  target_consultant_email: string | null;
  target_consultant_name: string | null;
  count: number;
  total_balance: number;
  stock_total: number;
  stock_pending: number;
  stock_distributed: number;
  stock_canceled: number;
  status_label: 'em_estoque' | 'repassado' | 'cancelado_total' | 'cancelado_parcial' | 'distribuido';
  stock_gerente_user_id?: string | null;
  stock_gerente_name?: string | null;
};

type HistoryTotals = {
  received: number;
  distributed: number;
  received_leads: number;
  distributed_leads: number;
};

type LeadSortField =
  | 'lead_id'
  | 'lead_name'
  | 'saldo_snapshot'
  | 'total_depositado_snapshot'
  | 'total_apostado_snapshot'
  | 'original_source_consultant_email'
  | 'last_interaction_snapshot';
type PackageSortField = 'created_at' | 'transfer_type' | 'deadline_days' | 'pending_leads' | 'distributed_leads' | 'performed_by_name';
type HistorySortField = 'created_at' | 'kind' | 'transfer_type' | 'count' | 'total_balance' | 'target_consultant_name';
type SortDir = 'asc' | 'desc';
type ActiveTab = 'packages' | 'history';
type HistoryFilter = 'all' | 'reserved' | 'distributed' | 'canceled';

type BalanceFilterMode = 'all' | 'with_balance' | 'without_balance' | 'range';
/** Igual à transferência de leads: depositado e apostado */
type DepositFilterMode = 'all' | 'with_value' | 'without_value' | 'range';
type ApostaFilterMode = 'all' | 'with_bet' | 'without_bet' | 'range';

function authHeaders(userId: string | null) {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (userId) h['X-User-Id'] = userId;
  return h;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return String(iso);
  }
}

function formatDateShort(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
  } catch {
    return String(iso);
  }
}

function formatMoney(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return `R$ ${Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function daysLeft(receivedAtIso: string, deadlineDays: number): { expired: boolean; days: number; ratio: number } {
  try {
    const received = new Date(receivedAtIso).getTime();
    const end = received + deadlineDays * 86_400_000;
    const diffMs = end - Date.now();
    const days = Math.ceil(diffMs / 86_400_000);
    const totalMs = Math.max(deadlineDays * 86_400_000, 1);
    const ratio = Math.max(0, Math.min(1, diffMs / totalMs));
    return { expired: diffMs <= 0, days, ratio };
  } catch {
    return { expired: false, days: deadlineDays, ratio: 1 };
  }
}

/** Parse valor digitado em campo de saldo (aceita vírgula ou ponto). */
function parseMoneyInput(v: string): number | null {
  const t = v.trim().replace(/\./g, '').replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function leadBalanceValue(l: StockLead): number {
  if (l.saldo_snapshot == null) return 0;
  const n = Number(l.saldo_snapshot);
  return Number.isFinite(n) ? n : 0;
}

function leadDepositValue(l: StockLead): number {
  if (l.total_depositado_snapshot == null) return 0;
  const n = Number(l.total_depositado_snapshot);
  return Number.isFinite(n) ? n : 0;
}

function leadApostaValue(l: StockLead): number {
  if (l.total_apostado_snapshot == null) return 0;
  const n = Number(l.total_apostado_snapshot);
  return Number.isFinite(n) ? n : 0;
}

function compareValues(a: unknown, b: unknown): number {
  const av = a == null ? '' : a;
  const bv = b == null ? '' : b;
  if (typeof av === 'number' && typeof bv === 'number') return av - bv;
  return String(av).localeCompare(String(bv), 'pt-BR', { numeric: true, sensitivity: 'base' });
}

function SortIcon({ dir }: { dir: SortDir | null }) {
  if (dir === 'asc') return <ArrowUp className="w-3 h-3 opacity-80" />;
  if (dir === 'desc') return <ArrowDown className="w-3 h-3 opacity-80" />;
  return <ArrowUpDown className="w-3 h-3 opacity-40" />;
}

export default function GerenteLeadStockTransferPage() {
  const { checking, userId, userStatus } = useRequireAuth();
  const { showToast, toasts, removeToast } = useToast();

  const [bancas, setBancas] = useState<Banca[]>([]);
  const [bancaId, setBancaId] = useState('');
  const [loadingPackages, setLoadingPackages] = useState(false);
  const [packages, setPackages] = useState<StockPackage[]>([]);
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);

  const [loadingLeads, setLoadingLeads] = useState(false);
  const [leads, setLeads] = useState<StockLead[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [consultores, setConsultores] = useState<Consultor[]>([]);
  const [targetEmail, setTargetEmail] = useState('');
  const [transferring, setTransferring] = useState(false);

  const [pkgSearch, setPkgSearch] = useState('');
  const [pkgSort, setPkgSort] = useState<{ field: PackageSortField; dir: SortDir }>({ field: 'created_at', dir: 'desc' });

  const [leadSearch, setLeadSearch] = useState('');
  const [leadSort, setLeadSort] = useState<{ field: LeadSortField; dir: SortDir }>({ field: 'saldo_snapshot', dir: 'desc' });
  const [balanceFilter, setBalanceFilter] = useState<BalanceFilterMode>('all');
  const [saldoMinStr, setSaldoMinStr] = useState('');
  const [saldoMaxStr, setSaldoMaxStr] = useState('');
  const [depositFilter, setDepositFilter] = useState<DepositFilterMode>('all');
  const [depositMinStr, setDepositMinStr] = useState('');
  const [depositMaxStr, setDepositMaxStr] = useState('');
  const [apostaFilter, setApostaFilter] = useState<ApostaFilterMode>('all');
  const [apostaMinStr, setApostaMinStr] = useState('');
  const [apostaMaxStr, setApostaMaxStr] = useState('');
  const [bulkFirstNInput, setBulkFirstNInput] = useState('');

  const [activeTab, setActiveTab] = useState<ActiveTab>('packages');
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyTotals, setHistoryTotals] = useState<HistoryTotals>({ received: 0, distributed: 0, received_leads: 0, distributed_leads: 0 });
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historySearch, setHistorySearch] = useState('');
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>('all');
  const [historySort, setHistorySort] = useState<{ field: HistorySortField; dir: SortDir }>({ field: 'created_at', dir: 'desc' });

  const isAdminStockViewer = userStatus === 'admin' || userStatus === 'super_admin';
  const [adminGerenteFilter, setAdminGerenteFilter] = useState('');
  const [adminGerentes, setAdminGerentes] = useState<{ id: string; email: string; full_name: string | null }[]>([]);

  const loadBancas = useCallback(async () => {
    if (!userId) return;
    const res = await fetch('/api/crm/bancas', { headers: authHeaders(userId) });
    const json = await res.json();
    if (res.ok && json.success && Array.isArray(json.data)) {
      setBancas(json.data);
      if (!bancaId && json.data[0]?.id) setBancaId(json.data[0].id);
    }
  }, [userId, bancaId]);

  const loadPackages = useCallback(async () => {
    if (!userId || !bancaId) {
      setPackages([]);
      return;
    }
    setLoadingPackages(true);
    try {
      const extra = isAdminStockViewer && adminGerenteFilter.trim()
        ? `&gerente_user_id=${encodeURIComponent(adminGerenteFilter.trim())}`
        : '';
      const res = await fetch(
        `/api/gerente/crm/lead-stock/packages?banca_id=${encodeURIComponent(bancaId)}${extra}`,
        { headers: authHeaders(userId) }
      );
      const json = await res.json();
      if (res.ok && json.success && Array.isArray(json.data?.packages)) {
        setPackages(json.data.packages as StockPackage[]);
      } else {
        setPackages([]);
        if (json?.error) showToast(json.error, 'error');
      }
    } catch {
      setPackages([]);
      showToast('Erro ao carregar pacotes de estoque', 'error');
    } finally {
      setLoadingPackages(false);
    }
  }, [userId, bancaId, showToast, isAdminStockViewer, adminGerenteFilter]);

  const loadPackageLeads = useCallback(async () => {
    if (!userId || !bancaId || !selectedLogId) {
      setLeads([]);
      return;
    }
    let gerenteForPackage = '';
    if (isAdminStockViewer) {
      const pkg = packages.find((p) => p.transfer_log_id === selectedLogId);
      gerenteForPackage = (pkg?.stock_gerente_user_id ?? '').trim();
      if (!gerenteForPackage && adminGerenteFilter.trim()) {
        gerenteForPackage = adminGerenteFilter.trim();
      }
      if (!gerenteForPackage) {
        setLeads([]);
        return;
      }
    }
    setLoadingLeads(true);
    try {
      const gidQs =
        isAdminStockViewer && gerenteForPackage
          ? `&gerente_user_id=${encodeURIComponent(gerenteForPackage)}`
          : '';
      const res = await fetch(
        `/api/gerente/crm/lead-stock/package-leads?banca_id=${encodeURIComponent(bancaId)}&transfer_log_id=${encodeURIComponent(selectedLogId)}&status=em_estoque${gidQs}`,
        { headers: authHeaders(userId) }
      );
      const json = await res.json();
      if (res.ok && json.success && Array.isArray(json.data?.leads)) {
        setLeads(json.data.leads as StockLead[]);
      } else {
        setLeads([]);
        if (json?.error) showToast(json.error, 'error');
      }
    } catch {
      setLeads([]);
      showToast('Erro ao carregar leads do pacote', 'error');
    } finally {
      setLoadingLeads(false);
    }
  }, [userId, bancaId, selectedLogId, showToast, isAdminStockViewer, packages, adminGerenteFilter]);

  const loadHistory = useCallback(async () => {
    if (!userId || !bancaId) {
      setHistory([]);
      setHistoryTotals({ received: 0, distributed: 0, received_leads: 0, distributed_leads: 0 });
      return;
    }
    setLoadingHistory(true);
    try {
      const extra =
        isAdminStockViewer && adminGerenteFilter.trim()
          ? `&gerente_user_id=${encodeURIComponent(adminGerenteFilter.trim())}`
          : '';
      const res = await fetch(
        `/api/gerente/crm/lead-stock/history?banca_id=${encodeURIComponent(bancaId)}${extra}`,
        { headers: authHeaders(userId) }
      );
      const json = await res.json();
      if (res.ok && json.success && Array.isArray(json.data?.items)) {
        setHistory(json.data.items as HistoryItem[]);
        setHistoryTotals(
          (json.data?.totals as HistoryTotals) ?? { received: 0, distributed: 0, received_leads: 0, distributed_leads: 0 }
        );
      } else {
        setHistory([]);
        setHistoryTotals({ received: 0, distributed: 0, received_leads: 0, distributed_leads: 0 });
        if (json?.error) showToast(json.error, 'error');
      }
    } catch {
      setHistory([]);
      showToast('Erro ao carregar histórico do estoque.', 'error');
    } finally {
      setLoadingHistory(false);
    }
  }, [userId, bancaId, showToast, isAdminStockViewer, adminGerenteFilter]);

  useEffect(() => {
    if (!userId || !bancaId || !isAdminStockViewer) {
      setAdminGerentes([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/admin/crm/gerentes-for-banca?banca_id=${encodeURIComponent(bancaId)}`, {
        headers: authHeaders(userId),
      });
      const json = await res.json();
      if (cancelled) return;
      if (res.ok && json.success && Array.isArray(json.data)) {
        setAdminGerentes(
          json.data.map((row: { id?: string; email?: string; full_name?: string | null }) => ({
            id: String(row.id ?? ''),
            email: String(row.email ?? ''),
            full_name: row.full_name ?? null,
          }))
        );
      } else {
        setAdminGerentes([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, bancaId, isAdminStockViewer]);

  const loadConsultores = useCallback(async () => {
    if (!userId || !bancaId || isAdminStockViewer) {
      setConsultores([]);
      return;
    }
    const res = await fetch(`/api/gerente/consultores?banca_id=${encodeURIComponent(bancaId)}`, {
      headers: authHeaders(userId),
    });
    const json = await res.json();
    if (res.ok && json.success && Array.isArray(json.data)) {
      const list = json.data
        .map((row: { email?: string; full_name?: string | null; id?: string }) => ({
          id: row.id ?? '',
          email: (row.email ?? '').trim(),
          full_name: row.full_name ?? null,
        }))
        .filter((c: Consultor) => c.email);
      setConsultores(list);
    } else {
      setConsultores([]);
    }
  }, [userId, bancaId, isAdminStockViewer]);

  useEffect(() => {
    if (!checking && userId) void loadBancas();
  }, [checking, userId, loadBancas]);

  useEffect(() => {
    void loadPackages();
    setSelectedLogId(null);
    setLeads([]);
    setSelected(new Set());
    setTargetEmail('');
    setPkgSearch('');
    setLeadSearch('');
    setBalanceFilter('all');
    setSaldoMinStr('');
    setSaldoMaxStr('');
    setDepositFilter('all');
    setDepositMinStr('');
    setDepositMaxStr('');
    setApostaFilter('all');
    setApostaMinStr('');
    setApostaMaxStr('');
    setBulkFirstNInput('');
    setAdminGerenteFilter('');
  }, [bancaId, loadPackages]);

  useEffect(() => {
    void loadConsultores();
  }, [loadConsultores]);

  useEffect(() => {
    void loadPackageLeads();
    setSelected(new Set());
    setLeadSearch('');
    setBalanceFilter('all');
    setSaldoMinStr('');
    setSaldoMaxStr('');
    setDepositFilter('all');
    setDepositMinStr('');
    setDepositMaxStr('');
    setApostaFilter('all');
    setApostaMinStr('');
    setApostaMaxStr('');
    setBulkFirstNInput('');
  }, [selectedLogId, loadPackageLeads]);

  useEffect(() => {
    if (activeTab === 'history') void loadHistory();
  }, [activeTab, loadHistory]);

  const currentPackage = useMemo(
    () => packages.find((p) => p.transfer_log_id === selectedLogId) ?? null,
    [packages, selectedLogId]
  );

  /** KPIs globais dos pacotes */
  const kpis = useMemo(() => {
    const total = packages.length;
    const pending = packages.reduce((acc, p) => acc + p.pending_leads, 0);
    const distributed = packages.reduce((acc, p) => acc + p.distributed_leads, 0);
    const expiring = packages.filter((p) => {
      const dl = daysLeft(p.created_at, p.deadline_days);
      return p.pending_leads > 0 && !dl.expired && dl.days <= 3;
    }).length;
    const expired = packages.filter((p) => {
      const dl = daysLeft(p.created_at, p.deadline_days);
      return p.pending_leads > 0 && dl.expired;
    }).length;
    return { total, pending, distributed, expiring, expired };
  }, [packages]);

  /** Pacotes filtrados e ordenados */
  const packagesView = useMemo(() => {
    const term = pkgSearch.trim().toLowerCase();
    const filtered = packages.filter((p) => {
      if (!term) return true;
      return (
        (p.performed_by_name ?? '').toLowerCase().includes(term) ||
        (p.gerente_name ?? '').toLowerCase().includes(term) ||
        p.transfer_type.toLowerCase().includes(term) ||
        String(p.deadline_days).includes(term)
      );
    });
    const { field, dir } = pkgSort;
    const sign = dir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => sign * compareValues(a[field], b[field]));
  }, [packages, pkgSearch, pkgSort]);

  /** Leads filtrados (busca + saldo), ordenados — base para tabela e seleção em massa */
  const leadsView = useMemo(() => {
    const term = leadSearch.trim().toLowerCase();
    let filtered = leads.filter((l) => {
      if (!term) return true;
      return (
        String(l.lead_id).toLowerCase().includes(term) ||
        (l.lead_name ?? '').toLowerCase().includes(term) ||
        (l.original_source_consultant_email ?? '').toLowerCase().includes(term)
      );
    });

    filtered = filtered.filter((l) => {
      const balance = leadBalanceValue(l);
      if (balanceFilter === 'with_balance') return balance > 0;
      if (balanceFilter === 'without_balance') return balance <= 0;
      if (balanceFilter === 'range') {
        const mn = parseMoneyInput(saldoMinStr);
        const mx = parseMoneyInput(saldoMaxStr);
        if (mn != null && balance < mn) return false;
        if (mx != null && balance > mx) return false;
        return true;
      }
      return true;
    });

    filtered = filtered.filter((l) => {
      if (depositFilter === 'all') return true;
      const v = leadDepositValue(l);
      if (depositFilter === 'with_value') return v > 0;
      if (depositFilter === 'without_value') return v <= 0;
      if (depositFilter === 'range') {
        const mn = parseMoneyInput(depositMinStr);
        const mx = parseMoneyInput(depositMaxStr);
        if (mn != null && v < mn) return false;
        if (mx != null && v > mx) return false;
        return true;
      }
      return true;
    });

    filtered = filtered.filter((l) => {
      if (apostaFilter === 'all') return true;
      const ap = leadApostaValue(l);
      if (apostaFilter === 'with_bet') return ap > 0;
      if (apostaFilter === 'without_bet') return ap <= 0;
      if (apostaFilter === 'range') {
        const mn = parseMoneyInput(apostaMinStr);
        const mx = parseMoneyInput(apostaMaxStr);
        if (mn != null && ap < mn) return false;
        if (mx != null && ap > mx) return false;
        return true;
      }
      return true;
    });

    const { field, dir } = leadSort;
    const sign = dir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => sign * compareValues(a[field], b[field]));
  }, [
    leads,
    leadSearch,
    leadSort,
    balanceFilter,
    saldoMinStr,
    saldoMaxStr,
    depositFilter,
    depositMinStr,
    depositMaxStr,
    apostaFilter,
    apostaMinStr,
    apostaMaxStr,
  ]);

  /** Totais da lista filtrada (útil com muitos leads) */
  const filteredListStats = useMemo(() => {
    let selectedInFiltered = 0;
    for (const l of leadsView) {
      if (selected.has(l.lead_id)) selectedInFiltered++;
    }
    const sumSaldo = leadsView.reduce((acc, l) => acc + leadBalanceValue(l), 0);
    return {
      visible: leadsView.length,
      selectedInFiltered,
      sumSaldo,
    };
  }, [leadsView, selected]);

  const selectedSummary = useMemo(() => {
    const rows = leads.filter((l) => selected.has(l.lead_id));
    const totalSaldo = rows.reduce((acc, l) => acc + (Number(l.saldo_snapshot) || 0), 0);
    const origens = new Set(rows.map((l) => (l.original_source_consultant_email ?? '').toLowerCase()).filter(Boolean));
    return { count: rows.length, totalSaldo, origens: origens.size };
  }, [leads, selected]);

  /** Histórico filtrado e ordenado */
  const historyView = useMemo(() => {
    const term = historySearch.trim().toLowerCase();
    const filtered = history.filter((h) => {
      if (historyFilter === 'reserved' && h.kind !== 'reserved') return false;
      if (historyFilter === 'distributed' && h.kind !== 'distributed') return false;
      if (historyFilter === 'canceled' && h.status_label !== 'cancelado_total' && h.status_label !== 'cancelado_parcial') return false;
      if (!term) return true;
      return (
        (h.target_consultant_name ?? '').toLowerCase().includes(term) ||
        (h.target_consultant_email ?? '').toLowerCase().includes(term) ||
        (h.source_consultant_name ?? '').toLowerCase().includes(term) ||
        (h.source_consultant_email ?? '').toLowerCase().includes(term) ||
        (h.performed_by_name ?? '').toLowerCase().includes(term) ||
        (h.stock_gerente_name ?? '').toLowerCase().includes(term) ||
        (h.stock_gerente_user_id ?? '').toLowerCase().includes(term) ||
        h.transfer_type.toLowerCase().includes(term)
      );
    });
    const { field, dir } = historySort;
    const sign = dir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const va = field === 'created_at' ? (a.created_at ? new Date(a.created_at).getTime() : 0) : a[field];
      const vb = field === 'created_at' ? (b.created_at ? new Date(b.created_at).getTime() : 0) : b[field];
      return sign * compareValues(va, vb);
    });
  }, [history, historySearch, historyFilter, historySort]);

  const toggleHistorySort = (field: HistorySortField) => {
    setHistorySort((prev) =>
      prev.field === field ? { field, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { field, dir: 'desc' }
    );
  };

  const togglePkgSort = (field: PackageSortField) => {
    setPkgSort((prev) =>
      prev.field === field ? { field, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { field, dir: 'desc' }
    );
  };

  const toggleLeadSort = (field: LeadSortField) => {
    setLeadSort((prev) =>
      prev.field === field ? { field, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { field, dir: 'desc' }
    );
  };

  const toggle = (id: string) => {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const toggleAllVisible = () => {
    const visibleIds = leadsView.map((l) => l.lead_id);
    const allSelected = visibleIds.every((id) => selected.has(id));
    setSelected((prev) => {
      const n = new Set(prev);
      if (allSelected) visibleIds.forEach((id) => n.delete(id));
      else visibleIds.forEach((id) => n.add(id));
      return n;
    });
  };

  const clearSelection = () => setSelected(new Set());

  /** Seleciona exatamente os N primeiros da lista filtrada e ordenada (ideal para lotes grandes). */
  const selectFirstNInView = (n: number) => {
    const cap = Math.max(0, Math.min(Math.floor(Number(n)) || 0, leadsView.length));
    setSelected(new Set(leadsView.slice(0, cap).map((l) => l.lead_id)));
  };

  const applyBulkFirstN = () => {
    const raw = bulkFirstNInput.trim();
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 1) {
      showToast('Digite quantos leads marcar (ex.: 100).', 'error');
      return;
    }
    selectFirstNInView(n);
  };

  const invertSelectionInView = () => {
    setSelected((prev) => {
      const n = new Set(prev);
      for (const l of leadsView) {
        if (n.has(l.lead_id)) n.delete(l.lead_id);
        else n.add(l.lead_id);
      }
      return n;
    });
  };

  const doTransfer = async () => {
    if (!userId || !bancaId || !targetEmail.trim() || selected.size === 0) {
      showToast('Selecione leads e o consultor destino.', 'error');
      return;
    }
    setTransferring(true);
    try {
      const leadIds = Array.from(selected);
      const res = await fetch('/api/gerente/crm/redistribute-leads', {
        method: 'POST',
        headers: authHeaders(userId),
        body: JSON.stringify({
          banca_id: bancaId,
          target_consultant_email: targetEmail.trim(),
          leads_ids: leadIds,
        }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        showToast(json?.message ?? `${json?.data?.count ?? selected.size} lead(s) repassado(s).`, 'success');
        setSelected(new Set());
        await Promise.all([loadPackageLeads(), loadPackages()]);
      } else {
        showToast(json?.error ?? 'Erro no repasse.', 'error');
      }
    } catch {
      showToast('Erro no repasse.', 'error');
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

  const consultorSelecionado = consultores.find((c) => c.email === targetEmail) ?? null;

  /** Visão agregada (todos os gerentes): mostra coluna Gerente nas tabelas */
  const showGerenteColumnMerged = isAdminStockViewer && !adminGerenteFilter.trim();

  return (
    <Layout>
      <ToastContainer toasts={toasts} onClose={removeToast} />
      <div className="w-full px-4 sm:px-6 lg:px-8 py-6 space-y-5">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <span className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-[#8CD955]/15 text-[#6B8E3F] border border-[#8CD955]/30">
                <Package className="w-5 h-5" />
              </span>
              Estoque de leads
            </h1>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 max-w-3xl">
              {isAdminStockViewer
                ? 'Visão da banca: pacotes reservados ao estoque dos gerentes. O repasse para consultores continua sendo feito pelo gerente no CRM; aqui é possível auditar e abrir os leads.'
                : 'Pacotes reservados pelo admin no seu estoque. Os leads só se movem no CRM quando você distribuir a um consultor da sua equipe.'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href={isAdminStockViewer ? '/admin' : '/gerente'}
              className="text-sm text-[#8CD955] hover:underline whitespace-nowrap"
            >
              ← {isAdminStockViewer ? 'Painel admin' : 'Gestão de consultores'}
            </Link>
            <button
              type="button"
              onClick={() => {
                if (activeTab === 'history') void loadHistory();
                else void loadPackages();
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-[#404040] text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-[#333] transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingPackages || loadingHistory ? 'animate-spin' : ''}`} />
              Atualizar
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 border-b border-gray-200 dark:border-[#404040]">
          <TabButton
            active={activeTab === 'packages'}
            onClick={() => setActiveTab('packages')}
            icon={<Package className="w-4 h-4" />}
            label="Pacotes do estoque"
          />
          <TabButton
            active={activeTab === 'history'}
            onClick={() => setActiveTab('history')}
            icon={<History className="w-4 h-4" />}
            label="Histórico"
          />
        </div>

        {/* Banca + KPIs */}
        <div className="grid grid-cols-1 xl:grid-cols-[340px_minmax(0,1fr)] gap-4">
          <div className="bg-white dark:bg-[#2a2a2a] rounded-xl border border-gray-200 dark:border-[#404040] p-4">
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1.5">Banca</label>
            <select
              value={bancaId}
              onChange={(e) => setBancaId(e.target.value)}
              className="w-full border border-gray-300 dark:border-[#555] dark:bg-[#333] dark:text-white rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-[#8CD955]/40 focus:border-[#8CD955] outline-none"
            >
              <option value="">Selecione</option>
              {bancas.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name || b.url || b.id}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-2">
              Cada banca tem seu estoque separado. Troque aqui para ver outro estoque.
            </p>

            {isAdminStockViewer && (
              <>
                <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1.5 mt-4">
                  Gerente
                </label>
                <select
                  value={adminGerenteFilter}
                  onChange={(e) => setAdminGerenteFilter(e.target.value)}
                  className="w-full border border-gray-300 dark:border-[#555] dark:bg-[#333] dark:text-white rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-[#8CD955]/40 focus:border-[#8CD955] outline-none"
                >
                  <option value="">Todos os gerentes</option>
                  {adminGerentes.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.full_name || g.email || g.id}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-2">
                  {adminGerenteFilter
                    ? 'Exibindo apenas pacotes e histórico deste gerente.'
                    : 'Exibindo estoque agregado de todos os gerentes desta banca.'}
                </p>
              </>
            )}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {activeTab === 'packages' ? (
              <>
                <KpiCard icon={<Layers className="w-4 h-4" />} label="Pacotes" value={kpis.total} tone="neutral" />
                <KpiCard icon={<Inbox className="w-4 h-4" />} label="Leads no estoque" value={kpis.pending} tone="brand" />
                <KpiCard icon={<UserCheck className="w-4 h-4" />} label="Já distribuídos" value={kpis.distributed} tone="success" />
                <KpiCard icon={<Clock className="w-4 h-4" />} label="Expiram em ≤3d" value={kpis.expiring} tone="amber" />
                <KpiCard icon={<AlertTriangle className="w-4 h-4" />} label="Expirados" value={kpis.expired} tone="danger" />
              </>
            ) : (
              <>
                <KpiCard icon={<ArrowDownToLine className="w-4 h-4" />} label="Reservas recebidas" value={historyTotals.received} tone="neutral" />
                <KpiCard icon={<Inbox className="w-4 h-4" />} label="Leads recebidos" value={historyTotals.received_leads} tone="brand" />
                <KpiCard icon={<ArrowRightLeft className="w-4 h-4" />} label="Repasses feitos" value={historyTotals.distributed} tone="success" />
                <KpiCard icon={<UserCheck className="w-4 h-4" />} label="Leads repassados" value={historyTotals.distributed_leads} tone="success" />
                <KpiCard icon={<History className="w-4 h-4" />} label="Total no histórico" value={history.length} tone="amber" />
              </>
            )}
          </div>
        </div>

        {/* Conteúdo principal */}
        {activeTab === 'history' ? (
          <HistoryView
            items={historyView}
            totalCount={history.length}
            loading={loadingHistory}
            search={historySearch}
            onSearchChange={setHistorySearch}
            filter={historyFilter}
            onFilterChange={setHistoryFilter}
            sort={historySort}
            onToggleSort={toggleHistorySort}
            showGerenteColumn={showGerenteColumnMerged}
          />
        ) : !selectedLogId ? (
          <PackagesList
            packagesView={packagesView}
            loading={loadingPackages}
            search={pkgSearch}
            onSearchChange={setPkgSearch}
            sort={pkgSort}
            onToggleSort={togglePkgSort}
            onOpen={(id) => setSelectedLogId(id)}
            showGerenteColumn={showGerenteColumnMerged}
            viewerMode={isAdminStockViewer ? 'admin' : 'gerente'}
          />
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-4">
            {/* Coluna esquerda: leads do pacote */}
            <div className="space-y-3 min-w-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedLogId(null)}
                  className="inline-flex items-center gap-1 text-sm text-[#8CD955] hover:underline"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Voltar aos pacotes
                </button>
                {currentPackage && (
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-md font-semibold bg-[#8CD955]/15 text-[#6B8E3F] border border-[#8CD955]/40">
                      {currentPackage.transfer_type}
                    </span>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-medium bg-gray-100 dark:bg-[#333] text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-[#444]">
                      <Clock className="w-3 h-3" />
                      {currentPackage.deadline_days} dia(s)
                    </span>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-medium bg-gray-100 dark:bg-[#333] text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-[#444]">
                      <Calendar className="w-3 h-3" />
                      {formatDate(currentPackage.created_at)}
                    </span>
                    {currentPackage.performed_by_name && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-medium bg-gray-100 dark:bg-[#333] text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-[#444]">
                        por {currentPackage.performed_by_name}
                      </span>
                    )}
                  </div>
                )}
              </div>

              <div className="bg-white dark:bg-[#2a2a2a] rounded-xl border border-gray-200 dark:border-[#404040] overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100 dark:border-[#404040] space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-col gap-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-gray-800 dark:text-white whitespace-nowrap">
                          Leads no pacote
                        </span>
                        <span className="text-xs text-gray-500 dark:text-gray-400 tabular-nums">
                          lista: {filteredListStats.visible} / {leads.length}
                          {' · '}
                          <span className="inline-flex items-center gap-1">
                            <DollarSign className="w-3 h-3" />
                            saldo na lista {formatMoney(filteredListStats.sumSaldo)}
                          </span>
                          {!isAdminStockViewer ? (
                            <>
                              {' · '}
                              selecionados nesta lista: {filteredListStats.selectedInFiltered}
                              {selected.size > filteredListStats.selectedInFiltered ? (
                                <span className="text-amber-600 dark:text-amber-400">
                                  {' '}(total marcado {selected.size}, inclui fora do filtro)
                                </span>
                              ) : null}
                            </>
                          ) : (
                            <>
                              {' · '}
                              <span className="text-gray-400">somente leitura (repasse pelo gerente)</span>
                            </>
                          )}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-1 sm:flex-none sm:min-w-[260px] max-w-md w-full">
                      <div className="relative flex-1">
                        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input
                          value={leadSearch}
                          onChange={(e) => setLeadSearch(e.target.value)}
                          placeholder="Buscar por ID, nome ou origem"
                          className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-[#444] dark:bg-[#333] dark:text-white focus:ring-2 focus:ring-[#8CD955]/40 focus:border-[#8CD955] outline-none"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-end gap-3">
                    <div className="flex flex-col gap-1">
                      <label className="text-[11px] font-semibold text-gray-600 dark:text-gray-400">Saldo (filtro)</label>
                      <select
                        value={balanceFilter}
                        onChange={(e) => setBalanceFilter(e.target.value as BalanceFilterMode)}
                        className="min-w-[160px] border border-gray-200 dark:border-[#444] dark:bg-[#333] dark:text-white rounded-lg px-2 py-2 text-xs"
                      >
                        <option value="all">Todos</option>
                        <option value="with_balance">Com saldo</option>
                        <option value="without_balance">Sem saldo</option>
                        <option value="range">Faixa (min–máx)</option>
                      </select>
                    </div>
                    {balanceFilter === 'range' && (
                      <>
                        <div className="flex flex-col gap-1">
                          <label className="text-[11px] font-semibold text-gray-600 dark:text-gray-400">Mín. R$</label>
                          <input
                            value={saldoMinStr}
                            onChange={(e) => setSaldoMinStr(e.target.value)}
                            placeholder="0"
                            inputMode="decimal"
                            className="w-[100px] border border-gray-200 dark:border-[#444] dark:bg-[#333] dark:text-white rounded-lg px-2 py-2 text-xs"
                          />
                        </div>
                        <div className="flex flex-col gap-1">
                          <label className="text-[11px] font-semibold text-gray-600 dark:text-gray-400">Máx. R$</label>
                          <input
                            value={saldoMaxStr}
                            onChange={(e) => setSaldoMaxStr(e.target.value)}
                            placeholder="∞"
                            inputMode="decimal"
                            className="w-[100px] border border-gray-200 dark:border-[#444] dark:bg-[#333] dark:text-white rounded-lg px-2 py-2 text-xs"
                          />
                        </div>
                      </>
                    )}
                    <div className="flex flex-col gap-1">
                      <label className="text-[11px] font-semibold text-gray-600 dark:text-gray-400">Total depositado</label>
                      <select
                        value={depositFilter}
                        onChange={(e) => setDepositFilter(e.target.value as DepositFilterMode)}
                        className="min-w-[160px] border border-gray-200 dark:border-[#444] dark:bg-[#333] dark:text-white rounded-lg px-2 py-2 text-xs"
                      >
                        <option value="all">Todos</option>
                        <option value="with_value">Com valor</option>
                        <option value="without_value">Sem valor</option>
                        <option value="range">Faixa (min–máx)</option>
                      </select>
                    </div>
                    {depositFilter === 'range' && (
                      <>
                        <div className="flex flex-col gap-1">
                          <label className="text-[11px] font-semibold text-gray-600 dark:text-gray-400">Dep. mín. R$</label>
                          <input
                            value={depositMinStr}
                            onChange={(e) => setDepositMinStr(e.target.value)}
                            placeholder="0"
                            inputMode="decimal"
                            className="w-[100px] border border-gray-200 dark:border-[#444] dark:bg-[#333] dark:text-white rounded-lg px-2 py-2 text-xs"
                          />
                        </div>
                        <div className="flex flex-col gap-1">
                          <label className="text-[11px] font-semibold text-gray-600 dark:text-gray-400">Dep. máx. R$</label>
                          <input
                            value={depositMaxStr}
                            onChange={(e) => setDepositMaxStr(e.target.value)}
                            placeholder="∞"
                            inputMode="decimal"
                            className="w-[100px] border border-gray-200 dark:border-[#444] dark:bg-[#333] dark:text-white rounded-lg px-2 py-2 text-xs"
                          />
                        </div>
                      </>
                    )}
                    <div className="flex flex-col gap-1">
                      <label className="text-[11px] font-semibold text-gray-600 dark:text-gray-400">Total apostado</label>
                      <select
                        value={apostaFilter}
                        onChange={(e) => setApostaFilter(e.target.value as ApostaFilterMode)}
                        className="min-w-[160px] border border-gray-200 dark:border-[#444] dark:bg-[#333] dark:text-white rounded-lg px-2 py-2 text-xs"
                      >
                        <option value="all">Todos</option>
                        <option value="with_bet">Com valor</option>
                        <option value="without_bet">Sem valor</option>
                        <option value="range">Faixa (min–máx)</option>
                      </select>
                    </div>
                    {apostaFilter === 'range' && (
                      <>
                        <div className="flex flex-col gap-1">
                          <label className="text-[11px] font-semibold text-gray-600 dark:text-gray-400">Ap. mín. R$</label>
                          <input
                            value={apostaMinStr}
                            onChange={(e) => setApostaMinStr(e.target.value)}
                            placeholder="0"
                            inputMode="decimal"
                            className="w-[100px] border border-gray-200 dark:border-[#444] dark:bg-[#333] dark:text-white rounded-lg px-2 py-2 text-xs"
                          />
                        </div>
                        <div className="flex flex-col gap-1">
                          <label className="text-[11px] font-semibold text-gray-600 dark:text-gray-400">Ap. máx. R$</label>
                          <input
                            value={apostaMaxStr}
                            onChange={(e) => setApostaMaxStr(e.target.value)}
                            placeholder="∞"
                            inputMode="decimal"
                            className="w-[100px] border border-gray-200 dark:border-[#444] dark:bg-[#333] dark:text-white rounded-lg px-2 py-2 text-xs"
                          />
                        </div>
                      </>
                    )}
                    {!isAdminStockViewer && (
                      <div className="flex flex-wrap gap-2 items-center ml-auto">
                        <span className="text-[11px] font-semibold text-gray-600 dark:text-gray-400 whitespace-nowrap">Seleção rápida</span>
                        {[50, 100, 250, 500].map((n) => (
                          <button
                            key={n}
                            type="button"
                            disabled={loadingLeads || leadsView.length === 0}
                            onClick={() => selectFirstNInView(n)}
                            className="px-2 py-1.5 rounded-lg text-[11px] font-semibold border border-gray-200 dark:border-[#444] bg-gray-50 dark:bg-[#333] hover:bg-[#8CD955]/15 hover:border-[#8CD955]/40 disabled:opacity-40 text-gray-700 dark:text-gray-200"
                          >
                            Primeiros {n}
                          </button>
                        ))}
                        <button
                          type="button"
                          disabled={loadingLeads || leadsView.length === 0}
                          onClick={() => selectFirstNInView(leadsView.length)}
                          className="px-2 py-1.5 rounded-lg text-[11px] font-semibold bg-[#8CD955]/15 border border-[#8CD955]/40 text-[#6B8E3F] hover:bg-[#8CD955]/25 disabled:opacity-40"
                        >
                          Todos filtrados ({leadsView.length})
                        </button>
                        <button
                          type="button"
                          disabled={loadingLeads || leadsView.length === 0}
                          onClick={invertSelectionInView}
                          className="px-2 py-1.5 rounded-lg text-[11px] font-semibold border border-gray-200 dark:border-[#444] hover:bg-gray-50 dark:hover:bg-[#333] disabled:opacity-40"
                        >
                          Inverter na lista
                        </button>
                        <button
                          type="button"
                          disabled={selected.size === 0}
                          onClick={clearSelection}
                          className="px-2 py-1.5 rounded-lg text-[11px] font-semibold text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900/50 hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-40"
                        >
                          Limpar tudo
                        </button>
                      </div>
                    )}
                  </div>

                  {!isAdminStockViewer && (
                    <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-gray-100 dark:border-[#404040]">
                      <span className="text-[11px] text-gray-500 dark:text-gray-400">Marcar quantidade exata:</span>
                      <input
                        type="number"
                        min={1}
                        value={bulkFirstNInput}
                        onChange={(e) => setBulkFirstNInput(e.target.value)}
                        placeholder="Ex.: 300"
                        className="w-24 border border-gray-200 dark:border-[#444] dark:bg-[#333] dark:text-white rounded-lg px-2 py-1.5 text-xs"
                      />
                      <button
                        type="button"
                        disabled={loadingLeads || leadsView.length === 0}
                        onClick={applyBulkFirstN}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#8CD955] text-white hover:bg-[#7BC84A] disabled:opacity-40"
                      >
                        Aplicar ordem atual
                      </button>
                      <span className="text-[11px] text-gray-400">
                        Usa a ordenação da tabela (ex.: saldo decrescente) para marcar os primeiros N da lista já filtrada.
                      </span>
                    </div>
                  )}
                </div>

                {loadingLeads ? (
                  <div className="p-10 flex justify-center">
                    <Loader2 className="w-6 h-6 animate-spin text-[#8CD955]" />
                  </div>
                ) : leadsView.length === 0 ? (
                  <div className="p-10 text-center">
                    <Inbox className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {leads.length === 0
                        ? 'Nenhum lead em estoque neste pacote.'
                        : 'Nenhum lead corresponde à busca ou aos filtros (saldo, depósito, aposta). Ajuste os filtros acima.'}
                    </p>
                  </div>
                ) : (
                  <div className="overflow-auto max-h-[calc(100vh-360px)] min-h-[320px]">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-gray-50 dark:bg-[#333] z-10 shadow-sm">
                        <tr>
                          {!isAdminStockViewer && (
                            <th className="px-3 py-2.5 w-10">
                              <input
                                type="checkbox"
                                checked={leadsView.length > 0 && leadsView.every((l) => selected.has(l.lead_id))}
                                onChange={toggleAllVisible}
                                className="rounded border-gray-300"
                              />
                            </th>
                          )}
                          <ThSort label="ID" field="lead_id" current={leadSort} onToggle={toggleLeadSort} />
                          <ThSort label="Nome" field="lead_name" current={leadSort} onToggle={toggleLeadSort} />
                          <ThSort label="Saldo" field="saldo_snapshot" current={leadSort} onToggle={toggleLeadSort} align="right" />
                          <ThSort
                            label="Depositado"
                            field="total_depositado_snapshot"
                            current={leadSort}
                            onToggle={toggleLeadSort}
                            align="right"
                          />
                          <ThSort label="Apostado" field="total_apostado_snapshot" current={leadSort} onToggle={toggleLeadSort} align="right" />
                          <ThSort label="Origem real no CRM" field="original_source_consultant_email" current={leadSort} onToggle={toggleLeadSort} />
                          <ThSort label="Última interação" field="last_interaction_snapshot" current={leadSort} onToggle={toggleLeadSort} />
                        </tr>
                      </thead>
                      <tbody>
                        {leadsView.map((l) => {
                          const checked = selected.has(l.lead_id);
                          return (
                            <tr
                              key={l.lead_id}
                              onClick={isAdminStockViewer ? undefined : () => toggle(l.lead_id)}
                              className={`border-t border-gray-100 dark:border-[#404040] transition-colors ${
                                isAdminStockViewer
                                  ? 'hover:bg-gray-50 dark:hover:bg-[#333]'
                                  : `cursor-pointer ${checked ? 'bg-[#8CD955]/10 dark:bg-[#8CD955]/15' : 'hover:bg-gray-50 dark:hover:bg-[#333]'}`
                              }`}
                            >
                              {!isAdminStockViewer && (
                                <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => toggle(l.lead_id)}
                                    className="rounded border-gray-300"
                                  />
                                </td>
                              )}
                              <td className="px-3 py-2 font-mono text-xs text-gray-600 dark:text-gray-300">{l.lead_id}</td>
                              <td className="px-3 py-2 text-gray-800 dark:text-gray-100">{l.lead_name ?? '—'}</td>
                              <td className="px-3 py-2 text-right tabular-nums font-medium text-gray-800 dark:text-gray-100">
                                {formatMoney(l.saldo_snapshot)}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums text-gray-700 dark:text-gray-200">
                                {formatMoney(l.total_depositado_snapshot)}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums text-gray-700 dark:text-gray-200">
                                {formatMoney(l.total_apostado_snapshot)}
                              </td>
                              <td className="px-3 py-2 text-xs text-gray-600 dark:text-gray-400 truncate max-w-[220px]" title={l.original_source_consultant_email ?? undefined}>
                                {l.original_source_consultant_email ?? '—'}
                              </td>
                              <td className="px-3 py-2 text-xs text-gray-600 dark:text-gray-400 whitespace-nowrap">
                                {formatDate(l.last_interaction_snapshot)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            {/* Coluna direita: painel de distribuição (sticky) */}
            <aside className="xl:sticky xl:top-4 self-start space-y-3">
              <div className="bg-white dark:bg-[#2a2a2a] rounded-xl border border-gray-200 dark:border-[#404040] overflow-hidden">
                <div className="px-4 py-3 bg-[#8CD955]/10 dark:bg-[#8CD955]/15 border-b border-[#8CD955]/30">
                  <h2 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                    <Users className="w-4 h-4 text-[#6B8E3F]" />
                    {isAdminStockViewer ? 'Repasse no CRM (gerente)' : 'Distribuir para consultor'}
                  </h2>
                  <p className="text-[11px] text-gray-600 dark:text-gray-300 mt-0.5">
                    {isAdminStockViewer
                      ? 'Administradores visualizam e auditam o estoque. O repasse real (CRM) é feito pelo gerente responsável pelo pacote.'
                      : 'O repasse chama o CRM com a origem real de cada lead.'}
                  </p>
                </div>

                {isAdminStockViewer ? (
                  <div className="p-4 space-y-3">
                    <div className="rounded-lg border border-blue-200 dark:border-blue-900/40 bg-blue-50/80 dark:bg-blue-950/25 p-3 text-xs text-blue-900 dark:text-blue-100">
                      Use esta tela para conferir leads e histórico. Para distribuir leads a consultores, o gerente deve abrir o mesmo pacote na conta dele.
                    </div>
                    {currentPackage?.gerente_name ? (
                      <p className="text-[11px] text-gray-600 dark:text-gray-400">
                        Pacote no estoque de:{' '}
                        <span className="font-semibold text-gray-800 dark:text-gray-200">{currentPackage.gerente_name}</span>
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <div className="p-4 space-y-4">
                    <div>
                      <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1.5">
                        Consultor destino
                      </label>
                      <select
                        value={targetEmail}
                        onChange={(e) => setTargetEmail(e.target.value)}
                        className="w-full border border-gray-300 dark:border-[#555] dark:bg-[#333] dark:text-white rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-[#8CD955]/40 focus:border-[#8CD955] outline-none"
                      >
                        <option value="">Selecione um consultor</option>
                        {consultores.map((c) => (
                          <option key={c.id} value={c.email}>
                            {c.full_name || c.email}
                          </option>
                        ))}
                      </select>
                      {consultorSelecionado && (
                        <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1.5 truncate" title={consultorSelecionado.email}>
                          {consultorSelecionado.email}
                        </p>
                      )}
                    </div>

                    <div className="rounded-lg border border-gray-200 dark:border-[#404040] p-3 bg-gray-50 dark:bg-[#333]/40">
                      <p className="text-xs font-semibold text-gray-700 dark:text-gray-200 mb-2">Resumo da seleção</p>
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <MiniStat label="Leads" value={selectedSummary.count} icon={<Inbox className="w-3 h-3" />} />
                        <MiniStat label="Origens" value={selectedSummary.origens} icon={<Users className="w-3 h-3" />} />
                        <MiniStat
                          label="Saldo total"
                          valueText={formatMoney(selectedSummary.totalSaldo)}
                          icon={<DollarSign className="w-3 h-3" />}
                        />
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => void doTransfer()}
                      disabled={transferring || selected.size === 0 || !targetEmail}
                      className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-[#8CD955] text-white font-semibold hover:bg-[#7BC84A] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {transferring ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckSquare className="w-4 h-4" />}
                      Transferir {selected.size > 0 ? `(${selected.size})` : ''}
                    </button>

                    {selected.size === 0 && (
                      <p className="text-[11px] text-gray-500 dark:text-gray-400 text-center">
                        Selecione leads na tabela ao lado para habilitar o envio.
                      </p>
                    )}
                  </div>
                )}
              </div>

              {currentPackage && (
                <div className="bg-white dark:bg-[#2a2a2a] rounded-xl border border-gray-200 dark:border-[#404040] p-4 text-xs space-y-2">
                  <h3 className="text-sm font-semibold text-gray-800 dark:text-white mb-1">Progresso do pacote</h3>
                  <ProgressBar
                    pending={currentPackage.pending_leads}
                    distributed={currentPackage.distributed_leads}
                    canceled={currentPackage.canceled_leads}
                  />
                  <div className="grid grid-cols-3 gap-2 pt-1">
                    <LegendDot color="#8CD955" label="Em estoque" value={currentPackage.pending_leads} />
                    <LegendDot color="#10b981" label="Distribuídos" value={currentPackage.distributed_leads} />
                    <LegendDot color="#ef4444" label="Cancelados" value={currentPackage.canceled_leads} />
                  </div>
                </div>
              )}
            </aside>
          </div>
        )}
      </div>

      {/* Barra de ação sticky quando houver seleção (mobile) */}
      {selectedLogId && selected.size > 0 && !isAdminStockViewer && (
        <div className="xl:hidden fixed bottom-0 left-0 right-0 z-40 bg-white dark:bg-[#2a2a2a] border-t border-gray-200 dark:border-[#404040] p-3 shadow-lg">
          <div className="max-w-5xl mx-auto flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900 dark:text-white">
                {selected.size} lead(s) selecionado(s)
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                Saldo total {formatMoney(selectedSummary.totalSaldo)} · {selectedSummary.origens} origem(ns)
              </p>
            </div>
            <button
              type="button"
              onClick={() => void doTransfer()}
              disabled={transferring || !targetEmail}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#8CD955] text-white font-semibold hover:bg-[#7BC84A] disabled:opacity-50"
            >
              {transferring ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckSquare className="w-4 h-4" />}
              Transferir
            </button>
          </div>
        </div>
      )}
    </Layout>
  );
}

/* =============================================================
 * Componentes auxiliares (escopo local)
 * ============================================================= */

function KpiCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: 'neutral' | 'brand' | 'success' | 'amber' | 'danger';
}) {
  const toneMap: Record<string, string> = {
    neutral: 'text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-[#333] border-gray-200 dark:border-[#444]',
    brand: 'text-[#6B8E3F] bg-[#8CD955]/15 border-[#8CD955]/40',
    success: 'text-emerald-700 dark:text-emerald-300 bg-emerald-500/15 border-emerald-500/30',
    amber: 'text-amber-700 dark:text-amber-300 bg-amber-500/15 border-amber-500/30',
    danger: 'text-red-700 dark:text-red-300 bg-red-500/15 border-red-500/30',
  };
  return (
    <div className="bg-white dark:bg-[#2a2a2a] rounded-xl border border-gray-200 dark:border-[#404040] p-3">
      <div className="flex items-center gap-2 mb-1.5">
        <span className={`inline-flex items-center justify-center w-7 h-7 rounded-lg border ${toneMap[tone]}`}>
          {icon}
        </span>
        <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          {label}
        </span>
      </div>
      <p className="text-2xl font-bold text-gray-900 dark:text-white tabular-nums">{value}</p>
    </div>
  );
}

function ThSort({
  label,
  field,
  current,
  onToggle,
  align = 'left',
}: {
  label: string;
  field: LeadSortField;
  current: { field: LeadSortField; dir: SortDir };
  onToggle: (field: LeadSortField) => void;
  align?: 'left' | 'right';
}) {
  const active = current.field === field;
  return (
    <th className={`px-3 py-2.5 text-${align} text-xs font-semibold text-gray-600 dark:text-gray-400`}>
      <button
        type="button"
        onClick={() => onToggle(field)}
        className={`inline-flex items-center gap-1 hover:text-gray-900 dark:hover:text-white ${
          align === 'right' ? 'flex-row-reverse' : ''
        } ${active ? 'text-gray-900 dark:text-white' : ''}`}
      >
        {label}
        <SortIcon dir={active ? current.dir : null} />
      </button>
    </th>
  );
}

function ThSortPkg({
  label,
  field,
  current,
  onToggle,
  align = 'left',
}: {
  label: string;
  field: PackageSortField;
  current: { field: PackageSortField; dir: SortDir };
  onToggle: (field: PackageSortField) => void;
  align?: 'left' | 'right';
}) {
  const active = current.field === field;
  return (
    <th className={`px-3 py-2.5 text-${align} text-xs font-semibold text-gray-600 dark:text-gray-400`}>
      <button
        type="button"
        onClick={() => onToggle(field)}
        className={`inline-flex items-center gap-1 hover:text-gray-900 dark:hover:text-white ${
          align === 'right' ? 'flex-row-reverse' : ''
        } ${active ? 'text-gray-900 dark:text-white' : ''}`}
      >
        {label}
        <SortIcon dir={active ? current.dir : null} />
      </button>
    </th>
  );
}

function MiniStat({
  label,
  value,
  valueText,
  icon,
}: {
  label: string;
  value?: number;
  valueText?: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="bg-white dark:bg-[#2a2a2a] rounded-md border border-gray-200 dark:border-[#404040] py-2 px-1">
      <div className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400 flex items-center justify-center gap-1">
        {icon}
        {label}
      </div>
      <div className="text-sm font-bold text-gray-900 dark:text-white tabular-nums truncate">
        {valueText ?? value ?? 0}
      </div>
    </div>
  );
}

function LegendDot({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
      <span className="text-[11px] text-gray-600 dark:text-gray-300 truncate">{label}</span>
      <span className="ml-auto text-[11px] font-semibold text-gray-900 dark:text-white tabular-nums">{value}</span>
    </div>
  );
}

function ProgressBar({ pending, distributed, canceled }: { pending: number; distributed: number; canceled: number }) {
  const total = Math.max(pending + distributed + canceled, 1);
  const toPct = (n: number) => `${(n / total) * 100}%`;
  return (
    <div className="w-full h-2.5 rounded-full bg-gray-100 dark:bg-[#333] overflow-hidden flex">
      <span className="h-full bg-[#8CD955]" style={{ width: toPct(pending) }} />
      <span className="h-full bg-emerald-500" style={{ width: toPct(distributed) }} />
      <span className="h-full bg-red-500" style={{ width: toPct(canceled) }} />
    </div>
  );
}

function PackagesList({
  packagesView,
  loading,
  search,
  onSearchChange,
  sort,
  onToggleSort,
  onOpen,
  showGerenteColumn,
  viewerMode,
}: {
  packagesView: StockPackage[];
  loading: boolean;
  search: string;
  onSearchChange: (v: string) => void;
  sort: { field: PackageSortField; dir: SortDir };
  onToggleSort: (field: PackageSortField) => void;
  onOpen: (id: string) => void;
  showGerenteColumn?: boolean;
  viewerMode?: 'gerente' | 'admin';
}) {
  return (
    <div className="bg-white dark:bg-[#2a2a2a] rounded-xl border border-gray-200 dark:border-[#404040] overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 dark:border-[#404040] flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-800 dark:text-white">Pacotes reservados pelo admin</span>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {packagesView.length} pacote(s)
          </span>
        </div>
        <div className="relative w-full sm:w-[320px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={
              showGerenteColumn ? 'Buscar por TF, prazo, gerente, responsável...' : 'Buscar por TF, prazo, responsável...'
            }
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-[#444] dark:bg-[#333] dark:text-white focus:ring-2 focus:ring-[#8CD955]/40 focus:border-[#8CD955] outline-none"
          />
        </div>
      </div>

      {loading ? (
        <div className="p-10 flex justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-[#8CD955]" />
        </div>
      ) : packagesView.length === 0 ? (
        <div className="p-10 text-center">
          <Package className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {viewerMode === 'admin'
              ? 'Nenhum pacote nesta visão. Ajuste o filtro de gerente ou a banca.'
              : 'Nenhum pacote encontrado. Quando o admin reservar leads ao seu estoque nesta banca, eles aparecem aqui.'}
          </p>
        </div>
      ) : (
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-[#333]">
              <tr>
                <ThSortPkg label="Data de reserva" field="created_at" current={sort} onToggle={onToggleSort} />
                <ThSortPkg label="Tipo (TF)" field="transfer_type" current={sort} onToggle={onToggleSort} />
                <ThSortPkg label="Prazo" field="deadline_days" current={sort} onToggle={onToggleSort} />
                <ThSortPkg label="Em estoque" field="pending_leads" current={sort} onToggle={onToggleSort} align="right" />
                <ThSortPkg label="Distribuídos" field="distributed_leads" current={sort} onToggle={onToggleSort} align="right" />
                {showGerenteColumn && (
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 dark:text-gray-400">Gerente</th>
                )}
                <ThSortPkg label="Reservado por" field="performed_by_name" current={sort} onToggle={onToggleSort} />
                <th className="px-3 py-2.5 text-right text-xs font-semibold text-gray-600 dark:text-gray-400">Ações</th>
              </tr>
            </thead>
            <tbody>
              {packagesView.map((p) => {
                const dl = daysLeft(p.created_at, p.deadline_days);
                const deadlineClass = dl.expired
                  ? 'text-red-600 dark:text-red-400'
                  : dl.days <= 3
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-gray-700 dark:text-gray-200';
                return (
                  <tr
                    key={p.transfer_log_id}
                    className="border-t border-gray-100 dark:border-[#404040] hover:bg-gray-50 dark:hover:bg-[#333] transition-colors"
                  >
                    <td className="px-3 py-2.5 text-gray-700 dark:text-gray-200 whitespace-nowrap">
                      <div>{formatDateShort(p.created_at)}</div>
                      <div className="text-[11px] text-gray-500 dark:text-gray-400">
                        {new Date(p.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold bg-[#8CD955]/15 text-[#6B8E3F] border border-[#8CD955]/40">
                        {p.transfer_type}
                      </span>
                    </td>
                    <td className={`px-3 py-2.5 whitespace-nowrap ${deadlineClass}`}>
                      <div className="inline-flex items-center gap-1 text-xs font-medium">
                        <Clock className="w-3 h-3" />
                        {p.deadline_days} dia(s)
                      </div>
                      <div className="text-[11px]">
                        {dl.expired ? 'expirado' : `${dl.days} restante(s)`}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <span className="inline-flex items-center justify-center min-w-[40px] px-2 py-0.5 rounded-md text-sm font-bold tabular-nums bg-[#8CD955]/15 text-[#6B8E3F]">
                        {p.pending_leads}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right text-gray-600 dark:text-gray-400 tabular-nums">
                      {p.distributed_leads}
                    </td>
                    {showGerenteColumn && (
                      <td
                        className="px-3 py-2.5 text-gray-700 dark:text-gray-200 truncate max-w-[160px]"
                        title={p.gerente_name ?? p.stock_gerente_user_id ?? undefined}
                      >
                        {p.gerente_name ?? '—'}
                      </td>
                    )}
                    <td className="px-3 py-2.5 text-gray-600 dark:text-gray-300 truncate max-w-[180px]" title={p.performed_by_name ?? undefined}>
                      {p.performed_by_name ?? '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => onOpen(p.transfer_log_id)}
                        disabled={p.pending_leads === 0}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#8CD955] text-white hover:bg-[#7BC84A] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        <Users className="w-3 h-3" />
                        {viewerMode === 'admin' ? 'Ver leads' : 'Abrir e distribuir'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
        active
          ? 'border-[#8CD955] text-[#6B8E3F] dark:text-[#8CD955]'
          : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:border-gray-300 dark:hover:border-[#555]'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function HistoryStatusBadge({ item }: { item: HistoryItem }) {
  if (item.kind === 'distributed') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
        <CheckCircle2 className="w-3 h-3" />
        Distribuído
      </span>
    );
  }
  switch (item.status_label) {
    case 'repassado':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
          <CheckCircle2 className="w-3 h-3" />
          Repassado
        </span>
      );
    case 'cancelado_total':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold bg-red-500/15 text-red-700 dark:text-red-300 border border-red-500/30">
          <XCircle className="w-3 h-3" />
          Cancelado
        </span>
      );
    case 'cancelado_parcial':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30">
          <AlertTriangle className="w-3 h-3" />
          Cancelado parcial ({item.stock_canceled})
        </span>
      );
    case 'em_estoque':
    default:
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold bg-[#8CD955]/15 text-[#6B8E3F] border border-[#8CD955]/40">
          <Inbox className="w-3 h-3" />
          Em estoque
        </span>
      );
  }
}

function HistoryKindBadge({ kind }: { kind: 'reserved' | 'distributed' }) {
  if (kind === 'reserved') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold bg-blue-500/15 text-blue-700 dark:text-blue-300 border border-blue-500/30">
        <ArrowDownToLine className="w-3 h-3" />
        Admin → Estoque
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold bg-violet-500/15 text-violet-700 dark:text-violet-300 border border-violet-500/30">
      <ArrowRightLeft className="w-3 h-3" />
      Estoque → Consultor
    </span>
  );
}

function ThSortHistory({
  label,
  field,
  current,
  onToggle,
  align = 'left',
}: {
  label: string;
  field: HistorySortField;
  current: { field: HistorySortField; dir: SortDir };
  onToggle: (field: HistorySortField) => void;
  align?: 'left' | 'right';
}) {
  const active = current.field === field;
  return (
    <th className={`px-3 py-2.5 text-${align} text-xs font-semibold text-gray-600 dark:text-gray-400 whitespace-nowrap`}>
      <button
        type="button"
        onClick={() => onToggle(field)}
        className={`inline-flex items-center gap-1 hover:text-gray-900 dark:hover:text-white ${
          align === 'right' ? 'flex-row-reverse' : ''
        } ${active ? 'text-gray-900 dark:text-white' : ''}`}
      >
        {label}
        <SortIcon dir={active ? current.dir : null} />
      </button>
    </th>
  );
}

function HistoryView({
  items,
  totalCount,
  loading,
  search,
  onSearchChange,
  filter,
  onFilterChange,
  sort,
  onToggleSort,
  showGerenteColumn,
}: {
  items: HistoryItem[];
  totalCount: number;
  loading: boolean;
  search: string;
  onSearchChange: (v: string) => void;
  filter: HistoryFilter;
  onFilterChange: (v: HistoryFilter) => void;
  sort: { field: HistorySortField; dir: SortDir };
  onToggleSort: (field: HistorySortField) => void;
  showGerenteColumn?: boolean;
}) {
  const filters: { id: HistoryFilter; label: string }[] = [
    { id: 'all', label: 'Todos' },
    { id: 'reserved', label: 'Reservas recebidas' },
    { id: 'distributed', label: 'Repasses feitos' },
    { id: 'canceled', label: 'Canceladas' },
  ];

  return (
    <div className="bg-white dark:bg-[#2a2a2a] rounded-xl border border-gray-200 dark:border-[#404040] overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 dark:border-[#404040] flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-gray-800 dark:text-white">Histórico do estoque</span>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {items.length} de {totalCount}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex rounded-lg border border-gray-200 dark:border-[#444] overflow-hidden">
            {filters.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => onFilterChange(f.id)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  filter === f.id
                    ? 'bg-[#8CD955]/15 text-[#6B8E3F] dark:text-[#8CD955]'
                    : 'bg-white dark:bg-[#2a2a2a] text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-[#333]'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="relative w-full sm:w-[280px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Buscar consultor, TF, responsável..."
              className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-[#444] dark:bg-[#333] dark:text-white focus:ring-2 focus:ring-[#8CD955]/40 focus:border-[#8CD955] outline-none"
            />
          </div>
        </div>
      </div>

      {loading ? (
        <div className="p-10 flex justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-[#8CD955]" />
        </div>
      ) : items.length === 0 ? (
        <div className="p-10 text-center">
          <History className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {totalCount === 0
              ? 'Ainda não há movimentações no estoque desta banca.'
              : 'Nenhum registro corresponde aos filtros atuais.'}
          </p>
        </div>
      ) : (
        <div className="overflow-auto max-h-[calc(100vh-340px)] min-h-[360px]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-gray-50 dark:bg-[#333] z-10 shadow-sm">
              <tr>
                <ThSortHistory label="Data" field="created_at" current={sort} onToggle={onToggleSort} />
                <ThSortHistory label="Tipo de movimento" field="kind" current={sort} onToggle={onToggleSort} />
                <ThSortHistory label="TF" field="transfer_type" current={sort} onToggle={onToggleSort} />
                {showGerenteColumn && (
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 whitespace-nowrap">
                    Gerente
                  </th>
                )}
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 whitespace-nowrap">
                  Origem / Destino
                </th>
                <ThSortHistory label="Leads" field="count" current={sort} onToggle={onToggleSort} align="right" />
                <ThSortHistory label="Saldo total" field="total_balance" current={sort} onToggle={onToggleSort} align="right" />
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 whitespace-nowrap">
                  Status
                </th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 whitespace-nowrap">
                  Responsável
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((h) => (
                <tr
                  key={`${h.kind}-${h.id}`}
                  className="border-t border-gray-100 dark:border-[#404040] hover:bg-gray-50 dark:hover:bg-[#333] transition-colors"
                >
                  <td className="px-3 py-2.5 whitespace-nowrap text-gray-700 dark:text-gray-200">
                    <div>{formatDateShort(h.created_at)}</div>
                    <div className="text-[11px] text-gray-500 dark:text-gray-400">
                      {h.created_at
                        ? new Date(h.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
                        : '—'}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <HistoryKindBadge kind={h.kind} />
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold bg-[#8CD955]/15 text-[#6B8E3F] border border-[#8CD955]/40">
                      {h.transfer_type}
                    </span>
                    <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 inline-flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {h.deadline_days} dia(s)
                    </div>
                  </td>
                  {showGerenteColumn && (
                    <td
                      className="px-3 py-2.5 text-gray-700 dark:text-gray-200 truncate max-w-[140px]"
                      title={h.stock_gerente_name ?? h.stock_gerente_user_id ?? undefined}
                    >
                      {h.stock_gerente_name ?? '—'}
                    </td>
                  )}
                  <td className="px-3 py-2.5">
                    {h.kind === 'reserved' ? (
                      <span className="text-xs text-gray-600 dark:text-gray-300">
                        {showGerenteColumn ? 'Reserva ao estoque do gerente' : 'Reservado ao seu estoque'}
                      </span>
                    ) : (
                      <div className="flex flex-col gap-0.5 text-xs">
                        <span className="text-gray-500 dark:text-gray-400 truncate max-w-[240px]" title={h.source_consultant_email ?? undefined}>
                          de {h.source_consultant_name ?? h.source_consultant_email ?? '—'}
                        </span>
                        <span className="text-gray-800 dark:text-gray-100 font-medium truncate max-w-[240px]" title={h.target_consultant_email ?? undefined}>
                          → {h.target_consultant_name ?? h.target_consultant_email ?? '—'}
                        </span>
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-gray-800 dark:text-gray-100">
                    {h.count}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-gray-700 dark:text-gray-200">
                    {h.total_balance > 0 ? `R$ ${h.total_balance.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
                  </td>
                  <td className="px-3 py-2.5">
                    <HistoryStatusBadge item={h} />
                    {h.kind === 'reserved' && h.status_label === 'cancelado_parcial' && (
                      <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                        {h.stock_pending} em estoque · {h.stock_distributed} repassados
                      </div>
                    )}
                    {h.kind === 'reserved' && h.status_label === 'em_estoque' && h.stock_distributed > 0 && (
                      <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                        {h.stock_distributed} já repassados
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-gray-600 dark:text-gray-300 truncate max-w-[180px]" title={h.performed_by_name ?? undefined}>
                    {h.performed_by_name ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
