'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Layout from '@/components/Layout';
import { useRequireAuth } from '@/utils/useRequireAuth';
import { Loader2, Plus, Trash2, ExternalLink, RefreshCw, FileVideo, Type, MousePointer, Link2, MessageCircle, Smartphone, Video, FileText, LayoutGrid } from 'lucide-react';
import { VslDesignPanel } from '@/components/vsl/design/VslDesignPanel';
import type { VslContentRoot } from '@/lib/vsl/runtime/types';
import { buildContentFromFormData } from '@/lib/vsl/presets/content-templates';

type TestimonialType = 'text' | 'video';

interface TestimonialRow {
  type: TestimonialType;
  author_name: string;
  author_avatar_url?: string;
  content: string;
  video_path?: string;
  likes_count: number;
}

interface VturbConfigured {
  player_id: string;
  script_src: string;
}

export default function EditVslPagePage() {
  const params = useParams();
  const projectId = params?.projectId as string;
  const pageId = params?.pageId as string;
  const { checking, userId } = useRequireAuth();
  const router = useRouter();
  const previewRef = useRef<HTMLIFrameElement>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [vturbFromDb, setVturbFromDb] = useState<VturbConfigured | null>(null);
  const [form, setForm] = useState({
    slug: '',
    title: '',
    cta_text: 'Entrar no grupo',
    redirect_slug: '',
    vturb_embed: '',
    header_title: 'FINANÇAS',
    marquee_text: 'ATUALIZAÇÕES DIÁRIAS SOBRE FINANÇAS E APOSTAS',
    cta_min_watch_percent: 0,
    cta_delay_seconds: 0,
    testimonials: [] as TestimonialRow[],
  });
  const [contentJson, setContentJson] = useState<VslContentRoot | null>(null);
  const [activeTab, setActiveTab] = useState<'conteudo' | 'design'>('conteudo');

  useEffect(() => {
    if (!userId || !pageId) return;
    const h = { 'X-User-Id': userId };
    fetch(`/api/admin/vsl/pages/${pageId}`, { headers: h })
      .then((r) => r.json())
      .then((json) => {
        const d = json?.data;
        if (d) {
          setForm({
            slug: d.slug ?? '',
            title: d.title ?? '',
            cta_text: d.cta_text ?? 'Entrar no grupo',
            redirect_slug: d.redirect_slug ?? '',
            vturb_embed: '',
            header_title: d.header_title ?? 'FINANÇAS',
            marquee_text: d.marquee_text ?? 'ATUALIZAÇÕES DIÁRIAS SOBRE FINANÇAS E APOSTAS',
            cta_min_watch_percent: d.cta_min_watch_percent ?? 0,
            cta_delay_seconds: d.cta_delay_seconds ?? 0,
            testimonials: Array.isArray(d.testimonials) ? d.testimonials.map((t: { type?: string; author_name?: string; author_avatar_url?: string; content?: string; video_path?: string; likes_count?: number }) => ({
              type: (t.type === 'video' ? 'video' : 'text') as TestimonialType,
              author_name: t.author_name ?? '',
              author_avatar_url: t.author_avatar_url ?? '',
              content: t.content ?? '',
              video_path: t.video_path ?? '',
              likes_count: Number(t.likes_count) || 0,
            })) : [],
          });
          if (d.video_player_id && d.video_script_src) {
            setVturbFromDb({ player_id: d.video_player_id, script_src: d.video_script_src });
          }
          const cj = d.content_json;
          if (cj && typeof cj === 'object' && cj !== null && 'type' in cj && (cj as { type: string }).type === 'page') {
            setContentJson(cj as VslContentRoot);
          } else {
            // Sem content_json: monta a partir da tela Conteúdo para o Design mostrar o mesmo modelo
            setContentJson(
              buildContentFromFormData(
                d.header_title ?? 'FINANÇAS',
                d.marquee_text ?? 'ATUALIZAÇÕES DIÁRIAS SOBRE FINANÇAS E APOSTAS',
                d.title ?? ''
              )
            );
          }
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [userId, pageId]);

  const addTestimonial = () => {
    setForm((f) => ({
      ...f,
      testimonials: [...f.testimonials, { type: 'text' as TestimonialType, author_name: '', author_avatar_url: '', content: '', likes_count: 0 }],
    }));
  };

  const [uploadingVideoIdx, setUploadingVideoIdx] = useState<number | null>(null);
  const uploadTestimonialVideo = async (index: number, file: File) => {
    if (!userId || !projectId) return;
    setUploadingVideoIdx(index);
    const fd = new FormData();
    fd.set('project_id', projectId);
    fd.set('file', file);
    try {
      const res = await fetch('/api/admin/vsl/testimonial-video', {
        method: 'POST',
        headers: { 'X-User-Id': userId },
        body: fd,
      });
      const json = await res.json();
      if (json?.data?.path) {
        setForm((f) => ({
          ...f,
          testimonials: f.testimonials.map((t, i) => (i === index ? { ...t, type: 'video' as TestimonialType, video_path: json.data.path } : t)),
        }));
      } else {
        alert(json?.error || 'Erro no upload');
      }
    } finally {
      setUploadingVideoIdx(null);
    }
  };

  const removeTestimonial = (index: number) => {
    setForm((f) => ({
      ...f,
      testimonials: f.testimonials.filter((_, i) => i !== index),
    }));
  };

  const updateTestimonial = (index: number, field: keyof TestimonialRow, value: string | number) => {
    setForm((f) => ({
      ...f,
      testimonials: f.testimonials.map((t, i) => (i === index ? { ...t, [field]: value } : t)),
    }));
  };

  const setTestimonialType = (index: number, type: TestimonialType) => {
    setForm((f) => ({
      ...f,
      testimonials: f.testimonials.map((t, i) =>
        i === index ? { ...t, type, ...(type === 'text' ? { video_path: undefined } : { content: '' }) } : t
      ),
    }));
  };

  const refreshPreview = () => {
    if (previewRef.current && form.slug) {
      previewRef.current.src = `/vsl/${form.slug}?t=${Date.now()}`;
    }
  };

  const saveContent = async (payload: Record<string, unknown>) => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/vsl/pages/${pageId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId! },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.error || 'Erro ao salvar');
        setSaving(false);
        return;
      }
      refreshPreview();
    } catch {
      setError('Erro de rede');
    }
    setSaving(false);
  };

  const buildPayload = () => ({
    title: form.title.trim(),
    cta_text: form.cta_text.trim(),
    redirect_slug: form.redirect_slug.trim(),
    vturb_embed: form.vturb_embed.trim() || undefined,
    header_title: form.header_title.trim() || 'FINANÇAS',
    marquee_text: form.marquee_text.trim(),
    cta_min_watch_percent: form.cta_min_watch_percent,
    cta_delay_seconds: form.cta_delay_seconds,
    content_json: contentJson,
    testimonials: form.testimonials
      .filter((t) => t.author_name.trim() || t.content.trim() || (t.type === 'video' && t.video_path))
      .map((t) => {
        const base = { author_name: t.author_name.trim(), author_avatar_url: t.author_avatar_url?.trim() || undefined, likes_count: t.likes_count };
        if (t.type === 'video' && t.video_path) return { type: 'video' as const, ...base, video_path: t.video_path };
        return { type: 'text' as const, ...base, content: t.content.trim() };
      }),
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim() || !form.redirect_slug.trim()) return;
    const payload = buildPayload();
    await saveContent(payload);
    if (payload.vturb_embed) {
      const res = await fetch(`/api/admin/vsl/pages/${pageId}`, { method: 'GET', headers: { 'X-User-Id': userId! } });
      const json = await res.json();
      if (json?.data?.video_player_id && json?.data?.video_script_src) {
        setVturbFromDb({ player_id: json.data.video_player_id, script_src: json.data.video_script_src });
      }
      setForm((f) => ({ ...f, vturb_embed: '' }));
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

  const inputClass = 'w-full border border-gray-300 rounded-xl px-4 py-2.5 text-gray-800 placeholder:text-gray-500 focus:ring-2 focus:ring-[#8CD955]/50 focus:border-[#8CD955] outline-none transition scroll-mt-4';
  const labelClass = 'block text-sm font-medium text-gray-700 mb-1.5';
  const hintClass = 'text-xs text-gray-500 mt-1.5';

  const Section = ({ icon: Icon, title, subtitle, children }: { icon: React.ElementType; title: string; subtitle?: string; children: React.ReactNode }) => (
    <section className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100 bg-gray-50/60">
        <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-[#8CD955]/15">
          <Icon className="w-5 h-5 text-[#8CD955]" />
        </div>
        <div>
          <h2 className="font-semibold text-gray-800">{title}</h2>
          {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
        </div>
      </div>
      <div className="p-5">{children}</div>
    </section>
  );

  return (
    <Layout>
      <div className="p-4 lg:p-6 max-w-7xl mx-auto">
        {/* Breadcrumb e ações */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => router.push(`/admin/vsl/${projectId}`)}
              className="text-gray-500 hover:text-gray-800 font-medium transition"
            >
              ← Projeto
            </button>
            <span className="text-gray-300">/</span>
            <h1 className="text-xl font-bold text-gray-800">Editar página VSL</h1>
            {form.slug && (
              <span className="text-sm text-gray-500 font-mono bg-gray-100 px-2 py-0.5 rounded">/vsl/{form.slug}</span>
            )}
          </div>
          {form.slug && (
            <a
              href={`/vsl/${form.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-[#8CD955] bg-[#8CD955]/10 rounded-xl hover:bg-[#8CD955]/20 transition"
            >
              <ExternalLink className="w-4 h-4" />
              Abrir VSL em nova aba
            </a>
          )}
        </div>

        {/* Tabs Conteúdo | Design */}
        <div className="flex gap-2 mb-4 border-b border-gray-200">
          <button
            type="button"
            onClick={() => setActiveTab('conteudo')}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition ${activeTab === 'conteudo' ? 'bg-white border border-b-0 border-gray-200 text-[#8CD955]' : 'text-gray-600 hover:text-gray-800'}`}
          >
            Conteúdo
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('design')}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition flex items-center gap-2 ${activeTab === 'design' ? 'bg-white border border-b-0 border-gray-200 text-[#8CD955]' : 'text-gray-600 hover:text-gray-800'}`}
          >
            <LayoutGrid className="w-4 h-4" />
            Design (Builder)
          </button>
        </div>

        {activeTab === 'design' ? (
          <div className="space-y-4 bg-gray-100 rounded-xl p-4 h-[calc(100vh-9rem)] overflow-hidden">
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-600">Altere o template e os blocos; depois salve para publicar.</p>
              <button
                type="button"
                onClick={() => saveContent(buildPayload())}
                disabled={saving || !form.title.trim() || !form.redirect_slug.trim()}
                className="inline-flex items-center gap-2 px-6 py-2.5 bg-[#8CD955] text-white font-medium rounded-xl hover:opacity-90 disabled:opacity-50 transition shadow-sm"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Salvar alterações
              </button>
            </div>
            {error && <p className="text-red-600 text-sm">{error}</p>}
            <VslDesignPanel
              content={contentJson}
              onContentChange={setContentJson}
              slug={form.slug}
              redirectSlug={form.redirect_slug}
              ctaText={form.cta_text}
              projectId={projectId}
              videoPlayerId={vturbFromDb?.player_id}
              videoScriptSrc={vturbFromDb?.script_src}
            />
          </div>
        ) : (
        <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
          {/* Coluna do formulário - overflow-anchor-none evita scroll sozinho ao digitar */}
          <div className="xl:col-span-3 space-y-6 overflow-anchor-none">
            <form onSubmit={handleSubmit} className="space-y-6">
              <Section icon={Type} title="Identificação" subtitle="Título e slug da página">
                <div>
                  <label className={labelClass}>Título da página</label>
                  <input
                    value={form.title}
                    onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                    className={inputClass}
                    required
                    placeholder="Ex: MARQUE 23 DEZENAS NA LOTINHA!"
                  />
                </div>
              </Section>

              <Section icon={Type} title="Aparência do topo" subtitle="Header vermelho e marquee">
                <div className="space-y-4">
                  <div>
                    <label className={labelClass}>Título do topo (ex: FINANÇAS)</label>
                    <input
                      value={form.header_title}
                      onChange={(e) => setForm((f) => ({ ...f, header_title: e.target.value }))}
                      className={inputClass}
                      placeholder="FINANÇAS"
                    />
                    <p className={hintClass}>Exibido no header vermelho da VSL.</p>
                  </div>
                  <div>
                    <label className={labelClass}>Frase do marquee (animação em loop)</label>
                    <input
                      value={form.marquee_text}
                      onChange={(e) => setForm((f) => ({ ...f, marquee_text: e.target.value }))}
                      className={inputClass}
                      placeholder="ATUALIZAÇÕES DIÁRIAS SOBRE FINANÇAS E APOSTAS"
                    />
                  </div>
                </div>
              </Section>

              <Section icon={FileVideo} title="Vídeo VTurb" subtitle="Player de vídeo na VSL">
                {vturbFromDb && (
                  <div className="mb-4 p-3 rounded-xl bg-green-50 border border-green-200">
                    <p className="text-sm font-medium text-green-800">VTurb já configurado no banco</p>
                    <p className="text-xs text-green-700 mt-1 font-mono">Player ID: {vturbFromDb.player_id}</p>
                    <p className="text-xs text-gray-500 mt-0.5 truncate" title={vturbFromDb.script_src}>Script: {vturbFromDb.script_src}</p>
                  </div>
                )}
                <div>
                  <label className={labelClass}>Embed VTurb (cole para atualizar o player)</label>
                  <textarea
                    value={form.vturb_embed}
                    onChange={(e) => setForm((f) => ({ ...f, vturb_embed: e.target.value }))}
                    className={`${inputClass} h-28 font-mono text-sm`}
                    placeholder="Cole o código completo do embed VTurb para atualizar ou substituir o vídeo"
                  />
                  <p className={hintClass}>Serão extraídos player_id e script_src. Deixe vazio para manter o atual.</p>
                </div>
              </Section>

              <Section icon={MousePointer} title="Botão CTA" subtitle="Chamada para ação">
                <div className="space-y-4">
                  <div>
                    <label className={labelClass}>Texto do CTA (ex: SIM! Eu quero participar!)</label>
                    <input
                      value={form.cta_text}
                      onChange={(e) => setForm((f) => ({ ...f, cta_text: e.target.value }))}
                      className={inputClass}
                      placeholder="SIM! Eu quero participar!"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className={labelClass}>% mínimo para mostrar CTA (0–100)</label>
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
                      <label className={labelClass}>Delay CTA (segundos)</label>
                      <input
                        type="number"
                        min={0}
                        value={form.cta_delay_seconds}
                        onChange={(e) => setForm((f) => ({ ...f, cta_delay_seconds: Number(e.target.value) || 0 }))}
                        className={inputClass}
                      />
                    </div>
                  </div>
                </div>
              </Section>

              <Section icon={Link2} title="Redirect" subtitle="Para onde o CTA envia">
                <div>
                  <label className={labelClass}>Slug do redirect</label>
                  <input
                    value={form.redirect_slug}
                    onChange={(e) => setForm((f) => ({ ...f, redirect_slug: e.target.value.trim() }))}
                    className={inputClass}
                    required
                    placeholder="Ex: lotox"
                  />
                  <p className={hintClass}>URL de destino: /r/{form.redirect_slug || '...'}</p>
                </div>
              </Section>

              <Section icon={MessageCircle} title="Depoimentos" subtitle="Texto (estilo Facebook) ou vídeo. Reações like + curtir com número personalizado.">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm text-gray-600">Escolha tipo: texto ou vídeo. Nº de reações é o número exibido ao lado dos ícones like/coração.</p>
                  <button
                    type="button"
                    onClick={addTestimonial}
                    className="flex items-center gap-1.5 text-sm font-medium text-[#8CD955] hover:text-[#7BC84A] transition"
                  >
                    <Plus className="w-4 h-4" /> Adicionar
                  </button>
                </div>
                <ul className="space-y-4">
                  {form.testimonials.map((t, i) => (
                    <li key={i} className="p-4 border border-gray-200 rounded-xl bg-gray-50/50 space-y-3">
                      <div className="flex justify-between items-center flex-wrap gap-2">
                        <span className="text-sm font-medium text-gray-600">Depoimento {i + 1}</span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setTestimonialType(i, 'text')}
                            className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition ${t.type === 'text' ? 'bg-[#8CD955] text-white' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'}`}
                          >
                            <FileText className="w-3.5 h-3.5" /> Texto
                          </button>
                          <button
                            type="button"
                            onClick={() => setTestimonialType(i, 'video')}
                            className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition ${t.type === 'video' ? 'bg-[#8CD955] text-white' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'}`}
                          >
                            <Video className="w-3.5 h-3.5" /> Vídeo
                          </button>
                          <button type="button" onClick={() => removeTestimonial(i)} className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                      <input
                        value={t.author_name}
                        onChange={(e) => updateTestimonial(i, 'author_name', e.target.value)}
                        className={inputClass}
                        placeholder="Nome do autor"
                      />
                      <input
                        value={t.author_avatar_url ?? ''}
                        onChange={(e) => updateTestimonial(i, 'author_avatar_url', e.target.value)}
                        className={inputClass}
                        placeholder="URL da foto de perfil (opcional)"
                      />
                      {t.type === 'text' ? (
                        <textarea
                          value={t.content}
                          onChange={(e) => updateTestimonial(i, 'content', e.target.value)}
                          className={`${inputClass} h-20`}
                          placeholder="Texto do depoimento"
                        />
                      ) : (
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1.5">Vídeo do depoimento (MP4 ou WebM, máx. 80MB)</label>
                          {t.video_path ? (
                            <p className="text-sm text-green-700 mb-2">Vídeo enviado. Envie outro para substituir.</p>
                          ) : null}
                          <input
                            type="file"
                            accept="video/mp4,video/webm,video/quicktime"
                            disabled={uploadingVideoIdx === i}
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) uploadTestimonialVideo(i, file);
                              e.target.value = '';
                            }}
                            className="block w-full text-sm text-gray-600 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-[#8CD955]/20 file:text-[#8CD955] file:font-medium hover:file:bg-[#8CD955]/30"
                          />
                          {uploadingVideoIdx === i && <p className="text-xs text-gray-500 mt-1 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Enviando...</p>}
                        </div>
                      )}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Nº de reações (like + curtir)</label>
                        <input
                          type="number"
                          min={0}
                          value={t.likes_count}
                          onChange={(e) => updateTestimonial(i, 'likes_count', Number(e.target.value) || 0)}
                          className={`${inputClass} w-28`}
                          placeholder="Ex: 137"
                        />
                        <p className="text-xs text-gray-500 mt-0.5">Número exibido ao lado dos ícones 👍 e ❤ (estilo Facebook).</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </Section>

              {error && <p className="text-red-600 text-sm">{error}</p>}
              <div className="flex flex-wrap gap-3 pt-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-2 px-6 py-2.5 bg-[#8CD955] text-white font-medium rounded-xl hover:opacity-90 disabled:opacity-50 transition shadow-sm"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  Salvar alterações
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

          {/* Coluna do preview */}
          <div className="xl:col-span-2">
            <div className="xl:sticky xl:top-6 bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50/60">
                <div className="flex items-center gap-2">
                  <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-[#8CD955]/15">
                    <Smartphone className="w-4 h-4 text-[#8CD955]" />
                  </div>
                  <div>
                    <h2 className="font-semibold text-gray-800">Preview da VSL</h2>
                    <p className="text-xs text-gray-500">Como o visitante vê a página</p>
                  </div>
                </div>
                {form.slug && (
                  <button
                    type="button"
                    onClick={refreshPreview}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-[#8CD955] hover:bg-[#8CD955]/10 rounded-lg transition"
                    title="Atualizar preview"
                  >
                    <RefreshCw className="w-4 h-4" />
                    Atualizar
                  </button>
                )}
              </div>
              {/* Moldura tipo celular + área rolável */}
              <div className="p-4 bg-gray-100/80">
                <div className="mx-auto max-w-[340px] rounded-[2rem] border-[10px] border-gray-800 bg-gray-800 shadow-xl overflow-hidden">
                  {/* “notch” opcional */}
                  <div className="h-5 bg-gray-800 flex justify-center">
                    <div className="w-20 h-4 rounded-b-2xl bg-gray-900" />
                  </div>
                  <div className="bg-white overflow-hidden min-h-[520px] h-[70vh] max-h-[680px]">
                    {form.slug ? (
                      <iframe
                        ref={previewRef}
                        src={`/vsl/${form.slug}`}
                        title="Preview da VSL"
                        className="w-full h-full min-h-[500px] border-0 block"
                        sandbox="allow-scripts allow-same-origin"
                      />
                    ) : (
                      <div className="w-full h-full min-h-[400px] flex flex-col items-center justify-center text-gray-400 text-sm px-4 text-center">
                        <Smartphone className="w-12 h-12 mb-3 opacity-50" />
                        <p>Salve a página com um slug para ver o preview aqui.</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="px-4 py-3 border-t border-gray-100 bg-gray-50/50 space-y-1">
                <p className="text-xs text-gray-600">
                  Role <strong>dentro da tela</strong> do preview para ver o botão CTA (Sim eu quero) e os depoimentos.
                </p>
                <p className="text-xs text-gray-500">
                  Clique em &quot;Atualizar&quot; após salvar para ver as alterações.
                </p>
              </div>
            </div>
          </div>
        </div>
        )}
      </div>
    </Layout>
  );
}
