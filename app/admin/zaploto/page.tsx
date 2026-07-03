'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRequireAuth } from '@/utils/useRequireAuth';
import { useTenantRouter } from '@/lib/utils/tenant-href';
import Layout from '@/components/Layout';
import { useSidebar } from '@/contexts/SidebarContext';
import {
  Building2,
  UserCog,
  Plus,
  Edit,
  Loader2,
  Shield,
  ChevronLeft,
  ListTree,
  Route,
  Trash2,
  Blocks,
  Send,
  Copy,
  Check,
} from 'lucide-react';
import { RolePermissionsModal } from '@/components/Admin/RolePermissionsModal';
import { getStoredUserId } from '@/lib/utils/stored-user-id';
import { getTenantUrl } from '@/lib/utils/zaploto-tenant-url';
import { useAdminTenantSwitcher } from '@/contexts/AdminTenantSwitcherContext';
import { ZAPLOTO_SLUG_COOKIE } from '@/lib/constants/white-label';

interface Tenant {
  id: string;
  name: string;
  slug: string;
  domain: string | null;
  app_title: string | null;
  primary_color: string;
  logo_url: string | null;
  is_active: boolean;
  is_central?: boolean;
}

interface Role {
  id: string;
  code: string;
  label: string;
  description: string | null;
  landing_route: string | null;
  is_system: boolean;
}

interface SidebarItem {
  id: string;
  code: string;
  label: string;
  href: string | null;
  icon_name: string | null;
  parent_code: string | null;
  sort_order: number;
  is_active: boolean;
}

export default function AdminZaplotoPage() {
  const { checking } = useRequireAuth();
  const router = useTenantRouter();
  const adminTenantSwitcher = useAdminTenantSwitcher();
  const { isCollapsed, setIsCollapsed, isMobileOpen, setIsMobileOpen } = useSidebar();
  const [userId, setUserId] = useState<string | null>(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'tenants' | 'roles' | 'modules' | 'push'>('tenants');
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [isCentral, setIsCentral] = useState(false);
  const [pushTargetId, setPushTargetId] = useState<string | null>(null);
  const [pushTypes, setPushTypes] = useState<Record<string, boolean>>({
    profiles: false,
    evolution_instances: false,
    crm_bancas: false,
    campaigns: false,
    message_schedules: false,
  });
  const [pushing, setPushing] = useState(false);
  const [pushResult, setPushResult] = useState<{ updated?: Record<string, number>; error?: string } | null>(null);
  const [createdTenant, setCreatedTenant] = useState<Tenant | null>(null);
  const [copiedTenantId, setCopiedTenantId] = useState<string | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);
  const [loadingRoles, setLoadingRoles] = useState(false);
  const [showCreateTenant, setShowCreateTenant] = useState(false);
  const [showCreateRole, setShowCreateRole] = useState(false);
  const [newTenant, setNewTenant] = useState({ name: '', slug: '', primary_color: '#E86A24', app_title: '' });
  const [newRole, setNewRole] = useState({ code: '', label: '', zaploto_id: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [permissionsRole, setPermissionsRole] = useState<Role | null>(null);
  const [deletingRoleId, setDeletingRoleId] = useState<string | null>(null);
  const [modules, setModules] = useState<SidebarItem[]>([]);
  const [loadingModules, setLoadingModules] = useState(false);
  const [showCreateModule, setShowCreateModule] = useState(false);
  const [newModule, setNewModule] = useState({ code: '', label: '', href: '', icon_name: 'LayoutDashboard', parent_code: '' });
  const [deletingModuleId, setDeletingModuleId] = useState<string | null>(null);
  const [editingModule, setEditingModule] = useState<SidebarItem | null>(null);
  const editFormRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (editingModule && editFormRef.current) {
      editFormRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [editingModule]);

  const handleCreateModule = async () => {
    if (!newModule.code.trim() || !newModule.label.trim() || !selectedTenantId) {
      setError('Código, label e tenant são obrigatórios');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/zaploto/sidebar-items/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId! },
        credentials: 'include',
        body: JSON.stringify({
          zaploto_id: selectedTenantId,
          code: newModule.code,
          label: newModule.label,
          href: newModule.href?.trim() || null,
          icon_name: newModule.icon_name || null,
          parent_code: newModule.parent_code?.trim() || null,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setModules((m) => [...m, json.data]);
        setShowCreateModule(false);
        setNewModule({ code: '', label: '', href: '', icon_name: 'LayoutDashboard', parent_code: '' });
      } else {
        setError(json.error || 'Erro ao criar módulo');
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro ao criar módulo');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateModule = async () => {
    if (!editingModule || !editingModule.code?.trim() || !editingModule.label?.trim()) {
      setError('Código e label são obrigatórios');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/zaploto/sidebar-items/${editingModule.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId! },
        credentials: 'include',
        body: JSON.stringify({
          code: editingModule.code,
          label: editingModule.label,
          href: editingModule.href?.trim() || null,
          icon_name: editingModule.icon_name || null,
          parent_code: editingModule.parent_code?.trim() || null,
          sort_order: editingModule.sort_order,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setModules((m) => m.map((x) => (x.id === editingModule.id ? { ...x, ...json.data } : x)));
        setEditingModule(null);
      } else {
        setError(json.error || 'Erro ao atualizar módulo');
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro ao atualizar módulo');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteModule = async (item: SidebarItem) => {
    if (!confirm(`Excluir o módulo "${item.label}"? Esta ação não pode ser desfeita.`)) return;
    setDeletingModuleId(item.id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/zaploto/sidebar-items/${item.id}`, {
        method: 'DELETE',
        headers: { 'X-User-Id': userId! },
        credentials: 'include',
      });
      const json = await res.json();
      if (json.success) {
        setModules((prev) => prev.filter((x) => x.id !== item.id));
      } else {
        setError(json.error || 'Erro ao excluir módulo');
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro ao excluir módulo');
    } finally {
      setDeletingModuleId(null);
    }
  };

  const handleDeleteRole = async (r: Role) => {
    if (!confirm(`Excluir o cargo "${r.label}"? Esta ação não pode ser desfeita.`)) return;
    setDeletingRoleId(r.id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/zaploto/roles/${r.id}`, {
        method: 'DELETE',
        headers: { 'X-User-Id': userId! },
        credentials: 'include',
      });
      const json = await res.json();
      if (json.success) {
        setRoles((prev) => prev.filter((x) => x.id !== r.id));
      } else {
        setError(json.error || 'Erro ao excluir cargo');
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro ao excluir cargo');
    } finally {
      setDeletingRoleId(null);
    }
  };

  useEffect(() => {
    const id = getStoredUserId();
    setUserId(id);
  }, []);

  /** Alinha dropdown ao tenant escolhido no painel (header) / cookie WL */
  useEffect(() => {
    if (!isSuperAdmin || !tenants.length) return;
    setSelectedTenantId((prev) => {
      if (prev && tenants.some((t) => t.id === prev)) return prev;
      const ctxId = adminTenantSwitcher?.selectedTenantId ?? null;
      if (ctxId && tenants.some((t) => t.id === ctxId)) return ctxId;
      return tenants[0]?.id ?? null;
    });
  }, [isSuperAdmin, tenants, adminTenantSwitcher?.selectedTenantId]);

  const syncTenantSelection = useCallback(
    (id: string | null) => {
      setSelectedTenantId(id);
      adminTenantSwitcher?.setSelectedTenantId?.(id);
      if (!id || typeof window === 'undefined') return;
      const t = tenants.find((x) => x.id === id);
      if (!t) return;
      try {
        const maxAge = 60 * 60 * 24 * 7;
        const slug = t.slug.trim().toLowerCase();
        const secure = window.location.protocol === 'https:' ? '; Secure' : '';
        document.cookie = `${ZAPLOTO_SLUG_COOKIE}=${encodeURIComponent(slug)}; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`;
      } catch {
        // silencioso
      }
    },
    [adminTenantSwitcher, tenants]
  );

  useEffect(() => {
    if (!userId) return;
    const check = async () => {
      try {
        const res = await fetch('/api/user/profile', {
          headers: { 'X-User-Id': userId },
          credentials: 'include',
        });
        const json = await res.json();
        if (json.success && json.data?.status === 'super_admin') {
          setIsSuperAdmin(true);
        } else {
          router.push('/admin');
        }
      } catch {
        router.push('/admin');
      } finally {
        setLoading(false);
      }
    };
    check();
  }, [userId, router]);

  useEffect(() => {
    if (!isSuperAdmin || !userId) return;
    const fetchTenants = async () => {
      try {
        const res = await fetch('/api/admin/zaploto/tenants', {
          headers: { 'X-User-Id': userId },
          credentials: 'include',
        });
        const json = await res.json();
        if (json.success) setTenants(json.data || []);
      } catch (e) {
        console.error(e);
      }
    };
    fetchTenants();
  }, [isSuperAdmin, userId]);

  useEffect(() => {
    if (!selectedTenantId || !userId) {
      setModules([]);
      return;
    }
    setLoadingModules(true);
    fetch(`/api/admin/zaploto/sidebar-items?zaploto_id=${selectedTenantId}`, {
      headers: { 'X-User-Id': userId! },
      credentials: 'include',
    })
      .then((r) => r.json())
      .then((json) => {
        if (json.success) setModules(json.data || []);
      })
      .finally(() => setLoadingModules(false));
  }, [selectedTenantId, userId]);

  useEffect(() => {
    if (!selectedTenantId || !userId) {
      setRoles([]);
      return;
    }
    setLoadingRoles(true);
    fetch(`/api/admin/zaploto/roles?zaploto_id=${selectedTenantId}`, {
      headers: { 'X-User-Id': userId! },
      credentials: 'include',
    })
      .then((r) => r.json())
      .then((json) => {
        if (json.success) setRoles(json.data || []);
      })
      .finally(() => setLoadingRoles(false));
  }, [selectedTenantId, userId]);

  useEffect(() => {
    if (!isSuperAdmin || !userId) return;
    fetch('/api/admin/zaploto/central/check', { headers: { 'X-User-Id': userId }, credentials: 'include' })
      .then((r) => r.json())
      .then((json) => {
        if (json.success && json.data?.is_central) setIsCentral(true);
      })
      .catch(() => {});
  }, [isSuperAdmin, userId]);

  const handleCreateTenant = async () => {
    if (!newTenant.name.trim()) {
      setError('Nome é obrigatório');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const slug = (newTenant.slug || newTenant.name.toLowerCase().replace(/\s+/g, '-')).trim().toLowerCase().replace(/\s+/g, '-');
      const res = await fetch('/api/admin/zaploto/tenants/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId! },
        credentials: 'include',
        body: JSON.stringify({
          ...newTenant,
          slug,
          domain: null,
          app_title: newTenant.app_title || newTenant.name,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setTenants((t) => [...t, json.data]);
        setShowCreateTenant(false);
        setNewTenant({ name: '', slug: '', primary_color: '#E86A24', app_title: '' });
        setCreatedTenant(json.data);
      } else {
        setError(json.error || 'Erro ao criar tenant');
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro ao criar tenant');
    } finally {
      setSaving(false);
    }
  };

  const handleCopyTenantUrl = (t: Tenant) => {
    const url = getTenantUrl(t);
    navigator.clipboard.writeText(url).then(() => {
      setCopiedTenantId(t.id);
      setTimeout(() => setCopiedTenantId(null), 2000);
    });
  };

  const handlePushData = async () => {
    if (!pushTargetId || !userId) {
      setPushResult({ error: 'Selecione o white label de destino.' });
      return;
    }
    const types = (Object.keys(pushTypes) as Array<keyof typeof pushTypes>).filter((k) => pushTypes[k]);
    if (types.length === 0) {
      setPushResult({ error: 'Selecione ao menos um tipo de dado.' });
      return;
    }
    setPushing(true);
    setPushResult(null);
    try {
      const res = await fetch('/api/admin/zaploto/central/push-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
        credentials: 'include',
        body: JSON.stringify({ target_zaploto_id: pushTargetId, types, mode: 'transfer' }),
      });
      const json = await res.json();
      if (json.success) {
        setPushResult({ updated: json.data?.updated });
        setPushTypes({ profiles: false, evolution_instances: false, crm_bancas: false, campaigns: false, message_schedules: false });
      } else {
        setPushResult({ error: json.error || 'Erro ao enviar dados' });
      }
    } catch (e: unknown) {
      setPushResult({ error: e instanceof Error ? e.message : 'Erro ao enviar dados' });
    } finally {
      setPushing(false);
    }
  };

  const handleCreateRole = async () => {
    if (!newRole.code.trim() || !newRole.label.trim() || !newRole.zaploto_id) {
      setError('Código, label e tenant são obrigatórios');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/zaploto/roles/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId! },
        credentials: 'include',
        body: JSON.stringify({
          ...newRole,
          code: newRole.code.toLowerCase().replace(/\s+/g, '_'),
        }),
      });
      const json = await res.json();
      if (json.success) {
        setRoles((r) => [...r, json.data]);
        setShowCreateRole(false);
        setNewRole({ code: '', label: '', zaploto_id: selectedTenantId || '' });
      } else {
        setError(json.error || 'Erro ao criar cargo');
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro ao criar cargo');
    } finally {
      setSaving(false);
    }
  };

  if (checking || loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[400px]">
          <Loader2 className="w-8 h-8 animate-spin text-[#E86A24]" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="p-4 sm:p-6 max-w-5xl mx-auto">
        <button
          onClick={() => router.push('/admin')}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white mb-6"
        >
          <ChevronLeft className="w-5 h-5" />
          Voltar ao Admin
        </button>

        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6 flex items-center gap-2">
          <Shield className="w-7 h-7" />
          White Label & Cargos
        </h1>

        <div className="flex flex-wrap gap-2 mb-6">
          <button
            onClick={() => setTab('tenants')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
              tab === 'tenants'
                ? 'bg-[#E86A24] text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600'
            }`}
          >
            <Building2 className="w-5 h-5" />
            Tenants (White Label)
          </button>
          <button
            onClick={() => setTab('roles')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
              tab === 'roles'
                ? 'bg-[#E86A24] text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600'
            }`}
          >
            <UserCog className="w-5 h-5" />
            Cargos
          </button>
          <button
            onClick={() => setTab('modules')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
              tab === 'modules'
                ? 'bg-[#E86A24] text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600'
            }`}
          >
            <Blocks className="w-5 h-5" />
            Módulos
          </button>
          {isCentral && (
            <button
              onClick={() => setTab('push')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
                tab === 'push'
                  ? 'bg-[#E86A24] text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              <Send className="w-5 h-5" />
              Enviar dados
            </button>
          )}
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm dark:bg-red-900/30 dark:border-red-800 dark:text-red-200">
            {error}
          </div>
        )}

        {tab === 'tenants' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200">Instâncias White Label</h2>
              <button
                onClick={() => setShowCreateTenant(true)}
                className="flex items-center gap-2 px-3 py-2 bg-[#E86A24] text-white rounded-lg hover:bg-[#7bc84d]"
              >
                <Plus className="w-4 h-4" />
                Novo Tenant
              </button>
            </div>

            {createdTenant && (
              <div className="p-4 bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-xl flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-green-800 dark:text-green-200">White label &quot;{createdTenant.name}&quot; criado.</p>
                  <p className="text-xs text-green-700 dark:text-green-300 mt-1 truncate max-w-md" title={getTenantUrl(createdTenant)}>
                    {getTenantUrl(createdTenant)}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleCopyTenantUrl(createdTenant)}
                    className="flex items-center gap-2 px-3 py-2 bg-[#E86A24] text-white rounded-lg hover:bg-[#7bc84d] text-sm font-medium"
                  >
                    {copiedTenantId === createdTenant.id ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    {copiedTenantId === createdTenant.id ? 'Copiado!' : 'Copiar URL'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setCreatedTenant(null)}
                    className="px-3 py-2 bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-500 text-sm"
                  >
                    Fechar
                  </button>
                </div>
              </div>
            )}

            {showCreateTenant && (
              <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 space-y-3">
                <h3 className="font-medium text-gray-800 dark:text-gray-200">Criar novo tenant</h3>
                <input
                  type="text"
                  placeholder="Nome"
                  value={newTenant.name}
                  onChange={(e) => setNewTenant((t) => ({ ...t, name: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:ring-2 focus:ring-[#E86A24] focus:border-[#E86A24]"
                />
                <input
                  type="text"
                  placeholder="Slug (ex: minha-banca)"
                  value={newTenant.slug}
                  onChange={(e) => setNewTenant((t) => ({ ...t, slug: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:ring-2 focus:ring-[#E86A24] focus:border-[#E86A24]"
                />
                <input
                  type="text"
                  placeholder="Título do app"
                  value={newTenant.app_title}
                  onChange={(e) => setNewTenant((t) => ({ ...t, app_title: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:ring-2 focus:ring-[#E86A24] focus:border-[#E86A24]"
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleCreateTenant}
                    disabled={saving}
                    className="px-4 py-2 bg-[#E86A24] text-white rounded-lg disabled:opacity-50 hover:bg-[#7bc84d]"
                  >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Criar'}
                  </button>
                  <button
                    onClick={() => setShowCreateTenant(false)}
                    className="px-4 py-2 bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-500"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            <div className="space-y-2">
              {tenants.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center justify-between p-4 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700"
                >
                  <div className="flex items-center gap-3">
                    {t.logo_url ? (
                      <img src={t.logo_url} alt="" className="w-10 h-10 object-contain rounded" />
                    ) : (
                      <div
                        className="w-10 h-10 rounded flex items-center justify-center text-white font-bold"
                        style={{ backgroundColor: t.primary_color }}
                      >
                        {t.name.charAt(0)}
                      </div>
                    )}
                    <div>
                      <div className="font-medium text-gray-900 dark:text-gray-100">{t.name}</div>
                      <div className="text-sm text-gray-500 dark:text-gray-400">{t.slug}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-1 rounded ${t.is_active ? 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300' : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'}`}>
                      {t.is_active ? 'Ativo' : 'Inativo'}
                    </span>
                    <button
                      onClick={() => handleCopyTenantUrl(t)}
                      title="Copiar URL do white label"
                      className="p-2 text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700 rounded-lg"
                    >
                      {copiedTenantId === t.id ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                    </button>
                    <button
                      onClick={() => router.push(`/admin/zaploto/tenants/${t.id}`)}
                      title="Editar tenant"
                      className="p-2 text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700 rounded-lg"
                    >
                      <Edit className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'roles' && (
          <div className="space-y-6">
            <div className="flex flex-wrap gap-3 items-center">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Tenant:</label>
              <select
                value={selectedTenantId || ''}
                onChange={(e) => syncTenantSelection(e.target.value || null)}
                className="px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-100 focus:ring-2 focus:ring-[#E86A24] focus:border-[#E86A24] min-w-[200px]"
              >
                <option value="">Selecione um tenant</option>
                {tenants.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              {selectedTenantId && (
                <button
                  onClick={() => {
                    setShowCreateRole(true);
                    setNewRole((r) => ({ ...r, zaploto_id: selectedTenantId }));
                  }}
                  className="flex items-center gap-2 px-4 py-2.5 bg-[#E86A24] text-white rounded-lg hover:bg-[#7bc84d] font-medium"
                >
                  <Plus className="w-4 h-4" />
                  Novo Cargo
                </button>
              )}
            </div>

            {showCreateRole && selectedTenantId && (
              <div className="p-5 bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 space-y-4">
                <h3 className="font-semibold text-gray-800 dark:text-gray-200">Criar novo cargo</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <input
                    type="text"
                    placeholder="Código (ex: novo_cargo)"
                    value={newRole.code}
                    onChange={(e) => setNewRole((r) => ({ ...r, code: e.target.value }))}
                    className="px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:ring-2 focus:ring-[#E86A24] focus:border-[#E86A24]"
                  />
                  <input
                    type="text"
                    placeholder="Label (ex: Novo Cargo)"
                    value={newRole.label}
                    onChange={(e) => setNewRole((r) => ({ ...r, label: e.target.value }))}
                    className="px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:ring-2 focus:ring-[#E86A24] focus:border-[#E86A24]"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleCreateRole}
                    disabled={saving}
                    className="flex items-center gap-2 px-4 py-2 bg-[#E86A24] text-white rounded-lg hover:bg-[#7bc84d] disabled:opacity-50"
                  >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Criar'}
                  </button>
                  <button
                    onClick={() => setShowCreateRole(false)}
                    className="px-4 py-2 bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-500"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            <div>
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Cargos disponíveis</h3>
              {loadingRoles ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="w-8 h-8 animate-spin text-[#E86A24]" />
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {roles.map((r) => (
                    <div
                      key={r.id}
                      className="group flex flex-col p-4 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 hover:border-[#E86A24]/50 dark:hover:border-[#E86A24]/50 hover:shadow-md dark:hover:shadow-gray-900/20 transition-all"
                    >
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-gray-900 dark:text-gray-100 truncate">{r.label}</div>
                          <div className="text-xs text-gray-500 dark:text-gray-400 font-mono mt-0.5">{r.code}</div>
                          {r.landing_route && (
                            <div className="flex items-center gap-1 mt-2 text-xs text-gray-500 dark:text-gray-400">
                              <Route className="w-3.5 h-3.5 flex-shrink-0" />
                              <span className="truncate">{r.landing_route}</span>
                            </div>
                          )}
                        </div>
                        {r.is_system && (
                          <span className="flex-shrink-0 text-xs px-2 py-1 bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 rounded-full font-medium">
                            Sistema
                          </span>
                        )}
                      </div>
                      <div className="mt-auto pt-3 flex gap-2">
                        <button
                          onClick={() => setPermissionsRole(r)}
                          className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-[#E86A24]/10 dark:bg-[#E86A24]/20 text-[#E86A24] rounded-lg hover:bg-[#E86A24]/20 dark:hover:bg-[#E86A24]/30 font-medium text-sm transition"
                        >
                          <ListTree className="w-4 h-4" />
                          Permissões
                        </button>
                        <button
                          onClick={() => handleDeleteRole(r)}
                          disabled={deletingRoleId === r.id}
                          title="Excluir cargo"
                          className="p-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg disabled:opacity-50 transition"
                        >
                          {deletingRoleId === r.id ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Trash2 className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'push' && isCentral && (
          <div className="space-y-6">
            <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200">Enviar dados do Central para White Label</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Transfira usuários, instâncias, bancas CRM, campanhas e agendamentos do Zaploto Central para um white label. Os dados passam a pertencer ao tenant de destino.
            </p>
            <div className="p-5 bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">White label de destino</label>
                <select
                  value={pushTargetId || ''}
                  onChange={(e) => setPushTargetId(e.target.value || null)}
                  className="w-full max-w-md px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-100 focus:ring-2 focus:ring-[#E86A24] focus:border-[#E86A24]"
                >
                  <option value="">Selecione o tenant</option>
                  {tenants.filter((t) => !t.is_central).map((t) => (
                    <option key={t.id} value={t.id}>{t.name} ({t.slug})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Tipos de dados a transferir</label>
                <div className="flex flex-wrap gap-4">
                  {[
                    { key: 'profiles', label: 'Usuários (profiles)' },
                    { key: 'evolution_instances', label: 'Instâncias WhatsApp' },
                    { key: 'crm_bancas', label: 'Bancas CRM' },
                    { key: 'campaigns', label: 'Campanhas' },
                    { key: 'message_schedules', label: 'Agendamentos de mensagem' },
                  ].map(({ key, label }) => (
                    <label key={key} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!!pushTypes[key]}
                        onChange={(e) => setPushTypes((p) => ({ ...p, [key]: e.target.checked }))}
                        className="rounded border-gray-300 dark:border-gray-600 dark:bg-gray-700 text-[#E86A24] focus:ring-[#E86A24]"
                      />
                      <span className="text-sm text-gray-700 dark:text-gray-300">{label}</span>
                    </label>
                  ))}
                </div>
              </div>
              {pushResult && (
                <div className={`p-3 rounded-lg text-sm ${pushResult.error ? 'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-200' : 'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-200'}`}>
                  {pushResult.error ? (
                    pushResult.error
                  ) : (
                    <span>
                      Transferido:{' '}
                      {pushResult.updated && Object.entries(pushResult.updated).map(([k, v]) => `${k}: ${v}`).join(', ')}
                    </span>
                  )}
                </div>
              )}
              <button
                onClick={handlePushData}
                disabled={pushing}
                className="flex items-center gap-2 px-4 py-2 bg-[#E86A24] text-white rounded-lg hover:bg-[#7bc84d] disabled:opacity-50"
              >
                {pushing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                Transferir dados para o white label
              </button>
            </div>
          </div>
        )}

        {tab === 'modules' && (
          <div className="space-y-6">
            <div className="flex flex-wrap gap-3 items-center">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Tenant:</label>
              <select
                value={selectedTenantId || ''}
                onChange={(e) => syncTenantSelection(e.target.value || null)}
                className="px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:ring-2 focus:ring-[#E86A24] focus:border-[#E86A24] min-w-[200px]"
              >
                <option value="">Selecione um tenant</option>
                {tenants.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              {selectedTenantId && (
                <button
                  onClick={() => setShowCreateModule(true)}
                  className="flex items-center gap-2 px-4 py-2.5 bg-[#E86A24] text-white rounded-lg hover:bg-[#7bc84d] font-medium"
                >
                  <Plus className="w-4 h-4" />
                  Novo Módulo
                </button>
              )}
            </div>

            {showCreateModule && selectedTenantId && (
              <div className="p-5 bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 space-y-4">
                <h3 className="font-semibold text-gray-800 dark:text-gray-200">Criar novo módulo (item da sidebar)</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <input
                    type="text"
                    placeholder="Código (ex: novo_modulo)"
                    value={newModule.code}
                    onChange={(e) => setNewModule((m) => ({ ...m, code: e.target.value }))}
                    className="px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:ring-2 focus:ring-[#E86A24] focus:border-[#E86A24]"
                  />
                  <input
                    type="text"
                    placeholder="Label (ex: Novo Módulo)"
                    value={newModule.label}
                    onChange={(e) => setNewModule((m) => ({ ...m, label: e.target.value }))}
                    className="px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:ring-2 focus:ring-[#E86A24] focus:border-[#E86A24]"
                  />
                  <input
                    type="text"
                    placeholder="URL (ex: /novo-modulo)"
                    value={newModule.href}
                    onChange={(e) => setNewModule((m) => ({ ...m, href: e.target.value }))}
                    className="px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:ring-2 focus:ring-[#E86A24] focus:border-[#E86A24]"
                  />
                  <input
                    type="text"
                    placeholder="Módulo pai (code do pai ou vazio)"
                    value={newModule.parent_code}
                    onChange={(e) => setNewModule((m) => ({ ...m, parent_code: e.target.value }))}
                    className="px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:ring-2 focus:ring-[#E86A24] focus:border-[#E86A24]"
                  />
                  <select
                    value={newModule.icon_name}
                    onChange={(e) => setNewModule((m) => ({ ...m, icon_name: e.target.value }))}
                    className="px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-100 focus:ring-2 focus:ring-[#E86A24] focus:border-[#E86A24]"
                  >
                    {['LayoutDashboard', 'MessageSquare', 'Rocket', 'Users', 'Shield', 'Webhook', 'Workflow', 'Bot', 'Layout', 'Kanban', 'Activity', 'BarChart3', 'Briefcase', 'Settings', 'FlaskConical', 'User', 'ListOrdered', 'ClipboardList', 'ExternalLink', 'ArrowRightLeft'].map((icon) => (
                      <option key={icon} value={icon}>{icon}</option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleCreateModule}
                    disabled={saving}
                    className="flex items-center gap-2 px-4 py-2 bg-[#E86A24] text-white rounded-lg hover:bg-[#7bc84d] disabled:opacity-50"
                  >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Criar'}
                  </button>
                  <button
                    onClick={() => setShowCreateModule(false)}
                    className="px-4 py-2 bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-500"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            {editingModule && (
              <div ref={editFormRef} className="p-5 bg-amber-50/80 dark:bg-gray-800 rounded-xl border-2 border-[#E86A24] dark:border-[#E86A24] space-y-4">
                <h3 className="font-semibold text-gray-800 dark:text-gray-200">Editar módulo: {editingModule.label}</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <input
                    type="text"
                    placeholder="Código (ex: novo_modulo)"
                    value={editingModule.code}
                    onChange={(e) => setEditingModule((prev) => prev ? { ...prev, code: e.target.value } : null)}
                    className="px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:ring-2 focus:ring-[#E86A24] focus:border-[#E86A24]"
                  />
                  <input
                    type="text"
                    placeholder="Label (ex: Novo Módulo)"
                    value={editingModule.label}
                    onChange={(e) => setEditingModule((prev) => prev ? { ...prev, label: e.target.value } : null)}
                    className="px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:ring-2 focus:ring-[#E86A24] focus:border-[#E86A24]"
                  />
                  <input
                    type="text"
                    placeholder="URL (ex: /novo-modulo)"
                    value={editingModule.href || ''}
                    onChange={(e) => setEditingModule((prev) => prev ? { ...prev, href: e.target.value } : null)}
                    className="px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:ring-2 focus:ring-[#E86A24] focus:border-[#E86A24]"
                  />
                  <input
                    type="text"
                    placeholder="Módulo pai (code do pai ou vazio)"
                    value={editingModule.parent_code || ''}
                    onChange={(e) => setEditingModule((prev) => prev ? { ...prev, parent_code: e.target.value } : null)}
                    className="px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:ring-2 focus:ring-[#E86A24] focus:border-[#E86A24]"
                  />
                  <select
                    value={editingModule.icon_name || 'LayoutDashboard'}
                    onChange={(e) => setEditingModule((prev) => prev ? { ...prev, icon_name: e.target.value } : null)}
                    className="px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-100 focus:ring-2 focus:ring-[#E86A24] focus:border-[#E86A24]"
                  >
                    {['LayoutDashboard', 'MessageSquare', 'Rocket', 'Users', 'Shield', 'Webhook', 'Workflow', 'Bot', 'Layout', 'Kanban', 'Activity', 'BarChart3', 'Briefcase', 'Settings', 'FlaskConical', 'User', 'ListOrdered', 'ClipboardList', 'ExternalLink', 'ArrowRightLeft'].map((icon) => (
                      <option key={icon} value={icon}>{icon}</option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleUpdateModule}
                    disabled={saving}
                    className="flex items-center gap-2 px-4 py-2 bg-[#E86A24] text-white rounded-lg hover:bg-[#7bc84d] disabled:opacity-50"
                  >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Salvar'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingModule(null)}
                    className="px-4 py-2 bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-500"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            <div>
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Módulos disponíveis (itens da sidebar)</h3>
              {loadingModules ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="w-8 h-8 animate-spin text-[#E86A24]" />
                </div>
              ) : (
                <div className="space-y-2">
                  {modules.map((m) => (
                    <div
                      key={m.id}
                      className="flex items-center justify-between p-4 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 hover:border-[#E86A24]/50 dark:hover:border-[#E86A24]/50"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-gray-900 dark:text-gray-100">{m.label}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 font-mono">{m.code}</div>
                        {m.href && (
                          <div className="flex items-center gap-1 mt-1 text-xs text-gray-500 dark:text-gray-400">
                            <Route className="w-3.5 h-3.5" />
                            {m.href}
                          </div>
                        )}
                        {m.parent_code && (
                          <span className="text-xs text-gray-400 dark:text-gray-500">Pai: {m.parent_code}</span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setEditingModule({ ...m });
                        }}
                        title="Editar módulo"
                        className="p-2 text-[#E86A24] hover:bg-[#E86A24]/10 dark:hover:bg-[#E86A24]/20 rounded-lg"
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDeleteModule(m)}
                        disabled={deletingModuleId === m.id}
                        title="Excluir módulo"
                        className="p-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg disabled:opacity-50"
                      >
                        {deletingModuleId === m.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Trash2 className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  ))}
                  {modules.length === 0 && selectedTenantId && (
                    <p className="text-sm text-gray-500 dark:text-gray-400 py-8 text-center">Nenhum módulo. Clique em &quot;Novo Módulo&quot; para criar.</p>
                  )}
                </div>
              )}
            </div>

          </div>
        )}

        {permissionsRole && userId && (
          <RolePermissionsModal
            roleId={permissionsRole.id}
            roleLabel={permissionsRole.label}
            userId={userId}
            onClose={() => setPermissionsRole(null)}
          />
        )}
      </div>
    </Layout>
  );
}
