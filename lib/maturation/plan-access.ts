/**
 * Regras de quem pode usar qualquer plano de maturação (iniciar job, UI como dono).
 * Super_admin e admin veem/editam/iniciam todos os planos; demais usuários só os próprios.
 */
export function canUseAnyMaturationPlan(status: string | null | undefined): boolean {
  return status === 'super_admin' || status === 'admin';
}
