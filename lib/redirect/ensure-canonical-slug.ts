import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * Garante slug canônico do redirect no admin (criação/atualização permitida).
 */
export async function ensureCanonicalRedirectSlug(
  projectId: string,
  projectSlug: string
): Promise<{ id: string } | null> {
  let { data: redirectRow } = await supabaseServiceRole
    .from('redirect_slugs')
    .select('id')
    .eq('project_id', projectId)
    .eq('slug', projectSlug)
    .maybeSingle();

  if (!redirectRow?.id) {
    const { data: anySlug } = await supabaseServiceRole
      .from('redirect_slugs')
      .select('id')
      .eq('project_id', projectId)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();
    redirectRow = anySlug ?? null;
  }

  if (!redirectRow?.id) {
    const { data: inserted, error: insErr } = await supabaseServiceRole
      .from('redirect_slugs')
      .insert({ project_id: projectId, slug: projectSlug, is_active: true })
      .select('id')
      .single();
    if (!insErr && inserted?.id) redirectRow = inserted;
  }

  return redirectRow?.id ? { id: redirectRow.id } : null;
}
