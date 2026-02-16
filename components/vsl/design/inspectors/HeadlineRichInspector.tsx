'use client';

import { useMemo, useState } from 'react';
import type { HeadlineRichProps, HeadlineRichTextNode } from '@/lib/vsl/runtime/types';

const FONT_SIZES = [24, 28, 32, 36];
const HIGHLIGHT_COLOR = '#B10E0E';

function getPlainTextFromContent(content: HeadlineRichProps['content']): string {
  if (!content || typeof content !== 'object') return '';
  const doc = content as HeadlineRichTextNode;
  if (doc.type === 'text') return doc.text ?? '';
  if (doc.type === 'paragraph' && Array.isArray(doc.content)) {
    return doc.content.map((c) => getPlainTextFromContent(c)).join('');
  }
  if (doc.type === 'doc' && Array.isArray(doc.content)) {
    return doc.content.map((c) => getPlainTextFromContent(c)).join('');
  }
  return '';
}

function buildContentFromSegments(
  fullText: string,
  highlightedStart: number,
  highlightedEnd: number
): HeadlineRichTextNode {
  const before = fullText.slice(0, highlightedStart);
  const segment = fullText.slice(highlightedStart, highlightedEnd);
  const after = fullText.slice(highlightedEnd);
  const content: HeadlineRichTextNode[] = [];
  if (before) content.push({ type: 'text', text: before });
  if (segment) {
    content.push({
      type: 'text',
      text: segment,
      marks: [{ type: 'bold' }, { type: 'textStyle', attrs: { color: HIGHLIGHT_COLOR } }],
    });
  }
  if (after) content.push({ type: 'text', text: after });
  return {
    type: 'doc',
    content: [{ type: 'paragraph', content }],
  };
}

interface HeadlineRichInspectorProps {
  props: HeadlineRichProps;
  onChange: (p: HeadlineRichProps) => void;
}

export function HeadlineRichInspector({ props, onChange }: HeadlineRichInspectorProps) {
  const update = (partial: Partial<HeadlineRichProps>) => onChange({ ...props, ...partial });

  const plainText = useMemo(() => getPlainTextFromContent(props.content), [props.content]);
  const [selectionStart, setSelectionStart] = useState(0);
  const [selectionEnd, setSelectionEnd] = useState(0);

  const applyHighlight = () => {
    const start = Math.min(selectionStart, selectionEnd);
    const end = Math.max(selectionStart, selectionEnd);
    if (start === end) return;
    const newContent = buildContentFromSegments(plainText, start, end);
    update({ content: newContent });
  };

  const resetHighlight = () => {
    const newContent: HeadlineRichTextNode = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: plainText }] }],
    };
    update({ content: newContent });
  };

  return (
    <div className="space-y-4 text-sm">
      <div>
        <label className="block font-medium text-gray-700 mb-1">Manchete (selecione o trecho e use Destaque)</label>
        <textarea
          value={plainText}
          onChange={(e) => {
            const t = e.target.value;
            const newContent: HeadlineRichTextNode = {
              type: 'doc',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }],
            };
            update({ content: newContent });
          }}
          onSelect={(e) => {
            const el = e.target as HTMLTextAreaElement;
            setSelectionStart(el.selectionStart);
            setSelectionEnd(el.selectionEnd);
          }}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 min-h-[80px] text-gray-800 placeholder:text-gray-500"
          placeholder="Estudo Comparativo: Eficiência de jogos..."
        />
        <div className="flex gap-2 mt-2">
          <button
            type="button"
            onClick={applyHighlight}
            className="px-3 py-1.5 bg-[#B10E0E] text-white text-xs font-medium rounded-lg hover:opacity-90"
          >
            Destaque (vermelho + negrito no trecho selecionado)
          </button>
          <button
            type="button"
            onClick={resetHighlight}
            className="px-3 py-1.5 bg-gray-200 text-gray-700 text-xs font-medium rounded-lg hover:bg-gray-300"
          >
            Reset estilo do trecho
          </button>
        </div>
      </div>
      <div>
        <label className="block font-medium text-gray-700 mb-1">Tamanho base (px)</label>
        <select
          value={props.defaultFontSize ?? 28}
          onChange={(e) => update({ defaultFontSize: Number(e.target.value) })}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-800"
        >
          {FONT_SIZES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="block font-medium text-gray-700 mb-1">Cor padrão</label>
        <input
          type="text"
          value={props.defaultColor ?? '#111111'}
          onChange={(e) => update({ defaultColor: e.target.value })}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 font-mono text-xs text-gray-800 placeholder:text-gray-500"
        />
      </div>
    </div>
  );
}
