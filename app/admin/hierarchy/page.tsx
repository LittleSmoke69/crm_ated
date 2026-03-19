'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Layout from '@/components/Layout';
import { useRequireAuth } from '@/utils/useRequireAuth';
import HierarchySection from '@/components/Admin/HierarchySection';
import { Loader2, AlertCircle } from 'lucide-react';

export default function AdminHierarchyPage() {
  const router = useRouter();
  const { checking, userId } = useRequireAuth();
  const [status, setStatus] = useState<string | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);

  const [hasHierarquiaSidebar, setHasHierarquiaSidebar] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !userId) return;
    const loadProfile = async () => {
      try {
        const [profileRes, permRes] = await Promise.all([
          fetch('/api/user/profile', { headers: { 'X-User-Id': userId ?? '' } }),
          fetch('/api/user/has-sidebar-permission?code=hierarquia', { headers: { 'X-User-Id': userId ?? '' } }),
        ]);
        const profileJson = await profileRes.json();
        const permJson = await permRes.json();
        if (profileRes.ok && profileJson.success && profileJson.data?.status) {
          setStatus(profileJson.data.status);
        } else {
          setStatus(null);
        }
        if (permRes.ok && permJson.success && permJson.data?.hasPermission) {
          setHasHierarquiaSidebar(true);
        } else {
          setHasHierarquiaSidebar(false);
        }
      } catch {
        setStatus(null);
        setHasHierarquiaSidebar(false);
      } finally {
        setLoadingStatus(false);
      }
    };
    loadProfile();
  }, [userId]);

  const canAccess = status === 'super_admin' || status === 'admin' || status === 'suporte' || hasHierarquiaSidebar;

  if (checking || loadingStatus) {
    return (
      <Layout>
        <div className="min-h-[60vh] flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-[#8CD955]" />
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
            <p className="text-gray-600 dark:text-[#aaa] mb-4">Acesso restrito a SuperAdmin, Admin, Suporte ou cargo com permissão de Hierarquia.</p>
            <button
              onClick={() => router.push('/')}
              className="px-4 py-2 bg-[#8CD955] text-white rounded-lg hover:bg-[#7BC84A] transition"
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
              onClick={() => router.push(status === 'suporte' ? '/' : '/admin')}
              className="text-[#8CD955] dark:text-[#00ff00] font-medium hover:underline"
            >
              {status === 'suporte' ? 'Início' : 'Admin'}
            </button>
            <span className="text-gray-400 dark:text-[#666]">/</span>
            <span className="text-gray-600 dark:text-[#aaa] font-medium">Hierarquia</span>
          </div>
          <HierarchySection userId={userId} />
        </div>
      </div>
    </Layout>
  );
}
