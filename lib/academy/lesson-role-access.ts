/**
 * Visibilidade de aulas da Academy por cargo (`profiles.status`),
 * alinhado aos códigos em `zaploto_roles` (ex.: consultor, gerente).
 */
export const ZAPLOTO_ACADEMY_ROLE_OPTIONS: { code: string; label: string }[] = [
  { code: 'super_admin', label: 'Super Admin' },
  { code: 'admin', label: 'Admin' },
  { code: 'suporte', label: 'Suporte' },
  { code: 'auditoria', label: 'Auditoria' },
  { code: 'dono_banca', label: 'Dono de Banca' },
  { code: 'gestor', label: 'Gestor de Tráfego' },
  { code: 'gerente', label: 'Gerente' },
  { code: 'consultor', label: 'Consultor' },
];

export function isLessonVisibleForProfile(
  allowedRoleCodes: string[] | null | undefined,
  profileStatus: string | null | undefined
): boolean {
  if (allowedRoleCodes == null || allowedRoleCodes.length === 0) return true;
  const s = profileStatus?.trim();
  if (!s) return false;
  return allowedRoleCodes.includes(s);
}

/** Para PATCH/POST admin: undefined = não alterar; null ou [] = todos os cargos. */
export function parseAllowedRoleCodesFromBody(value: unknown): string[] | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!Array.isArray(value)) return undefined;
  const cleaned = value
    .map((x) => (typeof x === 'string' ? x.trim() : ''))
    .filter(Boolean);
  return cleaned.length === 0 ? null : cleaned;
}
