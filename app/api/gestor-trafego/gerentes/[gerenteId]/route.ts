import { NextRequest } from 'next/server';
import { getUserProfile } from '@/lib/middleware/permissions';
import { requireGestorTrafego } from '@/lib/middleware/gestor-trafego-access';
import { resolveGestorTrafegoOwnerIdFromRequest } from '@/lib/middleware/gestor-owner';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
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

/**
 * GET /api/gestor-trafego/gerentes/[gerenteId]
 * Retorna dados do gerente (gestor vê dados da banca do dono ao qual está vinculado)
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ gerenteId: string }> }
) {
  let gerenteId: string | undefined;
  try {
    const { userId } = await requireGestorTrafego(req);
    const profile = await getUserProfile(userId);
    if (!profile) return errorResponse('Perfil não encontrado', 403);
    const statusNorm = profile.status?.trim().toLowerCase();

    const ownerId = await resolveGestorTrafegoOwnerIdFromRequest(req, userId, statusNorm);
    if (!ownerId) {
      return errorResponse('Gestor deve estar vinculado a um Dono de Banca ou informe X-Effective-Dono-Id.', 403);
    }

    const resolvedParams = await params;
    gerenteId = resolvedParams.gerenteId;

    const { searchParams } = req.nextUrl;
    let dateFrom = searchParams.get('date_from');
    let dateTo = searchParams.get('date_to');
    if (!dateFrom || !dateTo) {
      const today = new Date().toISOString().split('T')[0];
      dateFrom = dateFrom || today;
      dateTo = dateTo || today;
    }

    const isOwner = await isInHierarchy(ownerId, gerenteId!);
    if (!isOwner) {
      return errorResponse('Acesso negado. Este gerente não pertence à banca vinculada.', 403);
    }

    const { data: gerente } = await supabaseServiceRole
      .from('profiles')
      .select('id, email, full_name, created_at')
      .eq('id', gerenteId!)
      .single();

    const { data: consultores } = await supabaseServiceRole
      .from('profiles')
      .select('id, email, full_name, created_at')
      .eq('enroller', gerenteId!)
      .eq('status', 'consultor');

    const consultorIds = consultores?.map(c => c.id) || [];
    const allIds = [gerenteId!, ...consultorIds];

    const { data: campaigns } = await supabaseServiceRole
      .from('campaigns')
      .select('*')
      .in('user_id', allIds)
      .order('created_at', { ascending: false });

    const { data: donoProfile } = await supabaseServiceRole
      .from('profiles')
      .select('banca_url')
      .eq('id', ownerId)
      .single();

    const bancaUrl = donoProfile?.banca_url;
    const apiKey = process.env.CRM_API_KEY;

    const metricsByConsultor = await Promise.all(
      (consultores || []).map(async (c) => {
        const { data: cCampaigns } = await supabaseServiceRole
          .from('campaigns')
          .select('processed_contacts, failed_contacts')
          .eq('user_id', c.id);

        const processed = cCampaigns?.reduce((s, camp) => s + (camp.processed_contacts || 0), 0) || 0;
        const failed = cCampaigns?.reduce((s, camp) => s + (camp.failed_contacts || 0), 0) || 0;

        let externalKpis = null;
        let externalKpisError: string | null = null;

        if (bancaUrl && c.email) {
          try {
            const cleanBancaUrl = normalizeBancaUrl(bancaUrl);
            const externalApiUrl = new URL(`${cleanBancaUrl}/api/crm/dashboard-metrics`);
            externalApiUrl.searchParams.append('consultant', c.email);
            externalApiUrl.searchParams.append('date_from', dateFrom!);
            externalApiUrl.searchParams.append('date_to', dateTo!);

            const externalResponse = await fetch(externalApiUrl.toString(), {
              method: 'GET',
              headers: {
                'Accept': 'application/json',
                ...(apiKey && { 'X-API-KEY': apiKey }),
              },
            });

            if (externalResponse.ok) {
              const externalData = await externalResponse.json();
              if (externalData.success && externalData.metrics) {
                const metrics = externalData.metrics;
                externalKpis = {
                  total_leads: metrics.total_leads || 0,
                  total_deposited: metrics.total_deposited || 0,
                  total_bets: metrics.total_bets || 0,
                  total_prizes: metrics.total_prizes || 0,
                  active_leads: metrics.active_leads || 0,
                  conversion_rate: metrics.conversion_rate || 0,
                  net_profit: metrics.net_profit || 0,
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

        return {
          id: c.id,
          email: c.email,
          name: c.full_name || c.email,
          campaignsCount: cCampaigns?.length || 0,
          processed,
          failed,
          successRate: processed > 0 ? ((processed - failed) / processed * 100).toFixed(2) : '0.00',
          externalKpis,
          externalKpisError,
        };
      })
    );

    const gerenteTotalKpis = metricsByConsultor.reduce(
      (acc, consultor) => {
        if (consultor.externalKpis && !consultor.externalKpisError) {
          acc.total_leads += consultor.externalKpis.total_leads || 0;
          acc.total_deposited += consultor.externalKpis.total_deposited || 0;
          acc.total_bets += consultor.externalKpis.total_bets || 0;
          acc.total_prizes += consultor.externalKpis.total_prizes || 0;
          acc.active_leads += consultor.externalKpis.active_leads || 0;
          acc.net_profit += consultor.externalKpis.net_profit || 0;
        }
        return acc;
      },
      { total_leads: 0, total_deposited: 0, total_bets: 0, total_prizes: 0, active_leads: 0, net_profit: 0 }
    );

    const conversionRate =
      gerenteTotalKpis.total_leads > 0
        ? (gerenteTotalKpis.active_leads / gerenteTotalKpis.total_leads) * 100
        : 0;

    return successResponse({
      gerente,
      campaigns,
      consultorMetrics: metricsByConsultor,
      gerenteTotalKpis: { ...gerenteTotalKpis, conversion_rate: conversionRate },
    });
  } catch (err: any) {
    console.error('[Gestor Trafego Gerente API] Erro:', err.message);
    return serverErrorResponse(err);
  }
}
