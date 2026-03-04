import { NextRequest } from 'next/server';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { requireAuth } from './auth';

export type UserStatus = 'super_admin' | 'admin' | 'consultor' | 'gerente' | 'dono_banca' | 'gestor' | 'auditoria' | 'suporte';

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
 * Requer que o usuário seja Admin ou Dono de Banca (pode acessar painel admin)
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

  if (!hasFullAdminAccess(profile)) {
    throw new Error('Acesso negado. Apenas SuperAdmin ou Admin podem acessar o painel administrativo.');
  }

  return { userId, profile };
}

/**
 * Requer que o usuário seja SuperAdmin, Admin ou Suporte (acesso à Hierarquia e alterações na rede)
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
  if (!hasHierarchyAccess(profile)) {
    throw new Error('Acesso negado. Apenas SuperAdmin, Admin ou Suporte podem acessar a Hierarquia.');
  }
  return { userId, profile };
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

/**
 * Requer que o usuário seja SuperAdmin (acesso a Flows e Webhooks)
 */
export async function requireSuperAdmin(req: NextRequest): Promise<{ userId: string; profile: UserProfile }> {
  const { userId } = await requireAuth(req);
  const profile = await getUserProfile(userId);

  if (!profile) {
    throw new Error('Perfil não encontrado');
  }

  if (profile.status !== 'super_admin') {
    throw new Error('Acesso negado. Apenas SuperAdmin pode acessar este recurso.');
  }

  return { userId, profile };
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

  // Super_admin e admin retornam todos os usuários (exceto outros admins)
  if (profile.status === 'super_admin' || profile.status === 'admin') {
    const { data } = await supabaseServiceRole
      .from('profiles')
      .select('id')
      .neq('status', 'admin');
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

  // Super_admin e admin retornam todos os usuários (exceto outros admins)
  if (profile.status === 'super_admin' || profile.status === 'admin') {
    const { data } = await supabaseServiceRole
      .from('profiles')
      .select('id, email, full_name, status, enroller, created_at')
      .neq('status', 'admin');
    return (data as UserProfile[]) || [];
  }

  // Consultor e Gestor não têm subordinados
  if (profile.status === 'consultor' || profile.status === 'gestor') {
    return [];
  }

  // Busca subordinados diretos
  const { data: directSubordinates } = await supabaseServiceRole
    .from('profiles')
    .select('id, email, full_name, status, enroller, created_at')
    .eq('enroller', userId);

  if (!directSubordinates || directSubordinates.length === 0) {
    return [];
  }

  const allSubordinates: UserProfile[] = [...directSubordinates as UserProfile[]];

  // Busca subordinados recursivamente
  for (const subordinate of directSubordinates) {
    const nestedSubordinates = await getSubordinates(subordinate.id);
    allSubordinates.push(...nestedSubordinates);
  }

  return allSubordinates;
}

/**
 * Valida se a hierarquia está correta
 * Consultor e Gerente podem ter enroller NULL (sem superior) ou ter Gerente/Dono como enroller
 * Dono de banca pode ter enroller NULL ou outro Dono de banca (se houver estrutura superior)
 * Admin deve ter enroller NULL
 * Auditoria e Suporte podem ter Admin como enroller ou NULL
 */
export async function validateHierarchy(userId: string, status: UserStatus, enroller: string | null): Promise<{ valid: boolean; error?: string }> {
  // Trata string vazia como null (dono/superior opcional ao atribuir gerente)
  const enrollerId = (enroller != null && String(enroller).trim() !== '') ? String(enroller).trim() : null;

  // Admin e Super Admin sempre devem ter enroller NULL
  if (status === 'admin' || status === 'super_admin') {
    if (enrollerId !== null) {
      return { valid: false, error: `${status === 'super_admin' ? 'Super Admin' : 'Admin'} não pode ter enroller` };
    }
    return { valid: true };
  }

  // Auditoria e Suporte podem ter enroller NULL ou Admin
  if (status === 'auditoria' || status === 'suporte') {
    if (enrollerId === null) {
      return { valid: true };
    }
    const enrollerProfile = await getUserProfile(enrollerId);
    if (!enrollerProfile) {
      return { valid: false, error: 'Enroller não encontrado' };
    }
    if (enrollerProfile.status !== 'admin') {
      return { valid: false, error: `${status} deve ter Admin como enroller ou NULL` };
    }
    return { valid: true };
  }

  // Gerente, Dono de banca e Gestor podem ter enroller NULL (sem superior). Consultor sempre deve ter um Gerente.
  if (enrollerId === null) {
    if (status === 'consultor') {
      return { valid: false, error: 'Consultor deve ser atribuído a um Gerente' };
    }
    if (status === 'dono_banca' || status === 'gerente' || status === 'gestor') {
      return { valid: true };
    }
    return { valid: false, error: `${status} deve ter um enroller` };
  }

  // Verifica se o enroller existe
  const enrollerProfile = await getUserProfile(enrollerId);
  if (!enrollerProfile) {
    return { valid: false, error: 'Enroller não encontrado' };
  }

  // Valida hierarquia
  if (status === 'consultor') {
    if (enrollerProfile.status !== 'gerente') {
      return { valid: false, error: 'Consultor deve ter um Gerente como enroller' };
    }
  } else if (status === 'gerente') {
    // Gerente pode ter Dono de banca, outro Gerente, Admin ou Super Admin como enroller (super_admin/admin/suporte podem atribuir sem dono de banca)
    const validGerenteEnroller = ['dono_banca', 'gerente', 'admin', 'super_admin'].includes(enrollerProfile.status ?? '');
    if (!validGerenteEnroller) {
      return { valid: false, error: 'Gerente deve ter Dono de banca, outro Gerente, Admin ou Super Admin como enroller' };
    }
  } else if (status === 'dono_banca') {
    // Dono de banca pode ter outro Dono de banca, Admin ou Super Admin como enroller
    const validDonoEnroller = ['dono_banca', 'admin', 'super_admin'].includes(enrollerProfile.status ?? '');
    if (!validDonoEnroller) {
      return { valid: false, error: 'Dono de banca deve ter outro Dono de banca, Admin ou Super Admin como enroller' };
    }
  } else if (status === 'gestor') {
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

