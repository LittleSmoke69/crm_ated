import { NextRequest } from 'next/server';
import { requireStatus, canAccessUser } from '@/lib/middleware/permissions';
import { getEffectiveDonoIdForGestor } from '@/lib/middleware/gestor-owner';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

function normalizeBancaUrl(url: string | null | undefined): string {
  if (!url) return '';
  const s = String(url).trim().replace(/^https?:\/\//i, '').replace(/\/api\/crm\/?/i, '').replace(/\/+$/, '').trim();
  return s ? `https://${s}`.toLowerCase() : '';
}

/**
 * GET /api/gerente/consultores/[consultorId]/crm - Visualiza CRM de um consultor (gerente ou gestor com acesso à banca)
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ consultorId: string }> }
) {
  try {
    const { userId, profile } = await requireStatus(req, ['gerente', 'gestor']);
    const { consultorId } = await params;

    let requesterIdForAccess = userId;
    if (profile?.status === 'gestor') {
      let ownerId: string | null = await getEffectiveDonoIdForGestor(profile.id);
      if (!ownerId) {
        let { data: userBancas } = await supabaseServiceRole.from('user_bancas').select('banca_id').eq('user_id', profile.id);
        if ((userBancas?.length ?? 0) === 0) {
          const { data: fallback } = await supabaseServiceRole.from('user_bancas').select('banca_id').eq('user_id', userId);
          userBancas = fallback ?? [];
        }
        const firstBancaId = userBancas?.[0]?.banca_id;
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
      requesterIdForAccess = ownerId;
    }

    // Verifica se o gerente/gestor pode acessar este consultor
    const canAccess = await canAccessUser(requesterIdForAccess, consultorId);
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

