import { NextRequest } from 'next/server';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { getUserProfile, getSubordinates } from '@/lib/middleware/permissions';
import { getEffectiveZaplotoId } from '@/lib/tenant-context';

/**
 * Verifica se o usuário pode acessar uma instância (mesmo white label + regras de hierarquia).
 */
export async function checkInstanceAccess(
  req: NextRequest,
  userId: string,
  instanceName: string
): Promise<boolean> {
  try {
    const profile = await getUserProfile(userId);
    if (!profile?.status) return false;

    const effectiveZaplotoId = await getEffectiveZaplotoId(req, profile);

    const { data: instance, error: instanceError } = await supabaseServiceRole
      .from('evolution_instances')
      .select('id, user_id, zaploto_id')
      .eq('instance_name', instanceName)
      .eq('is_active', true)
      .maybeSingle();

    if (instanceError || !instance) return false;

    const instanceId = (instance as { id: string }).id;
    const instZap = (instance as { zaploto_id?: string | null }).zaploto_id;
    const DEFAULT_ZAPLOTO = '00000000-0000-0000-0000-000000000001';
    if (!instZap) {
      if (effectiveZaplotoId !== DEFAULT_ZAPLOTO) return false;
    } else if (instZap !== effectiveZaplotoId) {
      return false;
    }

    const ownerId = String((instance as { user_id?: string | null }).user_id ?? '');
    const s = profile.status;

    if (s === 'super_admin' || s === 'admin' || s === 'auditoria') {
      return true;
    }

    if (s === 'dono_banca' || s === 'gerente') {
      const subordinates = await getSubordinates(userId);
      const allowed = new Set([userId, ...subordinates.map((u) => u.id)]);
      if (allowed.has(ownerId)) return true;
    }

    const { data: shareRow } = await supabaseServiceRole
      .from('evolution_instance_shared_users')
      .select('id')
      .eq('evolution_instance_id', instanceId)
      .eq('user_id', userId)
      .maybeSingle();

    if (shareRow) return true;

    return ownerId === userId;
  } catch {
    return false;
  }
}
