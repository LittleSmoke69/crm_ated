'use client';

import { useState, useCallback } from 'react';
import { VslContentRenderer } from '@/components/vsl/VslContentRenderer';
import { getContentTemplate, type VslTemplateKey } from '@/lib/vsl/presets/content-templates';
import { findBlockById, updateBlockPropsById } from '@/lib/vsl/runtime/content-utils';
import type { VslContentRoot, VslRenderContext } from '@/lib/vsl/runtime/types';
import type { NewsTopbarProps, NewsMarqueeProps, ArticleMetaProps, HeadlineRichProps, BolaoLandingProps } from '@/lib/vsl/runtime/types';
import { NewsTopbarInspector } from './inspectors/NewsTopbarInspector';
import { NewsMarqueeInspector } from './inspectors/NewsMarqueeInspector';
import { ArticleMetaInspector } from './inspectors/ArticleMetaInspector';
import { HeadlineRichInspector } from './inspectors/HeadlineRichInspector';
import { BolaoLandingInspector } from './inspectors/BolaoLandingInspector';
import { LayoutGrid, Smartphone } from 'lucide-react';

interface VslDesignPanelProps {
  content: VslContentRoot | null;
  onContentChange: (content: VslContentRoot) => void;
  slug: string;
  redirectSlug: string;
  ctaText: string;
  projectId: string;
  /** IDs do player VTurb (aba Conteúdo) para exibir o vídeo no preview */
  videoPlayerId?: string;
  videoScriptSrc?: string;
}

function listBlocks(root: VslContentRoot | null): { id: string; type: string; label: string }[] {
  if (!root?.children) return [];
  const out: { id: string; type: string; label: string }[] = [];
  const types: Record<string, string> = {
    newsTopbar: 'Topo',
    newsMarquee: 'Marquee',
    section: 'Seção',
    headlineRich: 'Manchete',
    articleMeta: 'Meta',
    vturbVideo: 'Vídeo',
    buttonCTA: 'CTA',
    bolaoLanding: 'Bolão',
  };
  function walk(n: { id: string; type: string; children?: unknown[] }) {
    if (n.type !== 'page') out.push({ id: n.id, type: n.type, label: types[n.type] ?? n.type });
    (n.children ?? []).forEach((c) => walk(c as { id: string; type: string; children?: unknown[] }));
  }
  root.children.forEach((c) => walk(c as { id: string; type: string; children?: unknown[] }));
  return out;
}

export function VslDesignPanel({
  content,
  onContentChange,
  slug,
  redirectSlug,
  ctaText,
  projectId,
  videoPlayerId,
  videoScriptSrc,
}: VslDesignPanelProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [templateKey, setTemplateKey] = useState<VslTemplateKey>('finance');

  const applyTemplate = useCallback(
    (key?: VslTemplateKey) => {
      const k = key ?? templateKey;
      const next = getContentTemplate(k);
      onContentChange(next);
      setSelectedId(null);
    },
    [templateKey, onContentChange]
  );

  // Ao trocar o template no dropdown, aplica na hora (preview e blocos atualizam).
  // O conteúdo inicial vem da tela Conteúdo (buildContentFromFormData) ou do content_json salvo.
  const handleTemplateChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const key = e.target.value as VslTemplateKey;
      setTemplateKey(key);
      applyTemplate(key);
    },
    [applyTemplate]
  );

  const updateProps = useCallback(
    (id: string, props: Record<string, unknown>) => {
      if (!content) return;
      onContentChange(updateBlockPropsById(content, id, props));
    },
    [content, onContentChange]
  );

  const blocks = listBlocks(content);
  const selected = content ? findBlockById(content, selectedId ?? '') : null;
  const previewContext: VslRenderContext = {
    projectId,
    redirectSlug,
    ctaText,
    ctaVisible: true,
    resolveAssetUrl: undefined,
    videoPlayerId,
    videoScriptSrc,
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 w-full min-h-0 bg-gray-100 rounded-xl p-4 lg:h-full">
      {/* Esquerda: template + lista de blocos */}
      <div className="lg:col-span-2 flex flex-col gap-4 min-w-0 overflow-hidden">
        <div className="bg-white rounded-xl border border-gray-200 p-4 shrink-0">
          <h3 className="font-semibold text-gray-800 mb-2 flex items-center gap-2">
            <LayoutGrid className="w-4 h-4" />
            Template
          </h3>
          <select
            value={templateKey}
            onChange={handleTemplateChange}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-800 mb-2"
          >
            <option value="finance">Finance News</option>
            <option value="cnn">CNN-style</option>
            <option value="nbc">NBC-style</option>
            <option value="bolao">Bolão</option>
          </select>
          <p className="text-xs text-gray-500 mb-2">Trocar o template aplica na hora. Personalize os blocos à direita.</p>
          <button
            type="button"
            onClick={() => applyTemplate()}
            className="w-full py-2 bg-[#E86A24] text-white font-medium rounded-lg hover:opacity-90 text-sm"
          >
            Recarregar template
          </button>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 flex-1 min-h-0 overflow-auto">
          <h3 className="font-semibold text-gray-800 mb-2">Blocos</h3>
          <ul className="space-y-1">
            {blocks.map((b) => (
              <li key={b.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(b.id)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition ${
                    selectedId === b.id ? 'bg-[#E86A24]/20 text-[#5a9a3a]' : 'hover:bg-gray-100 text-gray-700'
                  }`}
                >
                  {b.label}
                </button>
              </li>
            ))}
          </ul>
          {!content && (
            <p className="text-xs text-gray-500 mt-2">Aplique um template para começar.</p>
          )}
        </div>
      </div>

      {/* Centro: preview mobile - tamanho maior para visualizar VSL e vídeo VTurb */}
      <div className="lg:col-span-7 flex flex-col min-w-0 min-h-[520px] lg:min-h-0">
        <div className="bg-white rounded-xl border border-gray-200 flex-1 flex flex-col min-h-0 overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-100 bg-gray-50/60 shrink-0">
            <Smartphone className="w-4 h-4 text-gray-500" />
            <span className="text-sm font-medium text-gray-700">Preview</span>
            <button
              type="button"
              onClick={() => window.open(`/vsl/${slug}`, '_blank', 'noopener,noreferrer')}
              className="ml-auto inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition"
            >
              Preview página toda
            </button>
          </div>
          {/* Card com scroll para mostrar o preview em tamanho maior (vídeo VTurb igual à VSL) */}
          <div className="flex-1 min-h-0 p-4 bg-gray-100/80 overflow-y-auto overflow-x-hidden flex justify-center">
            <div className="mx-auto w-full max-w-[680px] rounded-[2.5rem] border-[12px] border-gray-800 bg-gray-800 shadow-xl overflow-hidden flex-shrink-0">
              <div className="h-6 bg-gray-800 flex justify-center">
                <div className="w-24 h-5 rounded-b-2xl bg-gray-900" />
              </div>
              <div className="bg-white w-full overflow-y-auto overflow-x-hidden min-h-[560px] h-[75vh] max-h-[860px] scroll-smooth">
                {content ? (
                  <div className="w-full min-w-0">
                    <VslContentRenderer content={content} context={previewContext} />
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center min-h-[300px] text-gray-400 text-sm p-4">
                    <LayoutGrid className="w-10 h-10 mb-2 opacity-50" />
                    Aplique um template para ver o preview.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Direita: inspector */}
      <div className="lg:col-span-3 flex flex-col min-w-0 min-h-0">
        <div className="bg-white rounded-xl border border-gray-200 p-4 flex-1 min-h-0 overflow-auto">
          <h3 className="font-semibold text-gray-800 mb-3">Propriedades</h3>
          {selected ? (
            <>
              {selected.type === 'newsTopbar' && (
                <NewsTopbarInspector
                  props={(selected.props ?? {}) as NewsTopbarProps}
                  onChange={(p) => updateProps(selected.id, p as Record<string, unknown>)}
                />
              )}
              {selected.type === 'newsMarquee' && (
                <NewsMarqueeInspector
                  props={(selected.props ?? {}) as NewsMarqueeProps}
                  onChange={(p) => updateProps(selected.id, p as Record<string, unknown>)}
                />
              )}
              {selected.type === 'articleMeta' && (
                <ArticleMetaInspector
                  props={(selected.props ?? {}) as ArticleMetaProps}
                  onChange={(p) => updateProps(selected.id, p as Record<string, unknown>)}
                />
              )}
              {selected.type === 'headlineRich' && (
                <HeadlineRichInspector
                  props={(selected.props ?? {}) as HeadlineRichProps}
                  onChange={(p) => updateProps(selected.id, p as Record<string, unknown>)}
                />
              )}
              {selected.type === 'section' && (
                <div className="space-y-2 text-sm">
                  <label className="block font-medium text-gray-700">Largura máx. (px ou valor CSS)</label>
                  <input
                    type="text"
                    value={(selected.props as { maxWidth?: string })?.maxWidth ?? '400px'}
                    onChange={(e) => updateProps(selected.id, { maxWidth: e.target.value || '400px' })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-800 placeholder:text-gray-500"
                  />
                </div>
              )}
              {selected.type === 'buttonCTA' && (
                <div className="space-y-2 text-sm">
                  <label className="block font-medium text-gray-700">Texto do CTA</label>
                  <input
                    type="text"
                    value={(selected.props as { text?: string })?.text ?? ''}
                    onChange={(e) => updateProps(selected.id, { text: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-800 placeholder:text-gray-500"
                  />
                </div>
              )}
              {selected.type === 'bolaoLanding' && (
                <BolaoLandingInspector
                  props={(selected.props ?? {}) as BolaoLandingProps}
                  projectId={projectId}
                  onChange={(p) => updateProps(selected.id, p as Record<string, unknown>)}
                />
              )}
              {(selected.type === 'vturbVideo' || selected.type === 'page') && (
                <p className="text-gray-500 text-sm">Configure o vídeo na aba Conteúdo (embed VTurb).</p>
              )}
            </>
          ) : (
            <p className="text-gray-500 text-sm">Selecione um bloco na lista para editar.</p>
          )}
        </div>
      </div>
    </div>
  );
}
