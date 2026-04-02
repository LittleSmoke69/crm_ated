/**
 * Lista de instâncias Evolution em campanhas activation_mass_send_jobs.
 * `instance_names` (JSONB) tem prioridade; senão usa só `instance_name`.
 */

export function normalizeActivationMassSendInstanceNames(
  instanceNames: unknown,
  fallbackInstanceName: string
): string[] {
  const fromCol = Array.isArray(instanceNames)
    ? instanceNames.map((x) => String(x ?? '').trim()).filter(Boolean)
    : [];
  const unique = [...new Set(fromCol)];
  if (unique.length > 0) return unique;
  const one = String(fallbackInstanceName ?? '').trim();
  return one ? [one] : [];
}

/** Instância usada para o grupo no índice `groupIndexZeroBased` (0 = primeiro grupo). */
export function instanceNameForMassSendGroupIndex(names: string[], groupIndexZeroBased: number): string {
  if (!names.length) return '';
  const n = names.length;
  const i = ((groupIndexZeroBased % n) + n) % n;
  return names[i];
}
