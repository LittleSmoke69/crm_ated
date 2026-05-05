import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { getTenantByIdOrSlug } from '@/lib/services/zaploto-tenant-service';
import { successResponse, errorResponse } from '@/lib/utils/response';

const DEFAULT_ZAPLOTO_ID = '00000000-0000-0000-0000-000000000001';

/**
 * POST /api/auth/login
 * Recebe email e senha, valida no backend e retorna userId e email em caso de sucesso.
 * O password_hash nunca é exposto ao cliente.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const tenantSlug =
      typeof body.tenantSlug === 'string'
        ? body.tenantSlug.trim().toLowerCase()
        : '';

    if (!email || !password) {
      return errorResponse('Email e senha são obrigatórios.', 400);
    }

    const { data: user, error } = await supabaseServiceRole
      .from('profiles')
      .select('id, email, password_hash, status, zaploto_id')
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

    // status = role do usuário no banco (super_admin, admin, consultor, gerente, dono_banca, gestor, auditoria, suporte)
    return successResponse({
      userId: user.id,
      email: user.email,
      status: user.status ?? null,
      zaploto_id:
        (user.zaploto_id as string | null | undefined)?.trim() || DEFAULT_ZAPLOTO_ID,
    });
  } catch (err) {
    console.error('[Auth Login] Erro:', err);
    return errorResponse('Erro ao efetuar login.', 500);
  }
}
