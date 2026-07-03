'use client';

import React, { useState } from 'react';
import {
  TENANT_THEME_KEYS,
  TENANT_THEME_LABELS,
  type TenantThemePalette,
  type TenantThemeToken,
  type TenantThemeColorsStored,
} from '@/lib/constants/tenant-theme-map';
import { Palette, RotateCcw } from 'lucide-react';

/** Presets rápidos — marcas comuns + neutros (barra de paleta). */
const PRESET_PALETTE = [
  '#E86A24',
  '#22c55e',
  '#10b981',
  '#14b8a6',
  '#06b6d4',
  '#3b82f6',
  '#6366f1',
  '#8b5cf6',
  '#d946ef',
  '#ec4899',
  '#f43f5e',
  '#f97316',
  '#eab308',
  '#84cc16',
  '#64748b',
  '#111827',
  '#ffffff',
  '#f9fafb',
  '#1a1a1a',
  '#2a2a2a',
] as const;

function normalizeColorInput(hex: string): string {
  const s = hex.trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(s)) return s;
  if (/^#[0-9A-Fa-f]{3}$/.test(s)) {
    return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`.toLowerCase();
  }
  return '#888888';
}

function ColorPaletteBar(props: {
  value: string;
  fallbackHex: string;
  onChange: (hex: string) => void;
  onClear?: () => void;
  idPrefix: string;
}) {
  const { value, fallbackHex, onChange, onClear, idPrefix } = props;
  const effective = value.trim() ? value.trim() : fallbackHex;
  const pickerId = `${idPrefix}-picker`;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-wrap gap-1 p-1.5 rounded-xl bg-gray-100/90 dark:bg-gray-900/60 border border-gray-200 dark:border-gray-600 max-w-full">
          {PRESET_PALETTE.map((hex) => {
            const active = effective.toLowerCase() === hex.toLowerCase();
            return (
              <button
                key={hex}
                type="button"
                title={hex}
                aria-label={`Cor ${hex}`}
                className={`w-7 h-7 sm:w-8 sm:h-8 rounded-lg border-2 shadow-sm transition hover:scale-110 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-[#E86A24] dark:focus:ring-offset-gray-900 ${
                  active
                    ? 'border-white dark:border-white ring-2 ring-[#E86A24]/70 scale-105'
                    : 'border-black/10 dark:border-white/10'
                }`}
                style={{ backgroundColor: hex }}
                onClick={() => onChange(hex)}
              />
            );
          })}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <label
            htmlFor={pickerId}
            className="flex flex-col gap-0.5 cursor-pointer"
          >
            <span className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Personalizar
            </span>
            <span
              className="w-11 h-11 rounded-xl border-2 border-gray-300 dark:border-gray-600 shadow-inner block"
              style={{ backgroundColor: normalizeColorInput(effective) }}
            />
          </label>
          <input
            id={pickerId}
            type="color"
            value={normalizeColorInput(effective)}
            onChange={(e) => onChange(e.target.value)}
            className="sr-only"
            aria-label="Abrir seletor de cor"
          />
          {onClear && (
            <button
              type="button"
              onClick={onClear}
              className="flex items-center gap-1 px-2 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
              title="Voltar ao padrão calculado (marca)"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Padrão
            </button>
          )}
        </div>
      </div>
      <input
        type="text"
        value={value}
        placeholder={fallbackHex}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-2.5 py-1.5 text-xs font-mono border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100"
      />
    </div>
  );
}

/** Preview mínimo do papel de cada token no app. */
function TokenContextPreview({
  token,
  color,
  palette,
}: {
  token: TenantThemeToken;
  color: string;
  palette: TenantThemePalette;
}) {
  const surface = palette.surface;
  const elevated = palette.surface_elevated;
  const border = palette.border;
  const text = palette.text;
  const muted = palette.text_muted;

  return (
    <div
      className="rounded-lg border overflow-hidden text-left max-w-[220px]"
      style={{ borderColor: border, background: surface }}
    >
      <div className="px-2 py-1.5 text-[10px] font-medium text-gray-500 dark:text-gray-400 border-b" style={{ borderColor: border }}>
        Preview
      </div>
      <div className="p-2 space-y-2">
        {token === 'primary' && (
          <button
            type="button"
            className="w-full py-1.5 rounded-md text-xs font-medium text-white shadow-sm"
            style={{ backgroundColor: color }}
          >
            Botão principal
          </button>
        )}
        {token === 'primary_hover' && (
          <button
            type="button"
            className="w-full py-1.5 rounded-md text-xs font-medium text-white shadow-md"
            style={{
              backgroundColor: color,
              boxShadow: `0 0 0 2px ${color}66`,
            }}
          >
            Estado hover
          </button>
        )}
        {token === 'accent' && (
          <div className="flex gap-1 flex-wrap">
            <span
              className="px-2 py-0.5 rounded text-[10px] font-medium text-white"
              style={{ backgroundColor: color }}
            >
              Destaque
            </span>
            <span className="text-[10px]" style={{ color }}>
              Link
            </span>
          </div>
        )}
        {token === 'surface' && (
          <div
            className="h-14 rounded-md flex items-center justify-center text-[10px]"
            style={{ backgroundColor: color, color: text }}
          >
            Área principal
          </div>
        )}
        {token === 'surface_elevated' && (
          <div className="space-y-1">
            <div className="h-6 rounded text-[9px] flex items-center px-1.5" style={{ background: surface, color: muted }}>
              Fundo app
            </div>
            <div
              className="h-8 rounded-md shadow-sm flex items-center justify-center text-[10px]"
              style={{ backgroundColor: color, color: text, border: `1px solid ${border}` }}
            >
              Cartão / painel
            </div>
          </div>
        )}
        {token === 'border' && (
          <div
            className="rounded-md p-2 space-y-1"
            style={{ background: elevated, borderWidth: 2, borderStyle: 'solid', borderColor: color }}
          >
            <p className="text-[10px]" style={{ color: text }}>
              Borda do cartão
            </p>
            <p className="text-[9px]" style={{ color: muted }}>
              Divisor e contorno
            </p>
          </div>
        )}
        {token === 'text' && (
          <div style={{ background: elevated, padding: 6, borderRadius: 6 }}>
            <p className="text-xs font-semibold leading-tight" style={{ color }}>
              Título da página
            </p>
            <p className="text-[10px] mt-1" style={{ color: muted }}>
              Subtítulo usa “texto secundário”
            </p>
          </div>
        )}
        {token === 'text_muted' && (
          <div style={{ background: elevated, padding: 6, borderRadius: 6 }}>
            <p className="text-xs font-medium" style={{ color: text }}>
              Texto principal
            </p>
            <p className="text-[10px] mt-0.5" style={{ color }}>
              Descrição e hints secundários
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/** Mini layout combinado: header + cartão + botão (usa paleta resolvida inteira). */
function CombinedThemePreview({ palette }: { palette: TenantThemePalette }) {
  const { primary, surface, surface_elevated, border, text, text_muted, accent } = palette;

  return (
    <div
      className="rounded-xl overflow-hidden border shadow-lg max-w-md mx-auto"
      style={{ borderColor: border, background: surface }}
    >
      <div
        className="h-9 flex items-center gap-2 px-3 border-b"
        style={{ borderColor: border, background: surface_elevated }}
      >
        <span className="w-2 h-2 rounded-full" style={{ background: primary }} />
        <span className="text-xs font-medium truncate" style={{ color: text }}>
          Seu app
        </span>
        <span className="ml-auto text-[10px]" style={{ color: accent }}>
          ●
        </span>
      </div>
      <div className="p-3 space-y-2">
        <div
          className="rounded-lg p-3 border"
          style={{ background: surface_elevated, borderColor: border }}
        >
          <p className="text-sm font-semibold" style={{ color: text }}>
            Painel
          </p>
          <p className="text-xs mt-1" style={{ color: text_muted }}>
            Texto secundário e métricas.
          </p>
          <button
            type="button"
            className="mt-3 w-full py-2 rounded-lg text-sm font-medium text-white"
            style={{ background: primary }}
          >
            Ação principal
          </button>
        </div>
      </div>
    </div>
  );
}

export type TenantThemeEditorProps = {
  theme_colors: TenantThemeColorsStored | undefined;
  setThemeSlot: (mode: 'light' | 'dark', key: TenantThemeToken, value: string) => void;
  resolvedLight: TenantThemePalette;
  resolvedDark: TenantThemePalette;
};

export function TenantThemeEditor({
  theme_colors,
  setThemeSlot,
  resolvedLight,
  resolvedDark,
}: TenantThemeEditorProps) {
  const [previewMode, setPreviewMode] = useState<'light' | 'dark'>('light');

  const combinedPalette = previewMode === 'dark' ? resolvedDark : resolvedLight;

  function renderColumn(mode: 'light' | 'dark') {
    const resolved = mode === 'light' ? resolvedLight : resolvedDark;
    return (
      <div className="space-y-4 p-3 sm:p-4 rounded-xl bg-white/80 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-600">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300">
          {mode === 'light' ? 'Modo claro' : 'Modo escuro'}
        </p>
        {TENANT_THEME_KEYS.map((key) => {
          const raw = theme_colors?.[mode]?.[key] ?? '';
          const fallback = resolved[key];
          const mergedForPreview: TenantThemePalette = { ...resolved };
          const effective = raw.trim() ? raw.trim() : fallback;
          mergedForPreview[key] = effective;

          return (
            <div
              key={`${mode}-${key}`}
              className="p-3 rounded-lg border border-gray-100 dark:border-gray-700/80 bg-gray-50/80 dark:bg-gray-950/30 space-y-2"
            >
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-200">
                    {TENANT_THEME_LABELS[key]}
                  </label>
                  <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">
                    Padrão atual:{' '}
                    <code className="text-[10px] bg-gray-200/80 dark:bg-gray-800 px-1 rounded">{fallback}</code>
                  </p>
                  <ColorPaletteBar
                    idPrefix={`${mode}-${key}`}
                    value={raw}
                    fallbackHex={fallback}
                    onChange={(v) => setThemeSlot(mode, key, v)}
                    onClear={() => setThemeSlot(mode, key, '')}
                  />
                </div>
                <div className="shrink-0 flex justify-center sm:justify-end">
                  <TokenContextPreview token={key} color={effective} palette={mergedForPreview} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2">
        <Palette className="w-5 h-5 text-[#E86A24] shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium text-gray-800 dark:text-gray-100">Tema do white label</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Use a barra de cores para escolher rápido ou &quot;Personalizar&quot; para qualquer tom. Cada bloco mostra um
            preview do efeito no layout. Campo vazio restaura o padrão (marca + tabela crm-atendimento).
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">{renderColumn('light')}{renderColumn('dark')}</div>

      <div className="p-4 rounded-xl border border-dashed border-gray-300 dark:border-gray-600 bg-gradient-to-b from-gray-50/90 to-gray-100/50 dark:from-gray-900/50 dark:to-gray-950/80 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium text-gray-800 dark:text-gray-100">Preview do layout completo</p>
          <div className="flex rounded-lg border border-gray-200 dark:border-gray-600 p-0.5 bg-white/80 dark:bg-gray-900/50">
            <button
              type="button"
              onClick={() => setPreviewMode('light')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition ${
                previewMode === 'light'
                  ? 'bg-[#E86A24] text-white'
                  : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              Claro
            </button>
            <button
              type="button"
              onClick={() => setPreviewMode('dark')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition ${
                previewMode === 'dark'
                  ? 'bg-[#E86A24] text-white'
                  : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              Escuro
            </button>
          </div>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Simulação de cabeçalho + cartão + botão com a paleta{' '}
          <strong>{previewMode === 'light' ? 'clara' : 'escura'}</strong> após mesclar overrides.
        </p>
        <CombinedThemePreview palette={combinedPalette} />
      </div>
    </div>
  );
}

/** Barra de paleta + preview simples para cor de marca (primária / secundária). */
export function BrandColorField(props: {
  label: string;
  hint?: string;
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
  previewLabel?: string;
}) {
  const { label, hint, value, placeholder, onChange, previewLabel = 'Botão' } = props;
  const effective = value.trim() || placeholder;
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{label}</label>
      <div className="flex flex-col sm:flex-row gap-3 sm:items-start">
        <div className="flex-1 min-w-0">
          <ColorPaletteBar
            idPrefix={`brand-${label.replace(/\s+/g, '-').toLowerCase()}`}
            value={value}
            fallbackHex={placeholder}
            onChange={onChange}
          />
        </div>
        <div
          className="shrink-0 p-3 rounded-xl border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-900/40 w-full sm:w-40"
        >
          <p className="text-[10px] text-gray-500 dark:text-gray-400 mb-2">Preview</p>
          <button
            type="button"
            className="w-full py-2 rounded-lg text-sm font-medium text-white shadow-sm"
            style={{ backgroundColor: normalizeColorInput(effective) }}
          >
            {previewLabel}
          </button>
        </div>
      </div>
      {hint && <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{hint}</p>}
    </div>
  );
}
