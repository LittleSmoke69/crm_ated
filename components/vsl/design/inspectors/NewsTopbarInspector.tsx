'use client';

import type { NewsTopbarProps, NewsTopbarPill } from '@/lib/vsl/runtime/types';

const PRESETS: Record<string, Partial<NewsTopbarProps>> = {
  finance: {
    variant: 'finance',
    bgColor: '#8B0B0B',
    textColor: '#FFFFFF',
    centerTitleType: 'text',
    centerTitleText: 'FINANÇAS',
    showSearch: true,
    showRightMenu: true,
    showHamburger: false,
  },
  cnn: {
    variant: 'cnn',
    bgColor: '#FFFFFF',
    textColor: '#000000',
    centerTitleType: 'text',
    centerTitleText: 'CNN Mundo',
    showHamburger: true,
    showSearch: true,
    rightButtonText: 'Entrar',
    rightButtonVariant: 'outline',
    showLiveBadge: true,
    liveBadgeText: 'ATUALIZAÇÕES AO VIVO',
    pills: [{ text: 'EUA', style: 'circle', bg: '#666', color: '#fff' }, { text: 'Segurança', style: 'circle', bg: '#666', color: '#fff' }],
    borderBottom: '1px solid #eee',
  },
  nbc: {
    variant: 'nbc',
    bgColor: '#222222',
    textColor: '#FFFFFF',
    centerTitleType: 'text',
    centerTitleText: 'NBC NEWS',
    showRightMenu: true,
    showHamburger: false,
    showSearch: false,
  },
};

interface NewsTopbarInspectorProps {
  props: NewsTopbarProps;
  onChange: (p: NewsTopbarProps) => void;
}

export function NewsTopbarInspector({ props, onChange }: NewsTopbarInspectorProps) {
  const update = (partial: Partial<NewsTopbarProps>) => onChange({ ...props, ...partial });

  return (
    <div className="space-y-4 text-sm">
      <div>
        <label className="block font-medium text-gray-700 mb-1">Preset do topo</label>
        <select
          value={props.variant ?? 'custom'}
          onChange={(e) => {
            const v = e.target.value as keyof typeof PRESETS;
            if (v !== 'custom') update(PRESETS[v] ?? {});
            else update({ variant: 'custom' });
          }}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-800 placeholder:text-gray-500"
        >
          <option value="finance">Finance</option>
          <option value="cnn">CNN</option>
          <option value="nbc">NBC</option>
          <option value="custom">Custom</option>
        </select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block font-medium text-gray-700 mb-1">Cor de fundo</label>
          <input
            type="text"
            value={props.bgColor ?? ''}
            onChange={(e) => update({ bgColor: e.target.value })}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 font-mono text-xs text-gray-800 placeholder:text-gray-500"
            placeholder="#8B0B0B"
          />
        </div>
        <div>
          <label className="block font-medium text-gray-700 mb-1">Cor do texto</label>
          <input
            type="text"
            value={props.textColor ?? ''}
            onChange={(e) => update({ textColor: e.target.value })}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 font-mono text-xs text-gray-800 placeholder:text-gray-500"
            placeholder="#FFFFFF"
          />
        </div>
      </div>
      <div>
        <label className="block font-medium text-gray-700 mb-1">Título central</label>
        <input
          type="text"
          value={props.centerTitleText ?? ''}
          onChange={(e) => update({ centerTitleText: e.target.value })}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-800 placeholder:text-gray-500"
          placeholder="FINANÇAS"
        />
      </div>
      <div className="flex flex-wrap gap-3">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={props.showHamburger ?? false}
            onChange={(e) => update({ showHamburger: e.target.checked })}
          />
          <span>Menu hamburger</span>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={props.showSearch ?? false}
            onChange={(e) => update({ showSearch: e.target.checked })}
          />
          <span>Busca</span>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={props.showRightMenu ?? false}
            onChange={(e) => update({ showRightMenu: e.target.checked })}
          />
          <span>Menu direito</span>
        </label>
      </div>
      <div>
        <label className="block font-medium text-gray-700 mb-1">Botão direito (texto)</label>
        <input
          type="text"
          value={props.rightButtonText ?? ''}
          onChange={(e) => update({ rightButtonText: e.target.value })}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-800 placeholder:text-gray-500"
          placeholder="Entrar"
        />
      </div>
      <div className="flex flex-wrap gap-3">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={props.showLiveBadge ?? false}
            onChange={(e) => update({ showLiveBadge: e.target.checked })}
          />
          <span>Badge AO VIVO</span>
        </label>
      </div>
      {props.showLiveBadge && (
        <div>
          <label className="block font-medium text-gray-700 mb-1">Texto do badge</label>
          <input
            type="text"
            value={props.liveBadgeText ?? ''}
            onChange={(e) => update({ liveBadgeText: e.target.value })}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-800 placeholder:text-gray-500"
            placeholder="ATUALIZAÇÕES AO VIVO"
          />
        </div>
      )}
      <div>
        <label className="block font-medium text-gray-700 mb-1">Pills (ex: EUA, Segurança)</label>
        <input
          type="text"
          value={(props.pills ?? []).map((p) => p.text).join(', ')}
          onChange={(e) => {
            const texts = e.target.value.split(',').map((t) => t.trim()).filter(Boolean);
            const pills: NewsTopbarPill[] = texts.map((text) => ({ text, style: 'circle', bg: '#666', color: '#fff' }));
            update({ pills });
          }}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-800 placeholder:text-gray-500"
          placeholder="EUA, Segurança"
        />
      </div>
    </div>
  );
}
