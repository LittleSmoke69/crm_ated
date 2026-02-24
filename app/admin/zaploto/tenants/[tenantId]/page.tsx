'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Layout from '@/components/Layout';
import { useRequireAuth } from '@/utils/useRequireAuth';
import { getStoredUserId } from '@/lib/utils/stored-user-id';
import { getTenantBaseUrl, getTenantLoginUrl } from '@/lib/utils/zaploto-tenant-url';
import { ChevronLeft, Loader2, Copy, Check, Trash2 } from 'lucide-react';

interface TenantData {
  id: string;
  name: string;
  slug: string;
  domain: string | null;
  logo_url: string | null;
  favicon_url: string | null;
  primary_color: string;
  secondary_color: string | null;
  app_title: string | null;
  support_email: string | null;
  is_active: boolean;
  is_central?: boolean;
}

export default function AdminZaplotoTenantDetailPage() {
  const params = useParams();
  const router = useRouter();
  const tenantId = params?.tenantId as string | undefined;
  const { checking } = useRequireAuth();
  const [userId, setUserId] = useState<string | null>(null);
  const [tenant, setTenant] = useState<TenantData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [form, setForm] = useState<Partial<TenantData>>({});

  useEffect(() => {
    setUserId(getStoredUserId());
  }, []);

  useEffect(() => {
    if (!tenantId || !userId) return;
    setLoading(true);
    setError(null);
    fetch(`/api/admin/zaploto/tenants/${tenantId}`, {
      headers: { 'X-User-Id': userId },
      credentials: 'include',
    })
      .then((r) => r.json())
      .then((json) => {
        if (json.success && json.data) {
          setTenant(json.data);
          setForm({
            name: json.data.name,
            slug: json.data.slug,
            app_title: json.data.app_title ?? '',
            primary_color: json.data.primary_color ?? '#8CD955',
            is_active: json.data.is_active,
          });
        } else {
          setError(json.error || 'Tenant não encontrado');
        }
      })
      .catch(() => setError('Erro ao carregar tenant'))
      .finally(() => setLoading(false));
  }, [tenantId, userId]);

  const handleSave = async () => {
    if (!tenantId || !userId || !form.name?.trim() || !form.slug?.trim()) {
      setError('Nome e slug são obrigatórios');
      return;
    }
    setSaving(true);
    setError(null);
    const normalizedSlug = form.slug!.trim().toLowerCase().replace(/\s+/g, '-');

    try {
      const res = await fetch(`/api/admin/zaploto/tenants/${tenantId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
        credentials: 'include',
        body: JSON.stringify({
          name: form.name!.trim(),
          slug: normalizedSlug,
          domain: null,
          app_title: form.app_title?.trim() || form.name,
          primary_color: form.primary_color || '#8CD955',
          is_active: form.is_active,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setTenant((t) => (t ? { ...t, ...json.data, slug: normalizedSlug } : null));
      } else {
        setError(json.error || 'Erro ao atualizar');
      }
    } catch {
      setError('Erro ao atualizar');
    } finally {
      setSaving(false);
    }
  };

  const handleCopyUrl = (url: string) => {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleDelete = async () => {
    if (!tenantId || !userId || !tenant) return;
    const centralId = '00000000-0000-0000-0000-000000000001';
    if (tenantId === centralId || tenant.is_central) {
      setError('Não é possível excluir o Zaploto Central.');
      return;
    }
    if (!confirm(`Excluir o white label "${tenant.name}"? Esta ação não pode ser desfeita e pode afetar usuários e dados vinculados.`)) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/zaploto/tenants/${tenantId}`, {
        method: 'DELETE',
        headers: { 'X-User-Id': userId },
        credentials: 'include',
      });
      const json = await res.json();
      if (json.success) {
        router.push('/admin/zaploto');
        return;
      }
      setError(json.error || 'Erro ao excluir white label');
    } catch {
      setError('Erro ao excluir white label');
    } finally {
      setDeleting(false);
    }
  };

  if (checking || loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[400px]">
          <Loader2 className="w-8 h-8 animate-spin text-[#8CD955]" />
        </div>
      </Layout>
    );
  }

  if (!tenant) {
    return (
      <Layout>
        <div className="p-4 sm:p-6 max-w-2xl mx-auto">
          <button
            onClick={() => router.push('/admin/zaploto')}
            className="flex items-center gap-2 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white mb-6"
          >
            <ChevronLeft className="w-5 h-5" />
            Voltar
          </button>
          <div className="p-4 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-200">
            {error || 'Tenant não encontrado'}
          </div>
        </div>
      </Layout>
    );
  }

  const slug = (tenant.slug ?? '').trim().toLowerCase().replace(/\s+/g, '-');
  const baseUrl = getTenantBaseUrl(slug);
  const loginUrl = getTenantLoginUrl(slug);

  return (
    <Layout>
      <div className="p-4 sm:p-6 max-w-2xl mx-auto">
        <button
          onClick={() => router.push('/admin/zaploto')}
          className="flex items-center gap-2 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white mb-6"
        >
          <ChevronLeft className="w-5 h-5" />
          Voltar ao White Label & Cargos
        </button>

        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
          Editar tenant: {tenant.name}
        </h1>

        {error && (
          <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-200 text-sm">
            {error}
          </div>
        )}

        {/* URLs do white label: zaploto.com/slug e zaploto.com/slug/login */}
        <div className="mb-6 space-y-4 p-4 bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">URLs do white label (zaploto.com + slug em todas as rotas)</p>
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Base</p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="flex-1 min-w-0 text-xs sm:text-sm text-gray-600 dark:text-gray-400 bg-white dark:bg-gray-700 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 truncate">
                {baseUrl}
              </code>
              <button
                type="button"
                onClick={() => handleCopyUrl(baseUrl)}
                className="flex items-center gap-2 px-3 py-2 bg-[#8CD955] text-white rounded-lg hover:bg-[#7bc84d] text-sm font-medium shrink-0"
              >
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {copied ? 'Copiado!' : 'Copiar'}
              </button>
            </div>
          </div>
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Login</p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="flex-1 min-w-0 text-xs sm:text-sm text-gray-600 dark:text-gray-400 bg-white dark:bg-gray-700 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 truncate">
                {loginUrl}
              </code>
              <button
                type="button"
                onClick={() => handleCopyUrl(loginUrl)}
                className="flex items-center gap-2 px-3 py-2 bg-[#8CD955] text-white rounded-lg hover:bg-[#7bc84d] text-sm font-medium shrink-0"
              >
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {copied ? 'Copiado!' : 'Copiar login'}
              </button>
            </div>
          </div>
        </div>

        <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nome</label>
            <input
              value={form.name ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-100"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Slug</label>
            <input
              value={form.slug ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
              placeholder="ex: samuelzaploto"
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400"
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Todas as URLs do sistema usam zaploto.com/{'{slug}'}/... (ex.: zaploto.com/{'{slug}'}/login).
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Título do app</label>
            <input
              value={form.app_title ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, app_title: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-100"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Cor primária</label>
            <input
              type="text"
              value={form.primary_color ?? '#8CD955'}
              onChange={(e) => setForm((f) => ({ ...f, primary_color: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-100"
            />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.is_active !== false}
              onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
              className="rounded border-gray-300 dark:border-gray-600 text-[#8CD955] focus:ring-[#8CD955]"
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">Ativo</span>
          </label>
          <div className="flex flex-wrap gap-2 pt-2 items-center justify-between">
            <div className="flex gap-2">
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 bg-[#8CD955] text-white rounded-lg hover:bg-[#7bc84d] disabled:opacity-50 flex items-center gap-2"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Salvar
              </button>
              <button
                onClick={() => router.push('/admin/zaploto')}
                className="px-4 py-2 bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-500"
              >
                Cancelar
              </button>
            </div>
            {tenant.id !== '00000000-0000-0000-0000-000000000001' && !tenant.is_central && (
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="px-4 py-2 text-red-600 dark:text-red-400 border border-red-300 dark:border-red-600 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 flex items-center gap-2"
              >
                {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                Excluir white label
              </button>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
