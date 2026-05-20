import { getUserProfile } from '@/lib/middleware/permissions';
import { getHierarchyPath } from '@/lib/utils/hierarchy';

/**
 * Para usuários com status 'gestor', retorna o ID do dono de banca na hierarquia:
 * enroller direto dono_banca ou primeiro dono_banca no caminho até a raiz.
 */
export async function getEffectiveDonoIdForGestor(gestorUserId: string): Promise<string | null> {
  const profile = await getUserProfile(gestorUserId);
  const statusNorm = profile?.status?.trim().toLowerCase();
  if (!profile || statusNorm !== 'gestor') {
    return null;
  }
  if (profile.enroller) {
    const enrollerProfile = await getUserProfile(profile.enroller);
    const enrollerStatusNorm = enrollerProfile?.status?.trim().toLowerCase();
    if (enrollerProfile && enrollerStatusNorm === 'dono_banca') {
      return enrollerProfile.id;
    }
  }
  const path = await getHierarchyPath(profile.id);
  const donoInPath = path.find((p) => p.status?.trim().toLowerCase() === 'dono_banca');
  return donoInPath?.id ?? null;
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
