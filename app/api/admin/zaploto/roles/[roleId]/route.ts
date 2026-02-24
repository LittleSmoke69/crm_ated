import { NextRequest } from 'next/server';
import { requireSuperAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * DELETE /api/admin/zaploto/roles/[roleId] - Remove um cargo
 * Cargos do sistema (is_system) podem ser removidos; verificar se há profiles vinculados.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ roleId: string }> }
) {
  try {
    await requireSuperAdmin(_req);
    const { roleId } = await params;

    const { data: role } = await supabaseServiceRole
      .from('zaploto_roles')
      .select('id, zaploto_id, code, is_system')
      .eq('id', roleId)
      .single();

    if (!role) return errorResponse('Cargo não encontrado', 404);

    // profiles.status mapeia para role.code - verificar se há usuários com este cargo
    const { count } = await supabaseServiceRole
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('zaploto_id', role.zaploto_id)
      .eq('status', role.code);

    if ((count ?? 0) > 0) {
      return errorResponse(
        'Não é possível excluir: há usuários com este cargo. Atribua outro cargo antes.',
        400
      );
    }

    await supabaseServiceRole.from('zaploto_roles').delete().eq('id', roleId);

    return successResponse({ deleted: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro ao excluir cargo';
    return errorResponse(message, 403);
  }
}
