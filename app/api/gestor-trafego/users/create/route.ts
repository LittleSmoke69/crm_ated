import { NextRequest } from 'next/server';
import { requireStatus, validateHierarchy, UserStatus, getUserProfile } from '@/lib/middleware/permissions';
import { getEffectiveDonoIdForGestor } from '@/lib/middleware/gestor-owner';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { isInHierarchy } from '@/lib/utils/hierarchy';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';

/**
 * POST /api/gestor-trafego/users/create
 * Permite ao Gestor de Tráfego criar Gerentes e Consultores na banca do dono ao qual está vinculado
 */
export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireStatus(req, ['gestor', 'admin', 'super_admin']);
    const profile = await getUserProfile(userId);
    if (!profile) return errorResponse('Perfil não encontrado', 403);
    let ownerId: string | null = profile.status === 'gestor'
      ? await getEffectiveDonoIdForGestor(userId)
      : req.headers.get('X-Effective-Dono-Id');
    if (!ownerId) {
      return errorResponse('Gestor vinculado a um Dono de Banca ou informe X-Effective-Dono-Id para cadastrar usuários.', 403);
    }

    const body = await req.json();
    const { email, fullName, password, status, enroller } = body;

    if (!email || !password || !status) {
      return errorResponse('Email, senha e status são obrigatórios', 400);
    }

    if (status !== 'gerente' && status !== 'consultor') {
      return errorResponse('Só é possível cadastrar Gerentes ou Consultores', 403);
    }

    let targetEnroller = enroller;
    if (status === 'gerente') {
      targetEnroller = ownerId;
    }

    if (status === 'consultor') {
      if (!targetEnroller) {
        return errorResponse('Para cadastrar um Consultor, é necessário selecionar um Gerente', 400);
      }
      const isEnrollerInHierarchy = await isInHierarchy(ownerId, targetEnroller);
      if (!isEnrollerInHierarchy) {
        return errorResponse('O Gerente selecionado não pertence à banca vinculada', 403);
      }
    }

    const validation = await validateHierarchy('', status as UserStatus, targetEnroller);
    if (!validation.valid) {
      return errorResponse(validation.error || 'Hierarquia inválida', 400);
    }

    const { data: existing } = await supabaseServiceRole
      .from('profiles')
      .select('id')
      .eq('email', email.trim().toLowerCase())
      .maybeSingle();

    if (existing) {
      return errorResponse('Este e-mail já está cadastrado no sistema', 400);
    }

    const passwordHash = bcrypt.hashSync(password, bcrypt.genSaltSync(10));
    const newUserId = randomUUID();

    const { data: newUser, error: createError } = await supabaseServiceRole
      .from('profiles')
      .insert({
        user_id: newUserId,
        email: email.trim().toLowerCase(),
        full_name: fullName || null,
        password_hash: passwordHash,
        status: status,
        enroller: targetEnroller,
        created_at: new Date().toISOString(),
      })
      .select('id, user_id, email, full_name, status, enroller, created_at')
      .single();

    if (createError || !newUser) {
      return errorResponse(`Erro ao criar usuário: ${createError?.message}`, 400);
    }

    await supabaseServiceRole
      .from('user_settings')
      .insert({
        user_id: newUser.id,
        max_leads_per_day: 100,
        max_instances: 5,
        is_active: true,
        created_at: new Date().toISOString(),
      });

    return successResponse(newUser, 'Usuário cadastrado com sucesso na banca vinculada');
  } catch (err: any) {
    console.error('[Gestor Users Create API] Erro:', err.message);
    return serverErrorResponse(err);
  }
}
