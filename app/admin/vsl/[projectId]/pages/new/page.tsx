'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useTenantRouter } from '@/lib/utils/tenant-href';
import Layout from '@/components/Layout';
import { useRequireAuth } from '@/utils/useRequireAuth';
import { Loader2 } from 'lucide-react';
import { normalizeRedirectSlug } from '@/lib/vsl/runtime/redirect-url';

export default function NewVslPagePage() {
  const params = useParams();
  const projectId = params?.projectId as string;
  const { checking, userId } = useRequireAuth();
  const router = useTenantRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    slug: '',
    title: '',
    cta_text: 'Entrar no grupo',
    redirect_slug: '',
    vturb_embed: '',
    cta_min_watch_percent: 0,
    cta_delay_seconds: 0,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.slug.trim() || !form.title.trim() || !form.redirect_slug.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/vsl/pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId! },
        body: JSON.stringify({
          project_id: projectId,
          slug: form.slug.trim(),
          title: form.title.trim(),
          cta_text: form.cta_text.trim(),
          redirect_slug: normalizeRedirectSlug(form.redirect_slug),
          vturb_embed: form.vturb_embed.trim() || undefined,
          cta_min_watch_percent: form.cta_min_watch_percent,
          cta_delay_seconds: form.cta_delay_seconds,
        }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.error || 'Erro ao criar');
        setSaving(false);
        return;
      }
      router.push(`/admin/vsl/${projectId}`);
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

  const inputClass = 'w-full border border-gray-300 rounded-xl px-4 py-2.5 text-gray-800 placeholder:text-gray-500 focus:ring-2 focus:ring-[#8CD955]/50 focus:border-[#8CD955] outline-none';

  return (
    <Layout>
      <div className="p-6 max-w-lg mx-auto">
        <div className="flex items-center gap-2 mb-6">
          <button type="button" onClick={() => router.push(`/admin/vsl/${projectId}`)} className="text-gray-600 hover:text-gray-800 font-medium">
            ← Projeto
          </button>
          <span className="text-gray-400">/</span>
          <h1 className="text-xl font-bold text-gray-800">Nova página VSL</h1>
        </div>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Slug da página (ex: marque-23-dezenas)</label>
            <input
              value={form.slug}
              onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-_]/g, '-') }))}
              className={inputClass}
              required
            />
            <p className="text-xs text-gray-500 mt-1.5">URL: /vsl/{form.slug || '...'}</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Título</label>
            <input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              className={inputClass}
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Texto do CTA</label>
            <input
              value={form.cta_text}
              onChange={(e) => setForm((f) => ({ ...f, cta_text: e.target.value }))}
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Slug do redirect (ex: lotox)</label>
            <input
              value={form.redirect_slug}
              onChange={(e) => setForm((f) => ({ ...f, redirect_slug: normalizeRedirectSlug(e.target.value) }))}
              className={inputClass}
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Embed VTurb (cole o código completo)</label>
            <textarea
              value={form.vturb_embed}
              onChange={(e) => setForm((f) => ({ ...f, vturb_embed: e.target.value }))}
              className={`${inputClass} h-32 font-mono text-sm`}
              placeholder="Cole o embed do VTurb (vturb-smartplayer + script)"
            />
            <p className="text-xs text-gray-500 mt-1.5">Serão extraídos player_id e script_src (domínio scripts.converteai.net).</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">% mínimo para mostrar CTA (0–100)</label>
              <input
                type="number"
                min={0}
                max={100}
                value={form.cta_min_watch_percent}
                onChange={(e) => setForm((f) => ({ ...f, cta_min_watch_percent: Number(e.target.value) || 0 }))}
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Delay CTA (segundos)</label>
              <input
                type="number"
                min={0}
                value={form.cta_delay_seconds}
                onChange={(e) => setForm((f) => ({ ...f, cta_delay_seconds: Number(e.target.value) || 0 }))}
                className={inputClass}
              />
            </div>
          </div>
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2.5 bg-[#8CD955] text-white font-medium rounded-xl hover:opacity-90 disabled:opacity-50 flex items-center gap-2 transition"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Criar página
            </button>
            <button
              type="button"
              onClick={() => router.push(`/admin/vsl/${projectId}`)}
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
