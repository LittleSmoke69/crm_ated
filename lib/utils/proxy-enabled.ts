/**
 * Interpreta o campo `enabled` de proxy_instances (boolean, string, null legado).
 */
export function isProxyEnabled(value: unknown): boolean {
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  // Registros antigos sem coluna preenchida: considerar ativo
  return true;
}

export type ProxyListItem = {
  id: string;
  name: string | null;
  host: string;
  port: string;
  username: string;
  password: string;
  protocol: string;
  enabled: boolean;
  user_count?: number;
};

/** Normaliza resposta GET /api/admin/proxy para lista com `id` string. */
export function parseProxyListResponse(json: unknown): ProxyListItem[] {
  const payload = json as { data?: unknown } | unknown[] | null;
  const raw = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { data?: unknown })?.data)
      ? (payload as { data: unknown[] }).data
      : [];

  const items: ProxyListItem[] = [];
  for (const row of raw) {
    const r = row as Record<string, unknown>;
    const id = r.id ?? r.proxy_id;
    if (id == null || String(id).trim() === '') continue;
    items.push({
      id: String(id).trim(),
      name: r.name != null ? String(r.name) : null,
      host: String(r.host ?? ''),
      port: String(r.port ?? ''),
      username: String(r.username ?? ''),
      password: String(r.password ?? ''),
      protocol: String(r.protocol ?? ''),
      enabled: isProxyEnabled(r.enabled),
      user_count: typeof r.user_count === 'number' ? r.user_count : undefined,
    });
  }
  return items;
}

export function findProxyById(
  list: ProxyListItem[],
  proxyId: string
): ProxyListItem | undefined {
  const needle = String(proxyId).trim();
  if (!needle) return undefined;
  return list.find((p) => String(p.id).trim() === needle);
}
