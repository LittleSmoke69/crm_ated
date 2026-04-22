/**
 * Resolução e validação de instância Evolution para Limpeza de Lista.
 * Acesso alinhado a GET /api/instances (admin vê tudo; dono/gerente vê subordinados).
 */

import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { getSubordinates } from '@/lib/middleware/permissions';

export type ResolvedEvolutionCredentials =
  | { ok: true; instance_name: string; base_url: string; api_key_global: string }
  | { ok: false; message: string };

async function fetchInstanceRow(instanceId: string) {
  const { data: row, error } = await supabaseServiceRole
    .from('evolution_instances')
    .select(
      `
      id,
      instance_name,
      status,
      user_id,
      is_active,
      evolution_apis (
        base_url,
        api_key_global,
        is_blocked_for_instances
      )
    `
    )
    .eq('id', instanceId)
    .single();

  if (error || !row) return null;
  return row as {
    instance_name: string;
    status: string;
    user_id: string | null;
    is_active: boolean | null;
    evolution_apis:
      | { base_url: string; api_key_global: string; is_blocked_for_instances?: boolean | null }
      | Array<{ base_url: string; api_key_global: string; is_blocked_for_instances?: boolean | null }>
      | null;
  };
}

function pickApi(row: NonNullable<Awaited<ReturnType<typeof fetchInstanceRow>>>) {
  let api = row.evolution_apis;
  if (Array.isArray(api)) api = api.length > 0 ? api[0] : null;
  if (!api?.base_url || !api?.api_key_global) return null;
  return api;
}

/**
 * Valida permissão + instância conectada; usado no POST verify (escolha do usuário).
 */
export async function resolveEvolutionInstanceForListCleaningVerification(
  instanceId: string,
  viewerUserId: string,
  viewerStatus: string | undefined
): Promise<ResolvedEvolutionCredentials> {
  const row = await fetchInstanceRow(instanceId);
  if (!row) return { ok: false, message: 'Instância não encontrada.' };
  if (row.is_active !== true) return { ok: false, message: 'Instância não está ativa.' };
  if (row.status !== 'ok') {
    return { ok: false, message: 'Conecte a instância no WhatsApp antes de verificar números.' };
  }

  const api = pickApi(row);
  if (!api) return { ok: false, message: 'API Evolution da instância não configurada.' };
  if (api.is_blocked_for_instances === true) {
    return { ok: false, message: 'A API desta instância está bloqueada para uso.' };
  }

  const ownerId = row.user_id;
  if (viewerStatus === 'super_admin' || viewerStatus === 'admin') {
    return { ok: true, instance_name: row.instance_name, base_url: api.base_url, api_key_global: api.api_key_global };
  }

  if (!ownerId) return { ok: false, message: 'Instância sem proprietário.' };

  if (ownerId === viewerUserId) {
    return { ok: true, instance_name: row.instance_name, base_url: api.base_url, api_key_global: api.api_key_global };
  }

  if (viewerStatus === 'dono_banca' || viewerStatus === 'gerente') {
    const subs = await getSubordinates(viewerUserId);
    const allowed = subs.some((s) => s.id === ownerId);
    if (allowed) {
      return { ok: true, instance_name: row.instance_name, base_url: api.base_url, api_key_global: api.api_key_global };
    }
  }

  return { ok: false, message: 'Sem permissão para usar esta instância.' };
}

/**
 * Somente credenciais (job já foi validado ao iniciar verify). Scheduler / slot service.
 */
export async function getEvolutionCredentialsForListCleaningJob(instanceId: string): Promise<
  | { instance_name: string; base_url: string; api_key_global: string }
  | null
> {
  const row = await fetchInstanceRow(instanceId);
  if (!row || row.is_active !== true || row.status !== 'ok') return null;
  const api = pickApi(row);
  if (!api || api.is_blocked_for_instances === true) return null;
  return {
    instance_name: row.instance_name,
    base_url: api.base_url,
    api_key_global: api.api_key_global,
  };
}
