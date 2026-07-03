import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { requireAdminOrSuporte } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { validateHierarchy, hasHierarchyCycle } from '@/lib/middleware/permissions';
import { getEffectiveZaplotoId } from '@/lib/tenant-context';
import { isEvolutionStackEnabled } from '@/lib/app-scope';

const DEFAULT_SETTINGS = {
  max_leads_per_day: 100,
  max_instances: 20,
  is_admin: false,
  is_active: true,
};

const PAGE_SIZE = 1000;
const USER_ID_CHUNK_SIZE = 500;

function chunkArray<T>(arr: T[], size: number): T[][] {
  if (size <= 0) return [arr];
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/**
 * GET /api/admin/users - Lista todos os usuários com suas estatísticas.
 * Usa consultas em lote (5 no total) para evitar timeout/502 com muitos usuários.
 */
export async function GET(req: NextRequest) {
  try {
    const { profile } = await requireAdminOrSuporte(req);
    const zaplotoId = await getEffectiveZaplotoId(req, profile);

    // Profiles com paginação explícita para evitar limite padrão (~1000 linhas) do PostgREST.
    const list: any[] = [];
    let from = 0;
    while (true) {
      const to = from + PAGE_SIZE - 1;
      const { data, error } = await supabaseServiceRole
        .from('profiles')
        .select('id, email, full_name, status, enroller, banca_name, banca_url, created_at, last_seen_at, total_online_time, total_crm_time, zaploto_id')
        .or(`zaploto_id.eq.${zaplotoId},zaploto_id.is.null`)
        .order('created_at', { ascending: false })
        .range(from, to);

      if (error) {
        return errorResponse(`Erro ao buscar usuários: ${error.message}`);
      }

      const batch = data || [];
      list.push(...batch);

      if (batch.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }

    if (list.length === 0) {
      return successResponse([]);
    }

    const userIds = list.map((u: { id: string }) => u.id);
    const userIdChunks = chunkArray(userIds, USER_ID_CHUNK_SIZE);

    const settingsRows: any[] = [];
    const campaignsRows: any[] = [];
    const instancesRows: any[] = [];
    const searchesRows: any[] = [];
    const evolutionEnabled = isEvolutionStackEnabled();

    for (const ids of userIdChunks) {
      const queries: Promise<{ data: any[] | null }>[] = [
        supabaseServiceRole.from('user_settings').select('*').in('user_id', ids),
      ];
      if (evolutionEnabled) {
        queries.push(
          supabaseServiceRole.from('campaigns').select('user_id, processed_contacts, failed_contacts').in('user_id', ids),
          supabaseServiceRole.from('whatsapp_instances').select('user_id').in('user_id', ids),
          supabaseServiceRole.from('searches').select('user_id').in('user_id', ids),
        );
      }

      const results = await Promise.all(queries);
      const settingsBatch = results[0]?.data;
      if (settingsBatch) settingsRows.push(...settingsBatch);
      if (evolutionEnabled) {
        const campaignsBatch = results[1]?.data;
        const instancesBatch = results[2]?.data;
        const searchesBatch = results[3]?.data;
        if (campaignsBatch) campaignsRows.push(...campaignsBatch);
        if (instancesBatch) instancesRows.push(...instancesBatch);
        if (searchesBatch) searchesRows.push(...searchesBatch);
      }
    }

    const settingsByUser = new Map<string, any>();
    settingsRows.forEach((s: any) => settingsByUser.set(s.user_id, s));

    const campaignsCountByUser = new Map<string, number>();
    const processedByUser = new Map<string, number>();
    const failedByUser = new Map<string, number>();
    campaignsRows.forEach((c: any) => {
      const uid = c.user_id;
      campaignsCountByUser.set(uid, (campaignsCountByUser.get(uid) || 0) + 1);
      processedByUser.set(uid, (processedByUser.get(uid) || 0) + (c.processed_contacts || 0));
      failedByUser.set(uid, (failedByUser.get(uid) || 0) + (c.failed_contacts || 0));
    });

    const instancesCountByUser = new Map<string, number>();
    instancesRows.forEach((i: any) => {
      const uid = i.user_id;
      instancesCountByUser.set(uid, (instancesCountByUser.get(uid) || 0) + 1);
    });

    const contactsCountByUser = new Map<string, number>();
    searchesRows.forEach((s: any) => {
      const uid = s.user_id;
      contactsCountByUser.set(uid, (contactsCountByUser.get(uid) || 0) + 1);
    });

    const usersWithStats = list.map((user: any) => ({
      ...user,
      settings: settingsByUser.get(user.id) || DEFAULT_SETTINGS,
      stats: {
        campaigns: campaignsCountByUser.get(user.id) || 0,
        instances: instancesCountByUser.get(user.id) || 0,
        contacts: contactsCountByUser.get(user.id) || 0,
        processed: processedByUser.get(user.id) || 0,
        failed: failedByUser.get(user.id) || 0,
      },
    }));

    return successResponse(usersWithStats);
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
