import { NextRequest } from 'next/server';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { requireAdminLeadTransferContext } from '@/lib/server/crm/adminLeadTransferContext';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

const LOG_PREFIX = '[lead-transfer][consultants]';

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
 * Lista consultores da hierarquia da banca (apenas user_bancas + subordinados vinculados à banca).
 * Query: banca_id (obrigatório), hierarchy_only=0 (opcional), verify_crm=1 (opcional) — se verify_crm=1, filtra apenas consultores que têm conta na banca (CRM total-indicateds-by-consultant 200).
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

    // banca_ids é JSONB (array de UUIDs). Filtro "cs" (contains) exige JSON válido para evitar erro 22P02.
    const { data: userBancas, error: ubError } = await supabaseServiceRole
      .from('user_bancas')
      .select('user_id')
      .filter('banca_ids', 'cs', JSON.stringify([ctx.bancaId]));

    if (ubError) {
      console.error(`${LOG_PREFIX} GET user_bancas error:`, ubError);
      return errorResponse('Erro ao buscar consultores da banca.', 500);
    }

    const userIds = (userBancas ?? []).map((ub: { user_id: string }) => ub.user_id);
    console.log(`${LOG_PREFIX} GET user_bancas: ${userBancas?.length ?? 0} rows, unique userIds=${userIds.length}`);
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
    const enrollerIds = [...new Set(list.map((p: { enroller?: string | null }) => p.enroller).filter(Boolean))] as string[];
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

    const gerenteIds = list.filter((p: { status?: string | null }) => String(p.status ?? '').toLowerCase() === 'gerente').map((p: { id: string }) => p.id);
    const consultoresPorGerente = new Map<string, { id: string; full_name: string; email: string }[]>();
    const hierarchyOnly = searchParams.get('hierarchy_only') !== '0';
    if (gerenteIds.length > 0) {
      const { data: subordinados } = await supabaseServiceRole
        .from('profiles')
        .select('id, email, full_name, enroller')
        .in('enroller', gerenteIds)
        .not('email', 'is', null);
      const subordinadoIds = (subordinados ?? []).map((s: { id: string }) => s.id);
      let idsPermitidos = new Set(subordinadoIds);
      if (hierarchyOnly && subordinadoIds.length > 0) {
        const { data: subUb } = await supabaseServiceRole
          .from('user_bancas')
          .select('user_id')
          .filter('banca_ids', 'cs', JSON.stringify([ctx.bancaId]));
        const idsNaBanca = new Set((subUb ?? []).map((u: { user_id: string }) => u.user_id));
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
    for (const gerenteId of gerenteIds) {
      const gerenteProfile = list.find((p: { id: string }) => p.id === gerenteId);
      const gerenteNome = gerenteProfile ? ((gerenteProfile.full_name ?? gerenteProfile.email ?? '').trim() || (gerenteProfile.email ?? '')) : enrollerNames.get(gerenteId) ?? 'Gerente';
      const subs = consultoresPorGerente.get(gerenteId) ?? [];
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

    console.log(`${LOG_PREFIX} GET success: ${consultants.length} consultant(s) (banca ${ctx.bancaId}, ${consultantsFromList.length} diretos + ${consultantsDosGerentes.length} de gerentes)`);
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
