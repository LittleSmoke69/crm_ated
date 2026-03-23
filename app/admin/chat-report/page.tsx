'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Layout from '@/components/Layout';
import { Loader2 } from 'lucide-react';

/** Redireciona para a gestão unificada do chat (aba Relatório). */
export default function ChatReportRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/admin/chat-gestao?tab=relatorio');
  }, [router]);
  return (
    <Layout>
      <div className="flex justify-center py-24">
        <Loader2 className="w-8 h-8 animate-spin text-gray-500" />
      </div>
    </Layout>
  );
}
