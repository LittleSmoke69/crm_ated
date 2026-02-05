import { NextRequest } from 'next/server';
import { requireStatus, canAccessUser } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * GET /api/gerente/consultores/[consultorId]/crm - Visualiza CRM de um consultor
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ consultorId: string }> }
) {
  try {
    const { userId } = await requireStatus(req, ['gerente']);
    const { consultorId } = await params;

    // Verifica se o gerente pode acessar este consultor
    const canAccess = await canAccessUser(userId, consultorId);
    if (!canAccess) {
      return errorResponse('Acesso negado. Você não tem permissão para acessar este consultor.', 403);
    }

    // Busca leads do consultor
    const { data: leads, error } = await supabaseServiceRole
      .from('searches')
      .select('*')
      .eq('user_id', consultorId)
      .not('telefone', 'is', null)
      .order('created_at', { ascending: false });

    if (error) {
      return errorResponse(`Erro ao buscar leads: ${error.message}`, 400);
    }

    // Formata leads
    const formattedLeads = (leads || []).map((lead: any) => ({
      id: lead.id,
      name: lead.name || 'Sem nome',
      phone: lead.telefone,
      email: lead.email || null,
      origin: lead.origin || 'Sistema',
      status: lead.status || 'Novo Cadastro',
      createdAt: lead.created_at,
      statusDisparo: lead.status_disparo || false,
      statusAddGp: lead.status_add_gp || false,
    }));

    return successResponse(formattedLeads);
  } catch (err: any) {
    return errorResponse(err.message || 'Erro ao buscar CRM do consultor', 401);
  }
}

