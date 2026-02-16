'use client';

import React, { useState, useEffect } from 'react';
import {
  AlertCircle,
  ArrowRightLeft,
  Building2,
  CheckCircle2,
  Clock,
  Edit as EditIcon,
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
  X,
} from 'lucide-react';
import Pagination from '@/components/Admin/Pagination';

export default function HierarchySection({ userId }: { userId: string | null }) {
  const [hierarchy, setHierarchy] = useState<any[]>([]);
  const [issues, setIssues] = useState<any[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
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
  const [crmTimeData, setCrmTimeData] = useState<Record<string, number>>({});
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
  const [showMoveConsultantsModal, setShowMoveConsultantsModal] = useState(false);
  const [moveContext, setMoveContext] = useState<{ owner: any; sourceGerente: any; crmBanca: any } | null>(null);
  const [moveSelectedConsultantIds, setMoveSelectedConsultantIds] = useState<string[]>([]);
  const [moveTargetGerenteId, setMoveTargetGerenteId] = useState('');
  const [moveConsultantSearch, setMoveConsultantSearch] = useState('');
  const [moveLoading, setMoveLoading] = useState(false);

  const addGestorToBanca = async (gestorId: string, bancaId: string) => {
    if (!userId) return;
    setGestorBancaLoading(bancaId);
    try {
      const getRes = await fetch(`/api/admin/users/${gestorId}/bancas`, { headers: { 'X-User-Id': userId } });
      const getData = await getRes.json();
      const current = (getData.data?.banca_ids || []) as string[];
      if (current.includes(bancaId)) {
        setGestorBancaLoading(null);
        return;
      }
      const putRes = await fetch(`/api/admin/users/${gestorId}/bancas`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
        body: JSON.stringify({ banca_ids: [...current, bancaId] }),
      });
      if (putRes.ok) loadHierarchyData();
      else alert((await putRes.json()).error || 'Erro ao adicionar gestor');
    } catch (e) {
      console.error(e);
      alert('Erro ao adicionar gestor');
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
      const next = current.filter((id: string) => id !== bancaId);
      const putRes = await fetch(`/api/admin/users/${gestorId}/bancas`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
        body: JSON.stringify({ banca_ids: next }),
      });
      if (putRes.ok) loadHierarchyData();
      else alert((await putRes.json()).error || 'Erro ao remover gestor');
    } catch (e) {
      console.error(e);
      alert('Erro ao remover gestor');
    } finally {
      setGestorBancaLoading(null);
    }
  };

  useEffect(() => {
    if (userId) loadInitialData();
  }, [userId]);

  const loadInitialData = async () => {
    setInitialLoading(true);
    try {
      const [issuesRes, bancasRes] = await Promise.all([
        fetch('/api/admin/users/validate-hierarchy', { headers: { 'X-User-Id': userId! } }),
        fetch('/api/admin/crm/bancas', { headers: { 'X-User-Id': userId! } }),
      ]);
      if (issuesRes.ok) {
        const data = await issuesRes.json();
        setIssues(data.data?.issues || []);
      }
      if (bancasRes.ok) {
        const data = await bancasRes.json();
        setCrmBancasBasic(data.data || []);
        setCrmBancas(data.data || []);
      }
    } catch (error) {
      console.error('Erro ao carregar dados iniciais:', error);
    } finally {
      setInitialLoading(false);
    }
  };

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
      if (usersRes.ok) {
        const data = await usersRes.json();
        setAllUsers(data.data || []);
      }
      if (bancasRes.ok) {
        const data = await bancasRes.json();
        const loaded = data.data || [];
        setCrmBancas(loaded);
        if (!bancaId && crmBancasBasic.length === 0) setCrmBancasBasic(loaded);
      }
      setDataLoaded(true);
    } catch (error) {
      console.error('Erro ao carregar hierarquia:', error);
    } finally {
      setDataLoading(false);
    }
  };

  const handleLoadData = () => {
    loadHierarchyData(true);
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
        alert('Usuário atualizado com sucesso!');
        setShowEditModal(false);
        setEditingUser(null);
        loadHierarchyData();
      } else {
        alert(data.message || 'Erro ao atualizar usuário');
      }
    } catch (error) {
      console.error('Erro ao atualizar usuário:', error);
      alert('Erro ao atualizar usuário');
    }
  };

  const findOwnerByCrmBanca = (crmBancaId: string) => {
    const banca = (crmBancas || []).find((b: any) => String(b.id) === String(crmBancaId));
    if (!banca) return null;
    const bancaUrlNorm = normalizeBancaUrl(banca.url);
    return (hierarchy || []).find((h: any) => normalizeBancaUrl(h.banca_url) === bancaUrlNorm) || null;
  };

  const getManagersByCrmBanca = (crmBancaId: string) => {
    const owner = findOwnerByCrmBanca(crmBancaId);
    if (owner?.subordinates?.length) return owner.subordinates;
    const banca = (crmBancas || []).find((b: any) => String(b.id) === String(crmBancaId));
    if (!banca?.user_ids?.length) return [];
    return (banca.user_ids || [])
      .map((uid: string) => allUsers.find((x: any) => x.id === uid))
      .filter((u: any) => u && u.status === 'gerente');
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
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
        alert(`${createFormData.status === 'dono_banca' ? 'Dono de banca' : createFormData.status === 'gestor' ? 'Gestor de Tráfego' : createFormData.status === 'gerente' ? 'Gerente' : 'Consultor'} criado com sucesso!`);
        setShowCreateModal(false);
        setCreateFormData({ email: '', fullName: '', password: '', status: 'consultor', enroller: '', bancaOwnerId: '', bancaName: '', bancaUrl: '', initialBancaIds: [] });
        loadHierarchyData();
      } else {
        alert(data.message || 'Erro ao criar usuário');
      }
    } catch (error) {
      console.error('Erro ao criar usuário:', error);
      alert('Erro ao criar usuário');
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
          alert('Usuário não encontrado');
        }
      }
    } catch (error) {
      console.error('Erro ao buscar informações do usuário:', error);
      alert('Erro ao buscar informações do usuário');
    }
  };

  const handleSaveFix = async () => {
    if (!fixingIssue || !selectedFixBancaId) {
      alert('Selecione uma banca');
      return;
    }
    const selectedBanca = (crmBancas || []).find((b: any) => String(b.id) === String(selectedFixBancaId));
    if (!selectedBanca) {
      alert('Banca inválida');
      return;
    }
    const owner = findOwnerByCrmBanca(selectedFixBancaId);
    if (selectedFixRole === 'gerente' && !owner) {
      alert('Essa banca ainda não tem Dono cadastrado. Crie o Dono primeiro.');
      return;
    }
    if (selectedFixRole === 'consultor') {
      const managers = getManagersByCrmBanca(selectedFixBancaId);
      if (!managers || managers.length === 0) {
        alert('Essa banca ainda não tem Gerentes cadastrados. Crie um Gerente primeiro.');
        return;
      }
      if (!selectedEnroller) {
        alert('Selecione um gerente');
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
        alert('Problema corrigido com sucesso!');
        setShowFixModal(false);
        setFixingIssue(null);
        setSelectedFixBancaId('');
        setSelectedFixRole('gerente');
        setSelectedEnroller('');
        loadHierarchyData();
      } else {
        alert(data.message || 'Erro ao corrigir problema');
      }
    } catch (error) {
      console.error('Erro ao corrigir problema:', error);
      alert('Erro ao corrigir problema');
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
      alert('Selecione um ou mais consultores e o gerente de destino.');
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
        alert(successCount > 0 ? `${successCount} movido(s). Falhas:\n${errors.join('\n')}` : `Falhas:\n${errors.join('\n')}`);
      }
      if (successCount > 0) {
        alert(successCount === 1 ? 'Consultor movido com sucesso!' : `${successCount} consultores movidos com sucesso!`);
        setShowMoveConsultantsModal(false);
        setMoveContext(null);
        setMoveSelectedConsultantIds([]);
        setMoveTargetGerenteId('');
        loadHierarchyData();
      }
    } catch (e) {
      console.error(e);
      alert('Erro ao mover consultores');
    } finally {
      setMoveLoading(false);
    }
  };

  const handleAssignUser = async () => {
    if (!assignFormData || assignSelectedUserIds.length === 0) {
      alert('Selecione um ou mais usuários');
      return;
    }
    if (assignFormData.status === 'consultor' && !assignFormData.enroller) {
      alert('Consultor deve ser atribuído a um gerente. Cadastre um gerente na banca primeiro.');
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
        payload.enroller = assignFormData.enroller || null;
      }

      let successCount = 0;
      const errors: string[] = [];

      for (const assignSelectedUserId of assignSelectedUserIds) {
        const res = await fetch(`/api/admin/users/${assignSelectedUserId}/update`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'X-User-Id': userId! },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          const u = (allUsers || []).find((x: any) => x.id === assignSelectedUserId);
          errors.push(u ? `${u.full_name || u.email}: ${data.message || 'Erro'}` : data.message || 'Erro');
          continue;
        }
        if (assignFormData.status === 'gerente' || assignFormData.status === 'consultor') {
          const getRes = await fetch(`/api/admin/users/${assignSelectedUserId}/bancas`, { headers: { 'X-User-Id': userId! } });
          const getData = await getRes.json();
          const currentIds = (getData.data?.banca_ids || []) as string[];
          if (!currentIds.includes(assignFormData.bancaId)) {
            const putRes = await fetch(`/api/admin/users/${assignSelectedUserId}/bancas`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json', 'X-User-Id': userId! },
              body: JSON.stringify({ banca_ids: [...currentIds, assignFormData.bancaId] }),
            });
            if (!putRes.ok) {
              const putData = await putRes.json();
              const u = (allUsers || []).find((x: any) => x.id === assignSelectedUserId);
              errors.push(u ? `${u.full_name || u.email}: ${putData.error || 'Erro ao vincular'}` : putData.error || 'Erro');
              continue;
            }
          }
        }
        successCount++;
      }

      if (errors.length > 0) {
        alert(successCount > 0 ? `${successCount} atribuído(s). Falhas:\n${errors.join('\n')}` : `Falhas:\n${errors.join('\n')}`);
      }
      if (successCount > 0) {
        const label = assignFormData.status === 'dono_banca' ? 'Dono(s) de banca' : assignFormData.status === 'gerente' ? 'Gerente(s)' : 'Consultor(es)';
        alert(successCount === 1 ? `${label} atribuído com sucesso!` : `${successCount} ${label} atribuídos com sucesso!`);
        setShowAssignModal(false);
        setAssignFormData(null);
        setAssignSelectedUserIds([]);
        loadHierarchyData();
      }
    } catch (error) {
      console.error('Erro ao atribuir usuário:', error);
      alert('Erro ao atribuir usuário');
    } finally {
      setAssignLoading(false);
    }
  };

  const loading = initialLoading || dataLoading;

  const renderUserCard = (user: any, role: 'dono' | 'gerente' | 'consultor', bancaId?: string) => {
    const roleConfig = {
      dono: { color: 'emerald', bg: 'bg-emerald-500', label: 'Dono de Banca', icon: Building2 },
      gerente: { color: 'blue', bg: 'bg-blue-500', label: 'Gerente', icon: Users },
      consultor: { color: 'green', bg: 'bg-green-500', label: 'Consultor', icon: User },
    };
    const config = roleConfig[role];
    const Icon = config.icon;
    const zaplotoHours = formatTime(user.total_online_time || 0);
    const crmHours = formatTime(crmTimeData[user.id] || 0);
    const showRemoveFromBanca = bancaId && (role === 'gerente' || role === 'consultor');
    return (
      <div className="bg-white rounded-xl shadow-md border border-gray-200 p-4 hover:shadow-lg transition-shadow">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3 flex-1">
            <div className={`w-12 h-12 rounded-full ${config.bg} text-white flex items-center justify-center font-bold text-sm flex-shrink-0 shadow-lg`}>
              <Icon className="w-6 h-6" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-bold text-gray-900 text-base truncate">{user.full_name || user.email}</h3>
              <span className={`text-xs px-2 py-0.5 rounded-md uppercase font-bold tracking-tighter inline-block mt-1 ${role === 'dono' ? 'bg-emerald-100 text-emerald-700' : role === 'gerente' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>
                {config.label}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <button onClick={() => handleEditUser(user)} className="p-2 text-gray-400 hover:text-[#8CD955] hover:bg-gray-50 rounded-lg transition-colors" title="Editar usuário">
              <EditIcon className="w-5 h-5" />
            </button>
            {showRemoveFromBanca && (
              <button type="button" onClick={() => removeGestorFromBanca(user.id, bancaId)} disabled={gestorBancaLoading === bancaId} className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50" title="Remover da banca">
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>
        <div className="space-y-3 border-t border-gray-100 pt-3">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <Mail className="w-4 h-4 text-gray-400" />
            <span className="truncate">{user.email}</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-gray-50 rounded-lg p-2">
              <div className="flex items-center gap-1 mb-1">
                <Clock className="w-3 h-3 text-gray-500" />
                <span className="text-xs font-medium text-gray-600">Zaploto</span>
              </div>
              <p className="text-sm font-bold text-gray-800">{zaplotoHours}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-2">
              <div className="flex items-center gap-1 mb-1">
                <TrendingUp className="w-3 h-3 text-gray-500" />
                <span className="text-xs font-medium text-gray-600">CRM</span>
              </div>
              <p className="text-sm font-bold text-gray-800">{crmHours}</p>
            </div>
          </div>
          {role === 'consultor' && (
            <a href={`/crm/kanban?userId=${user.id}`} className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-[#8CD955] text-white rounded-lg hover:bg-[#7BC84A] transition-colors text-sm font-medium">
              <TrendingUp className="w-4 h-4" />
              Acessar CRM
            </a>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-br from-white to-amber-50 rounded-xl shadow-lg border border-amber-100 p-4 sm:p-6 relative overflow-hidden">
        <div className="relative z-10">
          <h2 className="text-lg sm:text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-amber-600" />
            Integridade da Estrutura
          </h2>
          {initialLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-8 h-8 animate-spin text-amber-500 mr-2" />
              <span className="text-gray-600">Carregando integridade...</span>
            </div>
          ) : issues.length > 0 ? (
            <>
            <div className="mb-4">
              <div className="relative max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 w-5 h-5" />
                <input type="text" value={issuesSearch} onChange={(e) => { setIssuesSearch(e.target.value); setIssuesCurrentPage(1); }} placeholder="Buscar por email ou nome..." className="w-full pl-10 pr-4 py-2 bg-white border border-amber-200 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-gray-900 placeholder:text-gray-500" />
              </div>
            </div>
            <div className="space-y-3">
              {(() => {
                const search = issuesSearch.trim().toLowerCase();
                const filtered = search ? issues.filter((i: any) => (String(i.email || '').toLowerCase().includes(search)) || (String(i.full_name || '').toLowerCase().includes(search)) || (String(i.issue || '').toLowerCase().includes(search))) : issues;
                return filtered.slice((issuesCurrentPage - 1) * issuesPerPage, issuesCurrentPage * issuesPerPage).map((issue: any, idx: number) => (
                <div key={idx} className="p-4 bg-red-50 border border-red-100 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <p className="font-bold text-red-800 text-sm sm:text-base">{issue.email}</p>
                    <p className="text-xs sm:text-sm text-red-600">{issue.issue}</p>
                  </div>
                  <button onClick={() => handleFixIssue(issue)} className="px-3 py-1.5 bg-white text-red-600 border border-red-200 rounded-lg text-xs font-bold hover:bg-red-50 transition-colors whitespace-nowrap">
                    Corrigir
                  </button>
                </div>
              ));
              })()}
            </div>
            {(() => {
              const search = issuesSearch.trim().toLowerCase();
              const filtered = search ? issues.filter((i: any) => (String(i.email || '').toLowerCase().includes(search)) || (String(i.full_name || '').toLowerCase().includes(search)) || (String(i.issue || '').toLowerCase().includes(search))) : issues;
              return filtered.length > issuesPerPage ? (
              <div className="mt-4">
                <Pagination currentPage={issuesCurrentPage} totalPages={Math.ceil(filtered.length / issuesPerPage)} onPageChange={setIssuesCurrentPage} itemsPerPage={issuesPerPage} totalItems={filtered.length} />
              </div>
            ) : null;
              })()}
            </>
          ) : (
            <p className="text-sm text-gray-500 py-4">Nenhum problema de integridade encontrado.</p>
          )}
        </div>
      </div>

      <div className="space-y-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 w-5 h-5" />
              <input type="text" value={bancaSearch} onChange={(e) => { setBancaSearch(e.target.value); setBancasCurrentPage(1); }} placeholder="Pesquisar banca por nome ou URL..." className="w-full pl-10 pr-4 py-2 bg-gray-100 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] text-gray-900 placeholder:text-gray-500" />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select value={selectedBancaMode} onChange={(e) => { setSelectedBancaMode(e.target.value); setBancasCurrentPage(1); }} disabled={initialLoading} className="px-3 py-2 border border-gray-300 rounded-lg text-gray-700 bg-white min-w-[180px] disabled:opacity-60" title="Bancas a carregar">
                <option value="all">{initialLoading ? 'Carregando...' : 'Todas as bancas'}</option>
                {!initialLoading && (crmBancasBasic || []).map((b: any) => (
                  <option key={b.id} value={b.id}>{b.name || b.url || b.id}</option>
                ))}
              </select>
              <button onClick={handleLoadData} disabled={initialLoading || dataLoading} className="px-4 py-2 bg-[#8CD955] text-white rounded-lg hover:bg-[#7BC84A] transition-colors flex items-center gap-2 font-medium disabled:opacity-70" title="Carregar dados">
                {dataLoading ? <><Loader2 className="w-4 h-4 animate-spin" /> Carregando...</> : <><RefreshCw className="w-4 h-4" /> Carregar dados</>}
              </button>
              {dataLoaded && (
                <>
                  <select value={bancaFilter} onChange={(e) => { setBancaFilter(e.target.value as any); setBancasCurrentPage(1); }} className="px-3 py-2 border border-gray-300 rounded-lg text-gray-700 bg-white" title="Filtro de bancas">
                    <option value="all">Todas</option>
                    <option value="sem_dono">Sem dono</option>
                    <option value="com_dono">Com dono</option>
                  </select>
                  <button onClick={() => loadHierarchyData(true)} disabled={dataLoading} className="px-3 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors flex items-center gap-2" title="Recarregar">
                    <RefreshCw className="w-4 h-4" />
                    <span className="hidden sm:inline">Recarregar</span>
                  </button>
                </>
              )}
            </div>
          </div>
          {!dataLoaded && (
            <p className="text-sm text-gray-600">Selecione &quot;Todas as bancas&quot; ou uma banca específica e clique em <strong>Carregar dados</strong> para exibir as informações. Isso torna a busca mais rápida.</p>
          )}
        </div>

        {dataLoading ? (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
            <Loader2 className="w-12 h-12 mx-auto mb-4 text-[#8CD955] animate-spin" />
            <p className="text-gray-600">Carregando bancas e hierarquia...</p>
          </div>
        ) : !dataLoaded ? (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
            <Building2 className="w-16 h-16 mx-auto mb-4 text-gray-300" />
            <p className="text-gray-600">Selecione uma opção acima e clique em <strong>Carregar dados</strong> para visualizar as bancas e a hierarquia.</p>
          </div>
        ) : crmBancas && crmBancas.length > 0 ? (() => {
          const filteredBancas = crmBancas.filter((b: any) => {
            const search = bancaSearch.trim().toLowerCase();
            if (!search) return true;
            return String(b.name || '').toLowerCase().includes(search) || String(b.url || '').toLowerCase().includes(search);
          });
          const pagedBancas = filteredBancas.slice((bancasCurrentPage - 1) * bancasPerPage, bancasCurrentPage * bancasPerPage);
          return (
            <>
              {pagedBancas.map((crmBanca: any) => {
                const bancaUrlNorm = normalizeBancaUrl(crmBanca.url);
                const owner = (hierarchy || []).find((h: any) => normalizeBancaUrl(h.banca_url) === bancaUrlNorm);
                if (bancaFilter === 'sem_dono' && owner) return null;
                if (bancaFilter === 'com_dono' && !owner) return null;
                return (
                  <div key={crmBanca.id} className="bg-gradient-to-br from-white to-emerald-50 rounded-xl shadow-lg border border-emerald-100 p-6 relative overflow-hidden">
                    <div className="relative z-10">
                      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6 pb-4 border-b border-emerald-100">
                        <div className="flex items-center gap-4">
                          <div className="w-16 h-16 rounded-full bg-[#8CD955] text-white flex items-center justify-center font-bold text-xl flex-shrink-0 shadow-lg shadow-emerald-100">
                            {crmBanca.name ? String(crmBanca.name).substring(0, 2).toUpperCase() : 'BK'}
                          </div>
                          <div>
                            <h2 className="text-2xl font-bold text-gray-900 mb-1">{crmBanca.name || 'Banca sem nome'}</h2>
                            {crmBanca.url && (
                              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                                <a href={`https://${normalizeBancaUrl(crmBanca.url)}`} target="_blank" rel="noreferrer" className="text-sm text-[#8CD955] hover:underline font-medium flex items-center gap-1">
                                  <Globe className="w-4 h-4" />
                                  {normalizeBancaUrl(crmBanca.url)}
                                </a>
                                {!owner && <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-md font-bold">Sem dono cadastrado</span>}
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {!owner && (
                            <>
                              <button onClick={() => { setCreateFormData(prev => ({ ...prev, status: 'dono_banca', enroller: '', bancaOwnerId: '', bancaName: crmBanca.name || '', bancaUrl: normalizeBancaUrl(crmBanca.url || ''), initialBancaIds: [] })); setShowCreateModal(true); }} className="flex items-center gap-2 px-4 py-2 bg-[#8CD955] text-white rounded-lg hover:bg-[#7BC84A] transition-colors font-medium">
                                <UserPlus className="w-4 h-4" /> Criar Dono
                              </button>
                              <button onClick={() => handleOpenAssignModal({ status: 'dono_banca', enroller: '', bancaId: String(crmBanca.id), bancaName: crmBanca.name || '', bancaUrl: normalizeBancaUrl(crmBanca.url || ''), ownerId: '' })} className="flex items-center gap-2 px-4 py-2 bg-emerald-700/90 text-white rounded-lg hover:bg-emerald-700 transition-colors font-medium border border-emerald-600">
                                <UserCheck className="w-4 h-4" /> Atribuir Dono
                              </button>
                              <button onClick={() => { setCreateFormData(prev => ({ ...prev, status: 'gerente', enroller: '', bancaOwnerId: '', bancaName: '', bancaUrl: '', initialBancaIds: [String(crmBanca.id)] })); setShowCreateModal(true); }} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium">
                                <UserPlus className="w-4 h-4" /> Adicionar Gerente
                              </button>
                              <button onClick={() => handleOpenAssignModal({ status: 'gerente', enroller: '', bancaId: String(crmBanca.id), bancaName: '', bancaUrl: '', ownerId: '' })} className="flex items-center gap-2 px-4 py-2 bg-blue-700/90 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium border border-blue-600">
                                <UserCheck className="w-4 h-4" /> Atribuir Gerente
                              </button>
                              <button onClick={() => { setCreateFormData(prev => ({ ...prev, status: 'consultor', enroller: '', bancaOwnerId: '', bancaName: '', bancaUrl: '', initialBancaIds: [String(crmBanca.id)] })); setShowCreateModal(true); }} className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors font-medium">
                                <UserPlus className="w-4 h-4" /> Adicionar Consultor
                              </button>
                              <button onClick={() => { const managers = getManagersByCrmBanca(String(crmBanca.id)); handleOpenAssignModal({ status: 'consultor', enroller: managers?.length ? managers[0].id : '', bancaId: String(crmBanca.id), bancaName: crmBanca.name || '', bancaUrl: normalizeBancaUrl(crmBanca.url || ''), ownerId: '' }); }} className="flex items-center gap-2 px-4 py-2 bg-green-700/90 text-white rounded-lg hover:bg-green-700 transition-colors font-medium border border-green-600">
                                <UserCheck className="w-4 h-4" /> Atribuir Consultor
                              </button>
                            </>
                          )}
                          {owner && (
                            <>
                              <button onClick={() => { setCreateFormData(prev => ({ ...prev, status: 'gerente', enroller: owner.id, bancaOwnerId: owner.id, bancaName: owner.banca_name || crmBanca.name || '', bancaUrl: normalizeBancaUrl(owner.banca_url || crmBanca.url || ''), initialBancaIds: [String(crmBanca.id)] })); setShowCreateModal(true); }} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium">
                                <UserPlus className="w-4 h-4" /> Adicionar Gerente
                              </button>
                              <button onClick={() => handleOpenAssignModal({ status: 'gerente', enroller: owner.id, bancaId: String(crmBanca.id), bancaName: owner.banca_name || crmBanca.name || '', bancaUrl: normalizeBancaUrl(owner.banca_url || crmBanca.url || ''), ownerId: owner.id })} className="flex items-center gap-2 px-4 py-2 bg-blue-700/90 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium border border-blue-600">
                                <UserCheck className="w-4 h-4" /> Atribuir Gerente
                              </button>
                              <button onClick={() => { setCreateFormData(prev => ({ ...prev, status: 'consultor', enroller: owner.id, bancaOwnerId: owner.id, bancaName: owner.banca_name || crmBanca.name || '', bancaUrl: normalizeBancaUrl(owner.banca_url || crmBanca.url || ''), initialBancaIds: [String(crmBanca.id)] })); setShowCreateModal(true); }} className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors font-medium">
                                <UserPlus className="w-4 h-4" /> Adicionar Consultor
                              </button>
                              <button onClick={() => { const managers = getManagersByCrmBanca(String(crmBanca.id)); handleOpenAssignModal({ status: 'consultor', enroller: managers?.length ? managers[0].id : '', bancaId: String(crmBanca.id), bancaName: owner.banca_name || crmBanca.name || '', bancaUrl: normalizeBancaUrl(owner.banca_url || crmBanca.url || ''), ownerId: owner.id }); }} className="flex items-center gap-2 px-4 py-2 bg-green-700/90 text-white rounded-lg hover:bg-green-700 transition-colors font-medium border border-green-600">
                                <UserCheck className="w-4 h-4" /> Atribuir Consultor
                              </button>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="mb-6">
                        <h3 className="text-lg font-semibold text-gray-800 mb-3 flex items-center gap-2">
                          <Building2 className="w-5 h-5 text-emerald-600" />
                          Dono da Banca
                        </h3>
                        {owner ? (
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">{renderUserCard(owner, 'dono')}</div>
                        ) : (
                          <div className="bg-white rounded-xl border border-gray-200 p-6 text-gray-600">
                            <p className="font-medium">Nenhum dono cadastrado para esta banca.</p>
                            <p className="text-sm text-gray-500 mt-1">Crie um Dono de Banca ou atribua Gerentes/Consultores diretamente a esta banca.</p>
                          </div>
                        )}
                      </div>

                      <div className="mb-6">
                        <h3 className="text-lg font-semibold text-gray-800 mb-3 flex items-center gap-2">
                          <TrendingUp className="w-5 h-5 text-teal-600" />
                          Gestores desta banca
                          {((crmBanca.user_ids || []).filter((uid: string) => allUsers.find((x: any) => x.id === uid)?.status === 'gestor').length) > 0 && ` (${(crmBanca.user_ids || []).filter((uid: string) => allUsers.find((x: any) => x.id === uid)?.status === 'gestor').length})`}
                        </h3>
                        {(() => {
                          const gestoresInBanca = (crmBanca.user_ids || []).filter((uid: string) => allUsers.find((x: any) => x.id === uid)?.status === 'gestor');
                          const gestoresAvailable = (allUsers || []).filter((u: any) => u.status === 'gestor' && !gestoresInBanca.includes(u.id));
                          return (
                            <>
                              {gestoresInBanca.length > 0 && (
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-3">
                                  {gestoresInBanca.map((uid: string) => {
                                    const u = allUsers.find((x: any) => x.id === uid);
                                    if (!u) return null;
                                    return (
                                      <div key={uid} className="bg-white rounded-xl border border-teal-100 p-4 flex items-center justify-between gap-2">
                                        <div className="min-w-0">
                                          <p className="font-medium text-gray-900 truncate">{u.full_name || u.email}</p>
                                          <p className="text-xs text-gray-500 truncate">{u.email}</p>
                                          <span className="inline-block mt-1 px-2 py-0.5 rounded text-xs font-bold bg-teal-100 text-teal-700">Gestor</span>
                                        </div>
                                        <div className="flex items-center gap-1">
                                          <button type="button" onClick={() => handleEditUser(u)} className="p-1.5 text-gray-500 hover:bg-gray-100 rounded" title="Editar"><EditIcon className="w-4 h-4" /></button>
                                          <button type="button" onClick={() => removeGestorFromBanca(uid, crmBanca.id)} disabled={gestorBancaLoading === crmBanca.id} className="p-1.5 text-red-500 hover:bg-red-50 rounded disabled:opacity-50" title="Remover gestor da banca"><X className="w-4 h-4" /></button>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm font-medium text-gray-600">Adicionar gestor:</span>
                                <select value="" onChange={(e) => { const v = e.target.value; if (v) addGestorToBanca(v, crmBanca.id); e.target.value = ''; }} disabled={gestorBancaLoading === crmBanca.id || gestoresAvailable.length === 0} className="bg-white border border-gray-200 px-3 py-2 rounded-lg text-sm font-medium text-gray-700 min-w-[200px] disabled:opacity-50">
                                  <option value="">{gestoresAvailable.length === 0 ? 'Nenhum gestor disponível' : 'Selecione um gestor'}</option>
                                  {gestoresAvailable.map((u: any) => <option key={u.id} value={u.id}>{u.full_name || u.email}</option>)}
                                </select>
                              </div>
                            </>
                          );
                        })()}
                      </div>

                      {!owner && (
                        <div className="mb-6">
                          <h3 className="text-lg font-semibold text-gray-800 mb-3 flex items-center gap-2">
                            <Users className="w-5 h-5 text-blue-600" />
                            Gerentes e Consultores nesta banca
                          </h3>
                          {(() => {
                            const gerentesInBanca = (crmBanca.user_ids || [])
                              .map((uid: string) => allUsers.find((x: any) => x.id === uid))
                              .filter((u: any) => u && u.status === 'gerente');
                            const gerenteIdsInBanca = new Set(gerentesInBanca.map((g: any) => g.id));
                            const consultoresNaBanca = (crmBanca.user_ids || [])
                              .map((uid: string) => allUsers.find((x: any) => x.id === uid))
                              .filter((u: any) => u && u.status === 'consultor');
                            const consultoresLigadosAosGerentes = (allUsers || []).filter(
                              (u: any) => u.status === 'consultor' && u.enroller && gerenteIdsInBanca.has(u.enroller)
                            );
                            const consultoresEmGerente = new Map<string, any[]>();
                            gerentesInBanca.forEach((g: any) => {
                              const subs = consultoresLigadosAosGerentes.filter((c: any) => c.enroller === g.id);
                              consultoresEmGerente.set(g.id, subs);
                            });
                            const consultoresSemGerenteNaBanca = consultoresNaBanca.filter((c: any) => !gerenteIdsInBanca.has(c.enroller));
                            const gerentesComConsultores = gerentesInBanca.map((gerente: any) => ({
                              ...gerente,
                              subordinates: consultoresEmGerente.get(gerente.id) || [],
                            }));
                            const total = gerentesInBanca.length + consultoresLigadosAosGerentes.length + consultoresSemGerenteNaBanca.length;
                            if (total === 0) {
                              return <p className="text-sm text-gray-500">Nenhum gerente ou consultor atribuído. Use os botões acima para criar ou adicionar.</p>;
                            }
                            return (
                              <div className="space-y-6">
                                {gerentesComConsultores.map((gerente: any) => (
                                  <div key={gerente.id} className="bg-blue-50/30 rounded-lg p-4 border border-blue-100">
                                    {renderUserCard(gerente, 'gerente', crmBanca.id)}
                                    {gerente.subordinates && gerente.subordinates.length > 0 && (
                                      <div className="mt-4 pl-4 border-l-2 border-blue-300 space-y-3">
                                        <h4 className="text-sm font-semibold text-gray-700 uppercase tracking-wide flex items-center gap-2">
                                          <User className="w-4 h-4 text-green-600" />
                                          Consultores ({gerente.subordinates.length})
                                        </h4>
                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                          {gerente.subordinates.map((consultor: any) => (
                                            <div key={consultor.id}>{renderUserCard(consultor, 'consultor', crmBanca.id)}</div>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                    {(!gerente.subordinates || gerente.subordinates.length === 0) && (
                                      <div className="mt-4 pl-4 border-l-2 border-blue-300">
                                        <div className="flex gap-2">
                                          <button onClick={() => { setCreateFormData(prev => ({ ...prev, status: 'consultor', enroller: gerente.id, bancaOwnerId: '', bancaName: crmBanca.name || '', bancaUrl: normalizeBancaUrl(crmBanca.url || ''), initialBancaIds: [String(crmBanca.id)] })); setShowCreateModal(true); }} className="flex-1 p-3 border-2 border-dashed border-gray-300 rounded-lg text-gray-500 hover:border-green-400 hover:text-green-600 transition-colors text-sm font-medium flex items-center justify-center gap-2">
                                            <UserPlus className="w-4 h-4" /> Adicionar Consultor
                                          </button>
                                          <button onClick={() => handleOpenAssignModal({ status: 'consultor', enroller: gerente.id, bancaId: String(crmBanca.id), bancaName: crmBanca.name || '', bancaUrl: normalizeBancaUrl(crmBanca.url || ''), ownerId: '' })} className="flex-1 p-3 border-2 border-dashed border-green-300 rounded-lg text-green-600 hover:border-green-500 hover:bg-green-50 transition-colors text-sm font-medium flex items-center justify-center gap-2">
                                            <UserCheck className="w-4 h-4" /> Atribuir Consultor
                                          </button>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                ))}
                                {consultoresSemGerenteNaBanca.length > 0 && (
                                  <div className="bg-gray-50/50 rounded-lg p-4 border border-gray-200">
                                    <h4 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3 flex items-center gap-2">
                                      <User className="w-4 h-4 text-gray-600" />
                                      Consultores diretos (sem gerente na banca)
                                    </h4>
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                      {consultoresSemGerenteNaBanca.map((c: any) => (
                                        <div key={c.id}>{renderUserCard(c, 'consultor', crmBanca.id)}</div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                      )}

                      {owner && owner.subordinates && owner.subordinates.length > 0 && (
                        <div className="mb-6">
                          <h3 className="text-lg font-semibold text-gray-800 mb-3 flex items-center gap-2">
                            <Users className="w-5 h-5 text-blue-600" />
                            Gerentes ({owner.subordinates.length})
                          </h3>
                          <div className="space-y-6">
                            {owner.subordinates.map((gerente: any) => (
                              <div key={gerente.id} className="bg-blue-50/30 rounded-lg p-4 border border-blue-100">
                                {renderUserCard(gerente, 'gerente', crmBanca.id)}
                                {gerente.subordinates && gerente.subordinates.length > 0 ? (
                                  <div className="mt-4 pl-4 border-l-2 border-blue-300 space-y-3">
                                    <div className="flex items-center justify-between mb-3">
                                      <h4 className="text-sm font-semibold text-gray-700 uppercase tracking-wide flex items-center gap-2">
                                        <User className="w-4 h-4 text-green-600" />
                                        Consultores ({gerente.subordinates.length})
                                      </h4>
                                      <div className="flex items-center gap-1">
                                        {owner.subordinates && owner.subordinates.length > 1 && (
                                          <button onClick={() => openMoveConsultantsModal(owner, gerente, crmBanca)} className="p-1.5 text-amber-600 hover:bg-amber-50 rounded transition-colors" title="Mover consultores para outro gerente"><ArrowRightLeft className="w-4 h-4" /></button>
                                        )}
                                        <button onClick={() => { setCreateFormData(prev => ({ ...prev, status: 'consultor', enroller: gerente.id, bancaOwnerId: owner.id, bancaName: owner.banca_name || crmBanca.name || '', bancaUrl: normalizeBancaUrl(owner.banca_url || crmBanca.url || ''), initialBancaIds: [String(crmBanca.id)] })); setShowCreateModal(true); }} className="p-1.5 text-green-600 hover:bg-green-50 rounded transition-colors" title="Adicionar Consultor"><UserPlus className="w-4 h-4" /></button>
                                        <button onClick={() => handleOpenAssignModal({ status: 'consultor', enroller: gerente.id, bancaId: String(crmBanca.id), bancaName: owner.banca_name || crmBanca.name || '', bancaUrl: normalizeBancaUrl(owner.banca_url || crmBanca.url || ''), ownerId: owner.id })} className="p-1.5 text-green-700 hover:bg-green-50 rounded transition-colors" title="Atribuir Consultor"><UserCheck className="w-4 h-4" /></button>
                                      </div>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                      {gerente.subordinates.map((consultor: any) => <div key={consultor.id}>{renderUserCard(consultor, 'consultor', crmBanca.id)}</div>)}
                                    </div>
                                  </div>
                                ) : (
                                  <div className="mt-4 pl-4 border-l-2 border-blue-300">
                                    <div className="flex gap-2">
                                      <button onClick={() => { setCreateFormData(prev => ({ ...prev, status: 'consultor', enroller: gerente.id, bancaOwnerId: owner.id, bancaName: owner.banca_name || crmBanca.name || '', bancaUrl: normalizeBancaUrl(owner.banca_url || crmBanca.url || ''), initialBancaIds: [String(crmBanca.id)] })); setShowCreateModal(true); }} className="flex-1 p-3 border-2 border-dashed border-gray-300 rounded-lg text-gray-500 hover:border-green-400 hover:text-green-600 transition-colors text-sm font-medium flex items-center justify-center gap-2">
                                        <UserPlus className="w-4 h-4" /> Adicionar Consultor
                                      </button>
                                      <button onClick={() => handleOpenAssignModal({ status: 'consultor', enroller: gerente.id, bancaId: String(crmBanca.id), bancaName: owner.banca_name || crmBanca.name || '', bancaUrl: normalizeBancaUrl(owner.banca_url || crmBanca.url || ''), ownerId: owner.id })} className="flex-1 p-3 border-2 border-dashed border-green-300 rounded-lg text-green-600 hover:border-green-500 hover:bg-green-50 transition-colors text-sm font-medium flex items-center justify-center gap-2">
                                        <UserCheck className="w-4 h-4" /> Atribuir Consultor
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {owner && (!owner.subordinates || owner.subordinates.length === 0) && (
                        <div className="text-center py-8 text-gray-500">
                          <Users className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                          <p className="font-medium">Nenhum gerente cadastrado</p>
                          <div className="mt-3 flex items-center justify-center gap-4">
                            <button onClick={() => { setCreateFormData(prev => ({ ...prev, status: 'gerente', enroller: owner.id, bancaOwnerId: owner.id, bancaName: owner.banca_name || crmBanca.name || '', bancaUrl: normalizeBancaUrl(owner.banca_url || crmBanca.url || ''), initialBancaIds: [String(crmBanca.id)] })); setShowCreateModal(true); }} className="text-sm text-[#8CD955] hover:underline">Adicionar primeiro gerente</button>
                            <span className="text-gray-400">ou</span>
                            <button onClick={() => handleOpenAssignModal({ status: 'gerente', enroller: owner.id, bancaId: String(crmBanca.id), bancaName: owner.banca_name || crmBanca.name || '', bancaUrl: normalizeBancaUrl(owner.banca_url || crmBanca.url || ''), ownerId: owner.id })} className="text-sm text-blue-600 hover:underline">Atribuir usuário existente</button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              {filteredBancas.length > bancasPerPage && (
                <Pagination currentPage={bancasCurrentPage} totalPages={Math.ceil(filteredBancas.length / bancasPerPage)} onPageChange={setBancasCurrentPage} itemsPerPage={bancasPerPage} totalItems={filteredBancas.length} />
              )}
            </>
          );
        })() : (
          <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-12 text-center">
            <Building2 className="w-16 h-16 mx-auto mb-4 text-gray-300" />
            <h3 className="text-xl font-bold text-gray-800 mb-2">Nenhuma banca cadastrada no CRM</h3>
            <p className="text-gray-600">Cadastre bancas em `crm_bancas` para que elas apareçam aqui.</p>
          </div>
        )}
      </div>

      {showEditModal && editingUser && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="p-6 border-b border-gray-200 flex items-center justify-between bg-gradient-to-r from-[#8CD955] to-[#7BC84A] text-white">
              <h2 className="text-xl font-bold flex items-center gap-2"><EditIcon className="w-6 h-6" /> Editar Usuário</h2>
              <button onClick={() => { setShowEditModal(false); setEditingUser(null); }} className="hover:bg-white/20 p-1.5 rounded-lg transition-colors"><X className="w-6 h-6" /></button>
            </div>
            <form onSubmit={(e) => { e.preventDefault(); handleSaveEdit(); }} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Email</label>
                <input type="email" value={editFormData.email} onChange={(e) => setEditFormData({ ...editFormData, email: e.target.value })} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] text-gray-700" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Nova Senha (deixe em branco para não alterar)</label>
                <input type="password" value={editFormData.password} onChange={(e) => setEditFormData({ ...editFormData, password: e.target.value })} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] text-gray-700" placeholder="••••••••" />
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <button type="button" onClick={() => { setShowEditModal(false); setEditingUser(null); }} className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors">Cancelar</button>
                <button type="submit" className="px-4 py-2 bg-[#8CD955] text-white rounded-lg hover:bg-[#7BC84A] transition-colors font-medium">Salvar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showCreateModal && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="p-6 border-b border-gray-200 flex items-center justify-between bg-gradient-to-r from-blue-600 to-blue-500 text-white">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <UserPlus className="w-6 h-6" />
                Criar {createFormData.status === 'dono_banca' ? 'Dono de Banca' : createFormData.status === 'gestor' ? 'Gestor de Tráfego' : createFormData.status === 'gerente' ? 'Gerente' : 'Consultor'}
              </h2>
              <button onClick={() => { setShowCreateModal(false); setCreateFormData({ email: '', fullName: '', password: '', status: 'consultor', enroller: '', bancaOwnerId: '', bancaName: '', bancaUrl: '', initialBancaIds: [] }); }} className="hover:bg-white/20 p-1.5 rounded-lg transition-colors"><X className="w-6 h-6" /></button>
            </div>
            <form onSubmit={handleCreateUser} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Nome Completo</label>
                <input type="text" value={createFormData.fullName} onChange={(e) => setCreateFormData({ ...createFormData, fullName: e.target.value })} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] text-gray-700" placeholder="Nome do usuário" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Email *</label>
                <input type="email" value={createFormData.email} onChange={(e) => setCreateFormData({ ...createFormData, email: e.target.value })} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] text-gray-700" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Senha *</label>
                <input type="password" value={createFormData.password} onChange={(e) => setCreateFormData({ ...createFormData, password: e.target.value })} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] text-gray-700" required />
              </div>
              {(createFormData.status === 'gerente' || createFormData.status === 'consultor') && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">{createFormData.status === 'consultor' ? 'Selecionar Gerente' : 'Selecionar Dono da Banca'}</label>
                  <select value={createFormData.enroller} onChange={(e) => setCreateFormData({ ...createFormData, enroller: e.target.value })} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] text-gray-700">
                    <option value="">Selecione...</option>
                    {createFormData.status === 'consultor' ? (
                      (() => {
                        const bancaId = createFormData.initialBancaIds?.[0];
                        const managers = bancaId ? getManagersByCrmBanca(bancaId) : (hierarchy || []).flatMap((h: any) => h.subordinates || []);
                        return managers.map((g: any) => <option key={g.id} value={g.id}>{g.full_name || g.email}</option>);
                      })()
                    ) : (hierarchy || []).map((h: any) => <option key={h.id} value={h.id}>{h.banca_name || h.email}</option>)}
                  </select>
                </div>
              )}
              {createFormData.status === 'dono_banca' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Nome da Banca *</label>
                    <input type="text" value={createFormData.bancaName} onChange={(e) => setCreateFormData({ ...createFormData, bancaName: e.target.value })} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] text-gray-700" required />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">URL da Banca *</label>
                    <input type="text" value={createFormData.bancaUrl} onChange={(e) => setCreateFormData({ ...createFormData, bancaUrl: e.target.value })} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] text-gray-700" placeholder="exemplo.com/api/crm" required />
                  </div>
                </>
              )}
              <div className="flex justify-end gap-3 pt-4">
                <button type="button" onClick={() => { setShowCreateModal(false); setCreateFormData({ email: '', fullName: '', password: '', status: 'consultor', enroller: '', bancaOwnerId: '', bancaName: '', bancaUrl: '', initialBancaIds: [] }); }} className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors">Cancelar</button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium">Criar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showFixModal && fixingIssue && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="p-6 border-b border-gray-200 flex items-center justify-between bg-gradient-to-r from-amber-600 to-amber-500 text-white">
              <h2 className="text-xl font-bold flex items-center gap-2"><AlertCircle className="w-6 h-6" /> Corrigir Problema</h2>
              <button onClick={() => { setShowFixModal(false); setFixingIssue(null); setSelectedEnroller(''); }} className="hover:bg-white/20 p-1.5 rounded-lg transition-colors"><X className="w-6 h-6" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <p className="text-sm font-medium text-red-800 mb-1">Usuário:</p>
                <p className="text-sm text-red-700">{fixingIssue.email}</p>
                <p className="text-sm font-medium text-red-800 mt-2 mb-1">Problema:</p>
                <p className="text-sm text-red-700">{fixingIssue.issue}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Banca (CRM)</label>
                <select value={selectedFixBancaId} onChange={(e) => { setSelectedFixBancaId(e.target.value); setSelectedEnroller(''); }} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-gray-700">
                  <option value="">Selecione...</option>
                  {(crmBancas || []).map((b: any) => <option key={b.id} value={String(b.id)}>{b.name} ({normalizeBancaUrl(b.url)})</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Cargo</label>
                <select value={selectedFixRole} onChange={(e) => { setSelectedFixRole(e.target.value as any); setSelectedEnroller(''); }} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-gray-700">
                  <option value="dono_banca">Dono de banca</option>
                  <option value="gerente">Gerente</option>
                  <option value="consultor">Consultor</option>
                </select>
              </div>
              {selectedFixRole === 'consultor' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Selecione o Gerente</label>
                  <select value={selectedEnroller} onChange={(e) => setSelectedEnroller(e.target.value)} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-gray-700">
                    <option value="">Selecione...</option>
                    {selectedFixBancaId && getManagersByCrmBanca(selectedFixBancaId).map((m: any) => <option key={m.id} value={m.id}>{m.full_name || m.email}</option>)}
                  </select>
                </div>
              )}
              <div className="flex justify-end gap-3 pt-4">
                <button type="button" onClick={() => { setShowFixModal(false); setFixingIssue(null); setSelectedEnroller(''); }} className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors">Cancelar</button>
                <button onClick={handleSaveFix} disabled={!selectedFixBancaId || (selectedFixRole === 'consultor' && !selectedEnroller)} className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed">Corrigir</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showAssignModal && assignFormData && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
            <div className="p-6 border-b border-gray-200 flex items-center justify-between bg-gradient-to-r from-teal-600 to-teal-500 text-white">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <UserCheck className="w-6 h-6" />
                Atribuir {assignFormData.status === 'dono_banca' ? 'Dono de Banca' : assignFormData.status === 'gerente' ? 'Gerente' : 'Consultor'}
              </h2>
              <button onClick={() => { setShowAssignModal(false); setAssignFormData(null); setAssignSelectedUserIds([]); }} className="hover:bg-white/20 p-1.5 rounded-lg transition-colors"><X className="w-6 h-6" /></button>
            </div>
            <div className="p-6 space-y-4">
              {assignFormData.status === 'consultor' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Selecione o Gerente</label>
                  <select value={assignFormData.enroller} onChange={(e) => setAssignFormData((prev: any) => prev ? { ...prev, enroller: e.target.value } : prev)} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 text-gray-700">
                    <option value="">Selecione o gerente...</option>
                    {getManagersByCrmBanca(assignFormData.bancaId).map((m: any) => (
                      <option key={m.id} value={m.id}>{m.full_name || m.email}</option>
                    ))}
                  </select>
                  {!assignFormData.enroller && getManagersByCrmBanca(assignFormData.bancaId).length === 0 && (
                    <p className="mt-1 text-xs text-amber-600">Esta banca não possui gerente. Adicione um gerente antes de atribuir consultores.</p>
                  )}
                </div>
              )}
              <p className="text-sm text-gray-600">Selecione um ou mais usuários que já possuem conta para atribuir a esse cargo:</p>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Buscar usuário</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
                  <input type="text" value={assignUserSearch} onChange={(e) => setAssignUserSearch(e.target.value)} placeholder="Nome ou email..." className="w-full pl-10 pr-4 py-2 bg-gray-100 border border-gray-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 text-gray-900 placeholder:text-gray-500" />
                </div>
              </div>
              {assignSelectedUserIds.length > 0 && (
                <p className="text-xs text-teal-600 font-medium">{assignSelectedUserIds.length} usuário(s) selecionado(s)</p>
              )}
              <div className="max-h-64 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
                {(() => {
                  const search = assignUserSearch.trim().toLowerCase();
                  const filtered = (allUsers || []).filter((u: any) => {
                    if (!u.email) return false;
                    return !search || (u.email || '').toLowerCase().includes(search) || (u.full_name || '').toLowerCase().includes(search);
                  });
                  return filtered.length > 0 ? filtered.map((u: any) => (
                    <button key={u.id} type="button" onClick={() => toggleAssignUser(u.id)} className={`w-full px-4 py-3 text-left flex items-center gap-3 hover:bg-gray-50 transition-colors ${assignSelectedUserIds.includes(u.id) ? 'bg-teal-50 border-l-4 border-teal-500' : ''}`}>
                      <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center font-bold text-gray-600 flex-shrink-0">{(u.full_name || u.email)[0]?.toUpperCase() || '?'}</div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 truncate">{u.full_name || 'Sem nome'}</p>
                        <p className="text-xs text-gray-500 truncate">{u.email}</p>
                        <span className="inline-block mt-1 px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">{u.status}</span>
                      </div>
                      {assignSelectedUserIds.includes(u.id) && <CheckCircle2 className="w-5 h-5 text-teal-600 flex-shrink-0" />}
                    </button>
                  )) : (
                    <div className="px-4 py-8 text-center text-gray-500 text-sm">Nenhum usuário encontrado. Verifique se há usuários cadastrados.</div>
                  );
                })()}
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <button type="button" onClick={() => { setShowAssignModal(false); setAssignFormData(null); setAssignSelectedUserIds([]); }} className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors">Cancelar</button>
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
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
            <div className="p-6 border-b border-gray-200 flex items-center justify-between bg-gradient-to-r from-amber-500 to-amber-600 text-white">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <ArrowRightLeft className="w-6 h-6" />
                Mover consultores para outro gerente
              </h2>
              <button onClick={() => { setShowMoveConsultantsModal(false); setMoveContext(null); setMoveSelectedConsultantIds([]); setMoveTargetGerenteId(''); setMoveConsultantSearch(''); }} className="hover:bg-white/20 p-1.5 rounded-lg transition-colors"><X className="w-6 h-6" /></button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-gray-600">
                Gerente atual: <strong>{moveContext.sourceGerente.full_name || moveContext.sourceGerente.email}</strong>
              </p>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-gray-700">Selecione os consultores a mover:</label>
                  {(() => {
                    const subordinates = moveContext.sourceGerente.subordinates || [];
                    const search = moveConsultantSearch.trim().toLowerCase();
                    const filtered = search ? subordinates.filter((c: any) => (String(c.full_name || '').toLowerCase().includes(search) || String(c.email || '').toLowerCase().includes(search))) : subordinates;
                    return filtered.length > 0 && (
                      <button type="button" onClick={() => {
                        const ids = filtered.map((c: any) => c.id);
                        const allSelected = ids.every((id: string) => moveSelectedConsultantIds.includes(id));
                        setMoveSelectedConsultantIds(allSelected ? moveSelectedConsultantIds.filter((id) => !ids.includes(id)) : [...new Set([...moveSelectedConsultantIds, ...ids])]);
                      }} className="text-xs text-amber-600 hover:underline font-medium">
                        {filtered.every((c: any) => moveSelectedConsultantIds.includes(c.id)) ? 'Desmarcar todos' : 'Selecionar todos'}
                      </button>
                    );
                  })()}
                </div>
                <div className="relative mb-2">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                  <input type="text" value={moveConsultantSearch} onChange={(e) => setMoveConsultantSearch(e.target.value)} placeholder="Buscar por nome ou e-mail..." className="w-full pl-9 pr-4 py-2 bg-gray-100 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-gray-900 placeholder:text-gray-500" />
                </div>
                <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
                  {(() => {
                    const subordinates = moveContext.sourceGerente.subordinates || [];
                    const search = moveConsultantSearch.trim().toLowerCase();
                    const filtered = search ? subordinates.filter((c: any) => (String(c.full_name || '').toLowerCase().includes(search) || String(c.email || '').toLowerCase().includes(search))) : subordinates;
                    return filtered.length > 0 ? filtered.map((c: any) => (
                    <button key={c.id} type="button" onClick={() => toggleMoveConsultant(c.id)} className={`w-full px-4 py-3 text-left flex items-center gap-3 hover:bg-gray-50 transition-colors ${moveSelectedConsultantIds.includes(c.id) ? 'bg-amber-50 border-l-4 border-amber-500' : ''}`}>
                      <div className="w-9 h-9 rounded-full bg-green-200 flex items-center justify-center font-bold text-green-800 text-sm flex-shrink-0">{(c.full_name || c.email)[0]?.toUpperCase() || '?'}</div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 truncate">{c.full_name || 'Sem nome'}</p>
                        <p className="text-xs text-gray-500 truncate">{c.email}</p>
                      </div>
                      {moveSelectedConsultantIds.includes(c.id) && <CheckCircle2 className="w-5 h-5 text-amber-600 flex-shrink-0" />}
                    </button>
                  )) : (
                    <div className="px-4 py-6 text-center text-gray-500 text-sm">
                      {moveConsultantSearch.trim() ? `Nenhum consultor encontrado com "${moveConsultantSearch.trim()}"` : 'Nenhum consultor na lista'}
                    </div>
                  );
                  })()}
                </div>
                {moveSelectedConsultantIds.length > 0 && (
                  <p className="text-xs text-amber-600 font-medium mt-2">{moveSelectedConsultantIds.length} selecionado(s)</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Mover para o gerente:</label>
                <select value={moveTargetGerenteId} onChange={(e) => setMoveTargetGerenteId(e.target.value)} className="w-full border border-gray-300 rounded-lg px-4 py-2 text-gray-700 focus:ring-2 focus:ring-amber-500 focus:border-amber-500">
                  <option value="">Selecione o gerente de destino</option>
                  {(moveContext.owner.subordinates || [])
                    .filter((g: any) => g.id !== moveContext.sourceGerente.id)
                    .map((g: any) => (
                      <option key={g.id} value={g.id}>{g.full_name || g.email}</option>
                    ))}
                </select>
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <button type="button" onClick={() => { setShowMoveConsultantsModal(false); setMoveContext(null); setMoveSelectedConsultantIds([]); setMoveTargetGerenteId(''); setMoveConsultantSearch(''); }} className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors">Cancelar</button>
                <button onClick={handleMoveConsultants} disabled={moveSelectedConsultantIds.length === 0 || !moveTargetGerenteId || moveLoading} className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2">
                  {moveLoading ? <><Loader2 className="w-4 h-4 animate-spin" /> Movendo...</> : `Mover (${moveSelectedConsultantIds.length || 0})`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
