import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { getUserProfile, canAccessUser } from '@/lib/middleware/permissions';
import { getEffectiveDonoIdForGestor } from '@/lib/middleware/gestor-owner';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { getConsultorsByManager } from '@/lib/utils/hierarchy';
import { getBancasDoUsuario } from '@/lib/crm/user-bancas';

function normalizarUrlBanca(raw: string): string {
  let u = raw.trim();
  u = u.replace(/^https?:\/\//i, '').replace(/\/api\/crm\/?/i, '').replace(/\/+$/, '').trim();
  if (!u) return '';
  return u.startsWith('http') ? u : `https://${u}`;
}

const LOG_PREFIX = '[Solicitação de leads - Verificação de bancas]';

/**
 * Bancas do CRM ligadas ao user_bancas de um gerente (ou outro usuário), com checagem externa opcional.
 */
async function bancasForLeadRequestFromManagerUser(
  managerUserId: string,
  consultantEmail: string
): Promise<{ id: string; name: string; url: string }[]> {
  const { data: ubRow, error: ubError } = await supabaseServiceRole
    .from('user_bancas')
    .select('banca_ids')
    .eq('user_id', managerUserId)
    .maybeSingle();

  if (ubError || !Array.isArray(ubRow?.banca_ids) || ubRow.banca_ids.length === 0) {
    return [];
  }

  const { data: bancas, error: bancasError } = await supabaseServiceRole
    .from('crm_bancas')
    .select('id, name, url')
    .in('id', ubRow.banca_ids as string[])
    .order('name', { ascending: true });

  if (bancasError || !bancas?.length) return [];

  const bancasList = bancas as { id: string; name: string; url: string }[];
  const apiKey = process.env.CRM_API_KEY?.trim();
  if (!apiKey) {
    console.log(
      `${LOG_PREFIX} Sem CRM_API_KEY → retornando todas as ${bancasList.length} banca(s) do user_bancas do usuário ${managerUserId}`
    );
    return bancasList;
  }

  const result: { id: string; name: string; url: string }[] = [];
  for (const b of bancasList) {
    if (!b.url) continue;
    const hasAccess = await consultorTemAcessoNaBanca(b.url, consultantEmail, apiKey, b.name);
    if (hasAccess) result.push(b);
  }
  return result;
}

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

const ALLOWED_STATUSES = new Set(['gerente', 'gestor', 'super_admin', 'admin']);

/**
 * GET /api/gerente/consultores/[consultorId]/bancas
 * - Gerente: bancas do user_bancas do gerente onde o consultor da equipe passa na API externa (user-consultant-info).
 * - Admin/super_admin: primeiro user_bancas do consultor; se vazio, bancas do gerente (query gerente_id válido ou enroller do consultor), pois consultores raramente preenchem user_bancas.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ consultorId: string }> }
) {
  try {
    const { userId } = await requireAuth(req);
    const profile = await getUserProfile(userId);
    if (!profile) {
      return errorResponse('Perfil não encontrado.', 401);
    }
    const callerStatus = String(profile.status ?? '').trim();
    if (!callerStatus || !ALLOWED_STATUSES.has(callerStatus)) {
      return errorResponse('Acesso negado. Apenas gerente, gestor, admin ou super_admin.', 403);
    }

    const { consultorId } = await params;
    if (!consultorId) return errorResponse('consultorId é obrigatório', 400);

    console.log(`${LOG_PREFIX} Requisição recebida → GET /api/gerente/consultores/${consultorId}/bancas (verificar bancas para solicitação de leads) | caller: ${callerStatus}`);

    if (callerStatus === 'super_admin' || callerStatus === 'admin') {
      const canSee = await canAccessUser(userId, consultorId);
      if (!canSee) {
        return errorResponse('Acesso negado a este consultor.', 403);
      }

      const { data: consultorRow, error: consultorErr } = await supabaseServiceRole
        .from('profiles')
        .select('email, status, enroller')
        .eq('id', consultorId)
        .maybeSingle();

      if (consultorErr || !consultorRow || consultorRow.status !== 'consultor') {
        return errorResponse('Consultor não encontrado', 404);
      }
      // Não exigir gerente_id na query: o filtro da página pode divergir da lista do modal (ex.: allConsultores antigo).
      // canAccessUser já garante que admin/super_admin pode ver o consultor.

      const consultantEmail = (consultorRow.email as string | null)?.trim();
      if (!consultantEmail) {
        console.log(`${LOG_PREFIX} Consultor ${consultorId} sem e-mail → retornando lista vazia (admin).`);
        return successResponse([]);
      }

      let bancasList = (await getBancasDoUsuario(consultorId)) as { id: string; name: string; url: string }[];
      let bancasAlreadyVerifiedExternally = false;

      if (bancasList.length === 0) {
        const reqUrl = new URL(req.url);
        const gerenteIdParam = reqUrl.searchParams.get('gerente_id')?.trim() ?? '';
        let managerForBancas = '';
        if (gerenteIdParam) {
          const under = await getConsultorsByManager(gerenteIdParam);
          if (under.some((c) => c.id === consultorId)) {
            managerForBancas = gerenteIdParam;
          }
        }
        if (!managerForBancas && (consultorRow.enroller as string | null)?.trim()) {
          managerForBancas = (consultorRow.enroller as string).trim();
        }
        if (managerForBancas) {
          console.log(
            `${LOG_PREFIX} Admin: consultor sem user_bancas → usando bancas do gerente ${managerForBancas} (param ou enroller).`
          );
          bancasList = await bancasForLeadRequestFromManagerUser(managerForBancas, consultantEmail);
          bancasAlreadyVerifiedExternally = true;
        }
      }

      if (bancasList.length === 0) {
        console.log(`${LOG_PREFIX} Admin: consultor ${consultorId} sem bancas (consultor nem gerente com user_bancas / API).`);
        return successResponse([]);
      }

      const apiKey = process.env.CRM_API_KEY?.trim();
      if (!apiKey) {
        console.log(`${LOG_PREFIX} Admin: sem CRM_API_KEY → retornando ${bancasList.length} banca(s).`);
        return successResponse(bancasList);
      }

      if (bancasAlreadyVerifiedExternally) {
        console.log(`${LOG_PREFIX} Admin: concluído (via gerente) → ${bancasList.length} banca(s).`);
        return successResponse(bancasList);
      }

      console.log(`${LOG_PREFIX} Admin: verificando acesso do consultor em ${bancasList.length} banca(s) (user_bancas do consultor)...`);
      const result: { id: string; name: string; url: string }[] = [];
      for (const b of bancasList) {
        if (!b.url) continue;
        const hasAccess = await consultorTemAcessoNaBanca(b.url, consultantEmail, apiKey, b.name);
        if (hasAccess) result.push(b);
      }
      console.log(`${LOG_PREFIX} Admin: concluído → ${result.length}/${bancasList.length} banca(s).`);
      return successResponse(result);
    }

    let managerId: string;
    if (callerStatus === 'gestor') {
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

    const result = await bancasForLeadRequestFromManagerUser(userId, consultantEmail);
    console.log(
      `${LOG_PREFIX} Concluído (gerente/gestor) → ${result.length} banca(s) em que o consultor tem acesso.`
    );
    return successResponse(result);
  } catch (err: unknown) {
    console.error('[GET /api/gerente/consultores/[consultorId]/bancas]', err);
    return serverErrorResponse(err);
  }
}
