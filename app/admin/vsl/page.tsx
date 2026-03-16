'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Layout from '@/components/Layout';
import { useRequireAuth } from '@/utils/useRequireAuth';
import { Plus, Settings, ExternalLink, Loader2 } from 'lucide-react';

interface VslProject {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  redirect_timer_seconds: number;
  logo_path: string | null;
  pixel_id: string | null;
  created_at: string;
}

export default function AdminVslPage() {
  const { checking, userId } = useRequireAuth();
  const router = useRouter();
  const [projects, setProjects] = useState<VslProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    const h = { 'X-User-Id': userId };
    fetch('/api/admin/vsl/projects', { headers: h })
      .then((r) => {
        if (r.status === 403) {
          setError('Acesso negado. Você não tem permissão para acessar o módulo VSL & Redirect.');
          return [];
        }
        return r.json();
      })
      .then((json) => {
        if (json?.data && Array.isArray(json.data)) setProjects(json.data);
        setLoading(false);
      })
      .catch(() => {
        setError('Erro ao carregar projetos');
        setLoading(false);
      });
  }, [userId]);

  if (checking || loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center p-12">
          <Loader2 className="w-8 h-8 animate-spin text-gray-500" />
        </div>
      </Layout>
    );
  }

  if (error) {
    return (
      <Layout>
        <div className="p-6">
          <p className="text-red-600">{error}</p>
          <button
            type="button"
            onClick={() => router.push('/admin')}
            className="mt-4 px-4 py-2 bg-gray-200 rounded-lg"
          >
            Voltar
          </button>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="p-6 max-w-4xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <h1 className="text-2xl font-bold text-gray-800">VSL White Label</h1>
          <button
            type="button"
            onClick={() => router.push('/admin/vsl/new')}
            className="flex items-center justify-center gap-2 px-5 py-2.5 bg-[#8CD955] text-white font-medium rounded-xl hover:opacity-90 transition shadow-sm"
          >
            <Plus className="w-4 h-4" />
            Novo projeto
          </button>
        </div>
        <ul className="space-y-3">
          {projects.map((p) => (
            <li
              key={p.id}
              className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow transition"
            >
              <div className="min-w-0">
                <p className="font-semibold text-gray-800 truncate">{p.name}</p>
                <p className="text-sm text-gray-600 font-mono">/{p.slug}</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  type="button"
                  onClick={() => router.push(`/admin/redirect/${p.slug}`)}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition"
                >
                  <ExternalLink className="w-4 h-4" />
                  Redirect
                </button>
                <button
                  type="button"
                  onClick={() => router.push(`/admin/vsl/${p.id}`)}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition"
                >
                  <Settings className="w-4 h-4" />
                  Config
                </button>
              </div>
            </li>
          ))}
        </ul>
        {projects.length === 0 && (
          <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
            <p className="text-gray-600">Nenhum projeto. Crie um para começar.</p>
          </div>
        )}
      </div>
    </Layout>
  );
}
