/**
 * Resolve banca_id e crm_base_url para rotas de transferência de leads (Admin).
 * Admin e super_admin têm controle total: qualquer banca em crm_bancas pode ser usada.
 */

const LOG_PREFIX = '[lead-transfer][context]';

import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import type { UserProfile } from '@/lib/middleware/permissions';
import { getEffectiveZaplotoId } from '@/lib/tenant-context';

export interface AdminLeadTransferContext {
  userId: string;
  profile: UserProfile;
  bancaId: string;
  crmBaseUrl: string;
  bancaName?: string;
}

function normalizeBancaUrl(raw: string): string {
  const cleaned = raw.trim().replace(/^https?:\/\//i, '').replace(/\/api\/crm\/?/i, '').replace(/\/+$/, '').trim();
  if (!cleaned) return '';
  return `https://${cleaned}`;
}

async function hasConsultantInExternalCrm(bancaId: string, consultantEmail: string): Promise<boolean> {
  try {
    const { data: banca } = await supabaseServiceRole
      .from('crm_bancas')
      .select('url')
      .eq('id', bancaId)
      .maybeSingle();
    const bancaUrl = typeof banca?.url === 'string' ? normalizeBancaUrl(banca.url) : '';
    const apiKey = process.env.CRM_API_KEY?.trim();
    if (!bancaUrl || !apiKey) {
      console.log(`${LOG_PREFIX} isConsultantInBanca external check skipped: bancaUrl/apiKey ausente, bancaId=${bancaId}`);
      return false;
    }

    const endpoint = `${bancaUrl}/api/crm/total-indicateds-by-consultant?consultant=${encodeURIComponent(consultantEmail.trim())}`;
    const curlPreview = [
      `curl --request GET \\`,
      `  --url '${endpoint}' \\`,
      `  --header 'accept: application/json' \\`,
      `  --header 'x-api-key: $CRM_API_KEY'`,
    ].join('\n');
    console.log(`${LOG_PREFIX} isConsultantInBanca external cURL (verificação):\n${curlPreview}`);

    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        'x-api-key': apiKey,
      },
      signal: AbortSignal.timeout(12000),
    });

    if (response.status === 200) {
      console.log(`${LOG_PREFIX} isConsultantInBanca external check: inBanca=true (CRM 200), bancaId=${bancaId}, consultantEmail=${consultantEmail}`);
      return true;
    }

    if (response.status === 404) {
      console.log(`${LOG_PREFIX} isConsultantInBanca external check: inBanca=false (CRM 404), bancaId=${bancaId}, consultantEmail=${consultantEmail}`);
      return false;
    }

    const bodyPreview = await response.text().catch(() => '');
    console.log(`${LOG_PREFIX} isConsultantInBanca external check: status inesperado (CRM ${response.status}), tratando como inBanca=false, bancaId=${bancaId}, consultantEmail=${consultantEmail}, body=${bodyPreview.slice(0, 300)}`);
    return false;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`${LOG_PREFIX} isConsultantInBanca external check error: bancaId=${bancaId}, consultantEmail=${consultantEmail}, message=${msg}`);
    return false;
  }
}

/**
 * Retorna os IDs de todas as bancas permitidas para admin/super_admin (para filtro "Todas as Bancas").
 * @param zaplotoId - ID do tenant (ex.: de getEffectiveZaplotoId)
 * @returns Array de banca_ids ou null se não for admin/super_admin
 */
export async function getAdminAllowedBancaIds(
  profile: UserProfile,
  zaplotoId: string | null
): Promise<string[] | null> {
  const isFullScope =
    profile.status === 'admin' || profile.status === 'super_admin' || profile.status === 'auditoria';
  if (!isFullScope) return null;

  const base = supabaseServiceRole
    .from('crm_bancas')
    .select('id')
    .order('name', { ascending: true });
  const { data: rows, error } = zaplotoId
    ? await base.or(`zaploto_id.eq.${zaplotoId},zaploto_id.is.null`)
    : await base;
  if (error || !Array.isArray(rows)) return [];
  return rows.map((r: { id: string }) => r.id);
}

/**
 * Obtém banca_id permitida para o usuário.
 * Admin e super_admin: qualquer banca_id existente em crm_bancas (controle total na transferência de leads).
 */
export async function getAdminBancaId(
  userId: string,
  profile: UserProfile,
  bancaIdFromRequest: string | null
): Promise<{ bancaId: string; crmBaseUrl: string; bancaName?: string } | null> {
  if (!bancaIdFromRequest?.trim()) {
    return null;
  }

  const bancaId = bancaIdFromRequest.trim();
  const isAdminOrSuper = profile.status === 'admin' || profile.status === 'super_admin';
  if (!isAdminOrSuper) {
    return null;
  }

  const { data: banca, error } = await supabaseServiceRole
    .from('crm_bancas')
    .select('id, url, name')
    .eq('id', bancaId)
    .single();

  if (error || !banca?.url) {
    console.log(`${LOG_PREFIX} getAdminBancaId: banca not found or no url, bancaId=${bancaId}, error=${error?.message ?? 'n/a'}`);
    return null;
  }
  const crmBaseUrl = (banca.url as string).trim().replace(/\/+$/, '');
  return {
    bancaId: banca.id,
    crmBaseUrl,
    bancaName: banca.name ?? undefined,
  };
}

/**
 * Gerente na tela de histórico/conversão: só deve ver pacotes executados por ele
 * (`performed_by_user_id`), não transferências de admin/outros na mesma banca.
 */
export function gerenteLeadTransferOwnActionsOnly(profile: UserProfile): boolean {
  return profile.status === 'gerente';
}

/** Bancas vinculadas ao gerente em `user_bancas.banca_ids`. */
export async function getGerenteUserBancaIds(userId: string): Promise<string[]> {
  const { data: row } = await supabaseServiceRole
    .from('user_bancas')
    .select('banca_ids')
    .eq('user_id', userId)
    .maybeSingle();
  return Array.isArray(row?.banca_ids) ? (row.banca_ids as string[]) : [];
}

/**
 * Resolve banca para leitura (histórico, métricas, entries): admin/super, auditoria ou gerente nas suas bancas.
 */
export async function getLeadTransferBancaAccess(
  userId: string,
  profile: UserProfile,
  bancaIdFromRequest: string | null
): Promise<{ bancaId: string; crmBaseUrl: string; bancaName?: string } | null> {
  if (!bancaIdFromRequest?.trim()) return null;
  const bancaId = bancaIdFromRequest.trim();

  if (profile.status === 'admin' || profile.status === 'super_admin') {
    return getAdminBancaId(userId, profile, bancaId);
  }

  if (profile.status === 'auditoria') {
    const { data: banca, error } = await supabaseServiceRole
      .from('crm_bancas')
      .select('id, url, name')
      .eq('id', bancaId)
      .maybeSingle();
    if (error || !banca?.url) return null;
    const crmBaseUrl = (banca.url as string).trim().replace(/\/+$/, '');
    return { bancaId: banca.id, crmBaseUrl, bancaName: banca.name ?? undefined };
  }

  if (profile.status === 'gerente') {
    const allowed = await getGerenteUserBancaIds(userId);
    if (!allowed.includes(bancaId)) return null;
    const { data: banca, error } = await supabaseServiceRole
      .from('crm_bancas')
      .select('id, url, name')
      .eq('id', bancaId)
      .maybeSingle();
    if (error || !banca?.url) return null;
    const crmBaseUrl = (banca.url as string).trim().replace(/\/+$/, '');
    return { bancaId: banca.id, crmBaseUrl, bancaName: banca.name ?? undefined };
  }

  return null;
}

/**
 * Lista de banca_ids para queries de métricas/histórico (sem banca_id no filtro = todas as permitidas ao papel).
 */
export async function resolveLeadTransferQueryBancaIds(
  req: NextRequest,
  userId: string,
  profile: UserProfile,
  bancaIdParam: string | null
): Promise<{ bancaIds: string[]; error?: string }> {
  if (bancaIdParam?.trim()) {
    const resolved = await getLeadTransferBancaAccess(userId, profile, bancaIdParam);
    if (!resolved) return { bancaIds: [], error: 'Banca não encontrada ou sem permissão.' };
    return { bancaIds: [resolved.bancaId] };
  }
  if (profile.status === 'gerente') {
    const ids = await getGerenteUserBancaIds(userId);
    return { bancaIds: ids };
  }
  const zaplotoId = await getEffectiveZaplotoId(req, profile);
  const allowed = await getAdminAllowedBancaIds(profile, zaplotoId);
  return { bancaIds: allowed ?? [] };
}

/**
 * Requer admin, resolve banca e retorna contexto para lead transfer.
 * bancaIdFromRequest: query (GET) ou body (POST).
 */
export async function requireAdminLeadTransferContext(
  req: NextRequest,
  bancaIdFromRequest: string | null
): Promise<AdminLeadTransferContext> {
  const { userId, profile } = await requireAdmin(req);

  console.log(`${LOG_PREFIX} requireAdminLeadTransferContext: userId=${userId}, profile.status=${profile.status}, bancaIdFromRequest=${bancaIdFromRequest ?? 'null'}`);
  const resolved = await getAdminBancaId(userId, profile, bancaIdFromRequest);
  if (!resolved) {
    console.log(`${LOG_PREFIX} requireAdminLeadTransferContext: resolved=null, throwing`);
    throw new Error(
      bancaIdFromRequest
        ? 'Banca não encontrada ou você não tem permissão para operar nesta banca.'
        : 'banca_id é obrigatório.'
    );
  }

  return {
    userId,
    profile,
    bancaId: resolved.bancaId,
    crmBaseUrl: resolved.crmBaseUrl,
    bancaName: resolved.bancaName,
  };
}

/**
 * Verifica se um email pertence a um consultor da banca (user_bancas + profiles).
 * Considera: 1) usuário em user_bancas; 2) consultor cujo gerente (enroller) está na banca.
 * Usa o modelo user_bancas com uma linha por usuário e banca_ids (JSONB).
 */
export async function isConsultantInBanca(bancaId: string, consultantEmail: string): Promise<boolean> {
  const { data: profiles } = await supabaseServiceRole
    .from('profiles')
    .select('id, enroller')
    .ilike('email', consultantEmail.trim())
    .limit(1);

  if (!profiles?.length) {
    const existsInExternalCrm = await hasConsultantInExternalCrm(bancaId, consultantEmail);
    console.log(`${LOG_PREFIX} isConsultantInBanca: no profile for email, bancaId=${bancaId}, consultantEmail=${consultantEmail}, externalCrm=${existsInExternalCrm}`);
    return existsInExternalCrm;
  }

  const userId = profiles[0].id;

  const { data: ub } = await supabaseServiceRole
    .from('user_bancas')
    .select('banca_ids')
    .eq('user_id', userId)
    .maybeSingle();

  const userBancaIds: string[] = Array.isArray(ub?.banca_ids) ? (ub.banca_ids as string[]) : [];
  if (userBancaIds.includes(bancaId)) {
    console.log(`${LOG_PREFIX} isConsultantInBanca: bancaId=${bancaId}, consultantEmail=${consultantEmail}, userId=${userId}, inBanca=true (user_bancas)`);
    return true;
  }

  const enrollerId = profiles[0]?.enroller;
  if (enrollerId) {
    const { data: enrollerUb } = await supabaseServiceRole
      .from('user_bancas')
      .select('banca_ids')
      .eq('user_id', enrollerId)
      .maybeSingle();
    const enrollerBancaIds: string[] = Array.isArray(enrollerUb?.banca_ids) ? (enrollerUb.banca_ids as string[]) : [];
    if (enrollerBancaIds.includes(bancaId)) {
      console.log(`${LOG_PREFIX} isConsultantInBanca: bancaId=${bancaId}, consultantEmail=${consultantEmail}, userId=${userId}, inBanca=true (gerente na banca)`);
      return true;
    }
  }

  const existsInExternalCrm = await hasConsultantInExternalCrm(bancaId, consultantEmail);
  console.log(`${LOG_PREFIX} isConsultantInBanca: bancaId=${bancaId}, consultantEmail=${consultantEmail}, userId=${userId}, inBanca=false (supabase), externalCrm=${existsInExternalCrm}`);
  return existsInExternalCrm;
}
