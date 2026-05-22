/** Decodifica slug da URL (pode vir codificado uma ou mais vezes). */
export function decodeRedirectSlug(raw: string): string {
  if (!raw) return '';
  let s = raw;
  try {
    for (let i = 0; i < 3; i++) {
      const next = decodeURIComponent(s);
      if (next === s) break;
      s = next;
    }
  } catch {
    // mantém original
  }
  return s.trim();
}
