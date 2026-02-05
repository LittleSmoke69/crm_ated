import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export const runtime = 'nodejs';

/**
 * GET /api/admin/evolution/metrics?from=2024-01-01&to=2024-01-31
 * Retorna métricas agregadas por instância em um período
 */
export async function GET(req: NextRequest) {
  try {
    // Autentica e verifica se é admin
    const auth = await requireAuth(req);
    
    // Verifica se é admin
    const { data: profile } = await supabaseServiceRole
      .from('profiles')
      .select('status')
      .eq('id', auth.userId)
      .single();

    const canAccess = profile?.status === 'super_admin' || profile?.status === 'admin' || profile?.status === 'dono_banca';
    if (!canAccess) {
      return errorResponse('Acesso negado. Apenas administradores.', 403);
    }

    // Parse query params
    const searchParams = req.nextUrl.searchParams;
    const from = searchParams.get('from');
    const to = searchParams.get('to');

    // Valida datas (formato ISO: YYYY-MM-DD)
    const fromDate = from ? new Date(from) : new Date();
    fromDate.setHours(0, 0, 0, 0);
    
    const toDate = to ? new Date(to) : new Date();
    toDate.setHours(23, 59, 59, 999);

    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      return errorResponse('Datas inválidas. Use formato YYYY-MM-DD', 400);
    }

    if (fromDate > toDate) {
      return errorResponse('Data inicial deve ser anterior à data final', 400);
    }

    // Busca logs no período
    const { data: logs, error: logsError } = await supabaseServiceRole
      .from('evolution_instance_logs')
      .select(`
        evolution_instance_id,
        type,
        created_at,
        evolution_instances!inner (
          id,
          instance_name,
          evolution_apis!inner (
            id,
            name
          )
        )
      `)
      .gte('created_at', fromDate.toISOString())
      .lte('created_at', toDate.toISOString())
      .order('created_at', { ascending: false });

    if (logsError) {
      console.error('Erro ao buscar logs:', logsError);
      return errorResponse('Erro ao buscar métricas', 500);
    }

    // Agrega métricas por instância
    const metricsMap = new Map<
      string,
      {
        instance_id: string;
        instance_name: string;
        evolution_api_name: string;
        total_success: number;
        total_error: number;
        total_rate_limit: number;
        total_blocked: number;
        total: number;
      }
    >();

    (logs || []).forEach((log: any) => {
      const inst = log.evolution_instances;
      const api = Array.isArray(inst?.evolution_apis) 
        ? inst.evolution_apis[0] 
        : inst?.evolution_apis;

      if (!inst || !inst.id) return;

      const instanceId = inst.id;
      const instanceName = inst.instance_name || 'N/A';
      const apiName = api?.name || 'N/A';

      if (!metricsMap.has(instanceId)) {
        metricsMap.set(instanceId, {
          instance_id: instanceId,
          instance_name: instanceName,
          evolution_api_name: apiName,
          total_success: 0,
          total_error: 0,
          total_rate_limit: 0,
          total_blocked: 0,
          total: 0,
        });
      }

      const metrics = metricsMap.get(instanceId)!;
      metrics.total++;

      switch (log.type) {
        case 'success':
          metrics.total_success++;
          break;
        case 'error':
          metrics.total_error++;
          break;
        case 'rate_limit':
          metrics.total_rate_limit++;
          break;
        case 'blocked':
          metrics.total_blocked++;
          break;
      }
    });

    // Converte map para array e calcula taxas
    const metrics = Array.from(metricsMap.values()).map((m) => ({
      ...m,
      success_rate: m.total > 0 ? Math.round((m.total_success / m.total) * 100) : 0,
      error_rate: m.total > 0 ? Math.round((m.total_error / m.total) * 100) : 0,
      rate_limit_rate: m.total > 0 ? Math.round((m.total_rate_limit / m.total) * 100) : 0,
      blocked_rate: m.total > 0 ? Math.round((m.total_blocked / m.total) * 100) : 0,
    }));

    // Ordena por total (mais usadas primeiro)
    metrics.sort((a, b) => b.total - a.total);

    // Agregação geral
    const totals = {
      total_success: metrics.reduce((sum, m) => sum + m.total_success, 0),
      total_error: metrics.reduce((sum, m) => sum + m.total_error, 0),
      total_rate_limit: metrics.reduce((sum, m) => sum + m.total_rate_limit, 0),
      total_blocked: metrics.reduce((sum, m) => sum + m.total_blocked, 0),
      total: metrics.reduce((sum, m) => sum + m.total, 0),
    };

    return successResponse(
      {
        period: {
          from: fromDate.toISOString(),
          to: toDate.toISOString(),
        },
        totals,
        by_instance: metrics,
      },
      'Métricas recuperadas com sucesso'
    );
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

