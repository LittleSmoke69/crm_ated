'use client';

import React, { useEffect, useState } from 'react';
import { useTenantRouter } from '@/lib/utils/tenant-href';
import Layout from '@/components/Layout';
import { useRequireAuth } from '@/utils/useRequireAuth';
import { Loader2, AlertCircle, Server, Send, History } from 'lucide-react';
import SmtpAccountsManager from '@/components/Admin/Emails/SmtpAccountsManager';
import NewsletterManager from '@/components/Admin/Emails/NewsletterManager';
import EmailLogsHistory from '@/components/Admin/Emails/EmailLogsHistory';

type Tab = 'campaigns' | 'accounts' | 'logs';

const TABS: { key: Tab; label: string; icon: React.ElementType }[] = [
  { key: 'campaigns', label: 'Campanhas', icon: Send },
  { key: 'accounts', label: 'Contas de envio (SMTP)', icon: Server },
  { key: 'logs', label: 'Histórico', icon: History },
];

/** Admin > E-mails — disparo de e-mail: contas SMTP, campanhas (newsletter) e histórico com tracking. */
export default function AdminEmailsPage() {
  const router = useTenantRouter();
  const { checking, userId } = useRequireAuth();
  const [status, setStatus] = useState<string | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [tab, setTab] = useState<Tab>('campaigns');

  useEffect(() => {
    if (typeof window === 'undefined' || !userId) return;
    const loadProfile = async () => {
      try {
        const res = await fetch('/api/user/profile', { headers: { 'X-User-Id': userId } });
        const json = await res.json();
        setStatus(res.ok && json.success ? json.data?.status ?? null : null);
      } catch {
        setStatus(null);
      } finally {
        setLoadingStatus(false);
      }
    };
    loadProfile();
  }, [userId]);

  const canAccess = status === 'super_admin' || status === 'admin';

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
            <p className="text-gray-600 dark:text-[#aaa] mb-4">Acesso restrito a SuperAdmin ou Admin.</p>
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
        <div className="p-3 sm:p-4 md:p-6 max-w-[1600px] w-full mx-auto min-w-0 space-y-6">
          <div className="flex items-center gap-2 text-sm">
            <button
              type="button"
              onClick={() => router.push('/admin')}
              className="text-[#E86A24] dark:text-[#EF9057] font-medium hover:underline"
            >
              Admin
            </button>
            <span className="text-gray-400 dark:text-[#666]">/</span>
            <span className="text-gray-600 dark:text-[#aaa] font-medium">E-mails</span>
          </div>

          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">E-mails</h1>
            <p className="text-gray-600 dark:text-gray-400 mt-1">Disparo de e-mail: contas SMTP, campanhas e histórico de envios.</p>
          </div>

          <div className="flex flex-wrap gap-2 border-b border-gray-200 dark:border-gray-600">
            {TABS.map((t) => {
              const Icon = t.icon;
              const active = tab === t.key;
              return (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`flex items-center gap-2 px-4 py-2.5 -mb-px text-sm font-semibold border-b-2 transition-colors ${
                    active
                      ? 'border-[#E86A24] text-[#E86A24]'
                      : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
                  }`}
                >
                  <Icon className="w-4 h-4" /> {t.label}
                </button>
              );
            })}
          </div>

          {userId && tab === 'campaigns' && <NewsletterManager userId={userId} />}
          {userId && tab === 'accounts' && <SmtpAccountsManager userId={userId} />}
          {userId && tab === 'logs' && <EmailLogsHistory userId={userId} />}
        </div>
      </div>
    </Layout>
  );
}
