/**
 * Netlify Scheduled Function: academy-vturb-snapshots
 *
 * Roda diariamente (ex: 0 2 * * *). Para cada aula publicada com vturb_player_id,
 * busca métricas do dia na API VTurb Analytics e salva em academy_vturb_snapshots.
 * Respeita rate limit (delay entre chamadas).
 */

import { createClient } from '@supabase/supabase-js';

const VTURB_BASE = 'https://analytics.vturb.net';
const token = process.env.VTURB_ANALYTICS_TOKEN;
const version = process.env.VTURB_ANALYTICS_VERSION || 'v1';
const timezone = process.env.VTURB_ANALYTICS_TIMEZONE || 'America/Sao_Paulo';
const DELAY_MS = 1500;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error('SUPABASE URL e SERVICE_ROLE_KEY obrigatórios');
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, { auth: { persistSession: false } });

async function vturbPost(path: string, body: Record<string, unknown>): Promise<unknown> {
  if (!token) throw new Error('VTURB_ANALYTICS_TOKEN não configurado');
  const res = await fetch(`${VTURB_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Token': token,
      'X-Api-Version': version,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`VTurb API ${res.status}: ${await res.text()}`);
  return res.json();
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export const handler = async () => {
  const today = new Date().toISOString().slice(0, 10);
  const results: { lessonId: string; playerId: string; ok: boolean; error?: string }[] = [];

  if (!token) {
    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'VTURB_ANALYTICS_TOKEN não configurado', saved: 0 }),
      headers: { 'Content-Type': 'application/json' },
    };
  }

  const { data: lessons, error: lessonsError } = await supabase
    .from('academy_lessons')
    .select('id, vturb_player_id')
    .eq('is_published', true)
    .not('vturb_player_id', 'is', null);

  if (lessonsError || !lessons?.length) {
    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Nenhuma aula VTurb publicada', saved: 0 }),
      headers: { 'Content-Type': 'application/json' },
    };
  }

  for (const lesson of lessons) {
    const playerId = lesson.vturb_player_id as string;
    if (!playerId) continue;
    try {
      const payload = await vturbPost('/events/total_by_company_day', {
        start_date: today,
        end_date: today,
        player_id: playerId,
        timezone,
      });
      await supabase.from('academy_vturb_snapshots').insert({
        lesson_id: lesson.id,
        player_id: playerId,
        date_start: today,
        date_end: today,
        payload: payload as Record<string, unknown>,
      });
      results.push({ lessonId: lesson.id, playerId, ok: true });
      await sleep(DELAY_MS);
    } catch (e: unknown) {
      const err = e instanceof Error ? e.message : String(e);
      results.push({ lessonId: lesson.id, playerId, ok: false, error: err });
    }
  }

  const saved = results.filter((r) => r.ok).length;
  return {
    statusCode: 200,
    body: JSON.stringify({ message: 'Snapshot concluído', saved, total: lessons.length, results }),
    headers: { 'Content-Type': 'application/json' },
  };
};
