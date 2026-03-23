import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

const SOURCE = 'whatsapp_official';

export async function GET(_req: NextRequest) {
  try {
    const { userId } = await requireAuth(_req);

    const { data: profile } = await supabaseServiceRole
      .from('profiles')
      .select('status')
      .eq('id', userId)
      .single();

    const canAccess = profile?.status === 'super_admin' || profile?.status === 'admin';
    if (!canAccess) {
      return errorResponse('Acesso negado. Apenas administradores podem acessar.', 403);
    }

    const { data: configs, error: cfgErr } = await supabaseServiceRole
      .from('whatsapp_official_configs')
      .select('id, name, phone_number_id, graph_version, is_active')
      .order('created_at', { ascending: false });

    if (cfgErr) return errorResponse(`Erro ao carregar configs: ${cfgErr.message}`, 500);

    const configList = configs ?? [];
    const configByPhone = new Map<string, { id: string; name: string; phone_number_id: string; graph_version: string; is_active: boolean }>();
    for (const c of configList as Array<{ id: string; name: string; phone_number_id: string; graph_version: string; is_active: boolean }>) {
      configByPhone.set(String(c.phone_number_id || '').trim(), c);
    }

    const { data: pendingEvents } = await supabaseServiceRole
      .from('webhook_events')
      .select('id, raw_payload, created_at')
      .eq('source', SOURCE)
      .is('processed_at', null)
      .order('created_at', { ascending: true })
      .limit(5000);

    const { data: recentEvents } = await supabaseServiceRole
      .from('webhook_events')
      .select('id, raw_payload, created_at')
      .eq('source', SOURCE)
      .gte('created_at', new Date(Date.now() - 60 * 60 * 1000).toISOString())
      .order('created_at', { ascending: false })
      .limit(5000);

    const { data: failedAudio } = await supabaseServiceRole
      .from('chat_messages')
      .select('id, whatsapp_config_id')
      .eq('provider', 'whatsapp_official')
      .eq('media_type', 'audio')
      .eq('status', 'failed')
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .limit(5000);

    const statsByConfigId: Record<string, {
      recent_events_1h: number;
      pending_events: number;
      oldest_pending_at: string | null;
      failed_audio_24h: number;
    }> = {};

    for (const c of configList as Array<{ id: string }>) {
      statsByConfigId[c.id] = {
        recent_events_1h: 0,
        pending_events: 0,
        oldest_pending_at: null,
        failed_audio_24h: 0,
      };
    }

    const resolveConfigIdFromPayload = (rawPayload: unknown): string | null => {
      if (!rawPayload || typeof rawPayload !== 'object') return null;
      const entry = (rawPayload as { entry?: unknown[] }).entry;
      if (!Array.isArray(entry) || entry.length === 0) return null;
      const changes = (entry[0] as { changes?: unknown[] }).changes;
      if (!Array.isArray(changes) || changes.length === 0) return null;
      const value = (changes[0] as { value?: { metadata?: { phone_number_id?: string } } }).value;
      const phoneNumberId = String(value?.metadata?.phone_number_id || '').trim();
      if (!phoneNumberId) return null;
      return configByPhone.get(phoneNumberId)?.id ?? null;
    };

    for (const ev of recentEvents ?? []) {
      const configId = resolveConfigIdFromPayload((ev as { raw_payload?: unknown }).raw_payload);
      if (!configId || !statsByConfigId[configId]) continue;
      statsByConfigId[configId].recent_events_1h += 1;
    }

    for (const ev of pendingEvents ?? []) {
      const configId = resolveConfigIdFromPayload((ev as { raw_payload?: unknown }).raw_payload);
      if (!configId || !statsByConfigId[configId]) continue;
      statsByConfigId[configId].pending_events += 1;
      const createdAt = (ev as { created_at?: string }).created_at ?? null;
      if (!createdAt) continue;
      const currentOldest = statsByConfigId[configId].oldest_pending_at;
      if (!currentOldest || new Date(createdAt).getTime() < new Date(currentOldest).getTime()) {
        statsByConfigId[configId].oldest_pending_at = createdAt;
      }
    }

    for (const row of failedAudio ?? []) {
      const configId = (row as { whatsapp_config_id?: string | null }).whatsapp_config_id;
      if (!configId || !statsByConfigId[configId]) continue;
      statsByConfigId[configId].failed_audio_24h += 1;
    }

    const nowMs = Date.now();
    const health = (configList as Array<{ id: string; name: string; phone_number_id: string; graph_version: string; is_active: boolean }>)
      .map((c) => {
        const stats = statsByConfigId[c.id];
        const lagSeconds = stats.oldest_pending_at
          ? Math.floor((nowMs - new Date(stats.oldest_pending_at).getTime()) / 1000)
          : 0;
        return {
          config_id: c.id,
          config_name: c.name,
          phone_number_id: c.phone_number_id,
          graph_version: c.graph_version || 'v25.0',
          is_active: c.is_active,
          recent_events_1h: stats.recent_events_1h,
          pending_events: stats.pending_events,
          oldest_pending_at: stats.oldest_pending_at,
          processing_lag_seconds: lagSeconds,
          failed_audio_24h: stats.failed_audio_24h,
        };
      });

    return successResponse(health);
  } catch (err) {
    return serverErrorResponse(err as Error);
  }
}

