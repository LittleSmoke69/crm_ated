/**
 * GET /api/admin/anti-spam/bancas
 * Lista bancas que o usuário pode usar no anti-spam.
 * Mesma lógica do CRM: super_admin vê todas; admin e auditoria veem apenas bancas em user_bancas.
 * RBAC: super_admin, admin, auditoria
 */

import { NextRequest } from 'next/server';
import { requireAntiSpamAccess } from '@/lib/middleware/permissions';
import { successResponse, errorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { getEffectiveZaplotoId } from '@/lib/tenant-context';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const { userId, profile } = await requireAntiSpamAccess(req);
    const zaplotoId = await getEffectiveZaplotoId(req, profile);

    const isSuperAdmin = profile.status === 'super_admin';

    let bancas: { id: string; name: string; url: string }[];

    if (isSuperAdmin) {
      const { data, error } = await supabaseServiceRole
        .from('crm_bancas')
        .select('id, name, url')
        .or(`zaploto_id.eq.${zaplotoId},zaploto_id.is.null`)
        .order('name', { ascending: true });
      if (error) return errorResponse(error.message, 500);
      bancas = data ?? [];
    } else {
      const { data: row, error: ubError } = await supabaseServiceRole
        .from('user_bancas')
        .select('banca_ids')
        .eq('user_id', userId)
        .maybeSingle();
      if (ubError || !Array.isArray(row?.banca_ids) || row.banca_ids.length === 0) {
        return successResponse([]);
      }
      const bancaIds = row.banca_ids as string[];
      const { data, error } = await supabaseServiceRole
        .from('crm_bancas')
        .select('id, name, url')
        .in('id', bancaIds)
        .or(`zaploto_id.eq.${zaplotoId},zaploto_id.is.null`)
        .order('name', { ascending: true });
      if (error) return errorResponse(error.message, 500);
      bancas = data ?? [];
    }

    return successResponse(bancas);
  } catch (err: any) {
    return errorResponse(err.message || 'Não autorizado', 401);
  }
}
