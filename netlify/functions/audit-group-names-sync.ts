/**
 * Netlify Scheduled Function: audit-group-names-sync
 * Processa jobs de sincronização de nomes de grupos em segundo plano.
 * Evita timeout em consultas grandes.
 * BATCH_SIZE: máx grupos por execução (~2–3s cada = ~45s total)
 */

import { createClient } from '@supabase/supabase-js';

const BATCH_SIZE = 15;
const LOG_PREFIX = '[audit-group-names-sync]';

function normalizeBaseUrl(baseUrl: string): string {
  if (!baseUrl) return baseUrl;
  return baseUrl.trim().replace(/\/+$/, '').replace(/([^:]\/)\/+/g, '$1');
}

function parseSubject(data: any): string | null {
  const s =
    data?.subject ??
    data?.data?.subject ??
    data?.name ??
    data?.data?.name ??
    data?.groupMetadata?.subject ??
    null;
  return s != null ? String(s).trim() || null : null;
}

export async function handler(
  _event: { httpMethod?: string; path?: string },
  _context: { functionName?: string }
): Promise<{ statusCode: number; body: string }> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Missing Supabase env' }) };
  }

  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, { auth: { persistSession: false } });

  const { data: jobs, error: jobsError } = await supabase
    .from('audit_group_names_sync_jobs')
    .select('id, instance_name, group_jids, processed_count, status')
    .in('status', ['pending', 'running'])
    .order('created_at', { ascending: true })
    .limit(1);

  if (jobsError || !jobs?.length) {
    return { statusCode: 200, body: JSON.stringify({ processed: 0 }) };
  }

  const job = jobs[0] as { id: string; instance_name: string; group_jids: string[]; processed_count: number; status: string };
  const groupJids = Array.isArray(job.group_jids) ? job.group_jids : [];
  const processed = job.processed_count || 0;
  const remaining = groupJids.slice(processed);
  const batch = remaining.slice(0, BATCH_SIZE);

  if (batch.length === 0) {
    await supabase
      .from('audit_group_names_sync_jobs')
      .update({ status: 'completed', updated_at: new Date().toISOString() })
      .eq('id', job.id);
    return { statusCode: 200, body: JSON.stringify({ processed: 0, completed: 1 }) };
  }

  await supabase
    .from('audit_group_names_sync_jobs')
    .update({ status: 'running', updated_at: new Date().toISOString() })
    .eq('id', job.id);

  const { data: instance, error: instError } = await supabase
    .from('evolution_instances')
    .select(`
      id,
      instance_name,
      evolution_api_id,
      evolution_apis!inner ( base_url, api_key_global )
    `)
    .eq('instance_name', job.instance_name)
    .eq('is_active', true)
    .single();

  if (instError || !instance) {
    await supabase
      .from('audit_group_names_sync_jobs')
      .update({
        status: 'error',
        error_message: 'Instância não encontrada ou inativa',
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id);
    return { statusCode: 200, body: JSON.stringify({ processed: 0, error: 'Instance not found' }) };
  }

  const evolutionApi = Array.isArray((instance as any).evolution_apis)
    ? (instance as any).evolution_apis[0]
    : (instance as any).evolution_apis;
  const baseUrl = evolutionApi?.base_url;
  const apiKey = evolutionApi?.api_key_global;

  if (!baseUrl || !apiKey) {
    await supabase
      .from('audit_group_names_sync_jobs')
      .update({
        status: 'error',
        error_message: 'Evolution API sem base_url ou api_key',
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id);
    return { statusCode: 200, body: JSON.stringify({ processed: 0, error: 'Evolution API config missing' }) };
  }

  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  let saved = 0;

  for (const groupJid of batch) {
    const gid = String(groupJid).trim();
    if (!gid) continue;
    try {
      const url = `${normalizedBaseUrl}/group/findGroupInfos/${job.instance_name}?groupJid=${encodeURIComponent(gid)}`;
      const res = await fetch(url, {
        method: 'GET',
        headers: { apikey: apiKey },
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({}));
      const subject = parseSubject(data);
      const { error: upsertError } = await supabase
        .from('audit_group_names')
        .upsert(
          {
            group_id: gid,
            instance_name: job.instance_name,
            group_subject: subject ?? null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'group_id,instance_name', ignoreDuplicates: false }
        );
      if (!upsertError) saved++;
    } catch (e: any) {
      console.warn(`${LOG_PREFIX} group=${gid} error=${e?.message || e}`);
    }
  }

  const newProcessed = processed + batch.length;
  const isComplete = newProcessed >= groupJids.length;

  await supabase
    .from('audit_group_names_sync_jobs')
    .update({
      processed_count: newProcessed,
      status: isComplete ? 'completed' : 'pending',
      updated_at: new Date().toISOString(),
    })
    .eq('id', job.id);

  return {
    statusCode: 200,
    body: JSON.stringify({
      processed: batch.length,
      saved,
      jobId: job.id,
      totalProgress: `${newProcessed}/${groupJids.length}`,
      completed: isComplete ? 1 : 0,
    }),
  };
}
