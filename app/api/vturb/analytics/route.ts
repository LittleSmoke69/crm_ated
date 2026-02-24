import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

const VTURB_BASE = 'https://analytics.vturb.net';
const token = process.env.VTURB_ANALYTICS_TOKEN;
const version = process.env.VTURB_ANALYTICS_VERSION || 'v1';

async function vturbFetch(path: string, body: Record<string, unknown>) {
  if (!token) {
    throw new Error('VTURB_ANALYTICS_TOKEN não configurado');
  }
  const res = await fetch(`${VTURB_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Token': token,
      'X-Api-Version': version,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`VTurb API ${res.status}: ${text}`);
  }
  return res.json();
}

/**
 * POST /api/vturb/analytics
 * Body: { type: 'events' | 'engagement' | 'clicks' | 'conversions', playerId?, startDate, endDate, timezone?, events?, videoDuration? }
 * Admin only. Chama VTurb Analytics e opcionalmente grava snapshot.
 */
export async function POST(req: NextRequest) {
  try {
    await requireAdmin(req);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 });
  }
  let body: {
    type: 'events' | 'engagement' | 'clicks' | 'conversions';
    playerId?: string;
    lessonId?: string;
    startDate: string;
    endDate: string;
    timezone?: string;
    events?: string[];
    videoDuration?: number;
    saveSnapshot?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body JSON inválido' }, { status: 400 });
  }
  const { type, playerId, lessonId, startDate, endDate, timezone = 'America/Sao_Paulo', events, videoDuration, saveSnapshot } = body;
  if (!type || !startDate || !endDate) {
    return NextResponse.json({ error: 'type, startDate e endDate obrigatórios' }, { status: 400 });
  }
  if (!token) {
    return NextResponse.json({ error: 'VTURB_ANALYTICS_TOKEN não configurado' }, { status: 503 });
  }
  try {
    let payload: Record<string, unknown> = { start_date: startDate, end_date: endDate, timezone };
    if (playerId) payload.player_id = playerId;
    if (videoDuration != null) payload.video_duration = videoDuration;
    if (events && type === 'events') payload.events = events;

    let result: unknown;
    switch (type) {
      case 'events':
        result = await vturbFetch('/events/total_by_company_day', payload);
        break;
      case 'engagement':
        result = await vturbFetch('/times/user_engagement', payload);
        break;
      case 'clicks':
        result = await vturbFetch('/clicks/total_by_company_timed', payload);
        break;
      case 'conversions':
        result = await vturbFetch('/conversions/stats_by_day', payload);
        break;
      default:
        return NextResponse.json({ error: 'type inválido' }, { status: 400 });
    }

    if (saveSnapshot && playerId && lessonId) {
      await supabaseServiceRole.from('academy_vturb_snapshots').insert({
        lesson_id: lessonId,
        player_id: playerId,
        date_start: startDate,
        date_end: endDate,
        payload: result as Record<string, unknown>,
      });
    }
    return NextResponse.json(result);
  } catch (e) {
    console.error('[vturb/analytics]', e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
