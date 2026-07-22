const URL_PATTERN = /\bhttps?:\/\/[^\s"'<>]+/gi;
const STORAGE_REFERENCE_PATTERN = /\bstorage:\/\/[^\s"'<>]+/gi;

function getSupabaseHost(): string | null {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    return url ? new URL(url).host : null;
  } catch {
    return null;
  }
}

/**
 * Remove endereços internos/públicos de mídia de mensagens que podem chegar ao cliente.
 */
export function sanitizeMediaError(
  error: unknown,
  fallback = 'Não foi possível processar a mídia.'
): string {
  const raw = error instanceof Error ? error.message : String(error || '');
  let sanitized = raw
    .replace(URL_PATTERN, '[endereço protegido]')
    .replace(STORAGE_REFERENCE_PATTERN, '[endereço protegido]');

  const supabaseHost = getSupabaseHost();
  if (supabaseHost) {
    sanitized = sanitized.replace(
      new RegExp(`${supabaseHost.replace(/\./g, '\\.')}[^\\s"'<>]*`, 'gi'),
      '[Storage protegido]'
    );
  }

  sanitized = sanitized.trim();
  return sanitized || fallback;
}
