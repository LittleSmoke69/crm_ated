import { NextRequest } from 'next/server';
import { requireAdminOrSuporte } from '@/lib/middleware/permissions';
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
    await requireAdminOrSuporte(req);
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
    const rawBancaIds = body?.banca_ids;

    if (!Array.isArray(rawBancaIds)) {
      return errorResponse('banca_ids deve ser um array de IDs (UUID)', 400);
    }

    const bancaIds = rawBancaIds.map((id: unknown) => String(id));

    if (bancaIds.length > 0) {
      const { data: existing, error: checkError } = await supabaseServiceRole
        .from('crm_bancas')
        .select('id')
        .in('id', bancaIds);

      if (checkError) {
        return errorResponse('Erro ao validar bancas', 500);
      }
      const validIds = (existing || []).map((b: { id: string }) => String(b.id));
      const invalid = bancaIds.filter((id) => !validIds.includes(id));
      if (invalid.length > 0) {
        return errorResponse(`IDs inválidos: ${invalid.join(', ')}`, 400);
      }
    }

    const { error: upsertError } = await supabaseServiceRole
      .from('user_bancas')
      .upsert({ user_id: userId, banca_ids: bancaIds }, { onConflict: 'user_id' });

    if (upsertError) {
      console.error('[PUT /api/admin/users/[userId]/bancas] Erro ao salvar:', upsertError);
      return errorResponse('Erro ao atualizar bancas', 500);
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
    await requireAdminOrSuporte(req);
    const { userId } = await params;

    const { data: profile } = await supabaseServiceRole
      .from('profiles')
      .select('status')
      .eq('id', userId)
      .single();

    if (!profile || (profile.status !== 'consultor' && profile.status !== 'gerente' && profile.status !== 'gestor')) {
      return successResponse({ banca_ids: [] });
    }

    const { data: row, error } = await supabaseServiceRole
      .from('user_bancas')
      .select('banca_ids')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      return errorResponse('Erro ao listar bancas', 500);
    }

    const banca_ids = Array.isArray(row?.banca_ids) ? (row.banca_ids as string[]) : [];
    return successResponse({ banca_ids });
  } catch (err: unknown) {
    return serverErrorResponse(err);
  }
}
