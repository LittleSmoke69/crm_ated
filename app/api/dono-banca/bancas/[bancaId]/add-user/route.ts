import { NextRequest } from 'next/server';
import { requireStatus } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

function normalizeBancaUrl(url: string | null | undefined): string {
  if (!url) return '';
  let s = String(url).trim();
  s = s.replace(/^https?:\/\//i, '');
  s = s.replace(/\/api\/crm\/?/i, '');
  s = s.replace(/\/+$/, '');
  return s.trim().toLowerCase();
}

/**
 * POST /api/dono-banca/bancas/[bancaId]/add-user
 * Dono de banca adiciona um usuário (consultor/gerente) à sua banca sem remover outras bancas dele.
 * Body: { user_id: string }
 * Só permite se a banca pertence ao dono (crm_bancas.url = dono.banca_url).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ bancaId: string }> }
) {
  try {
    const { userId } = await requireStatus(req, ['dono_banca']);
    const { bancaId } = await params;
    if (!bancaId?.trim()) return errorResponse('banca_id é obrigatório', 400);

    const { data: donoProfile } = await supabaseServiceRole
      .from('profiles')
      .select('id, banca_url')
      .eq('id', userId)
      .eq('status', 'dono_banca')
      .single();
    if (!donoProfile?.banca_url) return errorResponse('Dono sem banca configurada', 400);

    const { data: banca } = await supabaseServiceRole
      .from('crm_bancas')
      .select('id, url')
      .eq('id', bancaId)
      .single();
    if (!banca) return errorResponse('Banca não encontrada', 404);
    if (normalizeBancaUrl(banca.url) !== normalizeBancaUrl(donoProfile.banca_url)) {
      return errorResponse('Esta banca não pertence a você.', 403);
    }

    const body = await req.json().catch(() => ({}));
    const targetUserId = body?.user_id?.trim();
    if (!targetUserId) return errorResponse('user_id é obrigatório', 400);

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
      console.error('[dono-banca add-user]', upsertError);
      return errorResponse('Erro ao atribuir usuário à banca', 500);
    }

    return successResponse({ banca_ids: newBancaIds }, 'Usuário atribuído à banca com sucesso.');
  } catch (err: unknown) {
    console.error('[dono-banca add-user]', err);
    return serverErrorResponse(err);
  }
}
