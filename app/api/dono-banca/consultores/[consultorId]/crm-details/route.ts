import { NextRequest } from 'next/server';
import { requireStatus } from '@/lib/middleware/permissions';
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
    const { userId: ownerId } = await requireStatus(req, ['dono_banca']);
    const resolvedParams = await params;
    const consultorId = resolvedParams.consultorId;

    // Busca parâmetros de data da query string
    const { searchParams } = req.nextUrl;
    const dateFrom = searchParams.get('date_from');
    const dateTo = searchParams.get('date_to');

    // Verifica se o consultor pertence à banca
    const isOwner = await isInHierarchy(ownerId, consultorId);
    if (!isOwner) {
      return errorResponse('Acesso negado. Este consultor não pertence à sua banca.', 403);
    }

    // Busca dados do Consultor
    const { data: consultor } = await supabaseServiceRole
      .from('profiles')
      .select('id, email, full_name')
      .eq('id', consultorId)
      .single();

    if (!consultor || !consultor.email) {
      return errorResponse('Consultor não encontrado ou sem email.', 404);
    }

    // Busca banca_url do dono de banca
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

    // Busca leads do consultor via API do CRM
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

    // Processa dados para gráficos
    const statusDistribution: Record<string, number> = {};
    const starsDistribution: Record<string, number> = {};
    const topBettors: Array<{ name: string; value: number }> = [];
    const topWinners: Array<{ name: string; value: number }> = [];
    const topDepositors: Array<{ name: string; value: number }> = [];

    leads.forEach((lead: any) => {
      // Distribuição por Status
      const status = lead.status || 'novo';
      statusDistribution[status] = (statusDistribution[status] || 0) + 1;

      // Distribuição por Estrelas
      const stars = parseInt(String(lead.stars || lead.user_level || 0)) || 0;
      const starsKey = stars > 0 ? `${stars} ⭐` : 'Sem estrelas';
      starsDistribution[starsKey] = (starsDistribution[starsKey] || 0) + 1;

      // Top Apostadores
      const totalApostado = parseFloat(lead.total_apostado) || 0;
      if (totalApostado > 0) {
        topBettors.push({
          name: lead.name || 'Sem nome',
          value: totalApostado,
        });
      }

      // Top Ganhadores
      const totalGanho = parseFloat(lead.total_ganho) || 0;
      if (totalGanho > 0) {
        topWinners.push({
          name: lead.name || 'Sem nome',
          value: totalGanho,
        });
      }

      // Top Depositantes
      const totalDepositado = parseFloat(lead.total_depositado) || 0;
      if (totalDepositado > 0) {
        topDepositors.push({
          name: lead.name || 'Sem nome',
          value: totalDepositado,
        });
      }
    });

    // Ordena e pega top 10
    const top10Bettors = topBettors
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);

    const top10Winners = topWinners
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);

    const top10Depositors = topDepositors
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);

    // Ordena distribuição de estrelas por número de estrelas (0 a 10)
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
      stars_distribution_array: starsArray, // Array ordenado para gráfico de barras
      top_bettors: top10Bettors,
      top_winners: top10Winners,
      top_depositors: top10Depositors,
      total_leads: leads.length,
    });
  } catch (error: any) {
    console.error('[CRM Details API] Erro:', error);
    return errorResponse(error.message || 'Erro ao buscar detalhes do CRM', 500);
  }
}

