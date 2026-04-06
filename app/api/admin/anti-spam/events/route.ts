/**
 * GET /api/admin/anti-spam/events
 * Lista eventos de entrada em grupos (group-participants.update, action: add).
 * Usado para o usuário ver números que entraram e adicionar à lista negra.
 * RBAC: super_admin, admin, auditoria.
 *
 * Query: config_id, limit (default 50)
 */

import { NextRequest } from 'next/server';
import { requireAntiSpamAccess } from '@/lib/middleware/permissions';
import { successResponse, errorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { createAntiSpamGroupLabelResolver, subjectFromParticipantsPayload } from '@/lib/anti-spam/event-group-label';
import { normalizeToE164BR } from '@/lib/utils/phone-utils';

const EVENT_TYPES = ['group-participants.update', 'group.update', 'GROUP_PARTICIPANTS_UPDATE'];

function getAction(p: any): 'add' | 'remove' | null {
  const a = p?.data?.action ?? p?.action ?? null;
  if (a === 'add' || a === 'remove') return a;
  const s = String(a || '').toLowerCase();
  if (s === 'add') return 'add';
  if (s === 'remove') return 'remove';
  return null;
}

function getGroupId(p: any, remoteJid: string | null): string {
  return p?.data?.id ?? p?.data?.key?.remoteJid ?? p?.data?.groupJid ?? remoteJid ?? '';
}

function getPhones(p: any): string[] {
  const participants = p?.data?.participants ?? p?.participants ?? [];
  const arr = Array.isArray(participants) ? participants : [participants];
  const phones: string[] = [];
  for (const x of arr) {
    const raw = x?.phoneNumber ?? x?.id ?? x?.jid ?? (typeof x === 'string' ? x : null);
    if (!raw) continue;
    const cleaned = String(raw).replace(/@s\.whatsapp\.net/i, '').replace(/\D/g, '').trim();
    if (cleaned) phones.push(cleaned);
    else phones.push(String(raw));
  }
  return phones;
}

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;
const RAW_FETCH_MULTIPLIER = 30;

export async function GET(req: NextRequest) {
  try {
    await requireAntiSpamAccess(req);
    const configId = req.nextUrl.searchParams.get('config_id')?.trim();
    const page = Math.max(1, parseInt(req.nextUrl.searchParams.get('page') || '1', 10));
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(req.nextUrl.searchParams.get('limit') || String(DEFAULT_LIMIT), 10)));

    if (!configId) {
      return errorResponse('config_id é obrigatório', 400);
    }

    const { data: config, error: cfgErr } = await supabaseServiceRole
      .from('anti_spam_configs')
      .select('id, master_instance_id, watcher_instance_id')
      .eq('id', configId)
      .single();

    if (cfgErr || !config) {
      return errorResponse('Configuração não encontrada', 404);
    }

    const instanceIds = [config.master_instance_id].filter(Boolean);
    if (config.watcher_instance_id) instanceIds.push(config.watcher_instance_id);

    const { data: instances } = await supabaseServiceRole
      .from('evolution_instances')
      .select('id, instance_name')
      .in('id', instanceIds);

    const instanceNames = (instances || []).map((i: any) => i.instance_name).filter(Boolean);
    if (instanceNames.length === 0) {
      return successResponse([], { pagination: { total: 0 } });
    }

    const rawLimit = Math.min(500, limit * RAW_FETCH_MULTIPLIER);
    const { data: rows, error } = await supabaseServiceRole
      .from('evolution_webhook_events')
      .select('id, received_at, env, event_type, instance_name, remote_jid, payload')
      .in('event_type', EVENT_TYPES)
      .in('instance_name', instanceNames)
      .eq('env', 'prod')
      .order('received_at', { ascending: false })
      .limit(rawLimit);

    if (error) {
      return errorResponse(error.message, 500);
    }

    const items: {
      id: string;
      received_at: string;
      group_id: string;
      phone: string;
      instance_name: string;
      payload_subject: string | null;
    }[] = [];
    const seen = new Set<string>();

    for (const r of rows || []) {
      const payload = r.payload || {};
      const action = getAction(payload);
      if (action !== 'add') continue;

      const groupId = getGroupId(payload, r.remote_jid);
      if (!groupId || !groupId.includes('@g.us')) continue;

      const instanceName = String((r as { instance_name?: string }).instance_name || '');
      const payloadSubject = subjectFromParticipantsPayload(payload);

      const phones = getPhones(payload);
      for (const phone of phones) {
        if (!phone) continue;
        const brE164 = normalizeToE164BR(phone);
        if (!brE164) continue;
        const phoneDigits = brE164.replace(/^\+/, '');
        const key = `${groupId}|${phoneDigits}|${r.received_at}`;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push({
          id: r.id,
          received_at: r.received_at,
          group_id: groupId,
          phone: phoneDigits,
          instance_name: instanceName,
          payload_subject: payloadSubject,
        });
      }
    }

    const groupIds = [...new Set(items.map((i) => i.group_id))];
    const resolveLabel = await createAntiSpamGroupLabelResolver(supabaseServiceRole, {
      configId,
      groupIds,
      userId: null,
    });

    const enriched = items.map((r) => {
      const resolved = resolveLabel(r.group_id, r.instance_name);
      const group_subject = resolved || r.payload_subject || null;
      return {
        id: r.id,
        received_at: r.received_at,
        group_id: r.group_id,
        group_subject,
        phone: r.phone,
      };
    });

    const total = enriched.length;
    const from = (page - 1) * limit;
    const paged = enriched.slice(from, from + limit);

    return successResponse(paged, {
      pagination: { total, page, limit },
    });
  } catch (err: any) {
    return errorResponse(err.message || 'Não autorizado', 401);
  }
}
