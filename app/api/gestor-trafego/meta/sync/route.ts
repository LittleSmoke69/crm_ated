/**
 * POST /api/gestor-trafego/meta/sync
 * Sincroniza dados Meta Ads para a banca selecionada.
 * Gestor: apenas bancas atribuídas em user_bancas. Admin/Super Admin: qualquer banca.
 * Body: { banca_id: string, date_preset?: string } - date_preset default: last_30d
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { getUserProfile } from '@/lib/middleware/permissions';
import { canAccessGestorTrafego } from '@/lib/middleware/gestor-trafego-access';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { runSync } from '@/lib/services/meta-sync-service';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { gestorTrafegoUserCanAccessBanca } from '@/lib/services/gestor-trafego-bancas';

export async function POST(req: NextRequest) {
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
        .select('id, email, full_name, status, enroller')
        .eq('user_id', userId)
        .maybeSingle();
      if (profileByUserId) profile = profileByUserId as Awaited<ReturnType<typeof getUserProfile>>;
    }
    if (!profile) {
      return errorResponse('Perfil não encontrado', 403);
    }

    const hasAccess = await canAccessGestorTrafego(profile);
    if (!hasAccess) return errorResponse('Acesso negado. Você não tem permissão para acessar o módulo Gestão de Tráfego.', 403);

    const body = await req.json().catch(() => ({}));
    const bancaId = body?.banca_id?.trim();
    if (!bancaId) {
      return errorResponse('banca_id é obrigatório', 400);
    }

    const statusNorm = profile.status?.trim().toLowerCase();
    // Admin/Super Admin: pode sincronizar qualquer banca
    if (statusNorm === 'admin' || statusNorm === 'super_admin') {
      const result = await runSync(bancaId, body?.date_preset || 'last_30d');
      if (!result.success) {
        return successResponse({ success: false, error: result.error });
      }
      return successResponse({
        success: true,
        campaignsCount: result.campaignsCount,
        adsetsCount: result.adsetsCount,
        insightsCount: result.insightsCount,
      });
    }

    const canAccess = await gestorTrafegoUserCanAccessBanca(userId, profile, bancaId);
    if (!canAccess) {
      return errorResponse('Você não tem permissão para sincronizar esta banca.', 403);
    }

    const result = await runSync(bancaId, body?.date_preset || 'last_30d');
    if (!result.success) {
      return successResponse({ success: false, error: result.error });
    }
    return successResponse({
      success: true,
      campaignsCount: result.campaignsCount,
      adsetsCount: result.adsetsCount,
      insightsCount: result.insightsCount,
    });
  } catch (err: any) {
    if (err?.message?.includes('Acesso negado') || err?.message?.includes('Não autenticado')) {
      return errorResponse(err.message, 403);
    }
    return serverErrorResponse(err);
  }
}
