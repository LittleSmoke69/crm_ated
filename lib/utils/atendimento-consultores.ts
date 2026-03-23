/**
 * Parse do PATCH/POST quando o cliente envia alteração de consultores (array e/ou campo legado único).
 */
export function parseConsultorUserIdsPatch(body: {
  consultor_user_ids?: unknown;
  consultor_user_id?: unknown;
}): string[] {
  if ('consultor_user_ids' in body) {
    const v = body.consultor_user_ids;
    if (v === null || !Array.isArray(v)) return [];
    return [...new Set(v.map((x) => String(x).trim()).filter(Boolean))];
  }
  if ('consultor_user_id' in body) {
    const single = body.consultor_user_id;
    if (single === null || single === undefined || single === '') return [];
    return [String(single).trim()];
  }
  return [];
}

/** Criação: se não enviar campos de consultor, assume lista vazia. */
export function parseConsultorUserIdsForCreate(body: {
  consultor_user_ids?: unknown;
  consultor_user_id?: unknown;
}): string[] {
  if (!('consultor_user_ids' in body) && !('consultor_user_id' in body)) {
    return [];
  }
  return parseConsultorUserIdsPatch(body);
}

/** UUID[] do Postgres via Supabase pode vir como string[] */
export function normalizeConsultorUserIdsColumn(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return [...new Set(raw.map((x) => String(x).trim()).filter(Boolean))];
  }
  return [];
}
