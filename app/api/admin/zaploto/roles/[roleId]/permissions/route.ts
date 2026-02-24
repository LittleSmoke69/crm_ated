import { NextRequest } from 'next/server';
import { requireSuperAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export interface SidebarItemWithPermission {
  id: string;
  code: string;
  label: string;
  href: string | null;
  icon_name: string | null;
  parent_code: string | null;
  sort_order: number;
  visible: boolean;
}

/**
 * GET /api/admin/zaploto/roles/[roleId]/permissions
 * Retorna todos os itens da sidebar do tenant do role, com flag visible por cargo
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ roleId: string }> }
) {
  try {
    await requireSuperAdmin(req);
    const { roleId } = await params;

    const { data: role } = await supabaseServiceRole
      .from('zaploto_roles')
      .select('zaploto_id')
      .eq('id', roleId)
      .single();

    if (!role) return errorResponse('Cargo não encontrado', 404);

    const { data: sidebarItems } = await supabaseServiceRole
      .from('zaploto_sidebar_items')
      .select('id, code, label, href, icon_name, parent_code, sort_order')
      .eq('zaploto_id', role.zaploto_id)
      .eq('is_active', true)
      .order('sort_order');

    const { data: roleSidebar } = await supabaseServiceRole
      .from('zaploto_role_sidebar')
      .select('sidebar_item_id, visible')
      .eq('role_id', roleId);

    const visibleMap = new Map(
      (roleSidebar || []).map((r: { sidebar_item_id: string; visible: boolean }) => [
        r.sidebar_item_id,
        r.visible,
      ])
    );

    const items: SidebarItemWithPermission[] = (sidebarItems || []).map((si: any) => ({
      id: si.id,
      code: si.code,
      label: si.label,
      href: si.href,
      icon_name: si.icon_name,
      parent_code: si.parent_code,
      sort_order: si.sort_order,
      visible: visibleMap.get(si.id) ?? false,
    }));

    return successResponse({ items });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro ao buscar permissões';
    return errorResponse(message, 403);
  }
}

/**
 * PUT /api/admin/zaploto/roles/[roleId]/permissions
 * Atualiza visibilidade dos itens da sidebar para o cargo
 * Body: { items: { sidebar_item_id: string, visible: boolean }[] }
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ roleId: string }> }
) {
  try {
    await requireSuperAdmin(req);
    const { roleId } = await params;
    const body = await req.json();

    const items = body.items as Array<{ sidebar_item_id: string; visible: boolean }> | undefined;
    if (!Array.isArray(items)) {
      return errorResponse('items deve ser um array', 400);
    }

    const { data: role } = await supabaseServiceRole
      .from('zaploto_roles')
      .select('id, zaploto_id')
      .eq('id', roleId)
      .single();

    if (!role) return errorResponse('Cargo não encontrado', 404);

    for (const item of items) {
      if (!item.sidebar_item_id || typeof item.visible !== 'boolean') continue;

      await supabaseServiceRole.from('zaploto_role_sidebar').upsert(
        {
          zaploto_id: role.zaploto_id,
          role_id: roleId,
          sidebar_item_id: item.sidebar_item_id,
          visible: item.visible,
        },
        { onConflict: 'role_id,sidebar_item_id' }
      );
    }

    return successResponse({ updated: items.length });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro ao atualizar permissões';
    return errorResponse(message, 403);
  }
}
