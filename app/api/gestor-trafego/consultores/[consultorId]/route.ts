import { NextRequest } from 'next/server';
import { requireStatus, getUserProfile } from '@/lib/middleware/permissions';
import { getEffectiveDonoIdForGestor } from '@/lib/middleware/gestor-owner';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { isInHierarchy } from '@/lib/utils/hierarchy';

/**
 * GET /api/gestor-trafego/consultores/[consultorId]
 * Retorna métricas detalhadas de um consultor (gestor vê dados da banca vinculada)
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ consultorId: string }> }
) {
  let consultorId: string | undefined;
  try {
    const { userId } = await requireStatus(req, ['gestor', 'admin', 'super_admin']);
    const profile = await getUserProfile(userId);
    if (!profile) return errorResponse('Perfil não encontrado', 403);
    const statusNorm = profile.status?.trim().toLowerCase();
    let ownerId: string | null = statusNorm === 'gestor'
      ? await getEffectiveDonoIdForGestor(userId)
      : req.headers.get('X-Effective-Dono-Id');
    if (!ownerId) return errorResponse('Gestor vinculado a um Dono ou informe X-Effective-Dono-Id.', 403);

    const resolvedParams = await params;
    consultorId = resolvedParams.consultorId;

    const { searchParams } = req.nextUrl;
    const dateFrom = searchParams.get('date_from');
    const dateTo = searchParams.get('date_to');

    const isOwner = await isInHierarchy(ownerId, consultorId!);
    if (!isOwner) {
      return errorResponse('Acesso negado. Este consultor não pertence à banca vinculada.', 403);
    }

    const { data: consultor } = await supabaseServiceRole
      .from('profiles')
      .select('id, email, full_name, created_at, enroller')
      .eq('id', consultorId)
      .single();

    if (!consultor) {
      return errorResponse('Consultor não encontrado.', 404);
    }

    const { data: campaigns } = await supabaseServiceRole
      .from('campaigns')
      .select('*')
      .eq('user_id', consultorId!)
      .order('created_at', { ascending: false });

    const { data: leads } = await supabaseServiceRole
      .from('searches')
      .select('*')
      .eq('user_id', consultorId!)
      .not('telefone', 'is', null)
      .order('created_at', { ascending: false });

    const totalProcessed = campaigns?.reduce((s, c) => s + (c.processed_contacts || 0), 0) || 0;
    const totalFailed = campaigns?.reduce((s, c) => s + (c.failed_contacts || 0), 0) || 0;

    const { data: donoProfile } = await supabaseServiceRole
      .from('profiles')
      .select('banca_url')
      .eq('id', ownerId)
      .single();

    const bancaUrl = donoProfile?.banca_url;
    const apiKey = process.env.CRM_API_KEY;

    let externalKpis = null;
    let externalKpisError: string | null = null;

    if (bancaUrl && consultor.email) {
      try {
        let cleanBancaUrl = bancaUrl.trim();
        cleanBancaUrl = cleanBancaUrl.replace(/^https?:\/\//i, '');
        cleanBancaUrl = cleanBancaUrl.replace(/\/api\/crm\/?/i, '');
        cleanBancaUrl = cleanBancaUrl.replace(/\/+$/, '').trim();
        cleanBancaUrl = `https://${cleanBancaUrl}`;

        const externalApiUrl = new URL(`${cleanBancaUrl}/api/crm/dashboard-metrics`);
        externalApiUrl.searchParams.append('consultant', consultor.email);
        if (dateFrom) externalApiUrl.searchParams.append('date_from', dateFrom);
        if (dateTo) externalApiUrl.searchParams.append('date_to', dateTo);

        const externalResponse = await fetch(externalApiUrl.toString(), {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            ...(apiKey && { 'X-API-KEY': apiKey }),
          },
        });

        if (externalResponse.ok) {
          const externalData = await externalResponse.json();
          if (externalData.success && externalData.metrics) {
            externalKpis = {
              total_leads: externalData.metrics.total_leads || 0,
              total_deposited: externalData.metrics.total_deposited || 0,
              total_bets: externalData.metrics.total_bets || 0,
              total_prizes: externalData.metrics.total_prizes || 0,
              active_leads: externalData.metrics.active_leads || 0,
              conversion_rate: externalData.metrics.conversion_rate || 0,
              net_profit: externalData.metrics.net_profit || 0,
            };
          } else {
            externalKpisError = 'Dados não disponíveis';
          }
        } else {
          const errorText = await externalResponse.text();
          externalKpisError = `Erro ${externalResponse.status}: ${errorText.substring(0, 50)}`;
        }
      } catch (error: any) {
        externalKpisError = error.message || 'Erro ao buscar KPIs';
      }
    }

    let chartData = null;
    if (bancaUrl && consultor.email) {
      try {
        let cleanBancaUrl = bancaUrl.trim();
        cleanBancaUrl = cleanBancaUrl.replace(/^https?:\/\//i, '');
        cleanBancaUrl = cleanBancaUrl.replace(/\/api\/crm\/?/i, '');
        cleanBancaUrl = cleanBancaUrl.replace(/\/+$/, '').trim();
        cleanBancaUrl = `https://${cleanBancaUrl}`;

        const indicatedsApiUrl = new URL(`${cleanBancaUrl}/api/crm/get-indicateds-by-consultant`);
        indicatedsApiUrl.searchParams.append('consultant', consultor.email);
        indicatedsApiUrl.searchParams.append('per_page', '9999999');
        if (dateFrom) indicatedsApiUrl.searchParams.append('from', dateFrom);
        if (dateTo) indicatedsApiUrl.searchParams.append('to', dateTo);

        const indicatedsResponse = await fetch(indicatedsApiUrl.toString(), {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            ...(apiKey && { 'X-API-KEY': apiKey }),
          },
        });

        if (indicatedsResponse.ok) {
          const indicatedsData = await indicatedsResponse.json();
          const indicateds = indicatedsData.data || indicatedsData || [];

          const statusDistribution: Record<string, number> = {};
          const starsDistribution: Record<string, number> = {};
          const topBettors: Array<{ name: string; value: number }> = [];
          const topWinners: Array<{ name: string; value: number }> = [];
          const topDepositors: Array<{ name: string; value: number }> = [];

          indicateds.forEach((lead: any) => {
            const status = lead.status || 'novo';
            statusDistribution[status] = (statusDistribution[status] || 0) + 1;

            const stars = parseInt(String(lead.stars || lead.user_level || 0)) || 0;
            const starsKey = stars > 0 ? `${stars} ⭐` : 'Sem estrelas';
            starsDistribution[starsKey] = (starsDistribution[starsKey] || 0) + 1;

            const totalApostado = parseFloat(lead.total_apostado || lead.total_bets || 0) || 0;
            if (totalApostado > 0) {
              topBettors.push({ name: lead.name || lead.full_name || 'Sem nome', value: totalApostado });
            }

            const totalGanho = parseFloat(lead.total_ganho || lead.total_prizes || 0) || 0;
            if (totalGanho > 0) {
              topWinners.push({ name: lead.name || lead.full_name || 'Sem nome', value: totalGanho });
            }

            const totalDepositado = parseFloat(lead.total_depositado || lead.total_deposited || 0) || 0;
            if (totalDepositado > 0) {
              topDepositors.push({ name: lead.name || lead.full_name || 'Sem nome', value: totalDepositado });
            }
          });

          const starsArray = Object.entries(starsDistribution)
            .map(([key, value]) => {
              const starsNum = parseInt(key.replace(/[^0-9]/g, '')) || 0;
              return { name: key, value: value as number, starsNum };
            })
            .sort((a, b) => a.starsNum - b.starsNum)
            .map(item => ({ name: item.name, value: item.value }));

          chartData = {
            status_distribution: statusDistribution,
            stars_distribution: starsDistribution,
            stars_distribution_array: starsArray,
            top_bettors: topBettors.sort((a, b) => b.value - a.value).slice(0, 10),
            top_winners: topWinners.sort((a, b) => b.value - a.value).slice(0, 10),
            top_depositors: topDepositors.sort((a, b) => b.value - a.value).slice(0, 10),
            total_indicateds: indicateds.length,
          };
        }
      } catch (error: any) {
        console.error('[Gestor Consultores API] Erro ao buscar indicados:', error.message);
      }
    }

    return successResponse({
      consultor,
      campaigns: campaigns || [],
      leadsCount: leads?.length || 0,
      metrics: {
        processed: totalProcessed,
        failed: totalFailed,
        successRate: totalProcessed > 0 ? ((totalProcessed - totalFailed) / totalProcessed * 100).toFixed(2) : '0.00',
      },
      externalKpis,
      externalKpisError,
      chartData,
    });
  } catch (err: any) {
    console.error('[Gestor Consultores API] Erro:', err.message);
    return serverErrorResponse(err);
  }
}
