import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { checkIpRateLimit } from '@/lib/server/ip-rate-limit';
import { errorResponse, successResponse } from '@/lib/utils/response';

const DEFAULT_ZAPLOTO_ID = '00000000-0000-0000-0000-000000000001';

function isPublicRegistrationEnabled(): boolean {
  return process.env.REGISTER_PUBLIC_ENABLED === 'true';
}

/**
 * POST /api/auth/register — cadastro público (desligado por padrão).
 * Defina REGISTER_PUBLIC_ENABLED=true no ambiente para habilitar.
 */
export async function POST(req: NextRequest) {
  try {
    if (!isPublicRegistrationEnabled()) {
      return errorResponse('Cadastro público desabilitado. Solicite acesso ao administrador.', 403);
    }

    const rateLimited = checkIpRateLimit(req, 'auth-register', 5, 60 * 60 * 1000);
    if (rateLimited) return errorResponse(rateLimited, 429);

    const body = await req.json().catch(() => ({}));
    const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';

    if (!fullName || !email || !password) {
      return errorResponse('Nome, e-mail e senha são obrigatórios.', 400);
    }
    if (password.length < 8) {
      return errorResponse('A senha deve ter pelo menos 8 caracteres.', 400);
    }

    const { data: existing } = await supabaseServiceRole
      .from('profiles')
      .select('id')
      .eq('email', email)
      .maybeSingle();
    if (existing) {
      return errorResponse('Não foi possível concluir o cadastro com estes dados.', 400);
    }

    const newUserId = randomUUID();
    const passwordHash = bcrypt.hashSync(password, bcrypt.genSaltSync(10));

    const { data: inserted, error: insertErr } = await supabaseServiceRole
      .from('profiles')
      .insert({
        user_id: newUserId,
        email,
        full_name: fullName,
        password_hash: passwordHash,
        status: 'captador',
        zaploto_id: DEFAULT_ZAPLOTO_ID,
        created_at: new Date().toISOString(),
      })
      .select('id, email')
      .single();

    if (insertErr || !inserted?.id) {
      console.error('[auth/register]', insertErr?.message);
      return errorResponse('Erro ao criar conta.', 500);
    }

    await supabaseServiceRole.from('user_settings').upsert(
      {
        user_id: inserted.id,
        max_leads_per_day: 100,
        max_instances: 5,
        is_admin: false,
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id', ignoreDuplicates: true }
    );

    return successResponse(
      { userId: inserted.id, email: inserted.email },
      'Conta criada. Faça login para continuar.'
    );
  } catch (err) {
    console.error('[auth/register]', err);
    return errorResponse('Erro ao criar conta.', 500);
  }
}
