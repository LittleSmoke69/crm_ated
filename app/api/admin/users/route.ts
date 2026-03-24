import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { requireAdminOrSuporte } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { validateHierarchy, hasHierarchyCycle } from '@/lib/middleware/permissions';
import { getEffectiveZaplotoId } from '@/lib/tenant-context';

const DEFAULT_SETTINGS = {
  max_leads_per_day: 100,
  max_instances: 20,
  is_admin: false,
  is_active: true,
};

/** Página ao buscar profiles: PostgREST limita ~1000 linhas por request sem range explícito. */
const PROFILES_PAGE_SIZE = 1000;

const EMPTY_USER_STATS = {
  campaigns: 0,
  instances: 0,
  contacts: 0,
  processed: 0,
  failed: 0,
};

async function fetchAllProfilesForTenant(zaplotoId: string): Promise<{ data: any[]; error: Error | null }> {
  const list: any[] = [];
  let offset = 0;
  for (;;) {
    const { data: batch, error } = await supabaseServiceRole
      .from('profiles')
      .select('id, email, full_name, status, enroller, banca_name, banca_url, created_at, last_seen_at, total_online_time, total_crm_time, zaploto_id')
      .or(`zaploto_id.eq.${zaplotoId},zaploto_id.is.null`)
      .order('created_at', { ascending: false })
      .range(offset, offset + PROFILES_PAGE_SIZE - 1);

    if (error) {
      return { data: [], error: new Error(error.message) };
    }
    const rows = batch || [];
    list.push(...rows);
    if (rows.length < PROFILES_PAGE_SIZE) {
      break;
    }
    offset += PROFILES_PAGE_SIZE;
  }
  return { data: list, error: null };
}

/**
 * GET /api/admin/users — Lista usuários apenas da tabela `profiles` (paginado no servidor).
 * `settings` e `stats` vêm com valores padrão / zerados para manter o contrato do painel;
 * dados reais de configuração e métricas: GET /api/admin/users/[userId].
 */
export async function GET(req: NextRequest) {
  try {
    const { profile } = await requireAdminOrSuporte(req);
    const zaplotoId = await getEffectiveZaplotoId(req, profile);

    const { data: users, error: usersError } = await fetchAllProfilesForTenant(zaplotoId);

    if (usersError) {
      return errorResponse(`Erro ao buscar usuários: ${usersError.message}`);
    }

    const list = users || [];
    const usersForList = list.map((user: any) => ({
      ...user,
      settings: { ...DEFAULT_SETTINGS },
      stats: { ...EMPTY_USER_STATS },
    }));

    return successResponse(usersForList);
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

/**
 * PATCH /api/admin/users - Atualiza configurações de um usuário
 */
export async function PATCH(req: NextRequest) {
  try {
    await requireAdminOrSuporte(req);

    const body = await req.json();
    const { targetUserId, maxLeadsPerDay, maxInstances, isActive, status, enroller, email, fullName, bancaName, bancaUrl, password } = body;

    if (!targetUserId) {
      return errorResponse('targetUserId é obrigatório', 400);
    }

    // Se status ou enroller ou email ou fullName ou banca ou password foram fornecidos, valida/prepara atualização de perfil
    const hasPassword = password && typeof password === 'string' && password.trim();
    if (status || enroller !== undefined || email || fullName !== undefined || bancaName !== undefined || bancaUrl !== undefined || hasPassword) {
      const { data: currentUser } = await supabaseServiceRole
        .from('profiles')
        .select('status, enroller')
        .eq('id', targetUserId)
        .single();

      const newStatus = status || currentUser?.status;
      const newEnroller = enroller !== undefined ? enroller : currentUser?.enroller;

      if (status || enroller !== undefined) {
        // Valida hierarquia
        const validation = await validateHierarchy(targetUserId, newStatus, newEnroller || null);
        if (!validation.valid) {
          return errorResponse(validation.error || 'Hierarquia inválida', 400);
        }

        // Verifica ciclos
        const hasCycle = await hasHierarchyCycle(targetUserId, newEnroller || null);
        if (hasCycle) {
          return errorResponse('Ciclo detectado na hierarquia', 400);
        }
      }

      // Prepara objeto de atualização do perfil
      const profileUpdate: any = {
        updated_at: new Date().toISOString(),
      };
      if (status) profileUpdate.status = status;
      if (enroller !== undefined) profileUpdate.enroller = enroller || null;
      if (email) profileUpdate.email = email.trim().toLowerCase();
      if (fullName !== undefined) profileUpdate.full_name = fullName || null;
      if (bancaName !== undefined) profileUpdate.banca_name = bancaName || null;
      if (bancaUrl !== undefined) profileUpdate.banca_url = bancaUrl || null;

      // Atualiza senha se fornecida
      if (hasPassword) {
        profileUpdate.password_hash = bcrypt.hashSync(password.trim(), bcrypt.genSaltSync(10));
      }

      const { error: profileError } = await supabaseServiceRole
        .from('profiles')
        .update(profileUpdate)
        .eq('id', targetUserId);

      if (profileError) {
        return errorResponse(`Erro ao atualizar perfil: ${profileError.message}`, 400);
      }
    }

    // Atualiza ou cria configurações
    const { data: existing } = await supabaseServiceRole
      .from('user_settings')
      .select('id')
      .eq('user_id', targetUserId)
      .single();

    const updateData: any = {
      updated_at: new Date().toISOString(),
    };

    if (typeof maxLeadsPerDay === 'number') {
      updateData.max_leads_per_day = maxLeadsPerDay;
    }

    if (typeof maxInstances === 'number') {
      updateData.max_instances = maxInstances;
    }

    if (typeof isActive === 'boolean') {
      updateData.is_active = isActive;
    }

    let result;
    if (existing) {
      // Atualiza existente
      const { data, error } = await supabaseServiceRole
        .from('user_settings')
        .update(updateData)
        .eq('user_id', targetUserId)
        .select()
        .single();

      if (error) {
        return errorResponse(`Erro ao atualizar configurações: ${error.message}`);
      }

      result = data;
    } else {
      // Cria novo
      const { data, error } = await supabaseServiceRole
        .from('user_settings')
        .insert({
          user_id: targetUserId,
          max_leads_per_day: maxLeadsPerDay || 100,
          max_instances: maxInstances || 20,
          is_active: isActive !== undefined ? isActive : true,
          ...updateData,
        })
        .select()
        .single();

      if (error) {
        return errorResponse(`Erro ao criar configurações: ${error.message}`);
      }

      result = data;
    }

    return successResponse(result, 'Configurações atualizadas com sucesso');
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

