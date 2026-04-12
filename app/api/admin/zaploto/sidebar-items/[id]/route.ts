import { NextRequest } from 'next/server';
import { requireSuperAdmin } from '@/lib/middleware/auth';
import { successResponse, errorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

const ICONS = [
  'LayoutDashboard', 'MessageSquare', 'Rocket', 'Users', 'Plus', 'Shield', 'Webhook', 'Workflow',
  'Bot', 'Layout', 'Kanban', 'Activity', 'BarChart3', 'Briefcase', 'Settings', 'FlaskConical',
  'User', 'ListOrdered', 'ClipboardList', 'ArrowLeftToLine', 'ExternalLink', 'ArrowRightLeft',
];

/**
 * PUT /api/admin/zaploto/sidebar-items/[id] - Atualiza um módulo
 * Body: { code?, label?, href?, icon_name?, parent_code?, sort_order? }
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireSuperAdmin(req);
    const { id } = await params;
    const body = await req.json();

    const { data: existing } = await supabaseServiceRole
      .from('zaploto_sidebar_items')
      .select('id, zaploto_id')
      .eq('id', id)
      .single();

    if (!existing) return errorResponse('Módulo não encontrado', 404);

    const updates: Record<string, unknown> = {};
    if (body.code != null) updates.code = String(body.code).toLowerCase().trim().replace(/\s+/g, '_');
    if (body.label != null) updates.label = String(body.label).trim();
    if (body.href != null) updates.href = body.href?.trim() || null;
    if (body.icon_name != null) {
      if (body.icon_name && !ICONS.includes(body.icon_name)) {
        return errorResponse(`Ícone inválido. Use um de: ${ICONS.join(', ')}`, 400);
      }
      updates.icon_name = body.icon_name || null;
    }
    if (body.parent_code != null) updates.parent_code = body.parent_code?.trim() || null;
    if (typeof body.sort_order === 'number') updates.sort_order = body.sort_order;

    const { data, error } = await supabaseServiceRole
      .from('zaploto_sidebar_items')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      if (error.code === '23505') return errorResponse('Já existe um módulo com este código', 400);
      throw new Error(error.message);
    }
    return successResponse(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro ao atualizar módulo';
    return errorResponse(message, 403);
  }
}

/**
 * DELETE /api/admin/zaploto/sidebar-items/[id] - Remove um módulo
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireSuperAdmin(_req);
    const { id } = await params;

    const { data: item } = await supabaseServiceRole
      .from('zaploto_sidebar_items')
      .select('id, zaploto_id')
      .eq('id', id)
      .single();

    if (!item) return errorResponse('Módulo não encontrado', 404);

    // Excluir - CASCADE remove zaploto_role_sidebar
    await supabaseServiceRole.from('zaploto_sidebar_items').delete().eq('id', id);

    return successResponse({ deleted: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro ao excluir módulo';
    return errorResponse(message, 403);
  }
}
