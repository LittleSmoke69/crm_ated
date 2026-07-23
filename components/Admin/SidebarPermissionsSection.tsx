'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  ListTree,
  Loader2,
  Save,
  Shield,
} from 'lucide-react';
import {
  zapCard,
  zapCardGlowBottom,
  zapCardGlowTop,
} from '@/lib/zap-card-styles';
import type { SidebarItemWithPermission } from '@/components/Admin/RolePermissionsModal';

type Role = {
  id: string;
  code: string;
  label: string;
  description?: string | null;
  is_active?: boolean;
};

const ROLE_ORDER = ['super_admin', 'admin', 'gerente', 'captador'];
const ACTIVE_ROLE_CODES = new Set(ROLE_ORDER);

function sortRoles(roles: Role[]): Role[] {
  return [...roles].sort((a, b) => {
    const ia = ROLE_ORDER.indexOf(a.code);
    const ib = ROLE_ORDER.indexOf(b.code);
    if (ia === -1 && ib === -1) return a.label.localeCompare(b.label, 'pt-BR');
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
}

/**
 * Aba do Painel Admin: gerencia o que cada cargo vê na sidebar (zaploto_role_sidebar).
 * Restrito a super_admin (mesmas APIs de /admin/zaploto).
 */
export default function SidebarPermissionsSection({
  userId,
  selectedTenantId,
}: {
  userId: string;
  selectedTenantId: string | null;
}) {
  const [roles, setRoles] = useState<Role[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [items, setItems] = useState<SidebarItemWithPermission[]>([]);
  const [loadingRoles, setLoadingRoles] = useState(true);
  const [loadingItems, setLoadingItems] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [expandedParents, setExpandedParents] = useState<Set<string>>(new Set());
  const [zaplotoId, setZaplotoId] = useState<string | null>(selectedTenantId);

  const headers = useCallback(
    () => ({ 'X-User-Id': userId, 'Content-Type': 'application/json' }),
    [userId]
  );

  // Resolve tenant (switcher ou primeiro da lista)
  useEffect(() => {
    let cancelled = false;
    const resolve = async () => {
      if (selectedTenantId) {
        if (!cancelled) setZaplotoId(selectedTenantId);
        return;
      }
      try {
        const res = await fetch('/api/admin/zaploto/tenants', {
          headers: { 'X-User-Id': userId },
          credentials: 'include',
        });
        const json = await res.json();
        const list = json?.data ?? [];
        if (!cancelled) setZaplotoId(list[0]?.id ?? null);
      } catch {
        if (!cancelled) setZaplotoId(null);
      }
    };
    resolve();
    return () => {
      cancelled = true;
    };
  }, [selectedTenantId, userId]);

  // Carrega cargos do tenant
  useEffect(() => {
    if (!zaplotoId) {
      setRoles([]);
      setSelectedRoleId(null);
      setLoadingRoles(false);
      return;
    }

    let cancelled = false;
    const load = async () => {
      setLoadingRoles(true);
      setError(null);
      try {
        const res = await fetch(`/api/admin/zaploto/roles?zaploto_id=${zaplotoId}`, {
          headers: { 'X-User-Id': userId },
          credentials: 'include',
        });
        const json = await res.json();
        if (!res.ok || !json.success) {
          throw new Error(json.error || 'Erro ao carregar cargos');
        }
        const list = sortRoles(
          ((json.data || []) as Role[]).filter(
            (r) => r.is_active !== false && ACTIVE_ROLE_CODES.has(r.code)
          )
        );        if (cancelled) return;
        setRoles(list);
        setSelectedRoleId((prev) => {
          if (prev && list.some((r) => r.id === prev)) return prev;
          return list[0]?.id ?? null;
        });
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Erro ao carregar cargos');
          setRoles([]);
          setSelectedRoleId(null);
        }
      } finally {
        if (!cancelled) setLoadingRoles(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [zaplotoId, userId]);

  // Carrega permissões do cargo selecionado
  useEffect(() => {
    if (!selectedRoleId) {
      setItems([]);
      return;
    }

    let cancelled = false;
    const load = async () => {
      setLoadingItems(true);
      setError(null);
      setSuccess(null);
      try {
        const res = await fetch(`/api/admin/zaploto/roles/${selectedRoleId}/permissions`, {
          headers: { 'X-User-Id': userId },
          credentials: 'include',
        });
        const json = await res.json();
        if (!res.ok || !json.success) {
          throw new Error(json.error || 'Erro ao carregar permissões');
        }
        const next = (json.data?.items || []) as SidebarItemWithPermission[];
        if (cancelled) return;
        setItems(next);
        // Expande pais que tenham filhos visíveis
        const parents = new Set(
          next.filter((i) => i.parent_code && i.visible).map((i) => i.parent_code as string)
        );
        setExpandedParents(parents);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Erro ao carregar permissões');
          setItems([]);
        }
      } finally {
        if (!cancelled) setLoadingItems(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [selectedRoleId, userId]);

  const selectedRole = roles.find((r) => r.id === selectedRoleId) ?? null;

  const handleToggle = (itemId: string, visible: boolean) => {
    setItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, visible } : i)));
    setSuccess(null);
  };

  const toggleParent = (code: string) => {
    setExpandedParents((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const handleSave = async () => {
    if (!selectedRoleId) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/admin/zaploto/roles/${selectedRoleId}/permissions`, {
        method: 'PUT',
        headers: headers(),
        credentials: 'include',
        body: JSON.stringify({
          items: items.map((i) => ({
            sidebar_item_id: i.id,
            visible: i.visible,
          })),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Erro ao salvar');
      }
      setSuccess('Permissões da sidebar salvas. Usuários do cargo verão o menu atualizado no próximo carregamento.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar permissões');
    } finally {
      setSaving(false);
    }
  };

  const rootItems = items.filter((i) => !i.parent_code);
  const getChildren = (parentCode: string) => items.filter((i) => i.parent_code === parentCode);
  const visibleCount = items.filter((i) => i.visible).length;

  return (
    <div className={`${zapCard} p-4 sm:p-6`}>
      <div className={zapCardGlowTop} aria-hidden />
      <div className={zapCardGlowBottom} aria-hidden />

      <div className="relative z-10 space-y-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <ListTree className="h-6 w-6 text-[#E86A24]" />
              <h2 className="text-xl font-bold text-white sm:text-2xl">Permissões da Sidebar</h2>
            </div>
            <p className="mt-1 text-sm text-gray-400">
              Defina quais itens do menu cada cargo pode ver. Alterações valem para o white label selecionado no topo.
            </p>
          </div>
          {selectedRole && (
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || loadingItems || !items.length}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#E86A24] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#D95E1B] disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Salvar
            </button>
          )}
        </div>

        {error && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}
        {success && (
          <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
            {success}
          </div>
        )}

        {!zaplotoId && !loadingRoles && (
          <p className="text-sm text-gray-400">Selecione um white label no topo da página para gerenciar os cargos.</p>
        )}

        {loadingRoles ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-[#E86A24]" />
          </div>
        ) : roles.length === 0 && zaplotoId ? (
          <p className="text-sm text-gray-400">Nenhum cargo encontrado para este white label.</p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
            {/* Lista de cargos */}
            <div className="space-y-2">
              <p className="text-xs font-bold uppercase tracking-wider text-gray-500">Cargos</p>
              <div className="flex flex-row flex-wrap gap-2 lg:flex-col">
                {roles.map((role) => {
                  const active = role.id === selectedRoleId;
                  return (
                    <button
                      key={role.id}
                      type="button"
                      onClick={() => setSelectedRoleId(role.id)}
                      className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm font-medium transition ${
                        active
                          ? 'border-[#E86A24] bg-[#E86A24]/15 text-white'
                          : 'border-[#404040] bg-[#1f1a18]/80 text-gray-300 hover:border-[#E86A24]/40'
                      }`}
                    >
                      <Shield className={`h-4 w-4 shrink-0 ${active ? 'text-[#E86A24]' : 'text-gray-500'}`} />
                      <span className="truncate">{role.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Árvore de itens */}
            <div className="min-w-0 rounded-xl border border-[#404040] bg-[#1c1410]/60">
              <div className="flex items-center justify-between gap-2 border-b border-[#404040] px-4 py-3">
                <div>
                  <p className="font-semibold text-white">
                    {selectedRole ? selectedRole.label : 'Selecione um cargo'}
                  </p>
                  {selectedRole && (
                    <p className="text-xs text-gray-500">
                      {visibleCount} de {items.length} itens visíveis
                      {selectedRole.code ? ` · código: ${selectedRole.code}` : ''}
                    </p>
                  )}
                </div>
              </div>

              <div className="max-h-[min(70vh,640px)] overflow-y-auto p-3">
                {loadingItems ? (
                  <div className="flex justify-center py-16">
                    <Loader2 className="h-8 w-8 animate-spin text-[#E86A24]" />
                  </div>
                ) : !selectedRoleId ? (
                  <p className="py-8 text-center text-sm text-gray-500">Escolha um cargo à esquerda.</p>
                ) : items.length === 0 ? (
                  <p className="py-8 text-center text-sm text-gray-500">
                    Nenhum módulo de sidebar cadastrado. Cadastre em White Label & Cargos → Módulos.
                  </p>
                ) : (
                  <div className="space-y-1">
                    {rootItems
                      .sort((a, b) => a.sort_order - b.sort_order)
                      .map((item) => {
                        const children = getChildren(item.code);
                        const hasChildren = children.length > 0;
                        const isExpanded = expandedParents.has(item.code);

                        return (
                          <div key={item.id} className="rounded-lg border border-[#404040]/80">
                            <div className="flex items-center gap-2 px-3 py-2.5 hover:bg-white/[0.03]">
                              {hasChildren ? (
                                <button
                                  type="button"
                                  onClick={() => toggleParent(item.code)}
                                  className="p-0.5 text-gray-500 hover:text-gray-300"
                                  aria-label={isExpanded ? 'Recolher' : 'Expandir'}
                                >
                                  {isExpanded ? (
                                    <ChevronDown className="h-4 w-4" />
                                  ) : (
                                    <ChevronRight className="h-4 w-4" />
                                  )}
                                </button>
                              ) : (
                                <span className="w-5" />
                              )}
                              <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-100">
                                {item.label}
                              </span>
                              {item.href && (
                                <span className="hidden max-w-[140px] truncate text-xs text-gray-500 sm:inline">
                                  {item.href}
                                </span>
                              )}
                              <VisibilityToggle
                                visible={item.visible}
                                onToggle={() => handleToggle(item.id, !item.visible)}
                              />
                            </div>

                            {hasChildren && isExpanded && (
                              <div className="ml-4 space-y-1 border-l-2 border-[#E86A24]/30 pb-2 pl-4 pr-3">
                                {children
                                  .sort((a, b) => a.sort_order - b.sort_order)
                                  .map((child) => (
                                    <div
                                      key={child.id}
                                      className="flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-white/[0.03]"
                                    >
                                      <span className="min-w-0 flex-1 truncate text-sm text-gray-300">
                                        {child.label}
                                      </span>
                                      {child.href && (
                                        <span className="hidden max-w-[120px] truncate text-xs text-gray-500 sm:inline">
                                          {child.href}
                                        </span>
                                      )}
                                      <VisibilityToggle
                                        visible={child.visible}
                                        onToggle={() => handleToggle(child.id, !child.visible)}
                                      />
                                    </div>
                                  ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function VisibilityToggle({
  visible,
  onToggle,
}: {
  visible: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium transition ${
        visible
          ? 'bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25'
          : 'bg-[#333] text-gray-500 hover:bg-[#404040]'
      }`}
      title={visible ? 'Ocultar da sidebar' : 'Exibir na sidebar'}
    >
      {visible ? (
        <>
          <Eye className="h-3.5 w-3.5" />
          Visível
        </>
      ) : (
        <>
          <EyeOff className="h-3.5 w-3.5" />
          Oculto
        </>
      )}
    </button>
  );
}
