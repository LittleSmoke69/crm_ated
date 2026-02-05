import { NextRequest } from 'next/server';
import { requireAuthWithProfile } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * PUT /api/user/bancas - Define as bancas em que o usuário atua (consultor, gerente ou super_admin)
 * Body: { banca_ids: string[] } - IDs da tabela crm_bancas
 */
export async function PUT(req: NextRequest) {
  try {
    const { userId, profile } = await requireAuthWithProfile(req);

    const allowed = ['consultor', 'gerente', 'super_admin'].includes(profile?.status || '');
    if (!allowed) {
      return errorResponse('Apenas consultores, gerentes e super admins podem alterar suas bancas', 403);
    }

    const body = await req.json();
    const bancaIds = body?.banca_ids;

    if (!Array.isArray(bancaIds)) {
      return errorResponse('banca_ids deve ser um array de IDs (UUID)', 400);
    }

    // Valida que todos os IDs existem em crm_bancas
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

    // Remove associações atuais e insere as novas
    const { error: deleteError } = await supabaseServiceRole
      .from('user_bancas')
      .delete()
      .eq('user_id', userId);

    if (deleteError) {
      console.error('[PUT /api/user/bancas] Erro ao remover bancas antigas:', deleteError);
      return errorResponse('Erro ao atualizar bancas', 500);
    }

    if (bancaIds.length > 0) {
      const rows = bancaIds.map((banca_id: string) => ({ user_id: userId, banca_id }));
      const { error: insertError } = await supabaseServiceRole
        .from('user_bancas')
        .insert(rows);

      if (insertError) {
        console.error('[PUT /api/user/bancas] Erro ao inserir bancas:', insertError);
        return errorResponse('Erro ao salvar bancas', 500);
      }
    }

    return successResponse({
      banca_ids: bancaIds,
      message: 'Bancas atualizadas com sucesso',
    });
  } catch (err: any) {
    console.error('[PUT /api/user/bancas] Erro inesperado:', err);
    return serverErrorResponse(err);
  }
}
