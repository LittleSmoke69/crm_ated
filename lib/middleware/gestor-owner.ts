import { NextRequest } from 'next/server';
import { getUserProfile } from '@/lib/middleware/permissions';
import { normalizeGestorTrafegoBancaUrl } from '@/lib/services/gestor-trafego-bancas';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { getHierarchyPath } from '@/lib/utils/hierarchy';

function stripGestorEffectiveDonoPrefix(value: string | null | undefined): string | null {
  const v = value?.trim();
  if (!v) return null;
  if (v.startsWith('dono:')) return v.slice(5).trim() || null;
  if (v.startsWith('banca:')) return null;
  return v;
}

/** Resolve dono_banca a partir do id de crm_bancas (match por URL normalizada). */
export async function resolveDonoIdFromCrmBancaId(bancaId: string): Promise<string | null> {
  const id = bancaId?.trim();
  if (!id) return null;

  const { data: banca } = await supabaseServiceRole
    .from('crm_bancas')
    .select('url')
    .eq('id', id)
    .maybeSingle();
  if (!banca?.url) return null;

  const norm = normalizeGestorTrafegoBancaUrl(banca.url);
  const { data: donos } = await supabaseServiceRole
    .from('profiles')
    .select('id, banca_url')
    .eq('status', 'dono_banca');

  const found = (donos || []).find(
    (d: { id: string; banca_url?: string | null }) =>
      normalizeGestorTrafegoBancaUrl(d.banca_url) === norm
  );
  return found?.id ?? null;
}

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
  const header = stripGestorEffectiveDonoPrefix(effectiveDonoHeader);
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

/**
 * Dono efetivo a partir dos headers X-Effective-Dono-Id / X-Effective-Banca-Id.
 * Admin/super_admin: exige header; banca_id é convertido em dono quando possível.
 */
export async function resolveGestorTrafegoOwnerIdFromRequest(
  req: NextRequest,
  userId: string,
  statusNorm: string | null | undefined
): Promise<string | null> {
  const bancaHeader = (
    req.headers.get('X-Effective-Banca-Id') ?? req.headers.get('x-effective-banca-id')
  )?.trim();
  const donoHeader = stripGestorEffectiveDonoPrefix(
    req.headers.get('X-Effective-Dono-Id') ?? req.headers.get('x-effective-dono-id')
  );

  const sn = String(statusNorm || '').trim().toLowerCase();

  if (bancaHeader) {
    const fromBanca = await resolveDonoIdFromCrmBancaId(bancaHeader);
    if (fromBanca) return fromBanca;
  }

  if (sn === 'admin' || sn === 'super_admin') {
    return donoHeader;
  }

  if (sn === 'gestor' || sn === 'gerente') {
    const fromProfile = await getEffectiveDonoIdForGestorTrafegoViewer(userId);
    return fromProfile ?? donoHeader;
  }

  return donoHeader;
}
