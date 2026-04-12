import { NextRequest } from 'next/server';
import { requireSuperAdmin } from '@/lib/middleware/auth';
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
 * Atualiza visibilidade dos itens da sidebar para o cargo.
 * Regra: quando um item da sidebar é marcado como visível, o cargo tem acesso total àquela funcionalidade
 * (incluindo admin steps correspondentes: painel_admin → todos os steps; mesmo code → step com can_execute).
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

    const zaplotoId = role.zaploto_id as string;

    for (const item of items) {
      if (!item.sidebar_item_id || typeof item.visible !== 'boolean') continue;

      await supabaseServiceRole.from('zaploto_role_sidebar').upsert(
        {
          zaploto_id: zaplotoId,
          role_id: roleId,
          sidebar_item_id: item.sidebar_item_id,
          visible: item.visible,
        },
        { onConflict: 'role_id,sidebar_item_id' }
      );
    }

    // Quando um item da sidebar é visível, garantir acesso total à funcionalidade (admin steps)
    const visibleSidebarIds = new Set(
      items.filter((i) => i.visible).map((i) => i.sidebar_item_id)
    );
    if (visibleSidebarIds.size === 0) {
      return successResponse({ updated: items.length });
    }

    const { data: visibleItems } = await supabaseServiceRole
      .from('zaploto_sidebar_items')
      .select('id, code')
      .eq('zaploto_id', zaplotoId)
      .in('id', Array.from(visibleSidebarIds));

    const visibleCodes = new Set((visibleItems || []).map((i: { code: string }) => i.code));

    const { data: adminStepsWithCode } = await supabaseServiceRole
      .from('zaploto_admin_steps')
      .select('id, code')
      .eq('zaploto_id', zaplotoId);

    const stepIdsToGrant: string[] = [];
    for (const s of adminStepsWithCode || []) {
      const code = (s as { code: string }).code;
      if (visibleCodes.has('painel_admin') || visibleCodes.has(code)) {
        stepIdsToGrant.push((s as { id: string }).id);
      }
    }

    for (const adminStepId of stepIdsToGrant) {
      await supabaseServiceRole.from('zaploto_role_admin_steps').upsert(
        {
          zaploto_id: zaplotoId,
          role_id: roleId,
          admin_step_id: adminStepId,
          visible: true,
          can_execute: true,
        },
        { onConflict: 'role_id,admin_step_id' }
      );
    }

    return successResponse({ updated: items.length });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro ao atualizar permissões';
    return errorResponse(message, 403);
  }
}
