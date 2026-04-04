import { NextRequest } from 'next/server';
import { getUserProfile } from '@/lib/middleware/permissions';
import { requireGestorTrafego } from '@/lib/middleware/gestor-trafego-access';
import { resolveGestorTrafegoEffectiveDonoId } from '@/lib/middleware/gestor-owner';
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
  { params }: { params: Promise<{ gerenteId: string }> }
) {
  try {
    const { userId } = await requireGestorTrafego(req);
    const profile = await getUserProfile(userId);
    if (!profile) return errorResponse('Perfil não encontrado', 403);
    const statusNorm = profile.status?.trim().toLowerCase();
    const ownerId = await resolveGestorTrafegoEffectiveDonoId(
      req.headers.get('X-Effective-Dono-Id'),
      userId,
      statusNorm
    );
    if (!ownerId) return errorResponse('Gestor vinculado a um Dono ou informe X-Effective-Dono-Id.', 403);

    const resolvedParams = await params;
    const gerenteId = resolvedParams.gerenteId;

    const { searchParams } = req.nextUrl;
    const dateFrom = searchParams.get('date_from');
    const dateTo = searchParams.get('date_to');

    const isOwner = await isInHierarchy(ownerId, gerenteId);
    if (!isOwner) {
      return errorResponse('Acesso negado. Este gerente não pertence à sua banca.', 403);
    }

    const { data: donoProfile } = await supabaseServiceRole
      .from('profiles')
      .select('banca_url')
      .eq('id', ownerId)
      .single();

    if (!donoProfile?.banca_url) {
      return errorResponse('Banca URL não configurada.', 400);
    }

    const { data: consultores } = await supabaseServiceRole
      .from('profiles')
      .select('id, email, full_name')
      .eq('enroller', gerenteId)
      .eq('status', 'consultor');

    if (!consultores || consultores.length === 0) {
      return successResponse([]);
    }

    const cleanBancaUrl = normalizeBancaUrl(donoProfile.banca_url);
    const apiKey = process.env.CRM_API_KEY;

    const consultantsData = await Promise.all(
      consultores
        .filter(c => c.email)
        .map(async (consultor) => {
          try {
            const metricsUrl = new URL(`${cleanBancaUrl}/api/crm/dashboard-metrics`);
            metricsUrl.searchParams.append('consultant', consultor.email);
            if (dateFrom) metricsUrl.searchParams.append('date_from', dateFrom);
            if (dateTo) metricsUrl.searchParams.append('date_to', dateTo);

            const response = await fetch(metricsUrl.toString(), {
              method: 'GET',
              headers: {
                'Accept': 'application/json',
                ...(apiKey && { 'X-API-KEY': apiKey }),
              },
            });

            if (response.ok) {
              const result = await response.json();
              let metrics = null;
              if (result.success && result.metrics) {
                metrics = result.metrics;
              } else if (result.metrics) {
                metrics = result.metrics;
              } else if (result.total_deposited !== undefined) {
                metrics = result;
              }

              if (metrics) {
                return {
                  name: consultor.full_name || consultor.email,
                  email: consultor.email,
                  value: Number(metrics.total_deposited) || 0,
                };
              }
            }
          } catch (error) {
            console.warn(`[Gestor Top5] Erro ao buscar métricas do consultor ${consultor.email}:`, error);
          }
          return null;
        })
    );

    const top5 = consultantsData
      .filter(c => c !== null && c.value > 0)
      .sort((a, b) => b!.value - a!.value)
      .slice(0, 5)
      .map(c => c!);

    return successResponse(top5);
  } catch (error: any) {
    console.error('[Gestor Top5] Erro:', error);
    return errorResponse(error.message || 'Erro ao buscar top 5 consultores', 500);
  }
}
