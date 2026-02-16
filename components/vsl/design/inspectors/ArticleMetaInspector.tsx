'use client';

import type { ArticleMetaProps } from '@/lib/vsl/runtime/types';

interface ArticleMetaInspectorProps {
  props: ArticleMetaProps;
  onChange: (p: ArticleMetaProps) => void;
}

export function ArticleMetaInspector({ props, onChange }: ArticleMetaInspectorProps) {
  const update = (partial: Partial<ArticleMetaProps>) => onChange({ ...props, ...partial });

  return (
    <div className="space-y-4 text-sm">
      <div>
        <label className="block font-medium text-gray-700 mb-1">Autor (ex: Por Eduardo Leão)</label>
        <input
          type="text"
          value={props.authorName ?? ''}
          onChange={(e) => update({ authorName: e.target.value })}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-800 placeholder:text-gray-500"
          placeholder="Eduardo Leão"
        />
      </div>
      <div>
        <label className="block font-medium text-gray-700 mb-1">Data de atualização</label>
        <input
          type="text"
          value={props.updatedText ?? ''}
          onChange={(e) => update({ updatedText: e.target.value })}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-800 placeholder:text-gray-500"
          placeholder="Atualizado há 30 minutos - 09/02/2026"
        />
      </div>
      <div>
        <label className="block font-medium text-gray-700 mb-1">Layout</label>
        <select
          value={props.layout ?? 'stack'}
          onChange={(e) => update({ layout: e.target.value as 'stack' | 'inline' })}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-800 placeholder:text-gray-500"
        >
          <option value="stack">Empilhado</option>
          <option value="inline">Em linha</option>
        </select>
      </div>
    </div>
  );
}
