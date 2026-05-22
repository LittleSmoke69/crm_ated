const META_PIXEL_ID_RE = /^\d{5,20}$/;

/** Valida e normaliza ID numérico do Meta Pixel; null limpa o campo. */
export function normalizeMetaPixelId(raw: unknown): { ok: true; value: string | null } | { ok: false; message: string } {
  if (raw === null || raw === undefined || raw === '') {
    return { ok: true, value: null };
  }
  const value = String(raw).trim();
  if (!value) return { ok: true, value: null };
  if (!META_PIXEL_ID_RE.test(value)) {
    return { ok: false, message: 'pixel_id deve conter apenas dígitos (5 a 20 caracteres)' };
  }
  return { ok: true, value };
}
