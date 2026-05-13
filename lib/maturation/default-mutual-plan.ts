import type { SupabaseClient } from '@supabase/supabase-js';

const CONFIG_KEY = 'default_mutual_maturation_plan_id';

export async function getDefaultMutualMaturationPlanId(supabase: SupabaseClient): Promise<string | null> {
  const { data, error } = await supabase
    .from('virgin_maturation_config')
    .select('value_json')
    .eq('key', CONFIG_KEY)
    .maybeSingle();
  if (error || data?.value_json == null) return null;
  const raw = data.value_json as { plan_id?: unknown } | string | null;
  if (typeof raw === 'object' && raw !== null && typeof raw.plan_id === 'string') {
    const id = raw.plan_id.trim();
    return id.length > 0 ? id : null;
  }
  return null;
}
