import { NextRequest } from 'next/server';
import { requireStatus } from '@/lib/middleware/permissions';
import { getEffectiveDonoIdForGestor } from '@/lib/middleware/gestor-owner';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { getConsultorsByManager, isInHierarchy } from '@/lib/utils/hierarchy';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { userHasCrmBanca } from '@/lib/utils/user-bancas';

function normalizeBancaUrl(url: string | null | undefined): string {
  if (!url) return '';
  let s = String(url).trim().replace(/^https?:\/\//i, '').replace(/\/api\/crm\/?/i, '').replace(/\/+$/, '').trim();
  return s ? `https://${s}`.toLowerCase() : '';
}

/**
 * GET /api/gerente/consultores - Lista consultores do Gerente com métricas de CRM (ou do gerente indicado para gestor)
 */
export async function GET(req: NextRequest) {
  try {
    const { userId, profile } = await requireStatus(req, ['gerente', 'admin']);
    let effectiveManagerId = userId;

    if (profile?.status === 'gestor') {
      const effectiveGerenteId = (req.headers.get('X-Effective-Gerente-Id') ?? req.headers.get('x-effective-gerente-id'))?.trim();
      if (!effectiveGerenteId) {
        return errorResponse('Gestor deve informar o gerente (header X-Effective-Gerente-Id) para listar consultores.', 400);
      }
      let ownerId: string | null = await getEffectiveDonoIdForGestor(profile.id);
      if (!ownerId) {
        let { data: ubRow } = await supabaseServiceRole.from('user_bancas').select('banca_ids').eq('user_id', profile.id).maybeSingle();
        if (!ubRow?.banca_ids?.length) {
          const { data: fallback } = await supabaseServiceRole.from('user_bancas').select('banca_ids').eq('user_id', userId).maybeSingle();
          ubRow = fallback ?? ubRow;
        }
        const bancaIdsArr = Array.isArray(ubRow?.banca_ids) ? ubRow.banca_ids : [];
        const firstBancaId = bancaIdsArr[0];
        if (firstBancaId) {
          const { data: banca } = await supabaseServiceRole.from('crm_bancas').select('id, url').eq('id', firstBancaId).single();
          if (banca?.url) {
            const { data: donos } = await supabaseServiceRole.from('profiles').select('id, banca_url').eq('status', 'dono_banca');
            const found = (donos || []).find((d: { banca_url?: string | null }) => normalizeBancaUrl(d.banca_url) === normalizeBancaUrl(banca.url));
            if (found) ownerId = found.id;
          }
        }
      }
      if (!ownerId) return errorResponse('Gestor deve estar vinculado a um Dono de Banca ou ter bancas atribuídas.', 403);
      const canAccess = await isInHierarchy(ownerId, effectiveGerenteId);
      if (!canAccess) return errorResponse('Acesso negado. Este gerente não pertence à sua banca.', 403);
      effectiveManagerId = effectiveGerenteId;
    }

    const bancaIdFilter = req.nextUrl.searchParams.get('banca_id')?.trim() || null;

    // Busca consultores diretos
    let consultores = await getConsultorsByManager(effectiveManagerId);

    if (bancaIdFilter) {
      const owns = await userHasCrmBanca(effectiveManagerId, bancaIdFilter);
      if (!owns) {
        return errorResponse('Banca não disponível para este gerente.', 403);
      }
      if (consultores.length > 0) {
        const ids = consultores.map((c) => c.id);
        const { data: ubRows } = await supabaseServiceRole
          .from('user_bancas')
          .select('user_id')
          .in('user_id', ids)
          .filter('banca_ids', 'cs', JSON.stringify([bancaIdFilter]));
        const allowed = new Set((ubRows || []).map((r: { user_id: string }) => r.user_id));
        consultores = consultores.filter((c) => allowed.has(c.id));
      }
    }

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
