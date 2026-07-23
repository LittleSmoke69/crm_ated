import { NextRequest } from 'next/server';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import {
  isLegacyUserIdAuthAllowed,
  readSessionUserIdFromRequest,
} from '@/lib/server/session-token';
import { ApiHttpError } from '@/lib/utils/response';
import { UserProfile, getUserProfile } from './permissions';

export interface AuthUser {
  userId: string;
}

export interface AuthUserWithProfile extends AuthUser {
  profile: UserProfile;
}

/**
 * Middleware para autenticação via headers ou query params
 * Prioriza headers para evitar problemas com leitura do body
 */
function readClientUserIdHint(req: NextRequest): string | null {
  const userIdHeader = req.headers.get('x-user-id') || req.headers.get('X-User-Id');
  if (userIdHeader?.trim()) return userIdHeader.trim();

  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const bearer = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (bearer && !bearer.includes('.')) return bearer;
  }

  const userIdCookie = req.cookies.get('user_id')?.value?.trim();
  if (userIdCookie) return userIdCookie;

  return null;
}

/**
 * Autenticação: prioriza cookie de sessão assinado (`zaploto_session`).
 * Header/cookie `user_id` só é aceito se bater com a sessão (anti-spoof).
 * Modo legacy (sem sessão) apenas em dev com ALLOW_LEGACY_USER_ID_AUTH=true.
 */
export async function authenticateRequest(req: NextRequest): Promise<AuthUser | null> {
  try {
    const sessionUserId = await readSessionUserIdFromRequest(req);
    const clientHint = readClientUserIdHint(req);

    if (sessionUserId) {
      if (clientHint && clientHint !== sessionUserId) {
        return null;
      }
      return { userId: sessionUserId };
    }

    if (isLegacyUserIdAuthAllowed()) {
      if (clientHint) return { userId: clientHint };
      const userIdQuery = req.nextUrl.searchParams.get('userId')?.trim();
      if (userIdQuery) return { userId: userIdQuery };
      try {
        const clonedReq = req.clone();
        const body = await clonedReq.json().catch(() => null);
        if (body?.userId) return { userId: String(body.userId).trim() };
      } catch {
        // body não JSON
      }
    }

    return null;
  } catch (error: unknown) {
    const e = error as { message?: string; stack?: string };
    console.error('[authenticateRequest] Erro inesperado:', e?.message);
    console.error('[authenticateRequest] Stack:', e?.stack);
    return null;
  }
}

/** Erros que indicam problema de rede/Supabase indisponível (retentar ou 503) */
function isNetworkOrUnavailableError(err: { message?: string } | null): boolean {
  if (!err?.message) return false;
  const msg = String(err.message).toLowerCase();
  // Não tratar como rede: erros de schema, JWT ou permissão (retornar 401)
  if (
    msg.includes('jwt') ||
    msg.includes('relation') ||
    msg.includes('permission') ||
    msg.includes('row-level') ||
    msg.includes('pgrst') ||
    msg.includes('invalid')
  ) {
    return false;
  }
  return (
    msg.includes('fetch failed') ||
    msg.includes('feetch failed') ||
    msg.includes('econnrefused') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('enotfound') ||
    msg.includes('eai_again') ||
    msg.includes('name resolution') ||
    msg.includes('network') ||
    msg.includes('unavailable') ||
    msg.includes('timeout') ||
    msg.includes('econnaborted')
  );
}

const SERVICE_UNAVAILABLE_MSG = 'Serviço temporariamente indisponível. Tente novamente.';
const VALIDATE_USER_MAX_RETRIES = 5;
const VALIDATE_USER_RETRY_DELAY_MS = 1200;

/**
 * Valida se o usuário existe no banco.
 * Em caso de erro de rede (Supabase inacessível), faz até 5 tentativas antes de
 * lançar 503, para suportar falhas transitórias de rede.
 */
export async function validateUser(userId: string): Promise<boolean> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= VALIDATE_USER_MAX_RETRIES; attempt++) {
    try {
      const { data, error } = await supabaseServiceRole
        .from('profiles')
        .select('id')
        .eq('id', userId)
        .maybeSingle();

      if (error) {
        lastError = error;
        if (isNetworkOrUnavailableError(error) && attempt < VALIDATE_USER_MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, VALIDATE_USER_RETRY_DELAY_MS * attempt));
          continue;
        }
        if (isNetworkOrUnavailableError(error)) {
          console.error('[validateUser] Após retentativas, serviço indisponível. Último erro:', (error as { message?: string }).message);
          const err = new Error(SERVICE_UNAVAILABLE_MSG) as Error & { statusCode?: number };
          err.statusCode = 503;
          throw err;
        }
        console.error('[validateUser] Erro ao buscar usuário:', error.message);
        console.error('[validateUser] UserId:', userId);
        return false;
      }

      return !!data;
    } catch (error: unknown) {
      const e = error as { statusCode?: number; message?: string };
      if (e?.statusCode === 503) throw error;
      lastError = error;
      if (isNetworkOrUnavailableError(e) && attempt < VALIDATE_USER_MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, VALIDATE_USER_RETRY_DELAY_MS * attempt));
        continue;
      }
      if (isNetworkOrUnavailableError(e)) {
        console.error('[validateUser] Após retentativas, serviço indisponível. Última exceção:', e?.message);
        const err = new Error(SERVICE_UNAVAILABLE_MSG) as Error & { statusCode?: number };
        err.statusCode = 503;
        throw err;
      }
      console.error('[validateUser] Erro inesperado:', e?.message);
      console.error('[validateUser] UserId:', userId);
      return false;
    }
  }

  if (lastError) {
    console.error('[validateUser] Todas as tentativas esgotadas. Último erro:', (lastError as { message?: string }).message);
  }
  return false;
}

/**
 * Middleware completo: autentica e valida usuário
 */
export async function requireAuth(req: NextRequest): Promise<AuthUser> {
  try {
    const auth = await authenticateRequest(req);

    if (!auth) {
      throw new ApiHttpError('Não autenticado', 401);
    }

    const isValid = await validateUser(auth.userId);
    if (!isValid) {
      throw new ApiHttpError('Usuário inválido', 401);
    }

    return auth;
  } catch (error: unknown) {
    if (error instanceof ApiHttpError) {
      throw error;
    }
    const e = error as { statusCode?: number; message?: string; stack?: string };
    if (e?.statusCode === 503) {
      throw error;
    }
    console.error('[requireAuth] Erro:', e?.message);
    console.error('[requireAuth] Stack:', e?.stack);
    throw error;
  }
}

/**
 * Middleware completo: autentica, valida e retorna perfil do usuário
 */
export async function requireAuthWithProfile(req: NextRequest): Promise<AuthUserWithProfile> {
  const auth = await requireAuth(req);
  const profile = await getUserProfile(auth.userId);

  if (!profile) {
    throw new Error('Perfil não encontrado');
  }

  return {
    userId: auth.userId,
    profile,
  };
}

/**
 * Apenas super_admin (flows, webhooks, auditoria de hierarquia, etc.).
 * Implementado aqui para evitar duplicação de export em permissions.ts (auth já importa getUserProfile de permissions).
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
    throw new Error('Acesso negado. Apenas SuperAdmin pode acessar este recurso.');
  }
  return { userId, profile };
}
