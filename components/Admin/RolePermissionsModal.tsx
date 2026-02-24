'use client';

import React, { useEffect, useState } from 'react';
import {
  X,
  Loader2,
  Save,
  ListTree,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
} from 'lucide-react';

export interface SidebarItemWithPermission {
  id: string;
  code: string;
  label: string;
  href: string | null;
  icon_name: string | null;
  parent_code: string | null;
  sort_order: number;
  visible: boolean;
}

interface RolePermissionsModalProps {
  roleId: string;
  roleLabel: string;
  onClose: () => void;
  onSaved?: () => void;
  userId: string;
}

export function RolePermissionsModal({
  roleId,
  roleLabel,
  onClose,
  onSaved,
  userId,
}: RolePermissionsModalProps) {
  const [items, setItems] = useState<SidebarItemWithPermission[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedParents, setExpandedParents] = useState<Set<string>>(new Set());

  useEffect(() => {
    const fetchPermissions = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/admin/zaploto/roles/${roleId}/permissions`, {
          headers: { 'X-User-Id': userId },
          credentials: 'include',
        });
        const json = await res.json();
        if (json.success) {
          setItems(json.data?.items || []);
        } else {
          setError(json.error || 'Erro ao carregar permissões');
        }
      } catch (e) {
        setError('Erro ao carregar permissões');
      } finally {
        setLoading(false);
      }
    };
    fetchPermissions();
  }, [roleId, userId]);

  const handleToggle = (itemId: string, visible: boolean) => {
    setItems((prev) =>
      prev.map((i) => (i.id === itemId ? { ...i, visible } : i))
    );
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/zaploto/roles/${roleId}/permissions`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': userId,
        },
        credentials: 'include',
        body: JSON.stringify({
          items: items.map((i) => ({
            sidebar_item_id: i.id,
            visible: i.visible,
          })),
        }),
      });
      const json = await res.json();
      if (json.success) {
        onSaved?.();
        onClose();
      } else {
        setError(json.error || 'Erro ao salvar');
      }
    } catch (e) {
      setError('Erro ao salvar permissões');
    } finally {
      setSaving(false);
    }
  };

  const rootItems = items.filter((i) => !i.parent_code);
  const getChildren = (parentCode: string) =>
    items.filter((i) => i.parent_code === parentCode);

  const toggleParent = (code: string) => {
    setExpandedParents((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <ListTree className="w-6 h-6 text-[#8CD955]" />
            <h2 className="text-xl font-semibold text-gray-900">
              Permissões da Sidebar — {roleLabel}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="mx-4 mt-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-[#8CD955]" />
            </div>
          ) : (
            <div className="space-y-1">
              {rootItems
                .sort((a, b) => a.sort_order - b.sort_order)
                .map((item) => {
                  const children = getChildren(item.code);
                  const hasChildren = children.length > 0;
                  const isExpanded = expandedParents.has(item.code);

                  return (
                    <div key={item.id} className="rounded-lg border border-gray-100">
                      <div
                        className={`flex items-center gap-2 px-3 py-2.5 hover:bg-gray-50 ${
                          hasChildren ? 'cursor-pointer' : ''
                        }`}
                      >
                        {hasChildren ? (
                          <button
                            onClick={() => toggleParent(item.code)}
                            className="p-0.5 text-gray-500 hover:text-gray-700"
                          >
                            {isExpanded ? (
                              <ChevronDown className="w-4 h-4" />
                            ) : (
                              <ChevronRight className="w-4 h-4" />
                            )}
                          </button>
                        ) : (
                          <span className="w-5" />
                        )}
                        <span className="flex-1 text-sm font-medium text-gray-800">
                          {item.label}
                        </span>
                        {item.href && (
                          <span className="text-xs text-gray-400 truncate max-w-[120px]">
                            {item.href}
                          </span>
                        )}
                        <button
                          onClick={() => handleToggle(item.id, !item.visible)}
                          className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition ${
                            item.visible
                              ? 'bg-green-100 text-green-700 hover:bg-green-200'
                              : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                          }`}
                          title={item.visible ? 'Ocultar' : 'Exibir'}
                        >
                          {item.visible ? (
                            <>
                              <Eye className="w-3.5 h-3.5" />
                              Visível
                            </>
                          ) : (
                            <>
                              <EyeOff className="w-3.5 h-3.5" />
                              Oculto
                            </>
                          )}
                        </button>
                      </div>

                      {hasChildren && isExpanded && (
                        <div className="pl-8 pr-3 pb-2 space-y-1 border-l-2 border-[#8CD955]/30 ml-4">
                          {children
                            .sort((a, b) => a.sort_order - b.sort_order)
                            .map((child) => (
                              <div
                                key={child.id}
                                className="flex items-center gap-2 px-2 py-2 rounded hover:bg-gray-50"
                              >
                                <span className="flex-1 text-sm text-gray-600">
                                  {child.label}
                                </span>
                                {child.href && (
                                  <span className="text-xs text-gray-400 truncate max-w-[100px]">
                                    {child.href}
                                  </span>
                                )}
                                <button
                                  onClick={() =>
                                    handleToggle(child.id, !child.visible)
                                  }
                                  className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition ${
                                    child.visible
                                      ? 'bg-green-100 text-green-700'
                                      : 'bg-gray-100 text-gray-500'
                                  }`}
                                >
                                  {child.visible ? 'Visível' : 'Oculto'}
                                </button>
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

        <div className="flex justify-end gap-2 p-4 border-t border-gray-200">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving || loading}
            className="flex items-center gap-2 px-4 py-2 bg-[#8CD955] text-white rounded-lg hover:bg-[#7bc84d] disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            Salvar alterações
          </button>
        </div>
      </div>
    </div>
  );
}
