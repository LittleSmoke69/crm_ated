import { NextRequest } from 'next/server';
import { requireGestorTrafego } from '@/lib/middleware/gestor-trafego-access';
import { errorResponse, serverErrorResponse, successResponse } from '@/lib/utils/response';
import { listConsultoresForAdsAttributionDropdown, setCampaignConsultors, type CampaignConsultorAssignmentInput } from '@/lib/services/meta-campaign-consultors';

export async function GET(req: NextRequest) {
  try {
    await requireGestorTrafego(req);
    const bancaId = req.nextUrl.searchParams.get('banca_id')?.trim();
    if (!bancaId) {
      return errorResponse('banca_id é obrigatório.', 400);
    }
    const consultors = await listConsultoresForAdsAttributionDropdown(bancaId);
    return successResponse({ consultors });
  } catch (err: any) {
    if (err?.message?.includes('Acesso negado')) {
      return errorResponse(err.message, 403);
    }
    return serverErrorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireGestorTrafego(req);
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
