'use client';

import React, { Suspense } from 'react';
import Layout from '@/components/Layout';
import { useRequireAuth } from '@/utils/useRequireAuth';
import { Headphones, Loader2 } from 'lucide-react';
import ChatGestaoAtendimentosSection from '@/components/Admin/chat-gestao/ChatGestaoAtendimentosSection';
import ChatGestaoTagsSection from '@/components/Admin/chat-gestao/ChatGestaoTagsSection';

function ChatGestaoContent() {
  const { userId, userStatus, checking } = useRequireAuth();

  const isAdminFull = userStatus === 'admin' || userStatus === 'super_admin';

  if (checking || !userId) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[40vh]">
          <Loader2 className="w-8 h-8 animate-spin text-gray-500" />
        </div>
      </Layout>
    );
  }

  if (!isAdminFull) {
    return (
      <Layout>
        <div className="p-6 text-center text-gray-600 dark:text-gray-400">
          Acesso negado. Apenas administradores podem acessar a gestão do chat.
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
            <h1 className="text-2xl font-bold text-white">Gestão do Chat</h1>
            <p className="text-sm text-gray-400">
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
    <Suspense
      fallback={
        <Layout>
          <div className="flex items-center justify-center min-h-[40vh]">
            <Loader2 className="w-8 h-8 animate-spin text-gray-500" />
          </div>
        </Layout>
      }
    >
      <ChatGestaoContent />
    </Suspense>
  );
}
