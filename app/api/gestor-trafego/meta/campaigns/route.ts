/**
 * GET /api/gestor-trafego/meta/campaigns - Lista campanhas Meta da banca (para selecionar padrão)
 * Gestor: apenas bancas que tem acesso. Admin/Super Admin: qualquer banca.
 * Query: banca_id (obrigatório)
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { getUserProfile } from '@/lib/middleware/permissions';
import { canAccessGestorTrafego } from '@/lib/middleware/gestor-trafego-access';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { loadCampaigns } from '@/lib/services/meta-sync-service';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

function normalizeBancaUrl(url: string | null | undefined): string {
  if (!url) return '';
  let s = String(url).trim();
  s = s.replace(/^https?:\/\//i, '');
  s = s.replace(/\/api\/crm\/?/i, '');
  s = s.replace(/\/+$/, '');
  return s.trim().toLowerCase();
}

async function userCanAccessBanca(
  userId: string,
  profile: { id: string; status?: string | null; enroller?: string | null },
  bancaId: string
): Promise<boolean> {
  if (profile.status === 'admin' || profile.status === 'super_admin') return true;
  const profileId = profile.id;
  let { data: ubRow } = await supabaseServiceRole
    .from('user_bancas')
    .select('banca_ids')
    .eq('user_id', profileId)
    .maybeSingle();
  if ((!ubRow?.banca_ids?.length) && userId !== profileId) {
    const { data: fallback } = await supabaseServiceRole.from('user_bancas').select('banca_ids').eq('user_id', userId).maybeSingle();
    ubRow = fallback ?? ubRow;
  }
  const assignedBancaIds = new Set(Array.isArray(ubRow?.banca_ids) ? (ubRow.banca_ids as string[]) : []);
  if (assignedBancaIds.has(bancaId)) return true;
  if (profile.enroller) {
    const { data: dono } = await supabaseServiceRole
      .from('profiles')
      .select('id, banca_url')
      .eq('id', profile.enroller)
      .eq('status', 'dono_banca')
      .single();
    if (dono?.banca_url) {
      const { data: allBancas } = await supabaseServiceRole.from('crm_bancas').select('id, url');
      const match = (allBancas || []).find(
        (b: { id: string; url?: string }) =>
          b.id === bancaId && normalizeBancaUrl(b.url) === normalizeBancaUrl(dono.banca_url)
      );
      if (match) return true;
    }
  }
  return false;
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth(req);
    if (!auth?.userId) return errorResponse('Não autenticado', 403);
    const userId = auth.userId.trim();

    let profile = await getUserProfile(userId);
    if (!profile) {
      const { data: profileByUserId } = await supabaseServiceRole
        .from('profiles')
        .select('id, status, enroller')
        .eq('user_id', userId)
        .maybeSingle();
      if (profileByUserId) profile = profileByUserId as Awaited<ReturnType<typeof getUserProfile>>;
    }
    if (!profile) return errorResponse('Perfil não encontrado', 403);

    const hasAccess = await canAccessGestorTrafego(profile);
    if (!hasAccess) return errorResponse('Acesso negado. Você não tem permissão para acessar o módulo Gestão de Tráfego.', 403);

    const bancaId = req.nextUrl.searchParams.get('banca_id')?.trim();
    if (!bancaId) return errorResponse('banca_id é obrigatório', 400);

    const canAccess = await userCanAccessBanca(userId, profile, bancaId);
    if (!canAccess) return errorResponse('Você não tem permissão para esta banca.', 403);

    const result = await loadCampaigns(bancaId);
    if (!result.success) {
      return successResponse({ campaigns: [], error: result.error });
    }
    return successResponse({
      campaigns: result.campaigns || [],
    });
  } catch (err: any) {
    if (err?.message?.includes('Acesso negado') || err?.message?.includes('Não autenticado')) {
      return errorResponse(err.message, 403);
    }
    return serverErrorResponse(err);
  }
}
