import { NextRequest } from 'next/server';
import { requireStatus, validateHierarchy, UserStatus } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { isInHierarchy } from '@/lib/utils/hierarchy';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';

/**
 * POST /api/dono-banca/users/create
 * Permite ao Dono de Banca criar Gerentes e Consultores dentro da sua hierarquia
 */
export async function POST(req: NextRequest) {
  try {
    const { userId: ownerId } = await requireStatus(req, ['dono_banca']);
    const body = await req.json();
    const { email, fullName, password, status, enroller } = body;

    if (!email || !password || !status) {
      return errorResponse('Email, senha e status são obrigatórios', 400);
    }

    // 1. Validações de permissão do Dono de Banca
    if (status !== 'gerente' && status !== 'consultor') {
      return errorResponse('Dono de banca só pode cadastrar Gerentes ou Consultores', 403);
    }

    // Se for cadastrar Gerente, o enroller deve ser o próprio Dono de Banca
    let targetEnroller = enroller;
    if (status === 'gerente') {
      targetEnroller = ownerId;
    } 

    // Se for cadastrar Consultor, o enroller deve ser um Gerente que está abaixo deste Dono de Banca
    if (status === 'consultor') {
      if (!targetEnroller) {
        return errorResponse('Para cadastrar um Consultor, é necessário selecionar um Gerente', 400);
      }
      const isEnrollerInHierarchy = await isInHierarchy(ownerId, targetEnroller);
      if (!isEnrollerInHierarchy) {
        return errorResponse('O Gerente selecionado não pertence à sua banca', 403);
      }
    }

    // 2. Valida hierarquia técnica
    const validation = await validateHierarchy('', status as UserStatus, targetEnroller);
    if (!validation.valid) {
      return errorResponse(validation.error || 'Hierarquia inválida', 400);
    }

    // 3. Verifica se e-mail já existe
    const { data: existing } = await supabaseServiceRole
      .from('profiles')
      .select('id')
      .eq('email', email.trim().toLowerCase())
      .maybeSingle();

    if (existing) {
      return errorResponse('Este e-mail já está cadastrado no sistema', 400);
    }

    // 4. Criação do usuário
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

    // 5. Configurações padrão
    await supabaseServiceRole
      .from('user_settings')
      .insert({
        user_id: newUser.id,
        max_leads_per_day: 100,
        max_instances: 5,
        is_active: true,
        created_at: new Date().toISOString(),
      });

    return successResponse(newUser, 'Usuário cadastrado com sucesso na sua banca');
  } catch (err: any) {
    console.error('[Users Create API] Erro:', err.message);
    console.error('[Users Create API] Stack:', err.stack);
    return serverErrorResponse(err);
  }
}

