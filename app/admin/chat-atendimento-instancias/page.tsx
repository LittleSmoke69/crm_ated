'use client';

import React, { Suspense } from 'react';
import Link from '@/components/WhitelabelLink';
import Layout from '@/components/Layout';
import { useRequireAuth } from '@/utils/useRequireAuth';
import { Loader2, ArrowLeft } from 'lucide-react';
import AtendimentoChatInstancesPanel from '@/components/atendimento-chat/AtendimentoChatInstancesPanel';

function Content() {
  const { userId, userStatus, checking } = useRequireAuth();
  const ok = userStatus === 'admin' || userStatus === 'super_admin';

  if (checking || !userId) {
    return (
      <Layout>
        <div className="flex justify-center py-24">
          <Loader2 className="w-8 h-8 animate-spin text-gray-500" />
        </div>
      </Layout>
    );
  }

  if (!ok) {
    return (
      <Layout>
        <div className="p-6 text-center text-gray-600 dark:text-gray-400">Acesso negado.</div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="p-4 max-w-6xl mx-auto">
        <Link
          href="/admin/chat-gestao?tab=relatorio"
          className="inline-flex items-center gap-2 text-sm text-[#8CD955] hover:underline mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          Voltar à Gestão do Chat
        </Link>
        <AtendimentoChatInstancesPanel userId={userId} mode="admin" />
      </div>
    </Layout>
  );
}

export default function ChatAtendimentoInstanciasAdminPage() {
  return (
    <Suspense
      fallback={
        <Layout>
          <div className="flex justify-center py-24">
            <Loader2 className="w-8 h-8 animate-spin text-gray-500" />
          </div>
        </Layout>
      }
    >
      <Content />
    </Suspense>
  );
}
