/**
 * GET /api/admin/chat-tags/report
 * Relatório de conversas do chat que possuem etiquetas vinculadas.
 * Acesso: admin e super_admin.
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

type ConversationRow = {
  id: string;
  title: string | null;
  remote_jid: string;
  tags: string[] | null;
  last_message_at: string | null;
  attendance_status: string | null;
  user_id: string | null;
  instance_id: string | null;
  whatsapp_config_id: string | null;
};

function formatPhoneFromJid(jid: string): string {
  const raw = String(jid || '').split('@')[0] || '';
  const digits = raw.replace(/\D/g, '');
  if (digits.length >= 12 && digits.startsWith('55')) {
    const ddd = digits.slice(2, 4);
    const rest = digits.slice(4);
    if (rest.length === 9) return `+55 (${ddd}) ${rest.slice(0, 5)}-${rest.slice(5)}`;
    if (rest.length === 8) return `+55 (${ddd}) ${rest.slice(0, 4)}-${rest.slice(4)}`;
  }
  return raw || jid;
}

function belongsToTenant(
  row: ConversationRow,
  userIds: Set<string>,
  configIds: Set<string>,
  instanceIds: Set<string>
): boolean {
  if (row.user_id && userIds.has(row.user_id)) return true;
  if (row.whatsapp_config_id && configIds.has(row.whatsapp_config_id)) return true;
  if (row.instance_id && instanceIds.has(row.instance_id)) return true;
  return false;
}

export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);

    const { data: profile } = await supabaseServiceRole
      .from('profiles')
      .select('status, zaploto_id')
      .eq('id', userId)
      .single();

    const status = (profile?.status || '').toLowerCase();
    const isSuper = status === 'super_admin';
    const isAdmin = status === 'admin';
    if (!isSuper && !isAdmin) {
      return errorResponse('Acesso negado. Apenas admin e super_admin.', 403);
    }

    const { searchParams } = new URL(req.url);
    const tagFilter = (searchParams.get('tag') || '').trim();
    const fromDate = searchParams.get('from');
    const toDate = searchParams.get('to');

    let tenantUserIds = new Set<string>();
    let tenantConfigIds = new Set<string>();
    let tenantInstanceIds = new Set<string>();

    if (!isSuper && profile?.zaploto_id) {
      const zaplotoId = profile.zaploto_id;
      const [profilesRes, configsRes, instancesRes] = await Promise.all([
        supabaseServiceRole.from('profiles').select('id').eq('zaploto_id', zaplotoId),
        supabaseServiceRole.from('whatsapp_official_configs').select('id').eq('zaploto_id', zaplotoId),
        supabaseServiceRole.from('evolution_instances').select('id').eq('zaploto_id', zaplotoId),
      ]);

      tenantUserIds = new Set((profilesRes.data || []).map((p) => p.id as string));
      tenantConfigIds = new Set((configsRes.data || []).map((c) => c.id as string));
      tenantInstanceIds = new Set(
        instancesRes.error ? [] : (instancesRes.data || []).map((i) => i.id as string)
      );
    }

    let query = supabaseServiceRole
      .from('chat_conversations')
      .select(
        'id, title, remote_jid, tags, last_message_at, attendance_status, user_id, instance_id, whatsapp_config_id'
      )
      .not('tags', 'is', null)
      .order('last_message_at', { ascending: false })
      .limit(2000);

    if (fromDate) {
      query = query.gte('last_message_at', `${fromDate}T00:00:00.000Z`);
    }
    if (toDate) {
      query = query.lte('last_message_at', `${toDate}T23:59:59.999Z`);
    }
    if (tagFilter) {
      query = query.contains('tags', [tagFilter]);
    }

    const { data: rows, error } = await query;
    if (error) {
      console.error('[admin/chat-tags/report]', error.message);
      return errorResponse(`Erro ao buscar conversas: ${error.message}`, 500);
    }

    let conversations = (rows || [])
      .map((row) => row as ConversationRow)
      .filter((row) => Array.isArray(row.tags) && row.tags.length > 0);

    if (!isSuper && profile?.zaploto_id) {
      conversations = conversations.filter((row) =>
        belongsToTenant(row, tenantUserIds, tenantConfigIds, tenantInstanceIds)
      );
    }

    const attendantIds = [...new Set(conversations.map((c) => c.user_id).filter(Boolean))] as string[];
    const attendantNames = new Map<string, string>();
    if (attendantIds.length > 0) {
      const { data: attendants } = await supabaseServiceRole
        .from('profiles')
        .select('id, full_name, email')
        .in('id', attendantIds);
      for (const p of attendants || []) {
        attendantNames.set(p.id as string, (p.full_name as string) || (p.email as string) || p.id);
      }
    }

    const tagCounts = new Map<string, number>();
    for (const conv of conversations) {
      for (const tag of conv.tags || []) {
        const t = String(tag).trim();
        if (!t) continue;
        tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
      }
    }

    const byTag = [...tagCounts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'pt-BR'));

    const list = conversations.map((conv) => ({
      id: conv.id,
      contact: conv.title?.trim() || formatPhoneFromJid(conv.remote_jid),
      remote_jid: conv.remote_jid,
      tags: conv.tags || [],
      last_message_at: conv.last_message_at,
      attendance_status: conv.attendance_status || 'pendente',
      attendant_id: conv.user_id,
      attendant_name: conv.user_id ? attendantNames.get(conv.user_id) || null : null,
    }));

    return successResponse({
      summary: {
        totalConversations: list.length,
        byTag,
      },
      conversations: list,
      from: fromDate || null,
      to: toDate || null,
      tag: tagFilter || null,
    });
  } catch (err: unknown) {
    return serverErrorResponse(err as Error);
  }
}
