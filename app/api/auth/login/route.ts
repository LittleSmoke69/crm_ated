import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { getTenantByIdOrSlug } from '@/lib/services/zaploto-tenant-service';
import { checkIpRateLimit } from '@/lib/server/ip-rate-limit';
import { appendSessionCookie } from '@/lib/server/session-token';
import { normalizeStatus } from '@/lib/middleware/permissions';
import { successResponse, errorResponse } from '@/lib/utils/response';

const DEFAULT_ZAPLOTO_ID = '00000000-0000-0000-0000-000000000001';

/**
 * POST /api/auth/login
 * Recebe email e senha, valida no backend e retorna userId e email em caso de sucesso.
 * O password_hash nunca é exposto ao cliente.
 */
export async function POST(req: NextRequest) {
  try {
    const rateLimited = checkIpRateLimit(req, 'auth-login', 20, 15 * 60 * 1000);
    if (rateLimited) return errorResponse(rateLimited, 429);

    const body = await req.json();
    const identifier = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const tenantSlug =
      typeof body.tenantSlug === 'string'
        ? body.tenantSlug.trim().toLowerCase()
        : '';

    if (!identifier || !password) {
      return errorResponse('E-mail/usuário e senha são obrigatórios.', 400);
    }

    const loginByUsername = identifier.startsWith('@') || !identifier.includes('@');
    const normalizedUsername = identifier.replace(/^@+/, '');
    let userQuery = supabaseServiceRole
      .from('profiles')
      .select('id, email, username, password_hash, status, zaploto_id');
    userQuery = loginByUsername
      ? userQuery.eq('username', normalizedUsername)
      : userQuery.eq('email', identifier);
    const { data: user, error } = await userQuery.maybeSingle();

    if (error || !user) {
      return errorResponse('Credenciais inválidas.', 401);
    }

    const passwordHash = user.password_hash ?? '';
    const matches = bcrypt.compareSync(password, passwordHash);
    if (!matches) {
      return errorResponse('Credenciais inválidas.', 401);
    }

    // Usuário desativado (user_settings.is_active = false) não pode entrar
    const { data: settings } = await supabaseServiceRole
      .from('user_settings')
      .select('is_active')
      .eq('user_id', user.id)
      .maybeSingle();
    if (settings?.is_active === false) {
      return errorResponse('Conta desativada. Fale com o administrador.', 403);
    }

    if (tenantSlug) {
      const tenant = await getTenantByIdOrSlug(tenantSlug);
      if (!tenant) {
        return errorResponse('Credenciais inválidas para este painel.', 403);
      }
      const profileZaplotoId =
        (user.zaploto_id as string | null | undefined)?.trim() || DEFAULT_ZAPLOTO_ID;
      const role = user.status as string | null | undefined;
      if (role !== 'super_admin' && profileZaplotoId !== tenant.id) {
        return errorResponse('Credenciais inválidas para este painel.', 403);
      }
    }

    // Atualiza último login (ignora erro para não falhar o login)
    await supabaseServiceRole
      .from('profiles')
      .update({ last_login_at: new Date().toISOString() })
      .eq('id', user.id);

    const res = successResponse({
      userId: user.id,
      email: user.email,
      username: user.username,
      status: normalizeStatus(user.status) ?? null,
      zaploto_id:
        (user.zaploto_id as string | null | undefined)?.trim() || DEFAULT_ZAPLOTO_ID,
    });
    await appendSessionCookie(res, user.id);
    return res;
  } catch (err) {
    console.error('[Auth Login] Erro:', err);
    return errorResponse('Erro ao efetuar login.', 500);
  }
}
