'use client';

import { Suspense, useEffect, useState } from 'react';
import Layout from '@/components/Layout';
import { useRequireAuth } from '@/utils/useRequireAuth';
import { useSearchParams } from 'next/navigation';
import { useTenantRouter } from '@/lib/utils/tenant-href';
import Link from '@/components/WhitelabelLink';
import { Save, Loader2 } from 'lucide-react';
import { getStoredUserId } from '@/lib/utils/stored-user-id';
import { ZAPLOTO_ACADEMY_ROLE_OPTIONS } from '@/lib/academy/lesson-role-access';

type Module = { id: string; title: string; slug: string };

function AdminAcademyAulaNovaContent() {
  const router = useTenantRouter();
  const searchParams = useSearchParams();
  const defaultModuleId = searchParams.get('moduleId');
  const { checking, userId } = useRequireAuth();
  const [modules, setModules] = useState<Module[]>([]);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<{
    module_id: string;
    title: string;
    slug: string;
    description: string;
    order_index: number;
    is_published: boolean;
    content_type: 'vturb' | 'iframe' | 'text';
    estimated_minutes: string;
    vturb_project_id: string;
    vturb_player_id: string;
    vturb_aspect_ratio: string;
    vturb_use_sdk: boolean;
    iframe_html: string;
    cta_label: string;
    cta_type: 'internal' | 'external';
    cta_url: string;
    cta_target: '_self' | '_blank';
    allowed_role_codes: string[] | null;
  }>({
    module_id: defaultModuleId || '',
    title: '',
    slug: '',
    description: '',
    order_index: 0,
    is_published: false,
    content_type: 'vturb',
    estimated_minutes: '',
    vturb_project_id: '',
    vturb_player_id: '',
    vturb_aspect_ratio: '',
    vturb_use_sdk: true,
    iframe_html: '',
    cta_label: '',
    cta_type: 'internal',
    cta_url: '',
    cta_target: '_self',
    allowed_role_codes: null,
  });

  useEffect(() => {
    if (!userId) return;
    fetch('/api/admin/academy/modules', { headers: { 'x-user-id': getStoredUserId() ?? '' } })
      .then((r) => (r.ok ? r.json() : []))
      .then(setModules);
  }, [userId]);

  useEffect(() => {
    if (defaultModuleId && !form.module_id) setForm((f) => ({ ...f, module_id: defaultModuleId }));
  }, [defaultModuleId, form.module_id]);

  const slugFromTitle = (t: string) => t.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.module_id || !form.title.trim()) return;
    setSaving(true);
    try {
      const payload = {
        module_id: form.module_id,
        title: form.title.trim(),
        slug: form.slug.trim() || slugFromTitle(form.title),
        description: form.description.trim() || null,
        order_index: form.order_index,
        is_published: form.is_published,
        content_type: form.content_type,
        estimated_minutes: form.estimated_minutes ? parseInt(form.estimated_minutes, 10) : null,
        vturb_project_id: form.vturb_project_id.trim() || null,
        vturb_player_id: form.vturb_player_id.trim() || null,
        vturb_aspect_ratio: form.vturb_aspect_ratio ? parseFloat(form.vturb_aspect_ratio) : null,
        vturb_use_sdk: form.vturb_use_sdk,
        iframe_html: form.iframe_html.trim() || null,
        cta_label: form.cta_label.trim() || null,
        cta_type: form.cta_type,
        cta_url: form.cta_url.trim() || null,
        cta_target: form.cta_target,
        allowed_role_codes:
          form.allowed_role_codes && form.allowed_role_codes.length > 0
            ? form.allowed_role_codes
            : null,
      };
      const res = await fetch('/api/admin/academy/lessons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': getStoredUserId() ?? '' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error || 'Erro ao criar');
        return;
      }
      const data = await res.json();
      router.push(`/admin/academy/aulas/${data.id}`);
    } finally {
      setSaving(false);
    }
  };

  if (checking) {
    return (
      <Layout>
        <div className="flex items-center justify-center p-12">
          <Loader2 className="h-8 w-8 animate-spin text-[var(--zaploto-green)]" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="p-6 max-w-2xl mx-auto">
        <Link href="/admin/academy/aulas" className="mb-4 inline-block text-sm text-[var(--muted-foreground)] hover:text-[var(--zaploto-green)]">← Aulas</Link>
        <h1 className="text-2xl font-bold mb-6">Nova aula</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Módulo *</label>
            <select
              value={form.module_id}
              onChange={(e) => setForm({ ...form, module_id: e.target.value })}
              className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2"
              required
            >
              <option value="">Selecione</option>
              {modules.map((m) => (
                <option key={m.id} value={m.id}>{m.title}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Título *</label>
            <input type="text" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value, slug: form.slug || slugFromTitle(e.target.value) })} className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2" required />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Slug</label>
            <input type="text" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Tipo de conteúdo</label>
            <select value={form.content_type} onChange={(e) => setForm({ ...form, content_type: e.target.value as 'vturb' | 'iframe' | 'text' })} className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2">
              <option value="vturb">VTurb</option>
              <option value="iframe">Iframe</option>
              <option value="text">Texto</option>
            </select>
          </div>
          {form.content_type === 'vturb' && (
            <>
              <div>
                <label className="block text-sm font-medium mb-1">VTurb Project ID</label>
                <input type="text" value={form.vturb_project_id} onChange={(e) => setForm({ ...form, vturb_project_id: e.target.value })} className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2" placeholder="uuid do projeto" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">VTurb Player ID</label>
                <input type="text" value={form.vturb_player_id} onChange={(e) => setForm({ ...form, vturb_player_id: e.target.value })} className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2" placeholder="ex: 69979552055018086ea10ee3" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Aspect ratio (ex: 0.7795)</label>
                <input type="text" value={form.vturb_aspect_ratio} onChange={(e) => setForm({ ...form, vturb_aspect_ratio: e.target.value })} className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2" />
              </div>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={form.vturb_use_sdk} onChange={(e) => setForm({ ...form, vturb_use_sdk: e.target.checked })} />
                <span className="text-sm">Usar SDK</span>
              </label>
            </>
          )}
          {form.content_type === 'iframe' && (
            <div>
              <label className="block text-sm font-medium mb-1">HTML do iframe (apenas src será usado)</label>
              <textarea value={form.iframe_html} onChange={(e) => setForm({ ...form, iframe_html: e.target.value })} className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 font-mono text-sm" rows={3} placeholder="<iframe src=&quot;https://...&quot; ...></iframe>" />
            </div>
          )}
          <div>
            <label className="block text-sm font-medium mb-1">Duração estimada (min)</label>
            <input type="number" value={form.estimated_minutes} onChange={(e) => setForm({ ...form, estimated_minutes: e.target.value })} className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Descrição</label>
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2" rows={2} />
          </div>
          <hr className="border-[var(--card-border)]" />
          <p className="font-medium">CTA (botão)</p>
          <div>
            <label className="block text-sm font-medium mb-1">Label</label>
            <input type="text" value={form.cta_label} onChange={(e) => setForm({ ...form, cta_label: e.target.value })} className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2" placeholder="ex: Ir para Campanhas" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Tipo</label>
            <select value={form.cta_type} onChange={(e) => setForm({ ...form, cta_type: e.target.value as 'internal' | 'external' })} className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2">
              <option value="internal">Interno (rota Zaploto)</option>
              <option value="external">Externo (link)</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">URL</label>
            <input type="text" value={form.cta_url} onChange={(e) => setForm({ ...form, cta_url: e.target.value })} className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2" placeholder="/admin/campaigns ou https://..." />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Target</label>
            <select value={form.cta_target} onChange={(e) => setForm({ ...form, cta_target: e.target.value as '_self' | '_blank' })} className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2">
              <option value="_self">_self</option>
              <option value="_blank">_blank</option>
            </select>
          </div>
          <hr className="border-[var(--card-border)]" />
          <div>
            <p className="mb-1 text-sm font-medium">Disponibilidade por cargo</p>
            <p className="mb-3 text-xs text-[var(--muted-foreground)]">Nenhum marcado = todos os cargos.</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {ZAPLOTO_ACADEMY_ROLE_OPTIONS.map(({ code, label }) => (
                <label key={code} className="flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    className="rounded"
                    checked={!!form.allowed_role_codes?.includes(code)}
                    onChange={() => {
                      setForm((f) => {
                        const cur = f.allowed_role_codes ? [...f.allowed_role_codes] : [];
                        const has = cur.includes(code);
                        const next = has ? cur.filter((c) => c !== code) : [...cur, code];
                        return { ...f, allowed_role_codes: next.length === 0 ? null : next };
                      });
                    }}
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={form.is_published} onChange={(e) => setForm({ ...form, is_published: e.target.checked })} />
            <span className="text-sm">Publicado</span>
          </label>
          <div className="flex gap-2 pt-4">
            <button type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-[var(--zaploto-green)] px-4 py-2 text-white hover:opacity-90 disabled:opacity-50">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Criar
            </button>
            <Link href="/admin/academy/aulas" className="rounded-lg border border-[var(--card-border)] px-4 py-2 text-sm">Cancelar</Link>
          </div>
        </form>
      </div>
    </Layout>
  );
}

export default function AdminAcademyAulaNovaPage() {
  return (
    <Suspense fallback={
      <Layout>
        <div className="flex items-center justify-center p-12">
          <Loader2 className="h-8 w-8 animate-spin text-[var(--zaploto-green)]" />
        </div>
      </Layout>
    }>
      <AdminAcademyAulaNovaContent />
    </Suspense>
  );
}
