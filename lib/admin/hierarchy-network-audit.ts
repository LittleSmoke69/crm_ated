import { supabaseServiceRole } from '@/lib/services/supabase-service';

export type HierarchyNetworkAuditInput = {
  zaploto_id: string | null;
  actor_id: string;
  actor_email: string | null;
  actor_status: string | null;
  action: string;
  target_user_id?: string | null;
  summary: string;
  meta?: Record<string, unknown>;
};

/**
 * Registra alteração na rede (hierarquia / vínculos). Falhas são só logadas — não quebram a API principal.
 */
export async function recordHierarchyNetworkAudit(input: HierarchyNetworkAuditInput): Promise<void> {
  try {
    const { error } = await supabaseServiceRole.from('hierarchy_network_audit').insert({
      zaploto_id: input.zaploto_id,
      actor_id: input.actor_id,
      actor_email: input.actor_email,
      actor_status: input.actor_status,
      action: input.action,
      target_user_id: input.target_user_id ?? null,
      summary: input.summary.slice(0, 2000),
      meta: input.meta ?? {},
    });
    if (error) {
      console.error('[recordHierarchyNetworkAudit]', error.message);
    }
  } catch (e) {
    console.error('[recordHierarchyNetworkAudit]', e);
  }
}
