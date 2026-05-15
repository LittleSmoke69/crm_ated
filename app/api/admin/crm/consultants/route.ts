import { NextRequest } from 'next/server';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { requireAdminLeadTransferContext } from '@/lib/server/crm/adminLeadTransferContext';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

const LOG_PREFIX = '[lead-transfer][consultants]';

function bancaIdInJsonbArray(bancaIds: unknown, bancaIdNorm: string): boolean {
  if (!Array.isArray(bancaIds)) return false;
  return (bancaIds as string[]).some((id) => String(id ?? '').trim().toLowerCase() === bancaIdNorm);
}

/** IDs de usuários com esta banca em user_bancas.banca_ids (JSONB array de UUIDs como string). */
async function getUserIdsOnBanca(bancaId: string): Promise<string[]> {
  const raw = bancaId.trim();
  const norm = raw.toLowerCase();
  if (!raw) return [];

  /**
   * Não usar `.contains('banca_ids', [id])`: o postgrest-js trata array como tipo Postgres array e gera
   * `cs.{uuid}` (sem aspas) → Postgres responde "invalid input syntax for type json" em coluna jsonb.
   * Usar operador PostgREST `cs` (@>) com JSON array válido: `["uuid"]`.
   */
  const tryUserBancasCs = (id: string) =>
    supabaseServiceRole.from('user_bancas').select('user_id').filter('banca_ids', 'cs', JSON.stringify([id]));

  let rows: { user_id: string }[] = [];
  for (const id of [...new Set([raw, norm, raw.toUpperCase()])].filter(Boolean)) {
    const q1 = await tryUserBancasCs(id);
    if (!q1.error && (q1.data?.length ?? 0) > 0) {
      rows = (q1.data ?? []) as { user_id: string }[];
      break;
    }
    if (q1.error) {
      console.warn(`${LOG_PREFIX} user_bancas jsonb @> (${id.slice(0, 8)}…):`, q1.error.message);
    }
  }
  if (rows.length === 0) {
    const all = await supabaseServiceRole.from('user_bancas').select('user_id, banca_ids');
    if (all.error) {
      console.error(`${LOG_PREFIX} user_bancas (full):`, all.error.message);
      return [];
    }
    rows = (all.data ?? [])
      .filter((r: { banca_ids?: unknown }) => bancaIdInJsonbArray(r.banca_ids, norm))
      .map((r: { user_id: string }) => ({ user_id: r.user_id }));
  }
  const uniq = [...new Set(rows.map((r) => r.user_id).filter(Boolean))];
  console.log(`${LOG_PREFIX} getUserIdsOnBanca(${bancaId}): ${uniq.length} usuário(s)`);
  return uniq;
}

/** Escapa % e _ para ILIKE exato (sem curingas). */
function escapeIlikeExact(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

type ConsultantRow = {
  id: string;
  email: string;
  full_name: string;
  role: string;
  gerente_nome?: string;
  consultores_vinculados?: { id: string; full_name: string; email: string }[];
};

/**
 * Inclui titulares do lote (e-mails dos logs) que existem em profiles e têm conta no CRM desta banca (200).
 * Usado pelo modal «Mover leads» quando a hierarquia user_bancas/enroller não lista quem já é titular no CRM.
 */
async function mergeTitularesFromEmails(
  ctx: { crmBaseUrl: string; bancaId: string },
  consultants: ConsultantRow[],
  titularEmails: string[]
): Promise<ConsultantRow[]> {
  const seen = new Set(consultants.map((c) => (c.email ?? '').trim().toLowerCase()).filter(Boolean));
  const candidates = [...new Set(titularEmails.map((e) => e.trim()).filter(Boolean))].slice(0, 40).filter((e) => !seen.has(e.toLowerCase()));
  if (candidates.length === 0) return consultants;

  const apiKey = process.env.CRM_API_KEY?.trim();
  const roleLabel = (s: string | null | undefined) => {
    const v = String(s ?? '').toLowerCase();
    if (v === 'gerente') return 'Gerente';
    if (v === 'consultor') return 'Consultor';
    if (v === 'dono_banca') return 'Dono Banca';
    if (v === 'admin' || v === 'super_admin') return 'Admin';
    if (v === 'gestor') return 'Gestor';
    if (v === 'auditoria') return 'Auditoria';
    return v || 'Consultor';
  };

  type ProfTitularRow = { id: string; email: string | null; full_name: string | null; status: string | null };

  const extra: ConsultantRow[] = [];
  for (const email of candidates) {
    let prof: ProfTitularRow | null = null;
    const { data: byEq } = await supabaseServiceRole
      .from('profiles')
      .select('id, email, full_name, status')
      .eq('email', email)
      .maybeSingle();
    if (byEq && (byEq as ProfTitularRow).email?.trim()) prof = byEq as ProfTitularRow;
    if (!prof?.email?.trim()) {
      const { data: byIlike } = await supabaseServiceRole
        .from('profiles')
        .select('id, email, full_name, status')
        .ilike('email', escapeIlikeExact(email))
        .maybeSingle();
      if (byIlike && (byIlike as ProfTitularRow).email?.trim()) prof = byIlike as ProfTitularRow;
    }
    if (!prof?.email) {
      console.log(`${LOG_PREFIX} titular_email sem perfil no Zaploto: ${email.slice(0, 3)}…`);
      continue;
    }
    const em = (prof.email ?? '').trim();
    if (seen.has(em.toLowerCase())) continue;

    if (ctx.crmBaseUrl && apiKey) {
      const ok = await consultantHasAccountInBanca(ctx.crmBaseUrl, em, apiKey);
      if (!ok) {
        console.log(`${LOG_PREFIX} titular_email CRM≠200 (ignorado): ${em.slice(0, 3)}…`);
        continue;
      }
    } else if (ctx.crmBaseUrl) {
      console.warn(`${LOG_PREFIX} titular_email sem CRM_API_KEY; incluindo perfil só por match de e-mail: ${em.slice(0, 3)}…`);
    }

    seen.add(em.toLowerCase());
    extra.push({
      id: prof.id,
      email: em,
      full_name: ((prof.full_name ?? em).trim() || em),
      role: roleLabel(prof.status),
    });
  }

  if (extra.length === 0) return consultants;
  console.log(`${LOG_PREFIX} mergeTitularesFromEmails: +${extra.length} consultor(es) pelos e-mails dos logs`);
  return [...consultants, ...extra].sort((a, b) => {
    const na = (a.full_name ?? a.email).toLowerCase();
    const nb = (b.full_name ?? b.email).toLowerCase();
    return na.localeCompare(nb, 'pt-BR');
  });
}

function normalizeBancaUrl(raw: string): string {
  let u = raw.trim();
  u = u.replace(/^https?:\/\//i, '').replace(/\/api\/crm\/?/i, '').replace(/\/+$/, '').trim();
  if (!u) return '';
  return u.startsWith('http') ? u : `https://${u}`;
}

/** Verifica no CRM (total-indicateds-by-consultant) se o consultor tem conta na banca. 200 = sim, 404 = não. */
async function consultantHasAccountInBanca(crmBaseUrl: string, email: string, apiKey: string): Promise<boolean> {
  const base = normalizeBancaUrl(crmBaseUrl);
  if (!base || !email) return false;
  const url = `${base}/api/crm/total-indicateds-by-consultant?consultant=${encodeURIComponent(email)}`;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json', 'x-api-key': apiKey },
      signal: AbortSignal.timeout(12000),
    });
    return res.status === 200;
  } catch {
    return false;
  }
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

/**
 * GET /api/admin/crm/consultants
 * Lista consultores da hierarquia da banca: user_bancas + (com hierarchy_only=0) perfis com enroller em qualquer membro da banca.
 * Query: banca_id (obrigatório), hierarchy_only=0 — inclui subordinados (enroller na equipe da banca) mesmo sem linha em user_bancas; hierarchy_only=1 (padrão) — só usuários com user_bancas nesta banca. verify_crm=1 (opcional) — se verify_crm=1, filtra apenas consultores que têm conta na banca (CRM total-indicateds-by-consultant 200).
 * all_profiles_for_donor=1 — lista todos os perfis com e-mail (modal consultor doador na aprovação de solicitação); banca_id só valida permissão do admin.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const bancaId = searchParams.get('banca_id')?.trim();

    console.log(`${LOG_PREFIX} GET request: banca_id=${bancaId ?? 'null'}`);

    if (!bancaId) {
      return errorResponse('banca_id é obrigatório.', 400);
    }

    const ctx = await requireAdminLeadTransferContext(req, bancaId);
    console.log(`${LOG_PREFIX} GET context: userId=${ctx.userId}, bancaId=${ctx.bancaId}, crmBaseUrl=${ctx.crmBaseUrl}, bancaName=${ctx.bancaName ?? 'n/a'}`);

    if (searchParams.get('all_profiles_for_donor') === '1') {
      const { data: allProfiles, error: allErr } = await supabaseServiceRole
        .from('profiles')
        .select('id, email, full_name')
        .not('email', 'is', null)
        .order('full_name', { ascending: true, nullsFirst: false })
        .limit(15000);
      if (allErr) {
        console.error(`${LOG_PREFIX} GET all_profiles_for_donor error:`, allErr);
        return errorResponse('Erro ao listar usuários.', 500);
      }
      const consultants = (allProfiles ?? [])
        .map((p: { id: string; email: string | null; full_name: string | null }) => {
          const email = (p.email ?? '').trim();
          if (!email) return null;
          return {
            id: p.id,
            email,
            full_name: ((p.full_name ?? p.email ?? '').trim() || email),
          };
        })
        .filter(Boolean);
      console.log(`${LOG_PREFIX} GET all_profiles_for_donor: ${consultants.length} usuário(s)`);
      return successResponse({ consultants });
    }

    const userIds = await getUserIdsOnBanca(ctx.bancaId);
    console.log(`${LOG_PREFIX} GET user_bancas (resolved): unique userIds=${userIds.length}`);
    if (userIds.length === 0) {
      console.log(`${LOG_PREFIX} GET success: 0 consultants (no users in banca)`);
      return successResponse({ consultants: [] });
    }

    const { data: profiles, error: pError } = await supabaseServiceRole
      .from('profiles')
      .select('id, email, full_name, status, enroller')
      .in('id', userIds)
      .not('email', 'is', null)
      .order('full_name', { ascending: true, nullsFirst: false });

    if (pError) {
      console.error(`${LOG_PREFIX} GET profiles error:`, pError);
      return errorResponse('Erro ao buscar perfis.', 500);
    }

    const list = Array.isArray(profiles) ? profiles : [];
    const hierarchyOnly = searchParams.get('hierarchy_only') !== '0';
    const gerenteIdsFromList = list
      .filter((p: { status?: string | null }) => String(p.status ?? '').toLowerCase() === 'gerente')
      .map((p: { id: string }) => p.id);
    /** Com hierarchy_only=0: qualquer perfil com enroller ∈ equipe da banca entra; com 1: só subordinados de gerentes na lista. */
    const enrollerIdsForSubs = hierarchyOnly ? gerenteIdsFromList : [...new Set(userIds)];

    const enrollerIds = [
      ...new Set([
        ...list.map((p: { enroller?: string | null }) => p.enroller).filter(Boolean),
        ...enrollerIdsForSubs,
      ]),
    ] as string[];
    const enrollerNames = new Map<string, string>();
    if (enrollerIds.length > 0) {
      const { data: enrollers } = await supabaseServiceRole
        .from('profiles')
        .select('id, full_name, email')
        .in('id', enrollerIds);
      (enrollers ?? []).forEach((e: { id: string; full_name: string | null; email: string | null }) => {
        const name = (e.full_name ?? e.email ?? '').trim() || (e.email ?? '') || '-';
        enrollerNames.set(e.id, name);
      });
    }

    const consultoresPorGerente = new Map<string, { id: string; full_name: string; email: string }[]>();
    if (enrollerIdsForSubs.length > 0) {
      const { data: subordinados } = await supabaseServiceRole
        .from('profiles')
        .select('id, email, full_name, enroller')
        .in('enroller', enrollerIdsForSubs)
        .not('email', 'is', null);
      const subordinadoIds = (subordinados ?? []).map((s: { id: string }) => s.id);
      let idsPermitidos = new Set(subordinadoIds);
      if (hierarchyOnly && subordinadoIds.length > 0) {
        const idsNaBanca = new Set(userIds);
        idsPermitidos = new Set(subordinadoIds.filter((id: string) => idsNaBanca.has(id)));
      }
      (subordinados ?? []).forEach((s: { id: string; email: string | null; full_name: string | null; enroller: string | null }) => {
        if (!idsPermitidos.has(s.id)) return;
        const gerenteId = (s.enroller ?? '').trim();
        if (!gerenteId) return;
        const arr = consultoresPorGerente.get(gerenteId) ?? [];
        arr.push({
          id: s.id,
          full_name: (s.full_name ?? s.email ?? '').trim() || (s.email ?? ''),
          email: (s.email ?? '').trim(),
        });
        consultoresPorGerente.set(gerenteId, arr);
      });
    }

    const roleLabel = (s: string | null | undefined) => {
      const v = String(s ?? '').toLowerCase();
      if (v === 'gerente') return 'Gerente';
      if (v === 'consultor') return 'Consultor';
      if (v === 'dono_banca') return 'Dono Banca';
      if (v === 'admin' || v === 'super_admin') return 'Admin';
      if (v === 'gestor') return 'Gestor';
      if (v === 'auditoria') return 'Auditoria';
      return v || '-';
    };

    const consultantsFromList = list
      .map((p: { id: string; email: string | null; full_name: string | null; status?: string | null; enroller?: string | null }) => {
        const email = (p.email ?? '').trim();
        if (!email) return null;
        const full_name = (p.full_name ?? p.email ?? '').trim() || (p.email ?? '');
        const gerente_nome = p.enroller ? enrollerNames.get(p.enroller) ?? null : null;
        const consultores_vinculados = consultoresPorGerente.get(p.id) ?? [];
        return {
          id: p.id,
          email,
          full_name,
          role: roleLabel(p.status),
          gerente_nome: gerente_nome ?? undefined,
          consultores_vinculados,
        };
      })
      .filter(Boolean);

    const idsInList = new Set((consultantsFromList as { id: string }[]).map((c) => c.id));
    const consultantsDosGerentes: { id: string; email: string; full_name: string; role: string; gerente_nome: string }[] = [];
    for (const enrollerId of enrollerIdsForSubs) {
      const gerenteProfile = list.find((p: { id: string }) => p.id === enrollerId);
      const gerenteNome = gerenteProfile
        ? ((gerenteProfile.full_name ?? gerenteProfile.email ?? '').trim() || (gerenteProfile.email ?? ''))
        : enrollerNames.get(enrollerId) ?? 'Equipe';
      const subs = consultoresPorGerente.get(enrollerId) ?? [];
      for (const sub of subs) {
        if (!sub.email || idsInList.has(sub.id)) continue;
        idsInList.add(sub.id);
        consultantsDosGerentes.push({
          id: sub.id,
          email: sub.email,
          full_name: sub.full_name,
          role: 'Consultor',
          gerente_nome: gerenteNome,
        });
      }
    }

    const allowedIds = new Set<string>(userIds);
    consultoresPorGerente.forEach((subs) => subs.forEach((s) => allowedIds.add(s.id)));
    const consultantsRaw = [...consultantsFromList, ...consultantsDosGerentes];
    let consultants = consultantsRaw.filter((c): c is NonNullable<typeof c> => c != null && allowedIds.has(c.id));

    const verifyCrm = searchParams.get('verify_crm') === '1';
    if (verifyCrm && consultants.length > 0 && ctx.crmBaseUrl) {
      const apiKey = process.env.CRM_API_KEY?.trim();
      if (apiKey) {
        const BATCH = 8;
        const withEmail = consultants.filter((c) => (c.email ?? '').trim());
        const emails = [...new Set(withEmail.map((c) => (c.email ?? '').trim()))];
        const hasAccount = new Map<string, boolean>();
        for (const batch of chunkArray(emails, BATCH)) {
          const results = await Promise.all(
            batch.map(async (email) => {
              const ok = await consultantHasAccountInBanca(ctx.crmBaseUrl!, email, apiKey);
              return { email, ok } as const;
            })
          );
          results.forEach((r) => hasAccount.set(r.email, r.ok));
        }
        consultants = consultants.filter((c) => hasAccount.get((c.email ?? '').trim()) === true);
        console.log(`${LOG_PREFIX} GET verify_crm: ${consultants.length}/${consultantsRaw.length} com conta na banca (CRM)`);
      } else {
        console.warn(`${LOG_PREFIX} GET verify_crm=1 mas CRM_API_KEY não configurada; retornando lista sem filtrar.`);
      }
    }

    console.log(
      `${LOG_PREFIX} GET success: ${consultants.length} consultant(s) (banca ${ctx.bancaId}, ${consultantsFromList.length} diretos + ${consultantsDosGerentes.length} por enroller; hierarchy_only=${hierarchyOnly ? '1' : '0'})`
    );
    return successResponse({ consultants });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('não tem permissão') || message.includes('obrigatório')) {
      return errorResponse(message, 403);
    }
    console.error(`${LOG_PREFIX} GET error:`, err);
    return serverErrorResponse(err);
  }
}
