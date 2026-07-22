'use client';

import React, { Suspense } from 'react';
import Layout from '@/components/Layout';
import { useRequireAuth } from '@/utils/useRequireAuth';
import { Headphones, ShieldAlert } from 'lucide-react';
import { EmptyState, StatCardSkeleton, CardSkeleton, Skeleton } from '@/components/ui';
import ChatGestaoAtendimentosSection from '@/components/Admin/chat-gestao/ChatGestaoAtendimentosSection';
import ChatGestaoTagsSection from '@/components/Admin/chat-gestao/ChatGestaoTagsSection';

function PageSkeleton() {
  return (
    <Layout>
      <div className="p-6 max-w-6xl mx-auto">
        <div className="flex items-center gap-3 mb-8">
          <Skeleton className="w-9 h-9 rounded-xl" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-72" />
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
          {Array.from({ length: 5 }).map((_, i) => (
            <StatCardSkeleton key={i} />
          ))}
        </div>
        <CardSkeleton />
      </div>
    </Layout>
  );
}

function ChatGestaoContent() {
  const { userId, userStatus, checking } = useRequireAuth();

  const isAdminFull = userStatus === 'admin' || userStatus === 'super_admin';

  if (checking || !userId) {
    return <PageSkeleton />;
  }

  if (!isAdminFull) {
    return (
      <Layout>
        <div className="p-6 max-w-6xl mx-auto">
          <EmptyState
            icon={<ShieldAlert className="w-8 h-8" />}
            title="Acesso negado"
            description="Apenas administradores podem acessar a gestão do chat."
          />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="p-6 max-w-6xl mx-auto">
        <div className="flex items-center gap-3 mb-8">
          <Headphones className="w-9 h-9 text-[#E86A24]" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Gestão do Chat</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Acompanhe os atendimentos realizados pela equipe e gerencie etiquetas do chat.
            </p>
          </div>
        </div>

        <ChatGestaoAtendimentosSection userId={userId} />
        <ChatGestaoTagsSection userId={userId} secondary />
      </div>
    </Layout>
  );
}

export default function ChatGestaoPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ChatGestaoContent />
    </Suspense>
  );
}
