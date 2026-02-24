'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useRequireAuth } from '@/utils/useRequireAuth';
import { useRouter } from 'next/navigation';
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
} from 'lucide-react';
import { RolePermissionsModal } from '@/components/Admin/RolePermissionsModal';
import { getStoredUserId } from '@/lib/utils/stored-user-id';

interface Tenant {
  id: string;
  name: string;
  slug: string;
  domain: string | null;
  app_title: string | null;
  primary_color: string;
  logo_url: string | null;
  is_active: boolean;
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
  const router = useRouter();
  const { isCollapsed, setIsCollapsed, isMobileOpen, setIsMobileOpen } = useSidebar();
  const [userId, setUserId] = useState<string | null>(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'tenants' | 'roles' | 'modules'>('tenants');
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);
  const [loadingRoles, setLoadingRoles] = useState(false);
  const [showCreateTenant, setShowCreateTenant] = useState(false);
  const [showCreateRole, setShowCreateRole] = useState(false);
  const [newTenant, setNewTenant] = useState({ name: '', slug: '', primary_color: '#8CD955', app_title: '' });
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

  const handleCreateTenant = async () => {
    if (!newTenant.name.trim()) {
      setError('Nome é obrigatório');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/zaploto/tenants/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId! },
        credentials: 'include',
        body: JSON.stringify({
          ...newTenant,
          slug: newTenant.slug || newTenant.name.toLowerCase().replace(/\s+/g, '-'),
          app_title: newTenant.app_title || newTenant.name,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setTenants((t) => [...t, json.data]);
        setShowCreateTenant(false);
        setNewTenant({ name: '', slug: '', primary_color: '#8CD955', app_title: '' });
      } else {
        setError(json.error || 'Erro ao criar tenant');
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro ao criar tenant');
    } finally {
      setSaving(false);
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
          <Loader2 className="w-8 h-8 animate-spin text-[#8CD955]" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="p-4 sm:p-6 max-w-5xl mx-auto">
        <button
          onClick={() => router.push('/admin')}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6"
        >
          <ChevronLeft className="w-5 h-5" />
          Voltar ao Admin
        </button>

        <h1 className="text-2xl font-bold text-gray-900 mb-6 flex items-center gap-2">
          <Shield className="w-7 h-7" />
          White Label & Cargos
        </h1>

        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setTab('tenants')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium ${
              tab === 'tenants' ? 'bg-[#8CD955] text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            <Building2 className="w-5 h-5" />
            Tenants (White Label)
          </button>
          <button
            onClick={() => setTab('roles')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium ${
              tab === 'roles' ? 'bg-[#8CD955] text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            <UserCog className="w-5 h-5" />
            Cargos
          </button>
          <button
            onClick={() => setTab('modules')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium ${
              tab === 'modules' ? 'bg-[#8CD955] text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            <Blocks className="w-5 h-5" />
            Módulos
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}

        {tab === 'tenants' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-semibold text-gray-800">Instâncias White Label</h2>
              <button
                onClick={() => setShowCreateTenant(true)}
                className="flex items-center gap-2 px-3 py-2 bg-[#8CD955] text-white rounded-lg hover:bg-[#7bc84d]"
              >
                <Plus className="w-4 h-4" />
                Novo Tenant
              </button>
            </div>

            {showCreateTenant && (
              <div className="p-4 bg-gray-50 rounded-xl border border-gray-200 space-y-3">
                <h3 className="font-medium">Criar novo tenant</h3>
                <input
                  type="text"
                  placeholder="Nome"
                  value={newTenant.name}
                  onChange={(e) => setNewTenant((t) => ({ ...t, name: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-gray-700 placeholder:text-gray-500"
                />
                <input
                  type="text"
                  placeholder="Slug (ex: minha-banca)"
                  value={newTenant.slug}
                  onChange={(e) => setNewTenant((t) => ({ ...t, slug: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-gray-700 placeholder:text-gray-500"
                />
                <input
                  type="text"
                  placeholder="Título do app"
                  value={newTenant.app_title}
                  onChange={(e) => setNewTenant((t) => ({ ...t, app_title: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-gray-700 placeholder:text-gray-500"
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleCreateTenant}
                    disabled={saving}
                    className="px-4 py-2 bg-[#8CD955] text-white rounded-lg disabled:opacity-50"
                  >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Criar'}
                  </button>
                  <button
                    onClick={() => setShowCreateTenant(false)}
                    className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg"
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
                  className="flex items-center justify-between p-4 bg-white rounded-xl border border-gray-200"
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
                      <div className="font-medium text-gray-900">{t.name}</div>
                      <div className="text-sm text-gray-500">{t.slug}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-1 rounded ${t.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                      {t.is_active ? 'Ativo' : 'Inativo'}
                    </span>
                    <button
                      onClick={() => router.push(`/admin/zaploto/tenants/${t.id}`)}
                      className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg"
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
              <label className="text-sm font-medium text-gray-700">Tenant:</label>
              <select
                value={selectedTenantId || ''}
                onChange={(e) => setSelectedTenantId(e.target.value || null)}
                className="px-4 py-2.5 border border-gray-300 rounded-lg bg-white text-gray-700 focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] min-w-[200px]"
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
                  className="flex items-center gap-2 px-4 py-2.5 bg-[#8CD955] text-white rounded-lg hover:bg-[#7bc84d] font-medium"
                >
                  <Plus className="w-4 h-4" />
                  Novo Cargo
                </button>
              )}
            </div>

            {showCreateRole && selectedTenantId && (
              <div className="p-5 bg-gray-50 rounded-xl border border-gray-200 space-y-4">
                <h3 className="font-semibold text-gray-800">Criar novo cargo</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <input
                    type="text"
                    placeholder="Código (ex: novo_cargo)"
                    value={newRole.code}
                    onChange={(e) => setNewRole((r) => ({ ...r, code: e.target.value }))}
                    className="px-3 py-2 border border-gray-200 rounded-lg text-gray-700 placeholder:text-gray-500 focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955]"
                  />
                  <input
                    type="text"
                    placeholder="Label (ex: Novo Cargo)"
                    value={newRole.label}
                    onChange={(e) => setNewRole((r) => ({ ...r, label: e.target.value }))}
                    className="px-3 py-2 border border-gray-200 rounded-lg text-gray-700 placeholder:text-gray-500 focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955]"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleCreateRole}
                    disabled={saving}
                    className="flex items-center gap-2 px-4 py-2 bg-[#8CD955] text-white rounded-lg hover:bg-[#7bc84d] disabled:opacity-50"
                  >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Criar'}
                  </button>
                  <button
                    onClick={() => setShowCreateRole(false)}
                    className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            <div>
              <h3 className="text-sm font-medium text-gray-700 mb-3">Cargos disponíveis</h3>
              {loadingRoles ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="w-8 h-8 animate-spin text-[#8CD955]" />
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {roles.map((r) => (
                    <div
                      key={r.id}
                      className="group flex flex-col p-4 bg-white rounded-xl border border-gray-200 hover:border-[#8CD955]/50 hover:shadow-md transition-all"
                    >
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-gray-900 truncate">{r.label}</div>
                          <div className="text-xs text-gray-500 font-mono mt-0.5">{r.code}</div>
                          {r.landing_route && (
                            <div className="flex items-center gap-1 mt-2 text-xs text-gray-500">
                              <Route className="w-3.5 h-3.5 flex-shrink-0" />
                              <span className="truncate">{r.landing_route}</span>
                            </div>
                          )}
                        </div>
                        {r.is_system && (
                          <span className="flex-shrink-0 text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded-full font-medium">
                            Sistema
                          </span>
                        )}
                      </div>
                      <div className="mt-auto pt-3 flex gap-2">
                        <button
                          onClick={() => setPermissionsRole(r)}
                          className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-[#8CD955]/10 text-[#8CD955] rounded-lg hover:bg-[#8CD955]/20 font-medium text-sm transition"
                        >
                          <ListTree className="w-4 h-4" />
                          Permissões
                        </button>
                        <button
                          onClick={() => handleDeleteRole(r)}
                          disabled={deletingRoleId === r.id}
                          title="Excluir cargo"
                          className="p-2 text-red-600 hover:bg-red-50 rounded-lg disabled:opacity-50 transition"
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

        {tab === 'modules' && (
          <div className="space-y-6">
            <div className="flex flex-wrap gap-3 items-center">
              <label className="text-sm font-medium text-gray-700">Tenant:</label>
              <select
                value={selectedTenantId || ''}
                onChange={(e) => setSelectedTenantId(e.target.value || null)}
                className="px-4 py-2.5 border border-gray-300 rounded-lg bg-white text-gray-700 placeholder:text-gray-500 focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] min-w-[200px]"
              >
                <option value="">Selecione um tenant</option>
                {tenants.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              {selectedTenantId && (
                <button
                  onClick={() => setShowCreateModule(true)}
                  className="flex items-center gap-2 px-4 py-2.5 bg-[#8CD955] text-white rounded-lg hover:bg-[#7bc84d] font-medium"
                >
                  <Plus className="w-4 h-4" />
                  Novo Módulo
                </button>
              )}
            </div>

            {showCreateModule && selectedTenantId && (
              <div className="p-5 bg-gray-50 rounded-xl border border-gray-200 space-y-4">
                <h3 className="font-semibold text-gray-800">Criar novo módulo (item da sidebar)</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <input
                    type="text"
                    placeholder="Código (ex: novo_modulo)"
                    value={newModule.code}
                    onChange={(e) => setNewModule((m) => ({ ...m, code: e.target.value }))}
                    className="px-3 py-2 border border-gray-200 rounded-lg text-gray-700 placeholder:text-gray-500 focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955]"
                  />
                  <input
                    type="text"
                    placeholder="Label (ex: Novo Módulo)"
                    value={newModule.label}
                    onChange={(e) => setNewModule((m) => ({ ...m, label: e.target.value }))}
                    className="px-3 py-2 border border-gray-200 rounded-lg text-gray-700 placeholder:text-gray-500 focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955]"
                  />
                  <input
                    type="text"
                    placeholder="URL (ex: /novo-modulo)"
                    value={newModule.href}
                    onChange={(e) => setNewModule((m) => ({ ...m, href: e.target.value }))}
                    className="px-3 py-2 border border-gray-200 rounded-lg text-gray-700 placeholder:text-gray-500 focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955]"
                  />
                  <input
                    type="text"
                    placeholder="Módulo pai (code do pai ou vazio)"
                    value={newModule.parent_code}
                    onChange={(e) => setNewModule((m) => ({ ...m, parent_code: e.target.value }))}
                    className="px-3 py-2 border border-gray-200 rounded-lg text-gray-700 placeholder:text-gray-500 focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955]"
                  />
                  <select
                    value={newModule.icon_name}
                    onChange={(e) => setNewModule((m) => ({ ...m, icon_name: e.target.value }))}
                    className="px-3 py-2 border border-gray-200 rounded-lg text-gray-700 focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955]"
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
                    className="flex items-center gap-2 px-4 py-2 bg-[#8CD955] text-white rounded-lg hover:bg-[#7bc84d] disabled:opacity-50"
                  >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Criar'}
                  </button>
                  <button
                    onClick={() => setShowCreateModule(false)}
                    className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            {editingModule && (
              <div ref={editFormRef} className="p-5 bg-amber-50/80 rounded-xl border-2 border-[#8CD955] space-y-4">
                <h3 className="font-semibold text-gray-800">Editar módulo: {editingModule.label}</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <input
                    type="text"
                    placeholder="Código (ex: novo_modulo)"
                    value={editingModule.code}
                    onChange={(e) => setEditingModule((prev) => prev ? { ...prev, code: e.target.value } : null)}
                    className="px-3 py-2 border border-gray-200 rounded-lg text-gray-700 placeholder:text-gray-500 focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955]"
                  />
                  <input
                    type="text"
                    placeholder="Label (ex: Novo Módulo)"
                    value={editingModule.label}
                    onChange={(e) => setEditingModule((prev) => prev ? { ...prev, label: e.target.value } : null)}
                    className="px-3 py-2 border border-gray-200 rounded-lg text-gray-700 placeholder:text-gray-500 focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955]"
                  />
                  <input
                    type="text"
                    placeholder="URL (ex: /novo-modulo)"
                    value={editingModule.href || ''}
                    onChange={(e) => setEditingModule((prev) => prev ? { ...prev, href: e.target.value } : null)}
                    className="px-3 py-2 border border-gray-200 rounded-lg text-gray-700 placeholder:text-gray-500 focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955]"
                  />
                  <input
                    type="text"
                    placeholder="Módulo pai (code do pai ou vazio)"
                    value={editingModule.parent_code || ''}
                    onChange={(e) => setEditingModule((prev) => prev ? { ...prev, parent_code: e.target.value } : null)}
                    className="px-3 py-2 border border-gray-200 rounded-lg text-gray-700 placeholder:text-gray-500 focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955]"
                  />
                  <select
                    value={editingModule.icon_name || 'LayoutDashboard'}
                    onChange={(e) => setEditingModule((prev) => prev ? { ...prev, icon_name: e.target.value } : null)}
                    className="px-3 py-2 border border-gray-200 rounded-lg text-gray-700 focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955]"
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
                    className="flex items-center gap-2 px-4 py-2 bg-[#8CD955] text-white rounded-lg hover:bg-[#7bc84d] disabled:opacity-50"
                  >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Salvar'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingModule(null)}
                    className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            <div>
              <h3 className="text-sm font-medium text-gray-700 mb-3">Módulos disponíveis (itens da sidebar)</h3>
              {loadingModules ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="w-8 h-8 animate-spin text-[#8CD955]" />
                </div>
              ) : (
                <div className="space-y-2">
                  {modules.map((m) => (
                    <div
                      key={m.id}
                      className="flex items-center justify-between p-4 bg-white rounded-xl border border-gray-200 hover:border-[#8CD955]/50"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-gray-900">{m.label}</div>
                        <div className="text-xs text-gray-500 font-mono">{m.code}</div>
                        {m.href && (
                          <div className="flex items-center gap-1 mt-1 text-xs text-gray-500">
                            <Route className="w-3.5 h-3.5" />
                            {m.href}
                          </div>
                        )}
                        {m.parent_code && (
                          <span className="text-xs text-gray-400">Pai: {m.parent_code}</span>
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
                        className="p-2 text-[#8CD955] hover:bg-[#8CD955]/10 rounded-lg"
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDeleteModule(m)}
                        disabled={deletingModuleId === m.id}
                        title="Excluir módulo"
                        className="p-2 text-red-600 hover:bg-red-50 rounded-lg disabled:opacity-50"
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
                    <p className="text-sm text-gray-500 py-8 text-center">Nenhum módulo. Clique em &quot;Novo Módulo&quot; para criar.</p>
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
