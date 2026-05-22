import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { decodeRedirectSlug } from '@/lib/redirect/decode-slug';
import { prepareWeightedGroups, selectGroupByWeightSticky } from '@/lib/redirect/select-group-sticky';

export type RedirectSlugRow = { id: string; project_id: string };

export type RedirectGroupRow = {
  id: string;
  name: string;
  invite_url: string;
  weight_percent: number;
};

export type RedirectProjectRow = {
  id: string;
  name: string;
  redirect_timer_seconds: number | null;
  logo_path: string | null;
  pixel_id: string | null;
};

/**
 * Resolve slug apenas leitura — sem insert/reativação em tráfego público.
 */
export async function resolveRedirectSlugRowReadOnly(slug: string): Promise<RedirectSlugRow | null> {
  const normalized = decodeRedirectSlug(slug).toLowerCase();
  if (!normalized) return null;

  const { data: bySlug } = await supabaseServiceRole
    .from('redirect_slugs')
    .select('id, project_id')
    .eq('slug', normalized)
    .eq('is_active', true)
    .maybeSingle();
  if (bySlug) return bySlug;

  let projectId = '';

  const { data: pageByRedirect } = await supabaseServiceRole
    .from('vsl_pages')
    .select('project_id')
    .eq('redirect_slug', normalized)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();
  if (pageByRedirect?.project_id) {
    projectId = String(pageByRedirect.project_id);
  }

  if (!projectId) {
    const { data: projectBySlug } = await supabaseServiceRole
      .from('vsl_projects')
      .select('id')
      .eq('slug', normalized)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();
    if (projectBySlug?.id) projectId = String(projectBySlug.id);
  }

  if (!projectId) return null;

  const { data: exactSlug } = await supabaseServiceRole
    .from('redirect_slugs')
    .select('id, project_id')
    .eq('project_id', projectId)
    .eq('slug', normalized)
    .eq('is_active', true)
    .maybeSingle();
  if (exactSlug) return exactSlug;

  const { data: project } = await supabaseServiceRole
    .from('vsl_projects')
    .select('slug')
    .eq('id', projectId)
    .maybeSingle();

  if (project?.slug) {
    const { data: canonical } = await supabaseServiceRole
      .from('redirect_slugs')
      .select('id, project_id')
      .eq('project_id', projectId)
      .eq('slug', project.slug)
      .eq('is_active', true)
      .maybeSingle();
    if (canonical) return canonical;
  }

  const { data: anyActive } = await supabaseServiceRole
    .from('redirect_slugs')
    .select('id, project_id')
    .eq('project_id', projectId)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();
  return anyActive ?? null;
}

export async function loadRedirectProject(projectId: string): Promise<RedirectProjectRow | null> {
  const { data } = await supabaseServiceRole
    .from('vsl_projects')
    .select('id, name, redirect_timer_seconds, logo_path, pixel_id')
    .eq('id', projectId)
    .single();
  return data ?? null;
}

export async function loadRedirectGroupsForSlug(redirectSlugId: string, projectId: string): Promise<RedirectGroupRow[]> {
  const { data: linkRows } = await supabaseServiceRole
    .from('redirect_slug_groups')
    .select('group_id')
    .eq('redirect_slug_id', redirectSlugId);

  let groupIds = (linkRows ?? []).map((r: { group_id: string }) => r.group_id);
  if (groupIds.length === 0) {
    const { data: projectGroups } = await supabaseServiceRole
      .from('redirect_groups')
      .select('id')
      .eq('project_id', projectId)
      .eq('is_active', true);
    groupIds = (projectGroups ?? []).map((g: { id: string }) => g.id);
  }
  if (groupIds.length === 0) return [];

  const { data: groups } = await supabaseServiceRole
    .from('redirect_groups')
    .select('id, name, invite_url, weight_percent')
    .in('id', groupIds)
    .eq('is_active', true);

  return (groups ?? []) as RedirectGroupRow[];
}

export function pickRedirectGroup(groups: RedirectGroupRow[], sessionSeed: string | null): RedirectGroupRow | null {
  const withWeight = prepareWeightedGroups(groups);
  return selectGroupByWeightSticky(withWeight, sessionSeed);
}
