import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { getEffectiveZaplotoId } from '@/lib/tenant-context';

const PAGE_SIZE = 1000;
const USER_ID_CHUNK_SIZE = 500;

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

/**
 * GET /api/admin/users/overview — lista enxuta para a tela de gestão de usuários:
 * perfil + cargo, ativo/inativo (user_settings.is_active), gerente (enroller) e leads atribuídos (crm_leads).
 */
export async function GET(req: NextRequest) {
  try {
    const { profile } = await requireAdmin(req);
    const zaplotoId = await getEffectiveZaplotoId(req, profile);

    // Perfis do tenant (paginação explícita como em /api/admin/users)
    const list: any[] = [];
    let from = 0;
    while (true) {
      const { data, error } = await supabaseServiceRole
        .from('profiles')
        .select('id, email, full_name, status, enroller, created_at, last_seen_at, last_login_at, total_online_time, total_crm_time')
        .or(`zaploto_id.eq.${zaplotoId},zaploto_id.is.null`)
        .order('created_at', { ascending: false })
        .range(from, from + PAGE_SIZE - 1);

      if (error) {
        return errorResponse(`Erro ao buscar usuários: ${error.message}`);
      }
      const batch = data || [];
      list.push(...batch);
      if (batch.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }

    if (list.length === 0) return successResponse([]);

    const userIds = list.map((u: { id: string }) => u.id);
    const byId = new Map<string, any>(list.map((u: any) => [u.id, u]));

    // is_active (user_settings) em lotes
    const activeByUser = new Map<string, boolean>();
    for (const ids of chunkArray(userIds, USER_ID_CHUNK_SIZE)) {
      const { data: settings } = await supabaseServiceRole
        .from('user_settings')
        .select('user_id, is_active')
        .in('user_id', ids);
      (settings || []).forEach((s: any) => activeByUser.set(s.user_id, s.is_active !== false));
    }

    // Leads atribuídos por usuário (crm_leads.user_id), contados em memória
    const leadsByUser = new Map<string, number>();
    for (const ids of chunkArray(userIds, USER_ID_CHUNK_SIZE)) {
      let leadFrom = 0;
      while (true) {
        const { data: leads, error: leadsErr } = await supabaseServiceRole
          .from('crm_leads')
          .select('user_id')
          .in('user_id', ids)
          .range(leadFrom, leadFrom + PAGE_SIZE - 1);
        if (leadsErr) break;
        const batch = leads || [];
        batch.forEach((l: any) => leadsByUser.set(l.user_id, (leadsByUser.get(l.user_id) || 0) + 1));
        if (batch.length < PAGE_SIZE) break;
        leadFrom += PAGE_SIZE;
      }
    }

    const users = list.map((u: any) => {
      const enrollerProfile = u.enroller ? byId.get(u.enroller) : null;
      return {
        id: u.id,
        email: u.email,
        full_name: u.full_name,
        status: u.status,
        enroller: u.enroller,
        enroller_name: enrollerProfile ? (enrollerProfile.full_name || enrollerProfile.email) : null,
        created_at: u.created_at,
        last_seen_at: u.last_seen_at,
        last_login_at: u.last_login_at,
        total_online_time: u.total_online_time || 0,
        total_crm_time: u.total_crm_time || 0,
        is_active: activeByUser.has(u.id) ? activeByUser.get(u.id) : true,
        leads_count: leadsByUser.get(u.id) || 0,
      };
    });

    return successResponse(users);
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}
