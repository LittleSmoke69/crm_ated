/**
 * Netlify Scheduled Function: fallback para jobs de group_fetch_jobs.
 *
 * 1. Marca jobs "running" há mais de 15 min como "failed" (stale detection).
 * 2. Para cada job "pending":
 *    a. Tenta disparar a Background Function (timeout longo).
 *    b. Se o trigger falhar e o job estiver pendente há > 2 min, tenta executar diretamente
 *       com timeout curto (20s na Evolution API) — funciona para instâncias com poucos grupos.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const LOG = '[process-group-fetch-jobs]';
const STALE_RUNNING_MS = 15 * 60 * 1000;
const DIRECT_EXEC_AFTER_MS = 2 * 60 * 1000;
const DIRECT_EVOLUTION_TIMEOUT_MS = 18_000;

interface HandlerResponse {
  statusCode: number;
  body: string;
  headers?: Record<string, string>;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '').replace(/([^:]\/)\/+/g, '$1');
}

function normalizeGroupId(groupId: string): string {
  if (!groupId || typeof groupId !== 'string') return '';
  let id = groupId.trim();
  if (!id) return '';
  if (!id.endsWith('@g.us')) {
    if (/^[\d\-]+$/.test(id) || /^[\d\-]+@?$/.test(id)) {
      id = id.replace(/@$/, '') + '@g.us';
    }
  }
  return id;
}

function normalizeEvolutionGroups(json: unknown): Array<{ id: string; subject?: string | null; pictureUrl?: string | null; size?: number | null }> {
  let list: any[] = [];
  if (Array.isArray(json)) list = json;
  else if (json && typeof json === 'object') {
    const o = json as Record<string, unknown>;
    if (Array.isArray(o.groups)) list = o.groups;
    else if (Array.isArray(o.data)) list = o.data;
    else if (Array.isArray(o.result)) list = o.result;
    else if (o.id && o.subject) list = [o];
  }
  const map = new Map<string, { id: string; subject?: string | null; pictureUrl?: string | null; size?: number | null }>();
  for (const g of list) {
    const rawId = g?.id ?? g?.remoteJid ?? g?.group_id ?? '';
    const id = normalizeGroupId(String(rawId));
    if (!id || map.has(id)) continue;
    map.set(id, {
      id,
      subject: g?.subject ?? g?.group_subject ?? null,
      pictureUrl: g?.pictureUrl ?? g?.picture_url ?? null,
      size: g?.size ?? null,
    });
  }
  return Array.from(map.values());
}

async function markStaleJobs(supabase: SupabaseClient): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_RUNNING_MS).toISOString();
  const { data } = await supabase
    .from('group_fetch_jobs')
    .update({
      status: 'failed',
      error_message: 'Job travou (running por mais de 15 min). Tente novamente.',
      updated_at: new Date().toISOString(),
    })
    .eq('status', 'running')
    .lt('updated_at', cutoff)
    .select('id');

  return data?.length ?? 0;
}

async function tryTriggerBackground(siteUrl: string, secret: string, jobId: string): Promise<boolean> {
  const url = `${siteUrl}/.netlify/functions/groups-fetch-background`;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-group-fetch-secret': secret,
      },
      body: JSON.stringify({ jobId }),
      signal: controller.signal,
    });
    clearTimeout(t);
    return res.ok || res.status === 202;
  } catch {
    clearTimeout(t);
    return false;
  }
}

async function executeJobDirectly(
  supabase: SupabaseClient,
  jobId: string,
): Promise<boolean> {
  const { data: claimed } = await supabase
    .from('group_fetch_jobs')
    .update({ status: 'running', updated_at: new Date().toISOString() })
    .eq('id', jobId)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle();

  if (!claimed) return false;

  const { data: job } = await supabase
    .from('group_fetch_jobs')
    .select('id, user_id, instance_name')
    .eq('id', jobId)
    .single();

  if (!job) return false;

  const userId = String(job.user_id);
  const instanceName = String(job.instance_name);

  const { data: instance, error: instErr } = await supabase
    .from('evolution_instances')
    .select(`*, evolution_apis!inner ( id, base_url, is_active )`)
    .eq('instance_name', instanceName)
    .eq('is_active', true)
    .eq('evolution_apis.is_active', true)
    .single();

  if (instErr || !instance) {
    await supabase.from('group_fetch_jobs').update({
      status: 'failed',
      error_message: 'Instância não encontrada ou inativa',
      updated_at: new Date().toISOString(),
    }).eq('id', jobId);
    return false;
  }

  const apikey = (instance as any).apikey as string | null;
  if (!apikey) {
    await supabase.from('group_fetch_jobs').update({
      status: 'failed',
      error_message: 'Instância sem apikey',
      updated_at: new Date().toISOString(),
    }).eq('id', jobId);
    return false;
  }

  const evoApi = Array.isArray((instance as any).evolution_apis) ? (instance as any).evolution_apis[0] : (instance as any).evolution_apis;
  const baseUrl = evoApi?.base_url as string | undefined;
  if (!baseUrl) {
    await supabase.from('group_fetch_jobs').update({
      status: 'failed',
      error_message: 'Evolution API sem base_url',
      updated_at: new Date().toISOString(),
    }).eq('id', jobId);
    return false;
  }

  const normalizedBase = normalizeBaseUrl(baseUrl);
  const fetchUrl = `${normalizedBase}/group/fetchAllGroups/${instanceName}?getParticipants=false`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DIRECT_EVOLUTION_TIMEOUT_MS);

  let groups: Array<{ id: string; subject?: string | null; pictureUrl?: string | null; size?: number | null }>;
  try {
    const resp = await fetch(fetchUrl.replace(/([^:]\/)\/+/g, '$1'), {
      method: 'GET',
      headers: { apikey: apikey },
      signal: controller.signal,
      cache: 'no-store',
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      throw new Error(`HTTP ${resp.status} ${errText.substring(0, 200)}`);
    }

    const json = await resp.json();
    groups = normalizeEvolutionGroups(json);
  } catch (err: unknown) {
    clearTimeout(timeout);
    const msg = err instanceof Error ? err.message : String(err);
    const isAbort = (err as any)?.name === 'AbortError';

    if (isAbort) {
      await supabase.from('group_fetch_jobs').update({
        status: 'pending',
        error_message: null,
        updated_at: new Date().toISOString(),
      }).eq('id', jobId);
      console.warn(`${LOG} Direct exec timeout for ${jobId} — reset to pending for background retry`);
      return false;
    }

    await supabase.from('group_fetch_jobs').update({
      status: 'failed',
      error_message: msg.substring(0, 500),
      updated_at: new Date().toISOString(),
    }).eq('id', jobId);
    return false;
  }

  const existingQuery = await supabase
    .from('whatsapp_groups')
    .select('id, group_id, group_subject, picture_url, size')
    .eq('user_id', userId)
    .eq('instance_name', instanceName);

  const byGid = new Map(
    (existingQuery.data || []).map((r: any) => [r.group_id, r]),
  );

  let inserted = 0;
  let updated = 0;

  for (const g of groups) {
    const ex = byGid.get(g.id);
    if (!ex) {
      const { error: insErr } = await supabase.from('whatsapp_groups').insert({
        user_id: userId,
        instance_name: instanceName,
        group_id: g.id,
        group_subject: g.subject || null,
        picture_url: g.pictureUrl || null,
        size: g.size ?? null,
      });
      if (!insErr) inserted++;
      else if ((insErr as any).code !== '23505') {
        console.warn(`${LOG} Insert error`, insErr.message);
      }
    } else {
      const changed =
        (ex.group_subject ?? null) !== (g.subject ?? null) ||
        (ex.picture_url ?? null) !== (g.pictureUrl ?? null) ||
        (ex.size ?? null) !== (g.size ?? null);
      if (changed) {
        const { error: upErr } = await supabase.from('whatsapp_groups').update({
          group_subject: g.subject || null,
          picture_url: g.pictureUrl || null,
          size: g.size ?? null,
          updated_at: new Date().toISOString(),
        }).eq('id', ex.id);
        if (!upErr) updated++;
      }
    }
  }

  await supabase.from('group_fetch_jobs').update({
    status: 'completed',
    total_groups: groups.length,
    inserted_count: inserted,
    updated_count: updated,
    message: `${groups.length} grupo(s). ${inserted} inseridos, ${updated} atualizados.`,
    updated_at: new Date().toISOString(),
  }).eq('id', jobId);

  console.log(`${LOG} Direct exec completed: jobId=${jobId} groups=${groups.length}`);
  return true;
}

export const handler = async (): Promise<HandlerResponse> => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const siteUrl = (process.env.URL || process.env.SITE_URL || '').replace(/\/$/, '');
  const secret = process.env.GROUP_FETCH_JOB_SECRET || '';

  if (!supabaseUrl || !supabaseKey) {
    return {
      statusCode: 200,
      body: JSON.stringify({ ok: false, message: 'Supabase não configurado' }),
      headers: { 'Content-Type': 'application/json' },
    };
  }

  const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

  const staleCount = await markStaleJobs(supabase);
  if (staleCount > 0) {
    console.log(`${LOG} Marked ${staleCount} stale job(s) as failed`);
  }

  const { data: pending, error } = await supabase
    .from('group_fetch_jobs')
    .select('id, created_at')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(5);

  if (error || !pending?.length) {
    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, invoked: 0, stale: staleCount }),
      headers: { 'Content-Type': 'application/json' },
    };
  }

  let invoked = 0;
  let directExec = 0;

  for (const row of pending) {
    const jobId = row.id as string;
    const createdAt = new Date(row.created_at as string).getTime();
    const age = Date.now() - createdAt;

    if (siteUrl && secret) {
      const triggered = await tryTriggerBackground(siteUrl, secret, jobId);
      if (triggered) {
        invoked++;
        continue;
      }
    }

    if (age > DIRECT_EXEC_AFTER_MS) {
      console.log(`${LOG} Background trigger failed, attempting direct exec for jobId=${jobId} (age=${Math.round(age / 1000)}s)`);
      const ok = await executeJobDirectly(supabase, jobId);
      if (ok) directExec++;
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true, invoked, directExec, pending: pending.length, stale: staleCount }),
    headers: { 'Content-Type': 'application/json' },
  };
};
