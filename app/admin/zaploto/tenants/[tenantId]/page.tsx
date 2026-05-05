'use client';

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { useTenantRouter } from '@/lib/utils/tenant-href';
import Layout from '@/components/Layout';
import { useRequireAuth } from '@/utils/useRequireAuth';
import { getStoredUserId } from '@/lib/utils/stored-user-id';
import { getTenantBaseUrl, getTenantLoginUrl } from '@/lib/utils/zaploto-tenant-url';
import { ChevronLeft, Loader2, Copy, Check, Trash2, Upload } from 'lucide-react';
import {
  TENANT_THEME_KEYS,
  TENANT_THEME_LABELS,
  normalizeThemeColorsInput,
  resolveTenantPalettes,
  type TenantThemeColorsStored,
  type TenantThemeToken,
} from '@/lib/constants/tenant-theme-map';

interface TenantData {
  id: string;
  name: string;
  slug: string;
  domain: string | null;
  logo_url: string | null;
  favicon_url: string | null;
  /** Valor persistido (URL https ou caminho no storage) — vem da API admin */
  logo_source?: string | null;
  favicon_source?: string | null;
  primary_color: string;
  secondary_color: string | null;
  /** Overrides persistidos (modo claro/escuro) */
  theme_colors?: TenantThemeColorsStored | null;
  theme?: { light: Record<string, string>; dark: Record<string, string> };
  app_title: string | null;
  support_email: string | null;
  is_active: boolean;
  is_central?: boolean;
}

export default function AdminZaplotoTenantDetailPage() {
  const params = useParams();
  const router = useTenantRouter();
  const tenantId = params?.tenantId as string | undefined;
  const { checking } = useRequireAuth();
  const [userId, setUserId] = useState<string | null>(null);
  const [tenant, setTenant] = useState<TenantData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [form, setForm] = useState<
    Partial<TenantData> & { theme_colors?: TenantThemeColorsStored }
  >({});

  const resolvedTheme = useMemo(
    () =>
      resolveTenantPalettes({
        theme_colors: form.theme_colors,
        primary_color: form.primary_color || '#8CD955',
        secondary_color: (form.secondary_color ?? '').trim() || null,
      }),
    [form.theme_colors, form.primary_color, form.secondary_color]
  );

  const setThemeSlot = useCallback(
    (mode: 'light' | 'dark', key: TenantThemeToken, value: string) => {
      setForm((f) => {
        const tc: TenantThemeColorsStored = { ...(f.theme_colors || {}) };
        const side = { ...(tc[mode] || {}) };
        if (!value.trim()) {
          delete side[key];
        } else {
          side[key] = value.trim();
        }
        if (Object.keys(side).length === 0) {
          delete tc[mode];
        } else {
          tc[mode] = side;
        }
        const hasAny = tc.light || tc.dark;
        return { ...f, theme_colors: hasAny ? tc : undefined };
      });
    },
    []
  );

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
            secondary_color: json.data.secondary_color ?? '',
            is_active: json.data.is_active,
            logo_source: json.data.logo_source ?? '',
            favicon_source: json.data.favicon_source ?? '',
            theme_colors: (json.data.theme_colors as TenantThemeColorsStored) || undefined,
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
          secondary_color: (form.secondary_color ?? '').trim() || null,
          theme_colors: normalizeThemeColorsInput(form.theme_colors ?? null),
          is_active: form.is_active,
          logo_url: (form.logo_source ?? '').trim() || null,
          favicon_url: (form.favicon_source ?? '').trim() || null,
        }),
      });
      const json = await res.json();
      if (json.success) {
        const d = json.data;
        setTenant((t) =>
          t
            ? {
                ...t,
                ...d,
                slug: normalizedSlug,
                logo_source: d.logo_source ?? d.logo_url,
                logo_url: d.logo_url,
              }
            : null
        );
        setForm((f) => ({
          ...f,
          logo_source: d.logo_source ?? d.logo_url ?? f.logo_source,
          theme_colors: (d.theme_colors as TenantThemeColorsStored | null | undefined) || undefined,
          secondary_color: d.secondary_color ?? '',
        }));
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

  const handleLogoFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !tenantId || !userId) return;
    setUploadingLogo(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`/api/admin/zaploto/tenants/${tenantId}/logo`, {
        method: 'POST',
        headers: { 'X-User-Id': userId },
        credentials: 'include',
        body: fd,
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.error || 'Erro ao enviar logo');
        return;
      }
      const r2 = await fetch(`/api/admin/zaploto/tenants/${tenantId}`, {
        headers: { 'X-User-Id': userId },
        credentials: 'include',
      });
      const j2 = await r2.json();
      if (j2.success && j2.data) {
        setTenant(j2.data);
        setForm((f) => ({
          ...f,
          logo_source: j2.data.logo_source ?? '',
        }));
      }
    } finally {
      setUploadingLogo(false);
      e.target.value = '';
    }
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

        <div className="mb-6 p-4 bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 space-y-3">
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Logo do white label</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Aparece no login e no layout. Envie um arquivo (PNG, JPG, WebP, SVG) ou informe uma URL pública https.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <div className="w-24 h-24 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 flex items-center justify-center overflow-hidden">
              {tenant.logo_url ? (
                <img src={tenant.logo_url} alt="" className="max-w-full max-h-full object-contain" />
              ) : (
                <span className="text-xs text-gray-400 text-center px-2">Sem logo</span>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <label className="inline-flex items-center gap-2 px-3 py-2 bg-[#8CD955] text-white rounded-lg text-sm font-medium cursor-pointer hover:bg-[#7bc84d] w-fit">
                {uploadingLogo ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {uploadingLogo ? 'Enviando...' : 'Enviar arquivo'}
                <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" onChange={handleLogoFile} disabled={uploadingLogo} />
              </label>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">URL da logo (opcional)</label>
            <input
              value={form.logo_source ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, logo_source: e.target.value }))}
              placeholder="https://..."
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-100 text-sm"
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Deixe em branco após upload pelo arquivo (o sistema guarda o caminho no storage). Salve para aplicar URL ou limpar.
            </p>
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
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Cor primária (marca)</label>
            <input
              type="text"
              value={form.primary_color ?? '#8CD955'}
              onChange={(e) => setForm((f) => ({ ...f, primary_color: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-100"
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Hex (#RRGGBB). Base para tokens que não tiverem override abaixo.</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Cor secundária / destaque</label>
            <input
              type="text"
              value={form.secondary_color ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, secondary_color: e.target.value }))}
              placeholder="Opcional — accent / CTAs"
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-100 placeholder-gray-500"
            />
          </div>

          <div className="pt-2 border-t border-gray-200 dark:border-gray-600 space-y-4">
            <div>
              <p className="text-sm font-medium text-gray-800 dark:text-gray-100">Tema do white label</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Tokens fixos no sistema (mesmos nomes em modo claro e escuro). Campo vazio usa o padrão ZapLoto + cores de marca acima — veja o placeholder.
              </p>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="space-y-3 p-3 rounded-lg bg-white/80 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-600">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300">Modo claro</p>
                {TENANT_THEME_KEYS.map((key) => (
                  <div key={`l-${key}`}>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-0.5">
                      {TENANT_THEME_LABELS[key]}
                    </label>
                    <input
                      type="text"
                      value={form.theme_colors?.light?.[key] ?? ''}
                      placeholder={resolvedTheme.light[key]}
                      onChange={(e) => setThemeSlot('light', key, e.target.value)}
                      className="w-full px-2 py-1.5 text-sm border border-gray-200 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100"
                    />
                  </div>
                ))}
              </div>
              <div className="space-y-3 p-3 rounded-lg bg-white/80 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-600">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300">Modo escuro</p>
                {TENANT_THEME_KEYS.map((key) => (
                  <div key={`d-${key}`}>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-0.5">
                      {TENANT_THEME_LABELS[key]}
                    </label>
                    <input
                      type="text"
                      value={form.theme_colors?.dark?.[key] ?? ''}
                      placeholder={resolvedTheme.dark[key]}
                      onChange={(e) => setThemeSlot('dark', key, e.target.value)}
                      className="w-full px-2 py-1.5 text-sm border border-gray-200 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100"
                    />
                  </div>
                ))}
              </div>
            </div>
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
