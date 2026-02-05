import { NextRequest } from 'next/server';
import { requireStatus, validateHierarchy } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';

/**
 * POST /api/gerente/consultores/create
 * Permite ao Gerente cadastrar Consultores diretamente abaixo dele
 */
export async function POST(req: NextRequest) {
  try {
    const { userId: managerId } = await requireStatus(req, ['gerente']);
    const body = await req.json();
    const { email, fullName, password } = body;

    if (!email || !password) {
      return errorResponse('Email e senha são obrigatórios', 400);
    }

    // 1. Valida hierarquia técnica (Consultor abaixo de Gerente)
    const validation = await validateHierarchy('', 'consultor', managerId);
    if (!validation.valid) {
      return errorResponse(validation.error || 'Hierarquia inválida', 400);
    }

    // 2. Verifica se e-mail já existe
    const { data: existing } = await supabaseServiceRole
      .from('profiles')
      .select('id')
      .eq('email', email.trim().toLowerCase())
      .maybeSingle();

    if (existing) {
      return errorResponse('Este e-mail já está cadastrado', 400);
    }

    // 3. Criação do Consultor
    const passwordHash = bcrypt.hashSync(password, bcrypt.genSaltSync(10));
    const newUserId = randomUUID();

    const { data: newUser, error: createError } = await supabaseServiceRole
      .from('profiles')
      .insert({
        user_id: newUserId,
        email: email.trim().toLowerCase(),
        full_name: fullName || null,
        password_hash: passwordHash,
        status: 'consultor',
        enroller: managerId,
        created_at: new Date().toISOString(),
      })
      .select('id, user_id, email, full_name, status, enroller, created_at')
      .single();

    if (createError || !newUser) {
      return errorResponse(`Erro ao criar consultor: ${createError?.message}`, 400);
    }

    // 4. Configurações padrão
    await supabaseServiceRole
      .from('user_settings')
      .insert({
        user_id: newUser.id,
        max_leads_per_day: 50,
        max_instances: 2,
        is_active: true,
        created_at: new Date().toISOString(),
      });

    return successResponse(newUser, 'Consultor cadastrado com sucesso');
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

