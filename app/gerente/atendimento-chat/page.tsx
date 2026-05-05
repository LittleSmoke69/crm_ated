'use client';

import React from 'react';
import { withTenantSlug } from '@/lib/utils/tenant-href';
import Layout from '@/components/Layout';
import { useRequireAuth } from '@/utils/useRequireAuth';
import AtendimentoChatInstancesPanel from '@/components/atendimento-chat/AtendimentoChatInstancesPanel';

export default function GerenteAtendimentoChatPage() {
  const { checking, userId } = useRequireAuth();

  const handleSignOut = async () => {
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('user_id');
      sessionStorage.removeItem('profile_id');
      window.localStorage.removeItem('profile_id');
      document.cookie = 'user_id=; Path=/; Max-Age=0; SameSite=Lax';
    }
    window.location.href = withTenantSlug('/login');
  };

  if (checking || !userId) {
    return (
      <Layout onSignOut={handleSignOut}>
        <div className="flex items-center justify-center min-h-[40vh] text-gray-500">Carregando...</div>
      </Layout>
    );
  }

  return (
    <Layout onSignOut={handleSignOut}>
      <div className="p-4">
        <AtendimentoChatInstancesPanel userId={userId} mode="gerente" />
      </div>
    </Layout>
  );
}
