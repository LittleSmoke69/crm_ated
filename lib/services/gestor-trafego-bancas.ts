import { getEffectiveDonoIdForGestorTrafegoViewer } from '@/lib/middleware/gestor-owner';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { getHierarchyPath } from '@/lib/utils/hierarchy';
import { parseCrmBancaIdsFromUserBancasJson } from '@/lib/utils/user-bancas';

export function normalizeGestorTrafegoBancaUrl(url: string | null | undefined): string {
  if (!url) return '';
  let s = String(url).trim();
  s = s.replace(/^https?:\/\//i, '');
  s = s.replace(/\/api\/crm\/?/i, '');
  s = s.replace(/\/+$/, '');
  return s.trim().toLowerCase();
}

export type GestorTrafegoBancaOption = {
  banca_id: string;
  banca_name: string;
  url: string | null;
  dono_id: string | null;
};

async function loadCrmBancaUrlIndex(): Promise<Map<string, string>> {
  const { data: allBancas } = await supabaseServiceRole.from('crm_bancas').select('id, url');
  const byNorm = new Map<string, string>();
  (allBancas || []).forEach((b: { id: string; url?: string | null }) => {
    const n = normalizeGestorTrafegoBancaUrl(b.url);
    if (n) byNorm.set(n, b.id);
  });
  return byNorm;
}

async function loadUrlToDonoIdMap(): Promise<Map<string, string>> {
  const { data: donos } = await supabaseServiceRole
    .from('profiles')
    .select('id, banca_url')
    .eq('status', 'dono_banca');
  const urlToDonoId = new Map<string, string>();
  (donos || []).forEach((d: { id: string; banca_url?: string | null }) => {
    const norm = normalizeGestorTrafegoBancaUrl(d.banca_url);
    if (norm) urlToDonoId.set(norm, d.id);
  });
  return urlToDonoId;
}

/**
 * IDs de crm_bancas que o gestor/gerente pode ver: user_bancas + donos na hierarquia + dono efetivo (enroller).
 */
export async function resolveGestorTrafegoBancaIds(
  profileId: string,
  authUserId?: string
): Promise<string[]> {
  const ids = new Set<string>();
  const uid = (authUserId || profileId).trim();

  let { data: ubRow } = await supabaseServiceRole
    .from('user_bancas')
    .select('banca_ids')
    .eq('user_id', profileId)
    .maybeSingle();
  if (!parseCrmBancaIdsFromUserBancasJson(ubRow?.banca_ids).length && uid !== profileId) {
    const { data: fallback } = await supabaseServiceRole
      .from('user_bancas')
      .select('banca_ids')
      .eq('user_id', uid)
      .maybeSingle();
    ubRow = fallback ?? ubRow;
  }
  for (const id of parseCrmBancaIdsFromUserBancasJson(ubRow?.banca_ids)) {
    ids.add(id);
  }

  const urlIndex = await loadCrmBancaUrlIndex();

  const path = await getHierarchyPath(profileId);
  for (const p of path) {
    const statusNorm = p.status?.trim().toLowerCase();
    if (statusNorm === 'dono_banca' && p.banca_url) {
      const bid = urlIndex.get(normalizeGestorTrafegoBancaUrl(p.banca_url));
      if (bid) ids.add(bid);
    }
  }

  const effectiveDonoId = await getEffectiveDonoIdForGestorTrafegoViewer(profileId);
  if (effectiveDonoId) {
    const { data: dono } = await supabaseServiceRole
      .from('profiles')
      .select('banca_url')
      .eq('id', effectiveDonoId)
      .single();
    if (dono?.banca_url) {
      const bid = urlIndex.get(normalizeGestorTrafegoBancaUrl(dono.banca_url));
      if (bid) ids.add(bid);
    }
  }

  return [...ids];
}

/** Lista bancas formatadas para o seletor do módulo Gestão de Tráfego. */
export async function listGestorTrafegoBancas(
  profileId: string,
  authUserId?: string
): Promise<GestorTrafegoBancaOption[]> {
  const bancaIds = await resolveGestorTrafegoBancaIds(profileId, authUserId);
  if (bancaIds.length === 0) return [];

  const { data: bancas } = await supabaseServiceRole
    .from('crm_bancas')
    .select('id, name, url')
    .in('id', bancaIds);

  if (!bancas?.length) return [];

  const urlToDonoId = await loadUrlToDonoIdMap();

  return bancas
    .map((b: { id: string; name: string | null; url: string | null }) => ({
      banca_id: b.id,
      banca_name: b.name || b.url || b.id,
      url: b.url,
      dono_id: urlToDonoId.get(normalizeGestorTrafegoBancaUrl(b.url)) || null,
    }))
    .sort((a, b) => String(a.banca_name).localeCompare(String(b.banca_name)));
}

/** Gestor/gerente pode acessar integração e dashboard desta banca. */
export async function gestorTrafegoUserCanAccessBanca(
  authUserId: string,
  profile: { id: string; status?: string | null; enroller?: string | null },
  bancaId: string
): Promise<boolean> {
  const statusNorm = profile.status?.trim().toLowerCase();
  if (statusNorm === 'admin' || statusNorm === 'super_admin') return true;

  const allowed = await resolveGestorTrafegoBancaIds(profile.id, authUserId);
  return allowed.includes(bancaId.trim());
}
