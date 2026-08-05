import { NextRequest } from 'next/server';
import { requireAdmin, isSuperAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { getEffectiveZaplotoId } from '@/lib/tenant-context';

const PAGE_SIZE = 1000;
const USER_ID_CHUNK_SIZE = 500;

/**
 * POST /api/admin/users/delete-inactive — remove em lote os usuários inativos (user_settings.is_active = false)
 * do tenant atual. Nunca remove o próprio solicitante, nem super_admin quando quem pede não é super_admin.
 * Usuários com subordinados restantes (ativos, ou inativos que não puderam ser removidos) são pulados,
 * igual à regra do DELETE individual em /api/admin/users/[userId].
 */
export async function POST(req: NextRequest) {
  try {
    const { userId: requesterId, profile } = await requireAdmin(req);
    const zaplotoId = await getEffectiveZaplotoId(req, profile);
    const requesterIsSuperAdmin = isSuperAdmin(profile);

    const profiles: { id: string; status: string | null; enroller: string | null }[] = [];
    let from = 0;
    while (true) {
      const { data, error } = await supabaseServiceRole
        .from('profiles')
        .select('id, status, enroller')
        .or(`zaploto_id.eq.${zaplotoId},zaploto_id.is.null`)
        .range(from, from + PAGE_SIZE - 1);

      if (error) {
        return errorResponse(`Erro ao buscar usuários: ${error.message}`);
      }
      const batch = data || [];
      profiles.push(...batch);
      if (batch.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }

    if (profiles.length === 0) {
      return successResponse({ deletedCount: 0, skipped: [] });
    }

    const userIds = profiles.map((p) => p.id);
    const activeByUser = new Map<string, boolean>();
    for (let i = 0; i < userIds.length; i += USER_ID_CHUNK_SIZE) {
      const chunk = userIds.slice(i, i + USER_ID_CHUNK_SIZE);
      const { data: settings } = await supabaseServiceRole
        .from('user_settings')
        .select('user_id, is_active')
        .in('user_id', chunk);
      (settings || []).forEach((s: any) => activeByUser.set(s.user_id, s.is_active !== false));
    }

    const isActive = (id: string) => (activeByUser.has(id) ? activeByUser.get(id) : true);

    let candidates = profiles.filter((p) => {
      if (p.id === requesterId) return false;
      if (isActive(p.id)) return false;
      if (p.status === 'super_admin' && !requesterIsSuperAdmin) return false;
      return true;
    });

    if (candidates.length === 0) {
      return successResponse({ deletedCount: 0, skipped: [] });
    }

    const remainingIds = new Set(profiles.map((p) => p.id));
    const deleted: string[] = [];
    const skipped: { id: string; reason: string }[] = [];

    let progress = true;
    while (candidates.length > 0 && progress) {
      progress = false;
      const next: typeof candidates = [];
      for (const cand of candidates) {
        const hasChildren = profiles.some((p) => p.enroller === cand.id && remainingIds.has(p.id));
        if (hasChildren) {
          next.push(cand);
          continue;
        }
        const { error: deleteError } = await supabaseServiceRole
          .from('profiles')
          .delete()
          .eq('id', cand.id);

        if (deleteError) {
          skipped.push({ id: cand.id, reason: deleteError.message });
          remainingIds.delete(cand.id);
        } else {
          deleted.push(cand.id);
          remainingIds.delete(cand.id);
          progress = true;
        }
      }
      candidates = next;
    }

    candidates.forEach((cand) => {
      skipped.push({ id: cand.id, reason: 'Possui subordinados que não puderam ser removidos.' });
    });

    return successResponse(
      { deletedCount: deleted.length, skipped },
      `${deleted.length} usuário${deleted.length === 1 ? '' : 's'} inativo${deleted.length === 1 ? '' : 's'} removido${deleted.length === 1 ? '' : 's'}.`
    );
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}
