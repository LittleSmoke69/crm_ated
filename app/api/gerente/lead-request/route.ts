import { NextRequest } from 'next/server';
import { requireStatus, getUserProfile } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { getConsultorsByManager } from '@/lib/utils/hierarchy';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

const LEAD_TYPES = ['registered', 'with_balance', 'has_won', 'has_withdrawn'] as const;

/**
 * POST /api/gerente/lead-request
 * Recebe solicitação de leads do gerente: tipo de lead e lista de consultores com quantidade cada.
 * Persiste em gerente_lead_requests para o admin aprovar em admin/crm/lead-transfer.
 */
export async function POST(req: NextRequest) {
  try {
    const { userId: gerenteId } = await requireStatus(req, ['gerente']);
    const body = await req.json();
    const { banca_id: bancaId, lead_type: leadTypeParam, consultores, deadline_days: deadlineDaysParam } = body;

    if (!bancaId || typeof bancaId !== 'string' || !bancaId.trim()) {
      return errorResponse('Informe a banca para qual os leads serão transferidos (banca_id).', 400);
    }

    const leadTypes = Array.isArray(leadTypeParam)
      ? leadTypeParam.filter((t: unknown) => typeof t === 'string' && LEAD_TYPES.includes(t as typeof LEAD_TYPES[number]))
      : typeof leadTypeParam === 'string' && LEAD_TYPES.includes(leadTypeParam as typeof LEAD_TYPES[number])
        ? [leadTypeParam]
        : [];
    if (leadTypes.length === 0) {
      return errorResponse('Selecione ao menos um tipo de lead válido: registered, with_balance, has_won, has_withdrawn', 400);
    }
    const leadTypeStored = [...new Set(leadTypes)].join(',');

    if (!Array.isArray(consultores) || consultores.length === 0) {
      return errorResponse('Informe ao menos um consultor com quantidade de leads', 400);
    }

    const consultorsUnderGerente = await getConsultorsByManager(gerenteId);
    const allowedIds = new Set(consultorsUnderGerente.map((c) => c.id));

    const payload: { consultor_id: string; quantity: number }[] = [];
    for (const item of consultores) {
      const consultorId = item?.consultor_id;
      const quantity = item?.quantity;
      if (!consultorId || typeof quantity !== 'number' || quantity < 1) {
        return errorResponse('Cada item deve ter consultor_id e quantity (número >= 1)', 400);
      }
      if (!allowedIds.has(consultorId)) {
        return errorResponse(`Consultor não pertence à sua equipe: ${consultorId}`, 403);
      }
      payload.push({ consultor_id: consultorId, quantity });
    }

    const profile = await getUserProfile(gerenteId);
    const gerenteName = (profile?.full_name ?? profile?.email ?? '').trim() || (profile?.email ?? 'Gerente');

    const deadlineDays = typeof deadlineDaysParam === 'number' && deadlineDaysParam >= 1 && deadlineDaysParam <= 365
      ? deadlineDaysParam
      : null;

    const { data: row, error } = await supabaseServiceRole
      .from('gerente_lead_requests')
      .insert({
        gerente_id: gerenteId,
        gerente_name: gerenteName,
        lead_type: leadTypeStored,
        consultores: payload,
        status: 'pending',
        banca_id: bancaId.trim(),
        ...(deadlineDays != null && { deadline_days: deadlineDays }),
      })
      .select('id, created_at')
      .single();

    if (error) {
      console.error('[gerente/lead-request] Insert error:', error);
      return errorResponse('Erro ao salvar solicitação. Verifique se a tabela gerente_lead_requests existe.', 500);
    }

    return successResponse(
      { id: row?.id, lead_type: leadTypes, consultores: payload, created_at: row?.created_at },
      'Solicitação de leads recebida com sucesso'
    );
  } catch (err: unknown) {
    return serverErrorResponse(err);
  }
}
