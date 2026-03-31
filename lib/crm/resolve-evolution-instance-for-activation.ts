import type { SupabaseClient } from '@supabase/supabase-js';
import { getSubordinates } from '@/lib/middleware/permissions';

/**
 * Mesma regra de GET /api/instances e POST .../activations/schedule:
 * admin/super_admin enxergam qualquer instância; dono_banca e gerente incluem subordinados;
 * demais perfis só instâncias com user_id = actingUserId.
 */
export async function resolveEvolutionInstanceForActivation(
  supabase: SupabaseClient,
  instanceName: string,
  actingUserId: string
): Promise<{ instance: Record<string, unknown> | null; queryError?: string }> {
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('status')
    .eq('id', actingUserId)
    .maybeSingle();

  if (profileError) {
    return { instance: null, queryError: profileError.message };
  }

  const userStatus = profile?.status;
  const isAdmin = userStatus === 'admin' || userStatus === 'super_admin';
  let allowedUserIds: string[] = [actingUserId];
  if (userStatus === 'dono_banca' || userStatus === 'gerente') {
    const subordinates = await getSubordinates(actingUserId);
    allowedUserIds = [actingUserId, ...subordinates.map((s) => s.id)];
  }

  let q = supabase
    .from('evolution_instances')
    .select(
      `
        *,
        evolution_apis!inner (
          id,
          base_url,
          is_active
        )
      `
    )
    .eq('instance_name', instanceName)
    .eq('is_active', true);

  if (!isAdmin) {
    q = q.in('user_id', allowedUserIds);
  }

  const { data: instance, error: instanceError } = await q.maybeSingle();

  if (instanceError) {
    return { instance: null, queryError: instanceError.message };
  }

  return { instance: (instance as Record<string, unknown>) ?? null };
}
