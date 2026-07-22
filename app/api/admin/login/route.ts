import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { checkIpRateLimit } from '@/lib/server/ip-rate-limit';
import { appendSessionCookie } from '@/lib/server/session-token';
import {
  getUserProfile,
  hasFullAdminAccess,
  hasSidebarPermission,
  normalizeStatus,
} from '@/lib/middleware/permissions';
import { successResponse, errorResponse } from '@/lib/utils/response';

async function canAccessAdminPanel(userId: string): Promise<boolean> {
  const profile = await getUserProfile(userId);
  if (!profile) return false;
  if (hasFullAdminAccess(profile)) return true;
  if (await hasSidebarPermission(profile, 'painel_admin')) return true;
  if (await hasSidebarPermission(profile, 'hierarquia')) return true;
  return false;
}

/**
 * POST /api/admin/login
 * Login do painel administrativo com cookie de sessão assinado (zaploto_session).
 */
export async function POST(req: NextRequest) {
  try {
    const rateLimited = checkIpRateLimit(req, 'admin-login', 20, 15 * 60 * 1000);
    if (rateLimited) return errorResponse(rateLimited, 429);

    const body = await req.json();
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';

    if (!email || !password) {
      return errorResponse('Email e senha são obrigatórios.', 400);
    }

    const { data: user, error } = await supabaseServiceRole
      .from('profiles')
      .select('id, email, password_hash, status')
      .eq('email', email)
      .single();

    if (error || !user) {
      return errorResponse('Credenciais inválidas.', 401);
    }

    const passwordHash = user.password_hash ?? '';
    const matches = bcrypt.compareSync(password, passwordHash);
    if (!matches) {
      return errorResponse('Credenciais inválidas.', 401);
    }

    const canAccess = await canAccessAdminPanel(user.id);
    if (!canAccess) {
      return errorResponse('Acesso negado. Esta conta não possui permissões de administrador.', 403);
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

    await supabaseServiceRole
      .from('profiles')
      .update({ last_login_at: new Date().toISOString() })
      .eq('id', user.id);

    const res = successResponse({
      userId: user.id,
      email: user.email,
      status: normalizeStatus(user.status) ?? null,
    });
    await appendSessionCookie(res, user.id);
    return res;
  } catch (err) {
    console.error('[Admin Login] Erro:', err);
    return errorResponse('Erro ao efetuar login.', 500);
  }
}
