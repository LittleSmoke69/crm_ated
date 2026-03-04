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
 * GET /api/gerente/gerentes?banca_url=...
 * Lista APENAS gerentes (status = 'gerente') da banca — usado em Zaplink (atribuir ao gerente) e dashboard gerente.
 * Não inclui consultores, gestores nem outros cargos.
 * Retorna { id, email, full_name } dos gerentes que pertencem à banca (enroller = dono da banca ou user_bancas).
 */
export async function GET(req: NextRequest) {
  try {
    const { profile } = await requireStatus(req, ['super_admin', 'admin', 'gerente', 'gestor']);
    const isAdminOrSuperAdmin = profile?.status === 'super_admin' || profile?.status === 'admin';

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

    // Gerentes: 1) enroller = dono da banca (banca_url = esta banca)  2) ou user_bancas contém banca_id e status gerente
    const { data: donos } = await supabaseServiceRole
      .from('profiles')
      .select('id')
      .eq('status', 'dono_banca');
    const donoIds = (donos || []).filter((d: { id: string }) => d.id).map((d: { id: string }) => d.id);

    const { data: donoProfiles } = await supabaseServiceRole
      .from('profiles')
      .select('id, banca_url')
      .in('id', donoIds);
    const donoComBanca = (donoProfiles || []).find(
      (d: { banca_url?: string | null }) => normalizeBancaUrl(d.banca_url) === normUrl
    );
    const donoId = donoComBanca?.id;

    const gerenteIdsFromEnroller: string[] = [];
    if (donoId) {
      const { data: gerentesUnderDono } = await supabaseServiceRole
        .from('profiles')
        .select('id')
        .eq('status', 'gerente')
        .eq('enroller', donoId);
      gerenteIdsFromEnroller.push(...((gerentesUnderDono || []).map((g: { id: string }) => g.id)));
    }

    const { data: userBancasRows } = await supabaseServiceRole
      .from('user_bancas')
      .select('user_id')
      .filter('banca_ids', 'cs', JSON.stringify([bancaId]));
    const userIdsInBanca = (userBancasRows || []).map((r: { user_id: string }) => r.user_id);
    const { data: profilesInBanca } = await supabaseServiceRole
      .from('profiles')
      .select('id, email, full_name, status')
      .in('id', userIdsInBanca)
      .eq('status', 'gerente');
    const gerenteIdsFromUserBancas = (profilesInBanca || []).map((p: { id: string }) => p.id);

    const allGerenteIds = [...new Set([...gerenteIdsFromEnroller, ...gerenteIdsFromUserBancas])];
    if (allGerenteIds.length === 0) {
      return successResponse([]);
    }

    // Busca apenas perfis com status exatamente 'gerente' (evita retornar consultor, gestor, etc.)
    const { data: gerentes } = await supabaseServiceRole
      .from('profiles')
      .select('id, email, full_name, status')
      .in('id', allGerenteIds)
      .eq('status', 'gerente');

    const list = (gerentes || [])
      .filter((g: { status?: string }) => g.status === 'gerente')
      .map((g: { id: string; email: string; full_name: string | null }) => ({
        id: g.id,
        email: g.email,
        full_name: g.full_name,
      }));

    return successResponse(list);
  } catch (err: any) {
    console.error('[Gerente Gerentes API] Erro:', err.message);
    if (err.message?.includes('Acesso negado') || err.message?.includes('não podem acessar')) {
      return errorResponse(err.message, 403);
    }
    return serverErrorResponse(err);
  }
}
