import { NextRequest } from 'next/server';
import { requireStatus } from '@/lib/middleware/permissions';
import { successResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { getConsultorsByManager } from '@/lib/utils/hierarchy';

export const dynamic = 'force-dynamic';

const WON_COLUMN = 'ganho';

/**
 * GET /api/gerente/captadores-vendas
 * Taxa de vendas (coluna "ganho" no kanban) por captador da equipe do gerente.
 */
export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireStatus(req, ['gerente', 'admin', 'super_admin']);
    const gerenteId = req.nextUrl.searchParams.get('gerente_id') || userId;

    if (gerenteId !== userId) {
      const { profile } = await requireStatus(req, ['admin', 'super_admin']);
      if (!profile) throw new Error('Acesso negado.');
    }

    const captadores = await getConsultorsByManager(gerenteId);
    if (captadores.length === 0) {
      return successResponse({ captadores: [], summary: { total_leads: 0, total_vendas: 0, taxa_geral: 0 } });
    }

    const captadorIds = captadores.map((c) => c.id);
    const { data: leads } = await supabaseServiceRole
      .from('crm_leads')
      .select('external_id, user_id')
      .in('user_id', captadorIds);

    const leadRows = leads ?? [];
    const externalIds = leadRows.map((l) => String((l as { external_id: number }).external_id));

    const wonSet = new Set<string>();
    if (externalIds.length > 0) {
      const { data: stages } = await supabaseServiceRole
        .from('crm_lead_stage')
        .select('lead_external_id, user_id, column_key')
        .in('lead_external_id', externalIds)
        .eq('column_key', WON_COLUMN);
      for (const s of stages ?? []) {
        const row = s as { lead_external_id: string; user_id: string };
        wonSet.add(`${row.lead_external_id}:${row.user_id}`);
      }
    }

    const statsByCaptador = new Map<string, { total: number; vendas: number }>();
    for (const id of captadorIds) statsByCaptador.set(id, { total: 0, vendas: 0 });

    for (const l of leadRows) {
      const row = l as { external_id: number; user_id: string };
      const uid = row.user_id;
      if (!uid || !statsByCaptador.has(uid)) continue;
      const st = statsByCaptador.get(uid)!;
      st.total += 1;
      if (wonSet.has(`${String(row.external_id)}:${uid}`)) st.vendas += 1;
    }

    let totalLeads = 0;
    let totalVendas = 0;
    const result = captadores.map((c) => {
      const st = statsByCaptador.get(c.id) ?? { total: 0, vendas: 0 };
      totalLeads += st.total;
      totalVendas += st.vendas;
      const taxa = st.total > 0 ? Math.round((st.vendas / st.total) * 1000) / 10 : 0;
      return {
        id: c.id,
        name: c.full_name?.trim() || c.email || c.id,
        email: c.email,
        total_leads: st.total,
        vendas_fechadas: st.vendas,
        taxa_vendas: taxa,
      };
    });

    result.sort((a, b) => b.taxa_vendas - a.taxa_vendas || b.vendas_fechadas - a.vendas_fechadas);

    const taxaGeral = totalLeads > 0 ? Math.round((totalVendas / totalLeads) * 1000) / 10 : 0;

    return successResponse({
      captadores: result,
      summary: {
        total_leads: totalLeads,
        total_vendas: totalVendas,
        taxa_geral: taxaGeral,
      },
    });
  } catch (err) {
    return serverErrorResponse(err);
  }
}
