import { decodeRedirectSlug } from '@/lib/redirect/decode-slug';

/** Normaliza entradas como "slug", "/r/slug", "https://dominio/r/slug?..." para apenas "slug". */
export function normalizeRedirectSlug(raw: string | null | undefined): string {
  const input = decodeRedirectSlug(String(raw ?? ''));
  if (!input) return '';

  // Caso venha URL completa
  if (/^https?:\/\//i.test(input)) {
    try {
      const u = new URL(input);
      const path = decodeRedirectSlug(u.pathname).replace(/^\/+/, '');
      if (path.toLowerCase().startsWith('r/')) {
        return path.slice(2).replace(/^\/+/, '').split('/')[0]?.trim() ?? '';
      }
      return path.split('/')[0]?.trim() ?? '';
    } catch {
      // Se não parsear, cai para o fluxo abaixo.
    }
  }

  const withoutQuery = input.split('?')[0];
  const path = withoutQuery.replace(/^\/+/, '');
  if (path.toLowerCase().startsWith('r/')) {
    return path.slice(2).replace(/^\/+/, '').split('/')[0]?.trim() ?? '';
  }
  return path.split('/')[0]?.trim() ?? '';
}

/** Monta URL final do redirect VSL preservando UTM/fbclid da URL atual + sid. */
export function buildVslRedirectHref(
  rawRedirectSlug: string | null | undefined,
  sessionId: string | null
): string | null {
  const slug = normalizeRedirectSlug(rawRedirectSlug);
  if (!slug) return null;

  const params = new URLSearchParams(
    typeof window !== 'undefined' ? window.location.search : ''
  );
  const out = new URLSearchParams();
  const passthrough = [
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_content',
    'utm_term',
    'fbclid',
    'gclid',
    'fbc',
    'fbp',
  ];
  for (const key of passthrough) {
    const val = params.get(key);
    if (val) out.set(key, val);
  }
  if (sessionId) out.set('sid', sessionId);

  const qs = out.toString();
  return `/r/${encodeURIComponent(slug)}${qs ? `?${qs}` : ''}`;
}
