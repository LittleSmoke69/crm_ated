import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeGroupId } from '@/lib/utils/group-utils';

/** Timeout da chamada HTTP à Evolution dentro do worker (background Netlify ~15 min). */
export const EVOLUTION_GROUP_FETCH_TIMEOUT_MS = 840_000;

export type NormalizedEvolutionGroup = {
  id: string;
  subject?: string | null;
  pictureUrl?: string | null;
  size?: number | null;
};

export function normalizeEvolutionGroupsPayload(json: unknown): NormalizedEvolutionGroup[] {
  let groupsList: any[] = [];
  if (Array.isArray(json)) groupsList = json;
  else if (json && typeof json === 'object') {
    const o = json as Record<string, unknown>;
    if (Array.isArray(o.groups)) groupsList = o.groups;
    else if (Array.isArray(o.data)) groupsList = o.data;
    else if (Array.isArray(o.result)) groupsList = o.result;
    else if (o.id && o.subject) groupsList = [o];
  }

  const normalized = new Map<string, NormalizedEvolutionGroup>();
  for (const g of groupsList) {
    const rawId = g?.id ?? g?.remoteJid ?? g?.group_id ?? '';
    const id = normalizeGroupId(String(rawId));
    if (!id) continue;
    if (!normalized.has(id)) {
      normalized.set(id, {
        id,
        subject: g?.subject ?? g?.group_subject ?? null,
        pictureUrl: g?.pictureUrl ?? g?.picture_url ?? null,
        size: g?.size ?? null,
      });
    }
  }
  return Array.from(normalized.values());
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '').replace(/([^:]\/)\/+/g, '$1');
}

/**
 * Persiste grupos em lote: uma leitura de existentes + inserts/updates em batches.
 */
export async function persistWhatsappGroupsBatch(
  supabase: SupabaseClient,
  userId: string,
  instanceName: string,
  uniqueGroups: NormalizedEvolutionGroup[],
): Promise<{ inserted: number; updated: number }> {
  const INSERT_BATCH = 250;
  const UPDATE_CONCURRENCY = 25;

  if (uniqueGroups.length === 0) {
    return { inserted: 0, updated: 0 };
  }

  const { data: existingRows, error: existingErr } = await supabase
    .from('whatsapp_groups')
    .select('id, group_id, group_subject, picture_url, size')
    .eq('user_id', userId)
    .eq('instance_name', instanceName);

  if (existingErr) {
    throw new Error(`Erro ao ler grupos existentes: ${existingErr.message}`);
  }

  const byGid = new Map(
    (existingRows || []).map((r: { id: string; group_id: string; group_subject: string | null; picture_url: string | null; size: number | null }) => [
      r.group_id,
      r,
    ]),
  );

  const toInsert: Record<string, unknown>[] = [];
  const updateJobs: { id: string; patch: Record<string, unknown> }[] = [];

  for (const g of uniqueGroups) {
    const ex = byGid.get(g.id);
    if (!ex) {
      toInsert.push({
        user_id: userId,
        instance_name: instanceName,
        group_id: g.id,
        group_subject: g.subject || null,
        picture_url: g.pictureUrl || null,
        size: g.size ?? null,
      });
    } else {
      const subjectChanged = (ex.group_subject ?? null) !== (g.subject ?? null);
      const pictureChanged = (ex.picture_url ?? null) !== (g.pictureUrl ?? null);
      const sizeChanged = (ex.size ?? null) !== (g.size ?? null);
      if (subjectChanged || pictureChanged || sizeChanged) {
        updateJobs.push({
          id: ex.id,
          patch: {
            group_subject: g.subject || null,
            picture_url: g.pictureUrl || null,
            size: g.size ?? null,
            updated_at: new Date().toISOString(),
          },
        });
      }
    }
  }

  let inserted = 0;
  for (let i = 0; i < toInsert.length; i += INSERT_BATCH) {
    const chunk = toInsert.slice(i, i + INSERT_BATCH);
    const { error: insErr } = await supabase.from('whatsapp_groups').insert(chunk);
    if (!insErr) {
      inserted += chunk.length;
      continue;
    }
    if ((insErr as { code?: string }).code === '23505') {
      for (const row of chunk) {
        const { error: oneErr } = await supabase.from('whatsapp_groups').insert(row);
        if (!oneErr) inserted++;
        else if ((oneErr as { code?: string }).code !== '23505') {
          throw new Error(`Erro ao inserir grupo: ${oneErr.message}`);
        }
      }
    } else {
      throw new Error(`Erro ao inserir grupos: ${insErr.message}`);
    }
  }

  let updated = 0;
  for (let i = 0; i < updateJobs.length; i += UPDATE_CONCURRENCY) {
    const slice = updateJobs.slice(i, i + UPDATE_CONCURRENCY);
    await Promise.all(
      slice.map(async ({ id, patch }) => {
        const { error: upErr } = await supabase.from('whatsapp_groups').update(patch).eq('id', id);
        if (!upErr) updated++;
      }),
    );
  }

  return { inserted, updated };
}

export async function fetchGroupsFromEvolution(
  instanceName: string,
  apiKey: string,
  baseUrl: string,
  timeoutMs: number,
): Promise<NormalizedEvolutionGroup[]> {
  const normalizedBase = normalizeBaseUrl(baseUrl);
  const url = `${normalizedBase}/group/fetchAllGroups/${instanceName}?getParticipants=false`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let resp: Response;
  try {
    resp = await fetch(url.replace(/([^:]\/)\/+/g, '$1'), {
      method: 'GET',
      headers: { apikey: apiKey },
      signal: controller.signal,
      cache: 'no-store',
    });
    clearTimeout(timeoutId);
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    const e = err as { name?: string; message?: string };
    if (e?.name === 'AbortError') {
      throw new Error(`Timeout ao buscar grupos na Evolution (${timeoutMs}ms)`);
    }
    throw err;
  }

  if (!resp.ok) {
    const errorText = await resp.text().catch(() => '');
    throw new Error(`Evolution fetchAllGroups: HTTP ${resp.status} ${errorText.substring(0, 300)}`);
  }

  const contentType = resp.headers.get('content-type');
  if (!contentType || !contentType.includes('application/json')) {
    const text = await resp.text();
    throw new Error(`Resposta Evolution não é JSON: ${text.substring(0, 200)}`);
  }

  const json = await resp.json();
  return normalizeEvolutionGroupsPayload(json);
}

/**
 * Marca job como running apenas se ainda estiver pending (claim).
 */
export async function claimGroupFetchJob(supabase: SupabaseClient, jobId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('group_fetch_jobs')
    .update({ status: 'running', updated_at: new Date().toISOString() })
    .eq('id', jobId)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('[group-fetch] claim error', error);
    return false;
  }
  return !!data;
}

export async function executeGroupFetchJob(supabase: SupabaseClient, jobId: string): Promise<void> {
  const { data: job, error: jobErr } = await supabase
    .from('group_fetch_jobs')
    .select('id, user_id, instance_name, status')
    .eq('id', jobId)
    .single();

  if (jobErr || !job) {
    throw new Error(jobErr?.message || 'Job não encontrado');
  }

  if (job.status !== 'running') {
    return;
  }

  const userId = String(job.user_id);
  const instanceName = String(job.instance_name);

  const { data: instance, error: instanceError } = await supabase
    .from('evolution_instances')
    .select(
      `
        *,
        evolution_apis!inner (
          id,
          base_url,
          is_active
        )
      `,
    )
    .eq('instance_name', instanceName)
    .eq('is_active', true)
    .eq('evolution_apis.is_active', true)
    .single();

  if (instanceError || !instance) {
    const msg = 'Instância não encontrada ou inativa';
    await supabase
      .from('group_fetch_jobs')
      .update({
        status: 'failed',
        error_message: msg,
        updated_at: new Date().toISOString(),
      })
      .eq('id', jobId);
    throw new Error(msg);
  }

  const instanceApikey = instance.apikey as string | null;
  if (!instanceApikey) {
    const msg = 'Instância sem apikey';
    await supabase
      .from('group_fetch_jobs')
      .update({
        status: 'failed',
        error_message: msg,
        updated_at: new Date().toISOString(),
      })
      .eq('id', jobId);
    throw new Error(msg);
  }

  const evolutionApi = Array.isArray(instance.evolution_apis) ? instance.evolution_apis[0] : instance.evolution_apis;
  const baseUrl = evolutionApi?.base_url as string | undefined;
  if (!baseUrl) {
    const msg = 'Evolution API sem base_url';
    await supabase
      .from('group_fetch_jobs')
      .update({
        status: 'failed',
        error_message: msg,
        updated_at: new Date().toISOString(),
      })
      .eq('id', jobId);
    throw new Error(msg);
  }

  let uniqueGroups: NormalizedEvolutionGroup[];
  try {
    uniqueGroups = await fetchGroupsFromEvolution(
      instanceName,
      instanceApikey,
      baseUrl,
      EVOLUTION_GROUP_FETCH_TIMEOUT_MS,
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    await supabase
      .from('group_fetch_jobs')
      .update({
        status: 'failed',
        error_message: msg,
        updated_at: new Date().toISOString(),
      })
      .eq('id', jobId);
    throw e;
  }

  const { inserted, updated } = await persistWhatsappGroupsBatch(supabase, userId, instanceName, uniqueGroups);

  const summary = `${uniqueGroups.length} grupo(s) encontrado(s). ${inserted} inseridos, ${updated} atualizados.`;
  await supabase
    .from('group_fetch_jobs')
    .update({
      status: 'completed',
      total_groups: uniqueGroups.length,
      inserted_count: inserted,
      updated_count: updated,
      message: summary,
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId);
}
