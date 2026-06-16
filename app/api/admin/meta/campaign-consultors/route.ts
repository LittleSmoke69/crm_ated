import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { errorResponse, serverErrorResponse, successResponse } from '@/lib/utils/response';
import { listConsultoresForAdsAttributionDropdown, setCampaignConsultors, type CampaignConsultorAssignmentInput } from '@/lib/services/meta-campaign-consultors';
import { isMetaVerboseLogEnabled } from '@/lib/utils/meta-debug-log';

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const bancaId = req.nextUrl.searchParams.get('banca_id')?.trim();
    if (!bancaId) {
      return errorResponse('banca_id é obrigatório.', 400);
    }
    if (isMetaVerboseLogEnabled()) {
      console.info('[meta-ads-hierarchy] api_GET_campaign_consultors', { banca_id: bancaId });
    }
    const consultors = await listConsultoresForAdsAttributionDropdown(bancaId);
    return successResponse({ consultors, debug: consultors.length === 0 ? { banca_id: bancaId, empty: true, hint: 'Verifique logs [meta-ads-hierarchy] no servidor com LOG_META_ADS_HIERARCHY=1 para diagnóstico detalhado.' } : undefined });
  } catch (err: any) {
    if (err?.message?.includes('Acesso negado')) {
      return errorResponse(err.message, 403);
    }
    return serverErrorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin(req);
    const body = await req.json();
    const bancaId = String(body?.banca_id ?? '').trim();
    const campaignId = String(body?.campaign_id ?? '').trim();
    const assignments = Array.isArray(body?.assignments)
      ? (body.assignments as CampaignConsultorAssignmentInput[])
      : null;
    const consultorIds = Array.isArray(body?.consultor_ids)
      ? body.consultor_ids.map((id: unknown) => String(id ?? '').trim()).filter(Boolean)
      : [];

    if (!bancaId || !campaignId) {
      return errorResponse('banca_id e campaign_id são obrigatórios.', 400);
    }

    await setCampaignConsultors(bancaId, campaignId, assignments ?? consultorIds);
    return successResponse({ success: true });
  } catch (err: any) {
    if (err?.message?.includes('Acesso negado')) {
      return errorResponse(err.message, 403);
    }
    return serverErrorResponse(err);
  }
}
