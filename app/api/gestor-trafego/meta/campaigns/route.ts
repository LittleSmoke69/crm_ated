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
import { isMetaIntegrationLinkedToBanca, loadCampaigns } from '@/lib/services/meta-sync-service';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { gestorTrafegoUserCanAccessBanca } from '@/lib/services/gestor-trafego-bancas';

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

    const canAccess = await gestorTrafegoUserCanAccessBanca(userId, profile, bancaId);
    if (!canAccess) return errorResponse('Você não tem permissão para esta banca.', 403);

    const integrationIdRaw = req.nextUrl.searchParams.get('integration_id')?.trim();
    let integrationId: string | null = integrationIdRaw || null;
    if (integrationId) {
      const linked = await isMetaIntegrationLinkedToBanca(integrationId, bancaId);
      if (!linked) return errorResponse('integration_id inválido para esta banca.', 400);
    }

    const result = await loadCampaigns(bancaId, integrationId);
    if (!result.success) {
      return successResponse({ campaigns: [], error: result.error });
    }
    const list = result.campaigns || [];
    const ids = list.map((c) => c.id).filter(Boolean);
    const kindMap = new Map<string, string>();
    if (ids.length > 0) {
      const { data: rows } = await supabaseServiceRole
        .from('meta_campaigns')
        .select('campaign_id,campaign_kind')
        .eq('banca_id', bancaId)
        .in('campaign_id', ids);
      for (const r of rows ?? []) {
        const row = r as { campaign_id: string; campaign_kind?: string | null };
        kindMap.set(row.campaign_id, String(row.campaign_kind || 'normal'));
      }
    }
    const enriched = list.map((c) => ({
      ...c,
      campaign_kind: (kindMap.get(c.id) ?? 'normal') as 'normal' | 'bolao',
    }));
    return successResponse({
      campaigns: enriched,
    });
  } catch (err: any) {
    if (err?.message?.includes('Acesso negado') || err?.message?.includes('Não autenticado')) {
      return errorResponse(err.message, 403);
    }
    return serverErrorResponse(err);
  }
}
