import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { getUserProfile } from '@/lib/middleware/permissions';
import { successResponse, errorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { getTenantForUser, getRoleByCode } from '@/lib/services/zaploto-tenant-service';

const ALLOWED_STATUSES = ['super_admin', 'admin', 'dono_banca', 'gerente'];

/**
 * GET /api/list-cleaning/capabilities
 * Retorna { canDedup, canWhatsapp } conforme permissões do cargo (zaploto_role_sidebar).
 * Se os itens list_cleaning_dedup / list_cleaning_whatsapp não existirem, retorna ambos true (compatibilidade).
 */
export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const profile = await getUserProfile(userId);
    if (!profile?.status || !ALLOWED_STATUSES.includes(profile.status)) {
      return errorResponse('Acesso negado', 403);
    }

    const tenant = await getTenantForUser(userId);
    const zaplotoId = tenant?.id ?? '00000000-0000-0000-0000-000000000001';
    const role = await getRoleByCode(zaplotoId, profile.status);
    if (!role) {
      return successResponse({ canDedup: true, canWhatsapp: true });
    }

    const { data: items } = await supabaseServiceRole
      .from('zaploto_sidebar_items')
      .select('id, code')
      .eq('zaploto_id', zaplotoId)
      .in('code', ['list_cleaning_dedup', 'list_cleaning_whatsapp']);

    if (!items?.length) {
      return successResponse({ canDedup: true, canWhatsapp: true });
    }

    const ids = items.map((i: { id: string }) => i.id);
    const byCode = Object.fromEntries(items.map((i: { id: string; code: string }) => [i.code, i.id]));

    const { data: roleSidebar } = await supabaseServiceRole
      .from('zaploto_role_sidebar')
      .select('sidebar_item_id, visible')
      .eq('role_id', role.id)
      .in('sidebar_item_id', ids);

    const visibleMap = new Map(
      (roleSidebar || []).map((r: { sidebar_item_id: string; visible: boolean }) => [
        r.sidebar_item_id,
        r.visible,
      ])
    );

    const dedupId = byCode['list_cleaning_dedup'];
    const whatsappId = byCode['list_cleaning_whatsapp'];
    const canDedup = dedupId ? (visibleMap.get(dedupId) ?? true) : true;
    const canWhatsapp = whatsappId ? (visibleMap.get(whatsappId) ?? true) : true;

    return successResponse({ canDedup, canWhatsapp });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro ao buscar permissões';
    return errorResponse(message, 403);
  }
}
