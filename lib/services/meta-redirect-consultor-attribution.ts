import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { fetchAllSupabasePages } from '@/lib/supabase/fetch-all-pages';

const IN_FILTER_CHUNK = 200;

export interface RedirectConsultorGroup {
  id: string;
  name: string | null;
  project_id: string;
  project_name: string | null;
  project_slug: string | null;
}

export interface RedirectCampaignConsultorAssignment {
  campaign_id: string;
  consultor_id: string;
  redirect_groups: RedirectConsultorGroup[];
  /** Inferência por UTM / cliques em redirect_clicks */
  from_clicks?: boolean;
  /** Consultores dos grupos do projeto em `meta_campaigns.redirect_project_id` */
  from_linked_project?: boolean;
}

export interface CombinedCampaignConsultorAssignment {
  campaign_id: string;
  consultor_id: string;
  source: 'manual' | 'redirect' | 'manual_redirect';
  redirect_groups: RedirectConsultorGroup[];
  redirect_from_clicks?: boolean;
  redirect_from_linked_project?: boolean;
}

type VslProjectRow = { id: string; name: string | null; slug: string | null };
type RedirectGroupRow = {
  id: string;
  name: string | null;
  project_id: string;
  consultant_user_id: string | null;
};
type RedirectClickRow = { group_id: string | null; utm_campaign: string | null };
type MetaCampaignRow = { campaign_id: string | null; name: string | null };

function chunks<T>(items: T[], size = IN_FILTER_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function decodeCampaignValue(value: string): string {
  let out = value;
  try {
    for (let i = 0; i < 3; i += 1) {
      const decoded = decodeURIComponent(out);
      if (decoded === out) break;
      out = decoded;
    }
  } catch {
    // Mantem o valor bruto quando a UTM chega com encode invalido.
  }
  return out;
}

export function normalizeMetaCampaignMatchKey(value: string | null | undefined): string {
  return decodeCampaignValue(String(value ?? ''))
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

async function fetchProjectsForBanca(bancaId: string): Promise<VslProjectRow[]> {
  const { data, error } = await fetchAllSupabasePages<VslProjectRow>(async (from, to) =>
    await supabaseServiceRole
      .from('vsl_projects')
      .select('id, name, slug')
      .eq('banca_id', bancaId)
      .range(from, to)
  );
  if (error) {
    console.warn('[meta redirect attribution] vsl_projects:', error.message);
    return [];
  }
  return data;
}

async function fetchRedirectGroups(
  projectIds: string[],
  consultorIds?: string[]
): Promise<RedirectGroupRow[]> {
  const out: RedirectGroupRow[] = [];
  const consultantFilter = Array.from(new Set((consultorIds ?? []).map((id) => id.trim()).filter(Boolean)));

  for (const projectChunk of chunks(projectIds)) {
    const { data, error } = await fetchAllSupabasePages<RedirectGroupRow>(async (from, to) => {
      let q = supabaseServiceRole
        .from('redirect_groups')
        .select('id, name, project_id, consultant_user_id')
        .in('project_id', projectChunk)
        .not('consultant_user_id', 'is', null)
        .range(from, to);
      if (consultantFilter.length > 0) q = q.in('consultant_user_id', consultantFilter);
      return await q;
    });
    if (error) {
      console.warn('[meta redirect attribution] redirect_groups:', error.message);
      continue;
    }
    out.push(...data);
  }

  return out;
}

async function fetchCampaigns(bancaId: string, campaignIds?: string[]): Promise<MetaCampaignRow[]> {
  const ids = Array.from(new Set((campaignIds ?? []).map((id) => id.trim()).filter(Boolean)));
  const { data, error } = await fetchAllSupabasePages<MetaCampaignRow>(async (from, to) => {
    let q = supabaseServiceRole
      .from('meta_campaigns')
      .select('campaign_id, name')
      .eq('banca_id', bancaId)
      .range(from, to);
    if (ids.length > 0) q = q.in('campaign_id', ids);
    return await q;
  });
  if (error) {
    console.warn('[meta redirect attribution] meta_campaigns:', error.message);
    return [];
  }
  return data;
}

async function fetchClicksForGroups(groupIds: string[]): Promise<RedirectClickRow[]> {
  const out: RedirectClickRow[] = [];
  for (const groupChunk of chunks(groupIds)) {
    const { data, error } = await fetchAllSupabasePages<RedirectClickRow>(async (from, to) =>
      await supabaseServiceRole
        .from('redirect_clicks')
        .select('group_id, utm_campaign')
        .in('group_id', groupChunk)
        .not('utm_campaign', 'is', null)
        .range(from, to)
    );
    if (error) {
      console.warn('[meta redirect attribution] redirect_clicks:', error.message);
      continue;
    }
    out.push(...data);
  }
  return out;
}

export async function listRedirectCampaignConsultorAssignments(params: {
  bancaId: string;
  campaignIds?: string[];
  consultorIds?: string[];
}): Promise<RedirectCampaignConsultorAssignment[]> {
  const bancaId = params.bancaId.trim();
  const hasCampaignFilter = Array.isArray(params.campaignIds);
  const campaignIds = Array.from(new Set((params.campaignIds ?? []).map((id) => id.trim()).filter(Boolean)));
  if (!bancaId || (hasCampaignFilter && campaignIds.length === 0)) return [];

  const projects = await fetchProjectsForBanca(bancaId);
  if (projects.length === 0) return [];

  const projectById = new Map(projects.map((p) => [p.id, p]));
  const groups = await fetchRedirectGroups(projects.map((p) => p.id), params.consultorIds);
  if (groups.length === 0) return [];

  const campaigns = await fetchCampaigns(bancaId, hasCampaignFilter ? campaignIds : undefined);
  const campaignByMatchKey = new Map<string, string>();
  for (const campaign of campaigns) {
    const id = String(campaign.campaign_id ?? '').trim();
    if (!id) continue;
    const idKey = normalizeMetaCampaignMatchKey(id);
    const nameKey = normalizeMetaCampaignMatchKey(campaign.name);
    if (idKey) campaignByMatchKey.set(idKey, id);
    if (nameKey) campaignByMatchKey.set(nameKey, id);
  }
  if (campaignByMatchKey.size === 0) return [];

  const groupById = new Map(groups.map((g) => [g.id, g]));
  const clicks = await fetchClicksForGroups(groups.map((g) => g.id));
  const byCampaignConsultor = new Map<string, RedirectCampaignConsultorAssignment>();
  const seenGroupsByAssignment = new Map<string, Set<string>>();

  for (const click of clicks) {
    const campaignId = campaignByMatchKey.get(normalizeMetaCampaignMatchKey(click.utm_campaign));
    if (!campaignId || !click.group_id) continue;
    const group = groupById.get(click.group_id);
    if (!group?.consultant_user_id) continue;

    const key = `${campaignId}:${group.consultant_user_id}`;
    const project = projectById.get(group.project_id);
    const assignment = byCampaignConsultor.get(key) ?? {
      campaign_id: campaignId,
      consultor_id: group.consultant_user_id,
      redirect_groups: [],
    };
    const seenGroups = seenGroupsByAssignment.get(key) ?? new Set<string>();
    if (!seenGroups.has(group.id)) {
      assignment.redirect_groups.push({
        id: group.id,
        name: group.name,
        project_id: group.project_id,
        project_name: project?.name ?? null,
        project_slug: project?.slug ?? null,
      });
      seenGroups.add(group.id);
      seenGroupsByAssignment.set(key, seenGroups);
    }
    byCampaignConsultor.set(key, assignment);
  }

  return Array.from(byCampaignConsultor.values()).map((a) => ({
    ...a,
    from_clicks: true,
  }));
}

function mergeRedirectGroupLists(a: RedirectConsultorGroup[], b: RedirectConsultorGroup[]): RedirectConsultorGroup[] {
  const seen = new Set<string>();
  const out: RedirectConsultorGroup[] = [];
  for (const g of [...a, ...b]) {
    const id = String(g.id ?? '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(g);
  }
  return out;
}

/** Une atribuições redirect (cliques + projeto vinculado) por campanha/consultor. */
export function mergeRedirectAssignmentLists(
  assignments: RedirectCampaignConsultorAssignment[]
): RedirectCampaignConsultorAssignment[] {
  const map = new Map<string, RedirectCampaignConsultorAssignment>();
  for (const x of assignments) {
    const cid = String(x.campaign_id ?? '').trim();
    const uid = String(x.consultor_id ?? '').trim();
    if (!cid || !uid) continue;
    const key = `${cid}:${uid}`;
    const cur = map.get(key);
    if (!cur) {
      map.set(key, {
        ...x,
        redirect_groups: [...(x.redirect_groups || [])],
        from_clicks: Boolean(x.from_clicks),
        from_linked_project: Boolean(x.from_linked_project),
      });
      continue;
    }
    map.set(key, {
      campaign_id: cid,
      consultor_id: uid,
      redirect_groups: mergeRedirectGroupLists(cur.redirect_groups || [], x.redirect_groups || []),
      from_clicks: Boolean(cur.from_clicks || x.from_clicks),
      from_linked_project: Boolean(cur.from_linked_project || x.from_linked_project),
    });
  }
  return Array.from(map.values());
}

/**
 * Consultores dos grupos do projeto indicado em `meta_campaigns.redirect_project_id`
 * (independente de haver cliques com UTM).
 */
export async function listRedirectProjectLinkedConsultorAssignments(params: {
  bancaId: string;
  campaignIds: string[];
}): Promise<RedirectCampaignConsultorAssignment[]> {
  const bancaId = params.bancaId.trim();
  const campaignIds = Array.from(
    new Set((params.campaignIds ?? []).map((id) => String(id ?? '').trim()).filter(Boolean))
  );
  if (!bancaId || !campaignIds.length) return [];

  const campaignsRows = await fetchCampaignsWithRedirectProject(bancaId, campaignIds);
  if (!campaignsRows.length) return [];

  const projectIds = Array.from(
    new Set(campaignsRows.map((r) => String(r.redirect_project_id ?? '').trim()).filter(Boolean))
  );
  const { data: projects, error: projErr } = await supabaseServiceRole
    .from('vsl_projects')
    .select('id, name, slug')
    .eq('banca_id', bancaId)
    .in('id', projectIds);
  if (projErr || !projects?.length) return [];

  const projectsValid = new Set((projects || []).map((p) => String((p as { id: string }).id)));
  const projectMeta = new Map(
    (projects || []).map((p) => {
      const row = p as { id: string; name: string | null; slug: string | null };
      return [String(row.id), row] as const;
    })
  );

  const projectIdsValid = projectIds.filter((id) => projectsValid.has(id));
  if (!projectIdsValid.length) return [];

  const groups = await fetchRedirectGroups(projectIdsValid);
  if (!groups.length) return [];

  const campaignsByProject = new Map<string, string[]>();
  for (const r of campaignsRows) {
    const pid = String(r.redirect_project_id ?? '').trim();
    const cid = String(r.campaign_id ?? '').trim();
    if (!projectsValid.has(pid) || !cid) continue;
    const list = campaignsByProject.get(pid) ?? [];
    list.push(cid);
    campaignsByProject.set(pid, list);
  }

  const byKey = new Map<string, RedirectCampaignConsultorAssignment>();

  for (const g of groups) {
    const consultorId = String(g.consultant_user_id ?? '').trim();
    if (!consultorId) continue;
    const campaignIdsForProject = campaignsByProject.get(g.project_id);
    if (!campaignIdsForProject?.length) continue;
    const project = projectMeta.get(g.project_id);
    const groupMeta: RedirectConsultorGroup = {
      id: g.id,
      name: g.name,
      project_id: g.project_id,
      project_name: project?.name ?? null,
      project_slug: project?.slug ?? null,
    };
    for (const campaign_id of campaignIdsForProject) {
      const key = `${campaign_id}:${consultorId}`;
      const cur = byKey.get(key) ?? {
        campaign_id,
        consultor_id: consultorId,
        redirect_groups: [] as RedirectConsultorGroup[],
        from_linked_project: true,
      };
      const seen = new Set(cur.redirect_groups.map((x) => x.id));
      if (!seen.has(groupMeta.id)) {
        cur.redirect_groups.push(groupMeta);
      }
      byKey.set(key, cur);
    }
  }

  return Array.from(byKey.values()).map((a) => ({
    ...a,
    from_linked_project: true,
  }));
}

async function fetchCampaignsWithRedirectProject(
  bancaId: string,
  campaignIds: string[]
): Promise<Array<{ campaign_id: string; redirect_project_id: string }>> {
  const out: Array<{ campaign_id: string; redirect_project_id: string }> = [];
  for (const chunk of chunks(campaignIds)) {
    const { data, error } = await supabaseServiceRole
      .from('meta_campaigns')
      .select('campaign_id, redirect_project_id')
      .eq('banca_id', bancaId)
      .in('campaign_id', chunk)
      .not('redirect_project_id', 'is', null);
    if (error) {
      console.warn('[meta redirect attribution] meta_campaigns redirect_project_id:', error.message);
      continue;
    }
    for (const row of data ?? []) {
      const cid = String((row as { campaign_id?: string }).campaign_id ?? '').trim();
      const pid = String((row as { redirect_project_id?: string }).redirect_project_id ?? '').trim();
      if (cid && pid) out.push({ campaign_id: cid, redirect_project_id: pid });
    }
  }
  return out;
}

/** Campanhas com redirect vinculado na linha Meta, para consultores dados (Meu Desempenho / spend). */
export async function listRedirectProjectLinkedConsultorAssignmentsForConsultors(params: {
  bancaId: string;
  consultorIds: string[];
}): Promise<RedirectCampaignConsultorAssignment[]> {
  const bancaId = params.bancaId.trim();
  const consultorIds = Array.from(
    new Set((params.consultorIds ?? []).map((id) => String(id ?? '').trim()).filter(Boolean))
  );
  if (!bancaId || !consultorIds.length) return [];

  const projects = await fetchProjectsForBanca(bancaId);
  if (!projects.length) return [];

  const groups = await fetchRedirectGroups(
    projects.map((p) => p.id),
    consultorIds
  );
  if (!groups.length) return [];

  const projectIds = Array.from(new Set(groups.map((g) => g.project_id)));
  const projectById = new Map(projects.map((p) => [p.id, p]));

  const metaRows: Array<{ campaign_id: string; redirect_project_id: string }> = [];
  for (const projectChunk of chunks(projectIds)) {
    const { data, error } = await supabaseServiceRole
      .from('meta_campaigns')
      .select('campaign_id, redirect_project_id')
      .eq('banca_id', bancaId)
      .not('redirect_project_id', 'is', null)
      .in('redirect_project_id', projectChunk);
    if (error) {
      console.warn('[meta redirect attribution] meta_campaigns by project:', error.message);
      continue;
    }
    for (const row of data ?? []) {
      const cid = String((row as { campaign_id?: string }).campaign_id ?? '').trim();
      const pid = String((row as { redirect_project_id?: string }).redirect_project_id ?? '').trim();
      if (cid && pid) metaRows.push({ campaign_id: cid, redirect_project_id: pid });
    }
  }
  if (!metaRows.length) return [];

  const campaignsByProject = new Map<string, string[]>();
  for (const r of metaRows) {
    const list = campaignsByProject.get(r.redirect_project_id) ?? [];
    list.push(r.campaign_id);
    campaignsByProject.set(r.redirect_project_id, list);
  }

  const byKey = new Map<string, RedirectCampaignConsultorAssignment>();

  for (const g of groups) {
    const consultorId = String(g.consultant_user_id ?? '').trim();
    if (!consultorId) continue;
    const campaignIdsForProject = campaignsByProject.get(g.project_id);
    if (!campaignIdsForProject?.length) continue;
    const project = projectById.get(g.project_id);
    const groupMeta: RedirectConsultorGroup = {
      id: g.id,
      name: g.name,
      project_id: g.project_id,
      project_name: project?.name ?? null,
      project_slug: project?.slug ?? null,
    };
    for (const campaign_id of campaignIdsForProject) {
      const key = `${campaign_id}:${consultorId}`;
      const cur = byKey.get(key) ?? {
        campaign_id,
        consultor_id: consultorId,
        redirect_groups: [] as RedirectConsultorGroup[],
        from_linked_project: true,
      };
      const seen = new Set(cur.redirect_groups.map((x) => x.id));
      if (!seen.has(groupMeta.id)) {
        cur.redirect_groups.push(groupMeta);
      }
      byKey.set(key, cur);
    }
  }

  return Array.from(byKey.values()).map((a) => ({
    ...a,
    from_linked_project: true,
  }));
}

export async function inferMetaCampaignIdsFromRedirectConsultors(
  bancaId: string,
  consultorIds: string[]
): Promise<string[]> {
  const [fromClicks, fromLinked] = await Promise.all([
    listRedirectCampaignConsultorAssignments({ bancaId, consultorIds }),
    listRedirectProjectLinkedConsultorAssignmentsForConsultors({ bancaId, consultorIds }),
  ]);
  const merged = mergeRedirectAssignmentLists([...fromClicks, ...fromLinked]);
  return Array.from(new Set(merged.map((a) => a.campaign_id).filter(Boolean)));
}

export function mergeCampaignConsultorAssignments(
  manualAssignments: Array<{ campaign_id: string; consultor_id: string }>,
  redirectAssignments: RedirectCampaignConsultorAssignment[]
): CombinedCampaignConsultorAssignment[] {
  const assignmentsByKey = new Map<string, CombinedCampaignConsultorAssignment>();

  for (const assignment of manualAssignments) {
    assignmentsByKey.set(`${assignment.campaign_id}:${assignment.consultor_id}`, {
      ...assignment,
      source: 'manual',
      redirect_groups: [],
      redirect_from_clicks: false,
      redirect_from_linked_project: false,
    });
  }

  for (const assignment of redirectAssignments) {
    const key = `${assignment.campaign_id}:${assignment.consultor_id}`;
    const current = assignmentsByKey.get(key);
    const rfC = Boolean(assignment.from_clicks);
    const rfL = Boolean(assignment.from_linked_project);

    if (!current) {
      assignmentsByKey.set(key, {
        campaign_id: assignment.campaign_id,
        consultor_id: assignment.consultor_id,
        source: 'redirect',
        redirect_groups: [...(assignment.redirect_groups || [])],
        redirect_from_clicks: rfC,
        redirect_from_linked_project: rfL,
      });
      continue;
    }

    if (current.source === 'manual') {
      assignmentsByKey.set(key, {
        ...current,
        source: 'manual_redirect',
        redirect_groups: [...(assignment.redirect_groups || [])],
        redirect_from_clicks: rfC,
        redirect_from_linked_project: rfL,
      });
      continue;
    }

    assignmentsByKey.set(key, {
      ...current,
      redirect_groups: mergeRedirectGroupLists(current.redirect_groups || [], assignment.redirect_groups || []),
      redirect_from_clicks: Boolean(current.redirect_from_clicks || rfC),
      redirect_from_linked_project: Boolean(current.redirect_from_linked_project || rfL),
    });
  }

  return Array.from(assignmentsByKey.values());
}
