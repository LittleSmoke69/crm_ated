import { NextRequest } from 'next/server';
import { requireStatus } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

function normalizeBancaUrl(url: string | null | undefined): string {
  if (!url) return '';
  const s = String(url).trim().replace(/^https?:\/\//i, '').replace(/\/api\/crm\/?/i, '').replace(/\/+$/, '').trim();
  return s ? `https://${s}`.toLowerCase() : '';
}

/**
 * GET /api/consultor/consultores-by-banca?banca_url=...
 * Lista consultores da banca para filtro em "Meu Desempenho" (super_admin e admin).
 */
export async function GET(req: NextRequest) {
  try {
    const { profile } = await requireStatus(req, ['super_admin', 'admin', 'consultor']);

    const isAdminOrSuperAdmin = profile?.status === 'super_admin' || profile?.status === 'admin';
    if (!isAdminOrSuperAdmin) {
      return errorResponse('Acesso negado.', 403);
    }

    const { searchParams } = req.nextUrl;
    const bancaUrlParam = searchParams.get('banca_url')?.trim();
    if (!bancaUrlParam) {
      return errorResponse('Parâmetro banca_url é obrigatório.', 400);
    }

    const normUrl = normalizeBancaUrl(bancaUrlParam);
    if (!normUrl) {
      return errorResponse('banca_url inválido.', 400);
    }

    const { data: allBancas } = await supabaseServiceRole.from('crm_bancas').select('id, url');
    const bancaMatch = (allBancas || []).find(
      (b: { url?: string }) => normalizeBancaUrl(b.url) === normUrl
    );
    if (!bancaMatch) {
      return successResponse([]);
    }
    const bancaId = bancaMatch.id;

    const { data: userBancasRows } = await supabaseServiceRole
      .from('user_bancas')
      .select('user_id')
      .filter('banca_ids', 'cs', JSON.stringify([bancaId]));
    const userIdsInBanca = (userBancasRows || []).map((r: { user_id: string }) => r.user_id);
    if (userIdsInBanca.length === 0) {
      return successResponse([]);
    }

    const { data: profiles } = await supabaseServiceRole
      .from('profiles')
      .select('id, email, full_name')
      .in('id', userIdsInBanca)
      .eq('status', 'consultor');

    const list = (profiles || []).map((p: { id: string; email: string; full_name: string | null }) => ({
      id: p.id,
      email: p.email,
      full_name: p.full_name,
    }));

    return successResponse(list);
  } catch (err: any) {
    console.error('[Consultores-by-banca API] Erro:', err.message);
    if (err.message?.includes('Acesso negado')) {
      return errorResponse(err.message, 403);
    }
    return serverErrorResponse(err);
  }
}
