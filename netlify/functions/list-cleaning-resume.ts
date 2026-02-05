/**
 * Netlify Scheduled Function: list-cleaning-resume
 * Roda a cada 1 minuto. Busca list_cleaning_verification_runs com status = 'running'
 * e processa um slot (máx 10 números, delay 1.2–1.5s) por run. Evita timeout.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SLOT_SIZE = 10;
const WASENDER_BASE_URL = 'https://www.wasenderapi.com';
const LOG_PREFIX = '[list-cleaning-resume]';

const DELAY_MS_MIN = 1200;
const DELAY_MS_MAX = 1500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRandomDelayMs(): number {
  return DELAY_MS_MIN + Math.floor(Math.random() * (DELAY_MS_MAX - DELAY_MS_MIN + 1));
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '').slice(0, 15);
}

function maskPhone(phone: string): string {
  const n = normalizePhone(phone);
  if (n.length <= 6) return n;
  return n.slice(0, 4) + '…' + n.slice(-3);
}

async function checkWasender(
  apiKey: string,
  phone: string
): Promise<{ status: 'active' | 'inactive' | 'unknown'; raw: Record<string, unknown> }> {
  const normalized = normalizePhone(phone);
  const url = `${WASENDER_BASE_URL}/api/on-whatsapp/${encodeURIComponent('+' + normalized)}`;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        accept: 'application/json',
      },
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const data = body?.data as Record<string, unknown> | undefined;
    const hasExists = data != null && typeof data.exists === 'boolean';
    const existsValue = hasExists ? (data as { exists: boolean }).exists === true : false;
    const status: 'active' | 'inactive' | 'unknown' = hasExists
      ? existsValue ? 'active' : 'inactive'
      : 'unknown';
    const raw: Record<string, unknown> = {
      ...(data || body),
      checked_at: new Date().toISOString(),
      source: 'wasender',
      exists_defined: hasExists,
    };
    if (!hasExists) raw.error = res.ok ? 'Resposta sem data.exists' : { status: res.status };
    if (res.status === 429) {
      console.warn(`${LOG_PREFIX} [CRÍTICO] rate limit 429 phone=${maskPhone(phone)}`);
    }
    return { status, raw };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`${LOG_PREFIX} [CRÍTICO] check phone=${maskPhone(phone)} error=${msg}`);
    return {
      status: 'unknown',
      raw: { error: msg, checked_at: new Date().toISOString(), source: 'wasender', exists_defined: false },
    };
  }
}

// Aceita qualquer cliente Supabase (tabelas list_cleaning_* não estão nos tipos gerados)
async function refreshJobCounts(supabase: SupabaseClient, jobId: string): Promise<void> {
  const { count: verifiedCount } = await supabase
    .from('list_cleaning_items')
    .select('id', { count: 'exact', head: true })
    .eq('job_id', jobId)
    .eq('is_duplicate', false)
    .not('verified_at', 'is', null);
  const { count: activeCount } = await supabase
    .from('list_cleaning_items')
    .select('id', { count: 'exact', head: true })
    .eq('job_id', jobId)
    .eq('is_duplicate', false)
    .eq('whatsapp_status', 'active');
  const { count: notActiveCount } = await supabase
    .from('list_cleaning_items')
    .select('id', { count: 'exact', head: true })
    .eq('job_id', jobId)
    .eq('is_duplicate', false)
    .in('whatsapp_status', ['inactive', 'unknown']);
  const { data: job } = await supabase
    .from('list_cleaning_jobs')
    .select('total_unique')
    .eq('id', jobId)
    .single();
  const jobRow = job as { total_unique?: number } | null;
  const totalUnique = jobRow?.total_unique ?? 0;
  const verified = verifiedCount ?? 0;
  const pending = Math.max(0, totalUnique - verified);
  const updatePayload = {
    verified_count: verified,
    validated_count: activeCount ?? 0,
    not_validated_count: notActiveCount ?? 0,
    pending_count: pending,
    updated_at: new Date().toISOString(),
  };
  await supabase.from('list_cleaning_jobs').update(updatePayload).eq('id', jobId);
}

export async function handler(
  _event: { httpMethod?: string; path?: string },
  _context: { functionName?: string }
): Promise<{ statusCode: number; body: string }> {
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Missing Supabase env' }) };
  }
  const apiKey = process.env.WASENDER_API_KEY || '';
  if (!apiKey) {
    return { statusCode: 200, body: JSON.stringify({ processed: 0, error: 'WASENDER_API_KEY missing' }) };
  }

  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, { auth: { persistSession: false } });

  const { data: runs, error: runsError } = await supabase
    .from('list_cleaning_verification_runs')
    .select('id, job_id, total_numbers, processed_numbers, current_slot')
    .eq('status', 'running')
    .limit(3);

  if (runsError || !runs?.length) {
    return { statusCode: 200, body: JSON.stringify({ processed: 0 }) };
  }

  let slotsProcessed = 0;
  for (const run of runs) {
    const jobId = run.job_id;
    const { data: pendingItems } = await supabase
      .from('list_cleaning_items')
      .select('id, phone')
      .eq('job_id', jobId)
      .eq('is_duplicate', false)
      .is('verified_at', null)
      .order('created_at', { ascending: true })
      .limit(SLOT_SIZE);

    if (!pendingItems?.length) {
      await refreshJobCounts(supabase, jobId);
      await supabase
        .from('list_cleaning_verification_runs')
        .update({ status: 'completed', updated_at: new Date().toISOString() } as any)
        .eq('id', run.id);
      await supabase
        .from('list_cleaning_jobs')
        .update({ status: 'done', pending_count: 0, next_run_at: null, updated_at: new Date().toISOString() } as any)
        .eq('id', jobId);
      slotsProcessed++;
      continue;
    }

    for (const item of pendingItems) {
      const result = await checkWasender(apiKey, item.phone);
      await supabase
        .from('list_cleaning_items')
        .update({
          whatsapp_status: result.status,
          verified_at: new Date().toISOString(),
          raw_payload: { ...result.raw, checked_at: new Date().toISOString(), source: 'wasender' },
        } as any)
        .eq('id', item.id);
      await sleep(getRandomDelayMs());
    }

    const newProcessed = run.processed_numbers + pendingItems.length;
    const hasMore = newProcessed < run.total_numbers;

    await supabase
      .from('list_cleaning_verification_runs')
      .update({
        processed_numbers: newProcessed,
        current_slot: run.current_slot + 1,
        status: hasMore ? 'running' : 'completed',
        updated_at: new Date().toISOString(),
      } as any)
      .eq('id', run.id);

    await refreshJobCounts(supabase, jobId);

    if (!hasMore) {
      await supabase
        .from('list_cleaning_verification_runs')
        .update({ status: 'completed', updated_at: new Date().toISOString() } as any)
        .eq('id', run.id);
      await supabase
        .from('list_cleaning_jobs')
        .update({ status: 'done', pending_count: 0, next_run_at: null, updated_at: new Date().toISOString() } as any)
        .eq('id', jobId);
    }
    slotsProcessed++;
  }

  return { statusCode: 200, body: JSON.stringify({ processed: slotsProcessed }) };
}
