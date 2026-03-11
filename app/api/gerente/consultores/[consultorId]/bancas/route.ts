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

const LOG_PREFIX = '[Solicitação de leads - Verificação de bancas]';

/**
 * Verifica na API externa da banca se o consultor está cadastrado (user-consultant-info).
 * 200 = consultor tem conta na banca (listar no dropdown). 404 = não tem conta (não listar).
 */
async function consultorTemAcessoNaBanca(
  bancaUrl: string,
  consultantEmail: string,
  apiKey: string,
  bancaName?: string
): Promise<boolean> {
  const base = normalizarUrlBanca(bancaUrl);
  if (!base || !consultantEmail) return false;
  const label = bancaName || base;
  const url = `${base}/api/crm/user-consultant-info?email=${encodeURIComponent(consultantEmail)}`;
  const headers = { 'X-API-KEY': apiKey.trim(), Accept: 'application/json' };

  const curlLog = `GET "${url}" -H "X-API-KEY: ..." -H "Accept: application/json"`;
  console.log(`${LOG_PREFIX} [request] ${curlLog}`);

  try {
    const start = Date.now();
    const res = await fetch(url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(15000),
    });
    const elapsed = Date.now() - start;
    const temContaNaBanca = res.status === 200;
    console.log(`${LOG_PREFIX} GET ${url} → ${res.status} (${elapsed}ms) [consultor tem conta na banca: ${temContaNaBanca}]`);
    return temContaNaBanca;
  } catch (err) {
    console.log(`${LOG_PREFIX} GET ${label}/api/crm/user-consultant-info → erro (consultor tem conta na banca: false)`);
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

    console.log(`${LOG_PREFIX} Requisição recebida → GET /api/gerente/consultores/${consultorId}/bancas (verificar bancas para solicitação de leads)`);

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
      console.log(`${LOG_PREFIX} Consultor ${consultorId} sem e-mail → retornando lista vazia.`);
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
    const bancasList = bancas as { id: string; name: string; url: string }[];
    if (!apiKey) {
      console.log(`${LOG_PREFIX} Sem CRM_API_KEY → retornando todas as ${bancasList.length} bancas do gerente (sem verificação externa)`);
      return successResponse(bancasList);
    }

    console.log(`${LOG_PREFIX} Verificando acesso do consultor em ${bancasList.length} banca(s)...`);
    const result: { id: string; name: string; url: string }[] = [];
    for (const b of bancasList) {
      if (!b.url) continue;
      const hasAccess = await consultorTemAcessoNaBanca(b.url, consultantEmail, apiKey, b.name);
      if (hasAccess) result.push(b);
    }
    console.log(`${LOG_PREFIX} Concluído → ${result.length}/${bancasList.length} banca(s) em que o consultor tem acesso.`);

    return successResponse(result);
  } catch (err: unknown) {
    console.error('[GET /api/gerente/consultores/[consultorId]/bancas]', err);
    return serverErrorResponse(err);
  }
}
