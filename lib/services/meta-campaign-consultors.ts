import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { getUserIdsLinkedToCrmBancaViaUserBancas } from '@/lib/utils/user-bancas';
import {
  buildGestorUserIdsByCrmBancaIdMap,
  normalizeBancaNameForMatch,
  normalizeBancaUrlForCrmMatch,
  type CrmBancaLite,
} from '@/lib/services/gestor-names-by-crm-banca';
import { isMetaVerboseLogEnabled, metaVerboseInfo, crmServiceVerboseLog } from '@/lib/utils/meta-debug-log';
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
  'captador',
  'gerente',
  'admin',
  'gestor',
  'super_admin',
  'dono_banca',
] as const;
const ADS_ATTRIBUTION_STATUS_SET = new Set<string>(ADS_ATTRIBUTION_PROFILE_STATUSES);

/** Logs detalhados do dropdown Ads — LOG_META_DEBUG=1 ou LOG_META_ADS_HIERARCHY=1 */
function logAdsHierarchy(event: string, payload: Record<string, unknown>) {
  metaVerboseInfo(`[meta-ads-hierarchy] ${event}`, payload);
}

interface ConsultantAggregatedMetrics {
  total_leads: number;
  total_deposited: number;
}

export interface CampaignConsultorAssignment {
  campaign_id: string;
  consultor_id: string;
  whatsapp_group_name?: string | null;
  whatsapp_group_invite_url?: string | null;
  daily_spend_estimate?: number | null;
}

export interface CampaignConsultorAssignmentInput {
  consultor_id: string;
  whatsapp_group_name?: string | null;
  whatsapp_group_invite_url?: string | null;
  daily_spend_estimate?: number | string | null;
}

export interface CampaignAssignedConsultor {
  id: string;
  email: string;
  full_name: string | null;
  total_leads: number;
  /** Depósitos (dashboard-metrics?consultant=email → total_deposited) */
  total_deposited: number;
  source: 'manual' | 'redirect' | 'manual_redirect';
  redirect_groups: RedirectConsultorGroup[];
  /** Grupo WhatsApp registrado manualmente pelo gestor */
  whatsapp_group_name?: string | null;
  whatsapp_group_invite_url?: string | null;
  /** Gasto diário estimado em BRL (configurado pelo gestor). */
  daily_spend_estimate?: number | null;
  /** Atribuição por UTM / cliques no redirect */
  redirect_from_clicks?: boolean;
  /** Atribuição pelos grupos do projeto em `meta_campaigns.redirect_project_id` */
  redirect_from_linked_project?: boolean;
}

export interface CampaignConsultorSummary {
  assigned_consultors: CampaignAssignedConsultor[];
  consultor_total_leads: number;
  /** Soma de total_deposited dos consultores atribuídos (dashboard-metrics por e-mail). */
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

function normalizeWhatsappGroupName(value: unknown): string | null {
  const s = String(value ?? '').trim();
  return s || null;
}

function normalizeWhatsappGroupInviteUrl(value: unknown): string | null {
  const s = String(value ?? '').trim();
  return s || null;
}

function normalizeDailySpendEstimate(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const raw = typeof value === 'number' ? value : parseFloat(String(value).replace(',', '.').trim());
  if (!Number.isFinite(raw) || raw < 0) return null;
  return Math.round(raw * 100) / 100;
}

function normalizeCampaignConsultorInputs(
  raw: CampaignConsultorAssignmentInput[] | string[]
): CampaignConsultorAssignmentInput[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  if (typeof raw[0] === 'string') {
    return (raw as string[])
      .map((id) => String(id ?? '').trim())
      .filter(Boolean)
      .map((consultor_id) => ({
        consultor_id,
        whatsapp_group_name: null,
        whatsapp_group_invite_url: null,
        daily_spend_estimate: null,
      }));
  }
  const byKey = new Map<string, CampaignConsultorAssignmentInput>();
  for (const item of raw as CampaignConsultorAssignmentInput[]) {
    const consultor_id = String(item?.consultor_id ?? '').trim();
    if (!consultor_id) continue;
    const groupUrl = normalizeWhatsappGroupInviteUrl(item?.whatsapp_group_invite_url) ?? '';
    const key = `${consultor_id}|||${groupUrl}`;
    byKey.set(key, {
      consultor_id,
      whatsapp_group_name: normalizeWhatsappGroupName(item?.whatsapp_group_name),
      whatsapp_group_invite_url: normalizeWhatsappGroupInviteUrl(item?.whatsapp_group_invite_url),
      daily_spend_estimate: normalizeDailySpendEstimate(item?.daily_spend_estimate),
    });
  }
  return Array.from(byKey.values());
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
  if (isMetaVerboseLogEnabled() && userIds.length > 0) {
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

async function assertConsultorsAllowedForAdsAttribution(
  bancaId: string,
  consultorIds: string[]
): Promise<void> {
  const ids = Array.from(new Set(consultorIds.map((id) => String(id ?? '').trim()).filter(Boolean)));
  if (!ids.length) return;
  const list = await listConsultoresForAdsAttributionDropdown(bancaId);
  const allowed = new Set(list.map((c) => c.id));
  for (const id of ids) {
    if (!allowed.has(id)) {
      throw new Error(`Consultor não permitido para esta banca (${id}).`);
    }
  }
}

export async function listCampaignConsultorAssignments(
  bancaId: string,
  campaignIds: string[]
): Promise<CampaignConsultorAssignment[]> {
  if (!bancaId || !campaignIds.length) return [];
  const { data, error } = await supabaseServiceRole
    .from('meta_campaign_consultors')
    .select('campaign_id, consultor_id, whatsapp_group_name, whatsapp_group_invite_url, daily_spend_estimate')
    .eq('banca_id', bancaId)
    .in('campaign_id', campaignIds);
  if (error) {
    const msg = String(error.message || '').toLowerCase();
    if (msg.includes('whatsapp_group_name') && msg.includes('does not exist')) {
      const { data: fallback } = await supabaseServiceRole
        .from('meta_campaign_consultors')
        .select('campaign_id, consultor_id')
        .eq('banca_id', bancaId)
        .in('campaign_id', campaignIds);
      return (fallback || []) as CampaignConsultorAssignment[];
    }
    if (msg.includes('daily_spend_estimate') && msg.includes('does not exist')) {
      const { data: fallback } = await supabaseServiceRole
        .from('meta_campaign_consultors')
        .select('campaign_id, consultor_id, whatsapp_group_name, whatsapp_group_invite_url')
        .eq('banca_id', bancaId)
        .in('campaign_id', campaignIds);
      return (fallback || []) as CampaignConsultorAssignment[];
    }
    throw new Error(error.message);
  }
  return (data || []) as CampaignConsultorAssignment[];
}

export async function setCampaignConsultors(
  bancaId: string,
  campaignId: string,
  rawInputs: CampaignConsultorAssignmentInput[] | string[]
): Promise<void> {
  const assignments = normalizeCampaignConsultorInputs(rawInputs);
  await supabaseServiceRole
    .from('meta_campaign_consultors')
    .delete()
    .eq('banca_id', bancaId)
    .eq('campaign_id', campaignId);

  if (!assignments.length) return;

  for (const item of assignments) {
    const groupName = normalizeWhatsappGroupName(item.whatsapp_group_name);
    const groupUrl = normalizeWhatsappGroupInviteUrl(item.whatsapp_group_invite_url);
    if (!groupName || !groupUrl) {
      throw new Error('Nome do grupo WhatsApp e link de convite são obrigatórios para cada consultor atribuído.');
    }
  }

  await assertConsultorsAllowedForAdsAttribution(
    bancaId,
    assignments.map((item) => item.consultor_id)
  );

  const payload = assignments.map((item) => ({
    banca_id: bancaId,
    campaign_id: campaignId,
    consultor_id: item.consultor_id,
    whatsapp_group_name: item.whatsapp_group_name ?? null,
    whatsapp_group_invite_url: item.whatsapp_group_invite_url ?? null,
    daily_spend_estimate: item.daily_spend_estimate ?? null,
  }));

  const { error } = await supabaseServiceRole.from('meta_campaign_consultors').insert(payload);
  if (error) {
    const msg = String(error.message || '').toLowerCase();
    if (msg.includes('whatsapp_group_name') && msg.includes('does not exist')) {
      const legacyPayload = assignments.map((item) => ({
        banca_id: bancaId,
        campaign_id: campaignId,
        consultor_id: item.consultor_id,
      }));
      await supabaseServiceRole.from('meta_campaign_consultors').insert(legacyPayload);
      return;
    }
    if (msg.includes('daily_spend_estimate') && msg.includes('does not exist')) {
      const legacyPayload = assignments.map((item) => ({
        banca_id: bancaId,
        campaign_id: campaignId,
        consultor_id: item.consultor_id,
        whatsapp_group_name: item.whatsapp_group_name ?? null,
        whatsapp_group_invite_url: item.whatsapp_group_invite_url ?? null,
      }));
      await supabaseServiceRole.from('meta_campaign_consultors').insert(legacyPayload);
      return;
    }
    throw new Error(error.message);
  }
}

interface ConsultantDashboardMetricsResult {
  total_deposited: number;
}

interface ConsultantDashboardMetricsRequestLog {
  method: 'GET';
  url: string;
  consultant: string;
  dateFrom: string | null;
  dateTo: string | null;
  hasApiKey: boolean;
  status: number | null;
  durationMs: number;
  ok: boolean;
  total_deposited?: number;
  error?: string;
  responsePreview?: string;
}

async function fetchConsultantDashboardMetrics(
  bancaUrl: string,
  consultantEmail: string,
  dateFrom?: string | null,
  dateTo?: string | null
): Promise<{ metrics: ConsultantDashboardMetricsResult | null; requestLog: ConsultantDashboardMetricsRequestLog }> {
  const email = consultantEmail?.trim();
  const startedAt = Date.now();
  const baseLog: Omit<ConsultantDashboardMetricsRequestLog, 'status' | 'durationMs' | 'ok'> = {
    method: 'GET',
    url: '',
    consultant: email || '',
    dateFrom: dateFrom ?? null,
    dateTo: dateTo ?? null,
    hasApiKey: Boolean(process.env.CRM_API_KEY),
  };

  if (!bancaUrl || !email) {
    return {
      metrics: null,
      requestLog: {
        ...baseLog,
        status: null,
        durationMs: Date.now() - startedAt,
        ok: false,
        error: 'bancaUrl ou e-mail do consultor ausente',
      },
    };
  }

  const apiKey = process.env.CRM_API_KEY;
  const externalApiUrl = new URL(`${bancaUrl}/api/crm/dashboard-metrics`);
  externalApiUrl.searchParams.set('consultant', email);
  if (dateFrom) externalApiUrl.searchParams.set('date_from', dateFrom);
  if (dateTo) externalApiUrl.searchParams.set('date_to', dateTo);
  baseLog.url = externalApiUrl.toString();

  try {
    const res = await fetch(externalApiUrl.toString(), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...(apiKey && { 'X-API-KEY': apiKey }),
      },
      signal: AbortSignal.timeout(60000),
    });
    const durationMs = Date.now() - startedAt;

    if (!res.ok) {
      const body = (await res.text().catch(() => '')).slice(0, 300);
      return {
        metrics: null,
        requestLog: {
          ...baseLog,
          status: res.status,
          durationMs,
          ok: false,
          error: res.statusText || 'request failed',
          responsePreview: body || undefined,
        },
      };
    }

    const externalData = await res.json();
    const metricsPayload =
      externalData?.success && externalData?.metrics
        ? externalData.metrics
        : externalData?.metrics ?? externalData;
    if (!metricsPayload || typeof metricsPayload !== 'object') {
      return {
        metrics: null,
        requestLog: {
          ...baseLog,
          status: res.status,
          durationMs,
          ok: false,
          error: 'resposta sem métricas reconhecíveis',
          responsePreview: JSON.stringify(externalData).slice(0, 300),
        },
      };
    }

    const total_deposited = Number((metricsPayload as { total_deposited?: number }).total_deposited) || 0;
    return {
      metrics: { total_deposited },
      requestLog: {
        ...baseLog,
        status: res.status,
        durationMs,
        ok: true,
        total_deposited,
      },
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      metrics: null,
      requestLog: {
        ...baseLog,
        status: null,
        durationMs: Date.now() - startedAt,
        ok: false,
        error: message,
      },
    };
  }
}

async function getConsultantDepositedFromDashboardById(
  bancaId: string,
  consultorIds: string[],
  dateFrom?: string | null,
  dateTo?: string | null
): Promise<Map<string, number>> {
  const depositedByConsultorId = new Map<string, number>();
  if (!bancaId || !consultorIds.length) return depositedByConsultorId;

  const { data: banca } = await supabaseServiceRole
    .from('crm_bancas')
    .select('url')
    .eq('id', bancaId)
    .maybeSingle();
  const bancaUrl = normalizeBancaUrl(banca?.url);
  if (!bancaUrl) return depositedByConsultorId;

  const { data: consultors } = await supabaseServiceRole
    .from('profiles')
    .select('id, email')
    .in('id', consultorIds)
    .in('status', [...ADS_ATTRIBUTION_PROFILE_STATUSES]);

  const rows = (consultors || []).filter(
    (c: { id?: string; email?: string | null }) => Boolean(c.id && c.email?.trim())
  ) as Array<{ id: string; email: string }>;
  if (!rows.length) return depositedByConsultorId;

  const results = await Promise.all(
    rows.map(async (c) => {
      const { metrics, requestLog } = await fetchConsultantDashboardMetrics(bancaUrl, c.email, dateFrom, dateTo);
      crmServiceVerboseLog('[Depósitos via Meta] request', requestLog);
      return { id: c.id, email: c.email, total_deposited: metrics?.total_deposited ?? 0 };
    })
  );
  for (const row of results) depositedByConsultorId.set(row.id, row.total_deposited);
  return depositedByConsultorId;
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
  } catch {
    // leads via get-indicateds-by-consultant — falhas já suprimidas no dono-banca service
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
  const [metricsByConsultorId, depositedFromDashboardById, consultorProfiles] = await Promise.all([
    getConsultantMetricsById(bancaId, consultorIds, dateFrom, dateTo),
    getConsultantDepositedFromDashboardById(bancaId, consultorIds, dateFrom, dateTo),
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
          total_deposited: Number(depositedFromDashboardById.get(consultorId) || 0),
          source: assignment.source,
          redirect_groups: assignment.redirect_groups ?? [],
          whatsapp_group_name: assignment.manual_whatsapp_group_name ?? null,
          whatsapp_group_invite_url: assignment.manual_whatsapp_group_invite_url ?? null,
          daily_spend_estimate: assignment.manual_daily_spend_estimate ?? null,
          redirect_from_clicks: Boolean(assignment.redirect_from_clicks),
          redirect_from_linked_project: Boolean(assignment.redirect_from_linked_project),
        };
      }
    );

    const consultor_total_leads = Array.from(
      new Set(assignedConsultors.map((c) => c.id))
    ).reduce((sum, consultorId) => sum + (metricsByConsultorId.get(consultorId)?.total_leads || 0), 0);
    const consultor_total_deposited = Array.from(
      new Set(assignedConsultors.map((c) => c.id))
    ).reduce((sum, consultorId) => sum + (depositedFromDashboardById.get(consultorId) || 0), 0);
    result.set(campaignId, {
      assigned_consultors: assignedConsultors,
      consultor_total_leads,
      consultor_total_deposited,
    });
  });

  const totalDepositosMeta = Array.from(result.values()).reduce(
    (sum, summary) => sum + (summary.consultor_total_deposited || 0),
    0
  );
  crmServiceVerboseLog('[Depósitos via Meta] resumo', {
    bancaId,
    dateFrom: dateFrom ?? null,
    dateTo: dateTo ?? null,
    campanhas: campaignIds.length,
    totalDeposited: totalDepositosMeta,
    porCampanha: Array.from(result.entries())
      .filter(([, summary]) => summary.assigned_consultors.length > 0)
      .map(([campaignId, summary]) => ({
        campaignId,
        totalDeposited: summary.consultor_total_deposited,
        consultores: summary.assigned_consultors.map((c) => ({
          email: c.email,
          totalDeposited: c.total_deposited,
        })),
      })),
  });

  return result;
}

/**
 * Indica se a banca tem ao menos um consultor vinculado a campanha Meta
 * (meta_campaign_consultors ou ads_attribution em meta_campaigns).
 */
export async function bancaHasConsultoresComCampanha(bancaId: string): Promise<boolean> {
  const id = String(bancaId ?? '').trim();
  if (!id) return false;

  const { count: mccCount } = await supabaseServiceRole
    .from('meta_campaign_consultors')
    .select('consultor_id', { count: 'exact', head: true })
    .eq('banca_id', id);
  if ((mccCount ?? 0) > 0) return true;

  const { data: campaigns } = await supabaseServiceRole
    .from('meta_campaigns')
    .select('ads_attribution_consultor_ids, ads_attribution_consultor_id')
    .eq('banca_id', id)
    .limit(200);

  for (const row of campaigns ?? []) {
    const legacy = String((row as { ads_attribution_consultor_id?: string | null }).ads_attribution_consultor_id ?? '').trim();
    if (legacy) return true;
    const arr = (row as { ads_attribution_consultor_ids?: unknown }).ads_attribution_consultor_ids;
    if (Array.isArray(arr) && arr.some((x) => String(x ?? '').trim())) return true;
  }

  return false;
}
