/**
 * Coluna "Gestor" nas métricas Meta no CRM: perfil em função de gestor de tráfego **vinculado à banca**
 * via `user_bancas` (igual ao GET `crm/bancas?with_users=1`). Sem depender de redirect/VSL.
 *
 * Prioridade quando há mais de um vínculo na mesma banca: `gestor` → `super_admin` → `admin`
 * (alinhado às seções da hierarquia). Devolve no máximo um nome/id por `crm_bancas.id`.
 */

import { supabaseServiceRole } from '@/lib/services/supabase-service';

export type GestorDisplayForCampaign = { gestor_names: string[]; gestor_user_ids: string[] };

function gestorCargoTier(status: string | null | undefined): number | null {
  const s = String(status ?? '').trim().toLowerCase();
  if (s === 'gestor') return 0;
  if (s === 'super_admin') return 1;
  if (s === 'admin') return 2;
  return null;
}

function profileLabel(p: { full_name?: string | null; email?: string | null }): string {
  return String(p.full_name || p.email || '').trim();
}

/**
 * Para cada `crm_bancas.id`, até um nome (`full_name` ou `email`) e um `profiles.id` do gestor de tráfego
 * vinculado à banca em `user_bancas`.
 */
export async function resolvePrimaryGestorDisplayByCrmBancaIds(
  bancaIds: string[]
): Promise<Map<string, GestorDisplayForCampaign>> {
  const ids = Array.from(new Set(bancaIds.map((s) => String(s ?? '').trim()).filter(Boolean)));
  const out = new Map<string, GestorDisplayForCampaign>();
  for (const id of ids) out.set(id, { gestor_names: [], gestor_user_ids: [] });
  if (ids.length === 0) return out;

  const idSet = new Set(ids);

  const { data: userBancasRows, error: ubErr } = await supabaseServiceRole
    .from('user_bancas')
    .select('user_id, banca_ids');
  if (ubErr) throw new Error(ubErr.message);

  const userIdsByBanca = new Map<string, string[]>();
  for (const row of userBancasRows ?? []) {
    const userId = String((row as { user_id?: string | null }).user_id ?? '').trim();
    if (!userId) continue;
    const bancaIdsRow = Array.isArray((row as { banca_ids?: unknown }).banca_ids)
      ? ((row as { banca_ids: unknown[] }).banca_ids ?? []).map((x) => String(x ?? '').trim()).filter(Boolean)
      : [];
    for (const bid of bancaIdsRow) {
      if (!idSet.has(bid)) continue;
      const cur = userIdsByBanca.get(bid) ?? [];
      if (!cur.includes(userId)) cur.push(userId);
      userIdsByBanca.set(bid, cur);
    }
  }

  const allLinkedUserIds = Array.from(new Set(Array.from(userIdsByBanca.values()).flat()));
  if (allLinkedUserIds.length === 0) return out;

  type Prof = { id: string; full_name: string | null; email: string | null; status: string | null };
  const profileById = new Map<string, Prof>();
  const CHUNK = 120;
  for (let i = 0; i < allLinkedUserIds.length; i += CHUNK) {
    const slice = allLinkedUserIds.slice(i, i + CHUNK);
    const { data: profs, error: profErr } = await supabaseServiceRole
      .from('profiles')
      .select('id, full_name, email, status')
      .in('id', slice);
    if (profErr) throw new Error(profErr.message);
    for (const pr of profs ?? []) {
      const id = String((pr as Prof).id ?? '').trim();
      if (!id) continue;
      profileById.set(id, pr as Prof);
    }
  }

  for (const bid of ids) {
    const linkedIds = userIdsByBanca.get(bid) ?? [];
    const candidates: Prof[] = [];
    for (const uid of linkedIds) {
      const p = profileById.get(uid);
      if (!p || gestorCargoTier(p.status) === null) continue;
      candidates.push(p);
    }
    if (candidates.length === 0) continue;

    candidates.sort((a, b) => {
      const ta = gestorCargoTier(a.status) ?? 99;
      const tb = gestorCargoTier(b.status) ?? 99;
      if (ta !== tb) return ta - tb;
      const la = profileLabel(a).toLowerCase();
      const lb = profileLabel(b).toLowerCase();
      if (la !== lb) return la.localeCompare(lb, 'pt-BR');
      return String(a.id).localeCompare(String(b.id));
    });

    const primary = candidates[0];
    const label = profileLabel(primary);
    out.set(bid, {
      gestor_names: label ? [label] : [],
      gestor_user_ids: primary.id ? [primary.id] : [],
    });
  }

  return out;
}
