import { NextRequest } from 'next/server';
import { requireAdminOrSuporte } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { validateHierarchy, hasHierarchyCycle, UserStatus } from '@/lib/middleware/permissions';
import { recordHierarchyNetworkAudit } from '@/lib/admin/hierarchy-network-audit';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';

/**
 * POST /api/admin/users/create - Cria um novo usuário
 */
export async function POST(req: NextRequest) {
  try {
    const { profile } = await requireAdminOrSuporte(req);

    const body = await req.json();
    const { email, fullName, password, status, enroller, bancaName, bancaUrl, banca_ids: bancaIds } = body;

    if (!email || !password) {
      return errorResponse('email e password são obrigatórios', 400);
    }

    if (!status) {
      return errorResponse('status é obrigatório', 400);
    }

    // Valida campos obrigatórios para dono de banca
    if (status === 'dono_banca' && (!bancaName || !bancaUrl)) {
      return errorResponse('Nome e URL da banca são obrigatórios para Donos de Banca', 400);
    }

    // Valida hierarquia
    const validation = await validateHierarchy('', status as UserStatus, enroller || null);
    if (!validation.valid) {
      return errorResponse(validation.error || 'Hierarquia inválida', 400);
    }

    // Verifica se email já existe
    const { data: existing } = await supabaseServiceRole
      .from('profiles')
      .select('id')
      .eq('email', email.trim().toLowerCase())
      .maybeSingle();

    if (existing) {
      return errorResponse('Email já cadastrado', 400);
    }

    // Hash da senha
    const passwordHash = bcrypt.hashSync(password, bcrypt.genSaltSync(10));
    const newUserId = randomUUID();

    // Cria usuário (zaploto_id do admin que cria, para isolamento white label)
    const insertData: any = {
      user_id: newUserId,
      email: email.trim().toLowerCase(),
      full_name: fullName || null,
      password_hash: passwordHash,
      status: status,
      enroller: enroller || null,
      zaploto_id: profile?.zaploto_id || null,
      created_at: new Date().toISOString(),
    };

    // Adiciona campos de banca se for dono de banca
    if (status === 'dono_banca') {
      insertData.banca_name = bancaName;
      insertData.banca_url = bancaUrl;
    }

    const { data: newUser, error: createError } = await supabaseServiceRole
      .from('profiles')
      .insert(insertData)
      .select('id, user_id, email, full_name, status, enroller, banca_name, banca_url, created_at')
      .single();

    if (createError || !newUser) {
      return errorResponse(`Erro ao criar usuário: ${createError?.message || 'Erro desconhecido'}`, 400);
    }

    // Cria configurações padrão
    await supabaseServiceRole
      .from('user_settings')
      .insert({
        user_id: newUser.id,
        max_leads_per_day: 100,
        max_instances: 20,
        is_active: true,
        created_at: new Date().toISOString(),
      });

    // Atribui bancas ao consultor/gerente (opcional; permite várias bancas e banca sem dono)
    if ((status === 'captador' || status === 'gerente') && Array.isArray(bancaIds) && bancaIds.length > 0) {
      const validIds = bancaIds.filter((id: unknown) => typeof id === 'string');
      if (validIds.length > 0) {
        const { data: existing } = await supabaseServiceRole
          .from('crm_bancas')
          .select('id')
          .in('id', validIds);
        const idsToInsert = (existing || []).map((b: { id: string }) => b.id);
        if (idsToInsert.length > 0) {
          await supabaseServiceRole.from('user_bancas').upsert({ user_id: newUser.id, banca_ids: idsToInsert }, { onConflict: 'user_id' });
        }
      }
    }

    await recordHierarchyNetworkAudit({
      zaploto_id: profile.zaploto_id ?? null,
      actor_id: profile.id,
      actor_email: profile.email,
      actor_status: profile.status,
      action: 'user.create',
      target_user_id: newUser.id,
      summary: `Criou ${status}: ${newUser.email}`,
      meta: {
        new_status: status,
        banca_ids: Array.isArray(bancaIds) ? bancaIds : [],
        enroller: enroller || null,
      },
    });

    return successResponse(newUser, 'Usuário criado com sucesso');
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

