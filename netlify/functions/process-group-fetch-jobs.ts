/**
 * Netlify Scheduled Function: fallback — reinvoca a Background Function para jobs pending.
 * Não executa o fetch aqui (evita timeout ~26s); só dispara o worker longo.
 */

interface HandlerResponse {
  statusCode: number;
  body: string;
  headers?: Record<string, string>;
}

export const handler = async (): Promise<HandlerResponse> => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const siteUrl = (process.env.URL || process.env.SITE_URL || '').replace(/\/$/, '');
  const secret = process.env.GROUP_FETCH_JOB_SECRET || '';

  if (!supabaseUrl || !supabaseKey || !siteUrl || !secret) {
    return {
      statusCode: 200,
      body: JSON.stringify({ ok: false, message: 'Config incompleta (URL, Supabase ou GROUP_FETCH_JOB_SECRET)' }),
      headers: { 'Content-Type': 'application/json' },
    };
  }

  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

  const { data: pending, error } = await supabase
    .from('group_fetch_jobs')
    .select('id')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(5);

  if (error || !pending?.length) {
    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, invoked: 0 }),
      headers: { 'Content-Type': 'application/json' },
    };
  }

  const endpoint = `${siteUrl}/.netlify/functions/groups-fetch-background`;
  let invoked = 0;

  for (const row of pending) {
    const jobId = row.id as string;
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-group-fetch-secret': secret,
        },
        body: JSON.stringify({ jobId }),
      });
      if (res.ok || res.status === 202) invoked++;
    } catch (e) {
      console.warn('[process-group-fetch-jobs] invoke failed', jobId, e);
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true, invoked, pending: pending.length }),
    headers: { 'Content-Type': 'application/json' },
  };
};
