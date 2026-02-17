/**
 * Resolve banca_id e crm_base_url para rotas de transferência de leads (Admin).
 * Admin e super_admin têm controle total: qualquer banca em crm_bancas pode ser usada.
 */

const LOG_PREFIX = '[lead-transfer][context]';

import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import type { UserProfile } from '@/lib/middleware/permissions';

export interface AdminLeadTransferContext {
  userId: string;
  profile: UserProfile;
  bancaId: string;
  crmBaseUrl: string;
  bancaName?: string;
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
 */
export async function isConsultantInBanca(bancaId: string, consultantEmail: string): Promise<boolean> {
  const { data: profiles } = await supabaseServiceRole
    .from('profiles')
    .select('id, enroller')
    .ilike('email', consultantEmail.trim())
    .limit(1);

  if (!profiles?.length) {
    console.log(`${LOG_PREFIX} isConsultantInBanca: no profile for email, bancaId=${bancaId}, consultantEmail=${consultantEmail}`);
    return false;
  }

  const userId = profiles[0].id;

  const { data: ub } = await supabaseServiceRole
    .from('user_bancas')
    .select('banca_ids')
    .eq('user_id', userId)
    .maybeSingle();

  const userBancaIds = Array.isArray(ub?.banca_ids) ? (ub.banca_ids as string[]) : [];
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
    const enrollerBancaIds = Array.isArray(enrollerUb?.banca_ids) ? (enrollerUb.banca_ids as string[]) : [];
    if (enrollerBancaIds.includes(bancaId)) {
      console.log(`${LOG_PREFIX} isConsultantInBanca: bancaId=${bancaId}, consultantEmail=${consultantEmail}, userId=${userId}, inBanca=true (gerente na banca)`);
      return true;
    }
  }

  console.log(`${LOG_PREFIX} isConsultantInBanca: bancaId=${bancaId}, consultantEmail=${consultantEmail}, userId=${userId}, inBanca=false`);
  return false;
}
