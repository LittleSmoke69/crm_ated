import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * PUT /api/admin/users/[userId]/bancas - Define as bancas em que o consultor/gerente atua (admin)
 * Body: { banca_ids: string[] } - IDs da tabela crm_bancas
 * Permite atribuir consultor/gerente a várias bancas, inclusive sem dono na banca.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    await requireAdmin(req);
    const { userId } = await params;

    const { data: profile } = await supabaseServiceRole
      .from('profiles')
      .select('status')
      .eq('id', userId)
      .single();

    if (!profile || (profile.status !== 'consultor' && profile.status !== 'gerente' && profile.status !== 'gestor')) {
      return errorResponse('Apenas consultores, gerentes e gestores podem ter bancas atribuídas', 400);
    }

    const body = await req.json();
    const bancaIds = body?.banca_ids;

    if (!Array.isArray(bancaIds)) {
      return errorResponse('banca_ids deve ser um array de IDs (UUID)', 400);
    }

    if (bancaIds.length > 0) {
      const { data: existing, error: checkError } = await supabaseServiceRole
        .from('crm_bancas')
        .select('id')
        .in('id', bancaIds);

      if (checkError) {
        return errorResponse('Erro ao validar bancas', 500);
      }
      const validIds = (existing || []).map((b: { id: string }) => b.id);
      const invalid = bancaIds.filter((id: string) => !validIds.includes(id));
      if (invalid.length > 0) {
        return errorResponse(`IDs inválidos: ${invalid.join(', ')}`, 400);
      }
    }

    const { error: deleteError } = await supabaseServiceRole
      .from('user_bancas')
      .delete()
      .eq('user_id', userId);

    if (deleteError) {
      console.error('[PUT /api/admin/users/[userId]/bancas] Erro ao remover:', deleteError);
      return errorResponse('Erro ao atualizar bancas', 500);
    }

    if (bancaIds.length > 0) {
      const rows = bancaIds.map((banca_id: string) => ({ user_id: userId, banca_id }));
      const { error: insertError } = await supabaseServiceRole
        .from('user_bancas')
        .insert(rows);

      if (insertError) {
        console.error('[PUT /api/admin/users/[userId]/bancas] Erro ao inserir:', insertError);
        return errorResponse('Erro ao salvar bancas', 500);
      }
    }

    return successResponse({
      banca_ids: bancaIds,
      message: 'Bancas atualizadas com sucesso',
    });
  } catch (err: unknown) {
    console.error('[PUT /api/admin/users/[userId]/bancas]', err);
    return serverErrorResponse(err);
  }
}

/**
 * GET /api/admin/users/[userId]/bancas - Lista as bancas do consultor/gerente (admin)
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    await requireAdmin(req);
    const { userId } = await params;

    const { data: profile } = await supabaseServiceRole
      .from('profiles')
      .select('status')
      .eq('id', userId)
      .single();

    if (!profile || (profile.status !== 'consultor' && profile.status !== 'gerente' && profile.status !== 'gestor')) {
      return successResponse({ banca_ids: [] });
    }

    const { data: rows, error } = await supabaseServiceRole
      .from('user_bancas')
      .select('banca_id')
      .eq('user_id', userId);

    if (error) {
      return errorResponse('Erro ao listar bancas', 500);
    }

    const banca_ids = (rows || []).map((r: { banca_id: string }) => r.banca_id);
    return successResponse({ banca_ids });
  } catch (err: unknown) {
    return serverErrorResponse(err);
  }
}
