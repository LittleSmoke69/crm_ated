import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { getUserProfile } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * POST /api/gestor-trafego/bancas/[bancaId]/add-user
 * Adiciona um usuário (consultor/gerente) à banca sem remover outras bancas dele.
 * Body: { user_id: string }
 * Gestor só pode adicionar à banca se estiver atribuído a ela (user_bancas).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ bancaId: string }> }
) {
  try {
    const auth = await requireAuth(req);
    if (!auth?.userId) return errorResponse('Não autenticado', 403);
    const userId = auth.userId.trim();
    const { bancaId } = await params;
    if (!bancaId?.trim()) return errorResponse('banca_id é obrigatório', 400);

    const profile = await getUserProfile(userId);
    const statusNorm = profile?.status?.trim().toLowerCase();
    if (!profile || statusNorm !== 'gestor') {
      return errorResponse('Acesso negado. Apenas gestor pode adicionar usuário à banca.', 403);
    }

    const body = await req.json().catch(() => ({}));
    const targetUserId = body?.user_id?.trim();
    if (!targetUserId) return errorResponse('user_id é obrigatório', 400);

    const { data: ubRow } = await supabaseServiceRole
      .from('user_bancas')
      .select('banca_ids')
      .eq('user_id', profile.id)
      .maybeSingle();
    const gestorBancaIds = Array.isArray(ubRow?.banca_ids) ? (ubRow.banca_ids as string[]) : [];
    if (!gestorBancaIds.includes(bancaId)) {
      return errorResponse('Você não está atribuído a esta banca.', 403);
    }

    const { data: targetProfile } = await supabaseServiceRole
      .from('profiles')
      .select('id, status')
      .eq('id', targetUserId)
      .single();
    if (!targetProfile) return errorResponse('Usuário não encontrado', 404);
    if (targetProfile.status !== 'consultor' && targetProfile.status !== 'gerente') {
      return errorResponse('Só é possível atribuir consultores ou gerentes à banca.', 400);
    }

    const { data: targetUb } = await supabaseServiceRole
      .from('user_bancas')
      .select('banca_ids')
      .eq('user_id', targetUserId)
      .maybeSingle();
    const currentIds = Array.isArray(targetUb?.banca_ids) ? (targetUb.banca_ids as string[]) : [];
    if (currentIds.includes(bancaId)) {
      return successResponse({ already_in_banca: true, banca_ids: currentIds }, 'Usuário já está nesta banca.');
    }

    const newBancaIds = [...currentIds, bancaId];
    const { error: upsertError } = await supabaseServiceRole
      .from('user_bancas')
      .upsert({ user_id: targetUserId, banca_ids: newBancaIds }, { onConflict: 'user_id' });

    if (upsertError) {
      console.error('[gestor-trafego add-user]', upsertError);
      return errorResponse('Erro ao atribuir usuário à banca', 500);
    }

    return successResponse({ banca_ids: newBancaIds }, 'Usuário atribuído à banca com sucesso.');
  } catch (err: unknown) {
    console.error('[gestor-trafego add-user]', err);
    return serverErrorResponse(err);
  }
}
