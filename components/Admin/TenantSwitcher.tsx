'use client';

import React, { useEffect, useState } from 'react';
import { Building2, ChevronDown } from 'lucide-react';
import { useAdminTenantSwitcher } from '@/contexts/AdminTenantSwitcherContext';
import { getStoredUserId } from '@/lib/utils/stored-user-id';

interface Tenant {
  id: string;
  name: string;
  slug: string;
}

/**
 * Seletor de tenant para super_admin. Permite "entrar" em qualquer white label.
 */
export function TenantSwitcher() {
  const { selectedTenantId, setSelectedTenantId } = useAdminTenantSwitcher() || {};
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const userId = getStoredUserId();
    if (!userId) return;
    fetch('/api/admin/zaploto/tenants', {
      headers: { 'X-User-Id': userId },
      credentials: 'include',
    })
      .then((r) => r.json())
      .then((j) => {
        if (j.success) setTenants(j.data || []);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading || tenants.length <= 1) return null;

  const current = tenants.find((t) => t.id === selectedTenantId) || tenants[0];

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-sm text-gray-700"
      >
        <Building2 className="w-4 h-4" />
        <span className="max-w-[140px] truncate">{current?.name || 'Tenant'}</span>
        <ChevronDown className={`w-4 h-4 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-1 py-1 bg-white rounded-lg shadow-lg border border-gray-200 z-50 min-w-[200px]">
            {tenants.map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  setSelectedTenantId?.(t.id);
                  setOpen(false);
                  window.location.reload();
                }}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-100 ${
                  t.id === selectedTenantId ? 'bg-[#8CD955]/10 text-[#8CD955] font-medium' : 'text-gray-700'
                }`}
              >
                {t.name}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
