'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  AlertCircle,
  ArrowRightLeft,
  Building2,
  CheckCircle2,
  Clock,
  Edit as EditIcon,
  FileUp,
  Globe,
  Loader2,
  Mail,
  RefreshCw,
  Search,
  TrendingUp,
  User,
  UserCheck,
  Users,
  UserPlus,
  ChevronDown,
  History,
  Shield,
  X,
} from 'lucide-react';
import Pagination from '@/components/Admin/Pagination';
import { useToast } from '@/hooks/useToast';
import ToastContainer from '@/components/Toast/ToastContainer';

/** Inclui admin/super_admin com `user_bancas` em `user_ids` de cada banca (API with_users pode omitir). */
async function mergeAdminBancaUserIds(requesterUserId: string, bancasList: any[], profiles: any[]): Promise<any[]> {
  const admins = profiles.filter((p: any) => p?.status === 'admin' || p?.status === 'super_admin');
  if (!admins.length || !bancasList.length) return bancasList;
  const norm = (x: string) => String(x).trim().toLowerCase();
  const links = await Promise.all(
    admins.map(async (u: any) => {
      try {
        const res = await fetch(`/api/admin/users/${u.id}/bancas`, { headers: { 'X-User-Id': requesterUserId } });
        const json = res.ok ? await res.json().catch(() => null) : null;
        const ids = json?.data?.banca_ids;
        return { userId: u.id, banca_ids: Array.isArray(ids) ? ids : [] };
      } catch {
        return { userId: u.id, banca_ids: [] };
      }
    })
  );
  return bancasList.map((b: any) => {
    const bid = norm(b.id);
    const extra = links
      .filter((l) => l.banca_ids.some((x: string) => norm(String(x)) === bid))
      .map((l) => l.userId);
    const uidSet = new Set<string>();
    for (const x of b.user_ids || []) uidSet.add(String(x));
    for (const x of extra) uidSet.add(String(x));
    return { ...b, user_ids: Array.from(uidSet) };
  });
}

export default function HierarchySection({ userId }: { userId: string | null }) {
  const { toasts, showToast, removeToast } = useToast();
  const [hierarchy, setHierarchy] = useState<any[]>([]);
  const [issues, setIssues] = useState<any[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [bancasDropdownReady, setBancasDropdownReady] = useState(false);
  const [dataLoading, setDataLoading] = useState(false);
  const [crmBancas, setCrmBancas] = useState<any[]>([]);
  const [crmBancasBasic, setCrmBancasBasic] = useState<any[]>([]);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [selectedBancaMode, setSelectedBancaMode] = useState<string>('all');
  const [bancaSearch, setBancaSearch] = useState('');
  const [issuesSearch, setIssuesSearch] = useState('');
  const [bancaFilter, setBancaFilter] = useState<'all' | 'sem_dono' | 'com_dono'>('all');
  const [issuesCurrentPage, setIssuesCurrentPage] = useState(1);
  const issuesPerPage = 10;
  const [bancasCurrentPage, setBancasCurrentPage] = useState(1);
  const bancasPerPage = 5;
  const [editingUser, setEditingUser] = useState<any>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createFormData, setCreateFormData] = useState({
    email: '',
    fullName: '',
    password: '',
    status: 'consultor' as 'consultor' | 'gerente' | 'dono_banca' | 'gestor',
    enroller: '',
    bancaOwnerId: '',
    bancaName: '',
    bancaUrl: '',
    initialBancaIds: [] as string[],
  });
  const [editFormData, setEditFormData] = useState({
    email: '',
    password: '',
  });
  const [showFixModal, setShowFixModal] = useState(false);
  const [fixingIssue, setFixingIssue] = useState<any>(null);
  const [selectedFixRole, setSelectedFixRole] = useState<'dono_banca' | 'gerente' | 'consultor'>('gerente');
  const [selectedFixBancaId, setSelectedFixBancaId] = useState<string>('');
  const [selectedEnroller, setSelectedEnroller] = useState<string>('');
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [gestorBancaLoading, setGestorBancaLoading] = useState<string | null>(null);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [assignFormData, setAssignFormData] = useState<{
    status: 'dono_banca' | 'gerente' | 'consultor';
    enroller: string;
    bancaId: string;
    bancaName: string;
    bancaUrl: string;
    ownerId: string;
  } | null>(null);
  const [assignUserSearch, setAssignUserSearch] = useState('');
  const [assignSelectedUserIds, setAssignSelectedUserIds] = useState<string[]>([]);
  const [assignLoading, setAssignLoading] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [showMoveConsultantsModal, setShowMoveConsultantsModal] = useState(false);
  const [moveContext, setMoveContext] = useState<{ owner: any; sourceGerente: any; crmBanca: any } | null>(null);
  const [moveSelectedConsultantIds, setMoveSelectedConsultantIds] = useState<string[]>([]);
  const [moveTargetGerenteId, setMoveTargetGerenteId] = useState('');
  const [moveConsultantSearch, setMoveConsultantSearch] = useState('');
  const [moveLoading, setMoveLoading] = useState(false);
  const [bancaPickerOpen, setBancaPickerOpen] = useState(false);
  const [bancaPickerSearch, setBancaPickerSearch] = useState('');
  const [peopleSearch, setPeopleSearch] = useState('');
  /** Busca só dentro do card da banca (gerentes/consultores). */
  const [cardPeopleSearch, setCardPeopleSearch] = useState<Record<string, string>>({});
  /** Paginação da lista de gerentes (blocos gerente + consultores) por banca. */
  const [cardGerenteRedePage, setCardGerenteRedePage] = useState<Record<string, number>>({});
  /** Paginação dos consultores "sem gerente na banca" por banca. */
  const [cardConsultorOrfaoPage, setCardConsultorOrfaoPage] = useState<Record<string, number>>({});
  /** Paginação das raízes (admins vinculados) na rede do admin por banca. */
  const [cardAdminRedePage, setCardAdminRedePage] = useState<Record<string, number>>({});
  /** Busca só na seção Rede do admin vinculado (por banca). */
  const [cardAdminRedeSearch, setCardAdminRedeSearch] = useState<Record<string, string>>({});
  /** Paginação dos consultores sob cada gerente (chave: bancaId:gerenteId:c). */
  const [cardGerenteConsultoresPage, setCardGerenteConsultoresPage] = useState<Record<string, number>>({});
  const [hierarchyAuditVisible, setHierarchyAuditVisible] = useState(false);
  const [hierarchyAuditOpen, setHierarchyAuditOpen] = useState(false);
  const [hierarchyAuditEntries, setHierarchyAuditEntries] = useState<any[]>([]);
  const [hierarchyAuditLoading, setHierarchyAuditLoading] = useState(false);
  const bancaPickerRef = useRef<HTMLDivElement>(null);
  const [showImportConsultantsModal, setShowImportConsultantsModal] = useState(false);
  const [importConsultantsContext, setImportConsultantsContext] = useState<{ bancaId: string; bancaName: string; ownerId?: string } | null>(null);
  const [importConsultantsGerenteId, setImportConsultantsGerenteId] = useState('');
  const [importConsultantsRows, setImportConsultantsRows] = useState<{ nome: string; email: string; senha: string }[]>([]);
  const [importConsultantsLoading, setImportConsultantsLoading] = useState(false);
  const [importConsultantsError, setImportConsultantsError] = useState<string | null>(null);
  const MAX_IMPORT_CONSULTANTS = 10;
  const GERENTES_REDE_PER_PAGE = 5;
  const CONSULTORES_ORFAOS_PER_PAGE = 6;
  /** Quantas raízes (admin vinculado à banca) por página na rede do admin. */
  const ADMIN_REDE_ROOTS_PER_PAGE = 5;
  /** Consultores listados por página sob cada gerente. */
  const GERENTE_CONSULTORES_PER_PAGE = 5;
  const initialLoadPromiseRef = useRef<{ userId: string; promise: Promise<{ list: any[]; issues: any[] }> } | null>(null);
  /** Evita GET de auditoria após carregar hierarquia se o usuário não for super_admin. */
  const hierarchyAuditUnlockedRef = useRef(false);

  /** Árvore por enroller a partir de cada admin / super_admin (independente da árvore por donos de banca). */
  const adminNetworkTrees = useMemo(() => {
    const users = allUsers || [];
    const normId = (x: unknown): string | null => {
      if (x == null) return null;
      const s = String(x).trim();
      return s === '' ? null : s;
    };
    const buildSubtree = (uidRaw: string): any | null => {
      const uid = normId(uidRaw);
      if (!uid) return null;
      const user = users.find((u: any) => normId(u.id) === uid);
      if (!user) return null;
      const children = users.filter((u: any) => normId(u.enroller) === uid);
      return {
        ...user,
        subordinates: children.map((c: any) => buildSubtree(String(c.id))).filter(Boolean),
      };
    };
    const roots = users.filter((u: any) => u && (u.status === 'admin' || u.status === 'super_admin'));
    return roots.map((a: any) => buildSubtree(String(a.id))).filter(Boolean);
  }, [allUsers]);

  const parseConsultantsCsv = (text: string): { nome: string; email: string; senha: string }[] => {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) return [];
    const header = lines[0].toLowerCase();
    const sep = header.includes(';') ? ';' : ',';
    const headers = lines[0].split(sep).map((h) => h.trim().toLowerCase().replace(/^["']|["']$/g, ''));
    const nomeIdx = headers.findIndex((h) => h === 'nome' || h === 'name');
    const emailIdx = headers.findIndex((h) => h === 'email');
    const senhaIdx = headers.findIndex((h) => h === 'senha' || h === 'password');
    if (nomeIdx === -1 || emailIdx === -1 || senhaIdx === -1) return [];
    const rows: { nome: string; email: string; senha: string }[] = [];
    for (let i = 1; i < lines.length && rows.length < MAX_IMPORT_CONSULTANTS; i++) {
      const values = lines[i].split(sep).map((v) => v.trim().replace(/^["']|["']$/g, ''));
      const nome = (values[nomeIdx] ?? '').trim();
      const email = (values[emailIdx] ?? '').trim().toLowerCase();
      const senha = (values[senhaIdx] ?? '').trim();
      if (email && senha) rows.push({ nome, email, senha });
    }
    return rows;
  };

  const openImportConsultantsModal = (crmBanca: any) => {
    const owner = findOwnerByCrmBanca(String(crmBanca.id));
    setImportConsultantsContext({
      bancaId: String(crmBanca.id),
      bancaName: crmBanca.name || '',
      ownerId: owner?.id,
    });
    setImportConsultantsGerenteId('');
    setImportConsultantsRows([]);
    setImportConsultantsError(null);
    setShowImportConsultantsModal(true);
  };

  const handleImportCsvChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImportConsultantsError(null);
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      const rows = parseConsultantsCsv(text);
      if (rows.length === 0) {
        setImportConsultantsError('CSV inválido. Use cabeçalho: nome, email, senha (ou name, password). Encoding UTF-8.');
        setImportConsultantsRows([]);
      } else {
        setImportConsultantsError(null);
        setImportConsultantsRows(rows);
      }
    };
    reader.readAsText(file, 'UTF-8');
  };

  const handleImportConsultants = async () => {
    if (!userId || !importConsultantsContext || !importConsultantsGerenteId || importConsultantsRows.length === 0) {
      showToast('Selecione o gerente ou admin e importe um CSV com pelo menos um consultor (máx. 10).', 'error');
      return;
    }
    setImportConsultantsLoading(true);
    let success = 0;
    const errors: string[] = [];
    for (const row of importConsultantsRows) {
      try {
        const res = await fetch('/api/admin/users/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
          body: JSON.stringify({
            email: row.email,
            fullName: row.nome || undefined,
            password: row.senha,
            status: 'consultor',
            enroller: importConsultantsGerenteId,
            banca_ids: [importConsultantsContext.bancaId],
          }),
        });
        const data = await res.json();
        if (res.ok && data.success) success++;
        else errors.push(`${row.email}: ${data.message || 'Erro'}`);
      } catch {
        errors.push(`${row.email}: Erro de rede`);
      }
    }
    setImportConsultantsLoading(false);
    if (errors.length > 0) showToast(`${success} criado(s). Algumas falhas.`, 'info');
    if (success > 0) {
      showToast(success === 1 ? '1 consultor criado com sucesso!' : `${success} consultores criados com sucesso!`, 'success');
      setShowImportConsultantsModal(false);
      setImportConsultantsContext(null);
      setImportConsultantsGerenteId('');
      setImportConsultantsRows([]);
      loadHierarchyData();
    }
  };

  /** Atualiza só `user_ids` da banca no estado local para o card aparecer na hora (sem recarregar toda a hierarquia). */
  const patchLocalBancaUserLink = (bancaId: string, profileId: string, mode: 'add' | 'remove') => {
    const bidLc = String(bancaId ?? '').trim().toLowerCase();
    const pidRaw = String(profileId ?? '').trim();
    if (!bidLc || !pidRaw) return;
    const bancaMatches = (b: any) => String(b?.id ?? '').trim().toLowerCase() === bidLc;
    const apply = (rows: any[]) =>
      (rows || []).map((b: any) => {
        if (!bancaMatches(b)) return b;
        const ids = Array.isArray(b.user_ids) ? [...b.user_ids].map((x: unknown) => String(x ?? '').trim()) : [];
        const pidLc = pidRaw.toLowerCase();
        if (mode === 'add') {
          if (!ids.some((id) => id.toLowerCase() === pidLc)) ids.push(pidRaw);
          return { ...b, user_ids: ids };
        }
        return { ...b, user_ids: ids.filter((id) => id.toLowerCase() !== pidLc) };
      });
    setCrmBancas((prev) => apply(prev || []));
    setCrmBancasBasic((prev) => (prev && prev.length ? apply(prev) : prev));
  };

  const addGestorToBanca = async (gestorId: string, bancaId: string) => {
    if (!userId) return;
    setGestorBancaLoading(bancaId);
    try {
      const getRes = await fetch(`/api/admin/users/${gestorId}/bancas`, { headers: { 'X-User-Id': userId } });
      const getData = await getRes.json();
      const current = (getData.data?.banca_ids || []) as string[];
      const normBid = String(bancaId ?? '').trim().toLowerCase();
      if (current.some((id) => String(id ?? '').trim().toLowerCase() === normBid)) {
        setGestorBancaLoading(null);
        return;
      }
      const putRes = await fetch(`/api/admin/users/${gestorId}/bancas`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
        body: JSON.stringify({ banca_ids: [...current, bancaId] }),
      });
      if (putRes.ok) {
        patchLocalBancaUserLink(bancaId, gestorId, 'add');
        if (hierarchyAuditUnlockedRef.current) void fetchHierarchyAudit();
      } else showToast((await putRes.json()).error || 'Erro ao vincular usuário à banca', 'error');
    } catch (e) {
      console.error(e);
      showToast('Erro ao vincular usuário à banca', 'error');
    } finally {
      setGestorBancaLoading(null);
    }
  };

  const removeGestorFromBanca = async (gestorId: string, bancaId: string) => {
    if (!userId) return;
    setGestorBancaLoading(bancaId);
    try {
      const getRes = await fetch(`/api/admin/users/${gestorId}/bancas`, { headers: { 'X-User-Id': userId } });
      const getData = await getRes.json();
      const current = (getData.data?.banca_ids || []) as string[];
      const next = current.filter((id: string) => String(id ?? '').trim().toLowerCase() !== String(bancaId ?? '').trim().toLowerCase());
      const putRes = await fetch(`/api/admin/users/${gestorId}/bancas`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
        body: JSON.stringify({ banca_ids: next }),
      });
      if (putRes.ok) {
        patchLocalBancaUserLink(bancaId, gestorId, 'remove');
        if (hierarchyAuditUnlockedRef.current) void fetchHierarchyAudit();
      } else showToast((await putRes.json()).error || 'Erro ao atualizar vínculo com a banca', 'error');
    } catch (e) {
      console.error(e);
      showToast('Erro ao atualizar vínculo com a banca', 'error');
    } finally {
      setGestorBancaLoading(null);
    }
  };

  // Consulta simples às bancas: assim que retornar, libera o dropdown (independente de issues/hierarquia)
  const loadBancasForDropdown = React.useCallback(async () => {
    if (!userId) return;
    setBancasDropdownReady(false);
    try {
      const res = await fetch('/api/admin/crm/bancas', { headers: { 'X-User-Id': userId } });
      const json = res.ok ? await res.json() : null;
      const list = Array.isArray(json?.data)
        ? json.data
        : Array.isArray(json?.data?.bancas)
          ? json.data.bancas
          : [];
      setCrmBancasBasic(list);
      setCrmBancas(list);
      setBancasDropdownReady(true);
    } catch (err) {
      console.error('Erro ao carregar bancas para dropdown:', err);
      setCrmBancasBasic([]);
      setCrmBancas([]);
      setBancasDropdownReady(true);
    }
  }, [userId]);

  useEffect(() => {
    if (userId) loadBancasForDropdown();
  }, [userId, loadBancasForDropdown]);

  useEffect(() => {
    if (userId) loadInitialData();
  }, [userId]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!bancaPickerRef.current?.contains(e.target as Node)) setBancaPickerOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const loadInitialData = async () => {
    if (!userId) return;
    setInitialLoading(true);

    const existing = initialLoadPromiseRef.current;
    if (existing?.userId === userId && existing.promise) {
      try {
        const { issues } = await existing.promise;
        setIssues(issues);
      } catch {
        // ignora
      } finally {
        setInitialLoading(false);
      }
      return;
    }

    const issuesPromise = fetch('/api/admin/users/validate-hierarchy', { headers: { 'X-User-Id': userId } })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => (json?.data?.issues ?? []) as any[])
      .catch(() => []);

    const promise = issuesPromise.then((issues) => ({ list: [] as any[], issues }));
    initialLoadPromiseRef.current = { userId, promise };

    try {
      const { issues } = await promise;
      setIssues(issues);
    } catch (error) {
      console.error('Erro ao carregar dados iniciais:', error);
    } finally {
      initialLoadPromiseRef.current = null;
      setInitialLoading(false);
    }
  };

  const fetchHierarchyAudit = useCallback(async () => {
    if (!userId) return;
    setHierarchyAuditLoading(true);
    try {
      const res = await fetch('/api/admin/hierarchy-network-audit?limit=80', { headers: { 'X-User-Id': userId } });
      if (res.status === 403) {
        setHierarchyAuditVisible(false);
        setHierarchyAuditEntries([]);
        hierarchyAuditUnlockedRef.current = false;
        return;
      }
      if (!res.ok) return;
      const json = await res.json();
      setHierarchyAuditVisible(true);
      hierarchyAuditUnlockedRef.current = true;
      setHierarchyAuditEntries(Array.isArray(json?.data?.entries) ? json.data.entries : []);
    } catch {
      // silencioso
    } finally {
      setHierarchyAuditLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (userId) fetchHierarchyAudit();
  }, [userId, fetchHierarchyAudit]);

  const loadHierarchyData = async (force = false) => {
    setDataLoading(true);
    try {
      const bancaId = selectedBancaMode && selectedBancaMode !== 'all' ? selectedBancaMode : null;
      const bancasUrl = bancaId ? `/api/admin/crm/bancas?with_users=1&banca_id=${encodeURIComponent(bancaId)}` : '/api/admin/crm/bancas?with_users=1';
      const [hierarchyRes, usersRes, bancasRes] = await Promise.all([
        fetch('/api/admin/users/hierarchy', { headers: { 'X-User-Id': userId! } }),
        fetch('/api/admin/users', { headers: { 'X-User-Id': userId! } }),
        fetch(bancasUrl, { headers: { 'X-User-Id': userId! } }),
      ]);
      if (hierarchyRes.ok) {
        const data = await hierarchyRes.json();
        setHierarchy(data.data || []);
      }
      let profilesList: any[] = [];
      if (usersRes.ok) {
        const data = await usersRes.json();
        profilesList = data.data || [];
        setAllUsers(profilesList);
      }
      if (bancasRes.ok) {
        const data = await bancasRes.json();
        let loaded = data.data || [];
        if (userId && profilesList.length) {
          loaded = await mergeAdminBancaUserIds(userId, loaded, profilesList);
        }
        setCrmBancas(loaded);
        if (!bancaId && crmBancasBasic.length === 0) setCrmBancasBasic(loaded);
      }
      setDataLoaded(true);
    } catch (error) {
      console.error('Erro ao carregar hierarquia:', error);
    } finally {
      setDataLoading(false);
      if (hierarchyAuditUnlockedRef.current) void fetchHierarchyAudit();
    }
  };

  const handleLoadData = () => {
    loadHierarchyData(true);
  };

  const formatAuditDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    } catch {
      return iso;
    }
  };

  const normalizeBancaUrl = (url?: string | null) => {
    if (!url) return '';
    let normalized = String(url).trim();
    normalized = normalized.replace(/^https?:\/\//i, '');
    normalized = normalized.replace(/\/api\/crm\/?/i, '');
    normalized = normalized.replace(/\/+$/, '');
    return normalized.trim().toLowerCase();
  };

  const formatTime = (seconds: number = 0) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m`;
    return '0m';
  };

  const handleEditUser = (user: any) => {
    setEditingUser(user);
    setEditFormData({ email: user.email || '', password: '' });
    setShowEditModal(true);
  };

  const handleSaveEdit = async () => {
    if (!editingUser) return;
    try {
      const res = await fetch(`/api/admin/users/${editingUser.id}/update`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId! },
        body: JSON.stringify({
          email: editFormData.email || undefined,
          password: editFormData.password || undefined,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast('Usuário atualizado com sucesso!', 'success');
        setShowEditModal(false);
        setEditingUser(null);
        loadHierarchyData();
      } else {
        showToast(data.message || 'Erro ao atualizar usuário', 'error');
      }
    } catch (error) {
      console.error('Erro ao atualizar usuário:', error);
      showToast('Erro ao atualizar usuário', 'error');
    }
  };

  const findOwnerByCrmBanca = (crmBancaId: string) => {
    const banca = (crmBancas || []).find((b: any) => String(b.id) === String(crmBancaId));
    if (!banca) return null;
    const bancaUrlNorm = normalizeBancaUrl(banca.url);
    return (hierarchy || []).find((h: any) => normalizeBancaUrl(h.banca_url) === bancaUrlNorm) || null;
  };

  const getManagersByCrmBanca = (crmBancaId: string) => {
    const banca = (crmBancas || []).find((b: any) => String(b.id) === String(crmBancaId));
    if (!banca?.user_ids?.length) return [];
    const gerentesNaBanca = (banca.user_ids || [])
      .map((uid: string) => allUsers.find((x: any) => x.id === uid))
      .filter((u: any) => u && u.status === 'gerente');
    return gerentesNaBanca;
  };

  /** Retorna gerentes vinculados à banca para o modal: user_bancas + hierarquia (subordinados do dono). */
  const getGerentesParaBancaModal = (crmBancaId: string) => {
    const fromCrm = getManagersByCrmBanca(crmBancaId);
    const owner = findOwnerByCrmBanca(crmBancaId);
    const fromHierarchy = (owner?.subordinates || []).filter((s: any) => s && s.status === 'gerente');
    const seen = new Set<string>(fromCrm.map((g: any) => g.id));
    const merged = [...fromCrm];
    fromHierarchy.forEach((g: any) => {
      if (g?.id && !seen.has(g.id)) {
        seen.add(g.id);
        merged.push(g);
      }
    });
    return merged;
  };

  /** Gerentes da banca (CRM + hierarquia) + Admin/Super Admin — superiores válidos para consultor. */
  const getSuperioresParaConsultor = (crmBancaId?: string | null) => {
    const gerentes = crmBancaId
      ? getGerentesParaBancaModal(crmBancaId)
      : (hierarchy || []).flatMap((h: any) => (h.subordinates || []).filter((s: any) => s?.status === 'gerente'));
    const admins = (allUsers || []).filter(
      (u: any) => u && (u.status === 'admin' || u.status === 'super_admin')
    );
    const seen = new Set<string>();
    const merged: any[] = [];
    gerentes.forEach((g: any) => {
      if (g?.id && !seen.has(g.id)) {
        seen.add(g.id);
        merged.push(g);
      }
    });
    admins.forEach((a: any) => {
      if (a?.id && !seen.has(a.id)) {
        seen.add(a.id);
        merged.push(a);
      }
    });
    return merged;
  };

  /** Superior válido para cargo Gestor: Dono da banca, Admin ou Super Admin (mesmo critério que validateHierarchy). */
  const getSuperioresParaGestor = () => {
    const donos = (hierarchy || []).filter((h: any) => h?.id);
    const plataforma = (allUsers || []).filter(
      (u: any) => u && (u.status === 'admin' || u.status === 'super_admin')
    );
    const seen = new Set<string>();
    const merged: any[] = [];
    donos.forEach((d: any) => {
      if (d?.id && !seen.has(d.id)) {
        seen.add(d.id);
        merged.push(d);
      }
    });
    plataforma.forEach((a: any) => {
      if (a?.id && !seen.has(a.id)) {
        seen.add(a.id);
        merged.push(a);
      }
    });
    return merged;
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateLoading(true);
    try {
      const res = await fetch('/api/admin/users/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId! },
        body: JSON.stringify({
          email: createFormData.email,
          fullName: createFormData.fullName,
          password: createFormData.password,
          status: createFormData.status,
          enroller: createFormData.status === 'dono_banca' ? null : (createFormData.enroller || null),
          bancaName: createFormData.status === 'dono_banca' ? createFormData.bancaName : undefined,
          bancaUrl: createFormData.status === 'dono_banca' ? createFormData.bancaUrl : undefined,
          banca_ids: (createFormData.status === 'consultor' || createFormData.status === 'gerente') && createFormData.initialBancaIds?.length ? createFormData.initialBancaIds : undefined,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const roleLabel = createFormData.status === 'dono_banca' ? 'Dono de banca' : createFormData.status === 'gestor' ? 'Gestor de Tráfego' : createFormData.status === 'gerente' ? 'Gerente' : 'Consultor';
        showToast(`${roleLabel} criado com sucesso!`, 'success');
        setShowCreateModal(false);
        setCreateFormData({ email: '', fullName: '', password: '', status: 'consultor', enroller: '', bancaOwnerId: '', bancaName: '', bancaUrl: '', initialBancaIds: [] });
        loadHierarchyData();
      } else {
        showToast(data.message || 'Erro ao criar usuário', 'error');
      }
    } catch (error) {
      console.error('Erro ao criar usuário:', error);
      showToast('Erro ao criar usuário', 'error');
    } finally {
      setCreateLoading(false);
    }
  };

  const handleFixIssue = async (issue: any) => {
    try {
      const usersRes = await fetch('/api/admin/users', { headers: { 'X-User-Id': userId! } });
      if (usersRes.ok) {
        const usersData = await usersRes.json();
        const userWithIssue = usersData.data?.find((u: any) => u.email === issue.email);
        if (userWithIssue) {
          setFixingIssue({ ...issue, userId: userWithIssue.id, status: userWithIssue.status });
          const defaultRole = userWithIssue.status === 'consultor' ? 'consultor' : userWithIssue.status === 'dono_banca' ? 'dono_banca' : 'gerente';
          setSelectedFixRole(defaultRole);
          const firstBancaId = (crmBancas && crmBancas.length > 0) ? String(crmBancas[0].id) : '';
          setSelectedFixBancaId(firstBancaId);
          if (defaultRole === 'consultor' && firstBancaId) {
            const managers = getManagersByCrmBanca(firstBancaId);
            setSelectedEnroller(managers?.length ? managers[0].id : '');
          } else {
            setSelectedEnroller('');
          }
          setShowFixModal(true);
        } else {
          showToast('Usuário não encontrado', 'error');
        }
      }
    } catch (error) {
      console.error('Erro ao buscar informações do usuário:', error);
      showToast('Erro ao buscar informações do usuário', 'error');
    }
  };

  const handleSaveFix = async () => {
    if (!fixingIssue || !selectedFixBancaId) {
      showToast('Selecione uma banca', 'error');
      return;
    }
    const selectedBanca = (crmBancas || []).find((b: any) => String(b.id) === String(selectedFixBancaId));
    if (!selectedBanca) {
      showToast('Banca inválida', 'error');
      return;
    }
    const owner = findOwnerByCrmBanca(selectedFixBancaId);
    if (selectedFixRole === 'gerente' && !owner) {
      showToast('Essa banca ainda não tem Dono cadastrado. Crie o Dono primeiro.', 'error');
      return;
    }
    if (selectedFixRole === 'consultor') {
      const managers = getManagersByCrmBanca(selectedFixBancaId);
      if (!managers || managers.length === 0) {
        showToast('Essa banca ainda não tem Gerentes cadastrados. Crie um Gerente primeiro.', 'error');
        return;
      }
      if (!selectedEnroller) {
        showToast('Selecione um gerente ou admin', 'error');
        return;
      }
    }
    try {
      const payload: any = { status: selectedFixRole };
      if (selectedFixRole === 'dono_banca') {
        payload.enroller = null;
        payload.bancaName = selectedBanca.name || null;
        payload.bancaUrl = normalizeBancaUrl(selectedBanca.url || '');
      } else if (selectedFixRole === 'gerente') {
        payload.enroller = owner.id;
      } else if (selectedFixRole === 'consultor') {
        payload.enroller = selectedEnroller;
      }
      const res = await fetch(`/api/admin/users/${fixingIssue.userId}/update`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId! },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast('Problema corrigido com sucesso!', 'success');
        setShowFixModal(false);
        setFixingIssue(null);
        setSelectedFixBancaId('');
        setSelectedFixRole('gerente');
        setSelectedEnroller('');
        loadHierarchyData();
      } else {
        showToast(data.message || 'Erro ao corrigir problema', 'error');
      }
    } catch (error) {
      console.error('Erro ao corrigir problema:', error);
      showToast('Erro ao corrigir problema', 'error');
    }
  };

  const handleOpenAssignModal = (params: {
    status: 'dono_banca' | 'gerente' | 'consultor';
    enroller: string;
    bancaId: string;
    bancaName: string;
    bancaUrl: string;
    ownerId: string;
  }) => {
    setAssignFormData(params);
    setAssignUserSearch('');
    setAssignSelectedUserIds([]);
    setShowAssignModal(true);
  };

  const toggleAssignUser = (id: string) => {
    setAssignSelectedUserIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const openMoveConsultantsModal = (owner: any, sourceGerente: any, crmBanca: any) => {
    setMoveContext({ owner, sourceGerente, crmBanca });
    setMoveSelectedConsultantIds([]);
    setMoveTargetGerenteId('');
    setMoveConsultantSearch('');
    setShowMoveConsultantsModal(true);
  };

  const toggleMoveConsultant = (id: string) => {
    setMoveSelectedConsultantIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleMoveConsultants = async () => {
    if (!moveContext || moveSelectedConsultantIds.length === 0 || !moveTargetGerenteId) {
      showToast('Selecione um ou mais consultores e o superior de destino (gerente ou admin).', 'error');
      return;
    }
    setMoveLoading(true);
    try {
      let successCount = 0;
      const errors: string[] = [];
      for (const consultantId of moveSelectedConsultantIds) {
        const res = await fetch(`/api/admin/users/${consultantId}/update`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'X-User-Id': userId! },
          body: JSON.stringify({ status: 'consultor', enroller: moveTargetGerenteId }),
        });
        const data = await res.json();
        if (res.ok && data.success) successCount++;
        else {
          const u = (allUsers || []).find((x: any) => x.id === consultantId);
          errors.push(u ? `${u.full_name || u.email}: ${data.message || 'Erro'}` : data.message || 'Erro');
        }
      }
      if (errors.length > 0) {
        showToast(successCount > 0 ? `${successCount} movido(s). Algumas falhas.` : `Falhas: ${errors[0]}${errors.length > 1 ? ` e mais ${errors.length - 1}.` : ''}`, successCount > 0 ? 'info' : 'error');
      }
      if (successCount > 0) {
        showToast(successCount === 1 ? 'Consultor movido com sucesso!' : `${successCount} consultores movidos com sucesso!`, 'success');
        setShowMoveConsultantsModal(false);
        setMoveContext(null);
        setMoveSelectedConsultantIds([]);
        setMoveTargetGerenteId('');
        loadHierarchyData();
      }
    } catch (e) {
      console.error(e);
      showToast('Erro ao mover consultores', 'error');
    } finally {
      setMoveLoading(false);
    }
  };

  const handleAssignUser = async () => {
    if (!assignFormData || assignSelectedUserIds.length === 0) {
      showToast('Selecione um ou mais usuários', 'error');
      return;
    }
    if (assignFormData.status === 'consultor' && !assignFormData.enroller) {
      showToast('Consultor deve ser atribuído a um gerente ou admin.', 'error');
      return;
    }
    setAssignLoading(true);
    try {
      const payload: Record<string, unknown> = { status: assignFormData.status };
      if (assignFormData.status === 'dono_banca') {
        payload.enroller = null;
        payload.bancaName = assignFormData.bancaName || null;
        payload.bancaUrl = normalizeBancaUrl(assignFormData.bancaUrl || '');
      } else {
        // Gerente: superior opcional (null quando vazio); consultor: enroller obrigatório
        const enrollerVal = (assignFormData.enroller || '').trim();
        payload.enroller = enrollerVal === '' ? null : enrollerVal;
      }

      let successCount = 0;
      const errors: string[] = [];

      for (const assignSelectedUserId of assignSelectedUserIds) {
        let patchPayload = { ...payload };
        if (assignFormData.status === 'gerente' || assignFormData.status === 'consultor') {
          const getRes = await fetch(`/api/admin/users/${assignSelectedUserId}/bancas`, { headers: { 'X-User-Id': userId! } });
          const getData = await getRes.json();
          const currentIds = (getData.data?.banca_ids || []) as string[];
          const isAddingBanca = !currentIds.includes(assignFormData.bancaId);
          const selectedUser = (allUsers || []).find((x: any) => x.id === assignSelectedUserId);
          const sameRoleAddingBanca = selectedUser?.status === assignFormData.status && currentIds.length > 0 && isAddingBanca;
          if (sameRoleAddingBanca && 'enroller' in patchPayload) {
            const { enroller: _, ...rest } = patchPayload;
            patchPayload = rest as Record<string, unknown>;
          }
          const res = await fetch(`/api/admin/users/${assignSelectedUserId}/update`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'X-User-Id': userId! },
            body: JSON.stringify(patchPayload),
          });
          const data = await res.json();
          if (!res.ok || !data.success) {
            const u = (allUsers || []).find((x: any) => x.id === assignSelectedUserId);
            const msg = data.message || data.error || 'Erro';
            errors.push(u ? `${u.full_name || u.email}: ${msg}` : msg);
            continue;
          }
          if (isAddingBanca) {
            const bancaIdsToSend = [...currentIds, assignFormData.bancaId].map((id) => String(id));
            const putRes = await fetch(`/api/admin/users/${assignSelectedUserId}/bancas`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json', 'X-User-Id': userId! },
              body: JSON.stringify({ banca_ids: bancaIdsToSend }),
            });
            if (!putRes.ok) {
              const putData = await putRes.json().catch(() => ({}));
              const u = (allUsers || []).find((x: any) => x.id === assignSelectedUserId);
              const putMsg = putData.error || putData.message || 'Erro ao vincular banca';
              errors.push(u ? `${u.full_name || u.email}: ${putMsg}` : putMsg);
              continue;
            }
          }
        } else {
          const res = await fetch(`/api/admin/users/${assignSelectedUserId}/update`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'X-User-Id': userId! },
            body: JSON.stringify(patchPayload),
          });
          const data = await res.json();
          if (!res.ok || !data.success) {
            const u = (allUsers || []).find((x: any) => x.id === assignSelectedUserId);
            const msg = data.message || data.error || 'Erro';
            errors.push(u ? `${u.full_name || u.email}: ${msg}` : msg);
            continue;
          }
        }
        successCount++;
      }

      if (errors.length > 0) {
        const msg = successCount > 0 ? `${successCount} atribuído(s). Algumas falhas.` : `Falhas: ${errors[0]}${errors.length > 1 ? ` e mais ${errors.length - 1}.` : ''}`;
        showToast(msg, successCount > 0 ? 'info' : 'error');
      }
      if (successCount > 0) {
        const label = assignFormData.status === 'dono_banca' ? 'Dono(s) de banca' : assignFormData.status === 'gerente' ? 'Gerente(s)' : 'Consultor(es)';
        showToast(successCount === 1 ? `${label} atribuído com sucesso!` : `${successCount} ${label} atribuídos com sucesso!`, 'success');
        setShowAssignModal(false);
        setAssignFormData(null);
        setAssignSelectedUserIds([]);
        loadHierarchyData();
      }
    } catch (error) {
      console.error('Erro ao atribuir usuário:', error);
      showToast('Erro ao atribuir usuário', 'error');
    } finally {
      setAssignLoading(false);
    }
  };

  const loading = initialLoading || dataLoading;

  /** Texto para busca: minúsculas, sem acentos (evita "Jose" ≠ "José"). */
  const foldSearchText = (s: string) =>
    String(s || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

  const personMatchesSearch = (u: any, qFolded: string) => {
    if (!u || !qFolded) return !qFolded;
    const name = foldSearchText(u.full_name || '');
    const email = String(u.email || '').toLowerCase();
    return name.includes(qFolded) || email.includes(qFolded);
  };

  /** Mantém nós que batem na busca ou têm descendente que bate (rede do admin). */
  const filterAdminTreeBySearch = (node: any, rawQ: string): any | null => {
    const q = foldSearchText(rawQ);
    if (!q) return node;
    const filteredSubs = (node.subordinates || [])
      .map((c: any) => filterAdminTreeBySearch(c, rawQ))
      .filter(Boolean);
    if (personMatchesSearch(node, q) || filteredSubs.length > 0) {
      return { ...node, subordinates: filteredSubs };
    }
    return null;
  };

  const buildBancaGerentesConsultores = (crmBanca: any) => {
    const bancaUrlNorm = normalizeBancaUrl(crmBanca.url);
    const owner = (hierarchy || []).find((h: any) => normalizeBancaUrl(h.banca_url) === bancaUrlNorm);
    const fromIds = (crmBanca.user_ids || []) as string[];

    let gerentesInBanca = fromIds
      .map((uid: string) => allUsers.find((x: any) => x.id === uid))
      .filter((u: any) => u && u.status === 'gerente');

    if (owner?.subordinates?.length) {
      const hierGerentes = owner.subordinates.filter((s: any) => s?.status === 'gerente');
      const seen = new Set(gerentesInBanca.map((g: any) => g.id));
      for (const hg of hierGerentes) {
        if (!hg?.id || seen.has(hg.id)) continue;
        seen.add(hg.id);
        const full = allUsers.find((x: any) => x.id === hg.id);
        gerentesInBanca.push(full ? { ...hg, ...full } : hg);
      }
    }

    const gerenteIdsInBanca = new Set(gerentesInBanca.map((g: any) => g.id));

    const consultoresNaBanca = fromIds
      .map((uid: string) => allUsers.find((x: any) => x.id === uid))
      .filter((u: any) => u && u.status === 'consultor');

    const consultoresLigadosAosGerentes = (allUsers || []).filter(
      (u: any) => u.status === 'consultor' && u.enroller && gerenteIdsInBanca.has(u.enroller)
    );

    const consultoresEmGerente = new Map<string, any[]>();
    gerentesInBanca.forEach((g: any) => {
      consultoresEmGerente.set(g.id, consultoresLigadosAosGerentes.filter((c: any) => c.enroller === g.id));
    });

    if (owner?.subordinates?.length) {
      for (const hg of owner.subordinates) {
        if (hg?.status !== 'gerente' || !hg.id) continue;
        const merged = new Map<string, any>((consultoresEmGerente.get(hg.id) || []).map((c: any) => [c.id, c]));
        for (const sub of hg.subordinates || []) {
          if (sub?.status === 'consultor' && sub.id) {
            const full = allUsers.find((x: any) => x.id === sub.id);
            merged.set(sub.id, full ? { ...sub, ...full } : sub);
          }
        }
        consultoresEmGerente.set(hg.id, Array.from(merged.values()));
      }
    }

    const consultoresSemGerenteNaBanca = consultoresNaBanca.filter((c: any) => !gerenteIdsInBanca.has(c.enroller));

    const gerentesComConsultores = gerentesInBanca.map((gerente: any) => ({
      ...gerente,
      subordinates: consultoresEmGerente.get(gerente.id) || [],
    }));

    const consultoresLigadosFlat = gerentesComConsultores.flatMap((g: any) => g.subordinates || []);

    return { gerentesInBanca, gerentesComConsultores, consultoresSemGerenteNaBanca, consultoresLigadosAosGerentes: consultoresLigadosFlat };
  };

  const peopleQueryMatchesBanca = (crmBanca: any, raw: string) => {
    const q = foldSearchText(raw);
    if (!q) return true;
    const { gerentesComConsultores, consultoresSemGerenteNaBanca } = buildBancaGerentesConsultores(crmBanca);
    const m = (u: any) => personMatchesSearch(u, q);
    if (gerentesComConsultores.some((g: any) => m(g) || (g.subordinates || []).some((c: any) => m(c)))) return true;
    if (consultoresSemGerenteNaBanca.some((c: any) => m(c))) return true;
    return false;
  };

  type UserCardRole = 'dono' | 'gerente' | 'consultor' | 'admin' | 'super_admin' | 'other';

  const inferCardRole = (user: any): UserCardRole => {
    const s = String(user?.status || '').trim();
    if (s === 'consultor') return 'consultor';
    if (s === 'gerente') return 'gerente';
    if (s === 'dono_banca') return 'dono';
    if (s === 'admin') return 'admin';
    if (s === 'super_admin') return 'super_admin';
    return 'other';
  };

  const renderUserCard = (user: any, role: UserCardRole, bancaId?: string) => {
    const roleConfig: Record<
      UserCardRole,
      { color: string; bg: string; label: string; icon: typeof User }
    > = {
      dono: { color: 'emerald', bg: 'bg-emerald-500', label: 'Dono de Banca', icon: Building2 },
      gerente: { color: 'blue', bg: 'bg-blue-500', label: 'Gerente', icon: Users },
      consultor: { color: 'green', bg: 'bg-green-500', label: 'Consultor', icon: User },
      admin: { color: 'violet', bg: 'bg-violet-500', label: 'Admin', icon: Shield },
      super_admin: { color: 'fuchsia', bg: 'bg-fuchsia-600', label: 'Super Admin', icon: Shield },
      other: { color: 'slate', bg: 'bg-slate-500', label: '', icon: User },
    };
    const config = roleConfig[role];
    const badgeLabel = role === 'other' ? (String(user?.status || '').trim() || 'Usuário') : config.label;
    const Icon = config.icon;
    const zaplotoHours = formatTime(user.total_online_time || 0);
    const crmHours = formatTime((user as { total_crm_time?: number | null }).total_crm_time ?? 0);
    const showRemoveFromBanca = bancaId && (role === 'gerente' || role === 'consultor');
    const badgeTone =
      role === 'dono'
        ? 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300'
        : role === 'gerente'
          ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300'
          : role === 'consultor'
            ? 'bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-300'
            : role === 'admin'
              ? 'bg-violet-100 dark:bg-violet-900/50 text-violet-800 dark:text-violet-200'
              : role === 'super_admin'
                ? 'bg-fuchsia-100 dark:bg-fuchsia-900/50 text-fuchsia-800 dark:text-fuchsia-200'
                : 'bg-slate-100 dark:bg-slate-800/80 text-slate-700 dark:text-slate-300';
    return (
      <div className="bg-white dark:bg-[#2a2a2a] rounded-xl shadow-md border border-gray-200 dark:border-[#404040] p-3 sm:p-4 hover:shadow-lg transition-shadow overflow-hidden">
        <div className="flex items-start justify-between gap-2 mb-3 sm:mb-4">
          <div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0">
            <div className={`w-10 h-10 sm:w-12 sm:h-12 rounded-full ${config.bg} text-white flex items-center justify-center font-bold text-sm flex-shrink-0 shadow-lg`}>
              <Icon className="w-5 h-5 sm:w-6 sm:h-6" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-bold text-gray-900 dark:text-white text-sm sm:text-base truncate">{user.full_name || user.email}</h3>
              <span className={`text-[10px] sm:text-xs px-1.5 sm:px-2 py-0.5 rounded-md uppercase font-bold tracking-tighter inline-block mt-0.5 sm:mt-1 ${badgeTone}`}>
                {badgeLabel}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-0.5 sm:gap-1 flex-shrink-0">
            <button onClick={() => handleEditUser(user)} className="p-2.5 sm:p-2 min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 flex items-center justify-center text-gray-400 dark:text-[#888] hover:text-[#E86A24] dark:hover:text-[#00ff00] hover:bg-gray-50 dark:hover:bg-[#333] rounded-lg transition-colors touch-manipulation" title="Editar usuário">
              <EditIcon className="w-5 h-5" />
            </button>
            {showRemoveFromBanca && (
              <button type="button" onClick={() => removeGestorFromBanca(user.id, bancaId)} disabled={gestorBancaLoading === bancaId} className="p-2.5 sm:p-2 min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 flex items-center justify-center text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors disabled:opacity-50 touch-manipulation" title="Remover da banca">
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>
        <div className="space-y-2 sm:space-y-3 border-t border-gray-100 dark:border-[#404040] pt-2 sm:pt-3">
          <div className="flex items-center gap-2 text-xs sm:text-sm text-gray-600 dark:text-gray-400 min-w-0">
            <Mail className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-gray-400 dark:text-[#888] flex-shrink-0" />
            <span className="truncate">{user.email}</span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:gap-3">
            <div className="bg-gray-50 dark:bg-[#333] rounded-lg p-2 min-w-0">
              <div className="flex items-center gap-1 mb-0.5">
                <Clock className="w-3 h-3 text-gray-500 dark:text-[#888] flex-shrink-0" />
                <span className="text-[10px] sm:text-xs font-medium text-gray-600 dark:text-gray-400 truncate">Zaploto</span>
              </div>
              <p className="text-xs sm:text-sm font-bold text-gray-800 dark:text-gray-200">{zaplotoHours}</p>
            </div>
            <div className="bg-gray-50 dark:bg-[#333] rounded-lg p-2 min-w-0">
              <div className="flex items-center gap-1 mb-0.5">
                <TrendingUp className="w-3 h-3 text-gray-500 dark:text-[#888] flex-shrink-0" />
                <span className="text-[10px] sm:text-xs font-medium text-gray-600 dark:text-gray-400 truncate">CRM</span>
              </div>
              <p className="text-xs sm:text-sm font-bold text-gray-800 dark:text-gray-200">{crmHours}</p>
            </div>
          </div>
          {role === 'consultor' && (
            <a href={`/crm/kanban?userId=${user.id}`} className="w-full flex items-center justify-center gap-2 px-3 py-3 sm:py-2 min-h-[44px] bg-[#E86A24] text-white rounded-lg hover:bg-[#D95E1B] transition-colors text-xs sm:text-sm font-medium touch-manipulation active:scale-[0.98]">
              <TrendingUp className="w-4 h-4" />
              Acessar CRM
            </a>
          )}
        </div>
      </div>
    );
  };

  /** Árvore do admin: todos os subordinados recursivos (sem paginação por nível). */
  const renderAdminNetworkBranchFull = (node: any, depth: number): React.ReactNode => {
    const cardRole = inferCardRole(node);
    const subs = node.subordinates || [];
    return (
      <div
        className={
          depth > 0
            ? 'mt-3 ml-0 sm:ml-1 pl-3 sm:pl-4 border-l-2 border-violet-300/90 dark:border-violet-700/55'
            : ''
        }
      >
        <div className="max-w-sm sm:max-w-md">{renderUserCard(node, cardRole)}</div>
        {subs.length > 0 && (
          <div className="mt-3 space-y-3">
            {subs.map((child: any) => (
              <div
                key={child.id}
                className="rounded-xl bg-violet-100/30 dark:bg-violet-950/25 border border-violet-200/40 dark:border-violet-800/30 p-2 sm:p-3"
              >
                {renderAdminNetworkBranchFull(child, depth + 1)}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderBancaCard = (crmBanca: any) => {
    const bancaUrlNorm = normalizeBancaUrl(crmBanca.url);
    const owner = (hierarchy || []).find((h: any) => normalizeBancaUrl(h.banca_url) === bancaUrlNorm);
    /** Gestor formal ou Super Admin vinculado como gestor de tráfego nesta banca (Admin fica só na seção de plataforma abaixo). */
    const gestoresCargoOnBanca = (crmBanca.user_ids || [])
      .map((uid: string) => allUsers.find((x: any) => x.id === uid))
      .filter((u: any) => u && (u.status === 'gestor' || u.status === 'super_admin'));
    const gestoresCargoDisponiveis = (allUsers || []).filter(
      (u: any) =>
        (u.status === 'gestor' || u.status === 'super_admin') &&
        !gestoresCargoOnBanca.some((g: any) => g.id === u.id)
    );

    const plataformaGestorNaBanca = (crmBanca.user_ids || [])
      .map((uid: string) => allUsers.find((x: any) => x.id === uid))
      .filter((u: any) => u && u.status === 'admin');
    const plataformaGestorDisponiveis = (allUsers || []).filter(
      (u: any) => u.status === 'admin' && !plataformaGestorNaBanca.some((p: any) => p.id === u.id)
    );
    const {
      gerentesInBanca,
      gerentesComConsultores: rawGerentesComConsultores,
      consultoresSemGerenteNaBanca: rawConsultoresSemGerente,
      consultoresLigadosAosGerentes,
    } = buildBancaGerentesConsultores(crmBanca);
    const bancaIdKey = String(crmBanca.id);
    const globalQ = foldSearchText(peopleSearch);
    const cardQ = foldSearchText(cardPeopleSearch[bancaIdKey] ?? '');
    const personMatches = (u: any) => {
      const gOk = !globalQ || personMatchesSearch(u, globalQ);
      const cOk = !cardQ || personMatchesSearch(u, cardQ);
      return gOk && cOk;
    };
    let gerentesComConsultores = rawGerentesComConsultores;
    let consultoresSemGerenteNaBanca = rawConsultoresSemGerente;
    if (globalQ || cardQ) {
      gerentesComConsultores = rawGerentesComConsultores
        .map((g: any) => {
          const allSubs = g.subordinates || [];
          const subsFiltered = allSubs.filter((c: any) => personMatches(c));
          const gMatch = personMatches(g);
          if (!gMatch && subsFiltered.length === 0) return null;
          return { ...g, subordinates: gMatch ? allSubs : subsFiltered };
        })
        .filter(Boolean) as any[];
      consultoresSemGerenteNaBanca = rawConsultoresSemGerente.filter((c: any) => personMatches(c));
    }
    const hadAnyGerenteOuConsultor =
      rawGerentesComConsultores.length > 0 || rawConsultoresSemGerente.length > 0;

    const btnClass = 'flex items-center justify-center gap-1.5 sm:gap-2 px-3 py-2.5 sm:px-4 sm:py-2 text-sm rounded-lg font-medium transition-colors touch-manipulation min-h-[44px] sm:min-h-[40px] w-full sm:w-auto min-w-0';

    const totalGerentesRede = gerentesComConsultores.length;
    const totalPagesGerenteRede = Math.max(1, Math.ceil(totalGerentesRede / GERENTES_REDE_PER_PAGE));
    let gerenteRedePage = cardGerenteRedePage[bancaIdKey] ?? 1;
    if (gerenteRedePage > totalPagesGerenteRede) gerenteRedePage = totalPagesGerenteRede;
    if (gerenteRedePage < 1) gerenteRedePage = 1;
    const pagedGerentesComConsultores = gerentesComConsultores.slice(
      (gerenteRedePage - 1) * GERENTES_REDE_PER_PAGE,
      gerenteRedePage * GERENTES_REDE_PER_PAGE
    );

    const totalOrfaos = consultoresSemGerenteNaBanca.length;
    const totalPagesOrfaos = Math.max(1, Math.ceil(totalOrfaos / CONSULTORES_ORFAOS_PER_PAGE));
    let orfaoPage = cardConsultorOrfaoPage[bancaIdKey] ?? 1;
    if (orfaoPage > totalPagesOrfaos) orfaoPage = totalPagesOrfaos;
    if (orfaoPage < 1) orfaoPage = 1;
    const pagedConsultoresOrfaos = consultoresSemGerenteNaBanca.slice(
      (orfaoPage - 1) * CONSULTORES_ORFAOS_PER_PAGE,
      orfaoPage * CONSULTORES_ORFAOS_PER_PAGE
    );

    return (
      <div key={crmBanca.id} className="bg-gradient-to-br from-white to-emerald-50 dark:from-[#2a2a2a] dark:to-emerald-950/30 rounded-xl shadow-lg border border-emerald-100 dark:border-emerald-800 p-4 sm:p-6 relative overflow-hidden">
        <div className="relative z-10">
          {/* Topo: identificação da banca + ações (criar / atribuir) */}
          <div className="mb-5 sm:mb-6 pb-5 border-b border-emerald-200/80 dark:border-emerald-800/80">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4 mb-4">
              <div className="flex items-start gap-3 min-w-0 flex-1">
                <div className="w-11 h-11 sm:w-14 sm:h-14 rounded-xl bg-[#E86A24] dark:bg-[#00e600] text-white flex items-center justify-center font-bold text-base sm:text-lg flex-shrink-0 shadow-md shadow-emerald-200/50 dark:shadow-emerald-900/40">
                  {crmBanca.name ? String(crmBanca.name).substring(0, 2).toUpperCase() : 'BK'}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] sm:text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 mb-0.5">Banca</p>
                  <h2 className="text-lg sm:text-2xl font-bold text-gray-900 dark:text-white leading-tight break-words">{crmBanca.name || 'Banca sem nome'}</h2>
                  {crmBanca.url && (
                    <a href={`https://${normalizeBancaUrl(crmBanca.url)}`} target="_blank" rel="noreferrer" className="text-xs sm:text-sm text-[#E86A24] dark:text-[#00ff00] hover:underline font-medium inline-flex items-center gap-1 mt-1 break-all max-w-full">
                      <Globe className="w-3.5 h-3.5 sm:w-4 sm:h-4 flex-shrink-0" />
                      <span className="break-all">{normalizeBancaUrl(crmBanca.url)}</span>
                    </a>
                  )}
                  {!owner && (
                    <span className="inline-block mt-2 text-xs bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 px-2 py-1 rounded-md font-bold">
                      Sem dono cadastrado
                    </span>
                  )}
                </div>
              </div>
            </div>
            <p className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-2">Ações nesta banca</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 sm:gap-3">
              {!owner ? (
                <>
                  <button onClick={() => { setCreateFormData(prev => ({ ...prev, status: 'dono_banca', enroller: '', bancaOwnerId: '', bancaName: crmBanca.name || '', bancaUrl: normalizeBancaUrl(crmBanca.url || ''), initialBancaIds: [] })); setShowCreateModal(true); }} className={`${btnClass} bg-[#E86A24] text-white hover:bg-[#D95E1B]`}>
                    <UserPlus className="w-4 h-4 flex-shrink-0" /> <span className="truncate">Criar Dono</span>
                  </button>
                  <button onClick={() => handleOpenAssignModal({ status: 'dono_banca', enroller: '', bancaId: String(crmBanca.id), bancaName: crmBanca.name || '', bancaUrl: normalizeBancaUrl(crmBanca.url || ''), ownerId: '' })} className={`${btnClass} bg-emerald-700/90 text-white hover:bg-emerald-700 border border-emerald-600`}>
                    <UserCheck className="w-4 h-4 flex-shrink-0" /> <span className="truncate">Atribuir Dono</span>
                  </button>
                  <button onClick={() => { setCreateFormData(prev => ({ ...prev, status: 'gerente', enroller: '', bancaOwnerId: '', bancaName: '', bancaUrl: '', initialBancaIds: [String(crmBanca.id)] })); setShowCreateModal(true); }} className={`${btnClass} bg-blue-600 text-white hover:bg-blue-700`}>
                    <UserPlus className="w-4 h-4 flex-shrink-0" /> <span className="truncate">Adicionar Gerente</span>
                  </button>
                  <button onClick={() => handleOpenAssignModal({ status: 'gerente', enroller: '', bancaId: String(crmBanca.id), bancaName: '', bancaUrl: '', ownerId: '' })} className={`${btnClass} bg-blue-700/90 text-white hover:bg-blue-700 border border-blue-600`}>
                    <UserCheck className="w-4 h-4 flex-shrink-0" /> <span className="truncate">Atribuir Gerente</span>
                  </button>
                  <button onClick={() => { setCreateFormData(prev => ({ ...prev, status: 'consultor', enroller: '', bancaOwnerId: '', bancaName: '', bancaUrl: '', initialBancaIds: [String(crmBanca.id)] })); setShowCreateModal(true); }} className={`${btnClass} bg-emerald-600 text-white hover:bg-emerald-700`}>
                    <UserPlus className="w-4 h-4 flex-shrink-0" /> <span className="truncate">Adicionar Consultor</span>
                  </button>
                  <button onClick={() => { const managers = getManagersByCrmBanca(String(crmBanca.id)); handleOpenAssignModal({ status: 'consultor', enroller: managers?.length ? managers[0].id : '', bancaId: String(crmBanca.id), bancaName: crmBanca.name || '', bancaUrl: normalizeBancaUrl(crmBanca.url || ''), ownerId: '' }); }} className={`${btnClass} bg-green-700/90 text-white hover:bg-green-700 border border-green-600`}>
                    <UserCheck className="w-4 h-4 flex-shrink-0" /> <span className="truncate">Atribuir Consultor</span>
                  </button>
                  {gerentesInBanca.length > 0 && (
                    <button onClick={() => openImportConsultantsModal(crmBanca)} className={`${btnClass} bg-slate-600 text-white hover:bg-slate-700 border border-slate-500 col-span-2 sm:col-span-1`} title="Importar até 10 consultores por CSV (nome, email, senha)">
                      <FileUp className="w-4 h-4 flex-shrink-0" /> <span className="truncate">Importar CSV</span>
                    </button>
                  )}
                </>
              ) : (
                <>
                  <button onClick={() => { setCreateFormData(prev => ({ ...prev, status: 'gerente', enroller: owner.id, bancaOwnerId: owner.id, bancaName: owner.banca_name || crmBanca.name || '', bancaUrl: normalizeBancaUrl(owner.banca_url || crmBanca.url || ''), initialBancaIds: [String(crmBanca.id)] })); setShowCreateModal(true); }} className={`${btnClass} bg-blue-600 text-white hover:bg-blue-700`}>
                    <UserPlus className="w-4 h-4 flex-shrink-0" /> <span className="truncate">Adicionar Gerente</span>
                  </button>
                  <button onClick={() => handleOpenAssignModal({ status: 'gerente', enroller: owner.id, bancaId: String(crmBanca.id), bancaName: owner.banca_name || crmBanca.name || '', bancaUrl: normalizeBancaUrl(owner.banca_url || crmBanca.url || ''), ownerId: owner.id })} className={`${btnClass} bg-blue-700/90 text-white hover:bg-blue-700 border border-blue-600`}>
                    <UserCheck className="w-4 h-4 flex-shrink-0" /> <span className="truncate">Atribuir Gerente</span>
                  </button>
                  <button onClick={() => { setCreateFormData(prev => ({ ...prev, status: 'consultor', enroller: owner.id, bancaOwnerId: owner.id, bancaName: owner.banca_name || crmBanca.name || '', bancaUrl: normalizeBancaUrl(owner.banca_url || crmBanca.url || ''), initialBancaIds: [String(crmBanca.id)] })); setShowCreateModal(true); }} className={`${btnClass} bg-emerald-600 text-white hover:bg-emerald-700`}>
                    <UserPlus className="w-4 h-4 flex-shrink-0" /> <span className="truncate">Adicionar Consultor</span>
                  </button>
                  <button onClick={() => { const managers = getManagersByCrmBanca(String(crmBanca.id)); handleOpenAssignModal({ status: 'consultor', enroller: managers?.length ? managers[0].id : '', bancaId: String(crmBanca.id), bancaName: owner.banca_name || crmBanca.name || '', bancaUrl: normalizeBancaUrl(owner.banca_url || crmBanca.url || ''), ownerId: owner.id }); }} className={`${btnClass} bg-green-700/90 text-white hover:bg-green-700 border border-green-600`}>
                    <UserCheck className="w-4 h-4 flex-shrink-0" /> <span className="truncate">Atribuir Consultor</span>
                  </button>
                  {gerentesInBanca.length > 0 && (
                    <button onClick={() => openImportConsultantsModal(crmBanca)} className={`${btnClass} bg-slate-600 text-white hover:bg-slate-700 border border-slate-500 col-span-2 sm:col-span-1`} title="Importar até 10 consultores por CSV (nome, email, senha)">
                      <FileUp className="w-4 h-4 flex-shrink-0" /> <span className="truncate">Importar CSV</span>
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="mb-6">
            <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-3 flex items-center gap-2">
              <Building2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              Dono da Banca
            </h3>
            {owner ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">{renderUserCard(owner, 'dono')}</div>
            ) : (
              <div className="bg-white dark:bg-[#2a2a2a] rounded-xl border border-gray-200 dark:border-[#404040] p-6 text-gray-600 dark:text-[#aaa]">
                <p className="font-medium">Nenhum dono cadastrado para esta banca.</p>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Crie um Dono de Banca ou atribua Gerentes/Consultores diretamente a esta banca.</p>
              </div>
            )}
          </div>

          <div className="mb-6">
            <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-1 flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-teal-600 dark:text-teal-400" />
              Gestores de tráfego — Gestor ou Super Admin
              {gestoresCargoOnBanca.length > 0 && ` (${gestoresCargoOnBanca.length})`}
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
              Perfis com cargo <strong className="font-semibold text-gray-600 dark:text-gray-300">Gestor</strong> ou{' '}
              <strong className="font-semibold text-gray-600 dark:text-gray-300">Super Admin</strong> que atuam como gestor de tráfego nesta banca.{' '}
              <strong className="font-semibold text-gray-600 dark:text-gray-300">Admin</strong> (sem ser super) permanece na seção abaixo.
            </p>
            <>
              {gestoresCargoOnBanca.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 mb-3">
                  {gestoresCargoOnBanca.map((u: any) => (
                    <div
                      key={u.id}
                      className={`bg-white dark:bg-[#333] rounded-xl border p-4 flex items-center justify-between gap-2 ${
                        u.status === 'super_admin'
                          ? 'border-amber-200 dark:border-amber-800/60'
                          : 'border-teal-100 dark:border-teal-800'
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900 dark:text-white truncate">{u.full_name || u.email}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{u.email}</p>
                        <span
                          className={`inline-block mt-1 px-2 py-0.5 rounded text-xs font-bold ${
                            u.status === 'super_admin'
                              ? 'bg-amber-100 dark:bg-amber-900/45 text-amber-900 dark:text-amber-100'
                              : 'bg-teal-100 dark:bg-teal-900/50 text-teal-700 dark:text-teal-300'
                          }`}
                        >
                          {u.status === 'super_admin' ? 'Super Admin — gestor nesta banca' : 'Cargo: Gestor'}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <button type="button" onClick={() => handleEditUser(u)} className="p-1.5 text-gray-500 dark:text-[#888] hover:bg-gray-100 dark:hover:bg-[#404040] rounded" title="Editar">
                          <EditIcon className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeGestorFromBanca(u.id, crmBanca.id)}
                          disabled={gestorBancaLoading === crmBanca.id}
                          className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded disabled:opacity-50"
                          title="Remover gestor desta banca"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-gray-600 dark:text-gray-400">Adicionar Gestor ou Super Admin:</span>
                <select
                  value=""
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v) addGestorToBanca(v, crmBanca.id);
                    e.target.value = '';
                  }}
                  disabled={gestorBancaLoading === crmBanca.id || gestoresCargoDisponiveis.length === 0}
                  className="bg-white dark:bg-[#333] border border-gray-200 dark:border-[#555] px-3 py-2 rounded-lg text-sm font-medium text-gray-700 dark:text-white min-w-[200px] disabled:opacity-50"
                >
                  <option value="">
                    {gestoresCargoDisponiveis.length === 0 ? 'Nenhum disponível' : 'Selecione Gestor ou Super Admin'}
                  </option>
                  {gestoresCargoDisponiveis.map((u: any) => (
                    <option key={u.id} value={u.id}>
                      {(u.full_name || u.email) + (u.status === 'super_admin' ? ' (super admin)' : '')}
                    </option>
                  ))}
                </select>
              </div>
            </>
          </div>

          <div className="mb-6">
            <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-1 flex items-center gap-2">
              <Shield className="w-5 h-5 text-violet-600 dark:text-violet-400" />
              Admin na função de gestor nesta banca
              {plataformaGestorNaBanca.length > 0 && ` (${plataformaGestorNaBanca.length})`}
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
              Somente perfis <strong className="font-semibold text-gray-600 dark:text-gray-300">Admin</strong> (não super) vinculados nesta banca para tráfego. Super Admin usa a seção acima junto com Gestor.
            </p>
            <>
              {plataformaGestorNaBanca.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 mb-3">
                  {plataformaGestorNaBanca.map((u: any) => (
                    <div
                      key={u.id}
                      className="bg-white dark:bg-[#333] rounded-xl border border-violet-100 dark:border-violet-900/50 p-4 flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900 dark:text-white truncate">{u.full_name || u.email}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{u.email}</p>
                        <span className="inline-block mt-1 px-2 py-0.5 rounded text-xs font-bold bg-violet-100 dark:bg-violet-900/50 text-violet-800 dark:text-violet-200">
                          Admin — função gestor (banca)
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <button type="button" onClick={() => handleEditUser(u)} className="p-1.5 text-gray-500 dark:text-[#888] hover:bg-gray-100 dark:hover:bg-[#404040] rounded" title="Editar">
                          <EditIcon className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeGestorFromBanca(u.id, crmBanca.id)}
                          disabled={gestorBancaLoading === crmBanca.id}
                          className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded disabled:opacity-50"
                          title="Remover vínculo de gestor de tráfego nesta banca"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-gray-600 dark:text-gray-400">Vincular Admin:</span>
                <select
                  value=""
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v) addGestorToBanca(v, crmBanca.id);
                    e.target.value = '';
                  }}
                  disabled={gestorBancaLoading === crmBanca.id || plataformaGestorDisponiveis.length === 0}
                  className="bg-white dark:bg-[#333] border border-gray-200 dark:border-[#555] px-3 py-2 rounded-lg text-sm font-medium text-gray-700 dark:text-white min-w-[200px] disabled:opacity-50"
                >
                  <option value="">
                    {plataformaGestorDisponiveis.length === 0 ? 'Nenhum disponível' : 'Selecione um admin'}
                  </option>
                  {plataformaGestorDisponiveis.map((u: any) => (
                    <option key={u.id} value={u.id}>
                      {(u.full_name || u.email) + ' (admin)'}
                    </option>
                  ))}
                </select>
              </div>
            </>
          </div>

          {(owner || gerentesInBanca.length > 0 || consultoresLigadosAosGerentes.length > 0 || rawConsultoresSemGerente.length > 0) && (
            <div className="mb-6">
              <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-1 flex flex-wrap items-center gap-2">
                <Users className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                Gerentes e Consultores nesta banca
                {totalGerentesRede > 0 && (
                  <span className="text-sm font-normal text-gray-500 dark:text-gray-400">
                    {`(${totalGerentesRede} gerente${totalGerentesRede !== 1 ? 's' : ''}${totalPagesGerenteRede > 1 ? ` · pág. ${gerenteRedePage}/${totalPagesGerenteRede}` : ''})`}
                  </span>
                )}
              </h3>
              <div className="relative w-full min-w-0 mb-4">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 dark:text-[#888] w-4 h-4 pointer-events-none" />
                <input
                  type="text"
                  value={cardPeopleSearch[bancaIdKey] ?? ''}
                  onChange={(e) => {
                    const v = e.target.value;
                    setCardPeopleSearch((prev) => {
                      if (!v) {
                        const next = { ...prev };
                        delete next[bancaIdKey];
                        return next;
                      }
                      return { ...prev, [bancaIdKey]: v };
                    });
                    setCardGerenteRedePage((p) => ({ ...p, [bancaIdKey]: 1 }));
                    setCardConsultorOrfaoPage((p) => ({ ...p, [bancaIdKey]: 1 }));
                    setCardGerenteConsultoresPage((prev) => {
                      const next = { ...prev };
                      Object.keys(next).forEach((k) => {
                        if (k.startsWith(`${bancaIdKey}:`)) delete next[k];
                      });
                      return next;
                    });
                  }}
                  placeholder="Filtrar gerentes e consultores nesta banca..."
                  className="w-full min-w-0 pl-9 pr-10 py-2.5 text-sm bg-white dark:bg-[#2a2a2a] border border-blue-200/80 dark:border-blue-800/80 rounded-lg focus:ring-2 focus:ring-blue-500/40 dark:focus:ring-blue-400/30 focus:border-blue-400 dark:focus:border-blue-600 text-gray-900 dark:text-white placeholder:text-gray-500 dark:placeholder:text-[#888]"
                  aria-label="Filtrar gerentes e consultores nesta banca"
                />
                {(cardPeopleSearch[bancaIdKey] ?? '').trim() !== '' && (
                  <button
                    type="button"
                    onClick={() => {
                      setCardPeopleSearch((prev) => {
                        const next = { ...prev };
                        delete next[bancaIdKey];
                        return next;
                      });
                      setCardGerenteRedePage((p) => ({ ...p, [bancaIdKey]: 1 }));
                      setCardConsultorOrfaoPage((p) => ({ ...p, [bancaIdKey]: 1 }));
                      setCardGerenteConsultoresPage((prev) => {
                        const next = { ...prev };
                        Object.keys(next).forEach((k) => {
                          if (k.startsWith(`${bancaIdKey}:`)) delete next[k];
                        });
                        return next;
                      });
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-gray-500 hover:bg-gray-100 dark:hover:bg-[#404040] dark:text-[#aaa]"
                    aria-label="Limpar filtro desta banca"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
              {gerentesComConsultores.length === 0 && consultoresSemGerenteNaBanca.length === 0 ? (
                hadAnyGerenteOuConsultor && (globalQ || cardQ) ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Nenhum gerente ou consultor corresponde à busca nesta banca. Ajuste o filtro acima ou a busca geral no topo.
                  </p>
                ) : (
                  <p className="text-sm text-gray-500 dark:text-gray-400">Nenhum gerente ou consultor atribuído. Use os botões acima para criar ou adicionar.</p>
                )
              ) : (
                <div className="space-y-6">
                  {pagedGerentesComConsultores.map((gerente: any) => {
                    const consAll = gerente.subordinates || [];
                    const consPageKey = `${bancaIdKey}:${gerente.id}:c`;
                    const consTotal = consAll.length;
                    const consTotalPages = Math.max(1, Math.ceil(consTotal / GERENTE_CONSULTORES_PER_PAGE));
                    let consPg = cardGerenteConsultoresPage[consPageKey] ?? 1;
                    if (consPg > consTotalPages) consPg = consTotalPages;
                    if (consPg < 1) consPg = 1;
                    const pagedCons = consAll.slice(
                      (consPg - 1) * GERENTE_CONSULTORES_PER_PAGE,
                      consPg * GERENTE_CONSULTORES_PER_PAGE
                    );
                    return (
                    <div key={gerente.id} className="bg-blue-50/30 dark:bg-blue-950/30 rounded-lg p-4 border border-blue-100 dark:border-blue-800">
                      {renderUserCard(gerente, 'gerente', crmBanca.id)}
                      {consTotal > 0 && (
                        <div className="mt-4 pl-4 border-l-2 border-blue-300 dark:border-blue-600 space-y-3">
                          <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide flex flex-wrap items-center gap-2">
                            <User className="w-4 h-4 text-green-600 dark:text-green-400" />
                            Consultores ({consTotal}
                            {consTotalPages > 1 ? ` · pág. ${consPg}/${consTotalPages}` : ''})
                          </h4>
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                            {pagedCons.map((consultor: any) => (
                              <div key={consultor.id}>{renderUserCard(consultor, 'consultor', crmBanca.id)}</div>
                            ))}
                          </div>
                          {consTotalPages > 1 && (
                            <div className="rounded-lg border border-blue-200 dark:border-blue-800 overflow-hidden bg-white dark:bg-[#2a2a2a] max-w-full">
                              <Pagination
                                currentPage={consPg}
                                totalPages={consTotalPages}
                                onPageChange={(p) =>
                                  setCardGerenteConsultoresPage((prev) => ({ ...prev, [consPageKey]: p }))
                                }
                                itemsPerPage={GERENTE_CONSULTORES_PER_PAGE}
                                totalItems={consTotal}
                              />
                            </div>
                          )}
                        </div>
                      )}
                      {consTotal === 0 && (
                        <div className="mt-4 pl-4 border-l-2 border-blue-300 dark:border-blue-600">
                          <div className="flex gap-2">
                            <button onClick={() => { setCreateFormData(prev => ({ ...prev, status: 'consultor', enroller: gerente.id, bancaOwnerId: owner?.id || '', bancaName: owner?.banca_name || crmBanca.name || '', bancaUrl: normalizeBancaUrl(owner?.banca_url || crmBanca.url || ''), initialBancaIds: [String(crmBanca.id)] })); setShowCreateModal(true); }} className="flex-1 p-3 border-2 border-dashed border-gray-300 dark:border-[#555] rounded-lg text-gray-500 dark:text-gray-400 hover:border-green-400 dark:hover:border-green-500 hover:text-green-600 dark:hover:text-green-400 transition-colors text-sm font-medium flex items-center justify-center gap-2">
                              <UserPlus className="w-4 h-4" /> Adicionar Consultor
                            </button>
                            <button onClick={() => handleOpenAssignModal({ status: 'consultor', enroller: gerente.id, bancaId: String(crmBanca.id), bancaName: owner?.banca_name || crmBanca.name || '', bancaUrl: normalizeBancaUrl(owner?.banca_url || crmBanca.url || ''), ownerId: owner?.id || '' })} className="flex-1 p-3 border-2 border-dashed border-green-300 dark:border-green-600 rounded-lg text-green-600 dark:text-green-400 hover:border-green-500 dark:hover:border-green-500 hover:bg-green-50 dark:hover:bg-green-900/20 transition-colors text-sm font-medium flex items-center justify-center gap-2">
                              <UserCheck className="w-4 h-4" /> Atribuir Consultor
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                    );
                  })}
                  {totalPagesGerenteRede > 1 && totalGerentesRede > 0 && (
                    <div className="rounded-lg border border-blue-200 dark:border-blue-800 overflow-hidden bg-white dark:bg-[#2a2a2a]">
                      <Pagination
                        currentPage={gerenteRedePage}
                        totalPages={totalPagesGerenteRede}
                        onPageChange={(p) => {
                          setCardGerenteRedePage((prev) => ({ ...prev, [bancaIdKey]: p }));
                          setCardGerenteConsultoresPage((prev) => {
                            const next = { ...prev };
                            Object.keys(next).forEach((k) => {
                              if (k.startsWith(`${bancaIdKey}:`)) delete next[k];
                            });
                            return next;
                          });
                        }}
                        itemsPerPage={GERENTES_REDE_PER_PAGE}
                        totalItems={totalGerentesRede}
                      />
                    </div>
                  )}
                  {consultoresSemGerenteNaBanca.length > 0 && (
                    <div className="bg-gray-50/50 dark:bg-[#333] rounded-lg p-4 border border-gray-200 dark:border-[#404040]">
                      <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-1 flex flex-wrap items-center gap-2">
                        <User className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                        Consultores sem gerente nesta banca (ex.: vinculados a admin)
                        {totalOrfaos > 0 && totalPagesOrfaos > 1 && (
                          <span className="text-xs font-normal normal-case text-gray-500 dark:text-gray-400">
                            · página {orfaoPage}/{totalPagesOrfaos}
                          </span>
                        )}
                      </h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                        {pagedConsultoresOrfaos.map((c: any) => (
                          <div key={c.id}>{renderUserCard(c, 'consultor', crmBanca.id)}</div>
                        ))}
                      </div>
                      {totalPagesOrfaos > 1 && (
                        <div className="mt-3 rounded-lg border border-gray-200 dark:border-[#404040] overflow-hidden bg-white dark:bg-[#2a2a2a]">
                          <Pagination
                            currentPage={orfaoPage}
                            totalPages={totalPagesOrfaos}
                            onPageChange={(p) => setCardConsultorOrfaoPage((prev) => ({ ...prev, [bancaIdKey]: p }))}
                            itemsPerPage={CONSULTORES_ORFAOS_PER_PAGE}
                            totalItems={totalOrfaos}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {(() => {
            const linkedAdminRootIds = new Set(
              (crmBanca.user_ids || [])
                .filter((uid: string) => {
                  const u = allUsers.find((x: any) => x.id === uid);
                  return u && (u.status === 'admin' || u.status === 'super_admin');
                })
                .map((uid: string) => String(uid))
            );
            const treesLinkedToBanca = adminNetworkTrees.filter((t: any) => linkedAdminRootIds.has(String(t.id)));
            if (treesLinkedToBanca.length === 0) return null;

            const adminRedeQ = cardAdminRedeSearch[bancaIdKey] ?? '';
            const treesFiltered = adminRedeQ.trim()
              ? (treesLinkedToBanca.map((t: any) => filterAdminTreeBySearch(t, adminRedeQ)).filter(Boolean) as any[])
              : treesLinkedToBanca;

            const totalRootsLinked = treesLinkedToBanca.length;
            const totalRoots = treesFiltered.length;
            const totalPagesAdminRede = Math.max(1, Math.ceil(totalRoots / ADMIN_REDE_ROOTS_PER_PAGE));
            let adminRedePage = cardAdminRedePage[bancaIdKey] ?? 1;
            if (adminRedePage > totalPagesAdminRede) adminRedePage = totalPagesAdminRede;
            if (adminRedePage < 1) adminRedePage = 1;
            const pagedAdminTrees = treesFiltered.slice(
              (adminRedePage - 1) * ADMIN_REDE_ROOTS_PER_PAGE,
              adminRedePage * ADMIN_REDE_ROOTS_PER_PAGE
            );

            return (
              <div className="mt-8 pt-6 border-t-2 border-violet-200/70 dark:border-violet-900/50">
                <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-1 flex flex-wrap items-center gap-2">
                  <Shield className="w-5 h-5 text-violet-600 dark:text-violet-400 flex-shrink-0" />
                  Rede do admin vinculado a esta banca
                  {totalRootsLinked > 0 && (
                    <span className="text-sm font-normal text-gray-500 dark:text-gray-400">
                      {adminRedeQ.trim()
                        ? `${totalRoots} de ${totalRootsLinked} admin(s) na busca${totalPagesAdminRede > 1 ? ` · pág. ${adminRedePage}/${totalPagesAdminRede}` : ''}`
                        : `${totalRootsLinked} admin${totalRootsLinked !== 1 ? 's' : ''}${totalPagesAdminRede > 1 ? ` · pág. ${adminRedePage}/${totalPagesAdminRede}` : ''}`}
                    </span>
                  )}
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                  Hierarquia por <strong>enroller</strong> dos Admin/Super Admin em <strong>Admins desta banca</strong>. Toda a cadeia abaixo de cada admin é exibida; quando há vários admins na banca, até {ADMIN_REDE_ROOTS_PER_PAGE} raízes por página.
                </p>
                <div className="relative w-full min-w-0 mb-4">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-violet-500 dark:text-violet-400 w-4 h-4 pointer-events-none" />
                  <input
                    type="text"
                    value={adminRedeQ}
                    onChange={(e) => {
                      const v = e.target.value;
                      setCardAdminRedeSearch((prev) => ({ ...prev, [bancaIdKey]: v }));
                      setCardAdminRedePage((p) => ({ ...p, [bancaIdKey]: 1 }));
                    }}
                    placeholder="Buscar na rede (nome ou e-mail)…"
                    className="w-full min-w-0 pl-9 pr-10 py-2.5 text-sm bg-violet-50/80 dark:bg-violet-950/30 border border-violet-200/80 dark:border-violet-800/60 rounded-lg focus:ring-2 focus:ring-violet-400/40 focus:border-violet-400 dark:focus:border-violet-600 text-gray-900 dark:text-white placeholder:text-gray-500 dark:placeholder:text-[#888]"
                    aria-label="Buscar na rede do admin"
                  />
                  {adminRedeQ.trim() !== '' && (
                    <button
                      type="button"
                      onClick={() => {
                        setCardAdminRedeSearch((prev) => {
                          const n = { ...prev };
                          delete n[bancaIdKey];
                          return n;
                        });
                        setCardAdminRedePage((p) => ({ ...p, [bancaIdKey]: 1 }));
                      }}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-gray-500 hover:bg-violet-100 dark:hover:bg-violet-900/40 dark:text-[#aaa]"
                      aria-label="Limpar busca na rede do admin"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
                {totalRoots === 0 && adminRedeQ.trim() ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400 py-4">Nenhuma pessoa na rede corresponde à busca.</p>
                ) : (
                  <>
                    <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4 items-start">
                      {pagedAdminTrees.map((tree: any) => (
                        <div
                          key={tree.id}
                          className="rounded-2xl border border-violet-200/90 dark:border-violet-800/50 bg-gradient-to-b from-violet-50/70 to-white/80 dark:from-violet-950/35 dark:to-[#1a1a1a]/90 p-3 sm:p-4 min-w-0 max-h-[min(75vh,880px)] overflow-y-auto overscroll-contain shadow-sm"
                        >
                          {renderAdminNetworkBranchFull(tree, 0)}
                        </div>
                      ))}
                    </div>
                    {totalPagesAdminRede > 1 && (
                      <div className="mt-4 rounded-lg border border-violet-200 dark:border-violet-800 overflow-hidden bg-white dark:bg-[#2a2a2a]">
                        <Pagination
                          currentPage={adminRedePage}
                          totalPages={totalPagesAdminRede}
                          onPageChange={(p) => {
                            setCardAdminRedePage((prev) => ({ ...prev, [bancaIdKey]: p }));
                          }}
                          itemsPerPage={ADMIN_REDE_ROOTS_PER_PAGE}
                          totalItems={totalRoots}
                        />
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })()}
        </div>
      </div>
    );
  };

  let bancasWhenLoaded: React.ReactNode = null;
  if (dataLoaded && crmBancas && crmBancas.length > 0) {
    const filteredByName = crmBancas.filter((b: any) => {
      const search = bancaSearch.trim().toLowerCase();
      if (!search) return true;
      return String(b.name || '').toLowerCase().includes(search) || String(b.url || '').toLowerCase().includes(search);
    });
    const filteredByDono = filteredByName.filter((crmBanca: any) => {
      const bancaUrlNorm = normalizeBancaUrl(crmBanca.url);
      const owner = (hierarchy || []).find((h: any) => normalizeBancaUrl(h.banca_url) === bancaUrlNorm);
      if (bancaFilter === 'sem_dono' && owner) return false;
      if (bancaFilter === 'com_dono' && !owner) return false;
      return true;
    });
    const filteredBancas = peopleSearch.trim()
      ? filteredByDono.filter((b: any) => peopleQueryMatchesBanca(b, peopleSearch))
      : filteredByDono;
    const pagedBancas = filteredBancas.slice((bancasCurrentPage - 1) * bancasPerPage, bancasCurrentPage * bancasPerPage);
    const bancasList = pagedBancas.map((crmBanca: any) => renderBancaCard(crmBanca));
    bancasWhenLoaded = (
      <>
        {bancasList.length === 0 ? (
          <div className="bg-white dark:bg-[#2a2a2a] rounded-xl shadow-lg border border-gray-200 dark:border-[#404040] p-10 text-center">
            <Search className="w-12 h-12 mx-auto mb-3 text-gray-300 dark:text-[#555]" />
            <p className="text-gray-700 dark:text-gray-300 font-medium">
              {peopleSearch.trim() ? 'Nenhum gerente ou consultor encontrado com esse termo.' : 'Nenhuma banca corresponde aos filtros atuais.'}
            </p>
            {peopleSearch.trim() && (
              <button
                type="button"
                onClick={() => { setPeopleSearch(''); setBancasCurrentPage(1); }}
                className="mt-4 text-sm text-[#E86A24] dark:text-[#00ff00] font-medium hover:underline"
              >
                Limpar busca de pessoas
              </button>
            )}
          </div>
        ) : (
          bancasList
        )}
        {filteredBancas.length > bancasPerPage && (
          <Pagination currentPage={bancasCurrentPage} totalPages={Math.ceil(filteredBancas.length / bancasPerPage)} onPageChange={setBancasCurrentPage} itemsPerPage={bancasPerPage} totalItems={filteredBancas.length} />
        )}
      </>
    );
  } else if (dataLoaded) {
    bancasWhenLoaded = (
      <div className="bg-white dark:bg-[#2a2a2a] rounded-xl shadow-lg border border-gray-200 dark:border-[#404040] p-12 text-center">
        <Building2 className="w-16 h-16 mx-auto mb-4 text-gray-300 dark:text-[#555]" />
        <h3 className="text-xl font-bold text-gray-800 dark:text-white mb-2">Nenhuma banca cadastrada no CRM</h3>
        <p className="text-gray-600 dark:text-[#aaa]">Cadastre bancas em crm_bancas para que elas apareçam aqui.</p>
      </div>
    );
  }

  const bancaPickerQuery = bancaPickerSearch.trim().toLowerCase();
  const bancaPickerFiltered = !bancaPickerQuery
    ? crmBancasBasic || []
    : (crmBancasBasic || []).filter(
        (b: any) =>
          String(b.name || '').toLowerCase().includes(bancaPickerQuery) ||
          String(b.url || '').toLowerCase().includes(bancaPickerQuery) ||
          String(b.id || '').toLowerCase().includes(bancaPickerQuery)
      );

  return (
    <div className="space-y-6 min-w-0 overflow-x-hidden">
      {hierarchyAuditVisible && (
        <div className="bg-slate-900 dark:bg-black/50 text-slate-100 rounded-xl border border-slate-700/90 overflow-hidden shadow-lg">
          <button
            type="button"
            onClick={() => {
              setHierarchyAuditOpen((o) => {
                const next = !o;
                if (next) fetchHierarchyAudit();
                return next;
              });
            }}
            className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-800/70 transition-colors"
          >
            <span className="flex items-center gap-2 font-semibold text-sm sm:text-base">
              <History className="w-5 h-5 text-amber-400 flex-shrink-0" />
              Atividade na rede
              <span className="text-xs font-normal text-slate-500 hidden sm:inline">(quem alterou hierarquia, bancas e perfis)</span>
            </span>
            <ChevronDown className={`w-5 h-5 text-slate-400 flex-shrink-0 transition-transform ${hierarchyAuditOpen ? 'rotate-180' : ''}`} />
          </button>
          {hierarchyAuditOpen && (
            <div className="border-t border-slate-700/80 p-3 sm:p-4 bg-slate-950/60">
              <div className="flex justify-end mb-2">
                <button
                  type="button"
                  onClick={() => fetchHierarchyAudit()}
                  disabled={hierarchyAuditLoading}
                  className="text-xs font-medium text-amber-400 hover:text-amber-300 disabled:opacity-50"
                >
                  {hierarchyAuditLoading ? 'Atualizando…' : 'Atualizar lista'}
                </button>
              </div>
              {hierarchyAuditLoading && hierarchyAuditEntries.length === 0 ? (
                <div className="flex items-center gap-2 text-sm text-slate-400 py-6 justify-center">
                  <Loader2 className="w-5 h-5 animate-spin text-amber-400" />
                  Carregando auditoria…
                </div>
              ) : hierarchyAuditEntries.length === 0 ? (
                <p className="text-sm text-slate-500 py-4">
                  Nenhum evento ainda. Criação de usuários, alterações de cargo/superior, vínculos com bancas e remoções feitas por quem tem acesso à hierarquia aparecem aqui após a tabela{' '}
                  <code className="text-amber-200/80">hierarchy_network_audit</code> existir no banco.
                </p>
              ) : (
                <div className="overflow-x-auto max-h-[min(60vh,480px)] overflow-y-auto rounded-lg border border-slate-700/50">
                  <table className="w-full text-left text-xs sm:text-sm">
                    <thead className="sticky top-0 bg-slate-900/98 z-[1] text-slate-400 border-b border-slate-700/60">
                      <tr>
                        <th className="px-3 py-2 font-medium whitespace-nowrap">Quando</th>
                        <th className="px-3 py-2 font-medium whitespace-nowrap">Quem</th>
                        <th className="px-3 py-2 font-medium whitespace-nowrap">Ação</th>
                        <th className="px-3 py-2 font-medium min-w-[220px]">Resumo</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/90">
                      {hierarchyAuditEntries.map((row: any) => (
                        <tr key={row.id} className="text-slate-200 hover:bg-slate-800/35 align-top">
                          <td className="px-3 py-2 whitespace-nowrap text-slate-400">{formatAuditDate(row.created_at)}</td>
                          <td className="px-3 py-2">
                            <div className="font-medium text-slate-100 break-all">{row.actor_email || row.actor_id}</div>
                            <div className="text-[10px] uppercase tracking-wide text-slate-500">{row.actor_status || '—'}</div>
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap text-amber-200/90 font-mono text-[11px] sm:text-xs">{row.action}</td>
                          <td className="px-3 py-2 text-slate-300 break-words">{row.summary}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Bancas e Hierarquia - exibido primeiro */}
      <div className="space-y-6">
        <div className="bg-white dark:bg-[#2a2a2a] rounded-xl shadow-sm border border-gray-200 dark:border-[#404040] p-3 sm:p-4 flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
            <div className="flex-1 relative w-full min-w-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 dark:text-[#888] w-5 h-5 pointer-events-none" />
              <input type="text" value={bancaSearch} onChange={(e) => { setBancaSearch(e.target.value); setBancasCurrentPage(1); }} placeholder="Pesquisar banca por nome ou URL..." className="w-full min-w-0 pl-10 pr-4 py-2.5 sm:py-2 text-base sm:text-sm bg-gray-100 dark:bg-[#333] border border-gray-200 dark:border-[#555] rounded-lg focus:ring-2 focus:ring-[#E86A24] dark:focus:ring-[#00ff00] focus:border-[#E86A24] dark:focus:border-[#00ff00] text-gray-900 dark:text-white placeholder:text-gray-500 dark:placeholder:text-[#888]" />
            </div>
            <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
              <div className="relative flex-1 sm:flex-none min-w-0 sm:min-w-[220px]" ref={bancaPickerRef}>
                <button
                  type="button"
                  disabled={!bancasDropdownReady}
                  onClick={() => setBancaPickerOpen((o) => !o)}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2.5 sm:py-2 text-base sm:text-sm border border-gray-300 dark:border-[#555] rounded-lg text-gray-700 dark:text-white bg-white dark:bg-[#333] disabled:opacity-60 touch-manipulation text-left"
                  title="Banca(s) a carregar na hierarquia"
                  aria-expanded={bancaPickerOpen}
                  aria-haspopup="listbox"
                >
                  <span className="truncate">
                    {!bancasDropdownReady
                      ? 'Carregando bancas...'
                      : selectedBancaMode === 'all'
                        ? 'Todas as bancas'
                        : (() => {
                            const sel = (crmBancasBasic || []).find((b: any) => String(b.id) === String(selectedBancaMode));
                            return sel ? String(sel.name || sel.url || sel.id) : selectedBancaMode;
                          })()}
                  </span>
                  <ChevronDown className={`w-4 h-4 flex-shrink-0 text-gray-500 dark:text-[#888] transition-transform ${bancaPickerOpen ? 'rotate-180' : ''}`} />
                </button>
                {bancaPickerOpen && bancasDropdownReady && (
                  <div
                    className="absolute z-50 mt-1 w-[min(100vw-2rem,320px)] sm:w-full sm:min-w-[300px] rounded-xl border border-gray-200 dark:border-[#555] bg-white dark:bg-[#2a2a2a] shadow-xl overflow-hidden left-0"
                    role="listbox"
                  >
                    <div className="p-2 border-b border-gray-100 dark:border-[#404040] bg-gray-50/80 dark:bg-[#333]/80">
                      <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-[#888] pointer-events-none" />
                        <input
                          type="text"
                          value={bancaPickerSearch}
                          onChange={(e) => setBancaPickerSearch(e.target.value)}
                          placeholder="Buscar banca por nome, URL ou ID..."
                          className="w-full pl-9 pr-3 py-2 text-sm bg-white dark:bg-[#333] border border-gray-200 dark:border-[#555] rounded-lg text-gray-900 dark:text-white placeholder:text-gray-500 dark:placeholder:text-[#888] focus:ring-2 focus:ring-[#E86A24] dark:focus:ring-[#00ff00] focus:border-transparent"
                          autoFocus
                        />
                      </div>
                    </div>
                    <ul className="max-h-[min(50vh,280px)] overflow-y-auto py-1">
                      <li>
                        <button
                          type="button"
                          role="option"
                          aria-selected={selectedBancaMode === 'all'}
                          onClick={() => {
                            setSelectedBancaMode('all');
                            setBancasCurrentPage(1);
                            setBancaPickerOpen(false);
                            setBancaPickerSearch('');
                          }}
                          className={`w-full text-left px-3 py-2.5 text-sm transition-colors ${selectedBancaMode === 'all' ? 'bg-[#E86A24]/15 dark:bg-[#00ff00]/15 text-[#5a9a2e] dark:text-[#00ff00] font-semibold' : 'text-gray-800 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-[#404040]'}`}
                        >
                          Todas as bancas
                        </button>
                      </li>
                      {bancaPickerFiltered.map((b: any) => (
                        <li key={b.id}>
                          <button
                            type="button"
                            role="option"
                            aria-selected={String(selectedBancaMode) === String(b.id)}
                            onClick={() => {
                              setSelectedBancaMode(String(b.id));
                              setBancasCurrentPage(1);
                              setBancaPickerOpen(false);
                              setBancaPickerSearch('');
                            }}
                            className={`w-full text-left px-3 py-2.5 text-sm transition-colors ${String(selectedBancaMode) === String(b.id) ? 'bg-[#E86A24]/15 dark:bg-[#00ff00]/15 text-[#5a9a2e] dark:text-[#00ff00] font-semibold' : 'text-gray-800 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-[#404040]'}`}
                          >
                            <span className="block truncate">{b.name || b.url || b.id}</span>
                            {b.url && b.name && (
                              <span className="block truncate text-xs text-gray-500 dark:text-[#888] mt-0.5">{String(b.url)}</span>
                            )}
                          </button>
                        </li>
                      ))}
                      {bancaPickerQuery && bancaPickerFiltered.length === 0 && (
                        <li className="px-3 py-4 text-sm text-gray-500 dark:text-[#888] text-center">Nenhuma banca encontrada.</li>
                      )}
                    </ul>
                  </div>
                )}
              </div>
              <button onClick={handleLoadData} disabled={!bancasDropdownReady || dataLoading} className="px-4 py-2.5 sm:py-2 min-h-[44px] sm:min-h-0 bg-[#E86A24] text-white rounded-lg hover:bg-[#D95E1B] transition-colors flex items-center justify-center gap-2 font-medium disabled:opacity-70 text-sm touch-manipulation" title="Carregar dados da hierarquia">
                {dataLoading ? <><Loader2 className="w-4 h-4 animate-spin" /> <span>Carregando...</span></> : <><RefreshCw className="w-4 h-4" /> <span>Carregar dados</span></>}
              </button>
              {dataLoaded && (
                <>
                  <select value={bancaFilter} onChange={(e) => { setBancaFilter(e.target.value as any); setBancasCurrentPage(1); }} className="px-3 py-2.5 sm:py-2 text-base sm:text-sm border border-gray-300 dark:border-[#555] rounded-lg text-gray-700 dark:text-white bg-white dark:bg-[#333] touch-manipulation" title="Filtro de bancas">
                    <option value="all">Todas</option>
                    <option value="sem_dono">Sem dono</option>
                    <option value="com_dono">Com dono</option>
                  </select>
                  <button onClick={() => loadHierarchyData(true)} disabled={dataLoading} className="px-3 py-2.5 sm:py-2 min-h-[44px] sm:min-h-0 border border-gray-300 dark:border-[#555] rounded-lg text-gray-700 dark:text-[#ccc] hover:bg-gray-50 dark:hover:bg-[#333] transition-colors flex items-center gap-2 touch-manipulation" title="Recarregar">
                    <RefreshCw className="w-4 h-4" />
                    <span className="hidden sm:inline">Recarregar</span>
                  </button>
                </>
              )}
            </div>
          </div>
          {dataLoaded && (
            <div className="relative w-full min-w-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 dark:text-[#888] w-5 h-5 pointer-events-none" />
              <input
                type="text"
                value={peopleSearch}
                onChange={(e) => {
                  setPeopleSearch(e.target.value);
                  setBancasCurrentPage(1);
                }}
                placeholder="Buscar gerente ou consultor (nome ou e-mail)..."
                className="w-full min-w-0 pl-10 pr-4 py-2.5 sm:py-2 text-base sm:text-sm bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-200/80 dark:border-emerald-800/60 rounded-lg focus:ring-2 focus:ring-[#E86A24] dark:focus:ring-[#00ff00] focus:border-[#E86A24] dark:focus:border-[#00ff00] text-gray-900 dark:text-white placeholder:text-gray-500 dark:placeholder:text-[#888]"
              />
            </div>
          )}
          {!dataLoaded && (
            <p className="text-sm text-gray-600 dark:text-[#aaa]">Abra o seletor de banca (todas ou uma específica) e clique em <strong>Carregar dados</strong> para exibir a hierarquia.</p>
          )}
        </div>

        {dataLoading ? (
          <div className="bg-white dark:bg-[#2a2a2a] rounded-xl shadow-sm border border-gray-200 dark:border-[#404040] p-12 text-center">
            <Loader2 className="w-12 h-12 mx-auto mb-4 text-[#E86A24] dark:text-[#00ff00] animate-spin" />
            <p className="text-gray-600 dark:text-[#aaa]">Carregando hierarquia...</p>
          </div>
        ) : !dataLoaded ? (
          <div className="bg-white dark:bg-[#2a2a2a] rounded-xl shadow-sm border border-gray-200 dark:border-[#404040] p-12 text-center">
            <Building2 className="w-16 h-16 mx-auto mb-4 text-gray-300 dark:text-[#555]" />
            <p className="text-gray-600 dark:text-[#aaa]">Escolha <strong>Todas as bancas</strong> ou uma banca no seletor e clique em <strong>Carregar dados</strong> para visualizar a hierarquia.</p>
          </div>
        ) : (
          bancasWhenLoaded
        )
      }
      </div>


      {showEditModal && editingUser && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#2a2a2a] rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-gray-200 dark:border-[#404040]">
            <div className="p-6 border-b border-gray-200 dark:border-[#404040] flex items-center justify-between bg-gradient-to-r from-[#E86A24] to-[#D95E1B] dark:from-[#00ff00] dark:to-[#00e600] text-white">
              <h2 className="text-xl font-bold flex items-center gap-2"><EditIcon className="w-6 h-6" /> Editar Usuário</h2>
              <button onClick={() => { setShowEditModal(false); setEditingUser(null); }} className="hover:bg-white/20 p-1.5 rounded-lg transition-colors"><X className="w-6 h-6" /></button>
            </div>
            <form onSubmit={(e) => { e.preventDefault(); handleSaveEdit(); }} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Email</label>
                <input type="email" value={editFormData.email} onChange={(e) => setEditFormData({ ...editFormData, email: e.target.value })} className="w-full px-4 py-2 border border-gray-300 dark:border-[#555] rounded-lg focus:ring-2 focus:ring-[#E86A24] dark:focus:ring-[#00ff00] focus:border-[#E86A24] dark:focus:border-[#00ff00] text-gray-700 dark:text-white bg-white dark:bg-[#333] placeholder:text-gray-500 dark:placeholder:text-[#888]" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Nova Senha (deixe em branco para não alterar)</label>
                <input type="password" value={editFormData.password} onChange={(e) => setEditFormData({ ...editFormData, password: e.target.value })} className="w-full px-4 py-2 border border-gray-300 dark:border-[#555] rounded-lg focus:ring-2 focus:ring-[#E86A24] dark:focus:ring-[#00ff00] focus:border-[#E86A24] dark:focus:border-[#00ff00] text-gray-700 dark:text-white bg-white dark:bg-[#333] placeholder:text-gray-500 dark:placeholder:text-[#888]" placeholder="••••••••" />
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <button type="button" onClick={() => { setShowEditModal(false); setEditingUser(null); }} className="px-4 py-2 border border-gray-300 dark:border-[#555] rounded-lg text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-[#404040] transition-colors">Cancelar</button>
                <button type="submit" className="px-4 py-2 bg-[#E86A24] text-white rounded-lg hover:bg-[#D95E1B] transition-colors font-medium">Salvar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showCreateModal && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#2a2a2a] rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-gray-200 dark:border-[#404040]">
            <div className="p-6 border-b border-gray-200 dark:border-[#404040] flex items-center justify-between bg-gradient-to-r from-blue-600 to-blue-500 text-white">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <UserPlus className="w-6 h-6" />
                Criar {createFormData.status === 'dono_banca' ? 'Dono de Banca' : createFormData.status === 'gestor' ? 'Gestor de Tráfego' : createFormData.status === 'gerente' ? 'Gerente' : 'Consultor'}
              </h2>
              <button onClick={() => { setShowCreateModal(false); setCreateFormData({ email: '', fullName: '', password: '', status: 'consultor', enroller: '', bancaOwnerId: '', bancaName: '', bancaUrl: '', initialBancaIds: [] }); }} className="hover:bg-white/20 p-1.5 rounded-lg transition-colors"><X className="w-6 h-6" /></button>
            </div>
            <form onSubmit={handleCreateUser} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Nome Completo</label>
                <input type="text" value={createFormData.fullName} onChange={(e) => setCreateFormData({ ...createFormData, fullName: e.target.value })} className="w-full px-4 py-2 border border-gray-300 dark:border-[#555] rounded-lg focus:ring-2 focus:ring-[#E86A24] dark:focus:ring-[#00ff00] focus:border-[#E86A24] dark:focus:border-[#00ff00] text-gray-700 dark:text-white bg-white dark:bg-[#333] placeholder:text-gray-500 dark:placeholder:text-[#888]" placeholder="Nome do usuário" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Email *</label>
                <input type="email" value={createFormData.email} onChange={(e) => setCreateFormData({ ...createFormData, email: e.target.value })} className="w-full px-4 py-2 border border-gray-300 dark:border-[#555] rounded-lg focus:ring-2 focus:ring-[#E86A24] dark:focus:ring-[#00ff00] focus:border-[#E86A24] dark:focus:border-[#00ff00] text-gray-700 dark:text-white bg-white dark:bg-[#333] placeholder:text-gray-500 dark:placeholder:text-[#888]" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Senha *</label>
                <input type="password" value={createFormData.password} onChange={(e) => setCreateFormData({ ...createFormData, password: e.target.value })} className="w-full px-4 py-2 border border-gray-300 dark:border-[#555] rounded-lg focus:ring-2 focus:ring-[#E86A24] dark:focus:ring-[#00ff00] focus:border-[#E86A24] dark:focus:border-[#00ff00] text-gray-700 dark:text-white bg-white dark:bg-[#333] placeholder:text-gray-500 dark:placeholder:text-[#888]" required />
              </div>
              {(createFormData.status === 'gerente' || createFormData.status === 'consultor' || createFormData.status === 'gestor') && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    {createFormData.status === 'consultor'
                      ? 'Superior (Gerente ou Admin)'
                      : createFormData.status === 'gestor'
                        ? 'Superior (Dono da banca, Admin ou Super Admin) — opcional'
                        : 'Selecionar Dono da Banca'}
                  </label>
                  <select
                    value={createFormData.enroller}
                    onChange={(e) => setCreateFormData({ ...createFormData, enroller: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-[#555] rounded-lg focus:ring-2 focus:ring-[#E86A24] dark:focus:ring-[#00ff00] focus:border-[#E86A24] dark:focus:border-[#00ff00] text-gray-700 dark:text-white bg-white dark:bg-[#333]"
                  >
                    <option value="">
                      {createFormData.status === 'consultor' ? 'Selecione...' : 'Sem superior (opcional)'}
                    </option>
                    {createFormData.status === 'consultor'
                      ? getSuperioresParaConsultor(createFormData.initialBancaIds?.[0] ?? null).map((g: any) => (
                          <option key={g.id} value={g.id}>
                            {[g.full_name || g.email, g.status === 'admin' || g.status === 'super_admin' ? `(${g.status})` : ''].filter(Boolean).join(' ')}
                          </option>
                        ))
                      : createFormData.status === 'gestor'
                        ? getSuperioresParaGestor().map((s: any) => (
                            <option key={s.id} value={s.id}>
                              {[
                                s.full_name || s.email,
                                s.status === 'super_admin'
                                  ? '(Super Admin)'
                                  : s.status === 'admin'
                                    ? '(Admin)'
                                    : '(Dono da banca)',
                              ].join(' ')}
                            </option>
                          ))
                        : (hierarchy || []).map((h: any) => (
                            <option key={h.id} value={h.id}>
                              {h.banca_name || h.email}
                            </option>
                          ))}
                  </select>
                </div>
              )}
              {createFormData.status === 'dono_banca' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Nome da Banca *</label>
                    <input type="text" value={createFormData.bancaName} onChange={(e) => setCreateFormData({ ...createFormData, bancaName: e.target.value })} className="w-full px-4 py-2 border border-gray-300 dark:border-[#555] rounded-lg focus:ring-2 focus:ring-[#E86A24] dark:focus:ring-[#00ff00] focus:border-[#E86A24] dark:focus:border-[#00ff00] text-gray-700 dark:text-white bg-white dark:bg-[#333] placeholder:text-gray-500 dark:placeholder:text-[#888]" required />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">URL da Banca *</label>
                    <input type="text" value={createFormData.bancaUrl} onChange={(e) => setCreateFormData({ ...createFormData, bancaUrl: e.target.value })} className="w-full px-4 py-2 border border-gray-300 dark:border-[#555] rounded-lg focus:ring-2 focus:ring-[#E86A24] dark:focus:ring-[#00ff00] focus:border-[#E86A24] dark:focus:border-[#00ff00] text-gray-700 dark:text-white bg-white dark:bg-[#333] placeholder:text-gray-500 dark:placeholder:text-[#888]" placeholder="exemplo.com/api/crm" required />
                  </div>
                </>
              )}
              <div className="flex justify-end gap-3 pt-4">
                <button type="button" onClick={() => { setShowCreateModal(false); setCreateFormData({ email: '', fullName: '', password: '', status: 'consultor', enroller: '', bancaOwnerId: '', bancaName: '', bancaUrl: '', initialBancaIds: [] }); }} disabled={createLoading} className="px-4 py-2 border border-gray-300 dark:border-[#555] rounded-lg text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-[#404040] transition-colors disabled:opacity-50 disabled:cursor-not-allowed">Cancelar</button>
                <button type="submit" disabled={createLoading} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2 min-w-[100px]">
                  {createLoading ? <><Loader2 className="w-4 h-4 animate-spin" /> Criando...</> : 'Criar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showImportConsultantsModal && importConsultantsContext && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#2a2a2a] rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden border border-gray-200 dark:border-[#404040] max-h-[90vh] flex flex-col">
            <div className="p-4 sm:p-6 border-b border-gray-200 dark:border-[#404040] flex items-center justify-between bg-gradient-to-r from-slate-600 to-slate-500 text-white flex-shrink-0">
              <h2 className="text-lg sm:text-xl font-bold flex items-center gap-2">
                <FileUp className="w-5 h-5 sm:w-6 sm:h-6" />
                Importar consultores (CSV)
              </h2>
              <button type="button" onClick={() => { setShowImportConsultantsModal(false); setImportConsultantsContext(null); setImportConsultantsRows([]); setImportConsultantsError(null); }} className="hover:bg-white/20 p-1.5 rounded-lg transition-colors" aria-label="Fechar"><X className="w-6 h-6" /></button>
            </div>
            <div className="p-4 sm:p-6 overflow-y-auto space-y-4 flex-1 min-h-0">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Banca: <strong className="text-gray-900 dark:text-white">{importConsultantsContext.bancaName || importConsultantsContext.bancaId}</strong>. Máximo {MAX_IMPORT_CONSULTANTS} consultores por importação.
              </p>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Superior (Gerente ou Admin) *</label>
                <select value={importConsultantsGerenteId} onChange={(e) => setImportConsultantsGerenteId(e.target.value)} className="w-full px-4 py-2 border border-gray-300 dark:border-[#555] rounded-lg focus:ring-2 focus:ring-[#E86A24] dark:focus:ring-[#00ff00] focus:border-[#E86A24] dark:focus:border-[#00ff00] text-gray-700 dark:text-white bg-white dark:bg-[#333]">
                  <option value="">Selecione...</option>
                  {getSuperioresParaConsultor(importConsultantsContext.bancaId).map((m: any) => (
                    <option key={m.id} value={m.id}>
                      {[m.full_name || m.email, m.status === 'admin' || m.status === 'super_admin' ? `(${m.status})` : ''].filter(Boolean).join(' ')}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Arquivo CSV</label>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">Cabeçalho: <code className="bg-gray-100 dark:bg-[#333] px-1 rounded">nome</code>, <code className="bg-gray-100 dark:bg-[#333] px-1 rounded">email</code>, <code className="bg-gray-100 dark:bg-[#333] px-1 rounded">senha</code> (ou name, password). UTF-8.</p>
                <input type="file" accept=".csv,.txt" onChange={handleImportCsvChange} className="w-full text-sm text-gray-600 dark:text-gray-400 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-slate-100 dark:file:bg-[#404040] file:text-slate-700 dark:file:text-gray-200" />
              </div>
              {importConsultantsError && (
                <div className="rounded-lg bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 p-3 text-sm text-red-700 dark:text-red-300">{importConsultantsError}</div>
              )}
              {importConsultantsRows.length > 0 && (
                <div>
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Preview ({importConsultantsRows.length} consultor{importConsultantsRows.length !== 1 ? 'es' : ''})</p>
                  <div className="border border-gray-200 dark:border-[#404040] rounded-lg overflow-hidden max-h-48 overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 dark:bg-[#333] sticky top-0">
                        <tr>
                          <th className="text-left py-2 px-3 text-gray-700 dark:text-gray-300 font-medium">Nome</th>
                          <th className="text-left py-2 px-3 text-gray-700 dark:text-gray-300 font-medium">Email</th>
                          <th className="text-left py-2 px-3 text-gray-700 dark:text-gray-300 font-medium">Senha</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-[#404040]">
                        {importConsultantsRows.map((row, i) => (
                          <tr key={i} className="bg-white dark:bg-[#2a2a2a]">
                            <td className="py-2 px-3 text-gray-900 dark:text-white truncate max-w-[120px]" title={row.nome}>{row.nome || '—'}</td>
                            <td className="py-2 px-3 text-gray-700 dark:text-gray-300 truncate max-w-[140px]" title={row.email}>{row.email}</td>
                            <td className="py-2 px-3 text-gray-500 dark:text-gray-400">{row.senha ? '••••••' : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
            <div className="p-4 sm:p-6 border-t border-gray-200 dark:border-[#404040] flex justify-end gap-3 flex-shrink-0">
              <button type="button" onClick={() => { setShowImportConsultantsModal(false); setImportConsultantsContext(null); setImportConsultantsRows([]); setImportConsultantsError(null); }} className="px-4 py-2 border border-gray-300 dark:border-[#555] rounded-lg text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-[#404040] transition-colors">Cancelar</button>
              <button type="button" onClick={handleImportConsultants} disabled={importConsultantsLoading || !importConsultantsGerenteId || importConsultantsRows.length === 0} className="px-4 py-2 bg-slate-600 text-white rounded-lg hover:bg-slate-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2">
                {importConsultantsLoading ? <><Loader2 className="w-4 h-4 animate-spin" /> Importando...</> : `Importar ${importConsultantsRows.length} consultor${importConsultantsRows.length !== 1 ? 'es' : ''}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {showFixModal && fixingIssue && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#2a2a2a] rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-gray-200 dark:border-[#404040]">
            <div className="p-6 border-b border-gray-200 dark:border-[#404040] flex items-center justify-between bg-gradient-to-r from-amber-600 to-amber-500 text-white">
              <h2 className="text-xl font-bold flex items-center gap-2"><AlertCircle className="w-6 h-6" /> Corrigir Problema</h2>
              <button onClick={() => { setShowFixModal(false); setFixingIssue(null); setSelectedEnroller(''); }} className="hover:bg-white/20 p-1.5 rounded-lg transition-colors"><X className="w-6 h-6" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-4">
                <p className="text-sm font-medium text-red-800 dark:text-red-300 mb-1">Usuário:</p>
                <p className="text-sm text-red-700 dark:text-red-200">{fixingIssue.email}</p>
                <p className="text-sm font-medium text-red-800 dark:text-red-300 mt-2 mb-1">Problema:</p>
                <p className="text-sm text-red-700 dark:text-red-200">{fixingIssue.issue}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Banca (CRM)</label>
                <select value={selectedFixBancaId} onChange={(e) => { setSelectedFixBancaId(e.target.value); setSelectedEnroller(''); }} className="w-full px-4 py-2 border border-gray-300 dark:border-[#555] dark:bg-[#333] dark:text-white rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-gray-700">
                  <option value="">Selecione...</option>
                  {(crmBancas || []).map((b: any) => <option key={b.id} value={String(b.id)}>{b.name} ({normalizeBancaUrl(b.url)})</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Cargo</label>
                <select value={selectedFixRole} onChange={(e) => { setSelectedFixRole(e.target.value as any); setSelectedEnroller(''); }} className="w-full px-4 py-2 border border-gray-300 dark:border-[#555] dark:bg-[#333] dark:text-white rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-gray-700">
                  <option value="dono_banca">Dono de banca</option>
                  <option value="gerente">Gerente</option>
                  <option value="consultor">Consultor</option>
                </select>
              </div>
              {selectedFixRole === 'consultor' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Superior (Gerente ou Admin)</label>
                  <select value={selectedEnroller} onChange={(e) => setSelectedEnroller(e.target.value)} className="w-full px-4 py-2 border border-gray-300 dark:border-[#555] dark:bg-[#333] dark:text-white rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-gray-700">
                    <option value="">Selecione...</option>
                    {selectedFixBancaId && getSuperioresParaConsultor(selectedFixBancaId).map((m: any) => (
                      <option key={m.id} value={m.id}>
                        {[m.full_name || m.email, m.status === 'admin' || m.status === 'super_admin' ? `(${m.status})` : ''].filter(Boolean).join(' ')}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="flex justify-end gap-3 pt-4">
                <button type="button" onClick={() => { setShowFixModal(false); setFixingIssue(null); setSelectedEnroller(''); }} className="px-4 py-2 border border-gray-300 dark:border-[#555] rounded-lg text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-[#404040] transition-colors">Cancelar</button>
                <button onClick={handleSaveFix} disabled={!selectedFixBancaId || (selectedFixRole === 'consultor' && !selectedEnroller)} className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed">Corrigir</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showAssignModal && assignFormData && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#2a2a2a] rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden border border-gray-200 dark:border-[#404040]">
            <div className="p-6 border-b border-gray-200 dark:border-[#404040] flex items-center justify-between bg-gradient-to-r from-teal-600 to-teal-500 text-white">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <UserCheck className="w-6 h-6" />
                Atribuir {assignFormData.status === 'dono_banca' ? 'Dono de Banca' : assignFormData.status === 'gerente' ? 'Gerente' : 'Consultor'}
              </h2>
              <button onClick={() => { setShowAssignModal(false); setAssignFormData(null); setAssignSelectedUserIds([]); }} className="hover:bg-white/20 p-1.5 rounded-lg transition-colors"><X className="w-6 h-6" /></button>
            </div>
            <div className="p-6 space-y-4">
              {assignFormData.status === 'gerente' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Superior (opcional)</label>
                  <select value={assignFormData.enroller || ''} onChange={(e) => setAssignFormData((prev: any) => prev ? { ...prev, enroller: e.target.value } : prev)} className="w-full px-4 py-2 border border-gray-300 dark:border-[#555] dark:bg-[#333] dark:text-white rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 text-gray-700 dark:text-white">
                    <option value="">Sem superior</option>
                    {(allUsers || [])
                      .filter((u: any) => u && (u.status === 'dono_banca' || u.status === 'gerente' || u.status === 'admin' || u.status === 'super_admin'))
                      .map((u: any) => (
                        <option key={u.id} value={u.id}>{[u.full_name || u.email, `(${u.status})`].filter(Boolean).join(' ')}</option>
                      ))}
                  </select>
                </div>
              )}
              {assignFormData.status === 'consultor' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Superior (Gerente ou Admin)</label>
                  <select value={assignFormData.enroller} onChange={(e) => setAssignFormData((prev: any) => prev ? { ...prev, enroller: e.target.value } : prev)} className="w-full px-4 py-2 border border-gray-300 dark:border-[#555] dark:bg-[#333] dark:text-white rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 text-gray-700 dark:text-white">
                    <option value="">Selecione...</option>
                    {getSuperioresParaConsultor(assignFormData.bancaId).map((m: any) => (
                      <option key={m.id} value={m.id}>
                        {[m.full_name || m.email, m.status === 'admin' || m.status === 'super_admin' ? `(${m.status})` : ''].filter(Boolean).join(' ')}
                      </option>
                    ))}
                  </select>
                  {!assignFormData.enroller && getSuperioresParaConsultor(assignFormData.bancaId).length === 0 && (
                    <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">Não há gerente nesta banca nem admin na lista. Adicione um gerente ou verifique se os admins estão carregados.</p>
                  )}
                </div>
              )}
              <p className="text-sm text-gray-600 dark:text-gray-400">Selecione um ou mais usuários que já possuem conta para atribuir a esse cargo:</p>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Buscar usuário</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500 dark:text-gray-400" />
                  <input type="text" value={assignUserSearch} onChange={(e) => setAssignUserSearch(e.target.value)} placeholder="Nome ou email..." className="w-full pl-10 pr-4 py-2 bg-gray-100 dark:bg-[#333] border border-gray-200 dark:border-[#555] dark:text-white rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 text-gray-900 placeholder:text-gray-500 dark:placeholder:text-gray-400" />
                </div>
              </div>
              {assignSelectedUserIds.length > 0 && (
                <p className="text-xs text-teal-600 dark:text-teal-400 font-medium">{assignSelectedUserIds.length} usuário(s) selecionado(s)</p>
              )}
              <div className="max-h-64 overflow-y-auto border border-gray-200 dark:border-[#404040] rounded-lg divide-y divide-gray-100 dark:divide-[#404040]">
                {(() => {
                  const search = assignUserSearch.trim().toLowerCase();
                  const filtered = (allUsers || []).filter((u: any) => {
                    if (!u.email) return false;
                    return !search || (u.email || '').toLowerCase().includes(search) || (u.full_name || '').toLowerCase().includes(search);
                  });
                  const selectedGerenteId = assignFormData.status === 'consultor' ? assignFormData.enroller : null;
                  return filtered.length > 0 ? filtered.map((u: any) => {
                    const alreadyAssignedToThisGerente = selectedGerenteId && u.status === 'consultor' && u.enroller === selectedGerenteId;
                    return (
                      <button key={u.id} type="button" onClick={() => toggleAssignUser(u.id)} className={`w-full px-4 py-3 text-left flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-[#333] transition-colors ${assignSelectedUserIds.includes(u.id) ? 'bg-teal-50 dark:bg-teal-900/30 border-l-4 border-teal-500' : ''} ${alreadyAssignedToThisGerente ? 'border-l-4 border-amber-400 bg-amber-50/50 dark:bg-amber-900/20' : ''}`}>
                        <div className="w-10 h-10 rounded-full bg-gray-200 dark:bg-[#404040] flex items-center justify-center font-bold text-gray-600 dark:text-gray-300 flex-shrink-0">{(u.full_name || u.email)[0]?.toUpperCase() || '?'}</div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-gray-900 dark:text-white truncate">{u.full_name || 'Sem nome'}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{u.email}</p>
                          <div className="flex flex-wrap items-center gap-1.5 mt-1">
                            <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-gray-100 dark:bg-[#404040] text-gray-600 dark:text-gray-300">{u.status}</span>
                            {alreadyAssignedToThisGerente && (
                              <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 border border-amber-200 dark:border-amber-700" title="Este consultor já está atribuído a este superior">
                                Já atribuído
                              </span>
                            )}
                          </div>
                        </div>
                        {assignSelectedUserIds.includes(u.id) && <CheckCircle2 className="w-5 h-5 text-teal-600 dark:text-teal-400 flex-shrink-0" />}
                      </button>
                    );
                  }) : (
                    <div className="px-4 py-8 text-center text-gray-500 dark:text-gray-400 text-sm">Nenhum usuário encontrado. Verifique se há usuários cadastrados.</div>
                  );
                })()}
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <button type="button" onClick={() => { setShowAssignModal(false); setAssignFormData(null); setAssignSelectedUserIds([]); }} className="px-4 py-2 border border-gray-300 dark:border-[#555] rounded-lg text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-[#404040] transition-colors">Cancelar</button>
                <button onClick={handleAssignUser} disabled={assignSelectedUserIds.length === 0 || assignLoading || (assignFormData.status === 'consultor' && !assignFormData.enroller)} className="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2">
                  {assignLoading ? <><Loader2 className="w-4 h-4 animate-spin" /> Atribuindo...</> : `Atribuir${assignSelectedUserIds.length > 0 ? ` (${assignSelectedUserIds.length})` : ''}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showMoveConsultantsModal && moveContext && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#2a2a2a] rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden border border-gray-200 dark:border-[#404040]">
            <div className="p-6 border-b border-gray-200 dark:border-[#404040] flex items-center justify-between bg-gradient-to-r from-amber-500 to-amber-600 text-white">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <ArrowRightLeft className="w-6 h-6" />
                Mover consultores
              </h2>
              <button onClick={() => { setShowMoveConsultantsModal(false); setMoveContext(null); setMoveSelectedConsultantIds([]); setMoveTargetGerenteId(''); setMoveConsultantSearch(''); }} className="hover:bg-white/20 p-1.5 rounded-lg transition-colors"><X className="w-6 h-6" /></button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Gerente atual: <strong className="text-gray-900 dark:text-white">{moveContext.sourceGerente.full_name || moveContext.sourceGerente.email}</strong>
              </p>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Selecione os consultores a mover:</label>
                  {(() => {
                    const subordinates = moveContext.sourceGerente.subordinates || [];
                    const search = moveConsultantSearch.trim().toLowerCase();
                    const filtered = search ? subordinates.filter((c: any) => (String(c.full_name || '').toLowerCase().includes(search) || String(c.email || '').toLowerCase().includes(search))) : subordinates;
                    return filtered.length > 0 && (
                      <button type="button" onClick={() => {
                        const ids = filtered.map((c: any) => c.id);
                        const allSelected = ids.every((id: string) => moveSelectedConsultantIds.includes(id));
                        setMoveSelectedConsultantIds(allSelected ? moveSelectedConsultantIds.filter((id) => !ids.includes(id)) : [...new Set([...moveSelectedConsultantIds, ...ids])]);
                      }} className="text-xs text-amber-600 dark:text-amber-400 hover:underline font-medium">
                        {filtered.every((c: any) => moveSelectedConsultantIds.includes(c.id)) ? 'Desmarcar todos' : 'Selecionar todos'}
                      </button>
                    );
                  })()}
                </div>
                <div className="relative mb-2">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 dark:text-gray-400" />
                  <input type="text" value={moveConsultantSearch} onChange={(e) => setMoveConsultantSearch(e.target.value)} placeholder="Buscar por nome ou e-mail..." className="w-full pl-9 pr-4 py-2 bg-gray-100 dark:bg-[#333] border border-gray-200 dark:border-[#555] dark:text-white rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-gray-900 placeholder:text-gray-500 dark:placeholder:text-gray-400" />
                </div>
                <div className="max-h-48 overflow-y-auto border border-gray-200 dark:border-[#404040] rounded-lg divide-y divide-gray-100 dark:divide-[#404040]">
                  {(() => {
                    const subordinates = moveContext.sourceGerente.subordinates || [];
                    const search = moveConsultantSearch.trim().toLowerCase();
                    const filtered = search ? subordinates.filter((c: any) => (String(c.full_name || '').toLowerCase().includes(search) || String(c.email || '').toLowerCase().includes(search))) : subordinates;
                    return filtered.length > 0 ? filtered.map((c: any) => (
                    <button key={c.id} type="button" onClick={() => toggleMoveConsultant(c.id)} className={`w-full px-4 py-3 text-left flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-[#333] transition-colors ${moveSelectedConsultantIds.includes(c.id) ? 'bg-amber-50 dark:bg-amber-900/30 border-l-4 border-amber-500' : ''}`}>
                      <div className="w-9 h-9 rounded-full bg-green-200 dark:bg-green-900/50 flex items-center justify-center font-bold text-green-800 dark:text-green-300 text-sm flex-shrink-0">{(c.full_name || c.email)[0]?.toUpperCase() || '?'}</div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 dark:text-white truncate">{c.full_name || 'Sem nome'}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{c.email}</p>
                      </div>
                      {moveSelectedConsultantIds.includes(c.id) && <CheckCircle2 className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0" />}
                    </button>
                  )) : (
                    <div className="px-4 py-6 text-center text-gray-500 dark:text-gray-400 text-sm">
                      {moveConsultantSearch.trim() ? `Nenhum consultor encontrado com "${moveConsultantSearch.trim()}"` : 'Nenhum consultor na lista'}
                    </div>
                  );
                  })()}
                </div>
                {moveSelectedConsultantIds.length > 0 && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 font-medium mt-2">{moveSelectedConsultantIds.length} selecionado(s)</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Mover para (gerente ou admin):</label>
                <select value={moveTargetGerenteId} onChange={(e) => setMoveTargetGerenteId(e.target.value)} className="w-full border border-gray-300 dark:border-[#555] dark:bg-[#333] dark:text-white rounded-lg px-4 py-2 text-gray-700 focus:ring-2 focus:ring-amber-500 focus:border-amber-500">
                  <option value="">Selecione o destino</option>
                  {(() => {
                    const subs = (moveContext.owner.subordinates || []).filter(
                      (g: any) => g?.id && g.id !== moveContext.sourceGerente.id && g.status === 'gerente'
                    );
                    const admins = (allUsers || []).filter(
                      (u: any) => u && (u.status === 'admin' || u.status === 'super_admin')
                    );
                    const seen = new Set(subs.map((g: any) => g.id));
                    const opts = [...subs, ...admins.filter((a: any) => a?.id && !seen.has(a.id))];
                    return opts.map((g: any) => (
                      <option key={g.id} value={g.id}>
                        {[g.full_name || g.email, g.status === 'admin' || g.status === 'super_admin' ? `(${g.status})` : ''].filter(Boolean).join(' ')}
                      </option>
                    ));
                  })()}
                </select>
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <button type="button" onClick={() => { setShowMoveConsultantsModal(false); setMoveContext(null); setMoveSelectedConsultantIds([]); setMoveTargetGerenteId(''); setMoveConsultantSearch(''); }} className="px-4 py-2 border border-gray-300 dark:border-[#555] rounded-lg text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-[#404040] transition-colors">Cancelar</button>
                <button onClick={handleMoveConsultants} disabled={moveSelectedConsultantIds.length === 0 || !moveTargetGerenteId || moveLoading} className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2">
                  {moveLoading ? <><Loader2 className="w-4 h-4 animate-spin" /> Movendo...</> : `Mover (${moveSelectedConsultantIds.length || 0})`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ToastContainer toasts={toasts} onClose={removeToast} />
    </div>
  );
}
