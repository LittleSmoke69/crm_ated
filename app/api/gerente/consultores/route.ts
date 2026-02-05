import { NextRequest } from 'next/server';
import { requireStatus } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { getConsultorsByManager } from '@/lib/utils/hierarchy';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * GET /api/gerente/consultores - Lista consultores do Gerente com métricas de CRM (Cadastros e Vendas)
 */
export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireStatus(req, ['gerente']);

    // Busca consultores diretos
    const consultores = await getConsultorsByManager(userId);

    // Para cada consultor, busca métricas
    const consultoresComMetricas = await Promise.all(
      consultores.map(async (consultor) => {
        const [
          { count: totalLeads }, // Cadastros
          { count: totalSales }, // Vendas
          { count: campaignsCount },
          { data: campaigns },
        ] = await Promise.all([
          supabaseServiceRole
            .from('searches')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', consultor.id),
          supabaseServiceRole
            .from('searches')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', consultor.id)
            .in('status', ['1º Depósito', 'Cliente Ativo']),
          supabaseServiceRole
            .from('campaigns')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', consultor.id),
          supabaseServiceRole
            .from('campaigns')
            .select('processed_contacts, failed_contacts')
            .eq('user_id', consultor.id),
        ]);

        const totalProcessed = campaigns?.reduce((sum, c) => sum + (c.processed_contacts || 0), 0) || 0;
        const totalFailed = campaigns?.reduce((sum, c) => sum + (c.failed_contacts || 0), 0) || 0;

        return {
          ...consultor,
          metrics: {
            cadastros: totalLeads || 0,
            vendas: totalSales || 0,
            campaigns: campaignsCount || 0,
            processed: totalProcessed,
            failed: totalFailed,
            successRate: totalProcessed > 0 
              ? ((totalProcessed - totalFailed) / totalProcessed * 100).toFixed(2) 
              : '0.00',
            conversionRate: (totalLeads || 0) > 0
              ? ((totalSales || 0) / (totalLeads || 1) * 100).toFixed(2)
              : '0.00'
          },
        };
      })
    );

    return successResponse(consultoresComMetricas);
  } catch (err: any) {
    return errorResponse(err.message || 'Erro ao buscar consultores', 401);
  }
}
