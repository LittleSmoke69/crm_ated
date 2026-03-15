import { getUserProfile } from '@/lib/middleware/permissions';

/**
 * Para usuários com status 'gestor', retorna o ID do dono de banca (enroller)
 * cujos dados o gestor pode visualizar. Retorna null se o usuário não for gestor
 * ou se o enroller não for dono_banca.
 */
export async function getEffectiveDonoIdForGestor(gestorUserId: string): Promise<string | null> {
  const profile = await getUserProfile(gestorUserId);
  const statusNorm = profile?.status?.trim().toLowerCase();
  if (!profile || statusNorm !== 'gestor' || !profile.enroller) {
    return null;
  }
  const enrollerProfile = await getUserProfile(profile.enroller);
  if (!enrollerProfile || enrollerProfile.status !== 'dono_banca') {
    return null;
  }
  return enrollerProfile.id;
}
