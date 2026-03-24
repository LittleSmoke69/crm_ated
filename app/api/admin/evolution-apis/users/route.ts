import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

const PROFILES_PAGE_SIZE = 1000;

async function fetchAllProfilesBasic(): Promise<{ data: { id: string; email: string | null; full_name: string | null }[]; error: { message: string } | null }> {
  const list: { id: string; email: string | null; full_name: string | null }[] = [];
  let offset = 0;
  for (;;) {
    const { data: batch, error } = await supabaseServiceRole
      .from('profiles')
      .select('id, email, full_name')
      .order('created_at', { ascending: false })
      .range(offset, offset + PROFILES_PAGE_SIZE - 1);

    if (error) {
      return { data: [], error };
    }
    const rows = batch || [];
    list.push(...rows);
    if (rows.length < PROFILES_PAGE_SIZE) {
      break;
    }
    offset += PROFILES_PAGE_SIZE;
  }
  return { data: list, error: null };
}

/**
 * GET /api/admin/evolution-apis/users - Lista usuários e suas APIs atribuídas
 */
export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    
    // Verifica se é admin
    const { data: profile } = await supabaseServiceRole
      .from('profiles')
      .select('status')
      .eq('id', userId)
      .single();

    const canAccess = profile?.status === 'super_admin' || profile?.status === 'admin' || profile?.status === 'dono_banca';
    if (!canAccess) {
      return errorResponse('Acesso negado. Apenas administradores podem acessar.', 403);
    }

    const { data: users, error: usersError } = await fetchAllProfilesBasic();

    if (usersError) {
      return errorResponse(`Erro ao buscar usuários: ${usersError.message}`);
    }

    // Uma única query para todas as atribuições (evita N queries paralelas e "fetch failed")
    const { data: allAssignments, error: assignmentsError } = await supabaseServiceRole
      .from('user_evolution_apis')
      .select(`
        user_id,
        id,
        is_default,
        evolution_apis (
          id,
          name,
          base_url,
          is_active
        )
      `);

    if (assignmentsError) {
      console.error('[evolution-apis/users] Erro ao buscar atribuições:', assignmentsError.message);
    }

    type AssignmentRow = {
      user_id: string;
      id: string;
      is_default: boolean;
      evolution_apis: { id: string; name: string; base_url: string; is_active: boolean } | null;
    };

    const apisByUserId = new Map<string, AssignmentRow[]>();
    (allAssignments || []).forEach((row: Record<string, unknown>) => {
      const r: AssignmentRow = {
        user_id: row.user_id as string,
        id: row.id as string,
        is_default: (row.is_default as boolean) ?? false,
        evolution_apis: (row.evolution_apis as AssignmentRow['evolution_apis']) ?? null,
      };
      const list = apisByUserId.get(r.user_id) || [];
      list.push(r);
      apisByUserId.set(r.user_id, list);
    });

    const usersWithApis = (users || []).map((user) => ({
      ...user,
      evolution_apis: apisByUserId.get(user.id) || [],
    }));

    return successResponse(usersWithApis);
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

