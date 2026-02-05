import { NextRequest } from 'next/server';
import { requireStatus } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * GET /api/consultor/crm - Retorna leads do CRM do Consultor
 * Apenas leads próprios
 */
export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireStatus(req, ['consultor']);

    // Busca leads do consultor (usando searches como base de leads)
    const { data: leads, error } = await supabaseServiceRole
      .from('searches')
      .select('*')
      .eq('user_id', userId)
      .not('telefone', 'is', null)
      .order('created_at', { ascending: false });

    if (error) {
      return errorResponse(`Erro ao buscar leads: ${error.message}`, 400);
    }

    // Formata leads para o formato esperado pelo CRM
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
    return errorResponse(err.message || 'Erro ao buscar CRM', 401);
  }
}

