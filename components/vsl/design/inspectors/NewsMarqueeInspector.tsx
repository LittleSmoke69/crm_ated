'use client';

import type { NewsMarqueeProps } from '@/lib/vsl/runtime/types';

interface NewsMarqueeInspectorProps {
  props: NewsMarqueeProps;
  onChange: (p: NewsMarqueeProps) => void;
}

export function NewsMarqueeInspector({ props, onChange }: NewsMarqueeInspectorProps) {
  const update = (partial: Partial<NewsMarqueeProps>) => onChange({ ...props, ...partial });

  return (
    <div className="space-y-4 text-sm">
      <div>
        <label className="block font-medium text-gray-700 mb-1">Texto</label>
        <input
          type="text"
          value={props.text ?? ''}
          onChange={(e) => update({ text: e.target.value })}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-800 placeholder:text-gray-500"
          placeholder="ATUALIZAÇÕES DIÁRIAS..."
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block font-medium text-gray-700 mb-1">Cor de fundo</label>
          <input
            type="text"
            value={props.bgColor ?? ''}
            onChange={(e) => update({ bgColor: e.target.value })}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 font-mono text-xs text-gray-800 placeholder:text-gray-500"
          />
        </div>
        <div>
          <label className="block font-medium text-gray-700 mb-1">Cor do texto</label>
          <input
            type="text"
            value={props.textColor ?? ''}
            onChange={(e) => update({ textColor: e.target.value })}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 font-mono text-xs text-gray-800 placeholder:text-gray-500"
          />
        </div>
      </div>
      <div>
        <label className="block font-medium text-gray-700 mb-1">Velocidade (px/s)</label>
        <input
          type="number"
          min={20}
          max={120}
          value={props.speed ?? 60}
          onChange={(e) => update({ speed: Number(e.target.value) || 60 })}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-800 placeholder:text-gray-500"
        />
      </div>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={props.uppercase ?? true}
          onChange={(e) => update({ uppercase: e.target.checked })}
        />
        <span>Maiúsculas</span>
      </label>
    </div>
  );
}
