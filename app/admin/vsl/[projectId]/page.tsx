'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Layout from '@/components/Layout';
import { useRequireAuth } from '@/utils/useRequireAuth';
import { Loader2, Save, Upload, ExternalLink, Settings, Key, Image, FileVideo, ArrowRight, Trash2, Pencil } from 'lucide-react';

interface Project {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  redirect_timer_seconds: number;
  logo_path: string | null;
  pixel_id: string | null;
  meta_graph_base_url: string;
}

interface VslPageRow {
  id: string;
  slug: string;
  title: string;
  cta_text: string;
  redirect_slug: string;
  is_active: boolean;
}

export default function AdminVslProjectPage() {
  const params = useParams();
  const projectId = params?.projectId as string;
  const { checking, userId } = useRequireAuth();
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [pages, setPages] = useState<VslPageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [deletingPageId, setDeletingPageId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', pixel_id: '', redirect_timer_seconds: 5 });
  const [capiToken, setCapiToken] = useState('');

  useEffect(() => {
    if (!userId || !projectId) return;
    const h = { 'X-User-Id': userId };
    fetch(`/api/admin/vsl/projects/${projectId}`, { headers: h })
      .then((r) => r.json())
      .then((json) => {
        if (json?.data) {
          setProject(json.data);
          setForm({
            name: json.data.name,
            pixel_id: json.data.pixel_id || '',
            redirect_timer_seconds: json.data.redirect_timer_seconds ?? 5,
          });
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [userId, projectId]);

  useEffect(() => {
    if (!userId || !projectId) return;
    fetch(`/api/admin/vsl/pages?project_id=${projectId}`, { headers: { 'X-User-Id': userId } })
      .then((r) => r.json())
      .then((json) => {
        if (json?.data) setPages(Array.isArray(json.data) ? json.data : []);
      })
      .catch(() => {});
  }, [userId, projectId]);

  const saveProject = async () => {
    if (!userId || !projectId) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/vsl/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (json?.data) setProject((p) => (p ? { ...p, ...json.data } : null));
    } finally {
      setSaving(false);
    }
  };

  const saveTimer = async () => {
    if (!userId || !projectId) return;
    await fetch('/api/admin/redirect/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
      body: JSON.stringify({ project_id: projectId, redirect_timer_seconds: form.redirect_timer_seconds }),
    });
  };

  const saveCapiToken = async () => {
    if (!userId || !projectId) return;
    await fetch(`/api/admin/vsl/projects/${projectId}/capi`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
      body: JSON.stringify({ capi_access_token: capiToken || null }),
    });
    setCapiToken('');
  };

  const removePage = async (pageId: string) => {
    if (!userId || !confirm('Remover esta página VSL? Esta ação não pode ser desfeita.')) return;
    setDeletingPageId(pageId);
    try {
      const res = await fetch(`/api/admin/vsl/pages/${pageId}`, {
        method: 'DELETE',
        headers: { 'X-User-Id': userId },
      });
      const json = await res.json();
      if (json?.success) setPages((prev) => prev.filter((p) => p.id !== pageId));
      else alert(json?.error || 'Erro ao remover');
    } finally {
      setDeletingPageId(null);
    }
  };

  const uploadLogo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !userId || !projectId) return;
    setUploadingLogo(true);
    const fd = new FormData();
    fd.set('project_id', projectId);
    fd.set('file', file);
    try {
      const res = await fetch('/api/admin/vsl/brand/logo', {
        method: 'POST',
        headers: { 'X-User-Id': userId },
        body: fd,
      });
      const json = await res.json();
      if (json?.data?.logo_path) setProject((p) => (p ? { ...p, logo_path: json.data.logo_path } : null));
    } finally {
      setUploadingLogo(false);
    }
  };

  if (checking || loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center p-12">
          <Loader2 className="w-8 h-8 animate-spin text-gray-500" />
        </div>
      </Layout>
    );
  }

  if (!project) {
    return (
      <Layout>
        <div className="p-6">
          <p className="text-red-600">Projeto não encontrado.</p>
          <button type="button" onClick={() => router.push('/admin/vsl')} className="mt-4 px-4 py-2 bg-gray-200 rounded-lg">
            Voltar
          </button>
        </div>
      </Layout>
    );
  }

  const inputClass = 'w-full border border-gray-300 rounded-xl px-4 py-2.5 text-gray-800 placeholder:text-gray-500 focus:ring-2 focus:ring-[#8CD955]/50 focus:border-[#8CD955] outline-none transition';

  return (
    <Layout>
      <div className="p-6 max-w-6xl mx-auto">
        {/* Header com breadcrumb e slug */}
        <div className="mb-6">
          <nav className="flex items-center gap-2 text-sm mb-2">
            <button
              type="button"
              onClick={() => router.push('/admin/vsl')}
              className="text-gray-500 hover:text-gray-800 font-medium transition"
            >
              ← VSL
            </button>
            <span className="text-gray-300">/</span>
            <span className="text-gray-800 font-medium truncate max-w-[200px] sm:max-w-none">{project.name}</span>
          </nav>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-gray-800">Configuração do projeto</h1>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-lg text-xs font-mono bg-gray-100 text-gray-700">
              /{project.slug}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Coluna esquerda: Dados, Token, Logo */}
          <div className="space-y-6">
        {/* Card: Dados do projeto */}
        <section className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-100 bg-gray-50/50">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-[#8CD955]/15">
              <Settings className="w-5 h-5 text-[#8CD955]" />
            </div>
            <div>
              <h2 className="font-semibold text-gray-800">Dados do projeto</h2>
              <p className="text-xs text-gray-500">Nome, Pixel e timer do redirect</p>
            </div>
          </div>
          <div className="p-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Nome do projeto</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className={inputClass}
                  placeholder="Ex: VSL Loteria"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Pixel ID (Meta)</label>
                <input
                  value={form.pixel_id}
                  onChange={(e) => setForm((f) => ({ ...f, pixel_id: e.target.value }))}
                  className={inputClass}
                  placeholder="123456789"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Timer do redirect (segundos)</label>
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={form.redirect_timer_seconds}
                  onChange={(e) => setForm((f) => ({ ...f, redirect_timer_seconds: Number(e.target.value) || 5 }))}
                  className="w-full sm:w-28 border border-gray-300 rounded-xl px-4 py-2.5 text-gray-800 placeholder:text-gray-500 focus:ring-2 focus:ring-[#8CD955]/50 focus:border-[#8CD955] outline-none transition"
                />
              </div>
            </div>
            <div className="mt-5 pt-5 border-t border-gray-100 flex justify-end">
              <button
                type="button"
                onClick={() => { saveProject(); saveTimer(); }}
                disabled={saving}
                className="flex items-center gap-2 px-6 py-2.5 bg-[#8CD955] text-white font-medium rounded-xl hover:opacity-90 disabled:opacity-50 transition shadow-sm"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Salvar alterações
              </button>
            </div>
          </div>
        </section>

        {/* Card: Token CAPI */}
        <section className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-100 bg-amber-50/30">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-amber-100">
              <Key className="w-5 h-5 text-amber-700" />
            </div>
            <div>
              <h2 className="font-semibold text-gray-800">Token CAPI (Meta)</h2>
              <p className="text-xs text-gray-600">Nunca é exibido. Apenas para envio server-side.</p>
            </div>
          </div>
          <div className="p-6">
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                type="password"
                value={capiToken}
                onChange={(e) => setCapiToken(e.target.value)}
                placeholder="Novo token (deixe vazio para não alterar)"
                className={`${inputClass} flex-1`}
              />
              <button
                type="button"
                onClick={saveCapiToken}
                className="sm:w-auto w-full px-6 py-2.5 bg-gray-700 text-white font-medium rounded-xl hover:bg-gray-800 transition shrink-0"
              >
                Salvar token
              </button>
            </div>
          </div>
        </section>

        {/* Card: Logo */}
        <section className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-100 bg-gray-50/50">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-gray-100">
              <Image className="w-5 h-5 text-gray-600" />
            </div>
            <div>
              <h2 className="font-semibold text-gray-800">Logo da banca</h2>
              <p className="text-xs text-gray-500">Exibida na tela de redirect (PNG, JPG, WebP ou SVG, máx. 5MB)</p>
            </div>
          </div>
          <div className="p-6">
            <label className="flex flex-col items-center justify-center w-full min-h-[120px] border-2 border-dashed border-gray-200 rounded-xl cursor-pointer hover:border-[#8CD955]/50 hover:bg-gray-50/50 transition">
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                onChange={uploadLogo}
                disabled={uploadingLogo}
                className="hidden"
              />
              {uploadingLogo ? (
                <Loader2 className="w-8 h-8 animate-spin text-gray-400 mb-2" />
              ) : (
                <Upload className="w-8 h-8 text-gray-400 mb-2" />
              )}
              <span className="text-sm font-medium text-gray-600">
                {uploadingLogo ? 'Enviando...' : 'Clique para enviar ou arraste a imagem'}
              </span>
            </label>
          </div>
        </section>
          </div>

          {/* Coluna direita: Páginas VSL + Redirect Manager */}
          <div className="space-y-6">
        {/* Card: Páginas VSL */}
        <section className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden lg:min-h-0">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gray-50/50">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-[#8CD955]/15">
                <FileVideo className="w-5 h-5 text-[#8CD955]" />
              </div>
              <div>
                <h2 className="font-semibold text-gray-800">Páginas VSL</h2>
                <p className="text-xs text-gray-500">{pages.length} página(s)</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => router.push(`/admin/vsl/${projectId}/pages/new`)}
              className="flex items-center gap-2 px-4 py-2 bg-[#8CD955] text-white text-sm font-medium rounded-xl hover:opacity-90 transition"
            >
              Nova página
            </button>
          </div>
          <div className="p-6">
            {pages.length === 0 ? (
              <div className="text-center py-6 rounded-xl bg-gray-50 border border-dashed border-gray-200">
                <FileVideo className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                <p className="text-gray-600 text-sm">Nenhuma página. Crie uma e cole o embed do VTurb.</p>
              </div>
            ) : (
              <ul className="divide-y divide-gray-100 space-y-0">
                {pages.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 py-3 first:pt-0">
                    <span className="font-medium text-gray-800 truncate min-w-0">{p.title}</span>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => router.push(`/admin/vsl/${projectId}/pages/${p.id}/edit`)}
                        title="Editar página"
                        className="p-1.5 text-gray-600 hover:bg-gray-100 hover:text-[#8CD955] rounded-lg transition"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <a
                        href={`/vsl/${p.slug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-sm text-[#8CD955] hover:underline font-medium"
                      >
                        <ExternalLink className="w-4 h-4" />
                        /vsl/{p.slug}
                      </a>
                      <button
                        type="button"
                        onClick={() => removePage(p.id)}
                        disabled={deletingPageId === p.id}
                        title="Remover página"
                        className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition disabled:opacity-50"
                      >
                        {deletingPageId === p.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Trash2 className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* CTA Redirect Manager */}
        <button
          type="button"
          onClick={() => router.push(`/admin/redirect/${project.slug}`)}
          className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-gray-800 text-white font-medium rounded-2xl hover:bg-gray-900 transition shadow-sm"
        >
          <span>Redirect Manager</span>
          <ArrowRight className="w-5 h-5" />
        </button>
          </div>
        </div>
      </div>
    </Layout>
  );
}
