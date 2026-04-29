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
}

export interface CombinedCampaignConsultorAssignment {
  campaign_id: string;
  consultor_id: string;
  source: 'manual' | 'redirect' | 'manual_redirect';
  redirect_groups: RedirectConsultorGroup[];
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

  return Array.from(byCampaignConsultor.values());
}

export async function inferMetaCampaignIdsFromRedirectConsultors(
  bancaId: string,
  consultorIds: string[]
): Promise<string[]> {
  const assignments = await listRedirectCampaignConsultorAssignments({ bancaId, consultorIds });
  return Array.from(new Set(assignments.map((a) => a.campaign_id).filter(Boolean)));
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
    });
  }

  for (const assignment of redirectAssignments) {
    const key = `${assignment.campaign_id}:${assignment.consultor_id}`;
    const current = assignmentsByKey.get(key);
    assignmentsByKey.set(key, {
      campaign_id: assignment.campaign_id,
      consultor_id: assignment.consultor_id,
      source: current ? 'manual_redirect' : 'redirect',
      redirect_groups: assignment.redirect_groups,
    });
  }

  return Array.from(assignmentsByKey.values());
}
