/**
 * GET /api/admin/anti-spam/groups?config_id=...
 * Lista grupos monitorados (anti_spam_groups) da config.
 * RBAC: super_admin, admin, auditoria
 */

import { NextRequest } from 'next/server';
import { requireAntiSpamAccess } from '@/lib/middleware/permissions';
import { successResponse, errorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    await requireAntiSpamAccess(req);
    const configId = req.nextUrl.searchParams.get('config_id')?.trim();
    if (!configId) return errorResponse('config_id é obrigatório', 400);

    const { data, error } = await supabaseServiceRole
      .from('anti_spam_groups')
      .select('id, config_id, group_jid, group_name, is_monitored')
      .eq('config_id', configId)
      .order('group_name', { ascending: true });

    if (error) return errorResponse(error.message, 500);
    return successResponse(data ?? []);
  } catch (err: any) {
    return errorResponse(err.message || 'Não autorizado', 401);
  }
}

/**
 * POST /api/admin/anti-spam/groups
 * Body: { config_id, group_jid, group_name? }
 * Adiciona grupo à lista de monitorados.
 */
export async function POST(req: NextRequest) {
  try {
    await requireAntiSpamAccess(req);
    const body = await req.json();
    const { config_id, group_jid, group_name } = body;
    if (!config_id || !group_jid) {
      return errorResponse('config_id e group_jid são obrigatórios', 400);
    }

    const { data, error } = await supabaseServiceRole
      .from('anti_spam_groups')
      .upsert(
        {
          config_id,
          group_jid: String(group_jid).trim(),
          group_name: group_name?.trim() || null,
          is_monitored: true,
        },
        { onConflict: 'config_id,group_jid', ignoreDuplicates: false }
      )
      .select()
      .single();

    if (error) return errorResponse(error.message, 500);
    return successResponse(data, 'Grupo adicionado');
  } catch (err: any) {
    return errorResponse(err.message || 'Não autorizado', 401);
  }
}

/**
 * DELETE /api/admin/anti-spam/groups?config_id=...&group_jid=...
 * Remove grupo da lista de monitorados.
 */
export async function DELETE(req: NextRequest) {
  try {
    await requireAntiSpamAccess(req);
    const configId = req.nextUrl.searchParams.get('config_id')?.trim();
    const groupJid = req.nextUrl.searchParams.get('group_jid')?.trim();
    if (!configId || !groupJid) {
      return errorResponse('config_id e group_jid são obrigatórios', 400);
    }

    const { error } = await supabaseServiceRole
      .from('anti_spam_groups')
      .delete()
      .eq('config_id', configId)
      .eq('group_jid', groupJid);

    if (error) return errorResponse(error.message, 500);
    return successResponse(null, 'Grupo removido');
  } catch (err: any) {
    return errorResponse(err.message || 'Não autorizado', 401);
  }
}
