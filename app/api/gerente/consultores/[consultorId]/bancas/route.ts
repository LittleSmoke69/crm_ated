import { NextRequest } from 'next/server';
import { requireStatus, canAccessUser } from '@/lib/middleware/permissions';
import { getEffectiveDonoIdForGestor } from '@/lib/middleware/gestor-owner';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { getConsultorsByManager } from '@/lib/utils/hierarchy';

function normalizarUrlBanca(raw: string): string {
  let u = raw.trim();
  u = u.replace(/^https?:\/\//i, '').replace(/\/api\/crm\/?/i, '').replace(/\/+$/, '').trim();
  if (!u) return '';
  return u.startsWith('http') ? u : `https://${u}`;
}

/**
 * Verifica na API externa da banca se o consultor tem acesso (get-indicateds-by-consultant, status 200 = tem conta/dados).
 */
async function consultorTemAcessoNaBanca(
  bancaUrl: string,
  consultantEmail: string,
  apiKey: string
): Promise<boolean> {
  const base = normalizarUrlBanca(bancaUrl);
  if (!base || !consultantEmail) return false;
  try {
    const params = new URLSearchParams({ consultant: consultantEmail, per_page: '1' });
    const url = `${base}/api/crm/get-indicateds-by-consultant?${params.toString()}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'X-API-KEY': apiKey.trim(), Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
    return res.status === 200;
  } catch {
    return false;
  }
}

/**
 * GET /api/gerente/consultores/[consultorId]/bancas
 * Retorna as bancas (do user_bancas do gerente) em que este consultor tem acesso, verificando na API externa de cada banca.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ consultorId: string }> }
) {
  try {
    const { userId, profile } = await requireStatus(req, ['gerente', 'gestor']);
    const { consultorId } = await params;
    if (!consultorId) return errorResponse('consultorId é obrigatório', 400);

    let managerId: string;
    if (profile?.status === 'gestor') {
      const ownerId = await getEffectiveDonoIdForGestor(profile.id);
      if (!ownerId) return errorResponse('Gestor deve estar vinculado a um Dono de Banca ou ter bancas atribuídas.', 403);
      const canAccess = await canAccessUser(ownerId, consultorId);
      if (!canAccess) return errorResponse('Acesso negado. Este consultor não pertence à sua banca.', 403);
      const { data: consultorProfile } = await supabaseServiceRole
        .from('profiles')
        .select('enroller')
        .eq('id', consultorId)
        .single();
      managerId = (consultorProfile?.enroller as string) || consultorId;
    } else {
      managerId = userId;
    }

    const consultores = await getConsultorsByManager(managerId);
    const consultor = consultores.find((c) => c.id === consultorId);
    if (!consultor) {
      return errorResponse('Consultor não encontrado ou você não tem permissão para visualizá-lo', 404);
    }

    const consultantEmail = (consultor as { email?: string }).email?.trim();
    if (!consultantEmail) {
      return successResponse([]);
    }

    const { data: ubRow, error: ubError } = await supabaseServiceRole
      .from('user_bancas')
      .select('banca_ids')
      .eq('user_id', userId)
      .maybeSingle();

    if (ubError || !Array.isArray(ubRow?.banca_ids) || ubRow.banca_ids.length === 0) {
      return successResponse([]);
    }

    const { data: bancas, error: bancasError } = await supabaseServiceRole
      .from('crm_bancas')
      .select('id, name, url')
      .in('id', ubRow.banca_ids as string[])
      .order('name', { ascending: true });

    if (bancasError || !bancas?.length) return successResponse([]);

    const apiKey = process.env.CRM_API_KEY?.trim();
    if (!apiKey) {
      return successResponse(bancas as { id: string; name: string; url: string }[]);
    }

    const result: { id: string; name: string; url: string }[] = [];
    for (const b of bancas as { id: string; name: string; url: string }[]) {
      if (!b.url) continue;
      const hasAccess = await consultorTemAcessoNaBanca(b.url, consultantEmail, apiKey);
      if (hasAccess) result.push(b);
    }

    return successResponse(result);
  } catch (err: unknown) {
    console.error('[GET /api/gerente/consultores/[consultorId]/bancas]', err);
    return serverErrorResponse(err);
  }
}
