import { NextRequest } from 'next/server';
import { requireAuthWithProfile } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { getUserBancas } from '@/lib/utils/user-bancas';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * GET /api/user/profile - Retorna perfil completo com bancas e gerente (para consultor)
 */
export async function GET(req: NextRequest) {
  try {
    const { userId, profile } = await requireAuthWithProfile(req);

    const bancas = await getUserBancas(userId);

    let needs_bancas_choice = false;
    const canHaveBancas = ['consultor', 'gerente', 'gestor', 'super_admin'].includes(profile.status || '');
    if (canHaveBancas) {
      const { data: ubRow } = await supabaseServiceRole
        .from('user_bancas')
        .select('banca_ids')
        .eq('user_id', userId)
        .maybeSingle();
      const ids = Array.isArray(ubRow?.banca_ids) ? (ubRow.banca_ids as string[]) : [];
      if (ids.length === 0) needs_bancas_choice = true;
    }

    let gerente: { id: string; email: string; full_name: string | null } | null = null;
    if (profile.enroller) {
      const { data: enrollerProfile } = await supabaseServiceRole
        .from('profiles')
        .select('id, email, full_name, status')
        .eq('id', profile.enroller)
        .single();
      if (enrollerProfile?.status === 'gerente') {
        gerente = {
          id: enrollerProfile.id,
          email: enrollerProfile.email ?? '',
          full_name: enrollerProfile.full_name ?? null,
        };
      }
    }

    return successResponse({
      id: userId,
      email: profile.email,
      full_name: profile.full_name,
      telefone: profile.telefone,
      status: profile.status,
      enroller: profile.enroller,
      created_at: profile.created_at,
      bancas,
      gerente,
      needs_bancas_choice,
    });
  } catch (err: any) {
    return errorResponse(err.message || 'Erro ao buscar perfil', 401);
  }
}

