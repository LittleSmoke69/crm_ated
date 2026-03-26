'use client';

import { useMemo, useState } from 'react';
import type { BolaoLandingProps, BolaoLotteryButtonConfig } from '@/lib/vsl/runtime/types';
import { normalizeBolaoLotteryButtons, patchBolaoLotteryButton } from '@/lib/vsl/bolao-lottery-config';

/** Converte HSL (CSS) para #rrggbb para o input type="color". */
function hslToHex(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(100, s)) / 100;
  l = Math.max(0, Math.min(100, l)) / 100;
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  let r: number;
  let g: number;
  let b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h / 360 + 1 / 3);
    g = hue2rgb(p, q, h / 360);
    b = hue2rgb(p, q, h / 360 - 1 / 3);
  }
  const x = (n: number) =>
    Math.round(Math.max(0, Math.min(1, n)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${x(r)}${x(g)}${x(b)}`;
}

/** Extrai #rrggbb a partir de hsl(...), #rgb, #rrggbb ou rgb(...). */
function cssColorToHex(css: string): string {
  const t = css.trim();
  const m6 = /^#([0-9A-Fa-f]{6})$/i.exec(t);
  if (m6) return `#${m6[1].toLowerCase()}`;
  const m3 = /^#([0-9A-Fa-f]{3})$/i.exec(t);
  if (m3) {
    const [, x] = m3;
    return `#${x[0]}${x[0]}${x[1]}${x[1]}${x[2]}${x[2]}`.toLowerCase();
  }
  const hsl = t.match(/hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%/i);
  if (hsl) return hslToHex(Number(hsl[1]), Number(hsl[2]), Number(hsl[3]));
  const rgb = t.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
  if (rgb) {
    const r = Math.min(255, Math.max(0, Number(rgb[1])));
    const g = Math.min(255, Math.max(0, Number(rgb[2])));
    const b = Math.min(255, Math.max(0, Number(rgb[3])));
    const x = (n: number) => n.toString(16).padStart(2, '0');
    return `#${x(r)}${x(g)}${x(b)}`;
  }
  return '#141d33';
}

const BOLO_BG_PRESETS: { name: string; value: string }[] = [
  { name: 'Azul noite (padrão)', value: 'hsl(224, 60%, 12%)' },
  { name: 'Azul profundo', value: 'hsl(222, 47%, 11%)' },
  { name: 'Índigo escuro', value: 'hsl(239, 50%, 12%)' },
  { name: 'Roxo noturno', value: 'hsl(262, 45%, 12%)' },
  { name: 'Cinza grafite', value: 'hsl(220, 15%, 10%)' },
  { name: 'Petróleo', value: 'hsl(200, 45%, 9%)' },
  { name: 'Quase preto', value: 'hsl(0, 0%, 8%)' },
  { name: 'Azul oceano', value: 'hsl(210, 55%, 11%)' },
];

interface BolaoLandingInspectorProps {
  props: BolaoLandingProps;
  onChange: (p: BolaoLandingProps) => void;
  projectId: string;
}

function TextField({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="block font-medium text-gray-700 mb-1">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-800 placeholder:text-gray-500"
        placeholder={placeholder}
      />
    </div>
  );
}

export function BolaoLandingInspector({ props, onChange, projectId }: BolaoLandingInspectorProps) {
  const update = (partial: Partial<BolaoLandingProps>) => onChange({ ...props, ...partial });
  const [uploadingLogo, setUploadingLogo] = useState(false);

  const [logoError, setLogoError] = useState<string | null>(null);

  const bgValue = props.backgroundColor ?? 'hsl(224, 60%, 12%)';
  const pickerHex = useMemo(() => cssColorToHex(bgValue), [bgValue]);

  const uploadLogo = async (file: File) => {
    if (!projectId) return;
    setLogoError(null);
    setUploadingLogo(true);
    try {
      const fd = new FormData();
      fd.set('project_id', String(projectId));
      fd.set('file', file);
      const res = await fetch('/api/admin/vsl/bolao/logo', {
        method: 'POST',
        body: fd,
      });
      const json = await res.json().catch(() => null);
      const logoPath = json?.data?.logo_path ?? json?.data?.logoPath ?? json?.logo_path ?? null;
      if (logoPath) update({ logoUrl: String(logoPath) });
      else setLogoError(json?.error || 'Erro ao fazer upload da logo');
    } catch {
      setLogoError('Erro de rede ao fazer upload da logo');
    } finally {
      setUploadingLogo(false);
    }
  };

  return (
    <div className="space-y-5 text-sm">
      <div className="space-y-3">
        <div>
          <label className="block font-medium text-gray-700 mb-1">Logo (opcional)</label>
          <div className="flex items-center gap-3">
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              disabled={uploadingLogo}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) uploadLogo(file);
                e.target.value = '';
              }}
              className="block w-full text-sm text-gray-600 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-[#8CD955]/20 file:text-[#8CD955] file:font-medium hover:file:bg-[#8CD955]/30 disabled:opacity-50"
            />
          </div>
          <p className="text-xs text-gray-500 mt-1.5">Upload vai para o Storage e o render assina automaticamente.</p>
          {uploadingLogo && <p className="text-xs text-gray-500 mt-2">Enviando...</p>}
          {logoError && <p className="text-xs text-red-600 mt-2">{logoError}</p>}
          <div className="mt-3">
            <TextField
              label="Logo URL/Path"
              value={props.logoUrl ?? ''}
              placeholder="/logo_zaploto.png ou bancas/..."
              onChange={(v) => update({ logoUrl: v || undefined })}
            />
          </div>
        </div>

        <TextField label="Título antes do destaque" value={props.titleBefore ?? 'Clique e Escolha '} onChange={(v) => update({ titleBefore: v })} />
        <TextField label="Título em destaque" value={props.titleHighlight ?? 'Seu Bolão!'} onChange={(v) => update({ titleHighlight: v })} />
        <TextField label="Subtítulo" value={props.subtitle ?? ''} onChange={(v) => update({ subtitle: v })} placeholder="A Primeira Casa Lotérica Online do Brasil." />
      </div>

      <div className="bg-gray-50/60 border border-gray-200 rounded-xl p-3 space-y-3">
        <h4 className="font-semibold text-gray-800">Tema</h4>
        <div>
          <label className="block font-medium text-gray-700 mb-2">Cor de fundo</label>
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <input
              type="color"
              value={pickerHex}
              onChange={(e) => update({ backgroundColor: e.target.value })}
              className="h-11 w-[4.5rem] cursor-pointer rounded-lg border border-gray-300 bg-white p-0.5 shadow-sm"
              title="Abrir seletor de cor do sistema"
              aria-label="Escolher cor de fundo"
            />
            <span className="text-xs text-gray-500">Clique no quadrado para abrir o seletor do navegador</span>
          </div>
          <p className="text-xs font-medium text-gray-600 mb-2">Paleta sugerida</p>
          <div className="flex flex-wrap gap-2">
            {BOLO_BG_PRESETS.map((p) => {
              const active = bgValue.trim() === p.value.trim();
              return (
                <button
                  key={p.value}
                  type="button"
                  title={p.name}
                  aria-label={`Cor: ${p.name}`}
                  aria-pressed={active}
                  onClick={() => update({ backgroundColor: p.value })}
                  className={[
                    'h-9 w-9 rounded-lg border-2 shadow-sm transition hover:scale-105 focus:outline-none focus:ring-2 focus:ring-[#8CD955] focus:ring-offset-1',
                    active ? 'border-[#8CD955] ring-2 ring-[#8CD955]/40' : 'border-gray-300 hover:border-gray-400',
                  ].join(' ')}
                  style={{ background: p.value }}
                />
              );
            })}
          </div>
          <p className="text-xs text-gray-500 mt-2 mb-2">
            Para gradiente ou valores especiais, use o campo abaixo.
          </p>
        </div>
        <TextField
          label="Código CSS (avançado)"
          value={bgValue}
          onChange={(v) => update({ backgroundColor: v || undefined })}
          placeholder="hsl(224, 60%, 12%) ou #141d33"
        />
      </div>

      <div className="bg-gray-50/60 border border-gray-200 rounded-xl p-3 space-y-3">
        <h4 className="font-semibold text-gray-800">Vídeo ConverteAI</h4>
        <TextField
          label="playerId"
          value={props.videoPlayerId ?? ''}
          onChange={(v) => update({ videoPlayerId: v || undefined })}
          placeholder="69c1b2853d18cfb2430cce49"
        />
        <TextField
          label="projectId (opcional)"
          value={props.videoProjectId ?? ''}
          onChange={(v) => update({ videoProjectId: v || undefined })}
          placeholder="Se vazio, tenta derivar do VTurb embed configurado na página"
        />
        <TextField
          label="Mensagem quando o botão não tiver link"
          value={props.disableMessage ?? 'Configure o link do botão no painel'}
          onChange={(v) => update({ disableMessage: v })}
        />
      </div>

      <div className="bg-gray-50/60 border border-gray-200 rounded-xl p-3 space-y-4">
        <h4 className="font-semibold text-gray-800">Loterias (3 botões)</h4>
        <p className="text-xs text-gray-600">
          Cada botão tem etiqueta e texto principal próprios. Alterações são salvas em <code className="bg-gray-100 px-1 rounded">bolaoLotteryButtons</code> no JSON da página.
        </p>

        {normalizeBolaoLotteryButtons(props).map((btn, index) => {
          const i = index as 0 | 1 | 2;
          const titles = ['Lotofácil', 'Quina', 'Mega-Sena'];
          const patch = (partial: Partial<BolaoLotteryButtonConfig>) =>
            update(patchBolaoLotteryButton(props, i, partial));
          return (
            <div key={titles[index]} className="space-y-3 border-t border-gray-200 pt-4 first:border-t-0 first:pt-0">
              <h5 className="font-medium text-gray-800">{titles[index]}</h5>
              <TextField
                label="Texto da etiqueta (selo à esquerda)"
                value={btn.badgeText}
                onChange={(v) => patch({ badgeText: v })}
                placeholder={index === 0 ? 'LOTOFACIL' : index === 1 ? 'QUINA' : 'MEGA-SENA'}
              />
              <TextField
                label="Texto principal do botão (grande)"
                value={btn.mainText}
                onChange={(v) => patch({ mainText: v })}
                placeholder={index === 0 ? 'Lotinha' : index === 1 ? 'Super 5' : 'Super 6'}
              />
              <TextField label="Link" value={btn.href} onChange={(v) => patch({ href: v })} placeholder="https://..." />
              <div className="grid grid-cols-2 gap-3">
                <TextField label="Cor A (CSS)" value={btn.accentFrom} onChange={(v) => patch({ accentFrom: v })} placeholder="#..." />
                <TextField label="Cor B (CSS)" value={btn.accentTo} onChange={(v) => patch({ accentTo: v })} placeholder="#..." />
              </div>
            </div>
          );
        })}
      </div>

      <div className="bg-gray-50/60 border border-gray-200 rounded-xl p-3 space-y-3">
        <h4 className="font-semibold text-gray-800">WhatsApp</h4>
        <TextField label="Link WhatsApp" value={props.whatsappHref ?? ''} onChange={(v) => update({ whatsappHref: v })} placeholder="https://wa.me/..." />
        <TextField label="Prefixo" value={props.whatsappPrefix ?? 'Atendimento via'} onChange={(v) => update({ whatsappPrefix: v })} />
        <TextField label="Texto principal" value={props.whatsappMain ?? 'Falar com Atendente'} onChange={(v) => update({ whatsappMain: v })} />
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label="Cor A (CSS)"
            value={props.whatsappAccentFrom ?? '#2ddb6f'}
            onChange={(v) => update({ whatsappAccentFrom: v })}
            placeholder="#2ddb6f"
          />
          <TextField
            label="Cor B (CSS)"
            value={props.whatsappAccentTo ?? '#0f8038'}
            onChange={(v) => update({ whatsappAccentTo: v })}
            placeholder="#0f8038"
          />
        </div>
      </div>
    </div>
  );
}

