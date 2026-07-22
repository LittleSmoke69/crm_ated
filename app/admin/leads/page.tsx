'use client';

import React, { useState, useEffect } from 'react';
import { useTenantRouter } from '@/lib/utils/tenant-href';
import Layout from '@/components/Layout';
import { useRequireAuth } from '@/utils/useRequireAuth';
import LeadsSection from '@/components/Admin/LeadsSection';
import { Loader2, AlertCircle } from 'lucide-react';

/** Admin > Leads — gerenciamento de leads capturados (item "Leads" do grupo CRM na sidebar). */
export default function AdminLeadsPage() {
  const router = useTenantRouter();
  const { checking, userId } = useRequireAuth();
  const [status, setStatus] = useState<string | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [hasLeadsSidebar, setHasLeadsSidebar] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !userId) return;
    const loadProfile = async () => {
      try {
        const [profileRes, permRes] = await Promise.all([
          fetch('/api/user/profile', { headers: { 'X-User-Id': userId ?? '' } }),
          fetch('/api/user/has-sidebar-permission?code=crm_leads', { headers: { 'X-User-Id': userId ?? '' } }),
        ]);
        const profileJson = await profileRes.json();
        const permJson = await permRes.json();
        setStatus(profileRes.ok && profileJson.success ? profileJson.data?.status ?? null : null);
        setHasLeadsSidebar(Boolean(permRes.ok && permJson.success && permJson.data?.hasPermission));
      } catch {
        setStatus(null);
        setHasLeadsSidebar(false);
      } finally {
        setLoadingStatus(false);
      }
    };
    loadProfile();
  }, [userId]);

  const canAccess = status === 'super_admin' || status === 'admin' || hasLeadsSidebar;

  if (checking || loadingStatus) {
    return (
      <Layout>
        <div className="min-h-[60vh] flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-[#E86A24]" />
        </div>
      </Layout>
    );
  }

  if (!canAccess) {
    return (
      <Layout>
        <div className="min-h-[60vh] flex items-center justify-center">
          <div className="text-center bg-white dark:bg-[#2a2a2a] p-8 rounded-xl shadow-lg border border-gray-200 dark:border-[#404040]">
            <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
            <h1 className="text-xl font-bold text-gray-800 dark:text-white mb-2">Acesso Negado</h1>
            <p className="text-gray-600 dark:text-[#aaa] mb-4">Acesso restrito a SuperAdmin, Admin ou cargo com permissão de Leads.</p>
            <button
              onClick={() => router.push('/')}
              className="px-4 py-2 bg-[#E86A24] text-white rounded-lg hover:bg-[#D95E1B] transition"
            >
              Voltar ao Início
            </button>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="min-h-screen bg-gray-50/50 dark:bg-[#1a1a1a] overflow-x-hidden">
        <div className="p-3 sm:p-4 md:p-6 max-w-[1600px] w-full mx-auto min-w-0">
          <div className="flex items-center gap-2 text-sm mb-6">
            <button
              type="button"
              onClick={() => router.push('/admin')}
              className="text-[#E86A24] dark:text-[#EF9057] font-medium hover:underline"
            >
              Admin
            </button>
            <span className="text-gray-400 dark:text-[#666]">/</span>
            <span className="text-gray-600 dark:text-[#aaa] font-medium">Leads</span>
          </div>
          {userId && <LeadsSection userId={userId} />}
        </div>
      </div>
    </Layout>
  );
}
