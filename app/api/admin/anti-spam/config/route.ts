/**
 * GET /api/admin/anti-spam/config?banca_id=...
 * POST /api/admin/anti-spam/config (create/update)
 * RBAC: super_admin, admin, auditoria
 */

import { NextRequest } from 'next/server';
import { requireAntiSpamAccess } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    await requireAntiSpamAccess(req);
    const bancaId = req.nextUrl.searchParams.get('banca_id')?.trim();
    if (!bancaId) {
      return errorResponse('banca_id é obrigatório', 400);
    }
    const { data, error } = await supabaseServiceRole
      .from('anti_spam_configs')
      .select('*')
      .eq('banca_id', bancaId)
      .order('created_at', { ascending: false });

    if (error) {
      return errorResponse(error.message, 500);
    }
    return successResponse(data ?? []);
  } catch (err: any) {
    return errorResponse(err.message || 'Não autorizado', 401);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAntiSpamAccess(req);
    const body = await req.json();
    const {
      id,
      banca_id,
      is_enabled,
      master_instance_id,
      watcher_instance_id,
      denuncia_group_jid,
      scan_mode,
    } = body;

    if (!banca_id || !master_instance_id || !denuncia_group_jid) {
      return errorResponse('banca_id, master_instance_id e denuncia_group_jid são obrigatórios', 400);
    }
    const payload: Record<string, unknown> = {
      banca_id,
      is_enabled: is_enabled ?? true,
      master_instance_id,
      watcher_instance_id: watcher_instance_id || null,
      denuncia_group_jid,
      scan_mode: scan_mode === 'selected_groups' ? 'selected_groups' : 'all_groups',
    };

    if (id) {
      const { data, error } = await supabaseServiceRole
        .from('anti_spam_configs')
        .update(payload)
        .eq('id', id)
        .select()
        .single();
      if (error) return errorResponse(error.message, 500);
      return successResponse(data, 'Config atualizada');
    }

    const { data, error } = await supabaseServiceRole
      .from('anti_spam_configs')
      .insert(payload)
      .select()
      .single();
    if (error) return errorResponse(error.message, 500);
    return successResponse(data, 'Config criada');
  } catch (err: any) {
    return errorResponse(err.message || 'Não autorizado', 401);
  }
}
