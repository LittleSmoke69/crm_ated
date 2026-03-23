'use client';

import React, { Suspense, useCallback, useEffect, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Layout from '@/components/Layout';
import { useRequireAuth } from '@/utils/useRequireAuth';
import { BarChart3, Loader2 } from 'lucide-react';
import ChatGestaoReportSection from '@/components/Admin/chat-gestao/ChatGestaoReportSection';
import ChatGestaoTagsSection from '@/components/Admin/chat-gestao/ChatGestaoTagsSection';

type TabId = 'relatorio' | 'etiquetas';

function ChatGestaoContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { userId, userStatus, checking } = useRequireAuth();

  const isAdminFull = userStatus === 'admin' || userStatus === 'super_admin';
  const isGerente = userStatus === 'gerente';
  const canAccess = isAdminFull || isGerente;

  const validTabs: TabId[] = useMemo(() => {
    if (isAdminFull) return ['relatorio', 'etiquetas'];
    if (isGerente) return ['relatorio'];
    return [];
  }, [isAdminFull, isGerente]);

  const tabParam = (searchParams.get('tab') || '').toLowerCase();
  const activeTab: TabId = useMemo(() => {
    if (validTabs.length === 0) return 'relatorio';
    const t = tabParam as TabId;
    if (validTabs.includes(t)) return t;
    return validTabs[0];
  }, [tabParam, validTabs]);

  const setTab = useCallback(
    (t: TabId) => {
      router.replace(`/admin/chat-gestao?tab=${t}`, { scroll: false });
    },
    [router]
  );

  useEffect(() => {
    if (!checking && canAccess && tabParam && !validTabs.includes(tabParam as TabId)) {
      router.replace(`/admin/chat-gestao?tab=${validTabs[0]}`, { scroll: false });
    }
  }, [checking, canAccess, tabParam, validTabs, router]);

  if (checking || !userId) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[40vh]">
          <Loader2 className="w-8 h-8 animate-spin text-gray-500" />
        </div>
      </Layout>
    );
  }

  if (!canAccess) {
    return (
      <Layout>
        <div className="p-6 text-center text-gray-600 dark:text-gray-400">
          Acesso negado. Apenas administradores e gerentes podem acessar a gestão do chat.
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="p-6 max-w-6xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <BarChart3 className="w-9 h-9 text-[#8CD955]" />
          <div>
            <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">Gestão do Chat</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Relatório por banca e gerente, etiquetas do chat e link para configurar instâncias.
            </p>
          </div>
        </div>

        {isAdminFull && (
          <div className="flex flex-wrap gap-2 mb-8 border-b border-gray-200 dark:border-[#404040] pb-1">
            {(
              [
                { id: 'relatorio' as const, label: 'Relatório' },
                { id: 'etiquetas' as const, label: 'Etiquetas' },
              ] as const
            ).map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
                  activeTab === id
                    ? 'bg-white dark:bg-[#2a2a2a] text-gray-900 dark:text-gray-100 border border-b-0 border-gray-200 dark:border-[#404040]'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        <div className="pt-2">
          {activeTab === 'relatorio' && (
            <ChatGestaoReportSection userId={userId} isAdminFull={isAdminFull} />
          )}
          {activeTab === 'etiquetas' && isAdminFull && <ChatGestaoTagsSection userId={userId} />}
        </div>
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
