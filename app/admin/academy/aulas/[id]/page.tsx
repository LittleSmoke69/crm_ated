'use client';

import { useEffect, useState } from 'react';
import Layout from '@/components/Layout';
import { useRequireAuth } from '@/utils/useRequireAuth';
import { useParams } from 'next/navigation';
import { useTenantRouter } from '@/lib/utils/tenant-href';
import Link from '@/components/WhitelabelLink';
import { Save, Loader2, Plus, Trash2, Upload } from 'lucide-react';
import { getStoredUserId } from '@/lib/utils/stored-user-id';
import VturbPlayer from '@/components/academy/VturbPlayer';
import { ZAPLOTO_ACADEMY_ROLE_OPTIONS } from '@/lib/academy/lesson-role-access';

type Lesson = {
  id: string;
  module_id: string;
  title: string;
  slug: string;
  description: string | null;
  order_index: number;
  is_published: boolean;
  content_type: 'vturb' | 'iframe' | 'text';
  estimated_minutes: number | null;
  vturb_player_id: string | null;
  vturb_project_id: string | null;
  vturb_aspect_ratio: number | null;
  vturb_use_sdk: boolean;
  iframe_html: string | null;
  cta_label: string | null;
  cta_type: 'internal' | 'external' | null;
  cta_url: string | null;
  cta_target: '_self' | '_blank';
  thumbnail_url: string | null;
  allowed_role_codes?: string[] | null;
};

type Module = { id: string; title: string };
type Attachment = { id: string; asset_id: string; label: string | null; order_index: number; academy_assets: { id: string; type: string; title: string } | null };
type Asset = { id: string; type: string; title: string };

export default function AdminAcademyAulaEditPage() {
  const params = useParams();
  const router = useTenantRouter();
  const id = params.id as string;
  const { checking, userId } = useRequireAuth();
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [modules, setModules] = useState<Module[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingThumb, setUploadingThumb] = useState(false);
  const [form, setForm] = useState<Record<string, unknown>>({});

  const h = () => ({ 'x-user-id': getStoredUserId() ?? '' });

  useEffect(() => {
    if (!userId || id === 'novo') return;
    Promise.all([
      fetch(`/api/admin/academy/lessons/${id}`, { headers: h() }).then((r) => (r.ok ? r.json() : null)),
      fetch('/api/admin/academy/modules', { headers: h() }).then((r) => (r.ok ? r.json() : [])),
      fetch(`/api/admin/academy/attachments?lessonId=${id}`, { headers: h() }).then((r) => (r.ok ? r.json() : [])),
      fetch('/api/admin/academy/assets', { headers: h() }).then((r) => (r.ok ? r.json() : [])),
    ]).then(([lessonData, modulesData, attachmentsData, assetsData]) => {
      if (lessonData) {
        setLesson(lessonData);
        setForm({
          module_id: lessonData.module_id,
          title: lessonData.title,
          slug: lessonData.slug,
          description: lessonData.description ?? '',
          order_index: lessonData.order_index,
          is_published: lessonData.is_published,
          content_type: lessonData.content_type,
          estimated_minutes: lessonData.estimated_minutes ?? '',
          vturb_project_id: lessonData.vturb_project_id ?? '',
          vturb_player_id: lessonData.vturb_player_id ?? '',
          vturb_aspect_ratio: lessonData.vturb_aspect_ratio ?? '',
          vturb_use_sdk: lessonData.vturb_use_sdk ?? true,
          iframe_html: lessonData.iframe_html ?? '',
          cta_label: lessonData.cta_label ?? '',
          cta_type: lessonData.cta_type ?? 'internal',
          cta_url: lessonData.cta_url ?? '',
          cta_target: lessonData.cta_target ?? '_self',
          thumbnail_url: lessonData.thumbnail_url ?? '',
          allowed_role_codes:
            Array.isArray(lessonData.allowed_role_codes) && lessonData.allowed_role_codes.length > 0
              ? lessonData.allowed_role_codes
              : null,
        });
      }
      setModules(modulesData ?? []);
      setAttachments(attachmentsData ?? []);
      setAssets(assetsData ?? []);
      setLoading(false);
    });
  }, [userId, id]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { ...form };
      if (payload.estimated_minutes === '') payload.estimated_minutes = null;
      else if (typeof payload.estimated_minutes === 'string') payload.estimated_minutes = parseInt(payload.estimated_minutes as string, 10);
      if (payload.vturb_aspect_ratio === '') payload.vturb_aspect_ratio = null;
      else if (typeof payload.vturb_aspect_ratio === 'string') payload.vturb_aspect_ratio = parseFloat(payload.vturb_aspect_ratio as string);
      if (payload.thumbnail_url === '') payload.thumbnail_url = null;
      if (payload.allowed_role_codes !== undefined && payload.allowed_role_codes !== null) {
        if (!Array.isArray(payload.allowed_role_codes)) payload.allowed_role_codes = null;
        else if ((payload.allowed_role_codes as string[]).length === 0) payload.allowed_role_codes = null;
      }
      const res = await fetch(`/api/admin/academy/lessons/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...h() },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error || 'Erro ao salvar');
        return;
      }
      const data = await res.json();
      setLesson(data);
    } finally {
      setSaving(false);
    }
  };

  const addAttachment = async (assetId: string) => {
    const res = await fetch('/api/admin/academy/attachments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...h() },
      body: JSON.stringify({ lesson_id: id, asset_id: assetId, order_index: attachments.length }),
    });
    if (res.ok) {
      const listRes = await fetch(`/api/admin/academy/attachments?lessonId=${id}`, { headers: h() });
      if (listRes.ok) setAttachments(await listRes.json());
    }
  };

  const removeAttachment = async (attachmentId: string) => {
    const res = await fetch(`/api/admin/academy/attachments?id=${attachmentId}`, { method: 'DELETE', headers: h() });
    if (res.ok) setAttachments((prev) => prev.filter((a) => a.id !== attachmentId));
  };

  const thumbnailSrc = form.thumbnail_url
    ? String(form.thumbnail_url).startsWith('http')
      ? String(form.thumbnail_url)
      : `/api/academy/thumbnail?path=${encodeURIComponent(String(form.thumbnail_url))}`
    : null;

  const handleThumbnailUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !id) return;
    setUploadingThumb(true);
    try {
      const fd = new FormData();
      fd.set('file', file);
      fd.set('lessonId', id);
      const res = await fetch('/api/admin/academy/upload-lesson-thumbnail', {
        method: 'POST',
        headers: { 'x-user-id': getStoredUserId() ?? '' },
        body: fd,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error || 'Erro no upload');
        return;
      }
      const data = await res.json();
      setForm((f) => ({ ...f, thumbnail_url: data.path }));
    } finally {
      setUploadingThumb(false);
      e.target.value = '';
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

  if (id === 'novo') {
    router.replace('/admin/academy/aulas/novo');
    return null;
  }

  if (loading && !lesson) {
    return (
      <Layout>
        <div className="flex items-center justify-center p-12">
          <Loader2 className="h-8 w-8 animate-spin text-[var(--zaploto-green)]" />
        </div>
      </Layout>
    );
  }

  if (!lesson) {
    return (
      <Layout>
        <div className="p-6">
          <p className="text-[var(--muted-foreground)]">Aula não encontrada.</p>
          <Link href="/admin/academy/aulas" className="mt-4 inline-block text-[var(--zaploto-green)]">← Voltar</Link>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="p-6 max-w-4xl mx-auto">
        <Link href="/admin/academy/aulas" className="mb-4 inline-block text-sm text-[var(--muted-foreground)] hover:text-[var(--zaploto-green)]">← Aulas</Link>
        <h1 className="text-2xl font-bold mb-6">Editar aula</h1>

        {lesson.content_type === 'vturb' && lesson.vturb_project_id && lesson.vturb_player_id && (
          <div className="mb-8 rounded-xl border border-[var(--card-border)] overflow-hidden">
            <p className="p-2 text-sm text-[var(--muted-foreground)] bg-[var(--card-bg)]">Preview VTurb</p>
            <VturbPlayer
              projectId={lesson.vturb_project_id}
              playerId={lesson.vturb_player_id}
              aspectRatio={lesson.vturb_aspect_ratio ?? undefined}
              useSdk={lesson.vturb_use_sdk}
            />
          </div>
        )}

        <form onSubmit={handleSave} className="space-y-8">
          {/* Miniatura */}
          <section className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
            <h3 className="mb-3 text-sm font-semibold text-[var(--muted-foreground)]">Miniatura da aula</h3>
            <p className="mb-3 text-xs text-[var(--muted-foreground)]">Aparece na lista de aulas do módulo. PNG, JPG ou WEBP.</p>
            {thumbnailSrc && (
              <img src={thumbnailSrc} alt="Thumbnail" className="mb-3 h-24 w-auto rounded-lg border border-[var(--card-border)] object-cover" />
            )}
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--card-border)] bg-[var(--input-bg)] px-3 py-2 text-sm hover:bg-[var(--card-bg)]">
                <Upload className="h-4 w-4" />
                {uploadingThumb ? 'Enviando…' : 'Enviar imagem'}
                <input type="file" accept=".png,.jpg,.jpeg,.webp" className="hidden" onChange={handleThumbnailUpload} disabled={uploadingThumb} />
              </label>
              <input type="text" value={String(form.thumbnail_url ?? '')} onChange={(e) => setForm({ ...form, thumbnail_url: e.target.value })} className="min-w-[200px] flex-1 rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-sm" placeholder="Ou cole URL do Storage" />
            </div>
          </section>

          {/* Informações básicas */}
          <section className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
            <h3 className="mb-4 text-sm font-semibold text-[var(--muted-foreground)]">Informações básicas</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Módulo *</label>
                <select
                  value={String(form.module_id ?? '')}
                  onChange={(e) => setForm({ ...form, module_id: e.target.value })}
                  className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2"
                  required
                >
                  {modules.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.title}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                  Ao trocar o módulo, a aula passa para o final da lista daquele módulo.
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Título *</label>
                <input type="text" value={String(form.title ?? '')} onChange={(e) => setForm({ ...form, title: e.target.value })} className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2" required />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Slug (URL)</label>
                <input type="text" value={String(form.slug ?? '')} onChange={(e) => setForm({ ...form, slug: e.target.value })} className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2" placeholder="ex: minha-aula" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Duração (min)</label>
                <input type="number" value={String(form.estimated_minutes ?? '')} onChange={(e) => setForm({ ...form, estimated_minutes: e.target.value })} className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2" placeholder="7" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Descrição</label>
                <textarea value={String(form.description ?? '')} onChange={(e) => setForm({ ...form, description: e.target.value })} className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2" rows={2} placeholder="Breve descrição da aula" />
              </div>
            </div>
          </section>

          {/* Conteúdo */}
          <section className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
            <h3 className="mb-4 text-sm font-semibold text-[var(--muted-foreground)]">Conteúdo</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Tipo de conteúdo</label>
                <select value={String(form.content_type ?? 'vturb')} onChange={(e) => setForm({ ...form, content_type: e.target.value })} className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2">
                  <option value="vturb">Vídeo VTurb</option>
                  <option value="iframe">Iframe (embed)</option>
                  <option value="text">Texto</option>
                </select>
              </div>
              {form.content_type === 'vturb' && (
                <div className="space-y-3 rounded-lg bg-[var(--input-bg)]/50 p-3">
                  <input type="text" value={String(form.vturb_project_id ?? '')} onChange={(e) => setForm({ ...form, vturb_project_id: e.target.value })} className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-sm" placeholder="VTurb Project ID" />
                  <input type="text" value={String(form.vturb_player_id ?? '')} onChange={(e) => setForm({ ...form, vturb_player_id: e.target.value })} className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-sm" placeholder="VTurb Player ID" />
                  <input type="text" value={String(form.vturb_aspect_ratio ?? '')} onChange={(e) => setForm({ ...form, vturb_aspect_ratio: e.target.value })} className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-sm" placeholder="Aspect ratio (ex: 16/9)" />
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={Boolean(form.vturb_use_sdk)} onChange={(e) => setForm({ ...form, vturb_use_sdk: e.target.checked })} />
                    Usar SDK
                  </label>
                </div>
              )}
              {form.content_type === 'iframe' && (
                <div>
                  <label className="block text-sm font-medium mb-1">Código HTML do iframe</label>
                  <textarea value={String(form.iframe_html ?? '')} onChange={(e) => setForm({ ...form, iframe_html: e.target.value })} className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 font-mono text-sm" rows={3} placeholder='<iframe src="https://..."></iframe>' />
                </div>
              )}
            </div>
          </section>

          {/* CTA (opcional) */}
          <section className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
            <h3 className="mb-4 text-sm font-semibold text-[var(--muted-foreground)]">Botão de ação (opcional)</h3>
            <div className="space-y-3">
              <input type="text" value={String(form.cta_label ?? '')} onChange={(e) => setForm({ ...form, cta_label: e.target.value })} className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-sm" placeholder="Texto do botão" />
              <input type="text" value={String(form.cta_url ?? '')} onChange={(e) => setForm({ ...form, cta_url: e.target.value })} className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-sm" placeholder="URL (interno ou externo)" />
              <select value={String(form.cta_type ?? 'internal')} onChange={(e) => setForm({ ...form, cta_type: e.target.value })} className="rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-sm">
                <option value="internal">Link interno</option>
                <option value="external">Link externo</option>
              </select>
            </div>
          </section>

          {/* Cargos */}
          <section className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
            <h3 className="mb-2 text-sm font-semibold text-[var(--muted-foreground)]">Disponibilidade por cargo</h3>
            <p className="mb-4 text-xs text-[var(--muted-foreground)]">
              Nenhum cargo marcado = aula visível para <strong>todos</strong>. Marque um ou mais cargos para restringir (usa o mesmo código do perfil: <code className="text-[10px]">status</code>).
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {ZAPLOTO_ACADEMY_ROLE_OPTIONS.map(({ code, label }) => (
                <label key={code} className="flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--card-border)] bg-[var(--input-bg)] px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    className="rounded"
                    checked={
                      Array.isArray(form.allowed_role_codes) &&
                      (form.allowed_role_codes as string[]).includes(code)
                    }
                    onChange={() => {
                      setForm((f) => {
                        const cur = Array.isArray(f.allowed_role_codes)
                          ? [...(f.allowed_role_codes as string[])]
                          : [];
                        const has = cur.includes(code);
                        const next = has ? cur.filter((c) => c !== code) : [...cur, code];
                        return { ...f, allowed_role_codes: next.length === 0 ? null : next };
                      });
                    }}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </section>

          {/* Publicação */}
          <section className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
            <h3 className="mb-4 text-sm font-semibold text-[var(--muted-foreground)]">Publicação</h3>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={Boolean(form.is_published)} onChange={(e) => setForm({ ...form, is_published: e.target.checked })} className="rounded" />
              <span className="text-sm">Aula visível na vitrine (publicada)</span>
            </label>
          </section>

          <div className="flex gap-2 pt-2">
            <button type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-[var(--zaploto-green)] px-4 py-2 text-white hover:opacity-90 disabled:opacity-50">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Salvar
            </button>
            <Link href="/admin/academy/aulas" className="rounded-lg border border-[var(--card-border)] px-4 py-2 text-sm">Cancelar</Link>
          </div>
        </form>

        <section className="mt-10">
          <h2 className="text-lg font-semibold mb-2">Anexos da aula</h2>
          <ul className="space-y-2 mb-4">
            {attachments.map((a) => (
              <li key={a.id} className="flex items-center justify-between rounded-lg border border-[var(--card-border)] px-3 py-2">
                <span>{a.academy_assets?.title ?? a.id}</span>
                <button type="button" onClick={() => removeAttachment(a.id)} className="text-red-600 hover:underline">
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
          <div className="flex gap-2 flex-wrap">
            {assets.filter((asset) => !attachments.some((at) => (at.asset_id || at.academy_assets?.id) === asset.id)).map((asset) => (
              <button key={asset.id} type="button" onClick={() => addAttachment(asset.id)} className="inline-flex items-center gap-1 rounded-lg border border-[var(--card-border)] px-3 py-1.5 text-sm hover:bg-[var(--input-bg)]">
                <Plus className="h-4 w-4" /> {asset.title}
              </button>
            ))}
            {assets.length === 0 && <p className="text-sm text-[var(--muted-foreground)]">Nenhum material. Envie em Academy → Materiais.</p>}
          </div>
        </section>
      </div>
    </Layout>
  );
}
