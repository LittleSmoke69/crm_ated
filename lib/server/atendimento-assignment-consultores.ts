import { canAccessUser } from '@/lib/middleware/permissions';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { consultorHasCrmBanca } from '@/lib/utils/user-bancas';

export type ValidateConsultoresResult =
  | { ok: true }
  | { ok: false; message: string; status: number };

/**
 * Valida cada ID: hierarquia do gerente, status consultor, e banca CRM quando informada.
 */
export async function validateConsultorIdsForAtendimentoAssignment(
  gerenteOwnerId: string,
  consultorIds: string[],
  crmBancaId: string | null
): Promise<ValidateConsultoresResult> {
  for (const consultor_user_id of consultorIds) {
    const allowed = await canAccessUser(gerenteOwnerId, consultor_user_id);
    if (!allowed) {
      return {
        ok: false,
        message: 'Consultor não pertence à hierarquia do gerente responsável.',
        status: 403,
      };
    }
    const { data: consultorProfile } = await supabaseServiceRole
      .from('profiles')
      .select('status')
      .eq('id', consultor_user_id)
      .single();
    if ((consultorProfile?.status || '').toLowerCase() !== 'captador') {
      return { ok: false, message: 'Um dos usuários informados não é consultor.', status: 400 };
    }
    if (crmBancaId) {
      const inBanca = await consultorHasCrmBanca(consultor_user_id, crmBancaId);
      if (!inBanca) {
        return { ok: false, message: 'Consultor não está vinculado a esta banca.', status: 400 };
      }
    }
  }
  return { ok: true };
}
