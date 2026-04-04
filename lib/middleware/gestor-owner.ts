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
  const enrollerStatusNorm = enrollerProfile?.status?.trim().toLowerCase();
  if (!enrollerProfile || enrollerStatusNorm !== 'dono_banca') {
    return null;
  }
  return enrollerProfile.id;
}

/**
 * Dono de banca para Gestão de Tráfego: gestor (enroller dono) ou gerente com enroller dono de banca.
 */
export async function getEffectiveDonoIdForGestorTrafegoViewer(userId: string): Promise<string | null> {
  const fromGestor = await getEffectiveDonoIdForGestor(userId);
  if (fromGestor) return fromGestor;
  const profile = await getUserProfile(userId);
  if (!profile?.enroller) return null;
  if (profile.status?.trim().toLowerCase() !== 'gerente') return null;
  const enc = await getUserProfile(profile.enroller);
  if (enc?.status?.trim().toLowerCase() !== 'dono_banca' || !enc.id) return null;
  return enc.id;
}

/**
 * Dono efetivo nas APIs do módulo: admin/super só header; gestor/gerente resolvem hierarquia e caem no header (ex.: várias bancas em user_bancas).
 */
export async function resolveGestorTrafegoEffectiveDonoId(
  effectiveDonoHeader: string | null | undefined,
  userId: string | null | undefined,
  statusNorm: string | null | undefined
): Promise<string | null> {
  const header = effectiveDonoHeader?.trim() || null;
  const uid = userId?.trim();
  if (!uid) return header;
  const sn = String(statusNorm || '').trim().toLowerCase();
  if (sn === 'admin' || sn === 'super_admin') {
    return header;
  }
  if (sn === 'gestor' || sn === 'gerente') {
    const fromProfile = await getEffectiveDonoIdForGestorTrafegoViewer(uid);
    return fromProfile ?? header;
  }
  return header;
}
