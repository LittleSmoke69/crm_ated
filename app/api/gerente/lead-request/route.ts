import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { getUserProfile } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { getConsultorsByManager } from '@/lib/utils/hierarchy';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

const LEAD_TYPES = ['registered', 'with_balance', 'has_won', 'has_withdrawn'] as const;

/** Alinhado ao modal do gerente (`SOLICITATION_MAX_LEADS` em app/gerente/page.tsx). */
const MAX_QUANTITY_PER_CONSULTOR = 1000;

/** Quem pode ser o "gerente" da solicitação (campo gerente_id / equipe do consultor). */
const LEAD_REQUEST_MANAGER_STATUSES = ['gerente', 'admin', 'super_admin'] as const;

function isValidLeadRequestManagerStatus(status: string | null | undefined): boolean {
  return (
    typeof status === 'string' &&
    (LEAD_REQUEST_MANAGER_STATUSES as readonly string[]).includes(status)
  );
}

/**
 * POST /api/gerente/lead-request
 * Recebe solicitação de leads do gerente: tipo de lead e lista de consultores com quantidade cada.
 * Persiste em gerente_lead_requests para o admin aprovar em admin/crm/lead-transfer.
 * super_admin/admin: enviam em nome do gerente (body.gerente_id ou enroller do primeiro consultor).
 */
export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const profile = await getUserProfile(userId);
    if (!profile?.status) {
      return errorResponse('Perfil não encontrado.', 401);
    }

    const body = await req.json();
    const { banca_id: bancaId, lead_type: leadTypeParam, consultores, observations } = body;

    if (!bancaId || typeof bancaId !== 'string' || !bancaId.trim()) {
      return errorResponse('Informe a banca para qual os leads serão transferidos (banca_id).', 400);
    }

    const leadTypes = Array.isArray(leadTypeParam)
      ? leadTypeParam.filter((t: unknown) => typeof t === 'string' && LEAD_TYPES.includes(t as (typeof LEAD_TYPES)[number]))
      : typeof leadTypeParam === 'string' && LEAD_TYPES.includes(leadTypeParam as (typeof LEAD_TYPES)[number])
        ? [leadTypeParam]
        : [];
    if (leadTypes.length === 0) {
      return errorResponse('Selecione ao menos um tipo de lead válido: registered, with_balance, has_won, has_withdrawn', 400);
    }
    const leadTypeStored = [...new Set(leadTypes)].join(',');

    if (!Array.isArray(consultores) || consultores.length === 0) {
      return errorResponse('Informe ao menos um consultor com quantidade de leads', 400);
    }

    const firstConsultorRaw = consultores[0]?.consultor_id;
    const firstConsultorId = typeof firstConsultorRaw === 'string' ? firstConsultorRaw.trim() : '';

    let gerenteIdForRequest: string;
    if (profile.status === 'gerente') {
      gerenteIdForRequest = userId;
    } else if (profile.status === 'super_admin' || profile.status === 'admin') {
      let gid = typeof body.gerente_id === 'string' ? body.gerente_id.trim() : '';
      if (!gid && firstConsultorId) {
        const consultorProfile = await getUserProfile(firstConsultorId);
        gid = (consultorProfile?.enroller ?? '').trim();
      }
      if (!gid) {
        return errorResponse(
          'Selecione um gerente no filtro da página ou informe gerente_id no corpo da requisição.',
          400
        );
      }
      const gerenteProfile = await getUserProfile(gid);
      if (!isValidLeadRequestManagerStatus(gerenteProfile?.status)) {
        return errorResponse(
          'O responsável indicado não é válido (perfil deve ser gerente, admin ou super admin).',
          400
        );
      }
      gerenteIdForRequest = gid;
    } else {
      return errorResponse('Acesso negado. Apenas gerente, admin ou super_admin podem solicitar leads.', 403);
    }

    const consultorsUnderGerente = await getConsultorsByManager(gerenteIdForRequest);
    const allowedIds = new Set(consultorsUnderGerente.map((c) => c.id));

    const payload: { consultor_id: string; quantity: number }[] = [];
    for (const item of consultores) {
      const consultorId = item?.consultor_id;
      const quantity = item?.quantity;
      if (!consultorId || typeof quantity !== 'number' || quantity < 1) {
        return errorResponse('Cada item deve ter consultor_id e quantity (número >= 1)', 400);
      }
      if (quantity > MAX_QUANTITY_PER_CONSULTOR) {
        return errorResponse(`Quantidade por consultor não pode ultrapassar ${MAX_QUANTITY_PER_CONSULTOR}.`, 400);
      }
      if (!allowedIds.has(consultorId)) {
        return errorResponse(`Consultor não pertence à equipe do gerente indicado: ${consultorId}`, 403);
      }
      payload.push({ consultor_id: consultorId, quantity });
    }

    const gerenteProfile = await getUserProfile(gerenteIdForRequest);
    const gerenteName = (gerenteProfile?.full_name ?? gerenteProfile?.email ?? '').trim() || (gerenteProfile?.email ?? 'Gerente');

    const observationsTrimmed = typeof observations === 'string' ? observations.trim() : '';
    const { data: row, error } = await supabaseServiceRole
      .from('gerente_lead_requests')
      .insert({
        gerente_id: gerenteIdForRequest,
        gerente_name: gerenteName,
        lead_type: leadTypeStored,
        consultores: payload,
        status: 'pending',
        banca_id: bancaId.trim(),
        ...(observationsTrimmed ? { observations: observationsTrimmed } : {}),
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
