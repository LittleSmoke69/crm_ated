'use client';

import { useState } from 'react';
import { useTenantRouter } from '@/lib/utils/tenant-href';
import Layout from '@/components/Layout';
import { useRequireAuth } from '@/utils/useRequireAuth';
import { Loader2 } from 'lucide-react';

export default function NewVslProjectPage() {
  const { checking, userId } = useRequireAuth();
  const router = useTenantRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !slug.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/vsl/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId! },
        body: JSON.stringify({
          name: name.trim(),
          slug: slug.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '-'),
          redirect_timer_seconds: 5,
        }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.error || 'Erro ao criar');
        setSaving(false);
        return;
      }
      router.push(`/admin/vsl/${json.data.id}`);
    } catch {
      setError('Erro de rede');
      setSaving(false);
    }
  };

  if (checking) {
    return (
      <Layout>
        <div className="flex items-center justify-center p-12">
          <Loader2 className="w-8 h-8 animate-spin text-gray-500" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="p-6 max-w-lg mx-auto">
        <h1 className="text-2xl font-bold text-gray-800 mb-6">Novo projeto VSL</h1>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Nome</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-gray-800 placeholder:text-gray-500 focus:ring-2 focus:ring-[#8CD955]/50 focus:border-[#8CD955] outline-none"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Slug (ex: lotox)</label>
            <input
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-_]/g, '-'))}
              className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-gray-800 placeholder:text-gray-500 focus:ring-2 focus:ring-[#8CD955]/50 focus:border-[#8CD955] outline-none"
              placeholder="lotox"
              required
            />
            <p className="text-xs text-gray-500 mt-1.5">Redirect: /r/{slug || '...'}</p>
          </div>
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2.5 bg-[#8CD955] text-white font-medium rounded-xl hover:opacity-90 disabled:opacity-50 flex items-center gap-2 transition"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Criar
            </button>
            <button
              type="button"
              onClick={() => router.push('/admin/vsl')}
              className="px-5 py-2.5 bg-gray-200 text-gray-800 font-medium rounded-xl hover:bg-gray-300 transition"
            >
              Cancelar
            </button>
          </div>
        </form>
      </div>
    </Layout>
  );
}
