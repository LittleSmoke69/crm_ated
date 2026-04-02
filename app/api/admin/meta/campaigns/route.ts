/**
 * GET /api/admin/meta/campaigns - Lista campanhas da conta Meta (para dropdown)
 * Query: banca_id (UUID) - obrigatório
 */

import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { isMetaIntegrationLinkedToBanca, loadCampaigns } from '@/lib/services/meta-sync-service';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const bancaId = req.nextUrl.searchParams.get('banca_id');
    if (!bancaId) {
      return errorResponse('banca_id é obrigatório', 400);
    }

    const integrationIdRaw = req.nextUrl.searchParams.get('integration_id')?.trim();
    let integrationId: string | null = integrationIdRaw || null;
    if (integrationId) {
      const linked = await isMetaIntegrationLinkedToBanca(integrationId, bancaId);
      if (!linked) return errorResponse('integration_id não pertence a esta banca.', 400);
    }

    const result = await loadCampaigns(bancaId, integrationId);
    if (!result.success) {
      console.log('[admin/meta API] GET campaigns resposta', {
        banca_id: bancaId,
        success: false,
        error: result.error ?? null,
      });
      return successResponse({
        success: false,
        error: result.error,
        campaigns: [],
      });
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
    console.log('[admin/meta API] GET campaigns resposta', {
      banca_id: bancaId,
      success: true,
      campaigns_count: list.length,
    });
    return successResponse({
      success: true,
      campaigns: enriched,
    });
  } catch (err: any) {
    if (err?.message?.includes('Acesso negado') || err?.message?.includes('não autenticado')) {
      return errorResponse(err.message, 403);
    }
    return serverErrorResponse(err);
  }
}
