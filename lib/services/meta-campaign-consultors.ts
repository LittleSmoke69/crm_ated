import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { getUserIdsLinkedToCrmBancaViaUserBancas } from '@/lib/utils/user-bancas';
import {
  buildGestorUserIdsByCrmBancaIdMap,
  normalizeBancaNameForMatch,
  normalizeBancaUrlForCrmMatch,
  type CrmBancaLite,
} from '@/lib/services/gestor-names-by-crm-banca';
import {
  listRedirectCampaignConsultorAssignments,
  listRedirectProjectLinkedConsultorAssignments,
  mergeCampaignConsultorAssignments,
  mergeRedirectAssignmentLists,
  type CombinedCampaignConsultorAssignment,
  type RedirectConsultorGroup,
} from '@/lib/services/meta-redirect-consultor-attribution';
/**
 * Perfis que podem receber spend no card Ads (alinhado ao escopo de Meu Desempenho por banca:
 * consultor, gerente, admin, gestor, super_admin, dono_banca vinculados em user_bancas / rede enroller).
 * dono_banca incluso para que o dono possa receber atribuição quando não há gestores vinculados.
 */
const ADS_ATTRIBUTION_PROFILE_STATUSES = [
  'consultor',
  'gerente',
  'admin',
  'gestor',
  'super_admin',
  'dono_banca',
] as const;
const ADS_ATTRIBUTION_STATUS_SET = new Set<string>(ADS_ATTRIBUTION_PROFILE_STATUSES);

/** Logs detalhados da montagem do dropdown Ads (user_bancas + raízes + BFS enroller). Defina LOG_META_ADS_HIERARCHY=1 no .env */
const LOG_META_ADS_HIERARCHY = process.env.LOG_META_ADS_HIERARCHY === '1';

function logAdsHierarchy(event: string, payload: Record<string, unknown>) {
  if (!LOG_META_ADS_HIERARCHY) return;
  console.info(`[meta-ads-hierarchy] ${event}`, JSON.stringify(payload));
}

interface ConsultantAggregatedMetrics {
  total_leads: number;
  total_deposited: number;
}

export interface CampaignConsultorAssignment {
  campaign_id: string;
  consultor_id: string;
}

export interface CampaignAssignedConsultor {
  id: string;
  email: string;
  full_name: string | null;
  total_leads: number;
  total_deposited: number;
  source: 'manual' | 'redirect' | 'manual_redirect';
  redirect_groups: RedirectConsultorGroup[];
  /** Atribuição por UTM / cliques no redirect */
  redirect_from_clicks?: boolean;
  /** Atribuição pelos grupos do projeto em `redirect_project_id` da campanha */
  redirect_from_linked_project?: boolean;
}

export interface CampaignConsultorSummary {
  assigned_consultors: CampaignAssignedConsultor[];
  consultor_total_leads: number;
  consultor_total_deposited: number;
}

function normalizeBancaUrl(url: string | null | undefined): string {
  if (!url) return '';
  let s = String(url).trim();
  s = s.replace(/^https?:\/\//i, '');
  s = s.replace(/\/api\/crm\/?/i, '');
  s = s.replace(/\/+$/, '');
  if (!s) return '';
  return `https://${s}`.toLowerCase();
}

async function fetchIndicatedsByConsultants(
  cleanBancaUrl: string,
  dateFrom: string | null | undefined,
  dateTo: string | null | undefined,
  consultantEmails: string[]
): Promise<Array<{ consultant_email?: string; total_depositado?: number }>> {
  if (!consultantEmails.length) return [];
  const apiKey = process.env.CRM_API_KEY;
  const baseUrl = `${cleanBancaUrl}/api/crm/get-indicateds-by-consultant`;
  const perPage = 2000;
  const maxPagesPerConsultant = 50;
  const allData: Array<{ consultant_email?: string; total_depositado?: number }> = [];
  const seenIds = new Set<string>();

  for (const email of consultantEmails) {
    const trimmed = email?.trim?.();
    if (!trimmed) continue;
    let page = 1;
    let hasMore = true;
    while (hasMore && page <= maxPagesPerConsultant) {
      const params = new URLSearchParams();
      params.set('consultant', trimmed);
      params.set('per_page', String(perPage));
      params.set('page', String(page));
      params.set('sort', 'created_at');
      params.set('direction', 'desc');
      if (dateFrom) params.set('from', dateFrom);
      if (dateTo) params.set('to', dateTo);
      const url = `${baseUrl}?${params.toString()}`;
      const res = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json', ...(apiKey && { 'X-API-KEY': apiKey }) },
        signal: AbortSignal.timeout(60000),
      });
      if (!res.ok) break;
      const result = await res.json();
      const data = result?.data;
      if (!Array.isArray(data) || data.length === 0) break;
      for (const lead of data as Array<{ id?: string | number; consultant_email?: string; total_depositado?: number }>) {
        const id = lead?.id;
        if (id && !seenIds.has(String(id))) {
          seenIds.add(String(id));
          allData.push(lead);
        } else if (!id) {
          allData.push(lead);
        }
      }
      if (data.length < perPage) hasMore = false;
      else page++;
    }
  }
  return allData;
}

function aggregateIndicatedsByConsultant(
  leads: Array<{ consultant_email?: string; total_depositado?: number }>
): Map<string, ConsultantAggregatedMetrics> {
  const byEmail = new Map<string, ConsultantAggregatedMetrics>();
  for (const lead of leads) {
    const email = lead.consultant_email?.trim?.() || '';
    if (!email) continue;
    const totalDepositado = Number(lead.total_depositado) || 0;
    const cur = byEmail.get(email) || { total_leads: 0, total_deposited: 0 };
    cur.total_leads += 1;
    cur.total_deposited += totalDepositado;
    byEmail.set(email, cur);
  }
  return byEmail;
}

export async function listConsultorsByBancaId(bancaId: string): Promise<Array<{ id: string; email: string; full_name: string | null }>> {
  if (!bancaId) return [];
  return listConsultorProfilesForAdsFromUserIds(await getUserIdsLinkedToCrmBancaViaUserBancas(bancaId));
}

async function listConsultorProfilesForAdsFromUserIds(
  userIds: string[]
): Promise<Array<{ id: string; email: string; full_name: string | null }>> {
  if (!userIds.length) return [];

  const { data: consultors, error } = await supabaseServiceRole
    .from('profiles')
    .select('id, email, full_name, status')
    .in('id', userIds)
    .in('status', [...ADS_ATTRIBUTION_PROFILE_STATUSES]);

  if (error) {
    logAdsHierarchy('profiles_from_user_bancas_error', { message: error.message, input_ids: userIds.length });
    throw new Error(error.message);
  }

  const rows = consultors ?? [];
  if (LOG_META_ADS_HIERARCHY && userIds.length > 0) {
    const statusCounts: Record<string, number> = {};
    for (const r of rows as Array<{ status?: string | null }>) {
      const s = String(r.status ?? 'unknown').toLowerCase();
      statusCounts[s] = (statusCounts[s] ?? 0) + 1;
    }
    logAdsHierarchy('profiles_from_user_bancas', {
      input_user_ids: userIds.length,
      profiles_returned: rows.length,
      skipped_no_ads_eligible_status: userIds.length - rows.length,
      status_breakdown: statusCounts,
      sample_ids: rows.slice(0, 6).map((p: { id?: string }) => p.id),
    });
  }

  return (rows as Array<{ id: string; email: string | null; full_name: string | null }>)
    .filter((c: { id?: string; email?: string | null; full_name?: string | null }) => Boolean(c.id))
    .map((c: { id: string; email: string | null; full_name: string | null }) => ({
      id: c.id,
      email: c.email ?? '',
      full_name: c.full_name,
    }));
}

/** Dono da banca (CRM) pelo mesmo critério de {@link gestor-names-by-crm-banca} / HierarchySection. */
async function resolveDonoBancaIdForCrmBanca(bancaId: string): Promise<string | null> {
  const { data: banca } = await supabaseServiceRole
    .from('crm_bancas')
    .select('id,name,url')
    .eq('id', bancaId)
    .maybeSingle();
  if (!banca) return null;
  const lite: CrmBancaLite = {
    id: String((banca as { id: string }).id),
    name: (banca as { name?: string | null }).name ?? null,
    url: (banca as { url?: string | null }).url ?? null,
  };
  const bancaNameNorm = normalizeBancaNameForMatch(lite.name ?? '');
  const bancaUrlNorm = normalizeBancaUrlForCrmMatch(lite.url ?? '');
  const { data: ownersRows, error } = await supabaseServiceRole
    .from('profiles')
    .select('id, banca_name, banca_url, status')
    .eq('status', 'dono_banca');
  if (error) return null;
  const owner = (ownersRows ?? []).find((o: { banca_name?: string | null; banca_url?: string | null; id?: string }) => {
    const ownerNameNorm = normalizeBancaNameForMatch(o?.banca_name);
    const ownerUrlNorm = normalizeBancaUrlForCrmMatch(o?.banca_url);
    return (
      (bancaUrlNorm.length > 0 && ownerUrlNorm.length > 0 && ownerUrlNorm === bancaUrlNorm) ||
      (bancaNameNorm.length > 0 && ownerNameNorm.length > 0 && ownerNameNorm === bancaNameNorm)
    );
  });
  return owner?.id ? String(owner.id) : null;
}

/** Todos os `profiles.id` com esta banca em `user_bancas` (qualquer papel: inclui gerentes e consultores diretos como raiz da BFS). */
async function getAllUserIdsLinkedViaUserBancasForBanca(bancaId: string): Promise<string[]> {
  if (!bancaId) return [];
  return getUserIdsLinkedToCrmBancaViaUserBancas(bancaId);
}

/** Mesmas raízes que alimentam a coluna Gestor + dono + todos os vínculos em `user_bancas`. */
async function collectRootProfileIdsForAdsAttributionDropdown(
  bancaId: string,
  userIdsFromUserBancas?: string[],
  resolvedOwnerId?: string | null
): Promise<string[]> {
  const rootIdSet = new Set<string>();
  const ownerId = resolvedOwnerId !== undefined ? resolvedOwnerId : await resolveDonoBancaIdForCrmBanca(bancaId);
  if (ownerId) rootIdSet.add(ownerId);

  let fromUb: string[] = [];
  try {
    fromUb =
      userIdsFromUserBancas ?? (await getAllUserIdsLinkedViaUserBancasForBanca(bancaId));
    for (const uid of fromUb) {
      rootIdSet.add(uid);
    }
  } catch (e: unknown) {
    const err = e as { message?: string };
    console.warn('[meta-campaign-consultors] getAllUserIdsLinkedViaUserBancasForBanca:', err?.message);
  }

  let gestorRootIds: string[] = [];
  try {
    const { data: bancaRow } = await supabaseServiceRole
      .from('crm_bancas')
      .select('id, name, url')
      .eq('id', bancaId)
      .maybeSingle();
    if (bancaRow) {
      const bancaById = new Map<string, CrmBancaLite>();
      bancaById.set(bancaId, {
        id: String((bancaRow as { id: string }).id),
        name: (bancaRow as { name?: string | null }).name ?? null,
        url: (bancaRow as { url?: string | null }).url ?? null,
      });
      const gestorMap = await buildGestorUserIdsByCrmBancaIdMap([bancaId], bancaById);
      gestorRootIds = [...(gestorMap.get(bancaId) ?? [])];
      for (const gid of gestorRootIds) {
        rootIdSet.add(gid);
      }
    }
  } catch (e: unknown) {
    const err = e as { message?: string };
    console.warn('[meta-campaign-consultors] buildGestorUserIdsByCrmBancaIdMap:', err?.message);
  }

  const roots = [...rootIdSet];
  const ubSet = new Set(fromUb.map((x) => String(x).trim().toLowerCase()));
  logAdsHierarchy('enroller_roots', {
    banca_id: bancaId,
    dono_banca_id: ownerId,
    user_bancas_ids_for_banca: fromUb.length,
    gestor_column_ids: gestorRootIds.length,
    only_in_gestor_not_in_ub: gestorRootIds.filter((id) => !ubSet.has(String(id).trim().toLowerCase())).length,
    unique_roots_total: roots.length,
    sample_roots: roots.slice(0, 12),
  });

  return roots;
}

/**
 * Consultores na subárvore de `enroller` a partir de uma ou mais raízes (dono, gestores da coluna Gestor, gerentes/consultores em `user_bancas`, etc.).
 */
async function listConsultorProfilesBeneathEnrollerRoots(
  rootIds: string[]
): Promise<Array<{ id: string; email: string; full_name: string | null }>> {
  const out: Array<{ id: string; email: string; full_name: string | null }> = [];
  const seen = new Set<string>();
  let frontier = Array.from(
    new Set(rootIds.map((id) => String(id ?? '').trim()).filter(Boolean))
  );
  const CHUNK = 80;
  let bfsDepthUsed = 0;
  let profilesFetchedTotal = 0;
  const eligibleByStatus: Record<string, number> = {};

  async function fetchChildrenByEnrollers(enrollerIds: string[]) {
    const rows: Array<{
      id: string;
      full_name?: string | null;
      email?: string | null;
      status?: string | null;
    }> = [];
    for (let i = 0; i < enrollerIds.length; i += CHUNK) {
      const slice = enrollerIds.slice(i, i + CHUNK);
      if (slice.length === 0) continue;
      const { data, error } = await supabaseServiceRole
        .from('profiles')
        .select('id, full_name, email, status, enroller')
        .in('enroller', slice);
      if (error) throw new Error(error.message);
      rows.push(...((data ?? []) as typeof rows));
    }
    return rows;
  }

  for (let depth = 0; depth < 28 && frontier.length > 0; depth += 1) {
    const rows = await fetchChildrenByEnrollers(frontier);
    if (rows.length === 0) break;
    profilesFetchedTotal += rows.length;
    bfsDepthUsed = depth + 1;
    const next: string[] = [];
    for (const p of rows) {
      const id = String(p.id ?? '').trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const st = String(p.status ?? '').trim().toLowerCase();
      if (ADS_ATTRIBUTION_STATUS_SET.has(st)) {
        eligibleByStatus[st] = (eligibleByStatus[st] ?? 0) + 1;
        out.push({
          id,
          email: String(p.email ?? '').trim(),
          full_name: p.full_name ?? null,
        });
      }
      next.push(id);
    }
    frontier = next;
  }

  logAdsHierarchy('enroller_bfs', {
    root_count: rootIds.length,
    bfs_levels_walked: bfsDepthUsed,
    profiles_fetched_cumulative: profilesFetchedTotal,
    unique_nodes_in_tree: seen.size,
    ads_eligible_in_subtree: out.length,
    eligible_status_breakdown: eligibleByStatus,
    sample_eligible_ids: out.slice(0, 8).map((x) => x.id),
  });

  return out;
}

/**
 * Perfis elegíveis para atribuição do spend Ads no Meu Desempenho:
 * Consultor, gerente, admin, gestor e super_admin com esta banca em `user_bancas` + descendentes `enroller` a partir do dono, dos gestores
 * (mesmo conjunto da coluna Gestor) e de **qualquer** usuário vinculado à banca em `user_bancas` (ex.: gerente com rede abaixo).
 */
export async function listConsultoresForAdsAttributionDropdown(
  bancaId: string
): Promise<Array<{ id: string; email: string; full_name: string | null }>> {
  if (!bancaId) return [];
  const byId = new Map<string, { id: string; email: string; full_name: string | null }>();

  const linkedViaUserBancas = await getUserIdsLinkedToCrmBancaViaUserBancas(bancaId);
  for (const c of await listConsultorProfilesForAdsFromUserIds(linkedViaUserBancas)) {
    byId.set(c.id, c);
  }
  const afterDirectUb = byId.size;

  // Always include the banca owner directly (any status), since dono_banca is a valid attribution target.
  const donoBancaId = await resolveDonoBancaIdForCrmBanca(bancaId);
  if (donoBancaId && !byId.has(donoBancaId)) {
    try {
      const { data: ownerRow } = await supabaseServiceRole
        .from('profiles')
        .select('id, email, full_name, status')
        .eq('id', donoBancaId)
        .maybeSingle();
      if (ownerRow) {
        const id = String((ownerRow as { id: string }).id ?? '').trim();
        if (id) {
          byId.set(id, {
            id,
            email: String((ownerRow as { email?: string | null }).email ?? '').trim(),
            full_name: (ownerRow as { full_name?: string | null }).full_name ?? null,
          });
          logAdsHierarchy('dono_banca_included', { banca_id: bancaId, dono_id: id, status: (ownerRow as { status?: string | null }).status });
        }
      }
    } catch (e: unknown) {
      const err = e as { message?: string };
      console.warn('[meta-campaign-consultors] owner direct fetch:', err?.message);
    }
  }

  const rootIds = await collectRootProfileIdsForAdsAttributionDropdown(bancaId, linkedViaUserBancas, donoBancaId);
  if (rootIds.length > 0) {
    // Include root profiles themselves (e.g. gestores found via enroller subtree of dono but not in user_bancas)
    try {
      for (const c of await listConsultorProfilesForAdsFromUserIds(rootIds)) {
        if (!byId.has(c.id)) byId.set(c.id, c);
      }
    } catch (e: unknown) {
      const err = e as { message?: string };
      console.warn('[meta-campaign-consultors] listConsultorProfilesForAdsFromUserIds(roots):', err?.message);
    }
    try {
      for (const c of await listConsultorProfilesBeneathEnrollerRoots(rootIds)) {
        if (!byId.has(c.id)) byId.set(c.id, c);
      }
    } catch (e: unknown) {
      const err = e as { message?: string };
      console.warn('[meta-campaign-consultors] listConsultorProfilesBeneathEnrollerRoots:', err?.message);
    }
  }

  const addedViaEnroller = Math.max(0, byId.size - afterDirectUb);
  logAdsHierarchy('dropdown_summary', {
    banca_id: bancaId,
    user_bancas_linked_ids: linkedViaUserBancas.length,
    options_from_user_bancas_profiles: afterDirectUb,
    enroller_subtree_new_ids: addedViaEnroller,
    options_total: byId.size,
    allowed_statuses: [...ADS_ATTRIBUTION_PROFILE_STATUSES],
  });

  return Array.from(byId.values()).sort((a, b) => {
    const la = String(a.full_name || a.email || a.id || '').toLowerCase();
    const lb = String(b.full_name || b.email || b.id || '').toLowerCase();
    return la.localeCompare(lb, 'pt-BR');
  });
}

/** Permite validar POST de ads attribution para consultores só na hierarquia (sem user_bancas). */
export async function isConsultorAllowedForAdsAttribution(bancaId: string, consultorId: string): Promise<boolean> {
  const id = String(consultorId ?? '').trim();
  if (!id) return false;
  const list = await listConsultoresForAdsAttributionDropdown(bancaId);
  return list.some((c) => c.id === id);
}

export async function listCampaignConsultorAssignments(
  bancaId: string,
  campaignIds: string[]
): Promise<CampaignConsultorAssignment[]> {
  if (!bancaId || !campaignIds.length) return [];
  const { data } = await supabaseServiceRole
    .from('meta_campaign_consultors')
    .select('campaign_id, consultor_id')
    .eq('banca_id', bancaId)
    .in('campaign_id', campaignIds);
  return (data || []) as CampaignConsultorAssignment[];
}

export async function setCampaignConsultors(
  bancaId: string,
  campaignId: string,
  consultorIds: string[]
): Promise<void> {
  await supabaseServiceRole
    .from('meta_campaign_consultors')
    .delete()
    .eq('banca_id', bancaId)
    .eq('campaign_id', campaignId);

  const normalizedIds = Array.from(
    new Set(
      (consultorIds || [])
        .map((id) => String(id || '').trim())
        .filter(Boolean)
    )
  );
  if (!normalizedIds.length) return;

  const payload = normalizedIds.map((consultorId) => ({
    banca_id: bancaId,
    campaign_id: campaignId,
    consultor_id: consultorId,
  }));
  await supabaseServiceRole.from('meta_campaign_consultors').insert(payload);
}

async function getConsultantMetricsById(
  bancaId: string,
  consultorIds: string[],
  dateFrom?: string | null,
  dateTo?: string | null
): Promise<Map<string, ConsultantAggregatedMetrics>> {
  const metricsByConsultorId = new Map<string, ConsultantAggregatedMetrics>();
  if (!bancaId || !consultorIds.length) return metricsByConsultorId;

  const { data: banca } = await supabaseServiceRole
    .from('crm_bancas')
    .select('url')
    .eq('id', bancaId)
    .maybeSingle();
  const bancaUrl = normalizeBancaUrl(banca?.url);
  if (!bancaUrl) return metricsByConsultorId;

  const { data: consultors } = await supabaseServiceRole
    .from('profiles')
    .select('id, email')
    .in('id', consultorIds)
    .in('status', [...ADS_ATTRIBUTION_PROFILE_STATUSES]);

  const idByEmail = new Map<string, string>();
  const emails: string[] = [];
  (consultors || []).forEach((c: { id?: string; email?: string | null }) => {
    const email = c.email?.trim();
    if (!c.id || !email) return;
    idByEmail.set(email, c.id);
    emails.push(email);
  });
  if (!emails.length) return metricsByConsultorId;

  try {
    const leads = await fetchIndicatedsByConsultants(bancaUrl, dateFrom ?? undefined, dateTo ?? undefined, emails);
    const metricsByEmail = aggregateIndicatedsByConsultant(leads);
    metricsByEmail.forEach((metric, email) => {
      const consultorId = idByEmail.get(email);
      if (!consultorId) return;
      metricsByConsultorId.set(consultorId, metric);
    });
  } catch (error: any) {
    console.warn('[Meta Campaign Consultors] erro ao carregar métricas de consultores:', error?.message);
  }

  return metricsByConsultorId;
}

export async function buildCampaignConsultorSummary(
  bancaId: string,
  campaignIds: string[],
  dateFrom?: string | null,
  dateTo?: string | null
): Promise<Map<string, CampaignConsultorSummary>> {
  const result = new Map<string, CampaignConsultorSummary>();
  if (!bancaId || !campaignIds.length) return result;

  const [manualAssignments, redirectFromClicks, redirectFromLinkedProject] = await Promise.all([
    listCampaignConsultorAssignments(bancaId, campaignIds),
    listRedirectCampaignConsultorAssignments({ bancaId, campaignIds }),
    listRedirectProjectLinkedConsultorAssignments({ bancaId, campaignIds }),
  ]);
  const redirectAssignments = mergeRedirectAssignmentLists([
    ...redirectFromClicks,
    ...redirectFromLinkedProject,
  ]);
  const assignments = mergeCampaignConsultorAssignments(manualAssignments, redirectAssignments);
  if (!assignments.length) {
    campaignIds.forEach((campaignId) => {
      result.set(campaignId, {
        assigned_consultors: [],
        consultor_total_leads: 0,
        consultor_total_deposited: 0,
      });
    });
    return result;
  }

  const consultorIds = Array.from(new Set(assignments.map((a) => a.consultor_id)));
  const [metricsByConsultorId, consultorProfiles] = await Promise.all([
    getConsultantMetricsById(bancaId, consultorIds, dateFrom, dateTo),
    supabaseServiceRole
      .from('profiles')
      .select('id, email, full_name')
      .in('id', consultorIds)
      .in('status', [...ADS_ATTRIBUTION_PROFILE_STATUSES]),
  ]);

  const profileById = new Map<string, { email: string; full_name: string | null }>();
  (consultorProfiles.data || []).forEach((p: { id: string; email: string; full_name: string | null }) => {
    profileById.set(p.id, { email: p.email, full_name: p.full_name });
  });

  campaignIds.forEach((campaignId) => {
    const campaignAssignments = assignments.filter((a) => a.campaign_id === campaignId);

    const assignedConsultors: CampaignAssignedConsultor[] = campaignAssignments.map(
      (assignment: CombinedCampaignConsultorAssignment) => {
        const consultorId = assignment.consultor_id;
        const p = profileById.get(consultorId);
        const m = metricsByConsultorId.get(consultorId);
        return {
          id: consultorId,
          email: p?.email || '',
          full_name: p?.full_name || null,
          total_leads: Number(m?.total_leads || 0),
          total_deposited: Number(m?.total_deposited || 0),
          source: assignment.source,
          redirect_groups: assignment.redirect_groups ?? [],
          redirect_from_clicks: Boolean(assignment.redirect_from_clicks),
          redirect_from_linked_project: Boolean(assignment.redirect_from_linked_project),
        };
      }
    );

    const consultor_total_leads = assignedConsultors.reduce((sum, c) => sum + (c.total_leads || 0), 0);
    const consultor_total_deposited = assignedConsultors.reduce((sum, c) => sum + (c.total_deposited || 0), 0);
    result.set(campaignId, {
      assigned_consultors: assignedConsultors,
      consultor_total_leads,
      consultor_total_deposited,
    });
  });

  return result;
}
