import { NextRequest } from 'next/server';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { requireAuth } from './auth';

export type UserStatus = 'super_admin' | 'admin' | 'consultor' | 'gerente' | 'dono_banca' | 'gestor' | 'auditoria' | 'suporte';

/** Status do sistema com regras de hierarquia. Cargos personalizados (zaploto_roles) podem ser qualquer string fora desta lista. */
const KNOWN_HIERARCHY_STATUSES: UserStatus[] = ['super_admin', 'admin', 'consultor', 'gerente', 'dono_banca', 'gestor', 'auditoria', 'suporte'];

export interface UserProfile {
  id: string;
  email: string;
  full_name: string | null;
  status: UserStatus | null;
  enroller: string | null;
  created_at: string;
  banca_url?: string | null;
  banca_name?: string | null;
  telefone?: string | null;
  zaploto_id?: string | null;
  theme_preference?: 'light' | 'dark' | null;
}

const GET_PROFILE_MAX_RETRIES = 3;
const GET_PROFILE_RETRY_DELAY_MS = 600;

function isNetworkOrUnavailableError(err: { message?: string } | null): boolean {
  if (!err?.message) return false;
  const msg = String(err.message).toLowerCase();
  return (
    msg.includes('fetch failed') ||
    msg.includes('econnrefused') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('enotfound') ||
    msg.includes('network') ||
    msg.includes('unavailable')
  );
}

/**
 * Busca o perfil completo do usuário incluindo status e enroller.
 * Em caso de erro de rede (Supabase inacessível), faz até 3 tentativas.
 */
export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  for (let attempt = 1; attempt <= GET_PROFILE_MAX_RETRIES; attempt++) {
    try {
      const { data, error } = await supabaseServiceRole
        .from('profiles')
        .select('id, email, full_name, status, enroller, created_at, banca_url, banca_name, telefone, zaploto_id, theme_preference')
        .eq('id', userId)
        .single();

      if (error) {
        if (isNetworkOrUnavailableError(error) && attempt < GET_PROFILE_MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, GET_PROFILE_RETRY_DELAY_MS * attempt));
          continue;
        }
        console.error('[getUserProfile] Erro ao buscar perfil:', error.message, `(tentativa ${attempt}/${GET_PROFILE_MAX_RETRIES})`);
        console.error('[getUserProfile] UserId:', userId);
        if (error.code) console.error('[getUserProfile] Error code:', error.code);
        return null;
      }

      if (!data) {
        console.warn('[getUserProfile] Perfil não encontrado para userId:', userId);
        return null;
      }

      return data as UserProfile;
    } catch (error: unknown) {
      const e = error as { message?: string; code?: string };
      if (isNetworkOrUnavailableError(e) && attempt < GET_PROFILE_MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, GET_PROFILE_RETRY_DELAY_MS * attempt));
        continue;
      }
      console.error('[getUserProfile] Erro inesperado (rede?):', e?.message, `(tentativa ${attempt}/${GET_PROFILE_MAX_RETRIES})`);
      console.error('[getUserProfile] UserId:', userId);
      return null;
    }
  }

  return null;
}

/** Super_admin tem acesso a tudo no painel e APIs admin. */
export function isSuperAdmin(profile: UserProfile | null): boolean {
  return profile?.status === 'super_admin';
}

/** Acesso ao painel administrativo: super_admin, admin e auditoria (auditoria com permissões restritas por step). */
export function hasFullAdminAccess(profile: UserProfile | null): boolean {
  return profile?.status === 'super_admin' || profile?.status === 'admin' || profile?.status === 'auditoria';
}

/** Acesso à hierarquia e alterações na rede: super_admin, admin e suporte. */
export function hasHierarchyAccess(profile: UserProfile | null): boolean {
  return profile?.status === 'super_admin' || profile?.status === 'admin' || profile?.status === 'suporte';
}

/**
 * Verifica se o usuário pode acessar o painel admin (apenas super_admin ou admin)
 */
export async function isAdmin(userId: string): Promise<boolean> {
  const profile = await getUserProfile(userId);
  return hasFullAdminAccess(profile);
}

/**
 * Verifica se o usuário tem um status específico
 */
export async function hasStatus(userId: string, status: UserStatus): Promise<boolean> {
  const profile = await getUserProfile(userId);
  return profile?.status === status;
}

/**
 * Requer que o usuário seja Admin, Auditoria ou cargo com permissão painel_admin na sidebar.
 * Garante que todos os cargos com permissão atribuída tenham acesso sem exceção.
 */
export async function requireAdmin(req: NextRequest): Promise<{ userId: string; profile: UserProfile }> {
  const { userId } = await requireAuth(req);
  let profile = await getUserProfile(userId);
  if (!profile) {
    await new Promise((r) => setTimeout(r, 400));
    profile = await getUserProfile(userId);
  }
  if (!profile) {
    throw new Error('Perfil não encontrado');
  }

  if (hasFullAdminAccess(profile)) {
    return { userId, profile };
  }

  const hasPanelPermission = await hasSidebarPermission(profile, 'painel_admin');
  if (hasPanelPermission) {
    return { userId, profile };
  }

  throw new Error('Acesso negado. Apenas SuperAdmin, Admin, Auditoria ou cargo com permissão de painel podem acessar.');
}

/**
 * Apenas super_admin (bloqueios globais, operações críticas restritas).
 */
export async function requireSuperAdmin(req: NextRequest): Promise<{ userId: string; profile: UserProfile }> {
  const { userId } = await requireAuth(req);
  let profile = await getUserProfile(userId);
  if (!profile) {
    await new Promise((r) => setTimeout(r, 400));
    profile = await getUserProfile(userId);
  }
  if (!profile) {
    throw new Error('Perfil não encontrado');
  }
  if (profile.status !== 'super_admin') {
    throw new Error('Acesso negado. Apenas super admin.');
  }
  return { userId, profile };
}

/**
 * APIs da página Transferência de leads (histórico/métricas): super_admin, admin, auditoria e gerente (escopo por bancas).
 */
export async function requireLeadTransferApiAccess(
  req: NextRequest
): Promise<{ userId: string; profile: UserProfile }> {
  const { userId } = await requireAuth(req);
  let profile = await getUserProfile(userId);
  if (!profile) {
    await new Promise((r) => setTimeout(r, 400));
    profile = await getUserProfile(userId);
  }
  if (!profile) {
    throw new Error('Perfil não encontrado');
  }
  const s = profile.status;
  if (s === 'super_admin' || s === 'admin' || s === 'auditoria' || s === 'gerente') {
    return { userId, profile };
  }
  throw new Error('Acesso negado.');
}

/**
 * Requer que o usuário seja SuperAdmin, Admin, Suporte ou cargo com permissão hierarquia na sidebar.
 * Garante que cargos com permissão de hierarquia tenham acesso sem exceção.
 */
export async function requireAdminOrSuporte(req: NextRequest): Promise<{ userId: string; profile: UserProfile }> {
  const { userId } = await requireAuth(req);
  let profile = await getUserProfile(userId);
  if (!profile) {
    await new Promise((r) => setTimeout(r, 400));
    profile = await getUserProfile(userId);
  }
  if (!profile) {
    throw new Error('Perfil não encontrado');
  }
  if (hasHierarchyAccess(profile)) {
    return { userId, profile };
  }
  const hasHierarchyPermission = await hasSidebarPermission(profile, 'hierarquia');
  if (hasHierarchyPermission) {
    return { userId, profile };
  }
  throw new Error('Acesso negado. Apenas SuperAdmin, Admin, Suporte ou cargo com permissão de hierarquia podem acessar.');
}

/**
 * Lista de bancas CRM: hierarquia (admin/suporte) ou gerente (para telas como transferência de leads).
 */
export async function requireAdminOrSuporteOrGerente(
  req: NextRequest
): Promise<{ userId: string; profile: UserProfile }> {
  const { userId } = await requireAuth(req);
  let profile = await getUserProfile(userId);
  if (!profile) {
    await new Promise((r) => setTimeout(r, 400));
    profile = await getUserProfile(userId);
  }
  if (!profile) {
    throw new Error('Perfil não encontrado');
  }
  if (hasHierarchyAccess(profile)) {
    return { userId, profile };
  }
  const hasHierarchyPermission = await hasSidebarPermission(profile, 'hierarquia');
  if (hasHierarchyPermission) {
    return { userId, profile };
  }
  if (profile.status === 'gerente') {
    return { userId, profile };
  }
  throw new Error('Acesso negado. Apenas SuperAdmin, Admin, Suporte, cargo com hierarquia ou Gerente podem acessar.');
}

/**
 * Requer que o usuário seja SuperAdmin, Admin ou Auditoria (acesso ao Anti-Spam)
 */
export async function requireAntiSpamAccess(req: NextRequest): Promise<{ userId: string; profile: UserProfile }> {
  const { userId } = await requireAuth(req);
  let profile = await getUserProfile(userId);
  if (!profile) {
    await new Promise((r) => setTimeout(r, 400));
    profile = await getUserProfile(userId);
  }
  if (!profile) {
    throw new Error('Perfil não encontrado');
  }
  const allowed = profile.status === 'super_admin' || profile.status === 'admin' || profile.status === 'auditoria';
  if (!allowed) {
    throw new Error('Acesso negado. Apenas SuperAdmin, Admin ou Auditoria podem acessar o Anti-Spam.');
  }
  return { userId, profile };
}

/** Tenant padrão quando profile.zaploto_id é null (ex: usuários antigos) */
const DEFAULT_ZAPLOTO_ID = '00000000-0000-0000-0000-000000000001';

/**
 * Verifica se o perfil tem permissão para um item da sidebar (zaploto_role_sidebar).
 * Usado para cargos personalizados que não têm status fixo do sistema.
 * Usa zaploto_id do perfil ou DEFAULT quando null. Match do role code é case-insensitive.
 */
export async function hasSidebarPermission(
  profile: UserProfile | null,
  sidebarItemCode: string
): Promise<boolean> {
  if (!profile?.status?.trim()) return false;
  const roleCode = profile.status.trim();
  const zaplotoId = profile.zaploto_id ?? DEFAULT_ZAPLOTO_ID;

  const { data: roles } = await supabaseServiceRole
    .from('zaploto_roles')
    .select('id')
    .eq('zaploto_id', zaplotoId)
    .ilike('code', roleCode);

  const role = Array.isArray(roles) && roles.length > 0 ? roles[0] : null;
  if (!role?.id) return false;

  const { data: item } = await supabaseServiceRole
    .from('zaploto_sidebar_items')
    .select('id')
    .eq('zaploto_id', zaplotoId)
    .eq('code', sidebarItemCode)
    .single();

  if (!item?.id) return false;

  const { data: perm } = await supabaseServiceRole
    .from('zaploto_role_sidebar')
    .select('visible')
    .eq('role_id', role.id)
    .eq('sidebar_item_id', item.id)
    .maybeSingle();

  return perm?.visible === true;
}

/**
 * Requer que o usuário tenha um status específico OU permissão na sidebar (para cargos personalizados).
 */
export async function requireStatusOrSidebarPermission(
  req: NextRequest,
  allowedStatuses: UserStatus[],
  sidebarItemCode: string
): Promise<{ userId: string; profile: UserProfile }> {
  const { userId } = await requireAuth(req);
  const profile = await getUserProfile(userId);

  if (!profile) {
    console.error('[requireStatusOrSidebarPermission] Perfil não encontrado para userId:', userId);
    throw new Error('Perfil não encontrado');
  }

  const normalizedStatus = profile.status?.trim().toLowerCase();
  const normalizedAllowed = allowedStatuses.map(s => String(s).trim().toLowerCase());

  if (normalizedStatus && normalizedAllowed.includes(normalizedStatus)) {
    return { userId, profile };
  }

  const hasPermission = await hasSidebarPermission(profile, sidebarItemCode);
  if (hasPermission) {
    return { userId, profile };
  }

  throw new Error(`Acesso negado. Esta página é exclusiva para usuários autorizados. Status atual: ${profile.status || 'null'}`);
}

/**
 * Requer que o usuário tenha um status específico
 */
export async function requireStatus(
  req: NextRequest,
  allowedStatuses: UserStatus[]
): Promise<{ userId: string; profile: UserProfile }> {
  const { userId } = await requireAuth(req);
  const profile = await getUserProfile(userId);

  if (!profile) {
    console.error('[requireStatus] Perfil não encontrado para userId:', userId);
    throw new Error('Perfil não encontrado');
  }

  // Normaliza o status para comparação (remove espaços e converte para minúsculas)
  const normalizedStatus = profile.status?.trim().toLowerCase();
  const normalizedAllowed = allowedStatuses.map(s => s.trim().toLowerCase());

  if (!normalizedStatus || !normalizedAllowed.includes(normalizedStatus)) {
    throw new Error(`Acesso negado. Apenas usuários com status: ${allowedStatuses.join(', ')} podem acessar. Status atual: ${profile.status || 'null'}`);
  }

  return { userId, profile };
}

/**
 * Estoque de leads (visualização): gerente (próprio estoque) ou admin/super_admin (auditoria por banca).
 */
export async function requireLeadStockViewer(req: NextRequest): Promise<{ userId: string; profile: UserProfile }> {
  const { userId } = await requireAuth(req);
  const profile = await getUserProfile(userId);
  if (!profile) {
    console.error('[requireLeadStockViewer] Perfil não encontrado para userId:', userId);
    throw new Error('Perfil não encontrado');
  }
  const s = profile.status?.trim().toLowerCase();
  if (s === 'gerente' || s === 'admin' || s === 'super_admin') {
    return { userId, profile };
  }
  throw new Error('Acesso negado. Apenas gerente, admin ou super_admin podem acessar o estoque de leads.');
}

export function isLeadStockAdminViewer(profile: UserProfile): boolean {
  const s = profile.status?.trim().toLowerCase();
  return s === 'admin' || s === 'super_admin';
}

/**
 * Verifica se um usuário pode acessar dados de outro usuário baseado na hierarquia
 * Admin pode acessar tudo
 * Dono de banca pode acessar seus Gerentes e Consultores abaixo dele
 * Gerente pode acessar seus Consultores abaixo dele
 * Consultor só pode acessar seus próprios dados
 */
export async function canAccessUser(
  requesterId: string,
  targetUserId: string
): Promise<boolean> {
  // Mesmo usuário sempre pode acessar
  if (requesterId === targetUserId) {
    return true;
  }

  const requesterProfile = await getUserProfile(requesterId);
  const targetProfile = await getUserProfile(targetUserId);

  if (!requesterProfile || !targetProfile) {
    return false;
  }

  // Super_admin e admin podem acessar todos os dados (incluindo CRM de qualquer pessoa)
  if (requesterProfile.status === 'super_admin' || requesterProfile.status === 'admin') {
    return true;
  }

  // Consultor só pode acessar seus próprios dados
  if (requesterProfile.status === 'consultor') {
    return false;
  }

  // Verifica hierarquia: busca todos os subordinados do requester
  const subordinates = await getSubordinates(requesterId);
  return subordinates.some(sub => sub.id === targetUserId);
}

/**
 * Retorna todos os IDs de usuários subordinados (recursivo)
 * Admin retorna todos os usuários
 * Dono de banca retorna seus Gerentes e Consultores
 * Gerente retorna seus Consultores
 * Consultor retorna array vazio
 */
export async function getSubordinateIds(userId: string): Promise<string[]> {
  const profile = await getUserProfile(userId);

  if (!profile) {
    return [];
  }

  // Super_admin: todos os perfis. Admin: todos exceto outros admin
  if (profile.status === 'super_admin' || profile.status === 'admin') {
    let q = supabaseServiceRole.from('profiles').select('id');
    if (profile.status === 'admin') {
      q = q.neq('status', 'admin');
    }
    const { data } = await q;
    return data?.map(u => u.id) || [];
  }

  // Consultor e Gestor não têm subordinados (gestor visualiza dados do dono da banca via enroller)
  if (profile.status === 'consultor' || profile.status === 'gestor') {
    return [];
  }

  // Busca subordinados diretos e recursivamente
  const subordinates = await getSubordinates(userId);
  return subordinates.map(sub => sub.id);
}

/**
 * Retorna todos os perfis de usuários subordinados (recursivo)
 */
export async function getSubordinates(userId: string): Promise<UserProfile[]> {
  const profile = await getUserProfile(userId);

  if (!profile) {
    return [];
  }

  // Super_admin: todos os perfis. Admin: todos exceto outros admin
  if (profile.status === 'super_admin' || profile.status === 'admin') {
    let q = supabaseServiceRole
      .from('profiles')
      .select('id, email, full_name, status, enroller, created_at');
    if (profile.status === 'admin') {
      q = q.neq('status', 'admin');
    }
    const { data } = await q;
    return (data as UserProfile[]) || [];
  }

  // Consultor e Gestor não têm subordinados
  if (profile.status === 'consultor' || profile.status === 'gestor') {
    return [];
  }

  /**
   * Descendentes por enroller: BFS em níveis (1 query por nível da árvore).
   * Antes: recursão = 1 round-trip por nó (muito lento em redes grandes).
   */
  const ENROLLER_IN_CHUNK = 100;
  const MAX_DEPTH = 64;
  const seen = new Set<string>();
  let frontier: string[] = [userId];
  const allSubordinates: UserProfile[] = [];

  for (let depth = 0; depth < MAX_DEPTH && frontier.length > 0; depth++) {
    const batch: UserProfile[] = [];
    for (let i = 0; i < frontier.length; i += ENROLLER_IN_CHUNK) {
      const chunk = frontier.slice(i, i + ENROLLER_IN_CHUNK);
      const { data: children } = await supabaseServiceRole
        .from('profiles')
        .select('id, email, full_name, status, enroller, created_at')
        .in('enroller', chunk);
      batch.push(...((children as UserProfile[]) || []));
    }
    frontier = [];
    for (const child of batch) {
      const id = child.id;
      if (seen.has(id)) continue;
      seen.add(id);
      allSubordinates.push(child);
      frontier.push(id);
    }
  }

  return allSubordinates;
}

/**
 * Valida se a hierarquia está correta
 * Consultor: enroller obrigatório — Gerente, Admin ou Super Admin
 * Gerente: enroller opcional — Dono, outro Gerente, Admin ou Super Admin
 * Dono de banca pode ter enroller NULL ou outro Dono de banca (se houver estrutura superior)
 * Admin deve ter enroller NULL
 * Auditoria e Suporte podem ter Admin como enroller ou NULL
 */
export async function validateHierarchy(userId: string, status: UserStatus | string | null | undefined, enroller: string | null): Promise<{ valid: boolean; error?: string }> {
  // Trata string vazia como null (dono/superior opcional ao atribuir gerente)
  const enrollerId = (enroller != null && String(enroller).trim() !== '') ? String(enroller).trim() : null;

  // Cargos personalizados (White Label & Cargos): aceita qualquer enroller ou null, sem validar hierarquia
  const statusStr = status != null ? String(status).trim() : '';
  if (!statusStr || !KNOWN_HIERARCHY_STATUSES.includes(statusStr as UserStatus)) {
    return { valid: true };
  }

  // Admin e Super Admin sempre devem ter enroller NULL
  if (statusStr === 'admin' || statusStr === 'super_admin') {
    if (enrollerId !== null) {
      return { valid: false, error: `${statusStr === 'super_admin' ? 'Super Admin' : 'Admin'} não pode ter enroller` };
    }
    return { valid: true };
  }

  // Auditoria e Suporte podem ter enroller NULL ou Admin
  if (statusStr === 'auditoria' || statusStr === 'suporte') {
    if (enrollerId === null) {
      return { valid: true };
    }
    const enrollerProfile = await getUserProfile(enrollerId);
    if (!enrollerProfile) {
      return { valid: false, error: 'Enroller não encontrado' };
    }
    if (enrollerProfile.status !== 'admin') {
      return { valid: false, error: `${statusStr} deve ter Admin como enroller ou NULL` };
    }
    return { valid: true };
  }

  // Gerente, Dono de banca e Gestor podem ter enroller NULL (sem superior). Consultor sempre deve ter um superior válido.
  if (enrollerId === null) {
    if (statusStr === 'consultor') {
      return { valid: false, error: 'Consultor deve ser atribuído a um Gerente ou Admin' };
    }
    if (statusStr === 'dono_banca' || statusStr === 'gerente' || statusStr === 'gestor') {
      return { valid: true };
    }
    return { valid: false, error: `${statusStr} deve ter um enroller` };
  }

  // Verifica se o enroller existe
  const enrollerProfile = await getUserProfile(enrollerId);
  if (!enrollerProfile) {
    return { valid: false, error: 'Enroller não encontrado' };
  }

  // Valida hierarquia
  if (statusStr === 'consultor') {
    const validConsultorEnroller = ['gerente', 'admin', 'super_admin'].includes(enrollerProfile.status ?? '');
    if (!validConsultorEnroller) {
      return { valid: false, error: 'Consultor deve ter um Gerente, Admin ou Super Admin como enroller' };
    }
  } else if (statusStr === 'gerente') {
    // Gerente pode ter Dono de banca, outro Gerente, Admin ou Super Admin como enroller (super_admin/admin/suporte podem atribuir sem dono de banca)
    const validGerenteEnroller = ['dono_banca', 'gerente', 'admin', 'super_admin'].includes(enrollerProfile.status ?? '');
    if (!validGerenteEnroller) {
      return { valid: false, error: 'Gerente deve ter Dono de banca, outro Gerente, Admin ou Super Admin como enroller' };
    }
  } else if (statusStr === 'dono_banca') {
    // Dono de banca pode ter outro Dono de banca, Admin ou Super Admin como enroller
    const validDonoEnroller = ['dono_banca', 'admin', 'super_admin'].includes(enrollerProfile.status ?? '');
    if (!validDonoEnroller) {
      return { valid: false, error: 'Dono de banca deve ter outro Dono de banca, Admin ou Super Admin como enroller' };
    }
  } else if (statusStr === 'gestor') {
    // Gestor de tráfego pode ter Dono de banca, Admin ou Super Admin como enroller
    const validGestorEnroller = ['dono_banca', 'admin', 'super_admin'].includes(enrollerProfile.status ?? '');
    if (!validGestorEnroller) {
      return { valid: false, error: 'Gestor de tráfego deve ter Dono de banca, Admin ou Super Admin como enroller' };
    }
  }

  return { valid: true };
}

/**
 * Verifica se há ciclos na hierarquia (ex: A -> B -> A)
 */
export async function hasHierarchyCycle(userId: string, enroller: string | null): Promise<boolean> {
  if (!enroller) {
    return false;
  }

  const visited = new Set<string>();
  let current: string | null = enroller;

  while (current) {
    if (visited.has(current)) {
      return true; // Ciclo detectado
    }

    if (current === userId) {
      return true; // Ciclo detectado (tentando se referenciar indiretamente)
    }

    visited.add(current);

    const profile = await getUserProfile(current);
    if (!profile) {
      break;
    }

    current = profile.enroller;
  }

  return false;
}
