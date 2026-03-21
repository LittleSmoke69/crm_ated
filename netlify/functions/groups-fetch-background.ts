/**
 * Netlify Background Function: processa um job de group_fetch_jobs.
 * Timeout longo (~15 min); invocado pela API Next após criar o job.
 */

import { createClient } from '@supabase/supabase-js';
import { claimGroupFetchJob, executeGroupFetchJob } from '../../lib/group-fetch/run-group-fetch-job';

interface HandlerEvent {
  httpMethod?: string;
  body?: string | null;
  headers?: Record<string, string | undefined>;
}

interface HandlerResponse {
  statusCode: number;
  body: string;
  headers?: Record<string, string>;
}

export const handler = async (event: HandlerEvent): Promise<HandlerResponse> => {
  const secret = process.env.GROUP_FETCH_JOB_SECRET || '';
  const hdr =
    event.headers?.['x-group-fetch-secret'] ||
    event.headers?.['X-Group-Fetch-Secret'] ||
    '';

  if (!secret || hdr !== secret) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: 'Unauthorized' }),
      headers: { 'Content-Type': 'application/json' },
    };
  }

  if (event.httpMethod && event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let jobId: string | undefined;
  try {
    const body = event.body ? JSON.parse(event.body) : {};
    jobId = typeof body.jobId === 'string' ? body.jobId : undefined;
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  if (!jobId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'jobId obrigatório' }) };
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!supabaseUrl || !supabaseKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Supabase não configurado' }) };
  }

  const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

  const claimed = await claimGroupFetchJob(supabase, jobId);
  if (!claimed) {
    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, skipped: true, reason: 'already_claimed_or_not_pending' }),
      headers: { 'Content-Type': 'application/json' },
    };
  }

  try {
    await executeGroupFetchJob(supabase, jobId);
  } catch (e: unknown) {
    console.error('[groups-fetch-background]', jobId, e);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      headers: { 'Content-Type': 'application/json' },
    };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true, jobId }),
    headers: { 'Content-Type': 'application/json' },
  };
};
