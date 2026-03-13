/**
 * GET /api/admin/chat-attendance-report
 * Relatório de atendimento do chat: conversas resolvidas e tempo por atendente (suporte).
 * Acesso: admin e super_admin.
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);

    const { data: profile } = await supabaseServiceRole
      .from('profiles')
      .select('status, zaploto_id')
      .eq('id', userId)
      .single();

    const isAdmin = profile?.status === 'admin' || profile?.status === 'super_admin';
    if (!isAdmin) {
      return errorResponse('Acesso negado. Apenas admin e super_admin.', 403);
    }

    const { searchParams } = new URL(req.url);
    const fromDate = searchParams.get('from'); // YYYY-MM-DD
    const toDate = searchParams.get('to');     // YYYY-MM-DD

    let query = supabaseServiceRole
      .from('chat_conversations')
      .select('id, user_id, assigned_at, resolved_at, whatsapp_config_id')
      .eq('attendance_status', 'resolvido')
      .not('resolved_at', 'is', null);

    if (fromDate) {
      query = query.gte('resolved_at', `${fromDate}T00:00:00.000Z`);
    }
    if (toDate) {
      query = query.lte('resolved_at', `${toDate}T23:59:59.999Z`);
    }

    // Se admin (não super_admin), filtrar por zaploto_id via whatsapp_config
    if (profile?.status === 'admin' && profile?.zaploto_id) {
      const { data: configIds } = await supabaseServiceRole
        .from('whatsapp_official_configs')
        .select('id')
        .eq('zaploto_id', profile.zaploto_id);
      const ids = (configIds || []).map((c) => c.id);
      if (ids.length > 0) {
        query = query.in('whatsapp_config_id', ids);
      } else {
        query = query.is('whatsapp_config_id', null); // nenhum canal do tenant
      }
    }

    const { data: rows, error } = await query.order('resolved_at', { ascending: false });

    if (error) {
      console.error('[chat-attendance-report]', error.message);
      return errorResponse(`Erro ao buscar dados: ${error.message}`, 500);
    }

    const list = rows || [];
    const byUser = new Map<
      string,
      { user_id: string; resolved_count: number; total_seconds: number }
    >();

    for (const row of list) {
      const uid = (row as { user_id?: string }).user_id;
      const key = uid || '__unassigned__';
      if (!byUser.has(key)) {
        byUser.set(key, { user_id: key, resolved_count: 0, total_seconds: 0 });
      }
      const rec = byUser.get(key)!;
      rec.resolved_count += 1;
      const assigned = (row as { assigned_at?: string }).assigned_at;
      const resolved = (row as { resolved_at?: string }).resolved_at;
      if (assigned && resolved) {
        const a = new Date(assigned).getTime();
        const r = new Date(resolved).getTime();
        rec.total_seconds += Math.max(0, Math.round((r - a) / 1000));
      }
    }

    const userIds = [...byUser.keys()].filter((k) => k !== '__unassigned__');
    let profiles: { id: string; full_name?: string; email?: string }[] = [];
    if (userIds.length > 0) {
      const { data: prof } = await supabaseServiceRole
        .from('profiles')
        .select('id, full_name, email')
        .in('id', userIds);
      profiles = prof || [];
    }

    const byUserList = [...byUser.entries()].map(([key, val]) => {
      const profileRow = profiles.find((p) => p.id === key);
      return {
        user_id: key === '__unassigned__' ? null : key,
        name: key === '__unassigned__' ? 'Não atribuído' : (profileRow?.full_name || profileRow?.email || key),
        resolved_count: val.resolved_count,
        total_seconds: val.total_seconds,
      };
    });

    byUserList.sort((a, b) => b.resolved_count - a.resolved_count);

    const totalResolved = list.length;
    return successResponse({
      byUser: byUserList,
      totalResolved,
      from: fromDate || null,
      to: toDate || null,
    });
  } catch (err: unknown) {
    return serverErrorResponse(err as Error);
  }
}
