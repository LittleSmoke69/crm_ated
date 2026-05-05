/**
 * Tokens de cor fixos do white label (light / dark).
 * O tenant só sobrescreve valores; chaves e defaults ficam no código.
 */

export const TENANT_THEME_KEYS = [
  'primary',
  'primary_hover',
  'accent',
  'surface',
  'surface_elevated',
  'border',
  'text',
  'text_muted',
] as const;

export type TenantThemeToken = (typeof TENANT_THEME_KEYS)[number];

/** Labels para UI admin (PT-BR) */
export const TENANT_THEME_LABELS: Record<TenantThemeToken, string> = {
  primary: 'Cor primária (marca)',
  primary_hover: 'Primária — hover / ênfase',
  accent: 'Destaque / CTAs secundários',
  surface: 'Fundo principal',
  surface_elevated: 'Painéis / cartões',
  border: 'Bordas e divisores',
  text: 'Texto principal',
  text_muted: 'Texto secundário',
};

export type TenantThemePalette = Record<TenantThemeToken, string>;

export const DEFAULT_TENANT_THEME_LIGHT: TenantThemePalette = {
  primary: '#8CD955',
  primary_hover: '#7BC84A',
  accent: '#8CD955',
  surface: '#ffffff',
  surface_elevated: '#f9fafb',
  border: '#e5e7eb',
  text: '#111827',
  text_muted: '#6b7280',
};

export const DEFAULT_TENANT_THEME_DARK: TenantThemePalette = {
  primary: '#8CD955',
  primary_hover: '#9ae066',
  accent: '#8CD955',
  surface: '#1a1a1a',
  surface_elevated: '#2a2a2a',
  border: '#404040',
  text: '#f3f4f6',
  text_muted: '#9ca3af',
};

/** Overrides persistidos no banco por modo */
export type TenantThemeColorsStored = {
  light?: Partial<TenantThemePalette>;
  dark?: Partial<TenantThemePalette>;
};

const HEX_RE = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;

export function sanitizeHexColor(input: unknown, fallback: string): string {
  if (typeof input !== 'string') return fallback;
  const s = input.trim();
  if (!HEX_RE.test(s)) return fallback;
  if (s.length === 4) {
    const r = s[1];
    const g = s[2];
    const b = s[3];
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return s.toLowerCase();
}

function applyOverrides(
  base: TenantThemePalette,
  overrides?: Partial<TenantThemePalette>
): TenantThemePalette {
  if (!overrides) return base;
  const out = { ...base };
  for (const key of TENANT_THEME_KEYS) {
    const v = overrides[key];
    if (typeof v === 'string' && v.trim()) {
      out[key] = sanitizeHexColor(v, base[key]);
    }
  }
  return out;
}

export function resolveTenantPalettes(input: {
  theme_colors?: TenantThemeColorsStored | null;
  primary_color?: string | null;
  secondary_color?: string | null;
}): { light: TenantThemePalette; dark: TenantThemePalette } {
  const primaryRaw = input.primary_color?.trim() || DEFAULT_TENANT_THEME_LIGHT.primary;
  const secondaryRaw = input.secondary_color?.trim() || null;

  const primary = sanitizeHexColor(primaryRaw, DEFAULT_TENANT_THEME_LIGHT.primary);
  const accentSeed = sanitizeHexColor(
    secondaryRaw ?? primary,
    DEFAULT_TENANT_THEME_LIGHT.accent
  );

  const lightBase: TenantThemePalette = {
    ...DEFAULT_TENANT_THEME_LIGHT,
    primary,
    accent: accentSeed,
  };

  const darkBase: TenantThemePalette = {
    ...DEFAULT_TENANT_THEME_DARK,
    primary,
    accent: accentSeed,
  };

  return {
    light: applyOverrides(lightBase, input.theme_colors?.light),
    dark: applyOverrides(darkBase, input.theme_colors?.dark),
  };
}

/** Converte #RRGGBB em rgba() para opacidades em sombras/ fundos. */
function hexToRgba(hex: string, alpha: number): string {
  const s = hex.replace('#', '').trim();
  if (s.length !== 6) return hex;
  const r = parseInt(s.slice(0, 2), 16);
  const g = parseInt(s.slice(2, 4), 16);
  const b = parseInt(s.slice(4, 6), 16);
  if ([r, g, b].some((n) => Number.isNaN(n))) return hex;
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * Alinha --zaploto-green* (globals) e tokens da Academy ao primary do white label.
 */
function brandGreenCssVars(p: TenantThemePalette): Record<string, string> {
  const { primary, primary_hover, accent } = p;
  return {
    '--zaploto-green': primary,
    '--zaploto-green-hover': primary_hover,
    '--zaploto-green-light': accent,
    '--zaploto-green-dark': primary_hover,
    '--zaploto-green-bg': hexToRgba(primary, 0.08),
    '--zaploto-green-bg-hover': hexToRgba(primary, 0.15),
    '--zaploto-green-border': hexToRgba(primary, 0.25),
    '--zaploto-green-border-hover': hexToRgba(primary, 0.38),
    /* Academy: fundos “matrix” e partículas (mesma família cromática do tenant) */
    '--tenant-academy-accent': primary,
    '--tenant-academy-accent-soft': hexToRgba(primary, 0.45),
    '--tenant-academy-glow': hexToRgba(primary, 0.06),
    '--tenant-academy-grid': hexToRgba(primary, 0.12),
    '--tenant-academy-deep': hexToRgba(primary, 0.35),
  };
}

/** Variáveis CSS consumidas pelo layout */
export function paletteToCssVars(p: TenantThemePalette): Record<string, string> {
  return {
    '--tenant-primary': p.primary,
    '--tenant-primary-hover': p.primary_hover,
    '--tenant-accent': p.accent,
    '--tenant-surface': p.surface,
    '--tenant-surface-elevated': p.surface_elevated,
    '--tenant-border': p.border,
    '--tenant-text': p.text,
    '--tenant-text-muted': p.text_muted,
    ...brandGreenCssVars(p),
  };
}

export function normalizeThemeColorsInput(
  raw: unknown
): TenantThemeColorsStored | null {
  if (raw == null) return null;
  if (typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const lightIn = o.light as Record<string, unknown> | undefined;
  const darkIn = o.dark as Record<string, unknown> | undefined;

  const pick = (
    src: Record<string, unknown> | undefined,
    defaults: TenantThemePalette
  ): Partial<TenantThemePalette> | undefined => {
    if (!src) return undefined;
    const partial: Partial<TenantThemePalette> = {};
    for (const key of TENANT_THEME_KEYS) {
      const v = src[key];
      if (typeof v === 'string' && v.trim()) {
        partial[key] = sanitizeHexColor(v, defaults[key]);
      }
    }
    return Object.keys(partial).length ? partial : undefined;
  };

  const light = pick(lightIn, DEFAULT_TENANT_THEME_LIGHT);
  const dark = pick(darkIn, DEFAULT_TENANT_THEME_DARK);

  if (!light && !dark) return null;
  return { ...(light ? { light } : {}), ...(dark ? { dark } : {}) };
}
