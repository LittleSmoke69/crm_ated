import { NextRequest } from 'next/server';
import { getUserProfile } from '@/lib/middleware/permissions';
import { requireGestorTrafego } from '@/lib/middleware/gestor-trafego-access';
import { resolveGestorTrafegoOwnerIdFromRequest } from '@/lib/middleware/gestor-owner';
import { successResponse, errorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { isInHierarchy } from '@/lib/utils/hierarchy';

function normalizeBancaUrl(bancaUrl: string): string {
  if (!bancaUrl) return bancaUrl;
  let normalized = bancaUrl.trim();
  normalized = normalized.replace(/^https?:\/\//i, '');
  normalized = normalized.replace(/\/api\/crm\/?/i, '');
  normalized = normalized.replace(/\/+$/, '').trim();
  if (normalized) {
    normalized = `https://${normalized}`;
  }
  return normalized;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ consultorId: string }> }
) {
  try {
    const { userId } = await requireGestorTrafego(req);
    const profile = await getUserProfile(userId);
    if (!profile) return errorResponse('Perfil não encontrado', 403);
    const statusNorm = profile.status?.trim().toLowerCase();
    const ownerId = await resolveGestorTrafegoOwnerIdFromRequest(req, userId, statusNorm);
    if (!ownerId) return errorResponse('Gestor vinculado a um Dono ou informe X-Effective-Dono-Id.', 403);

    const resolvedParams = await params;
    const consultorId = resolvedParams.consultorId;

    const { searchParams } = req.nextUrl;
    const dateFrom = searchParams.get('date_from');
    const dateTo = searchParams.get('date_to');

    const isOwner = await isInHierarchy(ownerId, consultorId);
    if (!isOwner) {
      return errorResponse('Acesso negado. Este consultor não pertence à banca vinculada.', 403);
    }

    const { data: consultor } = await supabaseServiceRole
      .from('profiles')
      .select('id, email, full_name')
      .eq('id', consultorId)
      .single();

    if (!consultor || !consultor.email) {
      return errorResponse('Consultor não encontrado ou sem email.', 404);
    }

    const { data: donoProfile } = await supabaseServiceRole
      .from('profiles')
      .select('banca_url')
      .eq('id', ownerId)
      .single();

    if (!donoProfile?.banca_url) {
      return errorResponse('Banca URL não configurada.', 400);
    }

    const cleanBancaUrl = normalizeBancaUrl(donoProfile.banca_url);
    const apiKey = process.env.CRM_API_KEY;

    const leadsUrl = new URL(`${cleanBancaUrl}/api/crm/leads`);
    leadsUrl.searchParams.append('consultant', consultor.email);
    if (dateFrom) leadsUrl.searchParams.append('date_from', dateFrom);
    if (dateTo) leadsUrl.searchParams.append('date_to', dateTo);

    const leadsResponse = await fetch(leadsUrl.toString(), {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        ...(apiKey && { 'X-API-KEY': apiKey }),
      },
    });

    if (!leadsResponse.ok) {
      return errorResponse('Erro ao buscar leads do CRM', leadsResponse.status);
    }

    const leadsResult = await leadsResponse.json();
    const leads = leadsResult.success ? (leadsResult.data || []) : [];

    const statusDistribution: Record<string, number> = {};
    const starsDistribution: Record<string, number> = {};
    const topBettors: Array<{ name: string; value: number }> = [];
    const topWinners: Array<{ name: string; value: number }> = [];
    const topDepositors: Array<{ name: string; value: number }> = [];

    leads.forEach((lead: any) => {
      const status = lead.status || 'novo';
      statusDistribution[status] = (statusDistribution[status] || 0) + 1;

      const stars = parseInt(String(lead.stars || lead.user_level || 0)) || 0;
      const starsKey = stars > 0 ? `${stars} ⭐` : 'Sem estrelas';
      starsDistribution[starsKey] = (starsDistribution[starsKey] || 0) + 1;

      const totalApostado = parseFloat(lead.total_apostado) || 0;
      if (totalApostado > 0) {
        topBettors.push({ name: lead.name || 'Sem nome', value: totalApostado });
      }

      const totalGanho = parseFloat(lead.total_ganho) || 0;
      if (totalGanho > 0) {
        topWinners.push({ name: lead.name || 'Sem nome', value: totalGanho });
      }

      const totalDepositado = parseFloat(lead.total_depositado) || 0;
      if (totalDepositado > 0) {
        topDepositors.push({ name: lead.name || 'Sem nome', value: totalDepositado });
      }
    });

    const starsArray = Object.entries(starsDistribution)
      .map(([key, value]) => {
        const starsNum = parseInt(key.replace(/[^0-9]/g, '')) || 0;
        return { name: key, value, starsNum };
      })
      .sort((a, b) => a.starsNum - b.starsNum)
      .map(item => ({ name: item.name, value: item.value }));

    return successResponse({
      status_distribution: statusDistribution,
      stars_distribution: starsDistribution,
      stars_distribution_array: starsArray,
      top_bettors: topBettors.sort((a, b) => b.value - a.value).slice(0, 10),
      top_winners: topWinners.sort((a, b) => b.value - a.value).slice(0, 10),
      top_depositors: topDepositors.sort((a, b) => b.value - a.value).slice(0, 10),
      total_leads: leads.length,
    });
  } catch (error: any) {
    console.error('[Gestor CRM Details API] Erro:', error);
    return errorResponse(error.message || 'Erro ao buscar detalhes do CRM', 500);
  }
}
