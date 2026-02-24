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

    const items: { id: string; received_at: string; group_id: string; group_subject: string | null; phone: string }[] = [];
    const seen = new Set<string>();

    for (const r of rows || []) {
      const payload = r.payload || {};
      const action = getAction(payload);
      if (action !== 'add') continue;

      const groupId = getGroupId(payload, r.remote_jid);
      if (!groupId || !groupId.includes('@g.us')) continue;

      const phones = getPhones(payload);
      for (const phone of phones) {
        if (!phone) continue;
        const key = `${groupId}|${phone}|${r.received_at}`;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push({
          id: r.id,
          received_at: r.received_at,
          group_id: groupId,
          group_subject: null,
          phone,
        });
      }
    }

    const groupIds = [...new Set(items.map((i) => i.group_id))];
    const nameByKey = new Map<string, string>();
    if (groupIds.length > 0) {
      const { data: names } = await supabaseServiceRole
        .from('audit_group_names')
        .select('group_id, instance_name, group_subject')
        .in('group_id', groupIds);
      for (const n of names || []) {
        nameByKey.set(`${n.group_id}|${n.instance_name}`, n.group_subject || '');
      }
    }

    const enriched = items.map((r) => {
      const instanceName = (rows || []).find((x: any) => x.id === r.id)?.instance_name || '';
      const key = `${r.group_id}|${instanceName}`;
      return { ...r, group_subject: nameByKey.get(key) ?? null };
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
