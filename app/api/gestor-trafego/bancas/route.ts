import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { getUserProfile } from '@/lib/middleware/permissions';
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
 * GET /api/gestor-trafego/bancas
 * Lista as bancas às quais o gestor está atribuído (user_bancas), com dono_id para cada uma.
 * Apenas para usuários com status 'gestor'. Resolve perfil por id ou user_id para compatibilidade.
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth(req);
    if (!auth?.userId) {
      return errorResponse('Não autenticado', 403);
    }
    const userId = auth.userId.trim();
    let profile = await getUserProfile(userId);
    if (!profile) {
      const { data: profileByUserId } = await supabaseServiceRole
        .from('profiles')
        .select('id, email, full_name, status, enroller, created_at, banca_url, banca_name')
        .eq('user_id', userId)
        .maybeSingle();
      if (profileByUserId) profile = profileByUserId as Awaited<ReturnType<typeof getUserProfile>>;
    }
    const statusNorm = profile?.status?.trim().toLowerCase();
    if (!profile || statusNorm !== 'gestor') {
      return errorResponse('Acesso negado', 403);
    }
    const profileId = profile.id;

    let { data: ubRow } = await supabaseServiceRole
      .from('user_bancas')
      .select('banca_ids')
      .eq('user_id', profileId)
      .maybeSingle();

    if (!Array.isArray(ubRow?.banca_ids) || ubRow.banca_ids.length === 0) {
      if (userId !== profileId) {
        const { data: fallback } = await supabaseServiceRole.from('user_bancas').select('banca_ids').eq('user_id', userId).maybeSingle();
        ubRow = fallback ?? ubRow;
      }
    }

    const bancaIds = Array.isArray(ubRow?.banca_ids) ? (ubRow.banca_ids as string[]) : [];
    if (bancaIds.length === 0) {
      return successResponse([]);
    }

    const { data: bancas } = await supabaseServiceRole
      .from('crm_bancas')
      .select('id, name, url')
      .in('id', bancaIds);

    if (!bancas?.length) {
      return successResponse([]);
    }

    const { data: donos } = await supabaseServiceRole
      .from('profiles')
      .select('id, banca_url')
      .eq('status', 'dono_banca');

    const urlToDonoId = new Map<string, string>();
    (donos || []).forEach((d: { id: string; banca_url?: string | null }) => {
      const norm = normalizeBancaUrl(d.banca_url);
      if (norm) urlToDonoId.set(norm, d.id);
    });

    const result = bancas
      .map((b: { id: string; name: string | null; url: string | null }) => {
        const donoId = urlToDonoId.get(normalizeBancaUrl(b.url)) || null;
        return {
          banca_id: b.id,
          banca_name: b.name || b.url || b.id,
          url: b.url,
          dono_id: donoId,
        };
      })
      .sort((a: { banca_name: string }, b: { banca_name: string }) =>
        String(a.banca_name).localeCompare(String(b.banca_name))
      );

    return successResponse(result);
  } catch (err: any) {
    if (err.message?.includes('Acesso negado') || err.message?.includes('Não autenticado')) {
      return errorResponse(err.message, 403);
    }
    return serverErrorResponse(err);
  }
}
